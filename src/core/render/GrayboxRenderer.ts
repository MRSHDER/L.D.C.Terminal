/**
 * L.D.C. — 渲染器（PixiJS）
 * 狗使用独立精灵帧素材。Pixi 8 不能把 data URL 当 Asset id，必须先解码成 Image。
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
import { PALETTE } from './palette';
import { DOG_FRAME_H, DOG_FRAME_IMAGES, DOG_FRAME_W } from './spriteDogGenerated';

export interface GrayboxRendererOptions {
  readonly designWidth: number;
  readonly designHeight: number;
  readonly background?: number;
  readonly showGrid?: boolean;
}

const DOG_WALK_TEXTURE_INDEXES = [1, 2, 1, 2] as const;

function textureFromDataUrl(src: string): Promise<Texture> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const texture = Texture.from(img);
      try {
        texture.source.scaleMode = 'nearest';
      } catch {
        /* pixi version difference */
      }
      resolve(texture);
    };
    img.onerror = () => reject(new Error('dog frame decode failed'));
    img.src = src;
  });
}

export class GrayboxRenderer {
  readonly app: Application;
  private readonly options: GrayboxRendererOptions;
  private readonly stage: Container;
  private readonly background: Graphics;
  private readonly grid: Graphics;
  private readonly shadowLayer: Graphics;
  private dogTextures: Texture[] = [];
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

    this.dogTextures = await Promise.all(DOG_FRAME_IMAGES.map(textureFromDataUrl));
    const first = this.dogTextures[0];
    if (!first) throw new Error('dog frames missing');
    const dog = new Sprite(first);
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
    const facingRight = rs.facingDeg >= -90 && rs.facingDeg <= 90;
    const dir = facingRight ? 1 : -1;
    const moving = rs.moving || rs.speedRatio > 0.05;
    const frame = Math.max(0, rs.frameIndex);
    const walkFrame = frame % DOG_WALK_TEXTURE_INDEXES.length;
    const dogTexture = moving
      ? this.dogTextures[DOG_WALK_TEXTURE_INDEXES[walkFrame] ?? 1] ?? this.dogTextures[0]
      : this.dogTextures[0];
    if (dogTexture && this.dog.texture !== dogTexture) this.dog.texture = dogTexture;

    const scaleBase = 1.06;
    const poseScaleY = Math.max(0.58, rs.pose.bodyHeightRatio || 1);
    const proceduralScaleY = p.scaleY || 1;
    const scaleX = dir * scaleBase * Math.abs(p.scaleX || 1);
    const scaleY = scaleBase * poseScaleY * proceduralScaleY;

    const baseX = Math.round(rs.x + p.offsetX);
    const baseY = Math.round(rs.y + p.offsetY + rs.pose.groundOffsetPx);

    const shadowW = moving ? 42 + Math.round(rs.speedRatio * 6) : 40;
    const shadowH = moving ? 5 : 4;
    this.shadowLayer.clear();
    this.shadowLayer.ellipse(Math.round(rs.x), Math.round(rs.y + 2), shadowW, shadowH).fill({
      color: 0x000000,
      alpha: 0.3,
    });

    this.dog.position.set(baseX, baseY);
    this.dog.scale.set(scaleX, Math.abs(scaleY));
    this.dog.alpha = rs.pose.sleeping ? 0.92 : 1;
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
    return new Rectangle(0, 0, DOG_FRAME_W, DOG_FRAME_H);
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
