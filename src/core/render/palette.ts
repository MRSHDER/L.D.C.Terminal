/**
 * L.D.C. — 调色板
 *
 * 灰盒阶段主体色跟伯恩山犬三色的黑 / 褐。
 * 白色 blaze / bib / socks 由 coat.markings 驱动，渲染器接上后再画。
 */

export const PALETTE = {
  bgDeep: 0x0e0e12,
  bgMid: 0x16161c,
  bgSoft: 0x1e1e26,

  grid: 0x26262f,

  /** 伯恩山底色：近黑暖棕 */
  bodyFill: 0x1c1612,
  bodyShade: 0x0e0c09,
  bodyHighlight: 0x3a302c,
  bodyOutline: 0x0a0906,

  /** 头部用锈褐，侧视能读出三色 */
  headFill: 0xb85a28,
  headShade: 0x8a3616,

  eyeOpen: 0x2a2210,
  eyeClosed: 0x0a0906,

  accent: 0x6ec6f0,
  accentDim: 0x3d7fa3,

  ink: 0xd8d8e0,
  inkDim: 0x7a7a88,
  ok: 0x7fd8a0,
  warn: 0xe8c07a,
  error: 0xe88a8a,
} as const;

export function toCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
