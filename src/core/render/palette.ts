/**
 * L.D.C. — 调色板
 *
 * 视觉约束（来自设计文档）：
 *   - 黑白灰为主
 *   - 少量天蓝作为强调色
 *   - 低分辨率像素风（GBA / NDS / Pokémon GBA 参考）
 *
 * ★ 灰盒阶段也要遵守配色 —— 因为「灰盒决定最终观感」，
 *   如果灰盒随便用色，接入美术时会出现调性割裂。
 */

export const PALETTE = {
  /** 背景：比纯黑略暖，避免 OLED 上的死黑 */
  bgDeep: 0x0e0e12,
  bgMid: 0x16161c,
  bgSoft: 0x1e1e26,

  /** 网格线：低对比，只提供空间感 */
  grid: 0x26262f,

  /** 灰盒主体：中灰，与背景拉开但保持克制 */
  bodyFill: 0x6e6e7a,
  bodyShade: 0x4a4a54,
  bodyHighlight: 0x8e8e9a,
  bodyOutline: 0x2a2a32,

  /** 头部略亮，形成层次 */
  headFill: 0x82828e,
  headShade: 0x5a5a66,

  /** 眼睛：深色 */
  eyeOpen: 0x14141a,
  eyeClosed: 0x3a3a44,

  /** ★ 强调色：天蓝。仅用于「值得注意」的元素 */
  accent: 0x6ec6f0,
  accentDim: 0x3d7fa3,

  /** 文本 / UI */
  ink: 0xd8d8e0,
  inkDim: 0x7a7a88,
  ok: 0x7fd8a0,
  warn: 0xe8c07a,
  error: 0xe88a8a,
} as const;

/** 数字 → CSS hex 字符串 */
export function toCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
