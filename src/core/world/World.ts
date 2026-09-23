/**
 * L.D.C. — 世界（World）
 *
 * 职责：把各子系统接在一起，并成为唯一的「逻辑入口」。
 *
 *   GameLoop.update()  →  world.update(dtSec)
 *                            ├─ 需求衰减（Phase 4）
 *                            ├─ FSM 更新
 *                            ├─ 动画系统推进
 *                            └─ 产出 RenderState（只读快照）
 *
 *   GameLoop.render()  →  world.getRenderState()  →  渲染层
 *
 * ★ 关键设计：World 不持有任何 Pixi 对象。
 *   渲染层订阅 World，而不是 World 驱动渲染层。
 *   这让「逻辑」可以脱离浏览器跑测试（tools/ 下的模拟器就是这么做的）。
 */

import { EventBus } from '../event/EventBus';
import type { StateId } from '../event/events';
import type { LoadedSpecies } from '../data/SpeciesLoader';
import {
  StateMachine,
  createBlackboard,
  type Blackboard,
  type StateContext,
} from '../fsm/StateMachine';
import { createCoreStates } from '../fsm/states/coreStates';
import { createCoreTransitions, createAdmissionGuards } from '../fsm/transitions';
import { AnimationSystem, type RenderState } from '../animation/AnimationSystem';
import type { ProceduralContext } from '../animation/ProceduralLayer';
import { createRng, type Rng } from '../world/Rng';
import type { SpeciesData, BehaviorsData } from '../data/types';
import { resolveGrayboxSize } from '../data/defaults';

export interface WorldOptions {
  readonly loaded: LoadedSpecies;
  /** 世界可视尺寸，用于边界约束 */
  readonly bounds: { readonly w: number; readonly h: number };
  readonly seed?: number;
  readonly bus?: EventBus;
  readonly debug?: boolean;
}

export class World {
  readonly bus: EventBus;
  readonly blackboard: Blackboard;

  private species: SpeciesData;
  private behaviors: BehaviorsData;
  private loaded: LoadedSpecies;

  private readonly fsm: StateMachine;
  private readonly animation: AnimationSystem;
  private readonly rng: Rng;

  private bounds: { w: number; h: number };
  private tick = 0;
  private elapsedMs = 0;
  private readonly seed: number;

  /** 决策节流：只在 cognition.decisionIntervalMs 到点时才重算 */
  private decisionAccumMs = 0;
  /** 反应延迟：感知到变化后的"愣一下" */
  private reactionDelayRemainingMs = 0;

  private renderState: RenderState;
  private disposed = false;

  constructor(options: WorldOptions) {
    this.loaded = options.loaded;
    this.species = options.loaded.species;
    this.behaviors = options.loaded.behaviors;
    this.bounds = { ...options.bounds };
    this.seed = options.seed ?? 20250101;
    this.rng = createRng(this.seed);

    this.bus = options.bus ?? new EventBus();

    // 出生点在画面中心偏下
    const spawnX = this.bounds.w / 2;
    const spawnY = this.bounds.h * 0.62;
    this.blackboard = createBlackboard(spawnX, spawnY);

    this.fsm = new StateMachine({
      transitions: createCoreTransitions(),
      // ★ 准入守卫：防止「进行中的行为」被权重系统打断
      admissionGuards: createAdmissionGuards(),
      minStateDurationMs: 260,
      debug: options.debug ?? false,
    });
    this.fsm.addStates(...createCoreStates());

    this.animation = new AnimationSystem(this.species, this.bus, {
      seed: this.seed,
      debug: options.debug ?? false,
    });

    // 初始姿态：先跑一次过程动画拿到合法的 transform（零时长，只求初值）
    this.animation.requestState('Idle');
    this.renderState = this.animation.update(0, NEUTRAL_PROCEDURAL, {
      stateId: 'Idle',
      speedPxPerSec: 0,
      moving: false,
    });
    this.renderState = this.withWorldTransform(this.renderState);

    // 首次进入 Idle
    this.fsm.forceState('Idle', this.createContext(0), 'init');

    // ★ 反应延迟：让狗不是"你一动它立即动"
    this.scheduleReaction();
  }

  // ─────────────────────────────────────────────────
  // 公开 API
  // ─────────────────────────────────────────────────

  get currentState(): StateId {
    return this.fsm.current ?? 'Idle';
  }

  get currentTick(): number {
    return this.tick;
  }

  get elapsed(): number {
    return this.elapsedMs;
  }

  get speciesData(): SpeciesData {
    return this.species;
  }

  get behaviorsData(): BehaviorsData {
    return this.behaviors;
  }

  get loadedEntry(): LoadedSpecies {
    return this.loaded;
  }

  /** 渲染层读取的唯一入口。返回的是上一次 update 的快照，不可变语义。 */
  getRenderState(): RenderState {
    return this.renderState;
  }

  resize(bounds: { w: number; h: number }): void {
    this.bounds = { ...bounds };
    // 把狗拉回可视范围
    this.blackboard.x = Math.min(Math.max(this.blackboard.x, 16), this.bounds.w - 16);
    this.blackboard.y = Math.min(Math.max(this.blackboard.y, 16), this.bounds.h - 16);
  }

