/**
 * L.D.C. — 通用迁移表（Transitions）
 *
 * ★ 这里定义的是「通用行为倾向」，不是犬种特征。
 *
 * 每个迁移有三层：
 *   guard   —— 硬门槛，不满足则永不触发
 *   score   —— 效用分数（作为「加成」叠加到状态偏好之上）
 *   cooldown —— 节流，防止抖动
 *
 * ─────────────────────────────────────────────────────────────
 * 打分尺度约定（重要）
 * ─────────────────────────────────────────────────────────────
 * StateMachine 里 PREFERENCE_REFERENCE_SCALE = 30，含义：
 *   score = 0   → 加成 0%   （行为完全由 stateWeights 决定）
 *   score = 30  → 加成 100%（该状态的偏好翻倍）
 *   score = 90  → 加成 300%
 *
 * 因此本文件里各迁移的典型分值应落在 10~60 区间。
 * 写 300 会把 stateWeights 完全压制 —— 那是设计错误，不是"更强烈的意愿"。
 *
 * ─────────────────────────────────────────────────────────────
 * 时间门槛约定
 * ─────────────────────────────────────────────────────────────
 * 每个迁移的 score 都乘以一个「已经在该状态待了多久」的渐进因子。
 * 这保证：
 *   - 刚进入某状态时不会立刻想走（避免闪烁）
 *   - 停留越久，离开的意愿越强（真实的"待不住了"）
 *   - 不同犬种的"耐心"通过 cognition.decisionIntervalMs 自然体现
 */

import type { Transition, StateContext } from './StateMachine';
import { WALK_DWELL_COMPLETED } from './states/coreStates';

/**
 * 性格乘子。
 * @param value        性格维度值 0..1（0.5 为中性）
 * @param sensitivity  敏感度。正值 = 该维度高时更倾向，负值 = 更不倾向
 */
function personalityFactor(value: number, sensitivity: number): number {
  return Math.max(0.05, 1 + (value - 0.5) * sensitivity * 2);
}

/**
 * 渐进因子：在当前状态停留越久，分值越高。
 *
 * @param ctx         状态上下文
 * @param fullAtMs    达到满分所需的停留时长
 *
 * 用 smoothstep 而非线性，避免"刚进来就开始蠢蠢欲动"。
 */
function patience(ctx: StateContext, fullAtMs: number): number {
  const t = Math.min(1, Math.max(0, ctx.blackboard.stateElapsedMs / fullAtMs));
  return t * t * (3 - 2 * t);
}

/**
 * 决策节奏因子。
 *
 * 决策间隔越长（思考越慢）的犬种，越不容易频繁改变主意。
 *
 * ★ 取值必须**中性值为 1.0**，否则会系统性地压低所有迁移的分值，
 *   使门槛（UTILITY_THRESHOLD）变得无法达到。
 *   早期写成 `400 / decisionIntervalMs`，在 500ms 时得到 0.8 ——
 *   看似合理，实际把 Walk 的峰值从 36 压到 28.8，
 *   仅勉强高于门槛 26，导致 Walk 在竞争中总是输给 Sit（峰值 58）。
 *
 *   现在以 200ms（最敏捷犬种）为基准做归一化：
 *     200ms  → 1.0（边牧级，反应极快）
 *     500ms  → 0.74
 *     2000ms → 0.40（下限，沉稳大型犬）
 *   下限 0.4 保证即便最迟钝的犬种，行为也不会被完全冻结。
 */
function rhythmFactor(ctx: StateContext): number {
  const ms = ctx.species.cognition.decisionIntervalMs;
  return Math.max(0.4, Math.min(1.0, 400 / Math.max(200, ms)));
}

