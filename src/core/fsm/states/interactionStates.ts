/**
 * L.D.C. — 互动状态集（Milestone 2）
 *
 * ★ 这些状态回答同一个问题：「它愿意回应我吗？」
 *
 *   LookAt    看向玩家        —— 最低级的回应，只是注意到了
 *   Approach  靠近玩家        —— 愿意移动过来
 *   WagTail   摇尾巴          —— 明确的开心
 *   PetEnjoy  闭眼享受        —— 完全信任
 *   Annoyed   烦躁            —— 被骚扰了
 *   Retreat   走开            —— 躲开你
 *
 * ★ 它们全部是「通用互动姿态」，不是犬种专属。
 *   犬种差异来自：
 *     - affection.bonding.ladder   → 什么羁绊值触发哪一级
 *     - affection.annoyance.*      → 多容易被惹烦
 *     - temperament.*              → 通过乘子影响接近速度与摇摆幅度
 *
 * 每个状态只做两件事：
 *   ① 推进物理（位置、朝向、速度）
 *   ② 声明「完成条件」
 * 何时进入某状态由 BondSystem / MoodSystem + 迁移表决定。
 */

import type { State, StateContext } from '../StateMachine';
import {
  clamp,
  vec2MoveTowards,
  normalizeAngleDeg,
} from '../../world/Vector2';

/**
 * 玩家位置（世界坐标）。
 *
 * 从黑板读取 —— 由 World 每帧写入。
 * 状态不直接接触输入层，保持逻辑与输入解耦。
 */
function playerPos(ctx: StateContext): { x: number; y: number } {
  const bb = ctx.blackboard;
  return {
    x: (bb['playerX'] as number | undefined) ?? bb.x,
    y: (bb['playerY'] as number | undefined) ?? bb.y + 40,
  };
}

/**
 * 转向玩家。返回当前朝向与目标的夹角（度）。
 *
 * 与 moveTowardsTarget 的区别：不移动，只转头。
 * 转头速度同样受 turnRateDeg 限制（大型犬转头也慢）。
 */
function turnTowardPlayer(ctx: StateContext): number {
  const bb = ctx.blackboard;
  const p = playerPos(ctx);

  const desiredFacing = (Math.atan2(p.y - bb.y, p.x - bb.x) * 180) / Math.PI;
  const maxTurn = ctx.species.locomotion.turnRateDeg * ctx.dtSec;
  const delta = normalizeAngleDeg(desiredFacing - bb.facingDeg);
  bb.facingDeg = normalizeAngleDeg(bb.facingDeg + clamp(delta, -maxTurn, maxTurn));

  // 返回剩余角度差（供状态判断"是否已看向玩家"）
  return Math.abs(normalizeAngleDeg(desiredFacing - bb.facingDeg));
}

/** 朝玩家移动，返回是否已到达指定距离 */
function moveTowardPlayer(
  ctx: StateContext,
  stopDistancePx: number,
  speedPxPerSec: number,
): boolean {
  const bb = ctx.blackboard;
  const p = playerPos(ctx);

  const dx = p.x - bb.x;
  const dy = p.y - bb.y;
  const dist = Math.hypot(dx, dy);

  if (dist <= stopDistancePx) {
    bb.speedPxPerSec = 0;
    bb.moving = false;
    return true;
  }

  // 朝向玩家
  const desiredFacing = (Math.atan2(dy, dx) * 180) / Math.PI;
  const maxTurn = ctx.species.locomotion.turnRateDeg * ctx.dtSec;
  const delta = normalizeAngleDeg(desiredFacing - bb.facingDeg);
  bb.facingDeg = normalizeAngleDeg(bb.facingDeg + clamp(delta, -maxTurn, maxTurn));

  // 只有朝向大致对了才移动（避免"螃蟹走"）
  if (Math.abs(delta) > 75) {
    bb.speedPxPerSec = 0;
    bb.moving = false;
    return false;
  }

  const step = speedPxPerSec * ctx.dtSec;
  const next = vec2MoveTowards({ x: bb.x, y: bb.y }, p, step);
  bb.x = next.x;
  bb.y = next.y;
  bb.speedPxPerSec = speedPxPerSec;
  bb.moving = true;

  return false;
}

