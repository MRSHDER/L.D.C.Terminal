/**
 * L.D.C. — 过程动画振荡器（Oscillators）
 *
 * 设计目标：不占素材地产生「生命感」。
 *
 * 三种振荡器：
 *   SineOsc  —— 呼吸、浮动的基频，平滑可预测
 *   NoiseOsc —— 有机噪声（多正弦叠加），避免机械感
 *   PulseOsc —— 触发式脉冲，用于耳朵抖动等"偶尔发生"的动作
 *
 * ★ 全部为纯函数/无状态类，不依赖事件总线，便于单元测试。
 */

/** 有机噪声：多个不可通约频率的正弦叠加，视觉上不呈现周期感 */
export function organicNoise(t: number, seedPhase = 0): number {
  const a = Math.sin(t * 1.13 + seedPhase);
  const b = Math.sin(t * 2.71 + seedPhase * 1.7) * 0.5;
  const c = Math.sin(t * 4.37 + seedPhase * 2.3) * 0.25;
  // 归一化到 -1..1
  return (a + b + c) / 1.75;
}

/** 平滑方波（近似），用于需要"两态但不要突变"的场合 */
export function smoothStep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export interface SineOscOptions {
  /** 频率 Hz */
  freqHz: number;
  /** 振幅（单位由调用方决定：像素或度） */
  amplitude: number;
  /** 相位偏移（弧度） */
  phase?: number;
  /** 中心偏移量 */
  offset?: number;
}

/** 正弦振荡器。呼吸、身体浮动的基础。 */
export class SineOsc {
  private freqHz: number;
  private amplitude: number;
  private phase: number;
  private offset: number;
  private elapsedSec = 0;

  constructor(options: SineOscOptions) {
    this.freqHz = options.freqHz;
    this.amplitude = options.amplitude;
    this.phase = options.phase ?? 0;
    this.offset = options.offset ?? 0;
  }

  advance(dtSec: number, speedMultiplier = 1): void {
    this.elapsedSec += dtSec * speedMultiplier;
  }

  value(): number {
    return this.offset + Math.sin(this.elapsedSec * Math.PI * 2 * this.freqHz + this.phase) * this.amplitude;
  }

  /** 当前相位 0..1（用于驱动其他系统，如尾巴分段延迟） */
  get normalizedPhase(): number {
    const p = this.elapsedSec * this.freqHz + this.phase / (Math.PI * 2);
    return p - Math.floor(p);
  }

  setFrequency(hz: number): void {
    this.freqHz = hz;
  }

  setAmplitude(a: number): void {
    this.amplitude = a;
  }

  reset(): void {
    this.elapsedSec = 0;
  }
}

/** 噪声振荡器。产生不规则的微浮动，避免"机器狗"感。 */
export class NoiseOsc {
  private freqHz: number;
  private amplitude: number;
  private seedPhase: number;
  private elapsedSec = 0;

  constructor(options: { freqHz: number; amplitude: number; seedPhase?: number }) {
    this.freqHz = options.freqHz;
    this.amplitude = options.amplitude;
    this.seedPhase = options.seedPhase ?? 0;
  }

  advance(dtSec: number): void {
    this.elapsedSec += dtSec;
  }

  value(): number {
    return organicNoise(this.elapsedSec * this.freqHz * Math.PI * 2, this.seedPhase) * this.amplitude;
  }
}

export interface PulseConfig {
  /** 触发后脉冲持续时间（ms） */
  durationMs: number;
  /** 强度 0..1 */
  strength: number;
}

/**
 * 脉冲振荡器。用于"偶尔发生"的动作：耳朵抖动、打哈欠、甩头。
 * 与 NoiseOsc 的区别：它是事件驱动的非周期脉冲，而不是连续噪声。
 */
export class PulseOsc {
  private readonly durationMs: number;
  private strength: number;
  private remainingMs = 0;

  constructor(config: PulseConfig) {
    this.durationMs = Math.max(16, config.durationMs);
    this.strength = config.strength;
  }

  trigger(strength?: number): void {
    this.remainingMs = this.durationMs;
    if (strength !== undefined) this.strength = strength;
  }

  advance(dtMs: number): void {
    if (this.remainingMs <= 0) return;
    this.remainingMs = Math.max(0, this.remainingMs - dtMs);
  }

  get active(): boolean {
    return this.remainingMs > 0;
  }

  /**
   * 当前脉冲值 -1..1。
   * 使用「快出慢回」包络：起手陡、回落缓，更像生物反射。
   */
  value(): number {
    if (this.remainingMs <= 0) return 0;
    const t = 1 - this.remainingMs / this.durationMs; // 0 → 1
    // 攻击段 0..0.15 快速上升，之后指数回落
    const envelope = t < 0.15 ? t / 0.15 : Math.exp(-(t - 0.15) * 4.5);
    // 脉冲内部再叠一层高频，产生"抖动"而非"滑动"
    const wobble = Math.sin(t * Math.PI * 6);
    return envelope * wobble * this.strength;
  }
}

/**
 * 泊松式随机间隔生成器。
 * 用于眨眼：真实动物的眨眼间隔不是固定周期，而是随机事件。
 */
export class RandomInterval {
  private baseMs: number;
  private readonly varianceMs: number;
  private nextAtMs: number;
  private elapsedMs = 0;

  constructor(baseMs: number, varianceMs: number) {
    this.baseMs = baseMs;
    this.varianceMs = varianceMs;
    this.nextAtMs = baseMs;
  }

  /** 推进并返回"本次是否触发" */
  advance(dtMs: number, random: () => number, rateMultiplier = 1): boolean {
    this.elapsedMs += dtMs * rateMultiplier;
    if (this.elapsedMs < this.nextAtMs) return false;

    this.elapsedMs = 0;
    // 区间：base ± variance，并保证不为负
    const lo = Math.max(50, this.baseMs - this.varianceMs);
    const hi = this.baseMs + this.varianceMs;
    this.nextAtMs = lo + random() * (hi - lo);
    return true;
  }

  setBase(baseMs: number): void {
    this.baseMs = baseMs;
  }

  reset(): void {
    this.elapsedMs = 0;
    this.nextAtMs = this.baseMs;
  }
}
