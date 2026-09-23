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
  /**
   * 腿部图层（Alpha 打磨新增）。
   *
   * 位于 bodyLayer **之前**加入显示列表，因此在视觉上位于身体下方 ——
   * 腿从身体底部伸出，被身体覆盖一小段，形成自然的连接。
   */
  private readonly legLayer: Container;
  private readonly legGfx: Graphics;
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

    // 腿先入列表 → 绘制在身体之下
    this.legLayer = new Container();
    this.legGfx = new Graphics();
    this.legLayer.addChild(this.legGfx);

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
    // 腿在身体之前加入 → 视觉上位于身体下方
    this.stage.addChild(this.legLayer);
    this.stage.addChild(this.bodyLayer);
    this.stage.addChild(this.tailLayer);
    this.stage.addChild(this.earLayerL, this.earLayerR);
    this.stage.addChild(this.headLayer);
    this.headLayer.addChild(this.eyesGfx);
    this.app.stage.addChild(this.stage);
  }

  /** 设置当前犬种（决定灰盒尺寸、尾巴节数、颜色、房间外观） */
  setSpecies(species: SpeciesData): void {
    const segmentsChanged = this.species?.animation.tail.segments !== species.animation.tail.segments;
    const roomChanged =
      this.species?.room.floorLineRatio !== species.room.floorLineRatio ||
      this.species?.room.floorColor !== species.room.floorColor ||
      this.species?.room.wallColor !== species.room.wallColor ||
      this.species?.room.showGrid !== species.room.showGrid;

    this.species = species;

    if (segmentsChanged || this.tailSegments.length === 0) {
      this.rebuildTailSegments(species.animation.tail.segments);
    }
    this.redrawParts(species);

    // ★ 房间外观也来自 species 数据，因此换犬种时房间可能一起变。
    //   这一步只在实际变化时执行 —— 避免每次切换都重绘整个背景。
    if (roomChanged) {
      this.drawStaticBackground();
    }
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

  /**
   * 绘制房间（背景 + 地板）。
   *
   * ★ Milestone 2 的变化：从"网格调试背景"改为**一个房间**。
   *
   *   去掉网格是刻意的：项目要求"没有 UI、没有菜单、没有按钮"。
   *   网格线会让画面读起来像编辑器，而不是"它待着的房间"。
   *
   *   房间只有两个平面：
   *     墙面（上）—— 略亮，暗示空间
   *     地板（下）—— 略暗，狗站在这里
   *   交界处画一条 1px 的暗线作为"墙脚线"，这比渐变更像素风。
   *
   *   房间配色全部来自 species.room（数据驱动），
   *   因此不同犬种可以有不同房间而不改代码。
   */
  private drawStaticBackground(): void {
    const { designWidth: w, designHeight: h } = this.options;
    const room = this.species?.room;

    const wallColor = room?.wallColor ?? PALETTE.bgMid;
    const floorColor = room?.floorColor ?? PALETTE.bgSoft;
    const floorShade = room?.floorShadeColor ?? PALETTE.bgDeep;
    const floorLineRatio = room?.floorLineRatio ?? 0.72;

    const floorY = Math.round(h * floorLineRatio);

    this.background.clear();

    // 墙面
    this.background.rect(0, 0, w, floorY).fill({ color: wallColor });

    // 墙脚线：1px 硬边，像素风的分界表达
    this.background.rect(0, floorY, w, 1).fill({ color: floorShade });

    // 地板
    this.background.rect(0, floorY + 1, w, h - floorY - 1).fill({ color: floorColor });

    // 地板远处的暗带：制造纵深，让狗"站在房间里"而非贴着墙
    const farBandH = Math.max(2, Math.round((h - floorY) * 0.18));
    this.background
      .rect(0, floorY + 1, w, farBandH)
      .fill({ color: floorShade });

    // 网格仅在显式开启时绘制（调试用，正式体验应为 false）
    this.grid.clear();
    if (!room?.showGrid) return;

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

    // ── 腿（Alpha 打磨新增）──
    //
    // ★ 为什么必须加腿：
    //   在此之前狗"走路"只是整体平移 —— 画面上是一个方块在滑动，
    //   没有任何步态。这是最损害"它是一只狗"的观感缺陷：
    //   移动本身不产生生命感，**移动的方式**才产生。
    //
    //   腿是画在最底层的独立部件，宽度与间距由身体尺寸推导，
    //   骨骼摆动由 render() 依据 legPhase 逐帧计算。
    //   因此它们不是"素材"，而是过程动画的一部分 —— 零素材开销。
    const legW = Math.max(3, Math.round(bodyW * 0.14));
    const legH = Math.max(4, Math.round(bodyH * 0.34));
    const legGap = Math.round(bodyW * 0.26);

    this.legGfx.clear();
    // 前腿（右）与后腿（左）各两条，绘制在身体下方
    // 具体位置由 render() 每帧设置，这里只准备图元
    for (let i = 0; i < 4; i++) {
      const isFar = i >= 2; // 后两条为"远端腿"，用暗色表现纵深
      this.legGfx
        .rect(0, 0, legW, legH)
        .fill({ color: isFar ? PALETTE.bodyShade : PALETTE.bodyFill });
      this.legGfx
        .rect(0, 0, legW, 1)
        .fill({ color: PALETTE.bodyHighlight });
    }

    // 眼睛（每帧重画，因为要表现眨眼）
    this.eyesGfx.clear();

    // 保存几何供 render() 使用
    this.geometry = {
      bodyW,
      bodyH,
      headW,
      headH,
      earW,
      earH,
      segLen,
      segThick,
      legW,
      legH,
      legGap,
    };
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
    legW: 6,
    legH: 12,
    legGap: 12,
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

    // ── 腿：步态摆动（Alpha 打磨新增）──
    //
    // ★ 这是让"移动"读起来像"走路"的关键。
    //
    //   此前狗走路时身体整体平移，四条腿不存在 ——
    //   画面上就是一个方块滑过去，完全没有步态。
    //
    //   步态设计（对角步，四足动物的标准行走方式）：
    //     左前腿 与 右后腿 同相（legPhase）
    //     右前腿 与 左后腿 反相（legPhase + π）
    //   这个相位关系是四足动物的通用特征，
    //   因此不需要为每个犬种单独设计 —— 差异体现在步频上，
    //   而步频已由 speedPxPerSec 与 animation.targetFps 决定。
    //
    //   每条腿做两件事：
    //     ① 前后摆动（水平位移，sin）
    //     ② 抬起落下（垂直位移，|cos| —— 落地时贴地，抬腿时抬起）
    //   两者叠加才像"迈步"，只做水平摆动会像"蹭地"。
    //
    //   静止时 legPhase 归零，四腿并拢垂直站立。
    const legW = geo.legW;
    const legH = geo.legH;
    const legGap = geo.legGap;
    const phase = rs.pose.legPhase;

    // ★ 腿的基线：身体底边**再往下** legH 像素，让腿完全露在体外。
    //
    //   早期版本把腿画在 bodyBottom 之上（腿顶被身体压住），
    //   结果 4px 高的腿几乎完全被 36px 高的躯干遮住 ——
    //   实测截图上几乎看不到腿，步态形同虚设。
    //
    //   现在让腿从身体底边向下延伸，全身总高 = 躯干 + 腿，
    //   与"狗有四条腿"的直觉一致。地面锚点仍为 baseY。
    const bodyBottom = baseY - Math.round(geo.bodyH * poseScale * 0.02);
    const legTop = bodyBottom - Math.round(legH * 0.35);

    // 腿的横向位置：前腿在后腿之前（面向右时，前方 = +x）
    const frontX = Math.round(geo.bodyW * 0.26);
    const backX = -Math.round(geo.bodyW * 0.30);
    const halfGap = Math.round(legGap / 2);

    // 绘制顺序：远端腿先画（更暗，被近端腿遮挡）
    const legDefs = [
      { x: frontX + halfGap * 0.5, phaseOffset: Math.PI, isFar: true }, // 前远
      { x: backX + halfGap * 0.5, phaseOffset: 0, isFar: true }, // 后远
      { x: frontX - halfGap * 0.5, phaseOffset: 0, isFar: false }, // 前近
      { x: backX - halfGap * 0.5, phaseOffset: Math.PI, isFar: false }, // 后近
    ];

    this.legGfx.clear();

    for (const leg of legDefs) {
      // 摆动幅度随速度增长：站着不动时腿垂直，走得快时迈得大
      const swingAmp = Math.round(geo.bodyW * 0.12 * Math.min(1, rs.speedRatio * 3 + 0.15));
      const lp = phase + leg.phaseOffset;

      // ① 水平摆动
      const swingX = Math.round(Math.sin(lp * Math.PI * 2) * swingAmp);
      // ② 抬腿：|cos| 峰值时抬起。像素风里 2~3px 已足够读出"迈步"
      const lift = Math.round(Math.abs(Math.cos(lp * Math.PI * 2)) * Math.max(2, legH * 0.3));

      const lx = baseX + leg.x + swingX;
      // 抬起时腿整体上移，且可见长度缩短（脚离地）
      const ly = legTop + lift;
      const visibleH = Math.max(2, legH - Math.round(lift * 0.6));

      // 近端腿用亮色、远端腿用暗色 —— 制造前后纵深感
      const fill = leg.isFar ? PALETTE.bodyShade : PALETTE.bodyFill;

      // 脚掌加宽 1px，让腿型有"落地"感
      this.legGfx.rect(lx - 1, ly + visibleH - 1, legW + 2, 1).fill({ color: PALETTE.bodyOutline });
      this.legGfx.rect(lx, ly, legW, visibleH).fill({ color: fill });
      this.legGfx.rect(lx, ly, legW, 1).fill({ color: PALETTE.bodyHighlight });
    }

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

    // ★ 闭眼程度取「眨眼反射」与「情绪性闭眼」的最大值。
    //   取 max 而非相加，理由：
    //     眨眼是瞬间的（~140ms），情绪闭眼是持续的（享受时一直闭着）。
    //     两者重叠时应该保持"闭着"，而不是叠加成负值。
    //   睡眠时强制全闭，忽略眨眼周期。
    const rawClosure = rs.pose.sleeping
      ? 1
      : Math.max(rs.procedural.eyeClosure, rs.pose.eyeClosure);

    // ★ 阈值吸附：接近全闭时直接吸附到全闭。
    //
    //   为什么需要：像素风只有"睁眼"和"闭眼"两种表达，
    //   中间态（eyeClosure 0.6~0.9）渲染出来是一条很短的横线，
    //   既不像睁眼也不像闭眼，看起来像渲染错误。
    //   实测：情绪闭眼稳定在 0.81 时，眼睛画成 1px 短线，
    //   视觉上"一直没闭上"。
    //
    //   吸附到 0.9 以上即视为完全闭合，让表达干净利落。
    const closure = rawClosure >= 0.9 ? 1 : rawClosure;

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
