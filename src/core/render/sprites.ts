import { DOG_SPRITE } from './spriteDog';
import { ITEM_SPRITES } from './spriteItems';

export const SPRITES = {
  dog: DOG_SPRITE,
  ...ITEM_SPRITES,
} as const;

export type SpriteId = keyof typeof SPRITES;
