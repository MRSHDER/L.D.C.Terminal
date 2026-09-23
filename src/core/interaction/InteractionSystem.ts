/**
 * L.D.C. — 交互系统（InteractionSystem）
 *
 * 职责：把手势翻译成「对狗做了什么」，并维护"正在被抚摸"的持续状态。
 *
 *   Gesture  →  InteractionSystem  →  World
 *                    │
 *                    ├─ 命中检测（摸到了吗？）
 *                    ├─ 抚摸持续时间累计
 *                    └─ 发出 pet-start / pet-tick / pet-end
 *
 * ★ 与 GestureRecognizer 的分工：
 *   GestureRecognizer  只知道"玩家做了什么动作"
 *   InteractionSystem  才知道"这个动作落在狗身上意味着什么"
 *   世界与状态机   决定"狗怎么回应"
 *
 *   三层清晰分离，因此换输入设备（鼠标→触摸→手柄）只需改第一层。
 *
 * Milestone 2 的命中检测刻意做得**宽容**：
 *   狗只有 48×36 像素，但可点击区域扩展了 padding。
 *   理由是玩家在触摸屏上用手指点，精度远低于鼠标；
 *   点不中会让人以为"它不理我"，而不是"我点偏了" ——
 *   这个区别直接决定"它是一只狗"还是"它是个坏按钮"。
 */

import type { SpeciesData } from '../data/types';
import { resolveGrayboxSize } from '../data/defaults';

export interface HitArea {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface InteractionConfig {
  /**
   * 命中检测的额外宽容边距（像素）。
   *
   * 12px 意味着实际可点区域比灰盒大一圈。
   * 触摸设备上这个值应该更大（见 resolveHitPadding）。
   */
  readonly hitPaddingPx: number;
  /** 触摸指针额外增加的宽容（手指比鼠标粗） */
  readonly touchBonusPx: number;
}

export const DEFAULT_INTERACTION_CONFIG: InteractionConfig = {
  hitPaddingPx: 12,
  touchBonusPx: 16,
};

/** 一次抚摸会话（按下 → 持续 → 抬起）的统计 */
export interface PettingSession {
  readonly startedAtMs: number;
  /** 累计有效抚摸时长 */
  accumulatedMs: number;
  /** 已经结算过的抚摸次数（每次达到一个"有效抚摸"单位就 +1） */
  settledPets: number;
  /** 上次结算时的累计时长，用于判断是否又攒够一次 */
  lastSettleAtMs: number;
  /** 是否摸在狗身上（没摸到就不算） */
  onTarget: boolean;
}

export interface PettingEvent {
  /** 世界坐标 */
  readonly x: number;
  readonly y: number;
  /** 本次抚摸的"有效性" 0..1 —— 摸得越久越有效 */
  readonly effectiveness: number;
  /** 累计抚摸时长 */
  readonly heldMs: number;
  readonly isStroking: boolean;
}

export class InteractionSystem {
  private config: InteractionConfig;
  private species: SpeciesData;

  private session: PettingSession | null = null;

  /** 最近一次指针位置（用于渲染"手"的位置，或调试） */
  private pointerX = 0;
  private pointerY = 0;
  private pointerDown = false;

  constructor(species: SpeciesData, config: InteractionConfig = DEFAULT_INTERACTION_CONFIG) {
    this.species = species;
    this.config = config;
  }

  setSpecies(species: SpeciesData): void {
    this.species = species;
  }

  get isPetting(): boolean {
    return this.session !== null;
  }

  get pettingHeldMs(): number {
    return this.session?.accumulatedMs ?? 0;
  }

  get pointerPosition(): { x: number; y: number } {
    return { x: this.pointerX, y: this.pointerY };
  }

  get isPointerDown(): boolean {
    return this.pointerDown;
  }

  /** 狗当前的世界碰撞盒（含命中宽容） */
  hitArea(dogX: number, dogY: number, isTouch = false): HitArea {
    const size = resolveGrayboxSize(this.species);
    const padding =
      this.config.hitPaddingPx + (isTouch ? this.config.touchBonusPx : 0);

    // 灰盒的锚点在底部中心（anchorY 表示"脚"的位置）
    const w = size.w;
    const h = size.h;

    return {
      x: dogX - w / 2 - padding,
      y: dogY - h - padding,
      w: w + padding * 2,
      h: h + padding * 2,
    };
  }

  /** 点是否落在狗身上 */
  hitsDog(px: number, py: number, dogX: number, dogY: number, isTouch = false): boolean {
    const a = this.hitArea(dogX, dogY, isTouch);
    return px >= a.x && px <= a.x + a.w && py >= a.y && py <= a.y + a.h;
  }

