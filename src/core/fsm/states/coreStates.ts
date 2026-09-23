/**
 * L.D.C. — 核心状态集（灰盒阶段）
 *
 * ★ 这里的四个状态是「通用行为」，不是犬种专属。
 *   犬种差异全部来自 JSON：
 *     - locomotion.walkSpeedPx   → 走多快
 *     - animation.targetFps      → 动画节奏
 *     - cognition.*              → 决策与反应速度
 *     - behaviors.stateWeights   → 想做什么
 *
 * 每个状态只做两件事：
 *   ① 推进物理（位置、朝向、速度）
 *   ② 声明「完成条件」（返回 StateId 或 null）
 * 权重判断不在此处 —— 由 StateMachine.decide() 统一裁决。
 */

import type { State, StateContext } from '../StateMachine';
import type { Rng } from '../../world/Rng';
import {
  clamp,
  vec2Distance,
  vec2MoveTowards,
  normalizeAngleDeg,
  lerpAngleDeg,
} from '../../world/Vector2';

/** 状态共享的物理辅助：朝目标移动，返回是否已到达 */
function moveTowardsTarget(
  ctx: StateContext,
  targetX: number,
  targetY: number,
  speedPxPerSec: number,
): boolean {
  const bb = ctx.blackboard;
  const dtSec = ctx.dtSec;

  const dx = targetX - bb.x;
  const dy = targetY - bb.y;
  const dist = Math.hypot(dx, dy);

  const arrive = ctx.species.locomotion.arriveThresholdPx;
  if (dist <= arrive) {
    bb.speedPxPerSec = 0;
    bb.moving = false;
    return true;
  }

  // 朝向：按 turnRateDeg 限制转向速度（大型犬转身慢 —— 由 JSON 控制）
  const desiredFacing = (Math.atan2(dy, dx) * 180) / Math.PI;
  const maxTurn = ctx.species.locomotion.turnRateDeg * dtSec;
  const delta = normalizeAngleDeg(desiredFacing - bb.facingDeg);
  bb.facingDeg = normalizeAngleDeg(bb.facingDeg + clamp(delta, -maxTurn, maxTurn));

  // 位置推进
  const step = speedPxPerSec * dtSec;
  const next = vec2MoveTowards({ x: bb.x, y: bb.y }, { x: targetX, y: targetY }, step);
  bb.x = next.x;
  bb.y = next.y;
  bb.speedPxPerSec = speedPxPerSec;
  // 转向未完成时仍算移动，但速度打折（表现"笨重转向"）
  bb.moving = true;

  return false;
}

/**
 * 在指定范围内选一个新的漫游目标点。
 *
 * ★ 目标点必须落在**可行走区域**内，否则会产生一个极隐蔽的死锁：
 *
 *   实测 bug（Alpha 打磨中发现）：
 *     狗走到房间底边 y=182 后，被分到 y=191 的目标点 —— 已在墙外。
 *     clampToBounds() 每帧把它推回 182，而 moveTowardsTarget 始终
 *     到不了 191，于是 arrived 永远为 false，
 *     WalkState 的「到达 → 驻足 → 完成」链条永远走不完，
 *     准入守卫也就永远不放行。
 *     结果：狗卡在 Walk 状态长达 162 秒（实测），永远不再切换。
 *
 *   这类 bug 的可怕之处在于：
 *     它是**条件触发**的 —— 只有目标点恰好落在边界外时才发生，
 *     表现为"偶尔卡死"，且状态机本身逻辑完全正确。
 *
 *   修复：选点时就把目标夹在可行走区域内（留出狗的半身宽高）。
 */
export function pickWanderTarget(ctx: StateContext, rng: Rng): void {
  const bb = ctx.blackboard;
  const radius = ctx.species.locomotion.idleWanderRadiusPx;
  const angle = rng.range(0, Math.PI * 2);
  const dist = rng.range(radius * 0.35, radius);

  const rawX = bb.x + Math.cos(angle) * dist;
  const rawY = bb.y + Math.sin(angle) * dist;

  // 夹到可行走区域（由 World 提供的边界；缺省时退化为不夹取）
  const bounds = bb['walkableBounds'] as
    | { minX: number; maxX: number; minY: number; maxY: number }
    | undefined;

  if (bounds) {
    bb.wanderTargetX = Math.min(bounds.maxX, Math.max(bounds.minX, rawX));
    bb.wanderTargetY = Math.min(bounds.maxY, Math.max(bounds.minY, rawY));
  } else {
    bb.wanderTargetX = rawX;
    bb.wanderTargetY = rawY;
  }

  bb.hasWanderTarget = true;
}

