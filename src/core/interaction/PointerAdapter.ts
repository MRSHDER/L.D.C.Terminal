/**
 * L.D.C. — 指针适配器（PointerAdapter）
 *
 * 把 Mouse / Touch / Pen 事件归一化成统一的指针事件流。
 *
 * ★ 为什么从第一天就要做这层：
 *   项目最终运行在浏览器、Windows、触摸显示器、平板。
 *   如果业务代码直接读 MouseEvent，将来接触摸就要到处改。
 *   这里一次适配，上层永远只看到 PointerEvent。
 *
 * 覆盖的现实问题：
 *   - 触摸设备的「幽灵点击」：touchend 后浏览器会补发一次 click
 *   - 多指同时操作（孩子可能两只手一起摸）
 *   - 鼠标右键/中键不应触发抚摸
 *   - 拖拽时的浏览器默认行为（选中文本、滚动手势）
 */

export interface PointerSample {
  readonly x: number;
  readonly y: number;
  /** 逻辑时间（毫秒） */
  readonly atMs: number;
  readonly pointerId: number;
  readonly isPrimary: boolean;
  /**
   * 指针类型。
   *
   * ★ 触摸与鼠标的差别必须传下去，因为它影响**命中宽容**：
   *   手指比鼠标指针粗得多，如果两者用同样的判定区域，
   *   触摸用户会觉得"点不中" —— 而"点不中"会被理解成"它不理我"，
   *   不是"我点偏了"。这个归因差异直接决定体验成败。
   */
  readonly pointerType: 'mouse' | 'touch' | 'pen';
}

export interface PointerAdapterCallbacks {
  onDown(sample: PointerSample): void;
  onMove(sample: PointerSample): void;
  onUp(sample: PointerSample): void;
  onCancel(sample: PointerSample): void;
}

export interface PointerAdapterOptions {
  /**
   * 是否只接受主指针（第一根手指 / 鼠标左键）。
   *
   * Milestone 2 设为 true —— 因为交互只有"摸狗"这一种，
   * 多指同时摸会让骚扰判定混乱。
   * Milestone 3 接拖拽时需要放开。
   */
  readonly primaryOnly?: boolean;
}

export class PointerAdapter {
  private readonly element: HTMLElement;
  private readonly callbacks: PointerAdapterCallbacks;
  private readonly primaryOnly: boolean;

  /** 坐标换算：CSS 像素 → 世界像素 */
  private scaleX = 1;
  private scaleY = 1;

  private disposed = false;

  /** 触摸设备上用于抑制 300ms 后的合成鼠标事件 */
  private lastTouchAtMs = 0;

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.disposed) return;
    if (!this.shouldHandle(e)) return;
    e.preventDefault();
    this.callbacks.onDown(this.toSample(e));
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.disposed) return;
    if (!this.shouldHandle(e)) return;
    this.callbacks.onMove(this.toSample(e));
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (this.disposed) return;
    if (!this.shouldHandle(e)) return;
    this.lastTouchAtMs = e.pointerType === 'touch' ? performance.now() : this.lastTouchAtMs;
    this.callbacks.onUp(this.toSample(e));
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    if (this.disposed) return;
    if (!this.shouldHandle(e)) return;
    this.callbacks.onCancel(this.toSample(e));
  };

  /** 触摸设备合成鼠标事件抑制 */
  private readonly onClickCapture = (e: MouseEvent): void => {
    if (this.disposed) return;
    // 若刚刚有触摸事件，丢弃浏览器补发的 click
    if (performance.now() - this.lastTouchAtMs < 700) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  /** 阻止触摸滚动与双击缩放干扰 */
  private readonly onTouchStart = (e: TouchEvent): void => {
    if (this.disposed) return;
    if (e.touches.length > 0) e.preventDefault();
  };

  private readonly onContextMenu = (e: MouseEvent): void => {
    if (this.disposed) return;
    // 长按在部分浏览器会呼出右键菜单，必须阻止 —— 长按是我们的核心手势
    e.preventDefault();
  };

  constructor(
    element: HTMLElement,
    callbacks: PointerAdapterCallbacks,
    options: PointerAdapterOptions = {},
  ) {
    this.element = element;
    this.callbacks = callbacks;
    this.primaryOnly = options.primaryOnly ?? true;
    this.attach();
  }

  private attach(): void {
    const el = this.element;
    el.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    el.addEventListener('pointermove', this.onPointerMove, { passive: false });
    // up/cancel 挂在 window 上：手指滑出元素范围也要能收到
    window.addEventListener('pointerup', this.onPointerUp, { passive: false });
    window.addEventListener('pointercancel', this.onPointerCancel, { passive: false });
    el.addEventListener('click', this.onClickCapture, true);
    el.addEventListener('touchstart', this.onTouchStart, { passive: false });
    el.addEventListener('contextmenu', this.onContextMenu);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const el = this.element;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerCancel);
    el.removeEventListener('click', this.onClickCapture, true);
    el.removeEventListener('touchstart', this.onTouchStart);
    el.removeEventListener('contextmenu', this.onContextMenu);
  }

  /** 只接受主指针 / 左键 */
  private shouldHandle(e: PointerEvent): boolean {
    if (e.button !== 0 && e.type === 'pointerdown') return false;
    if (this.primaryOnly && !e.isPrimary) return false;
    return true;
  }

  /**
   * 把客户端坐标换算为画布世界坐标。
   *
   * 注意画布是 320×200 的固定设计分辨率，通过 CSS 放大显示，
   * 因此必须按元素实际尺寸缩放，否则点击位置会偏移。
   */
  private toSample(e: PointerEvent): PointerSample {
    const rect = this.element.getBoundingClientRect();
    const type: PointerSample['pointerType'] =
      e.pointerType === 'touch' ? 'touch' : e.pointerType === 'pen' ? 'pen' : 'mouse';
    return {
      x: (e.clientX - rect.left) * this.scaleX,
      y: (e.clientY - rect.top) * this.scaleY,
      atMs: performance.now(),
      pointerId: e.pointerId,
      isPrimary: e.isPrimary,
      pointerType: type,
    };
  }

  /** 告知设计分辨率，用于坐标换算 */
  setDesignSize(designW: number, designH: number): void {
    this.scaleX = designW;
    this.scaleY = designH;
  }
}
