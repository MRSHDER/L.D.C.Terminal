/**
 * L.D.C. — 通用层级状态机（HFSM）
 *
 * 为什么是层级而非扁平：
 *   扁平 FSM 在 4 犬种 × 12 状态时组合爆炸。层级让「共性」住父状态、「个性」住参数。
 *   例：Active 子树可整体挂起（切到 Asleep），无需为每个子状态写退出逻辑。
 *
 * ★ 本文件不含任何犬种专属内容。
 *   状态是通用的（Idle/Walk/...），性格通过「打分乘子」注入，
 *   打分数值全部来自 species/behaviors JSON。
 */

import type { EventBus } from '../event/EventBus';
import type { StateId } from '../event/events';
import type { Rng } from '../world/Rng';
import type { SpeciesData, BehaviorsData } from '../data/types';

/** 状态更新上下文。所有状态只通过它访问世界 */
export interface StateContext {
  readonly dtSec: number;
  readonly dtMs: number;
  readonly tick: number;
  readonly elapsedMs: number;
  readonly species: SpeciesData;
  readonly behaviors: BehaviorsData;
  readonly rng: Rng;
  readonly bus: EventBus;
  /** 可变的共享黑板。Phase 0/1 用于位置与朝向，后续阶段承载情绪/需求 */
  readonly blackboard: Blackboard;
  /**
   * 本帧是否允许做「全局效用裁决」。
   *
   * 物理（状态 onUpdate）始终每帧执行，保证移动平滑；
   * 但裁决按 cognition.decisionIntervalMs 节流 —— 这就是
   * 「伯恩山思考慢、边牧反应快」在引擎层面的落地方式。
   *
   * 缺省 true（便于单元测试与外部调用者不传）。
   */
  allowDecision?: boolean;

  /**
   * 当前状态 id（由 StateMachine 在每次更新前写入）。
   *
   * 为什么放在 ctx 里而不是让守卫自己查：
   *   守卫函数是纯函数 `(ctx) => boolean`，拿不到 StateMachine 实例。
   *   把当前状态显式暴露出来，守卫就能表达
   *   「如果我在 Walk 且还没走完，就不许切到 X」这类跨状态条件，
   *   而不需要把状态机引用泄露给数据层。
   */
  fsmCurrent?: StateId;
}

/**
 * 黑板：跨状态共享的可变数据。
 * 刻意做成显式的单一对象，而不是把字段散在状态里 —— 便于序列化存档与调试快照。
 */
export interface Blackboard {
  /** 世界坐标 */
  x: number;
  y: number;
  /** 朝向：角度（度），0 = 右 */
  facingDeg: number;
  /** 当前速度（像素/秒），由状态写入、渲染读取 */
  speedPxPerSec: number;
  /** 是否正在移动（供动画层判断） */
  moving: boolean;
  /** 本状态已持续毫秒 */
  stateElapsedMs: number;
  /** 空闲漫游目标点 */
  wanderTargetX: number;
  wanderTargetY: number;
  hasWanderTarget: boolean;
  /** 任意扩展数据，供后续阶段使用（情绪、需求引用等） */
  [key: string]: unknown;
}

export function createBlackboard(spawnX: number, spawnY: number): Blackboard {
  return {
    x: spawnX,
    y: spawnY,
    facingDeg: 0,
    speedPxPerSec: 0,
    moving: false,
    stateElapsedMs: 0,
    wanderTargetX: spawnX,
    wanderTargetY: spawnY,
    hasWanderTarget: false,
  };
}

/** 状态接口。生命周期三件套，全部可选。 */
export interface State {
  readonly id: StateId;
  /** 声明该状态在动画系统里对应的 clip 名，缺省用 id */
  readonly animationTag?: string;
  /**
   * 进入状态。from 为 null 表示首次进入。
   * 只做「一次性」工作：设定黑板初值、发事件。不要在此启动计时器 —— 用 stateElapsedMs。
   */
  onEnter?(ctx: StateContext, from: StateId | null): void;
  /**
   * 每逻辑帧调用。
   * 返回 StateId 表示请求立即迁移；返回 null 表示保持。
   * ★ 状态自身不做权重判断 —— 权重由 decideNext() 统一裁决。
   *   状态只处理「物理推进」和「完成条件」。
   */
  onUpdate?(ctx: StateContext): StateId | null;
  onExit?(ctx: StateContext, to: StateId): void;
}

/** 打分函数。返回 0 表示该迁移不可用。 */
export type ScoreFn = (ctx: StateContext) => number;

