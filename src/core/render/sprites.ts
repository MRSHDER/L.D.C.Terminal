export {
  DOG_SPRITE_W,
  DOG_SPRITE_H,
  DOG_SPRITE_PALETTE,
  DOG_SPRITE_PIXELS,
} from './spriteDog';

type PixelSprite = {
  readonly w: number;
  readonly h: number;
  readonly palette: Readonly<Record<string, string>>;
  readonly rows: readonly string[];
};

function spriteDataUri(sprite: PixelSprite): string {
  const rects: string[] = [];
  for (let y = 0; y < sprite.rows.length; y++) {
    const row = sprite.rows[y] ?? '';
    for (let x = 0; x < row.length; x++) {
      const color = sprite.palette[row[x] ?? '.'];
      if (!color) continue;
      rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sprite.w} ${sprite.h}" shape-rendering="crispEdges">${rects.join('')}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const MEAT: PixelSprite = {
  w: 16,
  h: 12,
  palette: {
    k: '#241412',
    r: '#b9332b',
    d: '#7f211f',
    h: '#f28b73',
    b: '#f2ead8',
    s: '#c9bda4',
  },
  rows: [
    '................',
    '..bb.kkkkkk.bb..',
    '.bbbrrrrrrrrbbb.',
    '..brrrddddrrrb..',
    '..krrhhhhhhrrk..',
    '..krrhrrrrhrrk..',
    '..krrhhhhhhrrk..',
    '..krrrddddrrrk..',
    '..bddrrrrrrddb..',
    '.bbbrrrrrrrrbbb.',
    '..bb.kkkkkk.bb..',
    '................',
  ],
};

const WATER: PixelSprite = {
  w: 16,
  h: 12,
  palette: {
    k: '#172333',
    b: '#2f7fc4',
    d: '#1d4f7f',
    h: '#8fd8ff',
    s: '#7a8793',
    p: '#d9e8ef',
  },
  rows: [
    '................',
    '......hh........',
    '....hh..hh......',
    '...kkkkkkkkk....',
    '..kbbbbbbbbbk...',
    '..kbbhhhbbbbk...',
    '..kbbbhhbbddk...',
    '..kdddddddddk...',
    '.sskkkkkkkkkss..',
    '..sssssssssss...',
    '................',
    '................',
  ],
};

const BALL: PixelSprite = {
  w: 14,
  h: 14,
  palette: {
    k: '#1b3214',
    g: '#6fd24a',
    d: '#3f8f2c',
    h: '#c8ff92',
    w: '#efffd8',
  },
  rows: [
    '....kkkkkk....',
    '..kkggggggkk..',
    '.kggghhggggk.',
    '.kgghwwhgggk.',
    'kggghwwhgggk',
    'kgghhwwhhggk',
    'kggggwwggggk',
    'kggggwwggggk',
    'kgghhwwhhggk',
    'kggghwwhgggk',
    '.kgghwwhgggk.',
    '.kggghhggggk.',
    '..kkggggggkk..',
    '....kkkkkk....',
  ],
};

const BOWL: PixelSprite = {
  w: 18,
  h: 12,
  palette: {
    k: '#2b1b12',
    c: '#c99b63',
    d: '#7a431f',
    h: '#f4dfb6',
    s: '#e2d3b0',
  },
  rows: [
    '..................',
    '....hhhhhhhhhh....',
    '..sskkkkkkkkkkss..',
    '.sskcddddddddckss.',
    '.skcddddddddddcks.',
    '.skcddhhhhdddc k.'.replace(/ /g, ''),
    '.skcddddddddddcks.',
    '..skccccccccccks..',
    '...skkkkkkkkkks...',
    '....ssssssssss....',
    '..................',
    '..................',
  ],
};

export const SPRITES = {
  meat: spriteDataUri(MEAT),
  water: spriteDataUri(WATER),
  ball: spriteDataUri(BALL),
  bowl: spriteDataUri(BOWL),
} as const;

export type SpriteId = keyof typeof SPRITES;
