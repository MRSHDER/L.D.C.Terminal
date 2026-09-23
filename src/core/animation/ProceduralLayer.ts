/**
 * L.D.C. — 过程动画层（ProceduralLayer）
 *
 * ★ 这是「素材最小化」的核心：呼吸 / 眨眼 / 耳朵抖动 / 尾巴摆动 / 上下浮动
 *   全部由代码生成，不占任何美术帧。
 *
 * 三层动画模型的第 3 层（最上层叠加）：
 *   Layer 3: Procedural（本文件）—— 代码生成，永远运行
 *   Layer 2: Transition          —— 状态切换过渡（Phase 5）
 *   Layer 1: Keyframe            —— 美术绘制的关键帧（Phase 5）
 *
 * 输出是一个「纯变换」，渲染层负责应用。本层不知道 Pixi 的存在。
 *
 * 关键解耦：本层使用独立 RNG 流（deriveRng），
 * 因此调试噪声不会改变逻辑层的行为序列。
 */

import type { SpeciesData } from '../data/types';
import type { Rng } from '../world/Rng';
import { createRng } from '../world/Rng';
import { NoiseOsc, PulseOsc, RandomInterval, SineOsc, smoothStep } from './oscillators';

/** 眨眼阶段。0 = 睁眼，1 = 全闭 */
export type BlinkPhase = 'open' | 'closing' | 'closed' | 'opening';

export interface ProceduralTransform {
  /** 整体垂直偏移（像素）—— 呼吸 + 浮动 */
  readonly offsetY: number;
  /** 整体水平偏移（像素）—— 极小的不规则摆动 */
  readonly offsetX: number;
  /** 身体纵向缩放（1.0 = 原尺寸）—— 呼吸 */
  readonly scaleY: number;
  /** 身体横向缩放（呼吸的反向补偿，保持体积感） */
  readonly scaleX: number;
  /** 整体旋转（度）—— 轻微倾斜 */
  readonly rotationDeg: number;
  /** 眨眼闭眼程度 0..1（0 全开，1 全闭） */
  readonly eyeClosure: number;
  readonly blinkPhase: BlinkPhase;
  /** 耳朵抖动角度（度），左右共用，符号由渲染层决定 */
  readonly earJitterDeg: number;
  /**
   * 尾巴各节的旋转角度（度）。
   * 长度 = species.animation.tail.segments。渲染层逐节应用，形成鞭状跟随。
   */
  readonly tailAnglesDeg: readonly number[];
  /** 眨眼是否刚刚发生（供音效/事件使用） */
  readonly blinkedThisFrame: boolean;
  /** 耳朵是否正在抖动 */
  readonly earTwitching: boolean;
}

export interface ProceduralContext {
  /** 是否正在移动 —— 移动时呼吸幅度加大、眨眼减少 */
  readonly moving: boolean;
  /** 速度归一化 0..1（0=静止，1=奔跑） */
  readonly speedRatio: number;
  /** 兴奋度 0..1。Phase 0/1 由速度推导；Phase 4 接入情绪系统 */
  readonly arousal: number;
  /** 清醒度 0..1。低值 → 眨眼变多、呼吸变慢变深 */
  readonly alertness: number;
}

const NEUTRAL_CONTEXT: ProceduralContext = {
  moving: false,
  speedRatio: 0,
  arousal: 0.2,
  alertness: 0.8,
};

export class ProceduralLayer {
  private species: SpeciesData;
  private readonly rng: Rng;

  // 振荡器
  private breathOsc: SineOsc;
  private floatOsc: SineOsc;
  private swayOsc: NoiseOsc;
  private tiltOsc: NoiseOsc;
  private earPulse: PulseOsc;
  private blinkTimer: RandomInterval;

  // 眨眼状态机（独立于主 FSM —— 眨眼是反射，不是"决策"）
  private blinkRemainingMs = 0;
  private blinkTotalMs = 0;
  private blinkClosing = false;
  private blinkedThisFrame = false;

  // 耳朵抖动触发计时
  private earTriggerAccumMs = 0;

  constructor(species: SpeciesData, seed: number) {
    this.species = species;
    // ★ 独立随机流：与逻辑层 RNG 完全隔离。
    //   这保证"开不开调试噪声"不会改变狗的行为序列（可复现性要求）。
    this.rng = createRng(seed ^ 0x5eed5eed);

    const a = species.animation;
    this.breathOsc = new SineOsc({ freqHz: a.breath.freqHz, amplitude: a.breath.ampPx });
    this.floatOsc = new SineOsc({ freqHz: a.float.freqHz, amplitude: a.float.ampPx, phase: 1.1 });
    this.swayOsc = new NoiseOsc({ freqHz: 0.31, amplitude: 0.9, seedPhase: 0.7 });
    this.tiltOsc = new NoiseOsc({ freqHz: 0.19, amplitude: 1.4, seedPhase: 2.1 });
    this.earPulse = new PulseOsc({ durationMs: 260, strength: 1 });
    this.blinkTimer = new RandomInterval(a.blink.baseIntervalMs, a.blink.varianceMs);
  }

  /** 运行时替换犬种数据（调试面板改 JSON 后立即生效） */
  setSpecies(species: SpeciesData): void {
    this.species = species;
    const a = species.animation;
    this.breathOsc.setFrequency(a.breath.freqHz);
    this.breathOsc.setAmplitude(a.breath.ampPx);
    this.floatOsc.setFrequency(a.float.freqHz);
    this.floatOsc.setAmplitude(a.float.ampPx);
    this.blinkTimer.setBase(a.blink.baseIntervalMs);
  }

