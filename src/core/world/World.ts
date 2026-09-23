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
import { createInteractionStates } from '../fsm/states/interactionStates';
import { createCoreTransitions, createAdmissionGuards } from '../fsm/transitions';
import {
  createInteractionTransitions,
  createInteractionAdmissionGuards,
} from '../fsm/interactionTransitions';
import { AnimationSystem, type RenderState } from '../animation/AnimationSystem';
import type { ProceduralContext } from '../animation/ProceduralLayer';
import { createRng, type Rng } from '../world/Rng';
import type { SpeciesData, BehaviorsData } from '../data/types';
import { resolveGrayboxSize } from '../data/defaults';
import { BondSystem } from '../affection/BondSystem';
import { MoodSystem, type MoodModifiers } from '../affection/MoodSystem';
import { InteractionSystem } from '../interaction/InteractionSystem';
import { BB_BOND_SYSTEM, BB_MOOD_SYSTEM } from './blackboardAccess';

export interface WorldOptions {
  readonly loaded: LoadedSpecies;
  /** 世界可视尺寸，用于边界约束 */
  readonly bounds: { readonly w: number; readonly h: number };
  readonly seed?: number;
  readonly bus?: EventBus;
  readonly debug?: boolean;
  /**
   * 玩家位置（世界坐标）。
   * Milestone 2 没有鼠标跟随的"玩家"，因此玩家锚点固定 ——
   * 代表"你坐在屏幕外看着它"。狗看向屏幕下方即表示在看你。
   */
  readonly playerAnchor?: { readonly x: number; readonly y: number };
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

  // ── Milestone 2 子系统 ──
  private readonly bond: BondSystem;
  private readonly mood: MoodSystem;
  private readonly interaction: InteractionSystem;

  /** 玩家位置（狗看向/走向的目标） */
  private playerX: number;
  private playerY: number;

  /** 走开后的"闹别扭"剩余时间（ms） */
  private sulkRemainingMs = 0;

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

    // ── Milestone 2：玩家锚点 ──
    // 若未指定，按 species.room.playerAnchor 的比例推导
    const anchor = options.playerAnchor ?? {
      x: this.bounds.w * this.species.room.playerAnchor.xRatio,
      y: this.bounds.h * this.species.room.playerAnchor.yRatio,
    };
    this.playerX = anchor.x;
    this.playerY = anchor.y;
    this.blackboard['playerX'] = this.playerX;
    this.blackboard['playerY'] = this.playerY;

    // ── Milestone 2 子系统 ──
    this.bond = new BondSystem(this.species.affection.bonding);
    this.mood = new MoodSystem(
      this.species.affection.annoyance,
      this.species.personality.temperament,
      this.behaviors.annoyanceBias ?? {},
    );
    this.interaction = new InteractionSystem(this.species);

    // ★ 把系统引用写入黑板，供纯函数式的守卫/打分读取。
    //   这是避免「StateContext ← 系统」循环依赖的关键设计，
    //   详见 blackboardAccess.ts 的说明。
    this.blackboard[BB_BOND_SYSTEM] = this.bond;
    this.blackboard[BB_MOOD_SYSTEM] = this.mood;

    this.fsm = new StateMachine({
      // ★ 迁移表顺序不影响裁决（按分值），但把互动迁移放在后面便于阅读。
      //   互动状态通常分值更高（95 / 150），因此能打断常规行为。
      transitions: [...createCoreTransitions(), ...createInteractionTransitions()],
      // ★ 准入守卫：防止「进行中的行为」被权重系统打断。
      //   互动守卫与核心守卫合并 —— 后者管"走完再走"，前者管"摸完再走"。
      admissionGuards: {
        ...createAdmissionGuards(),
        ...createInteractionAdmissionGuards(),
      },
      minStateDurationMs: 200,
      debug: options.debug ?? false,
    });
    // 常规行为 + 互动姿态
    this.fsm.addStates(...createCoreStates(), ...createInteractionStates());

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

  // ─────────────────────────────────────────────────
  // Milestone 2：互动 API
  // ─────────────────────────────────────────────────

  /** 羁绊系统快照（供调试面板展示"它认识我多少"） */
  get bondSnapshot() {
    return this.bond.snapshot();
  }

  /** 羁绊阶梯总级数 */
  get bondRungCount(): number {
    return this.bond.rungCount;
  }

  /** 情绪快照 */
  get moodSnapshot() {
    return this.mood.snapshot();
  }

  /** 情绪修饰表（动画层读取） */
  get moodModifiers(): MoodModifiers {
    return this.mood.modifiers();
  }

  /** 是否正在被抚摸 */
  get isBeingPetted(): boolean {
    return this.interaction.isPetting;
  }

