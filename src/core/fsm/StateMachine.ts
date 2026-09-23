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
  /**
   * ★ 本迁移生效前，当前状态至少要持续多久（ms）。
   *
   * 与 cooldownMs 的区别：
   *   cooldownMs —— 该迁移**上次触发后**要等多久才能再次触发
   *   minDwellMs —— 进入来源状态后，要等多久才允许本迁移触发
   *
   * 为什么需要它（Alpha 打磨中的关键修正）：
   *   有些迁移的分值极高（swift 的 Sit→Walk = 3.0，是门槛的 10 倍），
   *   会在**第一个决策刻度**就触发 —— 意味着来源状态根本没有"活过"。
   *   实测 swift 的 Sit 每次恰好 267ms（标准差 0.000），
   *   就是一个"刚坐下就被拽起来"的状态，玩家看不到它坐下。
   *
   *   这违背了动画与行为的直觉：
   *     "坐下"是一个动作，它需要时间完成，不能瞬间切走。
   *   minDwellMs 让行为有**最低完成时长**，
   *   是"行为"与"瞬时状态跳变"的分界。
   *
   * 注意它作用于**当前状态**而非目标状态：
   *   表达的是"我在这个状态待够了吗"，语义清晰。
   */
  readonly minDwellMs?: number;
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
  /**
   * ★ 响应态集合：以「对玩家的响应」为语义、不走偏好份额的状态。
   *
   * 若未提供则为空集（所有状态都走偏好份额，即旧行为）。
   * 由 World 从互动迁移表推导后传入，
   * 从而让 core 保持对具体状态名的无知 ——
   * 未来新增互动状态时只需改 fsm/ 层，不必动 StateMachine。
   */
  readonly responseStates?: readonly StateId[];
  /**
   * ★ 休止态 id（通常是 'Idle'）。
   *
   * 休止态是"其他事都不想做"时的兜底状态，不是"想做的事"。
   * 若把它与 Walk/Sit 同台竞争，它会因为高偏好份额而永远胜出，
   * 导致狗被高频拉回站立（实测：Idle 占 61% 时间、
   * 其他行为来不及累积时长，连睡觉都不可能）。
   *
   * 传入本字段后，该状态的分数会被打 REST_STATE_DISCOUNT 折扣，
   * 使其成为"可退出的默认态"而非"支配态"。
   *
   * 不传则不打折（旧行为）。
   */
  readonly restStateId?: StateId;
  /** 日志开关 */
  readonly debug?: boolean;
}

export class StateMachine {
  private readonly states = new Map<StateId, State>();
  private readonly transitions: readonly Transition[];
  private readonly admissionGuards: ReadonlyMap<StateId, GuardFn>;
  private readonly responseStates: ReadonlySet<StateId>;
  private readonly records: TransitionRecord[] = [];
  private readonly minStateDurationMs: number;
  private readonly debug: boolean;
  private readonly restStateId: StateId | null;

  private currentId: StateId | null = null;
  private elapsedMs = 0;
  /**
   * 本次状态停留的随机化护栏（ms）。
   *
   * 每次进入状态时重抽，值 = minStateDurationMs × (1 + 0~0.66×weight×random)。
   * 用于打散"每次停留时长完全相同"的机械感 ——
   * 详见 transitionTo 中的说明。
   */
  private forcedStayMs = 0;

