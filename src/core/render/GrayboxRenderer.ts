/**
 * L.D.C. — 灰盒渲染器（PixiJS）
 *
 * ★ 这是整个引擎唯一接触 Pixi 的文件。
 *   核心逻辑层（core/fsm、core/animation、core/world）完全不知道 Pixi 存在 ——
 *   因此逻辑可以在 Node 里跑测试（见 tools/simulate.ts）。
 *
 * 渲染原则：
 *   1. 只读 RenderState，绝不修改任何逻辑数据
 *   2. 所有绘制坐标 Math.round() —— 像素风要求像素对齐，否则边缘发糊
 *   3. 分层容器：身体 / 头 / 眼 / 尾 / 耳 各自独立变换，
 *      这是「过程动画」能作用于独立部位的前提
 *   4. 阴影单独一层，不参与呼吸形变
 */

import {
  Application,
  Container,
  Graphics,
  Rectangle,
  type Ticker,
} from 'pixi.js';
import type { RenderState } from '../animation/AnimationSystem';
import type { SpeciesData } from '../data/types';
import { resolveGrayboxSize } from '../data/defaults';
import { PALETTE } from './palette';

export interface GrayboxRendererOptions {
  /** 设计分辨率（逻辑像素）。实际显示会按 integer scale 放大 */
  readonly designWidth: number;
  readonly designHeight: number;
  readonly background?: number;
  readonly showGrid?: boolean;
}

/**
 * 灰盒分层精灵。
 *
 * 层级（从下到上）：
 *   shadow  —— 地面阴影，不随呼吸移动
 *   body    —— 躯干，承载 bodyScaleY 呼吸形变
 *   tail    —— 尾巴分段
 *   earL/earR —— 耳朵，承载抖动
 *   head    —— 头部，承载 headDropPx
 *   eyes    —— 眼睛，承载眨眼
 */
export class GrayboxRenderer {
  readonly app: Application;
  private readonly options: GrayboxRendererOptions;

  // 分层容器
  private readonly stage: Container;
  private readonly shadowLayer: Graphics;
  private readonly bodyLayer: Container;
  private readonly bodyGfx: Graphics;
  private readonly tailLayer: Container;
  private readonly tailSegments: Graphics[] = [];
  private readonly earLayerL: Container;
  private readonly earLayerR: Container;
  private readonly earGfxL: Graphics;
  private readonly earGfxR: Graphics;
  private readonly headLayer: Container;
  private readonly headGfx: Graphics;
  private readonly eyesGfx: Graphics;

  private readonly background: Graphics;
  private readonly grid: Graphics;

  private species: SpeciesData | null = null;
  private initialized = false;
  /**
   * 画布的宿主元素。
   * 保存它是为了让 destroy() 能在 Pixi Application 未初始化完成时
   * 依然找到并清理残留画布（详见 destroy 的注释）。
   */
  private hostElement: HTMLElement | null = null;

  constructor(options: GrayboxRendererOptions) {
    this.options = options;
    this.app = new Application();

    this.stage = new Container();

    this.background = new Graphics();
    this.grid = new Graphics();

    this.shadowLayer = new Graphics();

    this.bodyLayer = new Container();
    this.bodyGfx = new Graphics();
    this.bodyLayer.addChild(this.bodyGfx);

    this.tailLayer = new Container();

    this.earLayerL = new Container();
    this.earGfxL = new Graphics();
    this.earLayerL.addChild(this.earGfxL);

    this.earLayerR = new Container();
    this.earGfxR = new Graphics();
    this.earLayerR.addChild(this.earGfxR);

    this.headLayer = new Container();
    this.headGfx = new Graphics();
    this.headLayer.addChild(this.headGfx);

    this.eyesGfx = new Graphics();
  }

