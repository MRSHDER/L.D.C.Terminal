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
 *
 * ★ 下限保护：不得低于 FLOOR。
 *
 *   为什么需要下限（Alpha 打磨中的真实教训）：
 *     低能量犬种（graybox-shy，energy=0.35）同时受 energy 与 curiosity
 *     两个维度的负向压制，乘子积只有约 0.40，
 *     使 Idle→Walk 的分数降到 0.162 —— 低于门槛，**永不触发**。
 *     于是"安静的狗"变成了"从不走动的狗"，
 *     而一只 3 分钟里一步都不走的动物，看起来像坏掉了，不像性格安静。
 *
 *   核心区分：
 *     **性格应该决定"多常做"，而不是"能不能做"。**
 *     低能量 → 走得少、走得慢；但绝不能是"零"。
 *     任何性格维度都不该把某个基础行为能力归零。
 *
 *   下限 0.5 的含义：最极端的性格也只能把某行为的倾向压到一半，
 *   保证所有基础行为始终可达，差异体现在频率而非有无。
 *
 * ★ 上限 CAP = 2.2（Alpha 打磨第二轮补充）
 *
 *   只加下限是不够的。实测 swift 犬种：
 *     energy=0.95 → 乘子 2.44
 *     curiosity=0.9 → 乘子 1.48
 *     两者相乘 → 3.61
 *   使 Walk 的分数达到 1.18~3.38 —— 而门槛只有 0.30。
 *
 *   后果不是"爱走动"，而是**其他行为全部消失**：
 *     Sit→Walk 在 0ms 就跨过门槛（分数 3.38），
 *     而 Sit→Idle 需要 350ms、Sit→Sleep 需要 450ms。
 *     Walk 永远先到，于是 Sit 每次恰好 367ms 就被夺走 ——
 *     严格得像节拍器，且 Sit 的时长标准差为 0.000。
 *
 *   含义：性格乘子的**连乘**会让多个维度叠加出远超设计意图的效果。
 *   单看每个 sensitivity 都合理（0.9、0.3），
 *   但乘在一起就失控了。上限把这个连乘钉在可控范围内。
 *
 *   取 2.2 的依据：灰盒各迁移的峰值在 15~60 之间，
 *   乘 2.2 后落在 33~132 —— 仍有明显性格差异，
 *   但不会出现"某个行为独占 4 倍门槛"的支配局面。
 */
const PERSONALITY_FACTOR_FLOOR = 0.5;
const PERSONALITY_FACTOR_CAP = 2.2;

function personalityFactor(value: number, sensitivity: number): number {
  const raw = 1 + (value - 0.5) * sensitivity * 2;
  return Math.max(PERSONALITY_FACTOR_FLOOR, Math.min(PERSONALITY_FACTOR_CAP, raw));
}

/**
 * 渐进因子：在当前状态停留越久，分值越高。
 *
 * @param ctx         状态上下文
 * @param fullAtMs    达到满分所需的停留时长
 *
 * 用 smoothstep 而非线性，避免"刚进来就开始蠢蠢欲动"。
 *
 * ★ Alpha 打磨（两处修正，都是为了让狗不再像时钟）：
 *
 * 【1】窗口按犬种节奏缩放
 *   所有窗口原本是**绝对毫秒**（Sit 1800ms、Walk 3200ms），
 *   而不同犬种的决策节奏差异巨大（decisionIntervalMs 180~900）。
 *   对敏捷犬种（swift，180ms）来说，1800ms 要等 10 次决策 ——
 *   而它的 Idle 只持续约 378ms 就被 Walk 抢走，
 *   于是 **Sit / Sleep 在 180 秒里一次都没出现**。
 *   反直觉的是：越"活跃"的犬种行为反而越单调。
 *
 *   修正：窗口乘以节奏比例（基准 500ms）。
 *     180ms → ×0.36     500ms → ×1.00     900ms → ×1.80
 *
 * 【2】每次进入状态时抽一个随机相位偏移 ★关键
 *
 *   这是"永远像时钟"的**根本**修复。前面几层噪声（分值抖动、
 *   门槛抖动、停留护栏抖动）都无效，因为它们没有触及真正的
 *   确定性来源：**patience 是 stateElapsedMs 的确定性函数**。
 *   同样的状态、同样的窗口，必然在同一毫秒越过阈值 ——
 *   实测 swift 每次 Sit 都恰好 367ms（标准差 0.000）。
 *
 *   修复方式：进入状态时抽一个随机相位偏移（±22% 窗口时长），
 *   使"距离满分还差多少"每次不同，触发时刻自然分散。
 *
 *   偏移在状态**进入时**抽定并缓存在黑板上，
 *   而不是每帧重抽 —— 后者会让分值随机游走，
 *   表现为"犹豫不决"而不是"节奏自然"。
 *
 *   强度由 randomness 维度控制：训练有素的犬种依然规整，
 *   散漫的犬种每次都不一样。
 */