  /** 是否在闹别扭（刚走开不久） */
  get isSulking(): boolean {
    return this.sulkRemainingMs > 0;
  }

  /** 命中检测：这个屏幕坐标摸到狗了吗 */
  hitsDog(x: number, y: number, isTouch = false): boolean {
    return this.interaction.hitsDog(x, y, this.blackboard.x, this.blackboard.y, isTouch);
  }

  /** 指针按下 */
  pointerDown(x: number, y: number, atMs: number, isTouch: boolean): boolean {
    return this.interaction.pointerDownAt(
      x,
      y,
      atMs,
      isTouch,
      this.blackboard.x,
      this.blackboard.y,
    );
  }

  /** 指针移动 */
  pointerMove(x: number, y: number, isTouch: boolean): void {
    this.interaction.pointerMoveTo(x, y, isTouch, this.blackboard.x, this.blackboard.y);
  }

  /**
   * 指针抬起。
   *
   * ★ 抬手时的"轻点补偿"逻辑放在这里，而不是让输入层调用两次 API。
   *
   *   理由：InteractionSystem 的 session 在 pointerUp 时就被销毁了，
   *   外部若先 up 再查 hasSettled() 会永远得到 false。
   *   把判定放在销毁之前，是唯一能正确工作的顺序。
   *
   *   补偿规则：
   *     本次会话**没有**产生过结算（即轻点，未达 minEffectiveMs）
   *       → 补一次最低有效性的抚摸，保证"点一下也有回应"
   *     已经结算过（长按）
   *       → 不再补偿，避免 420ms 被算成 5 次而误判为骚扰
   */
  pointerUp(atMs: number): void {
    const settled = this.interaction.hasSettled();
    this.interaction.pointerUpAt(atMs);

    if (!settled && !this.isSulking) {
      // 轻点补偿：本次会话未产生结算（短促的一下），
      // 补一次最低有效性的抚摸，保证"点一下也有回应"。
      // 这也算一次新的抚摸会话 —— 因此计入骚扰窗口。
      this.registerPet(0.45, true);
    }
  }

  /**
   * 本次抚摸会话是否已经产生过结算。
   * 供输入层判断"抬手时要不要补一次轻点奖励" —— 见 registerPet 的说明。
   */
  get pettingSettled(): boolean {
    return this.interaction.hasSettled();
  }

  /**
   * ★ 抚摸结算的单一入口。
   *
   * @param effectiveness 0..1，摸得越久越有效
   * @param isSessionStart
   *        true 表示这是**一次新抚摸会话的第一次结算**。
   *
   *        ★ 骚扰判定只认"会话次数"，不认"结算次数"。
   *          这个区分至关重要：一次 420ms 的温柔按住会结算约 4 次有效抚摸，
   *          若按结算次数计入骚扰窗口，玩家正常地"摸一会儿"
   *          就会被判定为连点骚扰 —— 实测表现为羁绊刚涨到 0.49 就崩回 0。
   *
   *          正确的语义是：**"连续快速地点"才是骚扰**，
   *          而"按住久一点"应当被鼓励。因此窗口只统计会话数。
   *
   * @returns 是否构成"骚扰"
   */
  registerPet(effectiveness: number, isSessionStart = false): boolean {
    if (this.isSulking) return false; // 闹别扭中，不接受抚摸

    const pettingCfg = this.species.affection.petting;
    const eff = Math.max(0, Math.min(1, effectiveness));

    // ① 情绪层：登记这次抚摸
    //   骚扰判定只在"新会话"时计入，见上面的说明。
    const { annoying } = this.mood.registerPet(
      this.elapsedMs,
      pettingCfg.pleasureBase * eff,
      pettingCfg.arousalGain * eff,
      isSessionStart,
    );

    // ② 羁绊层：只有非骚扰的抚摸才增进关系
    if (!annoying) {
      this.bond.pet(eff);
    } else {
      // 骚扰：羁绊受损
      this.bond.penalize(0.06);
    }

    // ③ 标记一次性脉冲，供迁移表判断"刚刚被摸了"
    this.blackboard['justPetted'] = true;

    return annoying;
  }

  /**
   * 玩家位置。
   * Milestone 2 固定不动（代表坐在屏幕外的你）。
   */
  setPlayerPosition(x: number, y: number): void {
    this.playerX = x;
    this.playerY = y;
    this.blackboard['playerX'] = x;
    this.blackboard['playerY'] = y;
  }

