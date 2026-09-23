/**
 * L.D.C. — 微行为系统（MicroBehaviorSystem）
 *
 * ★ 这一层回答的是：「当玩家什么都不做时，它在干什么？」
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么微行为是"生命感"的关键
 * ─────────────────────────────────────────────────────────────
 *
 * 一只真正活着的狗，静止时也不是完全静止的：
 *   - 偶尔抖一下耳朵
 *   - 打个哈欠
 *   - 伸个懒腰
 *   - 甩甩头
 *   - 叹口气
 *
 * 这些动作**没有目的**、**不受玩家影响**、**时机随机** ——
 * 而恰恰是"没有目的"让它们显得真实。
 * 如果每个动作都在回应玩家，那它只是一个输入输出系统。
 *
 * ─────────────────────────────────────────────────────────────
 * 与状态机的关系
 * ─────────────────────────────────────────────────────────────
 *
 * 微行为**不进入状态机**。这是刻意的：
 *
 *   状态机表达的是"它在做什么"（走路、坐下、睡觉），
 *   是互斥的、有后果的、可被观察的主要行为。
 *
 *   微行为表达的是"它顺手做的小动作"，
 *   是叠加的、无后果的、瞬时的 —— 抖完耳朵它还在原地站着。
 *
 * 若把抖耳放进状态机，会产生大量无意义的状态迁移，
 * 污染行为统计，也让"坐下"这类真正的状态变得难以追踪。
 *
 * 因此微行为作为**独立的叠加层**存在：
 *   它只修改过程动画的参数（耳朵抖动、眼睛闭合、身体拉伸），
 *   不改变 FSM 状态。
 *
 * ─────────────────────────────────────────────────────────────
 * 触发方式：泊松过程
 * ─────────────────────────────────────────────────────────────
 *
 * 配置里给的是 `chancePerMin`（每分钟期望次数）。
 * 转换为每帧概率：
 *
 *   p(本帧触发) = 1 - exp(-λ · dt)
 *   其中 λ = chancePerMin / 60
 *
 * 为什么不用 `chancePerMin/60 * dt` 的线性近似：
 *   当 λ 较大时线性近似会低估概率；指数形式在小 dt 下与前者的
 *   差别微乎其微，但语义严格正确（泊松过程的无记忆性），
 *   且不会出现"概率 > 1"的边界情况。
 *
 * 使用泊松而非固定间隔的原因：
 *   固定间隔会再次制造"时钟感" —— 每 15 秒抖一次耳朵的狗，
 *   比完全不抖更假。真实的小动作是无记忆的随机事件。
 */

import type { BehaviorsData, MicroBehavior } from '../data/types';
import type { Rng } from '../world/Rng';

/** 一个正在播放的微行为实例 */
export interface ActiveMicroBehavior {
  /** 配置里的 id，如 'earTwitch' / 'yawn' */
  readonly id: string;
  /** 已播放时长（ms） */
  readonly elapsedMs: number;
  /** 总时长（ms） */
  readonly durationMs: number;
  /** 播放进度 0..1 */
  readonly progress: number;
}

/**
 * 微行为的**表现参数**。
 *
 * ★ 关键设计：微行为的效果是**修改过程动画的输出**，
 *   而不是新增一套动画系统。
 *
 *   例如"抖耳朵"不需要专门的动画帧，
 *   它只是在这一小段时间内把耳朵抖动的幅度放大若干倍 ——
 *   而耳朵抖动本来就由 ProceduralLayer 每帧计算。
 *
 *   这样微行为几乎零成本，且与呼吸/眨眼等基础过程动画天然融合。
 */
export interface MicroBehaviorEffect {
  /** 耳朵抖动幅度倍率（1 = 无影响） */
  readonly earJitterScale: number;
  /** 眼睛闭合程度（0 = 无影响；哈欠/困倦会抬高） */
  readonly eyeClosure: number;
  /** 身体纵向拉伸倍率（伸懒腰） */
  readonly bodyStretchScale: number;
  /** 头部下沉量（像素，正 = 低头） */
  readonly headDropPx: number;
  /** 整体垂直偏移（像素，哈欠时微微下沉） */
  readonly offsetY: number;
}

const NEUTRAL_EFFECT: MicroBehaviorEffect = {
  earJitterScale: 1,
  eyeClosure: 0,
  bodyStretchScale: 1,
  headDropPx: 0,
  offsetY: 0,
};

/**
 * 内置微行为库。
 *
 * ★ 这些是**通用小动作**，不是犬种专属 ——
 *   任何狗都会抖耳朵、打哈欠、伸懒腰。
 *   犬种差异体现在"多常做"（chancePerMin）与"什么条件下做"（when）。
 *
 *   因此新增微行为种类 = 架构级改动（需在此登记），
 *   而新增犬种只需在 JSON 里挑选并设定频率。
 *
 * 时长普遍很短（300~900ms）：
 *   微行为的价值在于"一瞬间的意外感"，
 *   太长就变成有目的的行为了。
 */