  async init(canvasParent: HTMLElement): Promise<void> {
    // 最先记录宿主元素：即使后续 app.init() 抛错，
    // destroy() 也能凭它找到并清掉残留画布。
    this.hostElement = canvasParent;

    await this.app.init({
      width: this.options.designWidth,
      height: this.options.designHeight,
      background: this.options.background ?? PALETTE.bgDeep,
      // ★ 像素风核心设置：禁用平滑，放大时保持硬边
      antialias: false,
      resolution: 1,
      autoDensity: false,
      preference: 'webgl',
    });

    // ★ 像素风核心设置：禁用平滑，放大时保持硬边。
    //   渲染分辨率固定为 1（不随 devicePixelRatio 提升），
    //   否则高 DPI 屏幕上像素会被"补"出来，破坏低分辨率感。
    this.app.renderer.resize(this.options.designWidth, this.options.designHeight);

    canvasParent.appendChild(this.app.canvas);
    // CSS 层面双保险：即使 WebGL 采样出问题，浏览器也不会做平滑插值
    this.app.canvas.style.imageRendering = 'pixelated';
    this.app.canvas.style.display = 'block';
    this.app.canvas.style.width = '100%';
    this.app.canvas.style.height = '100%';

    // 手动渲染：由 GameLoop 驱动，而不是 Pixi 自己的 Ticker。
    // 这样逻辑时钟与渲染时钟只有一个来源，调试时不会出现"两套 FPS"。
    this.app.ticker.stop();

    this.assembleScene();
    this.drawStaticBackground();
    this.initialized = true;
  }

  private assembleScene(): void {
    this.stage.addChild(this.background, this.grid, this.shadowLayer);
    this.stage.addChild(this.bodyLayer);
    this.stage.addChild(this.tailLayer);
    this.stage.addChild(this.earLayerL, this.earLayerR);
    this.stage.addChild(this.headLayer);
    this.headLayer.addChild(this.eyesGfx);
    this.app.stage.addChild(this.stage);
  }

  /** 设置当前犬种（决定灰盒尺寸、尾巴节数、颜色） */
  setSpecies(species: SpeciesData): void {
    const segmentsChanged = this.species?.animation.tail.segments !== species.animation.tail.segments;
    this.species = species;
    if (segmentsChanged || this.tailSegments.length === 0) {
      this.rebuildTailSegments(species.animation.tail.segments);
    }
    this.redrawParts(species);
  }

  private rebuildTailSegments(count: number): void {
    for (const g of this.tailSegments) g.destroy();
    this.tailSegments.length = 0;
    this.tailLayer.removeChildren();

    for (let i = 0; i < count; i++) {
      const g = new Graphics();
      this.tailSegments.push(g);
      this.tailLayer.addChild(g);
    }
  }

  private drawStaticBackground(): void {
    const { designWidth: w, designHeight: h } = this.options;

    this.background.clear();
    this.background.rect(0, 0, w, h).fill({ color: PALETTE.bgMid });
    // 地面色带：给灰盒一个"站的地方"，避免悬空感
    this.background
      .rect(0, Math.round(h * 0.72), w, h - Math.round(h * 0.72))
      .fill({ color: PALETTE.bgSoft });

    this.grid.clear();
    if (!this.options.showGrid) return;
    const step = 24;
    for (let x = 0; x <= w; x += step) {
      this.grid.rect(x, 0, 1, h).fill({ color: PALETTE.grid });
    }
    for (let y = 0; y <= h; y += step) {
      this.grid.rect(0, y, w, 1).fill({ color: PALETTE.grid });
    }
  }

