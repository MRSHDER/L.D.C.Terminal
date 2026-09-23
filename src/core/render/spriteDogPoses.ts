/** Derive sit / sleep / eat / wag frames from the standing indexed sprite. */
import { DOG_SPRITE_H, DOG_SPRITE_PIXELS, DOG_SPRITE_W } from './spriteDog';

export const POSE_W = DOG_SPRITE_W;
export const POSE_H = DOG_SPRITE_H;

function gridOf(pixels: string): string[][] {
  const rows: string[][] = [];
  for (let y = 0; y < DOG_SPRITE_H; y++) {
    rows.push(pixels.slice(y * DOG_SPRITE_W, (y + 1) * DOG_SPRITE_W).split(''));
  }
  return rows;
}

function flatten(rows: string[][]): string {
  return rows.map((row) => row.join('')).join('');
}

function blank(): string[][] {
  return Array.from({ length: DOG_SPRITE_H }, () => Array.from({ length: DOG_SPRITE_W }, () => '0'));
}

function shiftRegion(src: string[][], x0: number, x1: number, y0: number, y1: number, dx: number, dy: number): string[][] {
  const out = blank();
  for (let y = 0; y < DOG_SPRITE_H; y++) {
    for (let x = 0; x < DOG_SPRITE_W; x++) {
      const p = src[y]![x]!;
      if (p === '0') continue;
      const drop = x >= x0 && x < x1 && y >= y0 && y < y1;
      const xx = x + (drop ? dx : 0);
      const yy = y + (drop ? dy : 0);
      if (xx >= 0 && xx < DOG_SPRITE_W && yy >= 0 && yy < DOG_SPRITE_H) out[yy]![xx] = p;
    }
  }
  return out;
}

function sit(src: string[][], nudge: number): string {
  const out = blank();
  for (let y = 0; y < 33; y++) {
    for (let x = 0; x < DOG_SPRITE_W; x++) {
      const p = src[y]![x]!;
      if (p === '0') continue;
      const yy = y + 6 + nudge;
      if (yy < DOG_SPRITE_H) out[yy]![x] = p;
    }
  }
  for (let i = 0, y = 33; y < DOG_SPRITE_H; y += 2, i++) {
    const yy = 39 + i + nudge;
    if (yy >= DOG_SPRITE_H) continue;
    for (let x = 0; x < DOG_SPRITE_W; x++) {
      const p = src[y]![x]!;
      if (p !== '0') out[yy]![x] = p;
    }
  }
  return flatten(out);
}

function sleep(src: string[][], nudge: number): string {
  const out = blank();
  for (let y = 0; y < DOG_SPRITE_H; y++) {
    const srcY = Math.min(DOG_SPRITE_H - 1, Math.floor(y * 0.72));
    for (let x = 0; x < DOG_SPRITE_W; x++) {
      const p = src[srcY]![x]!;
      if (p === '0') continue;
      const yy = y + 8 + nudge;
      if (yy < DOG_SPRITE_H) out[yy]![x] = p;
    }
  }
  return flatten(out);
}

const BASE = gridOf(DOG_SPRITE_PIXELS);

export const POSE_CLIPS: Record<string, readonly string[]> = {
  Sit: [sit(BASE, 0), sit(BASE, 1)],
  Sleep: [sleep(BASE, 0), sleep(BASE, 1)],
  Eat: [flatten(shiftRegion(BASE, 36, 64, 0, 28, 0, 4)), flatten(shiftRegion(BASE, 36, 64, 0, 28, 0, 5))],
  WagTail: [flatten(shiftRegion(BASE, 0, 18, 0, 22, 0, -2)), flatten(shiftRegion(BASE, 0, 18, 0, 22, 0, 2))],
  PetEnjoy: [sit(BASE, 0), sit(BASE, 1)],
};
