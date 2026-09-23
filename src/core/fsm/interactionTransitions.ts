/**
 * L.D.C. — 互动迁移表（Milestone 2）
 *
 * ★ 这是"它认识我了"能否成立的关键文件。
 *
 * ─────────────────────────────────────────────────────────────
 * 设计核心：抚摸会**打断**当前行为，但打断后去哪，取决于羁绊值
 * ─────────────────────────────────────────────────────────────
 *
 * 玩家的每一次有效抚摸都会：
 *   ① 提升羁绊值（BondSystem）
 *   ② 让狗进入「回应」流程
 *
 * 而「回应到哪一级」由羁绊阶梯决定：
 *   bond 0.00 → LookAt     看过来
 *   bond 0.32 → Approach   走过来
 *   bond 0.55 → Sit        坐下（由通用 Sit 状态承担）
 *   bond 0.76 → WagTail    摇尾巴
 *   bond 0.93 → PetEnjoy   闭眼享受
 *
 * 实现方式不是"查表跳转"，而是把阶梯状态变成**高优先级的候选**：
 *   被抚摸时，当前阶梯对应的状态获得一个极高的效用分，
 *   从而在裁决中胜出。
 *
 * 为什么这样做而不是直接 forceState：
 *   因为要保留"狗可以拒绝"的能力。
 *   烦躁时会插入 Annoyed / Retreat，它们的分值更高，于是狗会走开 ——
 *   这正是项目要求里"连续点 → 觉得烦 → 走开"的实现。
 *
 * ★ 本文件不含任何犬种专属内容。所有阈值来自 JSON。
 */

import type { Transition, StateContext } from './StateMachine';
import { getBond, getMood } from '../world/blackboardAccess';

/**
 * 抚摸效用门槛。
 *
 * 被抚摸时的回应分数普遍很高（80~140），远超常规行为的 26 门槛，
 * 因此抚摸总能打断当前行为 —— 这符合直觉：你摸它，它会注意到。
 *
 * 唯一的例外是更高分的 Annoyed / Retreat，它们能压过抚摸回应。
 */
export const PETTING_RESPONSE_SCORE = 95;

/** 烦躁行为的基础分：必须高于抚摸回应才能"赶走"狗 */
export const ANNOYANCE_SCORE = 150;

/** 是否正在被抚摸 */
function beingPetted(ctx: StateContext): boolean {
  return ctx.blackboard['beingPetted'] === true;
}

/** 是否刚刚收到一次抚摸（一次性脉冲，用于触发回应） */
function justPetted(ctx: StateContext): boolean {
  return ctx.blackboard['justPetted'] === true;
}

/** 处于"闹别扭"冷却中（刚走开不久） */
function sulking(ctx: StateContext): boolean {
  return ctx.blackboard['sulking'] === true;
}

export function createInteractionTransitions(): readonly Transition[] {
  return [
    // ───────────────────────────────────────────────
    // 骚扰优先：烦躁到阈值 → 走开
    //
    // ★ 这个迁移必须在所有抚摸回应**之前**被评估，
    //   因此给它最高的分值。项目要求里的"连续点 → 走开"就是它。
    // ───────────────────────────────────────────────
    {
      from: '*',
      to: 'Retreat',
      guard: (ctx) => {
        if (sulking(ctx)) return false; // 刚走开过，不重复走
        const mood = getMood(ctx);
        return mood !== null && mood.shouldLeave;
      },
      score: () => ANNOYANCE_SCORE + 40,
      cooldownMs: 4000,
      priority: 10,
    },

    // ───────────────────────────────────────────────
    // 中度烦躁 → 表现出不高兴（转头、起身）
    // 分值高于抚摸回应，但低于走开。
    // ───────────────────────────────────────────────
    {
      from: '*',
      to: 'Annoyed',
      guard: (ctx) => {
        const mood = getMood(ctx);
        if (mood === null) return false;
        return mood.annoyanceLevel >= mood.leaveThreshold * 0.55;
      },
      score: () => ANNOYANCE_SCORE,
      cooldownMs: 2200,
      priority: 5,
    },

    // ───────────────────────────────────────────────
    // ★ 羁绊阶梯：被抚摸时，按当前羁绊值决定回应级别
    //
    // 每一级都是独立迁移，从高到低排列。
    // 由于 score 相同（PETTING_RESPONSE_SCORE），
    // 由 StateMachine 的"同分裁决"决定胜出者 ——
    // 因此这里用 priority 显式控制优先级：级别越高越优先。
    // ───────────────────────────────────────────────

    // 第 5 级：闭眼享受（羁绊最高）
    {
      from: '*',
      to: 'PetEnjoy',
      guard: (ctx) => beingPetted(ctx) && bondRungIs(ctx, 'PetEnjoy'),
      score: () => PETTING_RESPONSE_SCORE,
      priority: 50,
    },

    // 第 4 级：摇尾巴
    {
      from: '*',
      to: 'WagTail',
      guard: (ctx) => justPetted(ctx) && bondRungIs(ctx, 'WagTail'),
      score: () => PETTING_RESPONSE_SCORE,
      priority: 40,
      cooldownMs: 1200,
    },

    // 第 3 级：坐到你旁边
    //   注意：Sit 是通用状态，这里只是借用它作为阶梯的一级。
    //   但只有在狗已经靠近玩家时才坐 —— 否则会"原地坐下"显得莫名其妙。
    {
      from: '*',
      to: 'Sit',
      guard: (ctx) => justPetted(ctx) && bondRungIs(ctx, 'Sit') && isNearPlayer(ctx),
      score: () => PETTING_RESPONSE_SCORE,
      priority: 30,
    },

    // 第 2 级：靠近
    {
      from: '*',
      to: 'Approach',
      guard: (ctx) =>
        justPetted(ctx) && bondRungIs(ctx, 'Approach') && !isNearPlayer(ctx),
      score: () => PETTING_RESPONSE_SCORE,
      priority: 20,
    },

    // 第 1 级：看向玩家
    //   最低一级，也是玩家第一次点会看到的回应。
    {
      from: '*',
      to: 'LookAt',
      guard: (ctx) => justPetted(ctx) && bondRungIs(ctx, 'LookAt'),
      score: () => PETTING_RESPONSE_SCORE - 10,
      priority: 10,
      cooldownMs: 600,
    },
  ];
}

