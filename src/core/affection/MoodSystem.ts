/**
 * L.D.C. — 情绪系统（MoodSystem）
 *
 * Milestone 2 只需要**四个**情绪量，刻意保持最小：
 *
 *   valence    愉悦度   -1..1    被摸得舒服 → 上升；被骚扰 → 下降
 *   arousal    兴奋度    0..1    被摸 → 上升，驱动尾巴摆幅与呼吸频率
 *   annoyance  烦躁度    0..1    快速连点 → 急剧上升，超阈值则走开
 *   comfort    安心度    0..1    抚摸中持续上升，驱动"闭眼享受"
 *
 * ★ 为什么不做完整的多维情绪（MoodVector）：
 *   Milestone 2 的目标是"第一次觉得它是一只狗"。
 *   四个量已经足够驱动所有需要表现的东西。
 *   过度设计会稀释调参的可理解性 —— 数值越多，越难判断"该调哪个"。
 *
 * ★ 情绪不直接控制行为，而是输出一个「修饰表」（Modifiers）。
 *   状态机、动画层、过程动画层都从这张表读取。
 *   这样一处修改情绪，全身同步表现 —— 这是"生命感"的来源。
 *
 * 本文件不含任何犬种专属内容，数值来自 JSON。
 */

import type { AnnoyanceConfig, Temperament } from '../data/types';

export interface MoodModifiers {
  /** 兴奋度 0..1 —— 驱动尾巴摆幅、呼吸频率 */
  readonly arousal: number;
  /** 愉悦度 -1..1 —— 驱动尾巴基准角度（开心时翘高） */
  readonly valence: number;
  /** 烦躁度 0..1 —— 超过阈值触发走开 */
  readonly annoyance: number;
  /** 安心度 0..1 —— 高值 + 低刺激 → 闭眼享受 */
  readonly comfort: number;
  /** 输出给动画层的过程参数 */
  readonly procedural: {
    /** 呼吸频率倍率 */
    readonly breathRate: number;
    /** 尾巴摆幅倍率 */
    readonly tailAmplitude: number;
    /** 眨眼频率倍率 */
    readonly blinkRate: number;
  };
}

export interface MoodSnapshot {
  readonly valence: number;
  readonly arousal: number;
  readonly annoyance: number;
  readonly comfort: number;
}

export class MoodSystem {
  private config: AnnoyanceConfig;
  private temperament: Temperament;
  private annoyanceBias: Readonly<Partial<Record<keyof Temperament, { sensitivity: number }>>>;

  private valence = 0;
  private arousal = 0.12;
  private annoyance = 0;
  private comfort = 0;

  /**
   * 抚摸时间戳环形缓冲，用于"骚扰判定"。
   *
   * 为什么用时间窗口而不是简单计数：
   *   "连续点"的本质是**频率**，不是总数。
   *   慢慢摸十次是疼爱，快速点十次是骚扰 —— 必须区分。
   */
  private petTimestamps: number[] = [];

  constructor(
    config: AnnoyanceConfig,
    temperament: Temperament,
    annoyanceBias: Readonly<Partial<Record<keyof Temperament, { sensitivity: number }>>> = {},
  ) {
    this.config = config;
    this.temperament = temperament;
    this.annoyanceBias = annoyanceBias;
  }

  setConfig(
    config: AnnoyanceConfig,
    temperament: Temperament,
    annoyanceBias: Readonly<Partial<Record<keyof Temperament, { sensitivity: number }>>> = {},
  ): void {
    this.config = config;
    this.temperament = temperament;
    this.annoyanceBias = annoyanceBias;
  }

  snapshot(): MoodSnapshot {
    return {
      valence: this.valence,
      arousal: this.arousal,
      annoyance: this.annoyance,
      comfort: this.comfort,
    };
  }

  /** 烦躁是否已达"该走开了"的程度 */
  get shouldLeave(): boolean {
    return this.annoyance >= this.effectiveLeaveThreshold;
  }

  /**
   * 走开阈值（公开只读）。
   * 迁移表的守卫需要它来判断"烦躁到什么程度该表现不高兴"。
   */
  get leaveThreshold(): number {
    return this.effectiveLeaveThreshold;
  }

