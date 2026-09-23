/**
 * L.D.C. — 灰盒渲染器（PixiJS）
 *
 * 唯一接触 Pixi 的文件。只读 RenderState。坐标 Math.round()。
 * 部位比例来自 species.physical.silhouette，仍然零素材。
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
import { resolveGrayboxSize, resolveSilhouette, type ResolvedSilhouette } from '../data/defaults';
import { PALETTE } from './palette';

export interface GrayboxRendererOptions {
  readonly designWidth: number;
  readonly designHeight: number;
  readonly background?: number;
  readonly showGrid?: boolean;
}

export class GrayboxRenderer {
  readonly app: Application;
  private readonly options: GrayboxRendererOptions;
  private readonly stage: Container;
  private readonly shadowLayer: Graphics;
  private readonly bodyLayer: Container;
  private readonly bodyGfx: Graphics;
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
  private readonly snoutGfx: Graphics;
  private readonly eyesGfx: Graphics;
  private readonly background: Graphics;
  private readonly grid: Graphics;
  private species: SpeciesData | null = null;
  private initialized = false;
  private hostElement: HTMLElement | null = null;

  constructor(options: GrayboxRendererOptions) {
    this.options = options;
    this.app = new Application();
    this.stage = new Container();
    this.background = new Graphics();
    this.grid = new Graphics();
    this.shadowLayer = new Graphics();
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
    this.snoutGfx = new Graphics();
    this.headLayer.addChild(this.headGfx);
    this.headLayer.addChild(this.snoutGfx);
    this.eyesGfx = new Graphics();
  }

  async init(canvasParent: HTMLElement): Promise<void> {
    this.hostElement = canvasParent;
    await this.app.init({
      width: this.options.designWidth,
      height: this.options.designHeight,
      background: this.options.background ?? PALETTE.bgDeep,
      antialias: false,
      resolution: 1,
      autoDensity: false,
      preference: 'webgl',
    });
    this.app.renderer.resize(this.options.designWidth, this.options.designHeight);
    canvasParent.appendChild(this.app.canvas);
    this.app.canvas.style.imageRendering = 'pixelated';
    this.app.canvas.style.display = 'block';
    this.app.canvas.style.width = '100%';
    this.app.canvas.style.height = '100%';
    this.app.ticker.stop();
    this.assembleScene();
    this.drawStaticBackground();
    this.initialized = true;
  }

  private assembleScene(): void {
    this.stage.addChild(this.background, this.grid, this.shadowLayer);
    this.stage.addChild(this.legLayer);
    this.stage.addChild(this.bodyLayer);
    this.stage.addChild(this.tailLayer);
    this.stage.addChild(this.earLayerL, this.earLayerR);
    this.stage.addChild(this.headLayer);
    this.headLayer.addChild(this.eyesGfx);
    this.app.stage.addChild(this.stage);
  }

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
    if (roomChanged) this.drawStaticBackground();
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
    const room = this.species?.room;
    const wallColor = room?.wallColor ?? PALETTE.bgMid;
    const floorColor = room?.floorColor ?? PALETTE.bgSoft;
    const floorShade = room?.floorShadeColor ?? PALETTE.bgDeep;
    const floorLineRatio = room?.floorLineRatio ?? 0.72;
    const floorY = Math.round(h * floorLineRatio);
    this.background.clear();
    this.background.rect(0, 0, w, floorY).fill({ color: wallColor });
    this.background.rect(0, floorY, w, 1).fill({ color: floorShade });
    this.background.rect(0, floorY + 1, w, h - floorY - 1).fill({ color: floorColor });
    const farBandH = Math.max(2, Math.round((h - floorY) * 0.18));
    this.background.rect(0, floorY + 1, w, farBandH).fill({ color: floorShade });
    this.grid.clear();
    if (!room?.showGrid) return;
    const step = 24;
    for (let x = 0; x <= w; x += step) this.grid.rect(x, 0, 1, h).fill({ color: PALETTE.grid });
    for (let y = 0; y <= h; y += step) this.grid.rect(0, y, w, 1).fill({ color: PALETTE.grid });
  }

  private redrawParts(species: SpeciesData): void {
    const sil = resolveSilhouette(species);
    const tint = species.physical.grayboxTint;
    const bodyFill = tint === 0xffffff ? PALETTE.bodyFill : tint;
    const bodyW = sil.torsoW;
    const bodyH = sil.torsoH;
    this.bodyGfx.clear();
    this.drawRoundedPixelBlock(this.bodyGfx, -bodyW / 2, -bodyH, bodyW, bodyH, {
      fill: bodyFill,
      shade: PALETTE.bodyShade,
      highlight: PALETTE.bodyHighlight,
      outline: PALETTE.bodyOutline,
    });
    const headW = sil.headW;
    const headH = sil.headH;
    this.headGfx.clear();
    this.drawRoundedPixelBlock(this.headGfx, -headW / 2, -headH, headW, headH, {
      fill: PALETTE.headFill,
      shade: PALETTE.headShade,
      highlight: PALETTE.bodyHighlight,
      outline: PALETTE.bodyOutline,
    });
    this.snoutGfx.clear();
    if (sil.snoutW >= 2) {
      const snoutX = Math.round(headW / 2) - 1;
      const snoutY = -Math.round(headH * 0.42);
      this.snoutGfx.rect(snoutX, snoutY, sil.snoutW, sil.snoutH).fill({ color: PALETTE.headFill });
      this.snoutGfx.rect(snoutX, snoutY + sil.snoutH - 1, sil.snoutW, 1).fill({ color: PALETTE.headShade });
      this.snoutGfx.rect(snoutX + sil.snoutW - 1, snoutY + 1, 1, Math.max(1, sil.snoutH - 2)).fill({
        color: PALETTE.bodyOutline,
      });
    }
    this.drawEar(this.earGfxL, sil, -1);
    this.drawEar(this.earGfxR, sil, 1);
    const segLen = Math.max(4, Math.round(bodyW * 0.18));
    const segThick = Math.max(2, Math.round(bodyH * 0.14));
    for (const g of this.tailSegments) {
      g.clear();
      g.rect(0, -segThick / 2, segLen, segThick).fill({ color: PALETTE.bodyShade });
      g.rect(0, -segThick / 2, segLen, 1).fill({ color: PALETTE.bodyHighlight });
    }
    this.legGfx.clear();
    this.eyesGfx.clear();
    this.geometry = {
      bodyW,
      bodyH,
      headW,
      headH,
      earW: sil.earW,
      earH: sil.earH,
      segLen,
      segThick,
      legW: sil.legW,
      legH: sil.legH,
      legGap: sil.legGap,
      snoutW: sil.snoutW,
      headForwardPx: sil.headForwardPx,
      tailAttachPx: sil.tailAttachPx,
      earShape: sil.earShape,
    };
  }

  private drawEar(g: Graphics, sil: ResolvedSilhouette, side: -1 | 1): void {
    g.clear();
    const w = sil.earW;
    const h = sil.earH;
    if (sil.earShape === 'drop') {
      g.rect(-w / 2, 0, w, h).fill({ color: PALETTE.headShade });
      g.rect(-w / 2, 0, w, 1).fill({ color: PALETTE.bodyOutline });
      g.rect(-w / 2, h - 1, w, 1).fill({ color: PALETTE.bodyOutline });
      return;
    }
    if (sil.earShape === 'fold') {
      const upper = Math.max(3, Math.round(h * 0.55));
      g.rect(-w / 2, -upper, w, upper).fill({ color: PALETTE.headShade });
      g.rect(side > 0 ? 0 : -w, -2, Math.round(w * 1.4), Math.max(2, Math.round(h * 0.35))).fill({
        color: PALETTE.headFill,
      });
      g.rect(-w / 2, -upper, w, 1).fill({ color: PALETTE.bodyOutline });
      return;
    }
    g.rect(-w / 2, -h, w, h).fill({ color: PALETTE.headShade });
    g.rect(-w / 2, -h, w, 1).fill({ color: PALETTE.bodyOutline });
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
    snoutW: 8,
    headForwardPx: 16,
    tailAttachPx: 20,
    earShape: 'prick' as ResolvedSilhouette['earShape'],
  };

  private drawRoundedPixelBlock(
    g: Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    colors: { fill: number; shade: number; highlight: number; outline: number },
  ): void {
    const notch = Math.max(2, Math.round(Math.min(w, h) * 0.14));
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
    g.rect(x + notch, y + h - Math.max(2, Math.round(h * 0.18)), w - notch * 2, Math.max(2, Math.round(h * 0.18))).fill({
      color: colors.shade,
    });
    g.rect(x + notch, y + 1, w - notch * 2, 1).fill({ color: colors.highlight });
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

  render(rs: RenderState): void {
    if (!this.initialized || !this.species) return;
    const p = rs.procedural;
    const geo = this.geometry;
    const baseX = Math.round(rs.x + p.offsetX);
    const baseY = Math.round(rs.y + p.offsetY);
    const facingRight = rs.facingDeg >= -90 && rs.facingDeg <= 90;
    const dir = facingRight ? 1 : -1;

    const shadowW = Math.round(geo.bodyW * (0.9 + rs.speedRatio * 0.1));
    const shadowH = Math.max(2, Math.round(6 * (1 - rs.speedRatio * 0.25)));
    this.shadowLayer.clear();
    this.shadowLayer.ellipse(Math.round(rs.x), Math.round(rs.y + 2), shadowW / 2, shadowH / 2).fill({
      color: 0x000000,
      alpha: 0.32,
    });

    const poseScale = rs.pose.bodyHeightRatio * p.scaleY;
    this.bodyLayer.position.set(baseX, baseY);
    this.bodyLayer.scale.set(p.scaleX, poseScale);
    this.bodyLayer.rotation = 0;

    const legW = geo.legW;
    const legH = geo.legH;
    const legGap = geo.legGap;
    const phase = rs.pose.legPhase;
    const bodyBottom = baseY - Math.round(geo.bodyH * poseScale * 0.02);
    const legTop = bodyBottom - Math.round(legH * 0.35);
    const frontX = dir * Math.round(geo.bodyW * 0.26);
    const backX = -dir * Math.round(geo.bodyW * 0.30);
    const halfGap = Math.round(legGap / 2);
    const legDefs = [
      { x: frontX + halfGap * 0.5, phaseOffset: Math.PI, isFar: true },
      { x: backX + halfGap * 0.5, phaseOffset: 0, isFar: true },
      { x: frontX - halfGap * 0.5, phaseOffset: 0, isFar: false },
      { x: backX - halfGap * 0.5, phaseOffset: Math.PI, isFar: false },
    ];
    this.legGfx.clear();
    for (const leg of legDefs) {
      const swingAmp = Math.round(geo.bodyW * 0.12 * Math.min(1, rs.speedRatio * 3 + 0.15));
      const lp = phase + leg.phaseOffset;
      const swingX = Math.round(Math.sin(lp * Math.PI * 2) * swingAmp) * dir;
      const lift = Math.round(Math.abs(Math.cos(lp * Math.PI * 2)) * Math.max(2, legH * 0.3));
      const lx = baseX + leg.x + swingX;
      const ly = legTop + lift;
      const visibleH = Math.max(2, legH - Math.round(lift * 0.6));
      const fill = leg.isFar ? PALETTE.bodyShade : PALETTE.bodyFill;
      this.legGfx.rect(lx - 1, ly + visibleH - 1, legW + 2, 1).fill({ color: PALETTE.bodyOutline });
      this.legGfx.rect(lx, ly, legW, visibleH).fill({ color: fill });
      this.legGfx.rect(lx, ly, legW, 1).fill({ color: PALETTE.bodyHighlight });
    }

    let tailX = baseX + (facingRight ? -1 : 1) * geo.tailAttachPx;
    let tailY = baseY - Math.round(geo.bodyH * 0.72 * poseScale);
    let tailAngle = p.tailAnglesDeg[0] ?? 0;
    for (let i = 0; i < this.tailSegments.length; i++) {
      const seg = this.tailSegments[i];
      if (!seg) continue;
      const segAngleDeg = p.tailAnglesDeg[i] ?? tailAngle;
      tailAngle = segAngleDeg;
      const visualAngle = facingRight ? 180 - segAngleDeg : segAngleDeg;
      seg.position.set(tailX, tailY);
      seg.rotation = (visualAngle * Math.PI) / 180;
      const rad = (visualAngle * Math.PI) / 180;
      tailX += Math.round(Math.cos(rad) * geo.segLen);
      tailY += Math.round(Math.sin(rad) * geo.segLen);
    }
    this.tailLayer.position.set(0, 0);

    const bodyTopY = baseY - geo.bodyH * poseScale;
    const headY = Math.round(bodyTopY + geo.headH * 0.58) + Math.round(rs.pose.headDropPx * poseScale);
    const headX = baseX + dir * geo.headForwardPx;
    this.headLayer.position.set(headX, headY);
    this.headLayer.scale.set(dir, 1);
    this.headLayer.rotation = ((p.rotationDeg * Math.PI) / 180) * 0.5;

    const earOnTop = geo.earShape !== 'drop';
    const earBaseY = headY - Math.round(geo.headH * (earOnTop ? 0.78 : 0.62));
    const earBack = headX - dir * Math.round(geo.headW * 0.22);
    const earFront = headX + dir * Math.round(geo.headW * 0.16);
    const jitterRad = (p.earJitterDeg * Math.PI) / 180;
    this.earLayerL.position.set(earBack, earBaseY);
    this.earLayerL.rotation = -0.18 + jitterRad;
    this.earLayerR.position.set(earFront, earBaseY);
    this.earLayerR.rotation = 0.18 - jitterRad;
    this.redrawEyes(rs, geo.headW, geo.headH);
  }

  private redrawEyes(rs: RenderState, headW: number, headH: number): void {
    const g = this.eyesGfx;
    g.clear();
    const eyeX = Math.round(headW * 0.12);
    const eyeY = -Math.round(headH * 0.55);
    const eyeW = Math.max(2, Math.round(headW * 0.18));
    const eyeH = Math.max(2, Math.round(headH * 0.22));
    const rawClosure = rs.pose.sleeping ? 1 : Math.max(rs.procedural.eyeClosure, rs.pose.eyeClosure);
    const closure = rawClosure >= 0.9 ? 1 : rawClosure;
    if (closure >= 0.85) {
      g.rect(eyeX - eyeW / 2, eyeY, eyeW, 1).fill({ color: PALETTE.eyeClosed });
    } else {
      const h = Math.max(1, Math.round(eyeH * (1 - closure)));
      const w = Math.max(1, Math.round(eyeW * (1 - closure * 0.3)));
      g.rect(eyeX - w / 2, eyeY, w, h).fill({ color: PALETTE.eyeOpen });
      if (closure < 0.35 && h >= 2) {
        g.rect(eyeX - w / 2, eyeY, 1, 1).fill({ color: PALETTE.ink });
      }
    }
  }

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

  get bounds(): Rectangle {
    const size = this.species ? resolveGrayboxSize(this.species) : { w: 48, h: 36 };
    return new Rectangle(0, 0, size.w, size.h);
  }

  destroy(): void {
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
        /* ignore */
      }
    }
    this.tailSegments.length = 0;
    try {
      this.app.destroy(true, { children: true });
    } catch {
      /* ignore */
    }
    const host = this.hostElement ?? canvas?.parentElement ?? null;
    if (host) {
      for (const child of Array.from(host.children)) {
        if (child.tagName === 'CANVAS') host.removeChild(child);
      }
    }
    canvas?.parentElement?.removeChild(canvas);
    this.initialized = false;
  }

  get ticker(): Ticker {
    return this.app.ticker;
  }
}
