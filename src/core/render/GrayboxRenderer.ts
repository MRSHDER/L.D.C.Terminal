/**
 * L.D.C. — 渲染器（PixiJS）
 * 狗用调色板像素图在 canvas 上画出，不再嵌 base64 PNG。
 */

import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
  type Ticker,
} from 'pixi.js';
import type { RenderState } from '../animation/AnimationSystem';
import type { SpeciesData } from '../data/types';
import { resolveGrayboxSize } from '../data/defaults';
import { PALETTE } from './palette';
import {
  DOG_SPRITE_H,
  DOG_SPRITE_PALETTE,
  DOG_SPRITE_PIXELS,
  DOG_SPRITE_W,
} from './spriteDog';

export interface GrayboxRendererOptions {
  readonly designWidth: number;
  readonly designHeight: number;
  readonly background?: number;
  readonly showGrid?: boolean;
}

function textureFromPixelMap(): Texture {
  const w = DOG_SPRITE_W;
  const h = DOG_SPRITE_H;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  const image = ctx.createImageData(w, h);
  const pix = DOG_SPRITE_PIXELS;
  for (let i = 0; i < pix.length; i++) {
    const pal = DOG_SPRITE_PALETTE[parseInt(pix[i], 16)] ?? [0, 0, 0, 0];
    const o = i * 4;
    image.data[o] = pal[0];
    image.data[o + 1] = pal[1];
    image.data[o + 2] = pal[2];
    image.data[o + 3] = pal[3];
  }
  ctx.putImageData(image, 0, 0);
  const texture = Texture.from(canvas);
  try {
    texture.source.scaleMode = 'nearest';
  } catch {
    /* pixi version difference */
  }
  return texture;
}

export class GrayboxRenderer {
  readonly app: Application;
  private readonly options: GrayboxRendererOptions;
  private readonly stage: Container;
  private readonly background: Graphics;
  private readonly grid: Graphics;
  private readonly shadowLayer: Graphics;
  private dog: Sprite | null = null;
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

    const dog = new Sprite(textureFromPixelMap());
    dog.anchor.set(0.52, 0.92);
    dog.roundPixels = true;
    this.dog = dog;

    this.stage.addChild(this.background, this.grid, this.shadowLayer, dog);
    this.app.stage.addChild(this.stage);
    this.drawStaticBackground();
    this.initialized = true;
  }

  setSpecies(species: SpeciesData): void {
    const roomChanged =
      this.species?.room.floorLineRatio !== species.room.floorLineRatio ||
      this.species?.room.floorColor !== species.room.floorColor ||
      this.species?.room.wallColor !== species.room.wallColor ||
      this.species?.room.showGrid !== species.room.showGrid;
    this.species = species;
    if (roomChanged || !this.background.parent) this.drawStaticBackground();
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

  render(rs: RenderState): void {
    if (!this.initialized || !this.dog) return;
    const p = rs.procedural;
    const baseX = Math.round(rs.x + p.offsetX);
    const baseY = Math.round(rs.y + p.offsetY);
    const facingRight = rs.facingDeg >= -90 && rs.facingDeg <= 90;
    const dir = facingRight ? 1 : -1;
    const scale = 1.35 * (p.scaleY || 1) * (rs.pose.bodyHeightRatio || 1);

    this.shadowLayer.clear();
    this.shadowLayer.ellipse(Math.round(rs.x), Math.round(rs.y + 2), 26, 4).fill({
      color: 0x000000,
      alpha: 0.32,
    });

    this.dog.position.set(baseX, baseY);
    this.dog.scale.set(dir * Math.abs(scale), Math.abs(scale));
  }

  renderFrame(): void {
    if (!this.initialized) return;
    this.app.renderer.render(this.app.stage);
  }

  resize(designWidth: number, designHeight: number): void {
    if (!this.initialized) return;
    this.app.renderer.resize(designWidth, designHeight);
    this.drawStaticBackground();
  }

  get bounds(): Rectangle {
    const size = this.species ? resolveGrayboxSize(this.species) : { w: DOG_SPRITE_W, h: DOG_SPRITE_H };
    return new Rectangle(0, 0, size.w, size.h);
  }

  destroy(): void {
    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = this.app.canvas ?? null;
    } catch {
      canvas = null;
    }
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
    this.initialized = false;
  }

  get ticker(): Ticker {
    return this.app.ticker;
  }
}