const MICRO_BEHAVIOR_LIBRARY: Readonly<
  Record<string, { durationMs: number; effect: MicroBehaviorEffect }>
> = {
  /** 抖耳朵：极短、极快。耳朵抖动幅度放大 5 倍 */
  earTwitch: {
    durationMs: 300,
    effect: { ...NEUTRAL_EFFECT, earJitterScale: 5 },
  },

  /** 甩头：比抖耳更明显，带一点整体晃动 */
  headShake: {
    durationMs: 420,
    effect: { ...NEUTRAL_EFFECT, earJitterScale: 3.5, headDropPx: -1 },
  },

  /** 打哈欠：闭眼 + 低头 + 身体微沉。最"疲惫"的表达 */
  yawn: {
    durationMs: 900,
    effect: { ...NEUTRAL_EFFECT, eyeClosure: 0.9, headDropPx: 5, offsetY: 1 },
  },

  /** 伸懒腰：身体纵向拉伸，头部下沉。通常刚睡醒时出现 */
  stretch: {
    durationMs: 800,
    effect: { ...NEUTRAL_EFFECT, bodyStretchScale: 1.12, headDropPx: 6 },
  },

  /** 叹气：几乎不可见，只有一次轻微的下沉 —— 但正是这种细节积累出生命感 */
  sigh: {
    durationMs: 600,
    effect: { ...NEUTRAL_EFFECT, offsetY: 1.5 },
  },

  /** 眨眼（作为独立微行为时使用；平时由 ProceduralLayer 的反射处理） */
  blink: {
    durationMs: 160,
    effect: { ...NEUTRAL_EFFECT, eyeClosure: 1 },
  },
};

/**
 * 内置微行为 id 清单。
 *
 * 单独导出，供校验器在构建期检查 behaviors.json 里的 id 是否拼错。
 *
 * ★ 为什么不能只是"运行时静默跳过"：
 *   写错 id 时微行为永远不会发生，而配置看起来完全正常 ——
 *   属于最难发现的"死配置"。必须在构建期报错。
 */
export const KNOWN_MICRO_BEHAVIOR_IDS: readonly string[] = [
  'earTwitch',
  'headShake',
  'yawn',
  'stretch',
  'sigh',
  'blink',
];

export interface MicroBehaviorSnapshot {
  /** 当前正在播放的微行为（无则 null） */
  readonly active: ActiveMicroBehavior | null;
  /** 名称与剩余时长，供调试面板展示 */
  readonly label: string | null;
}

export class MicroBehaviorSystem {
  private behaviors: readonly MicroBehavior[];
  private rng: Rng;

  /** 当前活跃的微行为（同一时刻只允许一个） */
  private activeId: string | null = null;
  private activeElapsedMs = 0;
  private activeDurationMs = 0;

  /**
   * 每个微行为的独立冷却。
   *
   * ★ 为什么需要：纯泊松过程会产生"连续触发同一个行为"的情况 ——
   *   比如 0.2 秒内抖了两次耳朵，看起来像故障而非自然。
   *   给每个微行为加一个最短间隔（= 期望间隔的一半），
   *   消除这种聚集，同时保留随机性。
   */
  private readonly cooldowns = new Map<string, number>();

  constructor(behaviors: BehaviorsData, rng: Rng) {
    this.behaviors = behaviors.microBehaviors;
    this.rng = rng;
  }

  setBehaviors(behaviors: BehaviorsData, rng: Rng): void {
    this.behaviors = behaviors.microBehaviors;
    this.rng = rng;
    this.cooldowns.clear();
  }

  snapshot(): MicroBehaviorSnapshot {
    if (!this.activeId) return { active: null, label: null };
    const def = MICRO_BEHAVIOR_LIBRARY[this.activeId];
    const total = def?.durationMs ?? this.activeDurationMs;
    return {
      active: {
        id: this.activeId,
        elapsedMs: this.activeElapsedMs,
        durationMs: total,
        progress: total > 0 ? Math.min(1, this.activeElapsedMs / total) : 1,
      },
      label: this.activeId,
    };
  }

  /** 是否有微行为正在播放 */
  get isActive(): boolean {
    return this.activeId !== null;
  }