  // ───────────────────────────────────────────────
  // 指针生命周期
  // ───────────────────────────────────────────────

  pointerDownAt(x: number, y: number, atMs: number, isTouch: boolean, dogX: number, dogY: number): boolean {
    this.pointerX = x;
    this.pointerY = y;
    this.pointerDown = true;

    const onTarget = this.hitsDog(x, y, dogX, dogY, isTouch);
    if (!onTarget) {
      this.session = null;
      return false;
    }

    this.session = {
      startedAtMs: atMs,
      accumulatedMs: 0,
      settledPets: 0,
      lastSettleAtMs: atMs,
      onTarget: true,
    };
    return true;
  }

  /**
   * 指针移动到新位置。
   *
   * ★ 注意这里**不**累计时长 —— 时长统一由 update() 按逻辑帧推进。
   *   早期版本在 move 与 update 两处都累加，导致按住时间被双倍计算，
   *   玩家只按了 0.5 秒，羁绊却按 1 秒结算 —— 阶梯被提前踩完。
   *   时间只应有一个推进来源。
   */
  pointerMoveTo(x: number, y: number, isTouch: boolean, dogX: number, dogY: number): void {
    this.pointerX = x;
    this.pointerY = y;

    if (!this.session) return;

    // 手指/鼠标滑出狗的范围 → 结束本次抚摸（但指针仍按下）
    if (!this.hitsDog(x, y, dogX, dogY, isTouch)) {
      this.session = null;
    }
  }

  pointerUpAt(atMs: number): PettingSession | null {
    this.pointerDown = false;
    void atMs;
    const s = this.session;
    this.session = null;
    return s;
  }

  /** 每逻辑帧推进：累计按住时长（时长的唯一推进来源） */
  update(nowMs: number): void {
    const s = this.session;
    if (!s) return;
    s.accumulatedMs += Math.max(0, nowMs - s.lastSettleAtMs);
    s.lastSettleAtMs = nowMs;
  }

  /**
   * 结算「有效抚摸」。
   *
   * ★ 这是"轻轻点一下"与"按住温柔地摸"的分界线，也是 Milestone 2 的体验核心。
   *
   * 规则：每累计 minEffectiveMs 毫秒算一次有效抚摸。
   *   轻点（<90ms）   → 0 次结算，但仍算"碰了一下"（由 tap 手势处理）
   *   按住 420ms      → 约 4 次结算，羁绊显著上升
   *   按住 2 秒       → 约 22 次结算 → 迅速走完阶梯并触发闭眼享受
   *
   * ★ 为什么反馈用"次数"而不是"一个累积量"：
   *   抚摸是有节奏的动作。一次抚摸 = 一次心跳，
   *   这既符合"摸一下"的直觉，也让骚扰判定（单位时间内的次数）
   *   有明确的计量单位。若只累积一个 0..1 的量，
   *   "摸得快"与"摸得慢"就无法区分，骚扰机制也就无法成立。
   *
   * @returns 本次新结算的有效抚摸次数
   */
  settlePets(): number {
    const s = this.session;
    if (!s) return 0;

    const minEffective = this.species.affection.petting.minEffectiveMs;
    if (minEffective <= 0) return 0;

    const earned = Math.floor(s.accumulatedMs / minEffective);
    const fresh = earned - s.settledPets;
    if (fresh <= 0) return 0;

    s.settledPets = earned;
    return fresh;
  }

  /**
   * 本次抚摸会话是否已经产生过结算。
   *
   * 用途：抬手时的"收尾奖励"只应在**没有**产生过结算时才发放。
   *   轻点一下（未达 minEffectiveMs）→ 给一次补偿，让轻点也有回应
   *   按住很久 → 已结算多次，不再额外发放（避免 420ms 被算成 5 次，
   *              瞬间触发骚扰阈值 —— 这个 bug 让"温柔地摸"被判成骚扰）
   */
  hasSettled(): boolean {
    return (this.session?.settledPets ?? 0) > 0;
  }

  /** 当前会话已结算的次数 */
  get settledCount(): number {
    return this.session?.settledPets ?? 0;
  }

  /** 抚摸有效性：按住越久，单次抚摸的价值越高（上限 1） */
  effectiveness(heldMs: number): number {
    const minEffective = this.species.affection.petting.minEffectiveMs;
    if (minEffective <= 0) return 1;
    // 按住 1 秒即达到满有效性
    return Math.min(1, heldMs / Math.max(1, minEffective * 4));
  }

  /** 强制结束当前抚摸（如狗走开了） */
  cancel(): void {
    this.session = null;
  }
}