  /**
   * 重绘各部件。
   * 尺寸变化时需要重绘 —— 只在 setSpecies 时调用，不在每帧调用。
   *
   * ── 灰盒构图说明 ──
   * 目标不是"好看的方块"，而是**能被一眼读成侧视犬类剪影**的占位：
   *
   *        ▁▁▁            ← 耳朵
   *      ╭────╮
   *      │ 头 │╲           ← 头（偏前上方，略小）
   *   ╭──┴────┴──╮
   *   │   躯干    │        ← 躯干（主要体量，稍扁长）
   *   ╰───────────╯
   *
   * 关键比例（相对躯干）：
   *   头宽 ≈ 0.46 × 躯干宽，头高 ≈ 0.58 × 躯干高
   *   头的位置由 render() 按朝向决定，向前偏移 0.18 × 躯干宽
   */
  private redrawParts(species: SpeciesData): void {
    const size = resolveGrayboxSize(species);
    const tint = species.physical.grayboxTint;

    // bodyLayer 的原点设在灰盒底部中心，便于用 anchorY 对齐地面
    const bodyW = size.w;
    const bodyH = size.h;

    this.bodyGfx.clear();
    this.drawRoundedPixelBlock(this.bodyGfx, -bodyW / 2, -bodyH, bodyW, bodyH, {
      fill: tint === 0xffffff ? PALETTE.bodyFill : tint,
      shade: PALETTE.bodyShade,
      highlight: PALETTE.bodyHighlight,
      outline: PALETTE.bodyOutline,
    });

    // 头部：略小于躯干，位于前上方
    const headW = Math.max(10, Math.round(bodyW * 0.46));
    const headH = Math.max(8, Math.round(bodyH * 0.58));

    this.headGfx.clear();
    this.drawRoundedPixelBlock(this.headGfx, -headW / 2, -headH, headW, headH, {
      fill: PALETTE.headFill,
      shade: PALETTE.headShade,
      highlight: PALETTE.bodyHighlight,
      outline: PALETTE.bodyOutline,
    });

    // 耳朵
    const earW = Math.max(4, Math.round(headW * 0.26));
    const earH = Math.max(6, Math.round(headH * 0.55));

    this.earGfxL.clear();
    this.earGfxR.clear();
    for (const g of [this.earGfxL, this.earGfxR]) {
      g.rect(-earW / 2, -earH, earW, earH).fill({ color: PALETTE.headShade });
      g.rect(-earW / 2, -earH, earW, 1).fill({ color: PALETTE.bodyOutline });
    }

    // 尾巴分段：每段一个短方块，由 tailAnglesDeg 逐段旋转
    const segLen = Math.max(4, Math.round(bodyW * 0.22));
    const segThick = Math.max(2, Math.round(bodyH * 0.16));
    for (const g of this.tailSegments) {
      g.clear();
      g.rect(0, -segThick / 2, segLen, segThick).fill({ color: PALETTE.bodyShade });
      g.rect(0, -segThick / 2, segLen, 1).fill({ color: PALETTE.bodyHighlight });
    }

    // 眼睛（每帧重画，因为要表现眨眼）
    this.eyesGfx.clear();

    // 保存几何供 render() 使用
    this.geometry = { bodyW, bodyH, headW, headH, earW, earH, segLen, segThick };
  }

  private geometry = {
    bodyW: 48,
    bodyH: 36,
    headW: 24,
    headH: 22,
    earW: 6,
    earH: 12,
    segLen: 10,
    segThick: 6,
  };

  /**
   * 像素块绘制辅助。
   * 刻意不用圆角 —— 像素风使用「切角」而非抗锯齿圆角。
   */
  private drawRoundedPixelBlock(
    g: Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    colors: { fill: number; shade: number; highlight: number; outline: number },
  ): void {
    const notch = Math.max(2, Math.round(Math.min(w, h) * 0.14));

    // 主体（切角八边形）
    g.moveTo(x + notch, y)
      .lineTo(x + w - notch, y)
      .lineTo(x + w, y + notch)
      .lineTo(x + w, y + h - notch)
      .lineTo(x + w - notch, y + h)
      .lineTo(x + notch, y + h)
      .lineTo(x, y + h - notch)
      .lineTo(x, y + notch)
      .closePath()
      .fill({ color: colors.fill });

    // 底部阴影带（体积感）
    g.rect(x + notch, y + h - Math.max(2, Math.round(h * 0.18)), w - notch * 2, Math.max(2, Math.round(h * 0.18)))
      .fill({ color: colors.shade });

    // 顶部高光（1px 硬边）
    g.rect(x + notch, y + 1, w - notch * 2, 1).fill({ color: colors.highlight });

    // 轮廓
    g.moveTo(x + notch, y)
      .lineTo(x + w - notch, y)
      .lineTo(x + w, y + notch)
      .lineTo(x + w, y + h - notch)
      .lineTo(x + w - notch, y + h)
      .lineTo(x + notch, y + h)
      .lineTo(x, y + h - notch)
      .lineTo(x, y + notch)
      .closePath()
      .stroke({ color: colors.outline, width: 1, alignment: 0 });
  }

