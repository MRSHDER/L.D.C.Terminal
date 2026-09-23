/**
 * L.D.C. — 基础几何类型
 *
 * 刻意保持最小：只提供引擎实际用到的类型，不引入向量库。
 * 坐标系统一为「世界坐标，像素单位，Y 轴向下」。
 */

export interface Vector2 {
  x: number;
  y: number;
}

/** 只读二维向量（对外暴露时使用，防止外部改到内部状态） */
export type ReadonlyVector2 = Readonly<Vector2>;

export interface Size {
  w: number;
  h: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const vec2 = (x = 0, y = 0): Vector2 => ({ x, y });

export const vec2Add = (a: Vector2, b: Vector2): Vector2 => ({ x: a.x + b.x, y: a.y + b.y });

export const vec2Sub = (a: Vector2, b: Vector2): Vector2 => ({ x: a.x - b.x, y: a.y - b.y });

export const vec2Scale = (a: Vector2, s: number): Vector2 => ({ x: a.x * s, y: a.y * s });

export const vec2Length = (a: Vector2): number => Math.hypot(a.x, a.y);

export const vec2Distance = (a: Vector2, b: Vector2): number => Math.hypot(a.x - b.x, a.y - b.y);

export const vec2Normalize = (a: Vector2): Vector2 => {
  const len = Math.hypot(a.x, a.y);
  if (len < 1e-6) return { x: 0, y: 0 };
  return { x: a.x / len, y: a.y / len };
};

/** 朝目标移动，但不超过目标点（避免来回抖动） */
export const vec2MoveTowards = (from: Vector2, to: Vector2, maxDelta: number): Vector2 => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= maxDelta || dist < 1e-6) return { x: to.x, y: to.y };
  const k = maxDelta / dist;
  return { x: from.x + dx * k, y: from.y + dy * k };
};

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const clamp01 = (v: number): number => clamp(v, 0, 1);

/** 线性插值 */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * 把值从 [inMin,inMax] 映射到 [outMin,outMax]。
 * 用于把性格数值（0..1）映射到实际物理量。
 */
export const remap = (
  v: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number => {
  if (inMax === inMin) return outMin;
  const t = (v - inMin) / (inMax - inMin);
  return outMin + (outMax - outMin) * t;
};

/** 角度归一化到 (-180, 180] */
export const normalizeAngleDeg = (deg: number): number => {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
};

/** 角度插值（走最短路径） */
export const lerpAngleDeg = (a: number, b: number, t: number): number =>
  a + normalizeAngleDeg(b - a) * t;