/** 硬门槛。返回 false 则该迁移永不触发，无论分数多高。 */
export type GuardFn = (ctx: StateContext) => boolean;

export interface Transition {
  readonly from: StateId | '*';
  readonly to: StateId;
  /** 层1：硬门槛 */
  readonly guard?: GuardFn;
  /** 层2：效用分数（性格在此生效） */
  readonly score: ScoreFn;
  /** 层3：节流 —— 冷却与迟滞，防止抖动 */
  readonly cooldownMs?: number;
  /** 同分裁决，大者优先 */
  readonly priority?: number;
}

export interface TransitionRecord {
  readonly from: StateId;
  readonly to: StateId;
  readonly lastFiredTick: number;
  readonly cooldownMs: number;
}

export interface DecisionResult {
  readonly chosen: StateId;
  readonly scores: Readonly<Record<StateId, number>>;
  readonly reason: string;
}

export interface StateMachineOptions {
  /** 允许的迁移。from 支持 '*' 通配 */
  readonly transitions: readonly Transition[];
  /** 全局最小停留时长（ms）：状态切换后多久内不允许再切换 */
  readonly minStateDurationMs?: number;
  /**
   * ★ 准入守卫：状态 id → 「现在能否进入该状态」。
   *
   * 与 Transition.guard 的区别：
   *   Transition.guard  只作用于某一条迁移（from → to）
   *   准入守卫          作用于「进入该状态」这件事本身，无论路径
   *
   * 为什么必须有它：
   *   状态基础偏好（stateWeights）会让状态绕过所有迁移守卫成为候选。
   *   没有准入守卫时，给 Walk→Idle 加 guard 也没用 ——
   *   Idle 会从偏好通道直接进来，导致"走了 0.5 秒就被拉回"。
   *
   * 准入守卫是「状态语义」的一部分，因此集中在状态机层面声明，
   * 而不是在每个迁移里重复书写。
   */
  readonly admissionGuards?: Readonly<Record<StateId, GuardFn>>;
  /** 日志开关 */
  readonly debug?: boolean;
}

export class StateMachine {
  private readonly states = new Map<StateId, State>();
  private readonly transitions: readonly Transition[];
  private readonly admissionGuards: ReadonlyMap<StateId, GuardFn>;
  private readonly records: TransitionRecord[] = [];
  private readonly minStateDurationMs: number;
  private readonly debug: boolean;

  private currentId: StateId | null = null;
  private elapsedMs = 0;

  constructor(options: StateMachineOptions) {
    this.transitions = options.transitions;
    this.minStateDurationMs = options.minStateDurationMs ?? 0;
    this.debug = options.debug ?? false;
    this.admissionGuards = new Map(Object.entries(options.admissionGuards ?? {}));

    // 为带冷却的迁移建立记录表
    for (const t of this.transitions) {
      if (t.cooldownMs && t.cooldownMs > 0) {
        this.records.push({
          from: t.from,
          to: t.to,
          lastFiredTick: -Infinity,
          cooldownMs: t.cooldownMs,
        });
      }
    }
  }

  addState(state: State): this {
    if (this.states.has(state.id)) {
      throw new Error(`[StateMachine] 状态重复注册: ${state.id}`);
    }
    this.states.set(state.id, state);
    return this;
  }

  addStates(...states: readonly State[]): this {
    for (const s of states) this.addState(s);
    return this;
  }

  get current(): StateId | null {
    return this.currentId;
  }

  get stateElapsedMs(): number {
    return this.elapsedMs;
  }

  hasState(id: StateId): boolean {
    return this.states.has(id);
  }

  listStates(): readonly StateId[] {
    return [...this.states.keys()];
  }

  /** 强制切换到某状态（跳过打分）。用于初始化与调试。 */
  forceState(id: StateId, ctx: StateContext, reason = 'forced'): void {
    this.transitionTo(id, ctx, reason);
  }