// ─────────────────────────────────────────────────────────────
// LookAt —— 看向玩家
//
// 最低成本、最先出现的回应。
// 项目要求里的"第一次点 → 看向玩家"。
// ─────────────────────────────────────────────────────────────

export interface LookAtOptions {
  /** 保持看多久（ms） */
  readonly durationMs?: number;
  /** 转头到位后是否算"已看见" */
  readonly requireFacing?: boolean;
}

export function createLookAtState(options: LookAtOptions = {}): State {
  const durationMs = options.durationMs ?? 2200;

  return {
    id: 'LookAt',
    animationTag: 'Idle',

    onEnter(ctx) {
      const bb = ctx.blackboard;
      bb.speedPxPerSec = 0;
      bb.moving = false;
      // 记住是否"看见"了玩家 —— 供迁移表与调试使用
      bb['lookedAtPlayer'] = false;
    },

    onUpdate(ctx) {
      const bb = ctx.blackboard;
      bb.moving = false;

      const remaining = turnTowardPlayer(ctx);

      // 夹角小于 18° 视为已经看过来
      if (remaining < 18) {
        bb['lookedAtPlayer'] = true;
      }

      // 看够了就交给裁决系统决定下一步
      if (bb.stateElapsedMs >= durationMs) {
        return null;
      }
      return null;
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Approach —— 走向玩家
//
// 项目要求里的"第二次 → 慢慢走过来"。
// 速度刻意用 walkSpeed 的 0.7 倍 —— "慢慢"是重点。
// ─────────────────────────────────────────────────────────────

export interface ApproachOptions {
  /** 停在离玩家多远（像素） */
  readonly stopDistancePx?: number;
  /** 速度占 walkSpeedPx 的比例 */
  readonly speedRatio?: number;
  /** 超时（ms），防止永远走不到 */
  readonly timeoutMs?: number;
}

export function createApproachState(options: ApproachOptions = {}): State {
  const stopDistance = options.stopDistancePx ?? 46;
  const speedRatio = options.speedRatio ?? 0.7;
  const timeoutMs = options.timeoutMs ?? 6000;

  return {
    id: 'Approach',
    animationTag: 'Walk',

    onEnter(ctx) {
      ctx.blackboard['approachArrived'] = false;
    },

    onUpdate(ctx) {
      const bb = ctx.blackboard;

      // 玩家位置在接近过程中可能变化，每帧重新取
      const arrived = moveTowardPlayer(
        ctx,
        stopDistance,
        ctx.species.locomotion.walkSpeedPx * speedRatio,
      );

      if (arrived) {
        bb['approachArrived'] = true;
        bb.moving = false;
        bb.speedPxPerSec = 0;

        // 到达后停一会儿，让它自然地把头转向玩家
        turnTowardPlayer(ctx);

        if (bb.stateElapsedMs >= 900) return null;
        return null;
      }

      // 超时保护
      if (bb.stateElapsedMs >= timeoutMs) {
        bb.moving = false;
        bb.speedPxPerSec = 0;
      }

      return null;
    },
  };
}

// ─────────────────────────────────────────────────────────────
// WagTail —— 摇尾巴
//
// 项目要求里的"第四次 → 摇尾巴"。
// 注意：尾巴的摆动本身由 ProceduralLayer 完成，
// 本状态负责**提高兴奋度**，从而让尾巴自动摆得更欢。
//
// ★ 这是"情绪驱动表现"而非"状态播放动画"的例子：
//   状态只需修改情绪，动画层自然跟随。
// ─────────────────────────────────────────────────────────────

export interface WagTailOptions {
  readonly durationMs?: number;
}

export function createWagTailState(options: WagTailOptions = {}): State {
  const durationMs = options.durationMs ?? 2600;

  return {
    id: 'WagTail',
    animationTag: 'Idle',

    onEnter(ctx) {
      const bb = ctx.blackboard;
      bb.moving = false;
      bb.speedPxPerSec = 0;
      // 标记"正在摇摆" —— 情绪层据此把 arousal 顶到高位
      bb['wagging'] = true;
      bb['wagStartedAtMs'] = ctx.elapsedMs;
    },

    onExit(ctx) {
      ctx.blackboard['wagging'] = false;
    },

    onUpdate(ctx) {
      const bb = ctx.blackboard;
      bb.moving = false;

      // 面向玩家摇尾巴
      turnTowardPlayer(ctx);

      if (ctx.elapsedMs - ((bb['wagStartedAtMs'] as number) ?? 0) >= durationMs) {
        bb['wagging'] = false;
        return null;
      }
      return null;
    },
  };
}

// ─────────────────────────────────────────────────────────────
// PetEnjoy —— 闭眼享受
//
// 项目要求里的"第五次 → 闭眼"与"长按 → 享受"。
//
// ★ 关键：这个状态只在**持续被抚摸**时维持。
//   手一松开就退出 —— 这让"闭眼"成为对玩家的**回应**，
//   而不是一个会自动播放的循环动画。
// ─────────────────────────────────────────────────────────────

export interface PetEnjoyOptions {
  /** 是否必须在被抚摸中（true = 松手就退出） */
  readonly requiresPetting?: boolean;
  /** 最长持续（ms） */
  readonly maxDurationMs?: number;
  /** 退出后回到哪个状态 */
  readonly exitTo?: string;
}

export function createPetEnjoyState(options: PetEnjoyOptions = {}): State {
  const requiresPetting = options.requiresPetting ?? true;
  const maxDurationMs = options.maxDurationMs ?? 12000;
  const exitTo = options.exitTo ?? 'Idle';

  return {
    id: 'PetEnjoy',
    animationTag: 'Sit', // 坐下来享受

    onEnter(ctx) {
      const bb = ctx.blackboard;
      bb.moving = false;
      bb.speedPxPerSec = 0;
      bb['enjoying'] = true;
    },

    onExit(ctx) {
      ctx.blackboard['enjoying'] = false;
    },

    onUpdate(ctx) {
      const bb = ctx.blackboard;
      bb.moving = false;

      // ★ 松手 → 必须**返回目标状态**才能真正退出。
      //
      //   踩过的坑：早期版本这里只写 `bb['enjoying'] = false; return null;`，
      //   以为改了标志位就算退出。实际上状态的切换只能通过 onUpdate 返回
      //   StateId 来触发 —— 于是狗永远留在 PetEnjoy 里闭着眼，
      //   表现为"松手后它还是一直闭眼"，像卡死一样。
      //
      //   顺带一个教训：这类 bug 在肉眼下很像"动画没播完"，
      //   只有把状态名打印出来才看得出是状态机没迁移。
      if (requiresPetting && bb['beingPetted'] !== true) {
        return exitTo;
      }

      // 享受太久也该起身活动（避免被无限按住而永不结束）
      if (bb.stateElapsedMs >= maxDurationMs) {
        return exitTo;
      }

      return null;
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Annoyed —— 烦躁
//
// 项目要求里的"连续点 → 觉得烦"。
// 一个短暂的情绪状态：可能会转头、可能起身。
// 具体表现由 moods.annoyance 决定。
// ─────────────────────────────────────────────────────────────

export interface AnnoyedOptions {
  readonly durationMs?: number;
}

export function createAnnoyedState(options: AnnoyedOptions = {}): State {
  const durationMs = options.durationMs ?? 1600;

  return {
    id: 'Annoyed',
    animationTag: 'Idle',

    onEnter(ctx) {
      const bb = ctx.blackboard;
      bb.speedPxPerSec = 0;
      bb.moving = false;
      bb['annoyedStartedAtMs'] = ctx.elapsedMs;
    },

    onUpdate(ctx) {
      const bb = ctx.blackboard;
      bb.moving = false;

      // 烦躁时**转头避开**玩家 —— 这是最直观的"不高兴"表达
      const p = playerPos(ctx);
      const awayFacing = (Math.atan2(bb.y - p.y, bb.x - p.x) * 180) / Math.PI;
      const maxTurn = ctx.species.locomotion.turnRateDeg * ctx.dtSec * 0.6;
      const delta = normalizeAngleDeg(awayFacing - bb.facingDeg);
      bb.facingDeg = normalizeAngleDeg(bb.facingDeg + clamp(delta, -maxTurn, maxTurn));

      if (ctx.elapsedMs - ((bb['annoyedStartedAtMs'] as number) ?? 0) >= durationMs) {
        return null;
      }
      return null;
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Retreat —— 走开
//
// 项目要求里的"走开（笑）"。
// 走到某个远离玩家的位置，然后进入"闹别扭"冷却。
// ─────────────────────────────────────────────────────────────

export interface RetreatOptions {
  /** 走离玩家多远（像素） */
  readonly distancePx?: number;
  /** 到达后停留多久（ms）—— 相当于"生闷气" */
  readonly sulkMs?: number;
}

export function createRetreatState(options: RetreatOptions = {}): State {
  const distancePx = options.distancePx ?? 90;
  const sulkMs = options.sulkMs ?? 3600;

  return {
    id: 'Retreat',
    animationTag: 'Walk',

    onEnter(ctx) {
      const bb = ctx.blackboard;
      const p = playerPos(ctx);

      // 选一个远离玩家的目标点
      const awayAngle = Math.atan2(bb.y - p.y, bb.x - p.x);
      // 加一点随机偏移，避免每次走的方向完全一样
      const jitter = ctx.rng.range(-0.6, 0.6);
      const angle = awayAngle + jitter;

      bb.wanderTargetX = bb.x + Math.cos(angle) * distancePx;
      bb.wanderTargetY = bb.y + Math.sin(angle) * distancePx;
      bb.hasWanderTarget = true;
      bb['retreatArrived'] = false;
      bb['retreatSulking'] = false;
      bb['retreatArrivedAtMs'] = null;
    },

    onExit(ctx) {
      const bb = ctx.blackboard;
      bb['retreatSulking'] = false;
      bb['retreatArrived'] = false;
    },

    onUpdate(ctx) {
      const bb = ctx.blackboard;

      // 到达后进入"生闷气"阶段
      if (bb['retreatSulking'] === true) {
        bb.moving = false;
        bb.speedPxPerSec = 0;
        const since = (bb['retreatArrivedAtMs'] as number | null) ?? ctx.elapsedMs;
        if (ctx.elapsedMs - since >= sulkMs) {
          bb['retreatSulking'] = false;
        }
        return null;
      }

      // 走开的过程中**不**看玩家 —— 这是"躲开"的表达
      const dx = bb.wanderTargetX - bb.x;
      const dy = bb.wanderTargetY - bb.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= ctx.species.locomotion.arriveThresholdPx) {
        bb['retreatArrived'] = true;
        bb['retreatSulking'] = true;
        bb['retreatArrivedAtMs'] = ctx.elapsedMs;
        bb.moving = false;
        bb.speedPxPerSec = 0;
        return null;
      }

      const desiredFacing = (Math.atan2(dy, dx) * 180) / Math.PI;
      const maxTurn = ctx.species.locomotion.turnRateDeg * ctx.dtSec;
      const delta = normalizeAngleDeg(desiredFacing - bb.facingDeg);
      bb.facingDeg = normalizeAngleDeg(bb.facingDeg + clamp(delta, -maxTurn, maxTurn));

      const speed = ctx.species.locomotion.walkSpeedPx * 1.15; // 走开时略快
      const next = vec2MoveTowards(
        { x: bb.x, y: bb.y },
        { x: bb.wanderTargetX, y: bb.wanderTargetY },
        speed * ctx.dtSec,
      );
      bb.x = next.x;
      bb.y = next.y;
      bb.speedPxPerSec = speed;
      bb.moving = true;

      return null;
    },
  };
}

/** Milestone 2 的互动状态集合 */
export function createInteractionStates(): readonly State[] {
  return [
    createLookAtState(),
    createApproachState(),
    createWagTailState(),
    createPetEnjoyState(),
    createAnnoyedState(),
    createRetreatState(),
  ];
}