function patience(ctx: StateContext, fullAtMs: number): number {
  const species = ctx.species;
  const ms = species.cognition.decisionIntervalMs;
  const rhythmScale = Math.max(0.36, Math.min(1.8, ms / 500));
  const scaled = fullAtMs * rhythmScale;

  // 【2】随机相位：按「状态进入次数」缓存，每次进入状态重抽一次。
  //
  //   用 entrySerial 作为缓存键，而不是比较 stateElapsedMs ——
  //   后者容易在边界条件下误判（例如刚好等于 0 时）。
  //   entrySerial 由 StateMachine 在每次 transitionTo 时递增，
  //   语义明确、无歧义。
  const bb = ctx.blackboard;
  const serial = (bb['__stateEntrySerial'] as number | undefined) ?? 0;

  let phase = bb['__patiencePhase'] as number | undefined;
  if (bb['__patiencePhaseSerial'] !== serial) {
    const r = species.personality.temperament.randomness;
    const amplitude = Math.max(0, Math.min(1, r)) * 0.22;
    phase = ctx.rng.range(-amplitude, amplitude);
    bb['__patiencePhase'] = phase;
    bb['__patiencePhaseSerial'] = serial;
  }

  const effective = Math.max(1, scaled * (1 + (phase ?? 0)));
  const t = Math.min(1, Math.max(0, bb.stateElapsedMs / effective));
  return t * t * (3 - 2 * t);
}

/**
 * 决策节奏因子。
 *
 * ★ Alpha 打磨：把下限从 0.4 提高到 0.7，并收窄动态范围。
 *
 *   旧实现 `clamp(0.4, 1.0, 400/ms)` 有一个概念性错误：
 *   「决策间隔」已经在 World 层决定了**多久思考一次**
 *   （decisionIntervalMs 越大，裁决次数越少）。
 *   若再把它乘进每个迁移的分值，等于**同一个因素被计算两次** ——
 *   结果对慢性子犬种的压制远超设计意图。
 *
 *   实测（graybox-shy，decisionIntervalMs=780）：
 *     旧公式 rhythmFactor = 400/780 = 0.51
 *     再叠加 energy/curiosity 的性格乘子后，
 *     Idle→Walk 分数只有 0.263 < 门槛 0.30 → **永不走动**。
 *     一只三分钟一步都不走的狗，看起来像坏掉，不像性格安静。
 *
 *   修正后的范围：
 *     200ms  → 1.00（敏捷型）
 *     500ms  → 0.85（中性）
 *     780ms  → 0.74（慢性子）
 *     2000ms → 0.70（下限）
 *
 *   现在节奏因子的作用是"微调行为的活跃程度"，
 *   而不是"决定行为能否发生"。后者已由决策频率负责。
 */
