/**
 * L.D.C. — 黑板访问器（blackboardAccess）
 *
 * 状态机与迁移表的守卫/打分函数是**纯函数** `(ctx) => value`，
 * 它们拿不到 World、BondSystem、MoodSystem 的引用（那会造成循环依赖）。
 *
 * 本文件提供一层薄薄的类型安全访问：
 *   World 每帧把系统引用写入黑板 → 守卫通过本模块取出。
 *
 * ★ 为什么不直接把 BondSystem 挂到 StateContext：
 *   那会让 StateContext 依赖 affection/ 模块，
 *   而 affection/ 又依赖 data/types —— 依赖方向会变乱。
 *   黑板作为「弱引用交换区」，把这条依赖变成了单向的。
 *
 * ★ 为什么不把羁绊值本身（数字）写进黑板：
 *   因为守卫需要调用 currentState() 这样的方法（阶梯查表）。
 *   存引用比每帧拷贝派生值更省，也不会出现"黑板值与系统值不同步"的 bug。
 */

import type { StateContext } from '../fsm/StateMachine';
import type { BondSystem } from '../affection/BondSystem';
import type { MoodSystem } from '../affection/MoodSystem';

/** 黑板中存放系统引用的键名（集中声明，避免拼写错误） */
export const BB_BOND_SYSTEM = '__bondSystem';
export const BB_MOOD_SYSTEM = '__moodSystem';

/** 取羁绊系统；未挂载时返回 null（守卫需自行处理） */
export function getBond(ctx: StateContext): BondSystem | null {
  const v = ctx.blackboard[BB_BOND_SYSTEM];
  return (v as BondSystem | undefined) ?? null;
}

/** 取情绪系统；未挂载时返回 null */
export function getMood(ctx: StateContext): MoodSystem | null {
  const v = ctx.blackboard[BB_MOOD_SYSTEM];
  return (v as MoodSystem | undefined) ?? null;
}