  /**
   * 主更新入口。
   * 流程：① 状态自身 onUpdate（物理推进 / 完成条件）
   *       ② 若未请求迁移，则做一次效用裁决
   *
   * ★ 关于 minStateDurationMs：
   *   它是「最小停留时长」护栏，对**所有**迁移生效（包括状态自请求的）。
   *   早期版本只拦住裁决路径，导致 WalkState 一到达就立刻切回 Idle，
   *   产生 0.5 秒级的乒乓振荡。现在统一在入口处判定 —— 物理照常推进，
   *   但切换被推迟到护栏解除之后。
   */
  update(ctx: StateContext): void {
    if (this.currentId === null) {
      throw new Error('[StateMachine] 未初始化：请先调用 forceState() 或 start()');
    }

    this.elapsedMs += ctx.dtMs;
    ctx.blackboard.stateElapsedMs = this.elapsedMs;

    const current = this.states.get(this.currentId);
    if (!current) throw new Error(`[StateMachine] 未知状态: ${this.currentId}`);

    // 把当前状态暴露给守卫/打分函数（见 StateContext.fsmCurrent 的说明）
    ctx.fsmCurrent = this.currentId;

    // ① 状态自身逻辑（物理必须每帧推进，不受护栏影响）
    const requested = current.onUpdate?.(ctx) ?? null;

    const withinMinDuration = this.elapsedMs < this.minStateDurationMs;

    if (requested !== null && requested !== this.currentId) {
      if (!this.states.has(requested)) {
        if (this.debug) {
          console.warn(
            `[StateMachine] 状态 ${this.currentId} 请求了未注册的状态 ${requested}，已忽略`,
          );
        }
      } else if (!withinMinDuration) {
        this.transitionTo(requested, ctx, 'state-requested');
        return;
      }
      // 护栏期内：物理已推进，切换推迟到下一帧重试
    }

    // ② 全局裁决（按 cognition 节流；物理已在上面每帧推进）
    if (withinMinDuration) return;
    if (ctx.allowDecision === false) return;

    const decision = this.decide(ctx);
    if (decision.chosen !== this.currentId) {
      this.transitionTo(decision.chosen, ctx, decision.reason, decision.scores);
    }
  }

  /**
   * ★ 效用裁决 —— 性格注入点
   *
   * 重要：这里有两个容易搞错的地方（都曾经踩过坑，记录下来）。
   *
   * ── 坑 1：stateWeights 不是「切换效用」 ──
   * stateWeights 描述的是「这只狗待在 X 状态的意愿」，不是「切到 X 的效用」。
   * 如果直接把它当效用相加，会产生必然的乒乓振荡：
   *   Idle 权重 40 > Walk 效用 30  → 切到 Idle
   *   下一轮 Walk 又是唯一候选     → 切回 Walk
   *   无限循环，且 Sit / Sleep 永远没机会。
   *
   * 正确做法：把 stateWeights 归一化成「基础概率」，再与迁移效用相乘：
   *     最终分 = 归一化基础偏好 × (1 + 迁移效用 / 参考尺度)
   *
   * ── 坑 2（更隐蔽）：偏好会绕过守卫 ──
   * 即使给 `Walk → Idle` 加了 guard，Idle 仍能通过「Idle 的基础偏好」
   * 直接成为候选，于是 guard 形同虚设 —— 狗走了 0.5 秒就被拉回 Idle。
   *
   * 修复：为每个状态声明一个 **准入守卫（admission guard）**。
   * 只有通过准入的状态才能作为切换目标，无论它来自迁移表还是基础偏好。
   * 这是「有完成条件的行为不允许被权重系统打断」的通用保障。
   *
   * 准入守卫由 StateMachine 的 admissionGuards 选项提供，
   * 因为它是「状态语义」的一部分，而不该散落在每个迁移里重复书写。
   */
  decide(ctx: StateContext): DecisionResult {
    const rawScores: Record<StateId, number> = {};
    const from = this.currentId!;

    // ── a) 迁移效用：累积到候选表 ──
    for (const t of this.transitions) {
      if (t.from !== '*' && t.from !== from) continue;
      if (t.to === from) continue;
      if (!this.states.has(t.to)) continue;

      if (t.guard && !t.guard(ctx)) continue;

      // 冷却检查：用逻辑帧换算，避免依赖挂钟
      const rec = this.records.find(
        (r) => r.to === t.to && (r.from === from || r.from === '*'),
      );
      if (rec && rec.cooldownMs > 0) {
        const elapsedMs = (ctx.tick - rec.lastFiredTick) * ctx.dtMs;
        if (elapsedMs < rec.cooldownMs) continue;
      }

      const s = t.score(ctx);
      if (!Number.isFinite(s) || s <= 0) continue;
      rawScores[t.to] = (rawScores[t.to] ?? 0) + s + (t.priority ?? 0);
    }

    // ── b) 状态偏好：归一化基础权重 × 性格乘子 ──
    const preferences = computeStatePreferences(ctx);

    // ── c) 合成最终分（★ 先过准入守卫）──
    const scores: Record<StateId, number> = {};
    for (const [id, pref] of Object.entries(preferences)) {
      if (id === from) continue;
      if (!this.states.has(id)) continue;

      // 准入守卫：拦截「不该被打断的行为」与「不该被进入的状态」
      const admission = this.admissionGuards.get(id);
      if (admission && !admission(ctx)) continue;

      const utility = rawScores[id] ?? 0;
      scores[id] = pref * (1 + utility / PREFERENCE_REFERENCE_SCALE);
    }

    // 也检查只出现在迁移表、但没写进 stateWeights 的状态
    for (const [id, utility] of Object.entries(rawScores)) {
      if (id in scores) continue;
      if (id === from) continue;
      if (!this.states.has(id)) continue;

      const admission = this.admissionGuards.get(id);
      if (admission && !admission(ctx)) continue;

      // 未在 stateWeights 中声明偏好的状态：给一个保守的默认偏好，
      // 使其可达但不至于压制显式声明的状态。
      scores[id] = DEFAULT_UNLISTED_PREFERENCE * (1 + utility / PREFERENCE_REFERENCE_SCALE);
    }

    // 只保留有意义的候选
    for (const key of Object.keys(scores)) {
      if ((scores[key] ?? 0) <= 0) delete scores[key];
    }

    // ── d) 裁决：效用门槛 ──
    //
    // 门槛只比较「效用」，不掺入份额 —— 理由见 UTILITY_THRESHOLD 的推导。
    // 份额已通过 scores 的乘子影响选谁；门槛回答的是"现在有多想做"。
    let chosen: StateId = from;
    let bestUtility = -Infinity;
    for (const [id, utility] of Object.entries(rawScores)) {
      if (!(id in scores)) continue; // 未通过守卫或已被过滤
      if (utility > bestUtility) {
        bestUtility = utility;
        chosen = id;
      }
    }

    if (chosen === from || bestUtility < UTILITY_THRESHOLD) {
      return { chosen: from, scores, reason: 'stay' };
    }

    return {
      chosen,
      scores,
      reason: `utility:${chosen}=${bestUtility.toFixed(1)}>${UTILITY_THRESHOLD}`,
    };
  }

