/**
 * L.D.C. — 手势识别（GestureRecognizer）
 *
 * 把原始指针事件翻译成**有语义的手势**：
 *
 *   轻触（tap）       —— 快速按下并抬起
 *   长按（hold）      —— 按住超过阈值并保持不动，进入"持续抚摸"
 *   抚摸（stroke）    —— 按住并移动（在狗身上来回蹭）
 *   连点（rapidTap）  —— 快速反复轻触 → 骚扰
 *
 * ★ 为什么要专门做这一层：
 *   如果让世界直接处理 pointerdown/up，那么"轻轻点一下"和
 *   "按住温柔地摸"会变成同一件事 —— 而这两者的体验差距，
 *   正是"这是一只狗"和"这是一个按钮"的分界线。
 *
 * ★ 本层只负责**识别**，不判断狗该怎么反应。
 *   识别结果交给 World → 由数据和状态机决定表现。
 */

import type { PointerSample } from './PointerAdapter';

export type GestureKind = 'tap' | 'hold' | 'stroke';

export interface Gesture {
  readonly kind: GestureKind;
  /** 手势发生的世界坐标 */
  readonly x: number;
  readonly y: number;
  /** 持续时长（ms）。tap 为按下到抬起的间隔 */
  readonly durationMs: number;
  /** 移动距离（像素）。用于区分"按住不动"与"来回抚摸" */
  readonly travelPx: number;
  /** 是否为连续快速点击中的一次 */
  readonly rapid: boolean;
  /** 这是连续快速点击中的第几次（从 1 开始） */
  readonly rapidIndex: number;
  readonly atMs: number;
}

export interface GestureRecognizerOptions {
  /** 超过该时长（且未移动）算长按 */
  readonly holdThresholdMs: number;
  /** 移动超过该距离就算"抚摸"而非"长按" */
  readonly strokeThresholdPx: number;
  /** 两次轻触间隔小于该值算"连点" */
  readonly rapidWindowMs: number;
  /** 连续多少次轻触算骚扰 */
  readonly rapidCount: number;
}

export const DEFAULT_GESTURE_OPTIONS: GestureRecognizerOptions = {
  holdThresholdMs: 260,
  strokeThresholdPx: 6,
  rapidWindowMs: 900,
  rapidCount: 4,
};

interface ActivePointer {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startMs: number;
  /** 累计移动距离 */
  travelPx: number;
  /** 是否已开始报告持续抚摸心跳 */
  pettingStarted: boolean;
  /** 上次心跳的时刻，用于节流 */
  lastTickMs: number;
}

/** 持续抚摸心跳的间隔（ms）。约 20Hz，足够驱动安心度累积。 */
const PETTING_TICK_INTERVAL_MS = 50;

export interface GestureRecognizerCallbacks {
  /**
   * 手势完成时触发。
   *
   * 注意 tap 只在**抬起时**才产生 —— 因为按下时我们还不知道
   * 玩家是要轻点、还是准备按住抚摸。
   */
  onGesture(gesture: Gesture): void;

  /**
   * 持续抚摸的每帧心跳（按住不动或移动时持续触发）。
   *
   * ★ 这是"长按 = 享受"的关键：
   *   单次 tap 只能表达"碰了一下"，
   *   而持续抚摸能让安心度（comfort）不断累积，
   *   最终驱动"闭眼享受"这个状态。
   */
  onPettingTick(info: {
    readonly x: number;
    readonly y: number;
    readonly heldMs: number;
    readonly isStroking: boolean;
  }): void;
}

export class GestureRecognizer {
  private readonly options: GestureRecognizerOptions;
  private readonly callbacks: GestureRecognizerCallbacks;

  private active: ActivePointer | null = null;

  /** 最近若干次轻触的时刻，用于连点判定 */
  private recentTaps: number[] = [];

  constructor(
    callbacks: GestureRecognizerCallbacks,
    options: Partial<GestureRecognizerOptions> = {},
  ) {
    this.callbacks = callbacks;
    this.options = { ...DEFAULT_GESTURE_OPTIONS, ...options };
  }

