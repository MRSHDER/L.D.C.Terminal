/**
 * L.D.C. — 可播种随机数
 *
 * 为什么不用 Math.random()：
 *  1. 可复现 —— 同一个种子产生同样的行为序列，便于调试"刚才那狗为什么走了"
 *  2. 可分支 —— 渲染用噪声不消耗逻辑随机流，保证逻辑层可复现
 *  3. 可测试 —— 单元测试可以注入固定种子
 *
 * 算法：mulberry32，64 位种子转为 32 位状态，足够本项目使用且极快。
 */

export interface Rng {
  /** [0, 1) 均匀分布 */
  next(): number;
  /** [min, max) 实数 */
  range(min: number, max: number): number;
  /** [min, max] 整数 */
  int(min: number, max: number): number;
  /** 以 p 的概率返回 true */
  chance(p: number): boolean;
  /** 从数组中等概率取一个（空数组返回 undefined） */
  pick<T>(items: readonly T[]): T | undefined;
  /** 当前种子（用于快照/复现） */
  readonly seed: number;
}

export function createRng(seed: number): Rng {
  // 保证种子落在 32 位无符号范围内
  let state = (seed >>> 0) || 1;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: <T,>(items: readonly T[]): T | undefined => {
      if (items.length === 0) return undefined;
      return items[Math.floor(next() * items.length)];
    },
    get seed() {
      return state;
    },
  };

  return rng;
}

/**
 * 派生一个独立子流。
 * 用途：渲染噪声与逻辑随机必须互不干扰 —— 否则开不开调试噪声会改变狗的行为。
 */
export function deriveRng(parent: Rng, salt: number): Rng {
  return createRng((parent.seed ^ Math.imul(salt, 0x9e3779b9)) >>> 0);
}

/** 哈希字符串为 32 位种子，用于"按 id 生成稳定噪声" */
export function hashSeed(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