  private transitionTo(
    id: StateId,
    ctx: StateContext,
    reason: string,
    scores?: Readonly<Record<StateId, number>>,
  ): void {
    const next = this.states.get(id);
    if (!next) throw new Error(`[StateMachine] 目标状态未注册: ${id}`);

    const prevId = this.currentId;
    const prev = prevId !== null ? this.states.get(prevId) : undefined;

    prev?.onExit?.(ctx, id);

    this.currentId = id;
    this.elapsedMs = 0;
    ctx.blackboard.stateElapsedMs = 0;

    // 应用冷却
    for (const rec of this.records) {
      if (rec.to !== id) continue;
      if (prevId !== null && rec.from !== prevId && rec.from !== '*') continue;
      (rec as { lastFiredTick: number }).lastFiredTick = ctx.tick;
    }

    next.onEnter?.(ctx, prevId);

    ctx.bus.emit('state:enter', { from: prevId, to: id, reason });
    if (prevId !== null) {
      ctx.bus.emit('state:exit', { from: prevId, to: id });
    }

    if (this.debug) {
      console.debug(`[FSM] ${prevId ?? '∅'} → ${id}  (${reason})`, scores ?? '');
    }
  }
}

/**
 * 迁移效用的参考尺度。
 *
 * utility 除以该值后再作为「加成」使用：
 *   utility = 0    → 加成 0%   （仅靠基础偏好）
 *   utility = 30   → 加成 100%（偏好翻倍）
 *   utility = 90   → 加成 300%
 *
 * 取 30 是因为 transitions.ts 里各迁移的典型分值就在 10~30 区间。
 * 调整此值会整体改变「性格偏好」与「瞬时倾向」的相对权重。
 */
const PREFERENCE_REFERENCE_SCALE = 30;