  /**
   * ★ 每帧渲染。只读 RenderState。
   */
  render(rs: RenderState): void {
    if (!this.initialized || !this.species) return;

    const p = rs.procedural;
    const geo = this.geometry;

    // 像素对齐：所有坐标取整
    const baseX = Math.round(rs.x + p.offsetX);
    const baseY = Math.round(rs.y + p.offsetY);

    // ── 阴影：不随呼吸移动，但随身高比例变化 ──
    const shadowW = Math.round(geo.bodyW * (0.9 + rs.speedRatio * 0.1));
    const shadowH = Math.max(2, Math.round(6 * (1 - rs.speedRatio * 0.25)));
    this.shadowLayer.clear();
    this.shadowLayer
      .ellipse(Math.round(rs.x), Math.round(rs.y + 2), shadowW / 2, shadowH / 2)
      .fill({ color: 0x000000, alpha: 0.32 });

    // ── 身体：呼吸形变（scaleY）+ 姿态高度压缩 ──
    const poseScale = rs.pose.bodyHeightRatio * p.scaleY;
    this.bodyLayer.position.set(baseX, baseY);
    this.bodyLayer.scale.set(p.scaleX, poseScale);
    this.bodyLayer.rotation = 0;

    // ── 尾巴：逐段旋转，每段挂在前一段末端 ──
    // 段 0 从躯干后上方长出。
    // 与头部同理，纵向位置必须跟随 poseScale —— 否则坐下/睡觉时
    // 尾巴会悬在压缩后的身体上方，看起来"断开"。
    let tailX = baseX - Math.round(geo.bodyW * 0.42);
    let tailY = baseY - Math.round(geo.bodyH * 0.78 * poseScale);
    let tailAngle = p.tailAnglesDeg[0] ?? 0;

    for (let i = 0; i < this.tailSegments.length; i++) {
      const seg = this.tailSegments[i];
      if (!seg) continue;

      // 每段的角度累加（相对角度 → 绝对角度）
      const segAngleDeg = p.tailAnglesDeg[i] ?? tailAngle;
      tailAngle = segAngleDeg;

      seg.position.set(tailX, tailY);
      seg.rotation = (tailAngle * Math.PI) / 180;

      // 计算下一段的起点（本段末端），同时把角度累加
      const rad = (tailAngle * Math.PI) / 180;
      tailX += Math.round(Math.cos(rad) * geo.segLen);
      tailY += Math.round(Math.sin(rad) * geo.segLen);
    }
    this.tailLayer.position.set(0, 0);

    // ── 头部：坐在**缩放后**的躯干顶部 ──
    //
    // ★ 关键：躯干被 poseScale 纵向压缩（坐下 0.72、睡觉 0.58），
    //   头部必须跟随同一个压缩量向上移动，否则坐下时头部会沉进躯干里
    //   （实测出现"身体压扁、头嵌进身体中间"的穿帮）。
    //
    //   躯干顶部（世界坐标）= baseY - bodyH × poseScale
    //   头部锚点定在躯干顶部略下方，形成自然的颈部衔接。
    const bodyTopY = baseY - geo.bodyH * poseScale;
    const headY = Math.round(bodyTopY + geo.headH * 0.55) + Math.round(rs.pose.headDropPx * poseScale);
    const headX = baseX + (rs.facingDeg >= -90 && rs.facingDeg <= 90 ? 1 : -1) * Math.round(geo.bodyW * 0.18);
    this.headLayer.position.set(headX, headY);
    this.headLayer.rotation = ((p.rotationDeg * Math.PI) / 180) * 0.5;

    // ── 耳朵：抖动 ──
    const earBaseY = headY - Math.round(geo.headH * 0.72);
    const earOffsetX = Math.round(geo.headW * 0.3);
    const jitterRad = (p.earJitterDeg * Math.PI) / 180;

    this.earLayerL.position.set(headX - earOffsetX, earBaseY);
    this.earLayerL.rotation = -0.22 + jitterRad;
    this.earLayerR.position.set(headX + earOffsetX, earBaseY);
    this.earLayerR.rotation = 0.22 - jitterRad;

    // ── 眼睛：眨眼 ──
    // 眼睛位置跟随头部，但独立绘制以表现闭合
    this.redrawEyes(headX, headY, rs, geo.headW, geo.headH);
  }

