/**
 * L.D.C. — 固定步长游戏循环（GameLoop）
 *
 * 为什么必须固定步长：
 *   状态机里的计时器、冷却、注意力衰减如果依赖可变 dt，
 *   会在高刷新率设备上产生不同的行为结果 —— 对"档案"类项目是灾难。
 *
 * 结构：
 *   requestAnimationFrame（可变，负责节流与省电）
 *       ↓
 *   固定步长累加器（fixed dt，驱动所有逻辑）
 *       ↓
 *   渲染一次（读取最新逻辑状态，绝不修改状态）
 *
 * 停止策略：
 *   标签页隐藏时自动暂停（visibilitychange），避免后台累积与耗电。
 */

export interface GameLoopCallbacks {
  /** 固定步长逻辑更新。dt 永远是固定值（秒） */
  update(dtSec: number, tick: number): void;
  /** 渲染。只读状态，不得修改逻辑数据 */
  render(alpha: number, frameMs: number): void;
  /** 每次实际渲染后调用，用于 FPS 采样（可选） */
  onSample?(fps: number, frameMs: number): void;
}

export interface GameLoopOptions {
  /** 逻辑固定步长（秒）。默认 1/60 */
  fixedDtSec?: number;
  /** 单帧最多追赶的逻辑步数，防止"死亡螺旋" */
  maxStepsPerFrame?: number;
  /** 是否在标签页隐藏时自动暂停 */
  pauseOnHidden?: boolean;
}

export class GameLoop {
  private readonly fixedDtSec: number;
  private readonly maxStepsPerFrame: number;
  private readonly pauseOnHidden: boolean;
  private readonly callbacks: GameLoopCallbacks;

  private rafId: number | null = null;
  private lastTimeMs = 0;
  private accumulatorSec = 0;
  private tick = 0;

  private running = false;
  private paused = false;

  // FPS 采样
  private fpsWindowStartMs = 0;
  private fpsFrameCount = 0;

  private readonly onVisibilityChange = (): void => {
    if (!this.pauseOnHidden) return;
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      this.pause();
    } else if (this.running) {
      this.resume();
    }
  };

  constructor(callbacks: GameLoopCallbacks, options: GameLoopOptions = {}) {
    this.callbacks = callbacks;
    this.fixedDtSec = options.fixedDtSec ?? 1 / 60;
    this.maxStepsPerFrame = options.maxStepsPerFrame ?? 5;
    this.pauseOnHidden = options.pauseOnHidden ?? true;
  }

  get isRunning(): boolean {
    return this.running && !this.paused;
  }

  get currentTick(): number {
    return this.tick;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.lastTimeMs = performance.now();
    this.accumulatorSec = 0;
    this.fpsWindowStartMs = this.lastTimeMs;
    this.fpsFrameCount = 0;

    if (this.pauseOnHidden && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }

    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.paused = false;

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  /** 暂停：不推进逻辑也不渲染，但保留 tick 与累加器 */
  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /** 恢复：重置时间基准，避免把暂停时长算进 dt */
  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.lastTimeMs = performance.now();
    this.accumulatorSec = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  private readonly frame = (nowMs: number): void => {
    if (!this.running || this.paused) return;

    this.rafId = requestAnimationFrame(this.frame);

    let frameSec = (nowMs - this.lastTimeMs) / 1000;
    this.lastTimeMs = nowMs;

    // 防护：首个帧或长时间挂起
    if (!Number.isFinite(frameSec) || frameSec < 0) frameSec = 0;
    if (frameSec > 0.5) frameSec = 0.5;

    this.accumulatorSec += frameSec;

    // 固定步长更新
    let steps = 0;
    while (this.accumulatorSec >= this.fixedDtSec && steps < this.maxStepsPerFrame) {
      this.callbacks.update(this.fixedDtSec, this.tick);
      this.tick++;
      this.accumulatorSec -= this.fixedDtSec;
      steps++;
    }
    // 追不上就丢弃积压，防止死亡螺旋
    if (steps >= this.maxStepsPerFrame) this.accumulatorSec = 0;

    const alpha = this.accumulatorSec / this.fixedDtSec;
    const frameMs = frameSec * 1000;

    this.callbacks.render(alpha, frameMs);

    // FPS 采样（每 500ms 汇报一次，避免 UI 抖动）
    this.fpsFrameCount++;
    const windowMs = nowMs - this.fpsWindowStartMs;
    if (windowMs >= 500) {
      const fps = (this.fpsFrameCount * 1000) / windowMs;
      this.callbacks.onSample?.(fps, frameMs);
      this.fpsWindowStartMs = nowMs;
      this.fpsFrameCount = 0;
    }
  };
}