  /** 是否处于"被惹烦"状态（用于羁绊扣减判定） */
  get isAnnoyed(): boolean {
    return this.annoyance >= this.effectiveLeaveThreshold * 0.5;
  }

  /**
   * 当前烦躁值（公开只读）。
   * 迁移表的守卫用它判断"烦躁到什么程度该表现不高兴"。
   */
  get annoyanceLevel(): number {
    return this.annoyance;
  }

  /**
   * 有效烦躁阈值。
   *
   * 由性格修正：温柔的狗阈值更高（更能忍），固执的狗更低（更容易烦）。
   *
   *   threshold = leaveAt × ∏(1 + (性格值 - 0.5) × 敏感度 × 2)
   *
   * 灰盒默认（gentleness 0.5, stubbornness 0.5）→ 无修正，阈值 = 1.0。
   */
  private get effectiveLeaveThreshold(): number {
    let multiplier = 1;
    for (const [key, entry] of Object.entries(this.annoyanceBias)) {
      if (!entry) continue;
      const v = this.temperament[key as keyof Temperament];
      if (typeof v !== 'number') continue;
      multiplier *= 1 + (v - 0.5) * entry.sensitivity * 2;
    }
    // 夹紧：避免性格极端值让阈值变得荒谬
    multiplier = Math.min(3, Math.max(0.25, multiplier));
    return this.config.leaveAt * multiplier;
  }

  /**
   * 记录一次抚摸，并返回它是否构成"骚扰"。
   *
   * ★ 骚扰的判定单位是「抚摸**会话**」，不是「结算次数」。
   *
   *   为什么这个区分是必需的：
   *     一次 420ms 的温柔按住会结算约 4 次有效抚摸。
   *     若按结算次数计入窗口，玩家正常地"摸一会儿"就会被判成连点骚扰 ——
   *     实测表现为羁绊刚涨到 0.49 就崩回 0，玩家会觉得"它莫名其妙生气了"。
   *
   *   正确语义：**连续快速地一下一下点** 才是骚扰；
   *   按住久一点应当被鼓励。因此只有"新会话的第一次结算"才计入窗口。
   *
   * @param nowMs          当前逻辑时间
   * @param pleasure       本次抚摸带来的愉悦 0..1
   * @param arousalGain    兴奋增量
   * @param isSessionStart 是否为新一次抚摸会话的开始（决定是否计入骚扰窗口）
   */
  registerPet(
    nowMs: number,
    pleasure: number,
    arousalGain: number,
    isSessionStart: boolean,
  ): { annoying: boolean } {
    let annoying = false;

    if (isSessionStart) {
      // ① 记入时间窗口（只统计会话）
      this.petTimestamps.push(nowMs);
      this.pruneWindow(nowMs);
      const excess = Math.max(0, this.petTimestamps.length - this.config.threshold);
      annoying = excess > 0;

      if (annoying) {
        // 骚扰：烦躁上升、愉悦下降
        this.annoyance = clamp01(this.annoyance + this.config.annoyancePerExcess * excess);
        this.valence = clamp(this.valence - 0.28 * excess, -1, 1);
        this.comfort = clamp01(this.comfort - 0.35 * excess);
        // 骚扰会拉高兴奋（被烦到的狗会更激动），但不给愉悦
        this.arousal = clamp01(this.arousal + 0.18 * excess);
      }
    }

    if (!annoying) {
      // 正常抚摸：愉悦、兴奋、安心都上升
      this.valence = clamp(this.valence + pleasure, -1, 1);
      this.arousal = clamp01(this.arousal + arousalGain);
      this.comfort = clamp01(this.comfort + pleasure * 0.85);
      // 被温柔对待会缓解烦躁
      this.annoyance = clamp01(this.annoyance - 0.1);
    }

    return { annoying };
  }

