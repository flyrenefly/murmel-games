import * as THREE from 'three';
import type { StoneFace } from './textures';

// Own 16-bit style pixel art, drawn pixel by pixel at runtime.
// Palette in the spirit of the Atari ST (3 bits per channel: 00 24 49 6d 92 b6 db ff).

export const TILE_PX = 16;

const C = {
  void: '#000024',
  floorA: '#92926d',
  floorB: '#b6b692',
  floorDot: '#6d6d49',
  wallTop: '#6d6d92',
  wallLight: '#b6b6db',
  wallDark: '#242449',
  wallMid: '#494992',
  stone: '#244992',
  stoneLight: '#4992db',
  stoneDark: '#002449',
  inset: '#000024',
  mark: '#6d92db',
  gold: '#dbb624',
  black: '#000000',
  m1: '#242424',
  m2: '#494949',
  m3: '#929292',
  white: '#ffffff',
};

const SYMBOL_COLORS = ['#ff2424', '#ffdb00', '#24db49', '#24b6ff', '#b649ff', '#ff9200', '#ff49b6', '#ffffff'];

// 9×9 symbols ('#' = pixel set).
const SYMBOLS: string[][] = [
  ['...###...', '.#######.', '.#######.', '#########', '#########', '#########', '.#######.', '.#######.', '...###...'],
  ['....#....', '...###...', '...###...', '..#####..', '..#####..', '.#######.', '.#######.', '#########', '#########'],
  ['#########', '#########', '##.....##', '##.....##', '##.....##', '##.....##', '##.....##', '#########', '#########'],
  ['....#....', '...###...', '..#####..', '.#######.', '#########', '.#######.', '..#####..', '...###...', '....#....'],
  ['....#....', '....#....', '...###...', '#########', '.#######.', '..#####..', '..##.##..', '.##...##.', '#.......#'],
  ['...###...', '...###...', '...###...', '#########', '#########', '#########', '...###...', '...###...', '...###...'],
  ['..#####..', '.##...##.', '##.....##', '#.......#', '#.......#', '#.......#', '##.....##', '.##...##.', '..#####..'],
  ['..#####..', '.#######.', '#########', '###...###', '###...###', '###...###', '#########', '.#######.', '..#####..'],
];

function grid(size = TILE_PX): [HTMLCanvasElement, (x: number, y: number, c: string, w?: number, h?: number) => void] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  return [c, (x, y, col, w = 1, h = 1) => {
    g.fillStyle = col;
    g.fillRect(x, y, w, h);
  }];
}

function tex(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

export const PIXEL_VOID = C.void;

export function pixelFloor(): THREE.CanvasTexture {
  const [c, px] = grid();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, (x + y) % 2 ? C.floorA : C.floorB);
  px(0, 0, C.floorDot, 16, 1);
  px(0, 0, C.floorDot, 1, 16);
  px(7, 7, C.floorDot, 2, 2);
  return tex(c);
}

export function pixelWall(): THREE.CanvasTexture {
  const [c, px] = grid();
  px(0, 0, C.wallTop, 16, 16);
  px(0, 0, C.wallLight, 16, 2);
  px(0, 0, C.wallLight, 2, 16);
  px(0, 14, C.wallDark, 16, 2);
  px(14, 0, C.wallDark, 2, 16);
  px(4, 4, C.wallMid, 8, 8);
  px(5, 5, C.wallTop, 6, 6);
  return tex(c);
}

const faceCache = new Map<string, THREE.CanvasTexture>();

export function pixelStone(symbol: string, state: StoneFace): THREE.CanvasTexture {
  const key = `${symbol}|${state}`;
  const hit = faceCache.get(key);
  if (hit) return hit;
  const [c, px] = grid();
  px(0, 0, C.stone, 16, 16);
  px(0, 0, C.stoneLight, 16, 2);
  px(0, 0, C.stoneLight, 2, 16);
  px(0, 14, C.stoneDark, 16, 2);
  px(14, 0, C.stoneDark, 2, 16);
  if (state === 'solved') {
    px(1, 1, C.gold, 14, 1);
    px(1, 14, C.gold, 14, 1);
    px(1, 1, C.gold, 1, 14);
    px(14, 1, C.gold, 1, 14);
  }
  if (state === 'closed') {
    px(6, 6, C.stoneDark, 4, 4);
    px(7, 7, C.mark, 2, 2);
  } else {
    px(2, 2, C.inset, 12, 12);
    const n = symbol.charCodeAt(0) - 65;
    const bmp = SYMBOLS[n % SYMBOLS.length];
    const col = SYMBOL_COLORS[(n + Math.floor(n / SYMBOLS.length) * 3) % SYMBOL_COLORS.length];
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) if (bmp[y][x] === '#') px(3 + x + 1, 3 + y + 1, C.black);
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) if (bmp[y][x] === '#') px(3 + x, 3 + y, col);
  }
  const t = tex(c);
  faceCache.set(key, t);
  return t;
}

/** Marble sprite, 10 px across (radius 0.3 tile ≈ 9.6 px). */
export function pixelMarble(): THREE.CanvasTexture {
  const rows = [
    '...####...',
    '.##2222##.',
    '.#233322#.',
    '#2334W322#',
    '#233WW322#',
    '#2233322.#',
    '#1222222.#',
    '.#11222..#',
    '.##1111##.',
    '...####...',
  ];
  const map: Record<string, string> = { '#': C.black, '1': C.m1, '2': C.m2, '3': C.m3, '4': '#b6b6b6', W: C.white, '.': C.m1 };
  const [c, px] = grid(10);
  rows.forEach((r, y) => [...r].forEach((ch, x) => px(x, y, map[ch])));
  // Corners transparent.
  const g = c.getContext('2d')!;
  for (const [x, y] of [[0, 0], [1, 0], [2, 0], [7, 0], [8, 0], [9, 0], [0, 1], [9, 1], [0, 2], [9, 2], [0, 7], [9, 7], [0, 8], [9, 8], [0, 9], [1, 9], [2, 9], [7, 9], [8, 9], [9, 9]]) g.clearRect(x, y, 1, 1);
  return tex(c);
}

/** Dithered drop shadow. */
export function pixelShadow(): THREE.CanvasTexture {
  const [c, px] = grid(10);
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 10; x++) {
      const d = Math.hypot(x - 4.5, y - 4.5);
      if (d < 4.6 && (x + y) % 2 === 0) px(x, y, C.black);
    }
  return tex(c);
}