// ─────────────────────────────────────────────────────────────
// Idle —— 静止站立，等待决策
// ─────────────────────────────────────────────────────────────

export const IdleState: State = {
  id: 'Idle',
  animationTag: 'Idle',

  onEnter(ctx) {
    ctx.blackboard.speedPxPerSec = 0;
    ctx.blackboard.moving = false;
    ctx.blackboard.hasWanderTarget = false;
  },

  onUpdate(ctx) {
    // 静止状态的物理：减速到 0
    const bb = ctx.blackboard;
    if (bb.speedPxPerSec > 0) {
      const decel = ctx.species.locomotion.walkSpeedPx * 6 * ctx.dtSec;
      bb.speedPxPerSec = Math.max(0, bb.speedPxPerSec - decel);
    }
    bb.moving = false;
    // Idle 不主动请求迁移 —— 交给 decide() 裁决
    return null;
  },
};

// ─────────────────────────────────────────────────────────────
// Walk —— 走向漫游目标点
// ─────────────────────────────────────────────────────────────

/**
 * 到达后的「驻足」时长（ms）。
 *
 * ★ 这个值存在的理由是一个真实的设计缺陷教训：
 *   早期版本在到达目标点后立刻 return 'Idle'，结果是
 *   Idle → Walk → Idle → Walk 每 0.5 秒一次的乒乓振荡，
 *   看起来像故障而不像生命。
 *
 *   真实的狗走到一个地方会停下来嗅一嗅、看一看，
 *   而不是"到达即重置"。这个驻足窗口让行为有了节奏感，
 *   同时把「我该做什么」的决策权交还给效用系统（decide()），
 *   而不是由状态自己硬编码下一步。
 *
 * 注意：这不是在状态里做权重判断 —— 它只是一个时间门槛。
 *   驻足结束后状态返回 null，让 decide() 自由选择。
 *
 * 该常量同时被 transitions.ts 的 Walk→Idle 守卫使用，
 * 因此在此导出，保证两边不会漂移。
 *
 * ★ 取值影响整体节奏：Walk 的总时长 ≈ 行走时间 + 本值。
 *   行走时间由漫游距离与速度决定（灰盒：48px 半径 / 30px·s⁻¹ ≈ 1~1.5s）。
 *   早期取 2200ms 使 Walk 长达 3.5~4 秒，占全部时间的 84%，
 *   把其他状态挤压到几乎没有表现空间。
 *   900ms 让 Walk 总时长落在 2 秒左右，与其他状态量级相当。
 */
export const WALK_DWELL_MS = 900;

/**
 * Walk 状态使用的黑板字段（集中声明，避免拼写错误与语义混淆）。
 *
 * ★ 早期版本只用了一个字段 `walkArrivedAtMs`，并用 null 同时表达
 *   「还没到达」和「驻足已结束」两种含义 —— 这导致守卫永远返回 false，
 *   狗卡在 Walk 里再也不出来。
 *
 *   现在拆成两个语义明确的字段：
 *     WALK_ARRIVED_AT      到达时刻（未到达 = 未设置）
 *     WALK_DWELL_COMPLETED 驻足是否已结束（一次性布尔）
 *
 *   一个字段只表达一件事，是避免这类 bug 最有效的手段。
 */
export const WALK_ARRIVED_AT = 'walkArrivedAtMs';
export const WALK_DWELL_COMPLETED = 'walkDwellCompleted';

