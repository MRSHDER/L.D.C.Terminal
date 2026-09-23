/**
 * L.D.C. — 像素节拍器（FrameClock）
 *
 * 核心思想：8~12FPS 是「意图」，不是性能妥协。
 * 因此逻辑层以固定步长运行，渲染层以可变频率运行，
 * 而「像素帧推进」由本类按 targetFps 量化。
 *
 * 关键：逻辑每帧调用 shouldAdvance()，只有返回 true 时才推进像素帧。
 * 这保证：
 *   - 在 144Hz 屏幕上不会动画加速
 *   - 在 30Hz 低端平板上不会动画减速
 *   - 帧率改变时不需要重启任何状态
 */

export interface FrameClockOptions {
  /** 目标像素帧率。整个引擎的"心跳"由它定义 */
  targetFps: number;
  /**
   * 单帧最多推进几个像素帧。
   * 防止标签页切回时一次性补间几百帧导致动画瞬移。
   */
  maxCatchUpSteps?: number;
}

export class FrameClock {
  private targetFps: number;
  private readonly maxCatchUpSteps: number;

  private accumulatorMs = 0;
  private advancedSteps = 0;
  private totalSteps = 0;

  constructor(options: FrameClockOptions) {
    this.targetFps = Math.max(1, options.targetFps);
    this.maxCatchUpSteps = options.maxCatchUpSteps ?? 3;
  }

  /** 当前目标帧率 */
  get fps(): number {
    return this.targetFps;
  }

  /** 每像素帧的毫秒数 */
  get stepMs(): number {
    return 1000 / this.targetFps;
  }

  /**
   * ★ 运行时改变帧率 —— 这是"改 JSON 动画速度立即生效"的入口。
   * 不重置累加器，因此变速不会产生跳帧。
   */
  setTargetFps(fps: number): void {
    this.targetFps = Math.max(1, fps);
  }

  /**
   * 推进时钟。
   * @returns 本次应推进的像素帧数（0 表示保持当前帧）
   */
  advance(dtMs: number): number {
    // 负值或 NaN 防护
    if (!Number.isFinite(dtMs) || dtMs <= 0) return 0;

    this.accumulatorMs += dtMs;

    const step = this.stepMs;
    let steps = Math.floor(this.accumulatorMs / step);
    if (steps <= 0) return 0;

    // 超量补帧保护
    if (steps > this.maxCatchUpSteps) {
      steps = this.maxCatchUpSteps;
      this.accumulatorMs = 0;
    } else {
      this.accumulatorMs -= steps * step;
    }

    this.advancedSteps = steps;
    this.totalSteps += steps;
    return steps;
  }

  /** 上次 advance 推进的像素帧数 */
  get lastSteps(): number {
    return this.advancedSteps;
  }

  /** 自创建以来累计推进的像素帧数 */
  get steps(): number {
    return this.totalSteps;
  }

  /** 累加器内尚未消费的毫秒数，供插值使用 */
  get fractionalMs(): number {
    return this.accumulatorMs;
  }

  /**
   * 像素帧内插值系数 0..1。
   * 用于让低帧率动画在渲染层平滑（可选）。灰盒阶段不使用 —— 我们要的就是硬帧。
   */
  get alpha(): number {
    return this.accumulatorMs / this.stepMs;
  }

  reset(): void {
    this.accumulatorMs = 0;
    this.advancedSteps = 0;
  }
}