  /**
   * 每逻辑帧推进。
   *
   * @param dtMs     逻辑帧时长
   * @param allowed  当前是否允许触发新的微行为。
   *                 调用方会在"被抚摸 / 进行互动 / 惊醒"时传 false ——
   *                 因为那些时刻玩家正在与狗互动，
   *                 插入无关的小动作会打断注意焦点。
   * @param whenCheck 条件求值器，用于解析配置里的 `when` 表达式。
   *                  返回 false 表示该微行为当前不适用。
   */
  update(
    dtMs: number,
    allowed: boolean,
    whenCheck?: (expr: string) => boolean,
  ): void {
    const dtSec = dtMs / 1000;

    // ① 推进当前微行为
    if (this.activeId !== null) {
      this.activeElapsedMs += dtMs;
      if (this.activeElapsedMs >= this.activeDurationMs) {
        this.activeId = null;
        this.activeElapsedMs = 0;
      }
    }

    // ② 推进冷却
    for (const [id, remaining] of this.cooldowns) {
      const next = remaining - dtMs;
      if (next <= 0) this.cooldowns.delete(id);
      else this.cooldowns.set(id, next);
    }

    // ③ 尝试触发新的（同一时刻只允许一个，避免动作互相干扰）
    if (this.activeId !== null || !allowed) return;

    // ★ 按概率**独立**判定每个微行为，然后从命中者中按权重选一个。
    //
    //   早期实现是"顺序遍历，第一个命中就触发并 return" ——
    //   这会让列表中靠前的项获得不成比例的优势：
    //   列表首位的 blink（16/min）几乎每帧都会命中，
    //   于是永远轮不到后面的 sigh / stretch（实测触发 0 次）。
    //
    //   这属于典型的**顺序偏置**：看似"按概率独立"，实则前面的项
    //   垄断了所有机会。修正为两阶段：先各自判定，再择优。
    let chosen: { id: string; durationMs: number; chancePerMin: number; weight: number } | null =
      null;

    for (const mb of this.behaviors) {
      const def = MICRO_BEHAVIOR_LIBRARY[mb.id];
      if (!def) continue; // 未知 id：静默跳过（校验器已告警）

      if (this.cooldowns.has(mb.id)) continue;

      // 条件不满足则跳过
      if (mb.when && whenCheck && !whenCheck(mb.when)) continue;

      const p = this.probability(mb.chancePerMin, dtSec);
      if (p <= 0) continue;
      if (this.rng.next() >= p) continue;

      // 命中。用 chancePerMin 作为权重择优 ——
      // 高频行为仍然更常胜出，但低频行为不会被完全饿死。
      const weight = mb.chancePerMin * this.rng.next();
      if (!chosen || weight > chosen.weight) {
        chosen = { id: mb.id, durationMs: def.durationMs, chancePerMin: mb.chancePerMin, weight };
      }
    }

    if (chosen) {
      this.trigger(chosen.id, chosen.durationMs, chosen.chancePerMin);
    }
  }

  /**
   * 泊松过程的单帧触发概率。
   *
   *   λ = chancePerMin / 60        （每秒期望次数）
   *   p = 1 - exp(-λ · dt)         （该帧内至少发生一次的概率）
   *
   * 指数形式而非线性近似的理由见文件头注释。
   */
  private probability(chancePerMin: number, dtSec: number): number {
    if (chancePerMin <= 0) return 0;
    const lambda = chancePerMin / 60;
    return 1 - Math.exp(-lambda * dtSec);
  }

  private trigger(id: string, durationMs: number, chancePerMin: number): void {
    this.activeId = id;
    this.activeElapsedMs = 0;
    this.activeDurationMs = durationMs;

    // 冷却 = 期望间隔的一半，消除聚集但不抹掉随机性
    const expectedIntervalMs = chancePerMin > 0 ? 60000 / chancePerMin : durationMs;
    this.cooldowns.set(id, Math.max(durationMs, expectedIntervalMs * 0.5));
  }

  /** 强制中断当前微行为（如玩家突然开始抚摸） */
  interrupt(): void {
    this.activeId = null;
    this.activeElapsedMs = 0;
  }

  /**
   * 输出当前微行为对过程动画的修饰。
   *
   * ★ 这是微行为与动画系统的唯一接口。
   *   返回的是一个"倍率/增量"集合，由渲染层叠加到基础过程动画上。
   *   因此微行为永远不会"接管"动画，只是修饰它 ——
   *   保证呼吸、眨眼等基础生命体征在任何时候都不中断。
   */
  effect(): MicroBehaviorEffect {
    if (!this.activeId) return NEUTRAL_EFFECT;

    const def = MICRO_BEHAVIOR_LIBRARY[this.activeId];
    if (!def) return NEUTRAL_EFFECT;

    const progress =
      this.activeDurationMs > 0
        ? Math.min(1, this.activeElapsedMs / this.activeDurationMs)
        : 1;

    // 包络：快起 → 保持 → 缓落。让动作有"发力"的感觉。
    const envelope = triangleEnvelope(progress);
    const e = def.effect;

    return {
      earJitterScale: 1 + (e.earJitterScale - 1) * envelope,
      eyeClosure: e.eyeClosure * envelope,
      bodyStretchScale: 1 + (e.bodyStretchScale - 1) * envelope,
      headDropPx: e.headDropPx * envelope,
      offsetY: e.offsetY * envelope,
    };
  }

  /** 是否处于中性（无微行为影响） */
  get effectIsNeutral(): boolean {
    return this.activeId === null;
  }
}

/**
 * 三角包络：0 → 1 → 0。
 *
 * 上升段占前 25%（快起），下降段占后 75%（缓落）。
 * 这比对称三角更接近生物动作 ——
 * 肌肉收缩快、放松慢。
 */
function triangleEnvelope(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 0;
  const RISE = 0.25;
  return p < RISE ? p / RISE : (1 - p) / (1 - RISE);
}