  private redrawEyes(
    headX: number,
    headY: number,
    rs: RenderState,
    headW: number,
    headH: number,
  ): void {
    const g = this.eyesGfx;
    g.clear();

    const eyeSpacing = Math.max(3, Math.round(headW * 0.26));
    const eyeY = headY - Math.round(headH * 0.52);
    const eyeW = Math.max(2, Math.round(headW * 0.16));
    const eyeH = Math.max(2, Math.round(headH * 0.22));

    // 睡眠时强制闭眼，忽略眨眼周期
    const closure = rs.pose.sleeping ? 1 : rs.procedural.eyeClosure;

    const leftX = headX - eyeSpacing;
    const rightX = headX + eyeSpacing;

    for (const x of [leftX, rightX]) {
      if (closure >= 0.85) {
        // 完全闭合：画一条横线（像素风的闭眼表现）
        g.rect(x - eyeW / 2, eyeY, eyeW, 1).fill({ color: PALETTE.eyeClosed });
      } else {
        // 未完全闭合：高度按 1-closure 压缩，最少 1px
        const h = Math.max(1, Math.round(eyeH * (1 - closure)));
        const w = Math.max(1, Math.round(eyeW * (1 - closure * 0.3)));
        g.rect(x - w / 2, eyeY, w, h).fill({ color: PALETTE.eyeOpen });
        // 睁开时加一点高光，让"有神"
        if (closure < 0.35 && h >= 2) {
          g.rect(x - w / 2, eyeY, 1, 1).fill({ color: PALETTE.ink });
        }
      }
    }
  }

  /** 手动渲染一帧。由 GameLoop 的 render 回调调用。 */
  renderFrame(): void {
    if (!this.initialized) return;
    this.app.renderer.render(this.app.stage);
  }

  resize(designWidth: number, designHeight: number): void {
    if (!this.initialized) return;
    this.options.designWidth;
    this.app.renderer.resize(designWidth, designHeight);
    this.drawStaticBackground();
  }

  /** 命中区域（供 Phase 3 交互使用，Phase 0/1 仅暴露） */
  get bounds(): Rectangle {
    const size = this.species ? resolveGrayboxSize(this.species) : { w: 48, h: 36 };
    return new Rectangle(0, 0, size.w, size.h);
  }

  destroy(): void {
    // ★ 必须无条件清理，且必须容忍「尚未初始化完成」的状态。
    //
    // 踩过的坑（两个叠加在一起，导致舞台全黑且难查）：
    //
    // 坑 1：早期这里写 `if (!this.initialized) return;`。
    //   React StrictMode 下首次挂载的 effect 会在 init() 的 await
    //   尚未完成时被清理，此时 initialized 仍为 false → 提前返回，
    //   画布从未被移除。第二次挂载又 append 一个画布，
    //   两个 canvas 叠在一起，上面那个属于废弃渲染器且永不重绘
    //   → 画面全黑。而此时场景图、RenderState、渲染调用次数全部正常，
    //   极具迷惑性。
    //
    // 坑 2：改成无条件清理后，访问 `this.app.canvas` 会抛错 ——
    //   Pixi v8 的 Application 在 init() 完成前没有 renderer，
    //   其 canvas getter 会读取 undefined.renderer.canvas 而崩溃。
    //   因此必须用 try/catch 包住，并在最后用「扫描容器内所有 canvas」
    //   的方式兜底移除，而不是依赖 app.canvas。

    // 兜底记录：init 前 canvasParent 上可能已经有我们的画布
    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = this.app.canvas ?? null;
    } catch {
      canvas = null;
    }

    for (const g of this.tailSegments) {
      try {
        g.destroy();
      } catch {
        /* 忽略：可能已被父容器销毁 */
      }
    }
    this.tailSegments.length = 0;

    try {
      this.app.destroy(true, { children: true });
    } catch {
      /* 忽略：Application 未完成 init 时 destroy 会失败 */
    }

    // 最终兜底：把宿主容器里残留的 canvas 全部清掉。
    // 这一步不依赖 Pixi 的任何内部状态，是保证"不会留下孤儿画布"的最后防线。
    const host = this.hostElement ?? canvas?.parentElement ?? null;
    if (host) {
      for (const child of Array.from(host.children)) {
        if (child.tagName === 'CANVAS') host.removeChild(child);
      }
    }
    canvas?.parentElement?.removeChild(canvas);

    this.initialized = false;
  }

  /** 暴露给外部（调试） */
  get ticker(): Ticker {
    return this.app.ticker;
  }
}