  /**
   * ★ 运行时热替换犬种数据。
   * 这是「改 JSON 立即生效」的实现：不重建 World、不丢失位置与状态，
   * 只替换数据并让各子系统重新读取参数。
   */
  applySpecies(loaded: LoadedSpecies): void {
    this.loaded = loaded;
    this.species = loaded.species;
    this.behaviors = loaded.behaviors;
    this.animation.setSpecies(loaded.species);
    this.bus.emit('species:reloaded', { id: loaded.species.id });
  }

  /** 逻辑帧更新。dtSec 为固定步长。 */
  update(dtSec: number): void {
    if (this.disposed) return;

    const dtMs = dtSec * 1000;
    this.tick++;
    this.elapsedMs += dtMs;

    const ctx = this.createContext(dtMs);

    // ── ① 反应延迟倒计时 ──
    // 感知到刺激后"愣一下"再反应。这让狗不是"你一动它立即动"。
    if (this.reactionDelayRemainingMs > 0) {
      this.reactionDelayRemainingMs = Math.max(0, this.reactionDelayRemainingMs - dtMs);
    }

    // ── ② 决策节流 ──
    // 狗不是每帧都在"思考"。decisionIntervalMs 越大，思考越慢。
    this.decisionAccumMs += dtMs;
    const canDecide =
      this.decisionAccumMs >= this.species.cognition.decisionIntervalMs &&
      this.reactionDelayRemainingMs <= 0;

    if (canDecide) this.decisionAccumMs = 0;

    // ── ③ 状态机更新（每帧一次，绝不重复调用）──
    //
    // ★ 关键：stateElapsedMs 必须每帧精确累加一次。
    //   物理由状态自身的 onUpdate 推进，因此物理是每帧的（移动平滑）；
    //   而「全局裁决」通过 ctx.allowDecision 按 cognition.decisionIntervalMs 节流。
    //
    //   这样既有平滑移动，又有"思考迟钝"的性格表现。
    const before = this.fsm.current;
    ctx.allowDecision = canDecide;
    this.fsm.update(ctx);
    const after: StateId = this.fsm.current ?? 'Idle';

    if (before !== after) {
      this.scheduleReaction();
      this.animation.requestState(after);
    }

    // 发出完整打分表 —— 调试"为什么它这样动"的关键
    if (canDecide) {
      const decision = this.fsm.decide(ctx);
      this.bus.emit('state:decision', {
        chosen: decision.chosen,
        scores: decision.scores,
        tick: this.tick,
      });
    }

    // ── ④ 边界约束 ──
    this.clampToBounds();

    // ── ⑤ 动画推进 ──
    const speed = this.blackboard.speedPxPerSec;
    const runSpeed = this.species.locomotion.runSpeedPx;
    const speedRatio = runSpeed > 0 ? Math.min(1, speed / runSpeed) : 0;
    const proceduralCtx: ProceduralContext = {
      moving: this.blackboard.moving,
      speedRatio,
      // Phase 0/1：兴奋度由速度与"刚切换状态"推导。Phase 4 接入真实情绪系统。
      arousal: Math.min(1, speedRatio * 0.8 + 0.15),
      alertness: this.currentState === 'Sleep' ? 0.15 : 0.85,
    };

    this.renderState = this.animation.update(dtMs, proceduralCtx, {
      stateId: this.currentState,
      speedPxPerSec: speed,
      moving: this.blackboard.moving,
    });

    // ── ⑥ 补全 RenderState 的世界坐标 ──
    this.renderState = this.withWorldTransform(this.renderState);

    this.bus.emit('world:tick', { tick: this.tick, dtMs, elapsedMs: this.elapsedMs });
  }

  dispose(): void {
    this.disposed = true;
    this.bus.clear();
  }

  // ─────────────────────────────────────────────────
  // 内部
  // ─────────────────────────────────────────────────

  private createContext(dtMs: number): StateContext {
    return {
      dtSec: dtMs / 1000,
      dtMs,
      tick: this.tick,
      elapsedMs: this.elapsedMs,
      species: this.species,
      behaviors: this.behaviors,
      rng: this.rng,
      bus: this.bus,
      blackboard: this.blackboard,
    };
  }

  /** 按 reactionDelayMs 安排一次"愣神" */
  private scheduleReaction(): void {
    const [lo, hi] = this.species.cognition.reactionDelayMs;
    this.reactionDelayRemainingMs = this.rng.range(lo, hi);
  }

  /** 把狗约束在可视范围内（含灰盒半宽/半高） */
  private clampToBounds(): void {
    const size = resolveGrayboxSize(this.species);
    const halfW = size.w / 2;
    const halfH = size.h / 2;
    const bb = this.blackboard;

    if (bb.x < halfW) bb.x = halfW;
    if (bb.x > this.bounds.w - halfW) bb.x = this.bounds.w - halfW;
    if (bb.y < halfH) bb.y = halfH;
    if (bb.y > this.bounds.h - halfH) bb.y = this.bounds.h - halfH;
  }

  /** 把世界坐标与灰盒尺寸补进 RenderState（动画层不关心位置） */
  private withWorldTransform(rs: RenderState): RenderState {
    const size = resolveGrayboxSize(this.species);
    return {
      ...rs,
      x: this.blackboard.x,
      y: this.blackboard.y,
      w: size.w,
      h: size.h,
      facingDeg: this.blackboard.facingDeg,
    };
  }
}

/** 中性过程动画上下文（构造期使用） */
const NEUTRAL_PROCEDURAL: ProceduralContext = {
  moving: false,
  speedRatio: 0,
  arousal: 0.2,
  alertness: 0.8,
};