// ─────────────────────────────────────────────────────────────
// 准入守卫：防止互动状态被常规行为打断
// ─────────────────────────────────────────────────────────────

/**
 * 互动状态的准入守卫。
 *
 * 作用与 Phase 0/1 的准入守卫一致：阻止"进行中的互动"被
 * 通用权重系统随意打断。
 *
 * 具体规则：
 *   - 正在被抚摸时（PetEnjoy），不许切到 Idle / Walk / Sleep
 *   - 走开并闹别扭时（Retreat），不许切到任何亲近状态
 *   - 看向/靠近的进行中，不许被打断（让动作做完）
 */
export function createInteractionAdmissionGuards(): Record<
  string,
  (ctx: StateContext) => boolean
> {
  return {
    // 这些"日常"状态在互动进行中不应抢走控制权
    Idle: (ctx) => !isInInteraction(ctx) && !sulking(ctx),
    Walk: (ctx) => !isInteracting(ctx) && !sulking(ctx),
    Sleep: (ctx) => !isInteracting(ctx) && !sulking(ctx),

    // 亲近类状态在闹别扭时不可进入
    Approach: (ctx) => !sulking(ctx),
    WagTail: (ctx) => !sulking(ctx),
    PetEnjoy: (ctx) => !sulking(ctx),
    LookAt: (ctx) => !sulking(ctx),

    // 互动进行中不许被打扰
    Sit: (ctx) => !isInteracting(ctx) || ctx.fsmCurrent === 'Sit',
  };
}

// ─────────────────────────────────────────────────────────────
// 辅助
// ─────────────────────────────────────────────────────────────

/** 当前羁绊阶梯是否指向指定状态 */
function bondRungIs(ctx: StateContext, state: string): boolean {
  const bond = getBond(ctx);
  if (bond === null) return false;
  return bond.currentState() === state;
}

/** 狗是否已经在玩家附近 */
function isNearPlayer(ctx: StateContext): boolean {
  const bb = ctx.blackboard;
  const px = (bb['playerX'] as number | undefined) ?? bb.x;
  const py = (bb['playerY'] as number | undefined) ?? bb.y;
  const dist = Math.hypot(px - bb.x, py - bb.y);
  return dist <= 58;
}

/**
 * 是否处于"互动进行中"。
 *
 * 用于准入守卫：像 WagTail / PetEnjoy / LookAt / Approach 这些状态
 * 一旦进入，就不该被 Idle/Walk 的权重抢走 ——
 * 否则玩家会看到狗"刚看过来又马上转走"，像卡顿而不像生命。
 */
function isInInteraction(ctx: StateContext): boolean {
  const cur = ctx.fsmCurrent;
  return (
    cur === 'LookAt' ||
    cur === 'Approach' ||
    cur === 'WagTail' ||
    cur === 'PetEnjoy' ||
    cur === 'Annoyed' ||
    cur === 'Retreat'
  );
}

/** 更严格的：正在被抚摸中 */
function isInteracting(ctx: StateContext): boolean {
  return beingPetted(ctx) || ctx.blackboard['enjoying'] === true;
}
