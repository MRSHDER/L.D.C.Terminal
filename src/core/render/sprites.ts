import { ITEM_SPRITES } from './spriteItems';

export {
  DOG_SPRITE_W,
  DOG_SPRITE_H,
  DOG_SPRITE_PALETTE,
  DOG_SPRITE_PIXELS,
} from './spriteDog';

export const SPRITES = {
  ...ITEM_SPRITES,
} as const;

export type SpriteId = keyof typeof SPRITES;
