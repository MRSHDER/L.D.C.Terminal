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

/**
 * 一次抚摸会话（按下 → 持续 → 抬起）的统计 */
export interface PettingSession {
  readonly startedAtMs: number;
  /** 累计有效抚摸时长 */
  accumulatedMs: number;
  /** 已经结算过的抚摸次数（0 或 1） */
  settledPets: number;
  /** 上次结算时的累计时长，用于判断是否又攒够一次 */
  lastSettleAtMs: number;
  /** 是否摸在狗身上（没摸到就不算） */
  onTarget: boolean;
  /**
   * 结算时记录的按住时长（ms）。
   *
   * ★ 为什么必须在这里定格一个快照（Alpha 打磨修正）：
   *
   *   `effectiveness` 依赖"按了多久"，而结算发生在累计时长
   *   刚越过 minEffectiveMs（90ms）的**那一刻** ——
   *   此时按住时长只有 ~95ms，算出有效性 0.26。
   *   玩家实际按了 420ms，但有效性在结算瞬间就被定死了。
   *
   *   实测症状：每次抚摸的 effective 恒为 0.278，
   *   羁绊涨得极慢，10 次抚摸才到 0.30（阶梯第一级）。
   *
   *   修正：结算时只记录"这一次抚摸开始了"，
   *   真正的有效性在**抬手时**根据总时长计算并补足差额。
   *   这样"按得越久越认真"才真正生效。
   */
  settledHeldMs: number;
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
      settledHeldMs: 0,
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
    if (s) {
      // ★ 抬手时定格最终按住时长 —— 让 effectiveness 反映**完整**的一次抚摸，
      //   而不是"结算那一刻"的时长。详见 PettingSession.settledHeldMs 的说明。
      s.settledHeldMs = s.accumulatedMs;
    }
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
   * ★★★ Alpha 打磨修正：一次按住 = 一次抚摸，且有效性在**抬手时**计算 ★★★
   *
   * ── 两个连续发现的问题 ──
   *
   * 问题 1（次数虚增）：
   *   原实现"每累计 minEffectiveMs 算一次抚摸"，
   *   玩家按住 700ms 这一个自然动作被结算成 7 次 ——
   *   羁绊一次涨 0.85，两次按住就满级。
   *   玩家会无意中发现"狂按比慢慢摸快得多"，行为被引导到错误方向。
   *
   * 问题 2（有效性被截断）：
   *   改为"一次会话只结算一次"之后，结算发生在累计时长
   *   刚越过 minEffectiveMs（90ms）的那一刻 ——
   *   此时算出的有效性只有 0.26，而玩家实际按了 420ms。
   *   实测每次抚摸的 effective 恒为 0.278，10 次才到 0.30 羁绊。
   *
   * ── 正确模型：结算推迟到抬手 ──
   *
   *   按下期间只累加时长，**不发放羁绊**；
   *   抬手时用完整时长算有效性，发放一次。
   *
   *   这样两个问题同时解决：
   *     一次按住 = 一次抚摸（不虚增）
   *     有效性反映完整时长（不被截断）
   *
   *   副作用：抚摸的反馈延迟到抬手才结算。
   *   但**表现层的反馈是即时的** —— 状态机在被按住的第一帧
   *   就会进入 LookAt/Approach（见 interactionTransitions），
   *   所以玩家感受到的响应速度不受影响。
   *
   * @returns 本次会话是否达到"有效抚摸"的最低时长
   */
  settlePets(): number {
    const s = this.session;
    if (!s) return 0;
    if (s.settledPets > 0) return 0;

    const minEffective = this.species.affection.petting.minEffectiveMs;
    // 未达最低时长 → 不算（抬手时由轻点补偿处理）
    if (minEffective > 0 && s.accumulatedMs < minEffective) return 0;

    s.settledPets = 1;
    return 1;
  }

  /**
   * 本次抚摸会话是否已经产生过结算。
   *
   * 用途：抬手时的"轻点补偿"只应在**没有**产生过结算时才发放 ——
   *   轻点一下（未达 minEffectiveMs）→ 补一次，让轻点也有回应
   *   已经结算过 → 不再重复发放
   */
  hasSettled(): boolean {
    return (this.session?.settledPets ?? 0) > 0;
  }

  /** 当前会话已结算的次数（0 或 1） */
  get settledCount(): number {
    return this.session?.settledPets ?? 0;
  }

  /**
   * 抚摸有效性：按住越久，这一下的分量越重（上限 1）。
   *
   * ★ 这是"长按更亲密"的**唯一**表达通道（修正后）。
   *
   *   修正前，长按通过"结算成多次抚摸"来放大效果 ——
   *   但那是虚增次数，会让玩家发现"狂按涨得快"这种错误引导。
   *   现在一次按住只算一次，其"认真程度"由本函数决定：
   *
   *     60ms（戳一下）   → 0.17  敷衍
   *     200ms（随手摸）  → 0.56
   *     360ms（正常摸）  → 1.00  认真
   *     1s+（温柔长摸）  → 1.00（封顶，超出部分转化为"享受"表现）
   *
   *   按住 1 秒即达满分：再久也只是享受，不该无限放大羁绊。
   */
  effectiveness(heldMs: number): number {
    const minEffective = this.species.affection.petting.minEffectiveMs;
    if (minEffective <= 0) return 1;
    // 达到 minEffectiveMs × 4（灰盒为 360ms）即满有效性
    return Math.min(1, heldMs / Math.max(1, minEffective * 4));
  }

  /** 强制结束当前抚摸（如狗走开了） */
  cancel(): void {
    this.session = null;
  }
}
