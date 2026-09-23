/**
 * L.D.C. — 物体交互语义（Milestone 3 foundation）
 *
 * 本文件只做一件事：把「玩家把什么东西放到哪里」翻译成 intent。
 * 它不决定狗怎么回应，也不包含任何犬种分支。
 *
 * 设计原则：
 *   object data → drop target → intent
 *   后续狗的反应仍由 personality / mood / needs / bond / memory 决定。
 */

import type { IntentKind } from '../event/events';

export type InteractionObjectKind = 'food' | 'drink' | 'toy' | 'container';
export type DropTargetKind = 'mouth' | 'ground' | 'bowl' | 'room';

export interface InteractionObjectDefinition {
  readonly id: string;
  readonly kind: InteractionObjectKind;
  readonly label: string;
  readonly color: number;
  readonly home: { readonly x: number; readonly y: number };
  readonly size: { readonly w: number; readonly h: number };
}

export interface InteractionObjectState extends InteractionObjectDefinition {
  readonly x: number;
  readonly y: number;
  readonly dragging: boolean;
}

export interface DropZone {
  readonly kind: DropTargetKind;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface DropIntentResult {
  readonly objectId: string;
  readonly objectKind: InteractionObjectKind;
  readonly target: DropTargetKind;
  readonly intent: IntentKind;
  readonly at: { readonly x: number; readonly y: number };
}

/**
 * M3 第一批物体。这里是通用交互物，不是犬种专属数据。
 * 后续如果要让不同狗拥有不同玩具/食物偏好，应把偏好放进 species.preferences，
 * 而不是在这里写 if dog == ...。
 */
export const DEFAULT_INTERACTION_OBJECTS: readonly InteractionObjectDefinition[] = [
  {
    id: 'meat',
    kind: 'food',
    label: 'MEAT',
    color: 0xc43a32,
    home: { x: 36, y: 172 },
    size: { w: 18, h: 12 },
  },
  {
    id: 'water',
    kind: 'drink',
    label: 'WATER',
    color: 0x3e8ad0,
    home: { x: 62, y: 172 },
    size: { w: 20, h: 12 },
  },
  {
    id: 'ball',
    kind: 'toy',
    label: 'BALL',
    color: 0x7fd85a,
    home: { x: 90, y: 172 },
    size: { w: 14, h: 14 },
  },
  {
    id: 'bowl',
    kind: 'container',
    label: 'BOWL',
    color: 0xd8c8a8,
    home: { x: 274, y: 172 },
    size: { w: 22, h: 12 },
  },
];

export function createInteractionObjects(): readonly InteractionObjectState[] {
  return DEFAULT_INTERACTION_OBJECTS.map((obj) => ({
    ...obj,
    x: obj.home.x,
    y: obj.home.y,
    dragging: false,
  }));
}

export function hitObject(
  objects: readonly InteractionObjectState[],
  x: number,
  y: number,
): InteractionObjectState | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (!obj) continue;
    if (
      x >= obj.x - obj.size.w / 2 &&
      x <= obj.x + obj.size.w / 2 &&
      y >= obj.y - obj.size.h / 2 &&
      y <= obj.y + obj.size.h / 2
    ) {
      return obj;
    }
  }
  return null;
}

export function resolveDropTarget(
  point: { readonly x: number; readonly y: number },
  zones: readonly DropZone[],
): DropTargetKind {
  for (const zone of zones) {
    if (
      point.x >= zone.x &&
      point.x <= zone.x + zone.w &&
      point.y >= zone.y &&
      point.y <= zone.y + zone.h
    ) {
      return zone.kind;
    }
  }
  return 'room';
}

export function intentForDrop(
  object: InteractionObjectState,
  target: DropTargetKind,
  at: { readonly x: number; readonly y: number },
): DropIntentResult {
  return {
    objectId: object.id,
    objectKind: object.kind,
    target,
    intent: mapIntent(object.kind, target),
    at,
  };
}

function mapIntent(kind: InteractionObjectKind, target: DropTargetKind): IntentKind {
  if (kind === 'food' || kind === 'drink') {
    if (target === 'mouth') return 'FEED_HAND';
    if (target === 'bowl') return 'FEED_BOWL';
    return 'FEED_GROUND';
  }

  if (kind === 'toy') {
    if (target === 'ground' || target === 'room') return 'THROW_BALL';
    return 'DRAG_TOY';
  }

  return 'DRAG_TOY';
}