/**
 * 决策门槛标定（最终方案 —— 四版失败记录全部保留，这是整个 FSM 最难的部分）
 *
 * ── 数据事实 ──
 * preferences 是"份额"（总和为 1）：
 *   Idle=0.430  Walk=0.269  Sit=0.194  Sleep=0.108
 * 竞争者分数 = preference × (1 + utility / PREFERENCE_REFERENCE_SCALE)
 * 效用极大时系数趋近 ∞，但**实际可达到的效用有上限**：
 *   Idle→Walk 峰值 36，Idle→Sit 峰值 58
 * 因此竞争者实际天花板约为 preference × 2。
 *
 * ── 失败方案回顾（每条都是真实调过的数值）──
 * A. `stay × 0.35`   门槛 0.15  → 任何微扰都切走，Idle 仅 0.5 秒
 * B. `stay × 1.6`    门槛 0.69  → 超过天花板 0.54，永远不动
 * C. 绝对门槛 0.30              → Idle 偏好 0.43 本身即达标，
 *                                 从任何状态都立刻切回 Idle，Sit 只活 0.5 秒
 * D. `stay × 1.25`   门槛 0.538 → 超过天花板，永远不动
 *
 * ── 根因诊断 ──
 * 竞争者分数与"维持现状"分数处在**不同尺度**上：
 *   竞争者 = 份额 × (1 + 效用/30)，系数范围 1~2
 *   维持现状 = 份额 × 1（若直接用份额）
 * 由于 Idle 份额（0.43）远大于其他份额（0.11~0.27），
 * 只要门槛与份额同尺度，Idle 就会在两个极端之间摆动 —— 无解。
 *
 * ── 正确解法：把门槛建在"效用尺度"上，而不是"份额尺度"上 ──
 *
 * 关键洞察：**份额不该参与门槛计算**。份额已经通过 scores 影响选择了；
 * 门槛只应回答"这个行为现在有多想做"，那是**效用**的问题。
 *
 * 因此门槛只比较效用（与当前状态偏好无关）：
 *
 *     切换条件： utility[to] > UTILITY_THRESHOLD
 *
 * 灰盒代入（UTILITY_THRESHOLD = 26）：
 *   Idle→Walk  峰值 36  → 需 patience ≈ 0.72（约 2.9s）✓
 *   Idle→Sit   峰值 58  → 需 patience ≈ 0.45（约 1.2s）✓ 更早胜出
 *   Sit→Walk   峰值 38  → 需 patience ≈ 0.68（约 3.4s）✓
 *   Sit→Idle   峰值 30  → 需 patience ≈ 0.87（约 4.4s）✓
 *   Walk→Idle  峰值 34（守卫已保证走完）✓
 *   Sleep→Idle 峰值 55  → ✓
 *
 * 这样每个迁移有**明确、独立、可预测**的触发点，
 * 且与"当前在哪个状态"解耦 —— 彻底消除两种极端。
 *
 * 数值含义：门槛越高 → 狗越"沉稳"，做任何事都需要更长时间酝酿。
 * 它天然适合作为犬种可调参数（未来放进 cognition）。
 */
const UTILITY_THRESHOLD = 26;

/**
 * 未在 stateWeights 中声明偏好的状态的默认偏好。
 *
 * 取所有显式声明状态平均偏好的一个保守比例，
 * 让「有迁移效用但没写权重」的状态仍然可达，但不会喧宾夺主。
 */
const DEFAULT_UNLISTED_PREFERENCE = 0.04;

/**
 * 计算「状态偏好」表。
 *
 * 公式：
 *   multiplier = 1 + (temperament - 0.5) * sensitivity * 2
 *   偏好 = 归一化基础权重 × 全部敏感度乘子之积
 *
 * 归一化让 stateWeights 的绝对值不再重要，只有相对比例重要 ——
 * 这让贡献者可以自由地写 "Idle: 40, Walk: 25" 或 "Idle: 4, Walk: 2.5"，
 * 行为完全一致，降低心智负担。
 *
 * ★ 本函数读取 behaviors/species 数据，不含任何犬种字面量。
 */
export function computeStatePreferences(ctx: StateContext): Record<StateId, number> {
  const { stateWeights, personalityBias } = ctx.behaviors;
  const temperament = ctx.species.personality.temperament;

  const ids = Object.keys(stateWeights);
  const total = ids.reduce((sum, id) => sum + (stateWeights[id] ?? 0), 0);
  if (total <= 0) return {};

  const out: Record<StateId, number> = {};

  for (const stateId of ids) {
    const baseWeight = stateWeights[stateId] ?? 0;
    if (baseWeight <= 0) continue;

    let multiplier = 1;

    const bias = personalityBias[stateId];
    if (bias) {
      for (const [key, entry] of Object.entries(bias)) {
        if (!entry) continue;
        const value = temperament[key as keyof typeof temperament];
        if (typeof value !== 'number') continue;
        multiplier *= 1 + (value - 0.5) * entry.sensitivity * 2;
      }
    }

    // 乘子下限保护：避免负敏感度叠加后变成 0 或负数
    multiplier = Math.max(0.02, multiplier);

    out[stateId] = (baseWeight / total) * multiplier;
  }

  return out;
}

/** @deprecated 保留旧名以兼容外部引用，语义已变更为「偏好」而非「加权分」 */
export const computeStateBiases = computeStatePreferences;
