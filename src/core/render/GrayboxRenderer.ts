/**
 * L.D.C. — 渲染器（PixiJS）
 * 默认使用多状态狗狗精灵帧。若 species.resources.sprites.clips.idle 可加载，则 idle 可由犬种数据覆盖。
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
import {
  DOG_ANIMATION_FRAMES,
  DOG_FRAME_H,
  DOG_FRAME_W,
  type DogAnimationId,
} from './spriteDogStates';
import { loadImage, readIdleClip, resolveSpeciesAssetUrl, sliceRowSheet } from './spriteAssets';

export interface GrayboxRendererOptions {
  readonly designWidth: number;
  readonly designHeight: number;
  readonly background?: number;
  readonly showGrid?: boolean;
}

const WALK_CLIPS = new Set(['Walk', 'Approach', 'Retreat']);
const RUN_CLIPS = new Set(['Run']);
const SIT_CLIPS = new Set(['Sit', 'PetEnjoy', 'Sleep']);
const HEAD_LOW_CLIPS = new Set(['HeadLow', 'LowHead', 'Sniff']);
const WAG_TAIL_CLIPS = new Set(['WagTail']);
const EAT_CLIPS = new Set(['Eat', 'Eating']);
const DRINK_CLIPS = new Set(['Drink', 'Drinking']);
const IDLE_CLIPS = new Set(['Idle', 'LookAt']);
const DEFAULT_SCALE = 0.96;

type DogTextureMap = Readonly<Record<DogAnimationId, readonly Texture[]>>;

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

async function loadDogTextures(): Promise<DogTextureMap> {
  return {
    idle: await Promise.all(DOG_ANIMATION_FRAMES.idle.map(textureFromDataUrl)),
    walk: await Promise.all(DOG_ANIMATION_FRAMES.walk.map(textureFromDataUrl)),
    run: await Promise.all(DOG_ANIMATION_FRAMES.run.map(textureFromDataUrl)),
    sit: await Promise.all(DOG_ANIMATION_FRAMES.sit.map(textureFromDataUrl)),
    headLow: await Promise.all(DOG_ANIMATION_FRAMES.headLow.map(textureFromDataUrl)),
    wagTail: await Promise.all(DOG_ANIMATION_FRAMES.wagTail.map(textureFromDataUrl)),
    eat: await Promise.all(DOG_ANIMATION_FRAMES.eat.map(textureFromDataUrl)),
    drink: await Promise.all(DOG_ANIMATION_FRAMES.drink.map(textureFromDataUrl)),
  };
}

function animationForRenderState(rs: RenderState): DogAnimationId {
  if (RUN_CLIPS.has(rs.clipId)) return 'run';
  if (WALK_CLIPS.has(rs.clipId)) return rs.speedRatio > 0.72 ? 'run' : 'walk';
  if (SIT_CLIPS.has(rs.clipId)) return 'sit';
  if (HEAD_LOW_CLIPS.has(rs.clipId)) return 'headLow';
  if (WAG_TAIL_CLIPS.has(rs.clipId)) return 'wagTail';
  if (EAT_CLIPS.has(rs.clipId)) return 'eat';
  if (DRINK_CLIPS.has(rs.clipId)) return 'drink';
  if (rs.moving) return rs.speedRatio > 0.72 ? 'run' : 'walk';
  return 'idle';
}

export class GrayboxRenderer {
  readonly app: Application;
  private readonly options: GrayboxRendererOptions;
  private readonly stage: Container;
  private readonly background: Graphics;
  private readonly grid: Graphics;
  private readonly shadowLayer: Graphics;
  private dogTextures: DogTextureMap | null = null;
  private idleSheet: Texture[] | null = null;
  private idleLoadGen = 0;
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

    this.dogTextures = await loadDogTextures();
    const first = this.dogTextures.idle[0];
    if (!first) throw new Error('dog frames missing');
    const dog = new Sprite(first);
    dog.anchor.set(0.52, 0.92);
    dog.roundPixels = true;
    this.dog = dog;

    this.stage.addChild(this.background, this.grid, this.shadowLayer, dog);
    this.app.stage.addChild(this.stage);
    this.drawStaticBackground();
    this.initialized = true;
    if (this.species) void this.loadIdleSheet(this.species);
  }

  setSpecies(species: SpeciesData): void {
    const roomChanged =
      this.species?.room.floorLineRatio !== species.room.floorLineRatio ||
      this.species?.room.floorColor !== species.room.floorColor ||
      this.species?.room.wallColor !== species.room.wallColor ||
      this.species?.room.showGrid !== species.room.showGrid;
    this.species = species;
    if (roomChanged || !this.background.parent) this.drawStaticBackground();
    void this.loadIdleSheet(species);
  }

  private async loadIdleSheet(species: SpeciesData): Promise<void> {
    const gen = ++this.idleLoadGen;
    this.idleSheet = null;
    const declared = readIdleClip(species);
    if (!declared) return;
    const { sheet, clip } = declared;
    const frameWidth = clip.frameWidth ?? sheet.defaults?.frameWidth ?? 96;
    const frameHeight = clip.frameHeight ?? sheet.defaults?.frameHeight ?? 64;
    const url = resolveSpeciesAssetUrl(species.resources.assetRoot, clip.src);
    try {
      const image = await loadImage(url);
      if (gen !== this.idleLoadGen) return;
      this.idleSheet = sliceRowSheet(image, frameWidth, frameHeight, clip.frames);
    } catch {
      if (gen !== this.idleLoadGen) return;
      this.idleSheet = null;
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

  private pickTexture(rs: RenderState): Texture {
    const textures = this.dogTextures;
    if (!textures) throw new Error('dog textures missing');

    if (this.idleSheet && this.idleSheet.length > 0 && IDLE_CLIPS.has(rs.clipId)) {
      return this.idleSheet[rs.frameIndex % this.idleSheet.length] ?? this.idleSheet[0]!;
    }

    const animationId = animationForRenderState(rs);
    const frames = textures[animationId];
    return frames[rs.frameIndex % frames.length] ?? textures.idle[0]!;
  }

  render(rs: RenderState): void {
    if (!this.initialized || !this.dog) return;

    const p = rs.procedural;
    const facingRight = rs.facingDeg >= -90 && rs.facingDeg <= 90;
    const dir = facingRight ? 1 : -1;
    const moving = rs.moving || rs.speedRatio > 0.05;
    const dogTexture = this.pickTexture(rs);
    if (dogTexture && this.dog.texture !== dogTexture) this.dog.texture = dogTexture;

    const scale = DEFAULT_SCALE;
    const baseX = Math.round(rs.x + p.offsetX);
    const baseY = Math.round(rs.y + p.offsetY);

    const shadowW = moving ? 42 + Math.round(rs.speedRatio * 6) : 40;
    const shadowH = moving ? 5 : 4;
    this.shadowLayer.clear();
    this.shadowLayer.ellipse(Math.round(rs.x), Math.round(rs.y + 2), shadowW, shadowH).fill({
      color: 0x000000,
      alpha: 0.3,
    });

    this.dog.position.set(baseX, baseY);
    this.dog.scale.set(dir * scale, scale);
    this.dog.alpha = 1;
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

