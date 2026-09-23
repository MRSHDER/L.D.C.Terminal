/**
 * L.D.C. — 灰盒渲染器（PixiJS）
 * 唯一接触 Pixi。比例来自 silhouette，毛色来自 coat，零素材。
 */

import {
  Application,
  Container,
  Graphics,
  Rectangle,
  type Ticker,
} from 'pixi.js';
import type { RenderState } from '../animation/AnimationSystem';
import type { CoatConfig, SpeciesData } from '../data/types';
import {
  DEFAULT_COAT,
  resolveCoat,
  resolveGrayboxSize,
  resolveSilhouette,
  type ResolvedSilhouette,
} from '../data/defaults';
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
  private readonly neckGfx: Graphics;
  private readonly snoutGfx: Graphics;
  private readonly eyesGfx: Graphics;
  private readonly background: Graphics;
  private readonly grid: Graphics;
  private species: SpeciesData | null = null;
  private coat: CoatConfig = DEFAULT_COAT;
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
    this.neckGfx = new Graphics();
    this.snoutGfx = new Graphics();
    this.headLayer.addChild(this.neckGfx);
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
    this.stage.addChild(this.earLayerL);
    this.stage.addChild(this.headLayer);
    this.headLayer.addChild(this.eyesGfx);
    this.stage.addChild(this.earLayerR);
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
    this.coat = resolveCoat(species);
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
    const coat = resolveCoat(species);
    this.coat = coat;
    const tint = species.physical.grayboxTint;
    const bodyFill = tint === 0xffffff ? coat.base : tint;
    const bodyW = sil.torsoW;
    const bodyH = sil.torsoH;
    this.bodyGfx.clear();
    this.drawTorso(this.bodyGfx, bodyW, bodyH, coat, bodyFill);
    const headW = sil.headW;
    const headH = sil.headH;
    this.headGfx.clear();
    this.drawHead(this.headGfx, headW, headH, coat);
    this.neckGfx.clear();
    this.drawNeck(this.neckGfx, headW, headH, coat);
    this.snoutGfx.clear();
    this.drawSnout(this.snoutGfx, headW, headH, sil.snoutW, sil.snoutH, coat);
    this.drawEar(this.earGfxL, sil, -1, coat);
    this.drawEar(this.earGfxR, sil, 1, coat);
    const segLen = Math.max(5, Math.round(bodyW * 0.2));
    const segThick = Math.max(3, Math.round(bodyH * 0.16));
    const last = this.tailSegments.length - 1;
    for (let i = 0; i < this.tailSegments.length; i++) {
      const g = this.tailSegments[i];
      if (!g) continue;
      g.clear();
      const tip = coat.markings.tailTip && i === last;
      const fill = tip ? coat.white : coat.shade;
      const hi = tip ? coat.white : coat.highlight;
      g.rect(0, -segThick / 2, segLen, segThick).fill({ color: fill });
      g.rect(0, -segThick / 2, segLen, 1).fill({ color: hi });
      g.rect(segLen - 1, -segThick / 2, 1, segThick).fill({ color: coat.outline });
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

  private drawTorso(g: Graphics, w: number, h: number, coat: CoatConfig, fill: number): void {
    const x0 = -w / 2;
    const x1 = w / 2;
    const frontLift = Math.max(3, Math.round(h * 0.2));
    const rearDrop = Math.max(1, Math.round(h * 0.06));
    const notch = Math.max(2, Math.round(Math.min(w, h) * 0.1));
    g.moveTo(x0 + notch, -h + rearDrop)
      .lineTo(x1 - notch * 1.4, -h - frontLift)
      .lineTo(x1, -h - frontLift + notch)
      .lineTo(x1, -Math.round(h * 0.42))
      .lineTo(x1 - 1, -notch)
      .lineTo(x1 - notch, 0)
      .lineTo(x0 + notch, 0)
      .lineTo(x0 + 1, -notch)
      .lineTo(x0, -Math.round(h * 0.45))
      .lineTo(x0, -h + rearDrop + notch)
      .closePath()
      .fill({ color: fill });
    g.rect(x0 + notch, -Math.max(2, Math.round(h * 0.22)), w - notch * 2, Math.max(2, Math.round(h * 0.22))).fill({
      color: coat.shade,
    });
    g.rect(Math.round(x0 + w * 0.18), -h - frontLift + 2, Math.max(2, Math.round(w * 0.42)), 1).fill({
      color: coat.highlight,
    });
    g.rect(Math.round(x0 + w * 0.28), -h - frontLift - 1, 3, 1).fill({ color: fill });
    g.rect(Math.round(x0 + w * 0.48), -h - frontLift - 1, 2, 1).fill({ color: fill });
    if (coat.markings.bib) {
      const bibW = Math.max(8, Math.round(w * 0.36));
      const bibH = Math.max(8, Math.round(h * 0.62));
      g.moveTo(x1 - bibW, -Math.round(h * 0.18))
        .lineTo(x1 - 1, -bibH)
        .lineTo(x1 + 1, -Math.round(h * 0.28))
        .lineTo(x1 - 2, 0)
        .lineTo(x1 - bibW + 2, 0)
        .closePath()
        .fill({ color: coat.white });
      g.rect(x1 - bibW + 3, -2, bibW - 6, 2).fill({ color: coat.whiteShade });
    }
    g.moveTo(x0 + notch, -h + rearDrop)
      .lineTo(x1 - notch * 1.4, -h - frontLift)
      .lineTo(x1, -h - frontLift + notch)
      .lineTo(x1, -Math.round(h * 0.42))
      .lineTo(x1 - 1, -notch)
      .lineTo(x1 - notch, 0)
      .lineTo(x0 + notch, 0)
      .lineTo(x0 + 1, -notch)
      .lineTo(x0, -Math.round(h * 0.45))
      .lineTo(x0, -h + rearDrop + notch)
      .closePath()
      .stroke({ color: coat.outline, width: 1, alignment: 0 });
  }

  private drawHead(g: Graphics, w: number, h: number, coat: CoatConfig): void {
    const x = -w / 2;
    const y = -h;
    const notch = Math.max(2, Math.round(Math.min(w, h) * 0.16));
    g.moveTo(x + notch, y)
      .lineTo(x + w - notch, y)
      .lineTo(x + w, y + notch)
      .lineTo(x + w, y + h - notch)
      .lineTo(x + w - notch, y + h)
      .lineTo(x + notch, y + h)
      .lineTo(x, y + h - notch)
      .lineTo(x, y + notch)
      .closePath()
      .fill({ color: coat.base });
    g.rect(x + notch, y + h - Math.max(2, Math.round(h * 0.16)), w - notch * 2, Math.max(2, Math.round(h * 0.16))).fill({
      color: coat.shade,
    });
    if (coat.markings.blaze) {
      const blazeW = Math.max(3, Math.round(w * 0.22));
      g.rect(Math.round(w * 0.06), y + 1, blazeW, Math.round(h * 0.55)).fill({ color: coat.white });
      g.rect(Math.round(w * 0.1), y, Math.max(2, blazeW - 2), 1).fill({ color: coat.white });
    }
    if (coat.markings.rustPoints) {
      const browW = Math.max(4, Math.round(w * 0.28));
      const browH = Math.max(2, Math.round(h * 0.14));
      g.rect(Math.round(w * 0.02), -Math.round(h * 0.78), browW, browH).fill({ color: coat.rust });
      const cheekW = Math.max(5, Math.round(w * 0.34));
      const cheekH = Math.max(3, Math.round(h * 0.22));
      g.rect(-Math.round(w * 0.06), -Math.round(h * 0.42), cheekW, cheekH).fill({ color: coat.rust });
      g.rect(-Math.round(w * 0.02), -Math.round(h * 0.28), Math.round(cheekW * 0.7), 2).fill({
        color: coat.rustShade,
      });
    }
    if (coat.markings.muzzle) {
      g.rect(-Math.round(w * 0.08), -Math.round(h * 0.28), Math.round(w * 0.7), Math.round(h * 0.22)).fill({
        color: coat.white,
      });
    }
    g.rect(x + notch, y + 1, w - notch * 2, 1).fill({ color: coat.highlight });
    g.moveTo(x + notch, y)
      .lineTo(x + w - notch, y)
      .lineTo(x + w, y + notch)
      .lineTo(x + w, y + h - notch)
      .lineTo(x + w - notch, y + h)
      .lineTo(x + notch, y + h)
      .lineTo(x, y + h - notch)
      .lineTo(x, y + notch)
      .closePath()
      .stroke({ color: coat.outline, width: 1, alignment: 0 });
  }

  private drawNeck(g: Graphics, headW: number, headH: number, coat: CoatConfig): void {
    const nw = Math.max(5, Math.round(headW * 0.46));
    const nh = Math.max(5, Math.round(headH * 0.46));
    const x = -headW / 2 - nw + 3;
    const y = -Math.round(headH * 0.36);
    g.rect(x, y, nw, nh).fill({ color: coat.base });
    g.rect(x, y + nh - 2, nw, 2).fill({ color: coat.shade });
    if (coat.markings.bib) {
      g.rect(x + Math.round(nw * 0.45), y + 1, Math.max(3, Math.round(nw * 0.5)), nh - 2).fill({
        color: coat.white,
      });
    }
  }

  private drawSnout(
    g: Graphics,
    headW: number,
    headH: number,
    snoutW: number,
    snoutH: number,
    coat: CoatConfig,
  ): void {
    if (snoutW < 2) return;
    const sx = Math.round(headW / 2) - 1;
    const top = -Math.round(headH * 0.48);
    const bot = -Math.round(headH * 0.1);
    const tipX = sx + snoutW;
    const tipY = -Math.round(headH * 0.32);
    const fill = coat.markings.muzzle ? coat.white : coat.base;
    g.moveTo(sx, top)
      .lineTo(tipX, tipY)
      .lineTo(tipX, tipY + Math.max(3, snoutH - 2))
      .lineTo(sx, bot)
      .closePath()
      .fill({ color: fill });
    g.rect(sx, bot - 1, Math.max(2, snoutW - 1), 1).fill({
      color: coat.markings.muzzle ? coat.whiteShade : coat.shade,
    });
    g.rect(tipX - 2, tipY + 1, 3, 3).fill({ color: coat.nose });
    g.rect(tipX - 1, tipY, 2, 1).fill({ color: coat.outline });
  }

  private drawEar(g: Graphics, sil: ResolvedSilhouette, side: -1 | 1, coat: CoatConfig): void {
    g.clear();
    const w = sil.earW;
    const h = sil.earH;
    if (sil.earShape === 'drop') {
      g.moveTo(-w / 2, 0)
        .lineTo(w / 2 + 1, 2)
        .lineTo(Math.round(w * 0.42) * side, h)
        .lineTo(-Math.round(w * 0.2), h - 1)
        .closePath()
        .fill({ color: coat.base });
      if (coat.markings.rustPoints) {
        g.moveTo(-Math.round(w * 0.22), 2)
          .lineTo(Math.round(w * 0.18), 3)
          .lineTo(Math.round(w * 0.22) * side, Math.round(h * 0.72))
          .lineTo(-Math.round(w * 0.08), Math.round(h * 0.68))
          .closePath()
          .fill({ color: coat.rust });
      }
      g.rect(-w / 2, 0, w, 1).fill({ color: coat.outline });
      return;
    }
    if (sil.earShape === 'fold') {
      const upper = Math.max(3, Math.round(h * 0.55));
      g.moveTo(-w / 2, 0)
        .lineTo(0, -upper)
        .lineTo(w / 2, 0)
        .closePath()
        .fill({ color: coat.shade });
      g.rect(side > 0 ? 0 : -w, -2, Math.round(w * 1.3), Math.max(2, Math.round(h * 0.38))).fill({
        color: coat.base,
      });
      return;
    }
    g.moveTo(-w / 2, 1)
      .lineTo(0, -h)
      .lineTo(w / 2, 2)
      .closePath()
      .fill({ color: coat.base });
    g.rect(-1, -h, 2, 1).fill({ color: coat.outline });
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

  render(rs: RenderState): void {
    if (!this.initialized || !this.species) return;
    const p = rs.procedural;
    const geo = this.geometry;
    const coat = this.coat;
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
    const stand = Math.round(geo.legH * poseScale * 0.82);
    const groundY = Math.round(baseY);
    const torsoY = groundY - stand;
    this.bodyLayer.position.set(baseX, torsoY);
    this.bodyLayer.scale.set(dir * Math.abs(p.scaleX || 1), poseScale);
    this.bodyLayer.rotation = 0;

    const legW = geo.legW;
    const legH = geo.legH;
    const legGap = geo.legGap;
    const phase = rs.pose.legPhase;
    const walkAmount = Math.min(1, Math.max(0, rs.speedRatio * 2.8));
    const legTop = torsoY - Math.max(1, Math.round(legH * 0.12));
    const maxFootY = groundY - 1;
    const frontX = dir * Math.round(geo.bodyW * 0.27);
    const backX = -dir * Math.round(geo.bodyW * 0.31);
    const halfGap = Math.round(legGap / 2);
    const legDefs = [
      { x: frontX + halfGap * 0.42, phaseOffset: Math.PI, isFar: true },
      { x: backX + halfGap * 0.42, phaseOffset: 0, isFar: true },
      { x: frontX - halfGap * 0.42, phaseOffset: 0, isFar: false },
      { x: backX - halfGap * 0.42, phaseOffset: Math.PI, isFar: false },
    ];
    this.legGfx.clear();
    for (const leg of legDefs) {
      const lp = phase + leg.phaseOffset;
      const stride = Math.sin(lp * Math.PI * 2);
      const planted = Math.cos(lp * Math.PI * 2) < 0;
      const swingAmp = Math.round(geo.bodyW * 0.075 * walkAmount);
      const lift = planted ? 0 : Math.round(Math.max(1, legH * 0.24) * walkAmount);
      const lx = Math.round(baseX + leg.x + stride * swingAmp * dir);
      const footY = maxFootY - lift;
      const visibleH = Math.max(5, footY - legTop + 1);
      const ly = footY - visibleH + 1;
      const footW = legW + (planted ? 2 : 1);
      const footX = lx - Math.floor((footW - legW) / 2);
      const sockH = coat.markings.socks ? Math.max(2, Math.round(visibleH * 0.26)) : 0;
      const rustH = coat.markings.rustPoints ? Math.max(2, Math.round(visibleH * 0.3)) : 0;
      const upperH = Math.max(2, visibleH - sockH - rustH);
      const fillUpper = leg.isFar ? coat.shade : coat.base;
      this.legGfx.rect(lx, ly, legW, upperH).fill({ color: fillUpper });
      if (rustH > 0) {
        this.legGfx.rect(lx, ly + upperH, legW, rustH).fill({
          color: leg.isFar ? coat.rustShade : coat.rust,
        });
      }
      if (sockH > 0) {
        this.legGfx.rect(lx, ly + upperH + rustH, legW, sockH).fill({ color: coat.white });
        this.legGfx.rect(footX, footY - 1, footW, 2).fill({ color: coat.whiteShade });
      } else {
        this.legGfx.rect(footX, footY - 1, footW, 2).fill({ color: coat.outline });
      }
      if (!leg.isFar) {
        this.legGfx.rect(lx, ly, legW, 1).fill({ color: coat.highlight });
      }
    }

    let tailX = Math.round(baseX - dir * geo.tailAttachPx);
    let tailY = Math.round(torsoY - geo.bodyH * 0.68 * poseScale);
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

    const headY = Math.round(torsoY - geo.bodyH * poseScale * 0.54 + Math.round(rs.pose.headDropPx * poseScale));
    const headX = Math.round(baseX + dir * geo.headForwardPx);
    this.headLayer.position.set(headX, headY);
    this.headLayer.scale.set(dir, 1);
    this.headLayer.rotation = ((p.rotationDeg * Math.PI) / 180) * 0.5;

    const earOnTop = geo.earShape !== 'drop';
    const earBaseY = headY - Math.round(geo.headH * (earOnTop ? 0.92 : 0.82));
    const earBack = headX - dir * Math.round(geo.headW * 0.32);
    const earFront = headX + dir * Math.round(geo.headW * 0.06);
    const jitterRad = (p.earJitterDeg * Math.PI) / 180;
    this.earLayerL.position.set(earBack, earBaseY);
    this.earLayerL.rotation = (earOnTop ? -0.22 : 0.18) + jitterRad;
    this.earLayerL.scale.set(dir, 1);
    this.earLayerR.position.set(earFront, earBaseY);
    this.earLayerR.rotation = (earOnTop ? 0.12 : 0.38) - jitterRad;
    this.earLayerR.scale.set(dir, 1);
    this.redrawEyes(rs, geo.headW, geo.headH, coat);
  }

  private redrawEyes(rs: RenderState, headW: number, headH: number, coat: CoatConfig): void {
    const g = this.eyesGfx;
    g.clear();
    const eyeX = Math.round(headW * 0.14);
    const eyeY = -Math.round(headH * 0.58);
    const eyeW = Math.max(2, Math.round(headW * 0.16));
    const eyeH = Math.max(2, Math.round(headH * 0.18));
    const rawClosure = rs.pose.sleeping ? 1 : Math.max(rs.procedural.eyeClosure, rs.pose.eyeClosure);
    const closure = rawClosure >= 0.9 ? 1 : rawClosure;
    if (closure >= 0.85) {
      g.rect(eyeX - eyeW / 2, eyeY, eyeW, 1).fill({ color: coat.outline });
    } else {
      const h = Math.max(1, Math.round(eyeH * (1 - closure)));
      const w = Math.max(2, Math.round(eyeW * (1 - closure * 0.3)));
      g.rect(eyeX - w / 2, eyeY, w, h).fill({ color: coat.eye });
      if (closure < 0.35 && h >= 2) {
        g.rect(eyeX - w / 2 + 1, eyeY, 1, 1).fill({ color: 0xf2ead8 });
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