function rhythmFactor(ctx: StateContext): number {
  const ms = ctx.species.cognition.decisionIntervalMs;
  return Math.max(0.7, Math.min(1.0, 600 / Math.max(200, ms)));
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
        // ★ Alpha 打磨：峰值从 53 降到 40，窗口从 2600 拉到 3200。
        //
        //   原因：Walk 的**单次时长由物理决定**（走到目标点 + 驻足，
        //   实测约 2200ms），远长于 Idle/Sit（约 900ms）。
        //   因此即便三者被选中的**次数**相同，Walk 也会占据大部分时间 ——
        //   实测 Walk 占 76%，狗看起来一直在走，不像在房间里待着。
        //
        //   降低峰值 + 拉长窗口 = 降低"被选中频率"，
        //   让 Walk 的次数减少，从而把占比拉回合理区间。
        const eagerness = patience(ctx, 3200);
        return (
          40 *
          eagerness *
          personalityFactor(t.energy, 1.6) *
          personalityFactor(t.curiosity, 0.6) *
          rhythmFactor(ctx)
        );
      },
      // 站着至少 700ms 才起步 —— 让"站着"是一个可感知的状态，
      // 而不是一帧的过渡。同时保证 Idle 时长有变化空间。
      minDwellMs: 700,
    },

    // ───────────────────────────────────────────────
    // Idle → Sit：站累了，想坐下？
    //
    //   窗口 1800ms + 峰值 62。
    //   Sit 是"低成本、短时长"行为（约 900ms），
    //   因此可以比 Walk 更频繁地被选中。
    // ───────────────────────────────────────────────
    {
      from: 'Idle',
      to: 'Sit',
      score: (ctx) => {
        const t = ctx.species.personality.temperament;
        const weariness = patience(ctx, 1800);
        return 62 * weariness * personalityFactor(t.energy, -1.2) * rhythmFactor(ctx);
      },
      minDwellMs: 700,
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
        // ★ Alpha 打磨：峰值从 90 提高到 145。
        //
        //   门槛统一到 scores 尺度（0.30）后，Sleep 变得不可达：
        //     Sleep 偏好份额仅 0.097（最低），
        //     score = 0.097 × (1 + 90/30) = 0.388 ... 看似够
        //     但 drowsiness 窗口 9000ms 远长于 Idle 的实际存活时长，
        //     实际可达峰值只有 0.097 × (1 + 50.9/30) = 0.262 < 0.30。
        //
        //   结果：**狗永远不会睡觉** —— 这在长时间体验中很致命，
        //   玩家会发现"它只会站着坐着走着，从不休息"。
        //
        //   提高峰值后：0.097 × (1 + 145/30) = 0.566，稳稳过门槛。
        //   同时保留 9000ms 窗口 —— "累了才睡"的节奏感不变。
        return 145 * drowsiness * Math.pow(Math.max(0.05, tiredness), 0.5) * rhythmFactor(ctx);
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
        //   顺序：Sleep(1500) → Walk(2000) → Idle(2850)，
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
      // ★ 坐下至少 900ms 才允许起身。
      //
      //   没有这个下限时，swift 犬种的 Sit→Walk 分数高达 3.0（门槛的 10 倍），
      //   会在**第一个决策刻度**就触发 —— 实测 Sit 每次恰好 267ms，
      //   玩家根本看不到狗坐下这个动作完成。
      //
      //   900ms 让"坐下"成为一个可被感知的行为，而不是瞬间跳变。
      minDwellMs: 900,
    },

    {
      from: 'Sit',
      to: 'Sleep',
      score: (ctx) => {
        const t = ctx.species.personality.temperament;
        // ★ Alpha 打磨：峰值从 72 提高到 190。
        //
        //   门槛统一到 scores 尺度后，Sit→Sleep 变得不可达：
        //     Sleep 偏好份额 0.097（最低），
        //     score = 0.097 × (1 + 38/30) = 0.220 < 0.30
        //   而同一来源的 Sit→Idle 达 0.984 —— 差距 4.5 倍，Sleep 永远输。
        //   实测：180 秒内 Sleep 占比 0%，狗从不睡觉。
        //
        //   为什么不能靠"降低门槛"解决：
        //     门槛降低会让所有迁移一起更容易触发，Idle 占比反而更高。
        //   正确做法是**提高 Sleep 自身的峰值**，让它在分数上能竞争。
        //
        //   新峰值 190 → score = 0.097 × (1 + 190/30) = 0.71
        //   与 Sit→Idle 的 0.984 同量级 —— Sleep 有机会在"坐久了的决策点"胜出。
        //
        //   窗口保持 1500ms：坐下约 1.5 秒后开始犯困，节奏自然。
        const drowsiness = patience(ctx, 1500);
        const tiredness = 1 - t.energy;
        return 190 * drowsiness * Math.pow(Math.max(0.1, tiredness), 0.6) * rhythmFactor(ctx);
      },
      // 坐下至少 900ms 才可能睡着 —— 与 Sit→Walk 保持一致的下限，
      // 保证"坐下"这个动作有时间被玩家看到。
      minDwellMs: 900,
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
      // 坐下的最短时长同样适用于"站起来"这条兜底出口。
      minDwellMs: 900,
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
