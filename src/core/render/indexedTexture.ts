import { Texture } from 'pixi.js';
import { DOG_SPRITE_PALETTE } from './spriteDog';

export function textureFromIndexed(pixels: string, width: number, height: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');
  const image = ctx.createImageData(width, height);
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const idx = parseInt(pixels[i] ?? '0', 16);
    const color = DOG_SPRITE_PALETTE[idx] ?? DOG_SPRITE_PALETTE[0]!;
    const o = i * 4;
    image.data[o] = color[0]!;
    image.data[o + 1] = color[1]!;
    image.data[o + 2] = color[2]!;
    image.data[o + 3] = color[3]!;
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