  get isPressed(): boolean {
    return this.active !== null;
  }

  /** 当前按压已持续多久（未按下时为 0） */
  heldMs(nowMs: number): number {
    return this.active ? nowMs - this.active.startMs : 0;
  }

  onDown(sample: PointerSample, nowMs: number): void {
    // 已有活动指针时忽略新的按下（Milestone 2 只支持单点）
    if (this.active) return;

    this.active = {
      pointerId: sample.pointerId,
      startX: sample.x,
      startY: sample.y,
      lastX: sample.x,
      lastY: sample.y,
      startMs: nowMs,
      travelPx: 0,
      pettingStarted: false,
      lastTickMs: 0,
    };
  }

  onMove(sample: PointerSample, nowMs: number): void {
    const a = this.active;
    if (!a || a.pointerId !== sample.pointerId) return;

    const dx = sample.x - a.lastX;
    const dy = sample.y - a.lastY;
    a.travelPx += Math.hypot(dx, dy);
    a.lastX = sample.x;
    a.lastY = sample.y;

    // 移动本身不产生手势 —— 统一由 update() 的心跳驱动持续抚摸。
    // 这里只更新坐标与累计距离。
    void nowMs;
  }

  onUp(sample: PointerSample, nowMs: number): void {
    const a = this.active;
    if (!a || a.pointerId !== sample.pointerId) return;
    this.active = null;

    const durationMs = nowMs - a.startMs;

    // ── 分类 ──
    let kind: GestureKind;
    if (a.travelPx >= this.options.strokeThresholdPx) {
      kind = 'stroke';
    } else if (durationMs >= this.options.holdThresholdMs) {
      kind = 'hold';
    } else {
      kind = 'tap';
    }

    // ── 连点判定（只对 tap 生效）──
    let rapid = false;
    let rapidIndex = 0;
    if (kind === 'tap') {
      this.recentTaps = this.recentTaps.filter(
        (t) => nowMs - t <= this.options.rapidWindowMs,
      );
      this.recentTaps.push(nowMs);
      rapidIndex = this.recentTaps.length;
      rapid = rapidIndex >= this.options.rapidCount;
    } else {
      // 非 tap 手势会打断连点节奏
      this.recentTaps = [];
    }

    this.callbacks.onGesture({
      kind,
      x: a.lastX,
      y: a.lastY,
      durationMs,
      travelPx: a.travelPx,
      rapid,
      rapidIndex,
      atMs: nowMs,
    });
  }

  onCancel(sample: PointerSample): void {
    if (this.active && this.active.pointerId === sample.pointerId) {
      this.active = null;
    }
  }

  /**
   * 每逻辑帧调用一次。
   *
   * 作用：让「按住不动」也能持续产生抚摸心跳。
   * 没有这一步，玩家按住不动时狗只会收到一次 hold 手势，
   * 安心度涨不上去，"闭眼享受"就永远触发不了。
   *
   * 心跳节流到 ~20Hz：逻辑帧是 60Hz，但安心度的累积是连续的，
   * 20Hz 足够平滑，同时避免每帧都做一次情绪计算。
   */
  update(nowMs: number): void {
    const a = this.active;
    if (!a) return;

    // 未达到长按阈值 → 还只是"按着"，不算抚摸
    if (nowMs - a.startMs < this.options.holdThresholdMs) return;

    // 心跳节流
    if (a.pettingStarted && nowMs - a.lastTickMs < PETTING_TICK_INTERVAL_MS) return;

    a.pettingStarted = true;
    a.lastTickMs = nowMs;

    // isStroking：累计移动已超过阈值，说明玩家在来回抚摸而非静止按住
    const isStroking = a.travelPx >= this.options.strokeThresholdPx;

    this.callbacks.onPettingTick({
      x: a.lastX,
      y: a.lastY,
      heldMs: nowMs - a.startMs,
      isStroking,
    });
  }

  /** 清空连点记录（用于"走开"之后重置节奏） */
  resetTapHistory(): void {
    this.recentTaps = [];
  }
}
