/**
 * L.D.C. — 事件契约（单一真相源）
 *
 * 设计原则：
 *  - Event 只描述「已经发生了什么」，绝不携带「接下来该做什么」。
 *    所有决策仍在 StateMachine / BehaviorResolver 内完成，防止逻辑散落。
 *  - 需要「持续存在的量」（trust、hunger）时用 State，不要用 Event。
 *  - 每个事件都必须可被 Journal 序列化（payload 保持纯数据）。
 */

import type { Vector2 } from '../world/Vector2';

export type StateId = string;
export type IntentKind =
  | 'PET'
  | 'CALL'
  | 'FEED_HAND'
  | 'FEED_GROUND'
  | 'FEED_BOWL'
  | 'THROW_BALL'
  | 'DRAG_TOY';

/** 拒绝原因。用于交互反馈与调试，不用文案硬编码 */
export type RefusalReason =
  | 'asleep'
  | 'notNoticing'
  | 'cooldown'
  | 'lowTrust'
  | 'choseOtherwise'
  | 'unreachable';

/** 档案条目类型 —— 项目名里 "DATABASE" 的落地处 */
export type JournalKind =
  | 'sessionStart'
  | 'sessionEnd'
  | 'firstMeeting'
  | 'stateEntered'
  | 'decisionMade'
  | 'interactionAccepted'
  | 'interactionRefused'
  | 'microBehavior'
  | 'moodThreshold'
  | 'debugNote';

/**
 * 事件表。
 * ★ 新增事件 = 在此加一行 + 在 emit 处类型自动校验，无需改动 EventBus。
 */
export interface LdcEvents {
  // ── 生命周期 ──
  'app:ready': { readonly at: number };
  'app:paused': { readonly at: number };
  'app:resumed': { readonly at: number };

  // ── 世界 / 循环 ──
  'world:tick': {
    readonly tick: number;
    readonly dtMs: number;
    readonly elapsedMs: number;
  };
  'world:fpsSampled': { readonly fps: number; readonly frameMs: number };

  // ── 状态机 ──
  'state:enter': {
    readonly from: StateId | null;
    readonly to: StateId;
    readonly reason: string;
  };
  'state:exit': { readonly from: StateId; readonly to: StateId };
  /** 每次重新决策时发出，携带完整打分表 —— 这是调试"为什么它这样动"的关键 */
  'state:decision': {
    readonly chosen: StateId;
    readonly scores: Readonly<Record<StateId, number>>;
    readonly tick: number;
  };

  // ── 数据 ──
  'species:loading': { readonly id: string };
  'species:loaded': { readonly id: string; readonly catalogNo: string };
  'species:failed': { readonly id: string; readonly error: string };
  /** 运行时热重载（开发期改 JSON 立即生效） */
  'species:reloaded': { readonly id: string };

  // ── 动画 ──
  'anim:clipStart': { readonly clipId: string };
  'anim:clipEnd': { readonly clipId: string };
  'anim:frameChanged': { readonly clipId: string; readonly frame: number };

  // ── 交互（Phase 3 起启用，Phase 0/1 仅保留契约） ──
  'interaction:intent': { readonly intent: IntentKind; readonly at: Vector2 };
  'interaction:accepted': { readonly intent: IntentKind };
  'interaction:refused': { readonly intent: IntentKind; readonly reason: RefusalReason };

  // ── 档案 ──
  'journal:entry': {
    readonly kind: JournalKind;
    readonly at: number;
    readonly payload: Readonly<Record<string, unknown>>;
  };
}

export type LdcEventKey = keyof LdcEvents;
export type LdcEventHandler<K extends LdcEventKey> = (payload: LdcEvents[K]) => void;