export function createCoreTransitions(): readonly Transition[] {
  return [
    // ───────────────────────────────────────────────
    // Idle → Walk：想不想起身走动？
    //
    // ★ 门槛 UTILITY_THRESHOLD = 26，决策发生在 decisionIntervalMs 的整数倍
    //   （灰盒为 500ms：0.5s / 1.0s / 1.5s …）。因此"触发时间"实际上是
    //   **第一个使分值越过门槛的决策时刻**，而不是连续的 1.1 秒。
    //
    //   实测（rhythmFactor=0.8）：
    //     dwell  Walk效用  Sit效用
    //     1000ms   24.3      17.5     ← 两者都未过门槛
    //     1500ms   38.5      31.7     ← 两者同时越过，Walk 更高 → Walk 胜出
    //
    //   这正是 Walk 垄断的根因：即使 Sit 的峰值（46.4）更高，
    //   在**第一个过门槛的决策点**上 Walk 领先，于是永远由 Walk 夺走。
    //
    //   修复：把 Walk 的窗口拉长，使它在 1500ms 时才刚过线、
    //   而 Sit 在 1000ms 就已经过线 —— Sit 先触发，Walk 成为次要出口。
    // ───────────────────────────────────────────────
    {
      from: 'Idle',
      to: 'Walk',
      score: (ctx) => {
        const t = ctx.species.personality.temperament;
        // 窗口 2600ms：1000ms 时 patience=0.30 → 效用 12.5（未过门槛）
        //              1500ms 时 patience=0.63 → 效用 26.9（刚过门槛）
        const eagerness = patience(ctx, 2600);
        return (
          53 *
          eagerness *
          personalityFactor(t.energy, 1.6) *
          personalityFactor(t.curiosity, 0.6) *
          rhythmFactor(ctx)
        );
      },
    },

    // ───────────────────────────────────────────────
    // Idle → Sit：站累了，想坐下？
    //
    //   窗口 1500ms + 峰值 62：
    //     1000ms → patience=0.44 → 效用 30.3 > 26  ✓ **先于 Walk 触发**
    //     1500ms → patience=1.00 → 效用 49.6
    //   因此 Idle 之后的第一个行为通常是"坐下"，
    //   走动的机会出现在 Sit → Walk，形成
    //   Idle → Sit → (Walk | Sleep | Idle) 的自然链条。
    // ───────────────────────────────────────────────
    {
      from: 'Idle',
      to: 'Sit',
      score: (ctx) => {
        const t = ctx.species.personality.temperament;
        const weariness = patience(ctx, 1500);
        return 62 * weariness * personalityFactor(t.energy, -1.2) * rhythmFactor(ctx);
      },
    },

    // ───────────────────────────────────────────────
    // 任意 → Sleep：困了（兜底路径）
    //
    // ★ 主入口是 Sit → Sleep（见下）。这条是**兜底**：
    //   覆盖"从 Idle / Walk 补足静止后直接睡着"的情形，
    //   窗口设得比 Sit→Sleep 长得多（9000ms），
    //   保证它只在狗确实长时间静止时才生效。
    //
    //   早期把这里当主入口，但 Idle 只持续 1 秒 ——
    //   9 秒的窗口永远走不完，导致 Sleep 完全不可达。
    //   这说明一条重要经验：
    //   转移的"窗口时长"必须与来源状态的**典型存活时长**匹配，
    //   否则该转移在统计上永远不会发生。
    // ───────────────────────────────────────────────
    {
      from: '*',
      to: 'Sleep',
      guard: (ctx) => {
        if (ctx.blackboard.moving) return false;
        if (ctx.fsmCurrent === 'Walk' && !hasCompletedWalk(ctx)) return false;
        return true;
      },
      score: (ctx) => {
        const t = ctx.species.personality.temperament;
        const drowsiness = patience(ctx, 9000);
        const tiredness = 1 - t.energy;
        // 峰值 90 × Math.pow(0.5, 0.5) × 0.8 ≈ 50.9 —— 显著高于门槛 26。
        // ★ 早期用 Math.pow(tiredness, 1.5)：energy=0.5 时仅 0.35，
        //   峰值只有 17.0，低于门槛 → 该迁移永不触发（实测报告发现的）。
        //   指数 1.5 对中度精力犬种惩罚过重；0.5 让"半困"也能睡着，
        //   同时对高能量犬种（energy=0.95 → tiredness=0.05 → 0.22）仍有效抑制。
        return 90 * drowsiness * Math.pow(Math.max(0.05, tiredness), 0.5) * rhythmFactor(ctx);
      },
      cooldownMs: 30000,
    },

    // ───────────────────────────────────────────────
    // Sit 的四个出口 —— 触发时间必须拉开，否则某个出口会垄断
    //
    // 目标节奏（Sit 典型存活 3~5 秒）：
    //   Sit → Walk   1000ms  ← 最快：坐不住，起来活动
    //   Sit → Sleep  2500ms  ← 次之：安静下来才犯困
    //   Sit → Idle   4500ms  ← 兜底：坐太久了起来站着
    //
    // ★ 早期顺序完全颠倒（Sleep 1750ms 最先、Walk 4000ms 最后），
    //   结果 Sit 几乎总是接 Sleep，Walk 实测占比 0% ——
    //   "狗从来不走动"是这个顺序造成的，而不是走动本身有问题。
    //
    //   energy 的作用：高能量犬种 Sit→Walk 更早、Sit→Sleep 更晚；
    //   低能量犬种反之。乘子已包含在各自公式里。
    // ───────────────────────────────────────────────
    {
      from: 'Sit',
      to: 'Walk',
      score: (ctx) => {
        const t = ctx.species.personality.temperament;
        // 窗口 3000ms → 触发约 2000ms。
        // ★ 必须**晚于** Sit→Sleep（1500ms）触发，
        //   否则坐下后总是先起身走动，Sleep 永不出现。
        //   现在的顺序：Sleep(1500) → Walk(2000) → Idle(2850)，
        //   对应"坐下 → 打盹 or 起身 → 站定"的自然梯度。
        const restlessness = patience(ctx, 3000);
        return (
          62 *
          restlessness *
          personalityFactor(t.energy, 1.7) *
          personalityFactor(t.playfulness, 0.4) *
          rhythmFactor(ctx)
        );
      },
    },

    {
      from: 'Sit',
      to: 'Sleep',
      score: (ctx) => {
        const t = ctx.species.personality.temperament;
        // 窗口 1500ms → 与 Sit→Walk（1150ms）落在**同一个决策点**（1500ms）。
        // ★ 这是关键：若 Sleep 的触发时间落在 Walk 之后一个决策周期（2150ms），
        //   那么 Walk 总会在 1500ms 先把它夺走，Sleep 实测占比恒为 0%。
        //   必须让两者在同一个决策点竞争，靠**分值高低**决定，
        //   而不是靠"谁先过线"。
        //
        //   在 1500ms 的决策点上：
        //     Sit→Walk  效用 ≈ 49.6 × …  （受 energy 正向放大）
        //     Sit→Sleep 效用 = 峰值 × patience(1.0) × tiredness^0.6 × 0.8
        //   energy=0.5 时 Sleep ≈ 34.8 —— 低于 Walk，因此默认偏活动；
        //   但当 energy 偏低（困倦的狗）Sleep 会反超，从而自然出现睡眠。
        const drowsiness = patience(ctx, 1500);
        const tiredness = 1 - t.energy;
        return 72 * drowsiness * Math.pow(Math.max(0.1, tiredness), 0.6) * rhythmFactor(ctx);
      },
      cooldownMs: 30000,
    },

    {
      from: 'Sit',
      to: 'Idle',
      score: (ctx) => {
        const t = ctx.species.personality.temperament;
        const satEnough = patience(ctx, 5200);
        return 46 * satEnough * personalityFactor(t.energy, 0.8);
      },
    },

    // ───────────────────────────────────────────────
    // Sleep → Idle：睡够了，醒来
    //
    //   窗口 4350ms 触发，而 SleepState 自身的最短睡眠为 6000ms，
    //   两者共同决定睡眠时长约 6 秒 —— 相对其他状态（1~2 秒）偏长，
    //   会把睡眠占比推高。
    //   这里把触发窗口缩到 2600ms，并同步下调 SleepState 的最短时长，
    //   使睡眠落在 3 秒左右，与其他状态量级一致。
    // ───────────────────────────────────────────────
    {
      from: 'Sleep',
      to: 'Idle',
      score: (ctx) => {
        const t = ctx.species.personality.temperament;
        const rested = patience(ctx, 2600);
        return 55 * rested * personalityFactor(t.energy, 0.9);
      },
    },

    // ───────────────────────────────────────────────
    // Walk → Idle  /  Walk → Sit
    //
    // ★ 门槛是 UTILITY_THRESHOLD = 26，因此分值必须都**超过** 26 才能触发，
    //   同时两者的相对高低决定了"走完是站着还是坐下"的比例。
    //
    //   早期版本给 Sit=44 而 Idle=34，导致 Walk 永远接 Sit（93.8% 时间在走，
    //   Idle 只剩 0.4%）。现在让 Idle 略高一点，
    //   形成「走完→站定」为主要出口、「走完→坐下」为次要出口的自然比例。
    // ───────────────────────────────────────────────
    {
      from: 'Walk',
      to: 'Idle',
      guard: (ctx) => hasCompletedWalk(ctx),
      score: () => 38,
    },
    {
      from: 'Walk',
      to: 'Sit',
      guard: (ctx) => hasCompletedWalk(ctx),
      score: (ctx) => {
        const t = ctx.species.personality.temperament;
        return 31 * personalityFactor(t.energy, -0.9);
      },
    },

    // ───────────────────────────────────────────────
    // Walk → Sleep：走到角落趴下睡了
    // ───────────────────────────────────────────────
    {
      from: 'Walk',
      to: 'Sleep',
      guard: (ctx) => hasCompletedWalk(ctx),
      score: (ctx) => {
        const t = ctx.species.personality.temperament;
        const tiredness = 1 - t.energy;
        return 40 * Math.pow(tiredness, 1.5);
      },
      cooldownMs: 12000,
    },
  ];
}