  /**
   * 每逻辑帧推进情绪自然演化。
   *
   * 核心：所有情绪都会**自愈**回中性 ——
   *   arousal   → 缓慢回落到 0.1（平静）
   *   valence   → 缓慢回落到 0（中性）
   *   annoyance → 按配置衰减
   *   comfort   → 停止抚摸后缓慢回落
   *
   * 没有自愈，情绪就会永久累积，狗会"越摸越疯"或"永远生气"。
   *
   * @param nowMs 当前逻辑时间（毫秒）。用于清理过期的抚摸时间戳。
   *              ★ 必须由调用方传入，不能让本类自己猜 ——
   *                早期版本用"最后一次抚摸的时刻"当作 now，
   *                导致时间窗口永远不滑动，窗口内计数只增不减，
   *                摸几次之后狗就永久处于"被骚扰"状态。
   */
  update(dtSec: number, beingPetted: boolean, nowMs: number): void {
    // 兴奋度回落（被摸时保持在较高水平）
    const arousalTarget = beingPetted ? 0.55 : 0.1;
    this.arousal += (arousalTarget - this.arousal) * Math.min(1, dtSec * 0.9);

    // 愉悦度回落
    this.valence += (0 - this.valence) * Math.min(1, dtSec * 0.28);

    // 烦躁衰减
    this.annoyance = clamp01(this.annoyance - this.config.decayPerSec * dtSec);

    // 安心度：被摸时上升，否则回落
    if (beingPetted) {
      this.comfort = clamp01(this.comfort + dtSec * 0.75);
    } else {
      this.comfort = clamp01(this.comfort - dtSec * 0.42);
    }

    // 清理过期的抚摸时间戳（用真实当前时间滑动窗口）
    this.pruneWindow(nowMs);
  }

  /** 长时间无人理会时，情绪整体趋于平静 */
  calm(dtSec: number, nowMs: number): void {
    this.arousal += (0.08 - this.arousal) * Math.min(1, dtSec * 0.5);
    this.comfort = clamp01(this.comfort - dtSec * 0.5);
    this.annoyance = clamp01(this.annoyance - this.config.decayPerSec * dtSec);
    this.pruneWindow(nowMs);
  }

  /** 走开之后：清空时间窗口，让狗"消气"从零开始计 */
  beginSulk(): void {
    this.petTimestamps = [];
  }

  /**
   * 完全消气。
   *
   * 在「闹别扭」结束时调用，把烦躁与不悦一起平复。
   *
   * ★ 为什么需要这个"强制平复"而不是只靠自然衰减：
   *   annoyance 的自然衰减率很低（约 0.3/s），而 sulkMs 只有几秒。
   *   若不强制平复，闹别扭刚结束、烦躁仍高于阈值，
   *   狗会立刻再次走开，形成无限循环 ——
   *   玩家看到的是"它一直在生气，怎么哄都没用"。
   *
   *   保留一部分 arousal（它还是醒着的），
   *   但把负面情绪清零，给出"它原谅你了"的明确信号。
   */
  forgive(): void {
    this.annoyance = 0;
    this.valence = Math.max(0, this.valence);
    this.petTimestamps = [];
  }

  /** 切除比窗口更早的时间戳 */
  private pruneWindow(nowMs: number): void {
    const cutoff = nowMs - this.config.windowMs;
    // 时间戳单调递增，因此只需从头部剔除
    let i = 0;
    while (i < this.petTimestamps.length && this.petTimestamps[i]! < cutoff) i++;
    if (i > 0) this.petTimestamps.splice(0, i);
  }

  /**
   * 输出修饰表。
   *
   * ★ 这是情绪系统的唯一出口。
   *   状态机、动画层都从这里取值，因此"情绪影响表现"是单向且集中的。
   */
  modifiers(): MoodModifiers {
    // 兴奋 → 呼吸变快、尾巴摆幅变大、眨眼变多
    const breathRate = 1 + this.arousal * 0.85;
    const tailAmplitude = 0.35 + this.arousal * 0.9 + Math.max(0, this.valence) * 0.5;
    const blinkRate = 1 + this.arousal * 0.4 + this.annoyance * 0.8;

    return {
      arousal: this.arousal,
      valence: this.valence,
      annoyance: this.annoyance,
      comfort: this.comfort,
      procedural: { breathRate, tailAmplitude, blinkRate },
    };
  }
}

// ─────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