  resize(bounds: { w: number; h: number }): void {
    this.bounds = { ...bounds };
    // 玩家锚点按新尺寸重新推导
    this.playerX = this.bounds.w * this.species.room.playerAnchor.xRatio;
    this.playerY = this.bounds.h * this.species.room.playerAnchor.yRatio;
    this.blackboard['playerX'] = this.playerX;
    this.blackboard['playerY'] = this.playerY;
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

    // ── ② Milestone 2：互动与情绪推进 ──
    //
    // ★ 顺序很重要：互动 → 情绪 → 羁绊 → 状态机
    //   因为状态机的守卫需要读取「当前是否被抚摸」与「烦躁到什么程度」，
    //   这些必须先于裁决更新完毕，否则守卫会读到上一帧的旧值，
    //   表现为"摸了一下要等一帧才有反应"。
    this.updateInteraction(dtMs);
    this.updateMood(dtMs);
    this.updateBond(dtMs);

    // ── ③ 决策节流 ──
    // 狗不是每帧都在"思考"。decisionIntervalMs 越大，思考越慢。
    //
    // ★ Milestone 2 例外：正在被抚摸 / 正在互动时**跳过节流**。
    //   否则反应慢的犬种（决策间隔 900ms）会让玩家觉得"它没反应"，
    //   而抚摸是玩家最直接的输入，必须立刻被感知到。
    //   这体现"反应慢"与"不理我"的区别 —— 后者是 bug，不是性格。
    this.decisionAccumMs += dtMs;
    const urgent = this.blackboard['beingPetted'] === true || this.interaction.isPetting;
    const canDecide =
      urgent ||
      (this.decisionAccumMs >= this.species.cognition.decisionIntervalMs &&
        this.reactionDelayRemainingMs <= 0);

    if (canDecide) this.decisionAccumMs = 0;

    // ── ③ 状态机更新（每帧一次，绝不重复调用）──
    //
    // ★ 关键：stateElapsedMs 必须每帧精确累加一次。
    //   物理由状态自身的 onUpdate 推进，因此物理是每帧的（移动平滑）；
    //   而「全局裁决」通过 ctx.allowDecision 按 cognition.decisionIntervalMs 节流。
    //
    //   这样既有平滑移动，又有"思考迟钝"的性格表现。
    const reactDelayOk = urgent || this.reactionDelayRemainingMs <= 0;
    const before = this.fsm.current;
    ctx.allowDecision = canDecide && reactDelayOk;
    this.fsm.update(ctx);
    const after: StateId = this.fsm.current ?? 'Idle';

    if (before !== after) {
      this.scheduleReaction();
      this.animation.requestState(after);
      this.onStateChanged(after);
    }

    // 发出完整打分表 —— 调试"为什么它这样动"的关键
    if (canDecide) {
      const decision = this.fsm.decide(ctx);
      this.bus.emit('state:decision', {
        chosen: decision.chosen,
        scores: decision.scores,
        tick: this.tick,
      });

      // ★ justPetted 脉冲必须在**被一次裁决消费之后**才清除。
      //
      //   踩过的坑：早期版本每帧无条件清除它。但抚摸发生在 update() 之外
      //   （浏览器里是 pointer 回调，测试里是 harness 调用），
      //   于是脉冲在下一帧就被抹掉，裁决可能根本没看到它 ——
      //   表现是"摸了很多次，狗却一直停在最低级的 LookAt"。
      //
      //   正确做法：只在真正做过裁决的那一帧清除。
      //   若决策被节流跳过，脉冲保留到下一次裁决，保证"摸了一定会被感知"。
      this.clearJustPettedPulse();
    }

    // ── ④ 边界约束 ──
    this.clampToBounds();

    // ── ⑤ 动画推进 ──
    const speed = this.blackboard.speedPxPerSec;
    const runSpeed = this.species.locomotion.runSpeedPx;
    const speedRatio = runSpeed > 0 ? Math.min(1, speed / runSpeed) : 0;

    // ★ Milestone 2：过程动画由**真实情绪**驱动，而不是由速度猜测。
    //   这让"被摸时尾巴摆得欢"这类表现自动成立，无需为每个状态写动画。
    const moodMods = this.mood.modifiers();
    const proceduralCtx: ProceduralContext = {
      moving: this.blackboard.moving,
      speedRatio,
      arousal: moodMods.arousal,
      alertness: this.computeAlertness(),
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

  /**
   * 推进互动状态。
   *
   * 关键职责：
   *   ① 更新"是否正在被抚摸"（供状态机守卫读取）
   *   ② 把累计的按住时长**结算**成有效抚摸次数
   *
   * ★ 结算逻辑是"轻轻点"与"按住摸"的分界线，是 Milestone 2 的体验核心：
   *   轻点只触发 tap → 一次抚摸 → 可能是"看向你"
   *   按住 0.5 秒 → 约 5 次结算 → 羁绊快速上升 → 阶梯往上爬
   *   玩家会自然发现"摸久一点它更开心"，这个发现就是"它是一只狗"的证据。
   */
  private updateInteraction(dtMs: number): void {
    void dtMs;

    // ① 推进按住时长（时长的唯一来源）
    this.interaction.update(this.elapsedMs);

    // ② 更新"正在被抚摸"标记
    const petting = this.interaction.isPetting;
    this.blackboard['beingPetted'] = petting;

    // ③ 结算有效抚摸
    if (petting) {
      const fresh = this.interaction.settlePets();
      if (fresh > 0) {
        // 摸得越久，每次结算的有效性越高
        const eff = this.interaction.effectiveness(this.interaction.pettingHeldMs);
        // ★ 只有本次会话的**第一次**结算才算"新的一次抚摸"，
        //   用于骚扰判定。详见 registerPet 的说明。
        const isFirstOfSession = this.interaction.settledCount === fresh;
        for (let i = 0; i < fresh; i++) {
          this.registerPet(eff, isFirstOfSession && i === 0);
        }
      }
    }

    // ④ 闹别扭倒计时
    if (this.sulkRemainingMs > 0) {
      const before = this.sulkRemainingMs;
      this.sulkRemainingMs = Math.max(0, this.sulkRemainingMs - dtMs);
      this.blackboard['sulking'] = this.sulkRemainingMs > 0;

      // ★ 闹别扭结束的那一刻，让它真正消气。
      //
      //   为什么需要这一步：
      //     annoyance 的自然衰减很慢（配置里约 0.3/s），
      //     而 sulkMs 只有几秒。若不在此处强行平复，
      //     会出现"闹别扭结束了，但烦躁仍高于阈值"的状态 ——
      //     狗会立刻再次进入 Retreat，形成无限循环的走开，
      //     玩家看到的是"它一直在生气，怎么哄都没用"。
      //
      //     这是设计上的取舍：Milestone 2 要让玩家觉得
      //     "它生气了，但等一会儿就好了"，而不是惩罚玩家。
      if (before > 0 && this.sulkRemainingMs <= 0) {
        this.mood.forgive();
        // 清空骚扰时间窗口，避免刚消气就因残留记录再次被判定为骚扰
        this.mood.beginSulk();
      }
    }
  }

  /** 推进情绪 */
  private updateMood(dtMs: number): void {
    const beingPetted = this.blackboard['beingPetted'] === true;

    if (beingPetted) {
      this.mood.update(dtMs / 1000, true, this.elapsedMs);
    } else if (this.blackboard['wagging'] === true) {
      // 摇尾巴时保持高兴奋，但走 calm 路径避免被误判为"被摸"
      this.mood.update(dtMs / 1000, true, this.elapsedMs);
    } else {
      this.mood.calm(dtMs / 1000, this.elapsedMs);
    }
  }

  /** 推进羁绊 */
  private updateBond(dtMs: number): void {
    this.bond.update(dtMs / 1000, this.mood.isAnnoyed);
  }

  /**
   * 状态切换后的副作用。
   *
   * 主要是"走开"这个行为需要设置闹别扭冷却 ——
   * 否则狗会在走开与回来之间高频抖动，看起来像故障。
   */
  private onStateChanged(state: StateId): void {
    const bb = this.blackboard;

    if (state === 'Retreat') {
      this.sulkRemainingMs = this.species.affection.annoyance.sulkMs;
      bb['sulking'] = true;
      // 走开后结束当前抚摸
      this.interaction.cancel();
      this.mood.beginSulk();
      this.bus.emit('interaction:refused', { intent: 'PET', reason: 'choseOtherwise' });
    }

    if (state === 'PetEnjoy') {
      this.bus.emit('interaction:accepted', { intent: 'PET' });
    }
  }

  /** 清除"刚刚被抚摸"的一次性脉冲 */
  private clearJustPettedPulse(): void {
    this.blackboard['justPetted'] = false;
  }

  /**
   * 清醒度 0..1：驱动呼吸深浅与眨眼频率。
   *
   * Milestone 2 由三个因素推导：
   *   - 睡眠状态 → 极低
   *   - 被抚摸/享受中 → 低（放松、半闭眼）
   *   - 烦躁 → 高（警觉）
   */
  private computeAlertness(): number {
    if (this.currentState === 'Sleep') return 0.15;

    const enjoying = this.blackboard['enjoying'] === true;
    const mood = this.mood.snapshot();

    let alertness = 0.85;
    if (enjoying) alertness -= 0.35; // 享受 → 放松
    if (this.blackboard['beingPetted'] === true) alertness -= 0.2;
    if (mood.annoyance > 0.3) alertness += 0.15; // 烦躁 → 警觉
    if (mood.arousal > 0.6) alertness += 0.1; // 兴奋 → 精神

    return Math.max(0.1, Math.min(1, alertness));
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