/**
 * 「本次行走是否已完成」。
 *
 * ★ 这是一个关键的架构防护，值得单独说明：
 *
 * 早期版本没有这个守卫，结果是 Idle↔Walk 每 0.5 秒乒乓振荡。
 * 原因很微妙：Idle 在 stateWeights 里有很高的基础偏好（40/93），
 * 因此它**永远**是一个强候选。狗刚开始走向目标（还差 20px），
 * Idle 的偏好分就已经压过 Walk 的效用加成 → 立刻切回 Idle →
 * 下一轮 Walk 又是唯一候选 → 无限循环。
 *
 * 修复方式不是调数值（那只是掩盖症状），而是给「离开 Walk」
 * 加一个**语义正确的硬门槛**：只有真正走完（到达 + 驻足）才允许离开。
 *
 * 这体现了一条通用原则：
 *   凡是「有明确完成条件」的行为，其退出都必须由完成条件守卫，
 *   而不能交给通用权重系统自由裁决 —— 否则权重会制造出
 *   "话说到一半就走开"这类不自然的行为。
 */
export function hasCompletedWalk(ctx: StateContext): boolean {
  // 「已完成」由 WalkState 在驻足结束时打上的一次性标记表达。
  // 不用时间差现算 —— 那样守卫会依赖"当前时刻"，语义脆弱且容易与状态自身逻辑漂移。
  return ctx.blackboard[WALK_DWELL_COMPLETED] === true;
}

