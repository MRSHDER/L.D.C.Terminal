import { Texture, Rectangle } from 'pixi.js';
import type { SpeciesData, SpriteClipConfig, SpriteSheetConfig } from '../data/types';

export function resolveSpeciesAssetUrl(assetRoot: string, src: string): string {
  const base = String(import.meta.env.BASE_URL ?? '/').replace(/\/+$/, '');
  const root = assetRoot.replace(/\/+$/, '');
  const file = src.replace(/^\/+/, '');
  const path = [root, file].filter(Boolean).join('/');
  return `${base}/${path.replace(/^\/+/, '')}`;
}

export function readIdleClip(
  species: SpeciesData,
): { sheet: SpriteSheetConfig; clip: SpriteClipConfig } | null {
  const sprites = species.resources.sprites;
  const clip = sprites?.clips['idle'];
  if (!sprites || !clip) return null;
  return { sheet: sprites, clip };
}

export function sliceRowSheet(
  image: HTMLImageElement,
  frameWidth: number,
  frameHeight: number,
  frames: number,
): Texture[] {
  const base = Texture.from(image);
  try {
    base.source.scaleMode = 'nearest';
  } catch {
    /* pixi version difference */
  }
  const out: Texture[] = [];
  const count = Math.max(1, frames);
  for (let i = 0; i < count; i++) {
    const frame = new Rectangle(i * frameWidth, 0, frameWidth, frameHeight);
    const tex = new Texture({ source: base.source, frame });
    try {
      tex.source.scaleMode = 'nearest';
    } catch {
      /* ignore */
    }
    out.push(tex);
  }
  return out;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`sprite asset missing: ${url}`));
    img.src = url;
  });
}
