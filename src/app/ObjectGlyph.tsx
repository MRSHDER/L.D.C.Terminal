import { SPRITES, type SpriteId } from '@core/render/sprites';

export function ObjectGlyph({ id }: { readonly id: string }) {
  const key = (id in SPRITES ? id : 'ball') as SpriteId;
  return <img className="ldc-glyph" src={SPRITES[key]} alt="" draggable={false} />;
}