/**
 * ★ 准入守卫表：状态 id → 「现在能否进入该状态」。
 *
 * 与 Transition.guard 的区别见 StateMachineOptions.admissionGuards 的注释。
 * 简言之：Transition.guard 只管一条边，准入守卫管"进门"这件事本身。
 *
 * 这里拦住的是三类「不该被打断的进行中行为」：
 *   - 行走未完成时，不能切到 Idle / Sit / Sleep
 *   - 睡眠未达最短时长时，不能切到 Idle / Walk / Sit
 *
 * 注意这些守卫只表达"还不能走"，不表达"该去哪" ——
 * 后者仍然完全由权重与效用决定。职责边界保持清晰。
 */
export function createAdmissionGuards(): Record<string, (ctx: StateContext) => boolean> {
  /** 通用前提：如果当前在 Walk 且没走完，禁止离开 */
  const walkAllowsLeaving = (ctx: StateContext): boolean =>
    ctx.fsmCurrent !== 'Walk' || hasCompletedWalk(ctx);

  /** 通用前提：如果当前在 Sleep 且没睡够，禁止离开 */
  const sleepAllowsLeaving = (ctx: StateContext): boolean => {
    if (ctx.fsmCurrent !== 'Sleep') return true;
    const startedAt = ctx.blackboard['sleepStartedAtMs'] as number | undefined;
    if (startedAt === undefined) return true;
    return ctx.elapsedMs - startedAt >= SLEEP_MIN_DURATION_MS;
  };

  return {
    Idle: (ctx) => walkAllowsLeaving(ctx) && sleepAllowsLeaving(ctx),
    Walk: (ctx) => sleepAllowsLeaving(ctx),
    Sit: (ctx) => walkAllowsLeaving(ctx) && sleepAllowsLeaving(ctx),
    Sleep: (ctx) => walkAllowsLeaving(ctx),
  };
}

/** 睡眠最短时长，与 SleepState 保持一致（见 SLEEP_MIN_DURATION_MS 注释） */
export const SLEEP_MIN_DURATION_MS = 3200;