  constructor(options: StateMachineOptions) {
    this.transitions = options.transitions;
    this.minStateDurationMs = options.minStateDurationMs ?? 0;
    this.debug = options.debug ?? false;
    this.admissionGuards = new Map(Object.entries(options.admissionGuards ?? {}));
    this.responseStates = new Set(options.responseStates ?? []);
    this.restStateId = options.restStateId ?? null;
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
  /**
   * 主更新入口。
   *
   * @param ctx        状态上下文
   * @param precomputed 调用方**已经算好**的决策结果。
   *
   *   ★ 为什么允许外部传入决策：
   *     引入活体噪声（随机抖动）后，decide() 每次调用都会消耗 RNG 并
   *     产生不同结果。若 World 为了发调试事件再调一次 decide()，
   *     面板显示的就会是"另一次平行宇宙的决策"，与实际行为不一致。
   *     因此改为「调用方裁决一次 → 同一份结果既执行也展示」。
   *
   *     不传时（如单元测试直接调用）本方法自行裁决，行为与从前一致。
   */
  /**
   * 阶段一：推进本帧时间，运行状态自身逻辑。
   *
   * ★ 与 applyDecision() 拆开的原因（Alpha 打磨中的关键修正）：
   *
   *   World 需要「先裁决、再执行」以便把同一份决策同时用于展示与执行
   *   （避免裁决两次导致面板与实际不一致）。
   *   但裁决又必须读到**本帧已累加**的 stateElapsedMs ——
   *   否则所有基于停留时长的判断（patience 窗口、minDwellMs 下限）
   *   都会滞后一帧。
   *
   *   实测症状：设了 minDwellMs = 900，状态仍在 250ms 被切走 ——
   *   下限看似失效，实际是裁决时还没读到本帧的时间。
   *
   *   因此把 update 拆成两步：
   *     update(ctx)        —— 累加时间 + 跑状态逻辑（本帧时间就位）
   *     applyDecision(...) —— 执行裁决结果（迁移到目标状态）
   *
   *   状态自身请求的迁移（onUpdate 返回值）仍在本步内直接执行 ——
   *   它是"完成条件"，不参与效用裁决，语义上属于状态逻辑的一部分。
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

    // 状态自身逻辑（物理必须每帧推进，不受护栏影响）
    const requested = current.onUpdate?.(ctx) ?? null;

    if (requested !== null && requested !== this.currentId) {
      if (!this.states.has(requested)) {
        if (this.debug) {
          console.warn(
            `[StateMachine] 状态 ${this.currentId} 请求了未注册的状态 ${requested}，已忽略`,
          );
        }
      } else if (!this.isWithinGuardRail()) {
        this.transitionTo(requested, ctx, 'state-requested');
      }
      // 护栏期内：物理已推进，切换推迟到下一帧重试
    }
  }

  /**
   * 阶段二：执行裁决结果。
   *
   * @param decision 由 decide() 产出的决策；传入 null 表示本帧不做全局裁决
   *                 （被 cognition.decisionIntervalMs 节流）。
   */
  applyDecision(ctx: StateContext, decision: DecisionResult | null): void {
    if (this.currentId === null) return;
    if (ctx.allowDecision === false) return;
    if (!decision) return;
    if (this.isWithinGuardRail()) return;
    if (decision.chosen === this.currentId) return;

    this.transitionTo(decision.chosen, ctx, decision.reason, decision.scores);
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

      // ★ 最低停留时长：让"行为"有完成时间，而不是瞬间被切走。
      //   详见 Transition.minDwellMs 的说明。
      if (t.minDwellMs && ctx.blackboard.stateElapsedMs < t.minDwellMs) continue;

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
    //
    // ★★ 关键约束：只有**存在可用迁移**的状态才能成为候选 ★★
    //
    //   这是 Alpha 打磨中发现的架构性缺陷，也是多个"守卫失效"现象的
    //   共同根因。
    //
    //   旧实现遍历 `preferences`（即所有在 stateWeights 里声明过的状态），
    //   无条件给每个状态一个分数：
    //     scores[Walk] = pref[Walk] × (1 + utility/30)
    //   其中 utility 取 rawScores[Walk] ?? 0。
    //
    //   问题在于：当 Sit→Walk 被 minDwellMs 拦下、被冷却拦下、
    //   或被 guard 拦下时，rawScores[Walk] 确实是 0 ——
    //   但 Walk 仍会以 `pref × 1.0` 获得一个分数并参与竞争！
    //
    //   实测后果：swift 犬种设了 minDwellMs = 900，
    //     Sit 仍在 267ms 被切换走 —— 因为 Walk 靠"偏好份额"而非"迁移"
    //     获得了 0.27 分，加上噪声后越过门槛。
    //     minDwellMs 完全形同虚设。
    //
    //   概念修正：
    //     偏好份额回答"如果有机会，我多想做这件事"，
    //     迁移回答"现在有没有机会做这件事"。
    //     两者是与的关系 —— 没有机会，再高的偏好也不该成为候选。
    //
    //   因此候选集只包含 **rawScores 里真实存在的状态**（即通过了
    //   全部门槛、守卫、冷却的迁移目标）。偏好份额退化为权重系数，
    //   而不是入场券。
    const scores: Record<StateId, number> = {};

    // 响应态与常规态分开处理（原因见下方各自注释）
    const responseStates = this.responseStates;

    let hasAnyCandidate = false;

    for (const [id, utility] of Object.entries(rawScores)) {
      if (id === from) continue;
      if (!this.states.has(id)) continue;

      // 准入守卫：拦截「不该被打断的行为」与「不该被进入的状态」
      const admission = this.admissionGuards.get(id);
      if (admission && !admission(ctx)) continue;

      if (responseStates.has(id)) {
        // 响应态（互动状态）：不受偏好份额压制，以效用为主
        scores[id] = RESPONSE_BASE_SCORE * (1 + utility / PREFERENCE_REFERENCE_SCALE);
      } else {
        // 常规态：偏好份额 × 效用加成
        const pref = preferences[id] ?? DEFAULT_UNLISTED_PREFERENCE;
        scores[id] = pref * (1 + utility / PREFERENCE_REFERENCE_SCALE);
      }

      hasAnyCandidate = true;
    }

    void hasAnyCandidate;

    // ★★ 休止态折扣：Idle 不是"想做的事"，而是"没别的事可做" ★★
    //
    // Alpha 打磨中最关键的一处修正。
    //
    // 现象：修复随机性后，狗陷入 Idle↔Sit↔Idle↔Walk 的高频循环，
    //       每段仅 500~1000ms，Idle 占据 61% 的时间，且**从不睡觉**。
    //
    // 诊断（实测数据）：
    //   Idle 的偏好份额是 0.388，而它作为候选时的分数 = 0.388 × (1+0/30) = 0.388，
    //   这已经高于门槛 0.30 —— 意味着**从任何状态切回 Idle 都自动达标**。
    //   于是无论狗在做什么，下一帧就会被拉回 Idle，
    //   任何需要累积时间的行为（Sit→Sleep 需要 1500ms、
    //   *→Sleep 需要 9000ms）都永远等不到。
    //
    //   更本质的问题：把 Idle 放进 stateWeights 与 Walk/Sit **同台竞争**，
    //   在语义上就是错的。Idle 不是一个"想做的事"，
    //   而是"其他事都不想做"时的**兜底状态**。
    //   给它一个高份额，等于说"这只狗 39% 的意愿是站着不动"——荒谬。
    //
    // 修复：把 Idle 的分数**打折**，让它成为"可退出"的默认态，
    //   而不是"永远赢"的支配态。
    //
    //   折扣系数 0.45 的标定：
    //     Idle 分数 = 0.388 × 0.45 = 0.175 < 0.30  → 不再自动达标
    //     其他状态必须靠自己累积效用才能把狗从 Idle 拉走
    //     → 每次切换都需要"有理由"，而不是"惯性回 Idle"
    const idleId = this.restStateId;
    if (idleId && idleId in scores) {
      scores[idleId] = (scores[idleId] ?? 0) * REST_STATE_DISCOUNT;
    }

    // 只保留有意义的候选
    for (const key of Object.keys(scores)) {
      if ((scores[key] ?? 0) <= 0) delete scores[key];
    }

    // ── d) 裁决 ──
    //
    // ★★ Alpha 打磨：把「谁胜出」与「展示什么」统一为同一个量 ★★
    //
    // 诊断中发现的深层不一致：
    //   旧实现用 rawScores（纯效用）决定谁胜出，
    //   却把 scores（偏好×效用）用于展示与门槛比较。
    //   两者是**不同的量**：
    //     rawScores  的领先幅度中位数约 9.3 分（很大）
    //     scores     的领先幅度中位数约 0.056（极小）
    //   结果：
    //     - 对 rawScores 施加噪声需要 ±16 分才能改变排序
    //     - 而对 scores     施加同样的相对噪声，0.056 的差距轻易被翻转
    //
    //   更糟的是，调试面板显示 scores，玩家/开发者据此推断"它为什么这样动"，
    //   但真正决定行为的是另一个量 —— 面板在说谎。
    //
    // 现在统一：**用 scores（偏好 × 效用）决定胜出**，
    // 它同时是展示值、门槛比较值与排序依据。三者一致。
    //
    // 门槛的语义也随之明确：
    //   UTILITY_THRESHOLD 比较的是 scores。
    //   由于 scores 是"份额"(0.1~0.5) 量级，门槛需相应缩小 ——
    //   见 SCORE_THRESHOLD 的推导。
    const jitter = this.computeVitalityJitter(ctx);

    let chosen: StateId = from;
    let bestScore = -Infinity;
    for (const [id, score] of Object.entries(scores)) {
      // 权重抖动：与分数同量级的乘性噪声，用于打散排序
      const perturbed = score * (1 + jitter.weight * ctx.rng.range(-1, 1));
      if (perturbed > bestScore) {
        bestScore = perturbed;
        chosen = id;
      }
    }

    // 门槛抖动：只影响触发时机的细节（节奏微变）
    const threshold = SCORE_THRESHOLD * (1 + jitter.threshold * ctx.rng.range(-1, 1));

    if (chosen === from || bestScore < threshold) {
      return { chosen: from, scores, reason: 'stay' };
    }

    return {
      chosen,
      scores,
      reason: `utility:${chosen}=${bestScore.toFixed(2)}>${threshold.toFixed(2)}`,
    };
  }

  /**
   * 是否仍处于「护栏期」。
   *
   * 护栏 = 本次进入状态时抽定的随机化最短停留时长。
   * 它替代了原先固定的 minStateDurationMs，
   * 目的相同（防止状态闪烁）但每次时长不同（打破机械感）。
   */
  private isWithinGuardRail(): boolean {
    const rail = this.forcedStayMs > 0 ? this.forcedStayMs : this.minStateDurationMs;
    return this.elapsedMs < rail;
  }

  /**
   * 计算「活体噪声」的强度。
   *
   * ★ 为什么噪声强度要由性格决定，而不是写死一个常数：
   *
   *   如果所有犬种用同一个噪声量，那么"不可预测"就不再是性格特征 ——
   *   哈士奇的"不按套路"和柴犬的"高冷难测"会变成同一件事。
   *
   *   把强度绑定到 temperament.randomness，则：
   *     - 数值本身就是设计语言（0.35 = 恰到好处的生机）
   *     - 无需新增字段，已有的九维性格自然覆盖了这个表达面
   *     - 未来的犬种只需调这一个数，就能从"机械"变到"神经质"
   *
   * 幅度换算（randomness 0..1 → 抖动比例）：
   *   weight    抖动：0% ~ 55%   （与效用同量级，用于打散候选排序）
   *   threshold 抖动：0% ~ 22%   （只影响触发时机，制造节奏微变）
   *
   * ★ weight 抖动为什么必须这么大（55%）：
   *   实测切换时的"最佳效用 − 门槛"平均余量是 9.3 分，而典型效用约 30 分。
   *   要让噪声足以改变"谁胜出"，抖动幅度必须与效用同量级 ——
   *   30 × 55% ≈ ±16 分，才能覆盖 9.3 分的余量。
   *
   *   早期版本设成 30%（约 ±9 分），仍略小于余量，
   *   结果是"噪声生效了但从不改变结果"，序列依旧完全一致。
   *   这类"看起来接上了、实际毫无作用"的参数最容易被忽略，
   *   因此必须用实测余量来反推幅度，而不是凭感觉给一个"小随机数"。
   *
   * 上限约束：不超过 60%。再高会让行为退化成随机跳变，
   * 玩家感受从"它有自己的想法"变成"它坏掉了"。
   */
  private computeVitalityJitter(ctx: StateContext): { threshold: number; weight: number } {
    const randomness = ctx.species.personality.temperament.randomness;
    const r = Math.max(0, Math.min(1, randomness));

    // 额外随机性（behaviors.json 的 extraRandomness）叠加其上，
    // 让行为表也能在不动 species.json 的情况下微调
    const extra = Math.max(0, Math.min(1, ctx.behaviors.extraRandomness ?? 0));
    const total = Math.min(1, r + extra * 0.5);

    return {
      threshold: total * 0.22,
      weight: total * 0.55,
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

    // 状态进入序号 —— 供 patience() 判断"是否该重抽随机相位"。
    // 用单调递增的序号而非时间戳，语义明确且不会在边界误判。
    const serial = ((ctx.blackboard['__stateEntrySerial'] as number | undefined) ?? 0) + 1;
    ctx.blackboard['__stateEntrySerial'] = serial;

    // ★★ Alpha 打磨：随机化「最短停留时长」★★
    //
    // 这是"永远像时钟"问题的最后一层修复，也是最有效的一层。
    //
    // 前面的活体噪声作用于**分值**，但对分值差距很大的迁移无效 ——
    // 实测 swift 犬种：Walk 分数 3.6 而 Sit 0.26，噪声根本翻不动，
    // 于是它严格按 `Walk(1833ms) → Sit(367ms)` 循环，
    // 且 Sit 每次**恰好** 367ms（标准差 0ms）—— 比原版更机械。
    //
    // 根因：迁移的触发时刻由 patience() 决定，而 patience 是
    // 关于 stateElapsedMs 的**确定性函数**。同样的状态、
    // 同样的窗口，必然在同一毫秒触发。
    //
    // 修复：每次进入状态时抽一个随机的停留倍率，
    // 在基础护栏 minStateDurationMs 上叠加 0~60% 的随机延长。
    //   效果：同一个状态每次持续时长都不同，
    //   整体节奏产生"呼吸感"而不是节拍器。
    //
    // 强度同样受 randomness 维度控制 —— 训练有素的犬种可以很规整，
    // 散漫的犬种则每次都不一样。
    const jitterRange = this.computeVitalityJitter(ctx);
    const extraStay = this.minStateDurationMs * jitterRange.weight * ctx.rng.next() * 1.1;
    this.forcedStayMs = this.minStateDurationMs + extraStay;

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
 * 取 30 是因为 transitions.ts 里各迁移的典型分值就在 10~60 区间。
 * 调整此值会整体改变「性格偏好」与「瞬时倾向」的相对权重。
 */
const PREFERENCE_REFERENCE_SCALE = 30;

/**
 * ★ 决策门槛（在 **scores** 尺度上，而非 utility 尺度）。
 *
 * scores = 归一化状态偏好 × (1 + utility / 30)
 *
 * 量级推导（灰盒默认参数）：
 *   偏好份额：Idle=0.43  Walk=0.27  Sit=0.19  Sleep=0.11
 *   典型 utility 峰值：30~60  →  加成系数 1.0 ~ 3.0
 *   因此 scores 的典型可达范围约 0.1 ~ 0.8。
 *
 * 门槛取 0.30 的含义：
 *   - 一个偏好 0.27 的状态需要 utility ≥ 3.3 才够格（约 patience 0.11）
 *   - 一个偏好 0.19 的状态需要 utility ≥ 17  （约 patience 0.55）
 *   - 一个偏好 0.11 的状态需要 utility ≥ 52  （几乎要窗口走满）
 *
 * 这让"高偏好状态更容易发生"这一设计意图**真正生效** ——
 * 在旧实现里，门槛建在 utility 尺度上（26），
 * 等于对所有状态一视同仁，偏好只影响排序不影响"够不够格"，
 * 于是 Sit（偏好 0.19）反而比 Walk（偏好 0.27）更容易触发，
 * 与设计意图相反。
 *
 * ★ 历史备注：旧值 UTILITY_THRESHOLD = 26 作用在 rawScores 上，
 *   与展示给玩家的 scores 不是同一个量，
 *   导致"面板显示的数"与"实际决定行为的数"不一致（面板在说谎）。
 *   现已统一。
 */
const SCORE_THRESHOLD = 0.3;

/**
 * 响应态的基础分。
 *
 * 互动状态（LookAt / Approach / …）不是"空闲时想做的事"，
 * 而是"对玩家的响应"，因此不走偏好份额，改用固定的效用主导分。
 *
 * 取 0.5 的含义：
 *   - 效用达到门槛所需水平时，响应态的分数约 0.5×2 = 1.0
 *   - 远高于常规行为（Idle 0.39 / Walk 0.24 / Sit 0.17）
 *   - 因此**玩家一摸，狗一定会响应**，不会被日常行为抢走
 *
 * 这是刻意的设计取舍：抚摸是最直接的玩家输入，
 * 狗必须可靠地给出反馈。响应强度可以因犬种而异（由效用差异体现），
 * 但"是否响应"不应该变成概率问题 —— 那会让玩家觉得"它没反应/坏了"。
 */
const RESPONSE_BASE_SCORE = 0.5;

/**
 * 休止态分数折扣。
 *
 * Idle 的偏好份额是 0.388，而门槛是 0.30 —— 若不打折，
 * **从任何状态切回 Idle 都自动达标**，于是狗会被不断拉回站立，
 * 其他行为（需要累积 patience）永远来不及完成。
 *
 * 折扣 0.45 → Idle 分数 0.175 < 0.30，不再自动达标。
 * 其他状态必须靠自身效用累积才能把狗从 Idle 拉走，
 * 即"每次行为切换都需要理由"，而不是"惯性回 Idle"。
 *
 * 取值依据：
 *   折扣过小（如 0.3 → 0.116）→ Idle 几乎不可达，狗永远在动，显得焦躁
 *   折扣过大（如 0.8 → 0.310）→ 刚过门槛，又会慢慢退回旧问题
 *   0.45 让 Idle 明确低于门槛，但仍能被迁移表显式推动
 *   （Walk→Idle / Sit→Idle / Sleep→Idle 都有 38~55 的效用加成，
 *     换算后可达 0.175×2.3 ≈ 0.40，足以进入）
 */
const REST_STATE_DISCOUNT = 0.45;

/**
 * 决策门槛标定（最终方案 —— 四版失败记录全部保留，这是整个 FSM 最难的部分）
 *
 * ── 历史：门槛建在哪个尺度上（三次失败记录，Alpha 阶段又修正一次）──
 *
 * 这个问题反复出现过，因为"门槛该比较哪个量"看似显然，实则极易搞错。
 * 完整记录于此，避免第四次踩坑。
 *
 * A. `stay × 0.35`     门槛 0.15  → 任何微扰都切走，Idle 仅 0.5 秒
 * B. `stay × 1.6`      门槛 0.69  → 超过竞争者天花板 0.54，永远不动
 * C. 绝对门槛 0.30（份额尺度）→ Idle 偏好 0.43 本身即达标，
 *                                 从任何状态都立刻切回 Idle
 * D. `stay × 1.25`     门槛 0.538 → 超过天花板，永远不动
 * E. **效用门槛 26**    —— 曾经认为这是最终答案，Alpha 阶段发现它有隐患
 *
 * ── 为什么 E（效用门槛）最终也被换掉 ──
 *
 * E 在功能上是能跑的，但它制造了一个**双尺度不一致**：
 *   胜出者由 rawScores（效用）决定，
 *   而门槛比较、调试面板展示用的是 scores（偏好×效用）。
 *
 * 后果一（可观测）：面板显示的领先幅度中位数是 0.056，
 *   实际决定胜出的效用领先幅度中位数是 9.3 —— 两者差 160 倍。
 *   面板在"说谎"：开发者据此推断行为原因会得出错误结论。
 *
 * 后果二（设计意图被架空）：门槛建在效用上意味着**一视同仁**，
 *   偏好只影响排序、不影响"够不够格"。
 *   于是偏好 0.19 的 Sit 与偏好 0.27 的 Walk 需要同样的效用才能触发，
 *   而 Sit 的效用峰值更高 —— 结果 Sit 反而比 Walk 更容易发生，
 *   与"高偏好状态更常出现"的设计意图相反。
 *
 * 后果三（Alpha 打磨时暴露）：对 rawScores 施加噪声需要 ±16 分
 *   才能改变排序，而对 scores 只需 ±0.03。
 *   噪声打在错误的量上，所以"加了随机数却毫无效果"。
 *
 * ── 最终方案 F：单一尺度 ──
 *
 *   胜出、门槛比较、面板展示**全部使用 scores**（偏好 × 效用加成）。
 *   门槛相应改为 SCORE_THRESHOLD = 0.30（见其定义处的量级推导）。
 *
 *   好处：
 *     1. 一个量贯穿始终，面板不再说谎
 *     2. 偏好真正参与"够不够格"，设计意图生效
 *     3. 噪声施加在与决策同量级的量上，随机性立即可观测
 */

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

    // ★ 乘子上下限 —— 必须与 transitions.ts 的
    //   PERSONALITY_FACTOR_FLOOR / _CAP 保持一致。
    //
    //   两者作用于不同环节（这里缩放"状态偏好份额"，
    //   transitions.ts 缩放"迁移效用"），但**都在做性格连乘**，
    //   因此必须用同一套边界，否则一处的失控会从另一处漏出来。
    //
    //   实测教训（swift 犬种）：energy 与 curiosity 的乘子相乘达 3.61，
    //   Walk 的最终分数达到门槛的 4 倍，导致 Sit/Sleep 在 180 秒内
    //   完全不出现，且 Sit 每次恰好 367ms。
    //
    //   下限 0.5：极端性格也只能把倾向压到一半，保证行为始终可达
    //   上限 2.2：极端性格也只能放大到 2.2 倍，避免某个行为支配全局
    const STYLE_MULTIPLIER_FLOOR = 0.5;
    const STYLE_MULTIPLIER_CAP = 2.2;
    multiplier = Math.max(STYLE_MULTIPLIER_FLOOR, Math.min(STYLE_MULTIPLIER_CAP, multiplier));

    out[stateId] = (baseWeight / total) * multiplier;
  }

  return out;
}

/** @deprecated 保留旧名以兼容外部引用，语义已变更为「偏好」而非「加权分」 */
export const computeStateBiases = computeStatePreferences;