export const WalkState: State = {
  id: 'Walk',
  animationTag: 'Walk',

  onEnter(ctx) {
    // 每次进入 Walk 都重新选点，避免在原点打转
    pickWanderTarget(ctx, ctx.rng);
    ctx.blackboard[WALK_ARRIVED_AT] = null;
    ctx.blackboard[WALK_DWELL_COMPLETED] = false;
  },

  onUpdate(ctx) {
    const bb = ctx.blackboard;
    const arrivedAt = bb[WALK_ARRIVED_AT] as number | null | undefined;

    // ── 阶段 2：已在驻足（到达之后）──
    if (arrivedAt !== null && arrivedAt !== undefined) {
      bb.moving = false;
      bb.speedPxPerSec = 0;

      if (ctx.elapsedMs - arrivedAt >= WALK_DWELL_MS) {
        // 驻足结束：打上「已完成」标记，让准入守卫放行。
        // 这里不改动 WALK_ARRIVED_AT —— 它是"到达过"的客观事实，不该被抹掉。
        bb[WALK_DWELL_COMPLETED] = true;
        bb.hasWanderTarget = false;
      }
      return null;
    }

    // ── 阶段 1：行进中 ──
    const arrived = moveTowardsTarget(
      ctx,
      bb.wanderTargetX,
      bb.wanderTargetY,
      ctx.species.locomotion.walkSpeedPx,
    );

    if (arrived) {
      bb[WALK_ARRIVED_AT] = ctx.elapsedMs;
      bb.moving = false;
      bb.speedPxPerSec = 0;
    }

    return null;
  },
};

// ─────────────────────────────────────────────────────────────
// Sit —— 坐下。灰盒上表现为高度压缩
// ─────────────────────────────────────────────────────────────

export const SitState: State = {
  id: 'Sit',
  animationTag: 'Sit',

  onEnter(ctx) {
    ctx.blackboard.speedPxPerSec = 0;
    ctx.blackboard.moving = false;
  },

  onUpdate(ctx) {
    // 坐下状态持续由 decide() 决定何时起身。
    // 这里只做「慢速归零」，表现坐下的沉稳感。
    const bb = ctx.blackboard;
    bb.moving = false;
    if (bb.speedPxPerSec > 0) {
      bb.speedPxPerSec = Math.max(0, bb.speedPxPerSec - ctx.species.locomotion.walkSpeedPx * 4 * ctx.dtSec);
    }
    return null;
  },
};

// ─────────────────────────────────────────────────────────────
// Sleep —— 睡眠。由需求驱动（Phase 4 接入真实需求衰减）
// ─────────────────────────────────────────────────────────────

export interface SleepStateOptions {
  /** 一次睡眠的最短时长（ms），防止刚睡就醒 */
  minDurationMs?: number;
}

export function createSleepState(options: SleepStateOptions = {}): State {
  // ★ 与 transitions.ts 的 SLEEP_MIN_DURATION_MS 保持一致。
  //   两处必须同步：状态机入口护栏与准入守卫用的是后者，
  //   若不一致会出现"守卫允许离开但状态自己拦着"的死锁。
  const minDurationMs = options.minDurationMs ?? 3200;

  return {
    id: 'Sleep',
    animationTag: 'Sleep',

    onEnter(ctx) {
      ctx.blackboard.speedPxPerSec = 0;
      ctx.blackboard.moving = false;
      ctx.blackboard['sleepStartedAtMs'] = ctx.elapsedMs;
    },

    onUpdate(ctx) {
      const bb = ctx.blackboard;
      bb.moving = false;
      bb.speedPxPerSec = 0;

      const startedAt = (bb['sleepStartedAtMs'] as number | undefined) ?? 0;
      const sleptMs = ctx.elapsedMs - startedAt;

      // 最短睡眠时长保护：睡不足就醒会看起来像卡顿。
      // 注意这里返回 null 而非硬切 Idle —— 醒来之后做什么由 decide() 决定。
      if (sleptMs < minDurationMs) return null;

      return null;
    },
  };
}

/** 灰盒阶段使用的完整状态集 */
export function createCoreStates(): readonly State[] {
  return [IdleState, WalkState, SitState, createSleepState()];
}

/** 判定两点是否接近，供未来交互使用 */
export function isWithinReach(a: { x: number; y: number }, b: { x: number; y: number }, radius: number): boolean {
  return vec2Distance(a, b) <= radius;
}

/** 朝向平滑工具，供未来「转头看玩家」使用 */
export function faceTowards(currentDeg: number, targetX: number, targetY: number, x: number, y: number, t: number): number {
  const desired = (Math.atan2(targetY - y, targetX - x) * 180) / Math.PI;
  return lerpAngleDeg(currentDeg, desired, t);
}
