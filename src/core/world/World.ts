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
import { resolveGrayboxSize, INTERACTION_STATE_IDS } from '../data/defaults';
import { BondSystem } from '../affection/BondSystem';
import { MoodSystem, type MoodModifiers } from '../affection/MoodSystem';
import { InteractionSystem } from '../interaction/InteractionSystem';
import { MicroBehaviorSystem } from '../behavior/MicroBehaviorSystem';
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
  /** ★ Alpha 打磨：微行为（它自己顺手做的小动作） */
  private readonly micro: MicroBehaviorSystem;

  /** 玩家位置（狗看向/走向的目标） */
  private playerX: number;
  private playerY: number;

  /** 走开后的"闹别扭"剩余时间（ms） */
  private sulkRemainingMs = 0;

  /** 上一个状态，用于判断"刚睡醒"这类跨状态条件 */
  private previousState: StateId = 'Idle';

  private bounds: { w: number; h: number };
  private tick = 0;
  private elapsedMs = 0;
  private readonly seed: number;

  /** 决策节流：只在 cognition.decisionIntervalMs 到点时才重算 */
  private decisionAccumMs = 0;
  /**
   * 下一次决策的阈值（ms），每次决策后重抽。
   *
   * 在 [0.65, 1.35] × decisionIntervalMs 内随机，**均值等于 decisionIntervalMs**。
   * 目的：打散"决策发生在固定网格上"造成的机械感，详见 update() 中的说明。
   */
  private nextDecisionAtMs = 0;
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
    this.micro = new MicroBehaviorSystem(this.behaviors, this.rng);

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
      // ★ 响应态：这些状态是"对玩家的响应"，不走偏好份额。
      //   详见 StateMachine.responseStates 与 RESPONSE_BASE_SCORE 的说明。
      responseStates: INTERACTION_STATE_IDS,
      // ★ 休止态：Idle 是"没别的事可做"的兜底态，不是"想做的事"。
      //   不打折会让它永远自动达标，把狗高频拉回站立（实测占 61% 时间，
      //   且导致 Sleep 永远不可达）。详见 REST_STATE_DISCOUNT。
      restStateId: 'Idle',
      // ★ 护栏时长与犬种节奏挂钩。
      //
      //   固定 200ms 对慢性子犬种没问题，但对敏捷犬种（决策间隔 180ms）
      //   会形成"最小时长是决策间隔的 1.1 倍"的巧合，
      //   使状态时长只能取 2 个决策刻度的整数倍 ——
      //   实测 swift 的 Sit 每次恰好 367ms（标准差 0.000），
      //   像节拍器一样精确，完全掩盖了随机相位的作用。
      //
      //   改为取决策间隔的 0.8 倍（最低 120ms），
      //   让护栏不再是决策刻度的整数倍，从而释放时长变化空间。
      minStateDurationMs: Math.max(
        120,
        Math.round(this.species.cognition.decisionIntervalMs * 0.8),
      ),
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

  /** 微行为快照（供调试面板与自动化核验） */
  get microSnapshot() {
    return this.micro.snapshot();
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
   * 指针抬起 —— **抚摸的结算点**。
   *
   * ★★★ Alpha 打磨的关键决策：羁绊在抬手时结算，而非按住期间 ★★★
   *
   * ── 为什么不在按住期间结算 ──
   *
   * 试过两种按住期间结算的方案，都不成立：
   *
   *   方案 A：每 90ms 结算一次
   *     → 一次 700ms 的按住被算成 7 次抚摸，羁绊一次涨 0.85，
   *       两次按住就满级。玩家会发现"狂按比慢慢摸快得多"。
   *
   *   方案 B：一次会话只结算一次，在越过 90ms 的那一刻
   *     → 有效性按 95ms 计算，恒为 0.278，
   *       而玩家实际按了 420ms。10 次抚摸才到 0.30 羁绊。
   *
   * 根因：**按住的时长只有在抬手时才完全已知**。
   * 在按住期间任何时刻结算，都用的是一个不完整的时长。
   *
   * ── 当前模型 ──
   *
   *   按下期间：只累加时长 + 让状态机即时响应（表现层无延迟）
   *   抬手时：  用完整时长算一次有效性，发放一次羁绊
   *
   * 这不影响"即时感"：状态机在看按下的**第一帧**就会进入
   * LookAt / Approach（见 interactionTransitions 的即时响应设计），
   * 玩家看到的反应依然是立刻的。
   *
   * 规则：
   *   按住 ≥ minEffectiveMs（90ms）→ 一次有效抚摸，有效性按时长（最高 1.0）
   *   按住 <  minEffectiveMs        → 视为轻点，补一次低有效性抚摸（0.45）
   *
   * 两种情况都只发放**一次**，且都计入骚扰窗口。
   */
  pointerUp(atMs: number): void {
    if (this.isSulking) {
      this.interaction.pointerUpAt(atMs);
      return;
    }

    // ★ 先读时长，再销毁 session（顺序不能反）
    const heldMs = this.interaction.pettingHeldMs;
    const wasOnTarget = this.interaction.isPetting;
    this.interaction.pointerUpAt(atMs);

    if (!wasOnTarget) return; // 没摸在狗身上，不算

    const minEffective = this.species.affection.petting.minEffectiveMs;
    if (heldMs >= minEffective) {
      // 有效抚摸：有效性随按住时长增长（360ms 达满分）
      this.registerPet(this.interaction.effectiveness(heldMs), true);
    } else {
      // 轻点：给一次明显较弱但确实存在的回应
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
    this.updateMicroBehaviors(dtMs);

    // ── ③ 决策节流 ──
    // 狗不是每帧都在"思考"。decisionIntervalMs 越大，思考越慢。
    //
    // ★ Milestone 2 例外：正在被抚摸 / 正在互动时**跳过节流**。
    //   否则反应慢的犬种（决策间隔 900ms）会让玩家觉得"它没反应"，
    //   而抚摸是玩家最直接的输入，必须立刻被感知到。
    //   这体现"反应慢"与"不理我"的区别 —— 后者是 bug，不是性格。
    //
    // ★ Alpha 打磨：决策间隔本身随机化（保持均值不变）。
    //
    //   固定间隔会把所有状态时长钉在一个网格上（如 swift 的 267ms 倍数），
    //   实测 Sit 每次恰好 1067ms、标准差 0.000 —— 精确得像节拍器。
    //   根因不是行为逻辑，而是**决策时钟本身是等距的**：
    //   既然只可能在 k×间隔 的时刻切换，时长就只能是间隔的整数倍。
    //
    //   动物的"思考"不是等距的心跳。让每次间隔在
    //   [0.65×, 1.35×] 内随机（均值仍等于 decisionIntervalMs），
    //   网格被打散，时长出现自然分布。
    //
    //   随机幅度同样... 不受性格控制 —— 这是**生理性抖动**，
    //   不是性格表达。即便最"机械"的犬种，心跳也不是等距的。
    this.decisionAccumMs += dtMs;
    const urgent = this.blackboard['beingPetted'] === true || this.interaction.isPetting;

    if (this.nextDecisionAtMs <= 0) {
      this.nextDecisionAtMs = this.rollDecisionInterval();
    }

    const canDecide =
      urgent || (this.decisionAccumMs >= this.nextDecisionAtMs && this.reactionDelayRemainingMs <= 0);

    if (canDecide) {
      this.decisionAccumMs = 0;
      this.nextDecisionAtMs = this.rollDecisionInterval();
    }

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

    // ★ 一次决策，结果复用。
    //
    //   踩过的坑：早期版本先调 fsm.update()（内部会 decide() 一次），
    //   再单独调 fsm.decide() 拿打分表发调试事件 ——
    //   也就是**每个决策周期裁决两次**。
    //
    //   在引入活体噪声（随机抖动）之后，这个缺陷从"浪费"升级成"错误"：
    //   第二次调用会再次消耗 RNG，于是调试面板看到的分数
    //   与实际生效的决策并不一致 —— 面板说"它选了 Walk"，
    //   而狗其实走了 Sit。排查行为问题时这会造成严重误导。
    //
    //   现在改为：先自行裁决拿到完整结果，再把它交给状态机执行。
    //   决策与展示用同一份数据。
    //
    // ★ 顺序（Alpha 打磨修正）：
    //     ① fsm.update(ctx)       —— 累加本帧时间、跑状态自身逻辑
    //     ② fsm.decide(ctx)       —— 用**本帧已更新**的 stateElapsedMs 裁决
    //     ③ fsm.applyDecision()   —— 执行裁决
    //
    //   早期写法把 ② 放在 ① 之前，导致裁决读到上一帧的停留时长，
    //   使 minDwellMs 之类的下限判断整体滞后一帧（实测"设了 900ms
    //   却在 250ms 就切走"）。
    this.fsm.update(ctx);
    const decision = ctx.allowDecision ? this.fsm.decide(ctx) : null;

    if (decision) {
      this.blackboard['__lastDecision'] = decision;
    }

    this.fsm.applyDecision(ctx, decision);
    const after: StateId = this.fsm.current ?? 'Idle';

    if (before !== after) {
      this.scheduleReaction();
      this.animation.requestState(after);
      this.onStateChanged(after);
    }

    // 发出完整打分表 —— 调试"为什么它这样动"的关键
    if (decision) {
      this.bus.emit('state:decision', {
        chosen: decision.chosen,
        scores: decision.scores,
        tick: this.tick,
      });
    }

    // ★ justPetted 脉冲必须在**被一次裁决消费之后**才清除。
    //
    //   踩过的坑：早期版本每帧无条件清除它。但抚摸发生在 update() 之外
    //   （浏览器里是 pointer 回调，测试里是 harness 调用），
    //   于是脉冲在下一帧就被抹掉，裁决可能根本没看到它 ——
    //   表现是"摸了很多次，狗却一直停在最低级的 LookAt"。
    //
    //   正确做法：只在真正做过裁决的那一帧清除。
    //   若决策被节流跳过，脉冲保留到下一次裁决，保证"摸了一定会被感知"。
    if (decision) {
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
    //
    // ★ Alpha 打磨：叠加微行为修饰。
    //   微行为不接管动画，只**修饰**基础过程动画 ——
    //   因此呼吸、眨眼等生命体征在任何时候都不中断，
    //   而抖耳、哈欠、伸懒腰只是短暂地放大或偏移某些参数。
    const moodMods = this.mood.modifiers();
    const microFx = this.micro.effect();

    const proceduralCtx: ProceduralContext = {
      moving: this.blackboard.moving,
      speedRatio,
      arousal: moodMods.arousal,
      alertness: this.computeAlertness(),
      // 微行为修饰（缺省时不影响任何表现）
      earJitterScale: microFx.earJitterScale,
      extraEyeClosure: microFx.eyeClosure,
      bodyStretchScale: microFx.bodyStretchScale,
      extraHeadDropPx: microFx.headDropPx,
      extraOffsetY: microFx.offsetY,
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

    // ③ 抚摸的羁绊结算**不在这里** ——
    //   它在 pointerUp() 里发生，因为只有抬手时才知道完整的按住时长。
    //   这里只维护"是否正在被抚摸"这一状态，供状态机即时响应。
    //
    //   （早期版本在这里按帧结算，导致两个问题：
    //     按住时长被切成多次抚摸而虚增羁绊；
    //     或有效性在刚越过阈值时被截断。详见 pointerUp 的说明。）

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
   * 推进微行为。
   *
   * ★ 微行为**只在狗安静地待着时**才允许触发。
   *
   *   理由：微行为表达的是"它自己的小动作"，
   *   而在被抚摸、正在回应玩家、或刚被惊醒时，
   *   它的注意力在玩家身上 —— 此时插入打哈欠会显得心不在焉，
   *   反而破坏"它在回应我"的感受。
   *
   *   允许触发的时机：
   *     - 当前处于 Idle / Sit / Sleep 这类静止状态
   *     - 没有被抚摸、没有互动进行中
   *     - 不处于烦躁状态（烦躁时它忙着不高兴，不打哈欠）
   */
  private updateMicroBehaviors(dtMs: number): void {
    const bb = this.blackboard;

    const st = this.currentState;
    const isQuietState = st === 'Idle' || st === 'Sit' || st === 'Sleep';
    const busyInteracting = bb['beingPetted'] === true || bb['enjoying'] === true;
    const annoyed = this.mood.isAnnoyed;

    const allowed = isQuietState && !busyInteracting && !annoyed && !this.isSulking;

    if (!allowed) {
      // 玩家一介入就立刻中断当前微行为，避免"摸它时它还在打哈欠"
      this.micro.interrupt();
    }

    this.micro.update(dtMs, allowed, (expr) => this.evalMicroCondition(expr));
  }

  /**
   * 求值微行为的 `when` 条件表达式。
   *
   * ★ 刻意实现为一个**极小的白名单求值器**，而不是 eval / new Function。
   *
   *   原因：`when` 来自 species 的 JSON 文件。
   *   将来犬种会由社区贡献，用 eval 执行任意 JSON 字符串等于
   *   把远程代码执行漏洞直接嵌进引擎。
   *   白名单求值器只认识少量变量与比较运算符，
   *   写错只会得到 false，不会执行任何代码。
   *
   * 支持的形式（刻意保持极简）：
   *   "energy < 0.4"
   *   "mood.arousal > 0.3"
   *   "justWokeUp"
   *   "isNight"
   *
   * 不支持逻辑运算（&&/||）—— 需要时再扩展，
   * 过早引入表达式语言会变成一个小的编程语言项目。
   */
  private evalMicroCondition(expr: string): boolean {
    const trimmed = expr.trim();

    // 无运算符：当作布尔标志
    const cmp = /^([\w.]+)\s*(<=|>=|<|>|===|==)\s*(-?[\d.]+)$/.exec(trimmed);
    if (!cmp) {
      const flag = this.microFlags[trimmed];
      return flag === true;
    }

    const [, lhs, op, rhsRaw] = cmp;
    const rhs = Number.parseFloat(rhsRaw!);
    const value = this.microVariable(lhs!);
    if (value === null) return false;

    switch (op) {
      case '<':
        return value < rhs;
      case '<=':
        return value <= rhs;
      case '>':
        return value > rhs;
      case '>=':
        return value >= rhs;
      default:
        return value === rhs;
    }
  }

  /** 微行为条件可读取的变量 */
  private microVariable(name: string): number | null {
    const mood = this.mood.snapshot();
    const t = this.species.personality.temperament;

    switch (name) {
      case 'energy':
        // "精力"在 Milestone 4 接入真实需求前，用性格维度代替
        return t.energy;
      case 'mood.arousal':
        return mood.arousal;
      case 'mood.valence':
        return mood.valence;
      case 'mood.annoyance':
        return mood.annoyance;
      case 'mood.comfort':
        return mood.comfort;
      case 'bond':
        return this.bond.value;
      default:
        return null;
    }
  }

  /** 微行为条件可读取的布尔标志 */
  private get microFlags(): Record<string, boolean> {
    return {
      justWokeUp: this.blackboard['justWokeUp'] === true,
      isMoving: this.blackboard.moving === true,
      isSleeping: this.currentState === 'Sleep',
    };
  }

  /**
   * 状态切换后的副作用。
   *
   * 主要是"走开"这个行为需要设置闹别扭冷却 ——
   * 否则狗会在走开与回来之间高频抖动，看起来像故障。
   */
  private onStateChanged(state: StateId): void {
    const bb = this.blackboard;

    // ★ 记录"刚睡醒"标志 —— 供 microBehaviors 的 when 条件使用。
    //
    //   为什么需要这个标志：伸懒腰（stretch）只在刚睡醒时出现。
    //   没有它，stretch 的 when 永远为 false，实测触发 0 次 ——
    //   配置里声明了却永远不发生，属于"死数据"。
    const prev = this.previousState;
    if (prev === 'Sleep' && state !== 'Sleep') {
      bb['justWokeUp'] = true;
    } else if (state === 'Sleep') {
      bb['justWokeUp'] = false;
    }

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

    this.previousState = state;
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
    // 状态切换后重抽决策节拍，避免"切换时刻"与"决策时刻"锁相
    this.nextDecisionAtMs = this.rollDecisionInterval();
  }

  /**
   * 抽一次决策间隔。
   *
   * 在 [0.65, 1.35] × decisionIntervalMs 内均匀随机，均值 = decisionIntervalMs。
   *
   * ★ 这是"生理性抖动"，不是性格表达，因此**不受 randomness 维度控制**：
   *   真实动物的注意力节律本就不是等距的，
   *   即便训练最有素的狗，也不可能每隔恰好 500ms 思考一次。
   *   若把它交给性格控制，等于允许"机械的狗"存在 —— 那不叫性格，叫 bug。
   */
  private rollDecisionInterval(): number {
    const base = this.species.cognition.decisionIntervalMs;
    return base * this.rng.range(0.65, 1.35);
  }

  /**
   * 把狗约束在可视范围内（含灰盒半宽/半高）。
   *
   * ★ 同时把可行走区域写进黑板。
   *
   *   为什么必须公开这个区域：
   *     pickWanderTarget() 需要知道"哪里能站"，
   *     否则会选出墙外的目标点，导致狗永远走不到、卡死在 Walk 状态
   *     （实测卡死 162 秒）。详见 pickWanderTarget 的注释。
   *
   *   把边界放在这里计算而不是让状态自己算，
   *   保证"选点"与"夹取"用的是同一套边界 —— 两处各算一次必然漂移。
   */
  private clampToBounds(): void {
    const size = resolveGrayboxSize(this.species);
    const halfW = size.w / 2;
    const halfH = size.h / 2;
    const bb = this.blackboard;

    const minX = halfW;
    const maxX = this.bounds.w - halfW;
    const minY = halfH;
    const maxY = this.bounds.h - halfH;

    if (bb.x < minX) bb.x = minX;
    if (bb.x > maxX) bb.x = maxX;
    if (bb.y < minY) bb.y = minY;
    if (bb.y > maxY) bb.y = maxY;

    // 供 pickWanderTarget 使用的可行走区域
    bb['walkableBounds'] = { minX, maxX, minY, maxY };
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