  /**
   * 推进过程动画。
   * @param dtMs 逻辑帧时长（固定步长）
   * @param ctx  上下文（速度、兴奋度）
   */
  update(dtMs: number, ctx: ProceduralContext = NEUTRAL_CONTEXT): ProceduralTransform {
    const a = this.species.animation;
    const dtSec = dtMs / 1000;

    // ── 情绪耦合：兴奋 → 呼吸快而浅；困倦 → 呼吸慢而深 ──
    const breathSpeed = 1 + ctx.arousal * 0.85 - (1 - ctx.alertness) * 0.25;
    const breathAmpScale = 1 + ctx.arousal * 0.6 + (1 - ctx.alertness) * 0.8;

    this.breathOsc.advance(dtSec, Math.max(0.2, breathSpeed));
    this.floatOsc.advance(dtSec, Math.max(0.2, breathSpeed * 0.9));
    this.swayOsc.advance(dtSec);
    this.tiltOsc.advance(dtSec);

    const breath = this.breathOsc.value() * breathAmpScale;
    const floatY = this.floatOsc.value();
    const scaleY = 1 + (breath / Math.max(1, a.breath.ampPx)) * a.breath.bodyScaleY;

    // ── 眼部眨眼（反射，泊松式随机）──
    this.blinkedThisFrame = false;
    const blinkRate = 1 + (1 - ctx.alertness) * 1.6 + ctx.arousal * 0.4;
    this.blinkTotalMs = a.blink.durationMs;

    if (this.blinkRemainingMs > 0) {
      this.blinkRemainingMs = Math.max(0, this.blinkRemainingMs - dtMs);
    } else if (this.blinkTimer.advance(dtMs, () => this.rng.next(), blinkRate)) {
      this.blinkRemainingMs = this.blinkTotalMs;
      this.blinkClosing = true;
      this.blinkedThisFrame = true;
    }

    const t = this.blinkTotalMs > 0 ? 1 - this.blinkRemainingMs / this.blinkTotalMs : 0;
    let eyeClosure = 0;
    let blinkPhase: BlinkPhase = 'open';

    if (this.blinkRemainingMs > 0) {
      // 前半闭合（快），后半睁开（稍慢）
      if (t < 0.4) {
        eyeClosure = smoothStep(0, 0.4, t);
        blinkPhase = 'closing';
      } else {
        eyeClosure = 1 - smoothStep(0.4, 1, t);
        blinkPhase = t < 0.95 ? 'closed' : 'opening';
      }
      if (this.blinkClosing && t >= 0.4) this.blinkClosing = false;
    }

    // ── 耳朵抖动（低频随机脉冲）──
    this.earPulse.advance(dtMs);
    this.earTriggerAccumMs += dtMs;
    const earInterval = 1000 / Math.max(0.01, a.ear.triggerBias * 6);
    if (this.earTriggerAccumMs >= earInterval) {
      this.earTriggerAccumMs = 0;
      if (this.rng.chance(0.5)) this.earPulse.trigger(1);
    }
    const earJitterDeg = this.earPulse.value() * a.ear.jitterDeg;

    // ── 尾巴（分段延迟，产生鞭状跟随）──
    const tailSegments = Math.max(1, a.tail.segments);
    const swingAmplitude = a.tail.maxSwingDeg * (0.35 + ctx.arousal * 0.65 + ctx.speedRatio * 0.25);
    // 移动时摆得更快
    const tailFreq = 0.9 + ctx.arousal * 1.4 + ctx.speedRatio * 1.1;
    const tailPhase = (this.breathOsc.normalizedPhase + this.swayOsc.value() * 0.05) * tailFreq;

    const tailAngles: number[] = [];
    for (let i = 0; i < tailSegments; i++) {
      // 每节延迟：越靠后延迟越大 → 鞭状
      const segDelaySec = (i * a.tail.delayPerSegMs) / 1000;
      const segPhase = tailPhase - segDelaySec * tailFreq;
      const swing = Math.sin(segPhase * Math.PI * 2) * swingAmplitude;
      // 越靠后的节摆幅递减（能量衰减），避免整条尾巴刚性平移
      const attenuation = 1 / (1 + i * 0.28);
      // baseAngleDeg 是静态抬起角，造成"尾巴翘起"的姿态差异
      tailAngles.push(a.tail.baseAngleDeg + swing * attenuation);
    }

    return {
      offsetY: breath + floatY,
      offsetX: this.swayOsc.value() * 0.5,
      scaleY,
      scaleX: 1 - (scaleY - 1) * 0.35, // 体积补偿：纵向拉伸时横向略收
      rotationDeg: this.tiltOsc.value() * (0.4 + ctx.speedRatio * 0.5),
      eyeClosure,
      blinkPhase,
      earJitterDeg,
      tailAnglesDeg: tailAngles,
      blinkedThisFrame: this.blinkedThisFrame,
      earTwitching: this.earPulse.active,
    };
  }

  reset(): void {
    this.breathOsc.reset();
    this.floatOsc.reset();
    this.blinkTimer.reset();
    this.blinkRemainingMs = 0;
  }
}
