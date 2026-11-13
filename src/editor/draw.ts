// Drawing for the editor: the classic sets use Enigma's images (public/enigma, GPL), the game's own
// 3D styles (glas, neon, retro16) get a flat sketch in their colours, since the 3D view only shows
// floor, walls and Oxyd stones (src/render/view.ts); objects keep their Enigma image there.

import { isDeadly } from '../game/level';
import type { EdCell, EditorLevel } from './model';
import { BY_KIND, type PaletteEntry } from './palette';

export type EdStyle = 'klassisch' | 'klassisch-retro' | 'glas' | 'neon' | 'retro16';
export const ED_STYLES: [EdStyle, string][] = [
  ['klassisch', 'Klassisch'],
  ['klassisch-retro', 'Klassisch Retro'],
  ['glas', 'Glas'],
  ['neon', 'Neon'],
  ['retro16', 'Retro16'],
];

/** Same colour order as the game's Oxyd symbols (src/render/textures.ts). */
const SYMBOL_COLORS = ['#ff4d6d', '#ffd23f', '#3ddc97', '#4cc9f0', '#b388ff', '#ff9f1c', '#f15bb5', '#e0e0e0'];
export function symbolColor(symbol: string): string {
  if (symbol === '?') return '#9aa0ad';
  const n = symbol.charCodeAt(0) - 65;
  return SYMBOL_COLORS[(n + Math.floor(n / 8) * 3) % 8];
}

/** Flat colours of the 3D styles (src/render/themes.ts). */
const SKETCH: Record<string, { floor: string; floor2: string; wall: string; edge: string; abyss: string; water: string; ice: string }> = {
  glas: { floor: '#ddd6cc', floor2: '#cfc8be', wall: '#77736d', edge: '#9a958e', abyss: '#2a2d33', water: '#4f7fb8', ice: '#e6f2f8' },
  neon: { floor: '#12142c', floor2: '#181b3a', wall: '#10122a', edge: '#22e6ff', abyss: '#020208', water: '#0b2a55', ice: '#1c3550' },
  retro16: { floor: '#5a5a6e', floor2: '#4e4e60', wall: '#2c2c3a', edge: '#8a8aa0', abyss: '#0a0a12', water: '#2f4fa0', ice: '#a8d0e0' },
};

const isClassic = (s: EdStyle) => s === 'klassisch' || s === 'klassisch-retro';

// ---------- images ----------
const cache = new Map<string, Promise<HTMLImageElement | null>>();
const ready = new Map<string, HTMLImageElement>();

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}

const setOf = (s: EdStyle) => (s === 'klassisch-retro' ? 'gfx32-retro' : 'gfx32');

/** Loads the images of every palette entry for a style (the retro set falls back to the normal one). */
export async function loadImages(style: EdStyle): Promise<void> {
  const set = setOf(style);
  const names = new Set(PALETTE_IMAGES);
  await Promise.all(
    [...names].map((name) => {
      const key = `${set}/${name}`;
      let p = cache.get(key);
      if (!p) {
        const base = `${import.meta.env.BASE_URL}enigma/`;
        p = loadImage(`${base}${set}/${name}.png`)
          .catch(() => loadImage(`${base}gfx32/${name}.png`))
          .then((img) => (ready.set(key, img), img))
          .catch(() => null);
        cache.set(key, p);
      }
      return p;
    }),
  );
}

const PALETTE_IMAGES = ['st_oxyda', 'st_oxydb', 'st_oxydc', 'st_oxydd', 'ac_marble_black', ...new Set([...BY_KIND.values()].map((e) => e.image))];

function sprite(style: EdStyle, ctx: CanvasRenderingContext2D, name: string, frame: number, x: number, y: number, t: number): boolean {
  const img = ready.get(`${setOf(style)}/${name}`) ?? ready.get(`gfx32/${name}`);
  if (!img) return false;
  const tile = name.startsWith('ac_') ? img.width : 32;
  const vertical = img.height >= img.width;
  const sx = vertical ? 0 : frame * tile;
  const sy = vertical ? frame * tile : 0;
  // actors are 40 px sprites centred on the 32 px cell
  const size = (tile / 32) * t;
  const off = (t - size) / 2;
  ctx.drawImage(img, sx, sy, tile, tile, x + off, y + off, size, size);
  return true;
}

// ---------- the 3D styles as a sketch ----------
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function sketchFloor(style: EdStyle, ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, t: number, cx = 0, cy = 0): void {
  const k = SKETCH[style];
  if (kind === 'fl_abyss') ctx.fillStyle = k.abyss;
  else if (kind === 'fl_water' || kind === 'fl_swamp') ctx.fillStyle = k.water;
  else if (kind === 'fl_ice') ctx.fillStyle = k.ice;
  else if (kind === 'fl_gray') ctx.fillStyle = (cx + cy) % 2 ? k.floor2 : k.floor;
  else {
    // other floors: a tint of the style's floor so they stay apart in the sketch
    const hue = hash(kind) % 360;
    ctx.fillStyle = style === 'glas' ? `hsl(${hue} 22% 74%)` : style === 'neon' ? `hsl(${hue} 45% 18%)` : `hsl(${hue} 18% 40%)`;
  }
  ctx.fillRect(x, y, t, t);
  if (style === 'neon' && !isDeadly(kind)) {
    ctx.strokeStyle = 'rgba(34,230,255,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, t - 1, t - 1);
  }
}

function sketchWall(style: EdStyle, ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  const k = SKETCH[style];
  ctx.fillStyle = k.wall;
  ctx.fillRect(x, y, t, t);
  ctx.strokeStyle = k.edge;
  ctx.lineWidth = Math.max(1, t / 16);
  ctx.strokeRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, t - ctx.lineWidth, t - ctx.lineWidth);
}

function shape(ctx: CanvasRenderingContext2D, symbol: string, cx: number, cy: number, r: number): void {
  const n = symbol === '?' ? -1 : (symbol.charCodeAt(0) - 65) % 8;
  ctx.beginPath();
  if (n === 1) {
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy + r * 0.8);
    ctx.lineTo(cx - r, cy + r * 0.8);
  } else if (n === 2) ctx.rect(cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6);
  else if (n === 3) {
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
  } else ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
}

// ---------- cells ----------

/** Colour badge with the letter: shows which Oxyd stones form a pair (not by colour alone). */
function oxydBadge(ctx: CanvasRenderingContext2D, symbol: string, x: number, y: number, t: number): void {
  const r = Math.max(5, t * 0.22);
  const cx = x + t - r - 1;
  const cy = y + t - r - 1;
  ctx.fillStyle = symbolColor(symbol);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.stroke();
  ctx.fillStyle = '#111';
  ctx.font = `700 ${Math.round(r * 1.4)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(symbol, cx, cy + 0.5);
}

export function drawOxyd(style: EdStyle, ctx: CanvasRenderingContext2D, symbol: string, flavor: string, x: number, y: number, t: number): void {
  if (isClassic(style)) sprite(style, ctx, `st_oxyd${flavor}`, 0, x, y, t);
  else {
    sketchWall(style, ctx, x, y, t);
    ctx.fillStyle = symbolColor(symbol);
    shape(ctx, symbol, x + t / 2, y + t / 2, t * 0.28);
  }
  oxydBadge(ctx, symbol, x, y, t);
}

export function drawMarble(style: EdStyle, ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  if (isClassic(style) && sprite(style, ctx, 'ac_marble_black', 0, x, y, t)) return;
  const g = ctx.createRadialGradient(x + t * 0.4, y + t * 0.38, t * 0.04, x + t / 2, y + t / 2, t * 0.36);
  g.addColorStop(0, style === 'glas' ? '#e9f3ff' : '#c8d0e0');
  g.addColorStop(1, style === 'glas' ? '#1f6fd1' : style === 'neon' ? '#ff3bd4' : '#202030');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x + t / 2, y + t / 2, t * 0.34, 0, Math.PI * 2);
  ctx.fill();
}

/** One palette entry as a preview tile. */
export function drawEntry(style: EdStyle, ctx: CanvasRenderingContext2D, e: PaletteEntry, x: number, y: number, t: number, symbol = 'A', flavor = 'b'): void {
  if (e.layer === 'floor') return void (isClassic(style) ? sprite(style, ctx, e.image, 0, x, y, t) : sketchFloor(style, ctx, e.kind, x, y, t));
  if (e.layer === 'oxyd') return drawOxyd(style, ctx, symbol, flavor, x, y, t);
  if (e.layer === 'start') return drawMarble(style, ctx, x, y, t);
  if (e.wall && !isClassic(style)) return sketchWall(style, ctx, x, y, t);
  sprite(style, ctx, e.image, e.frame ?? 0, x, y, t);
}

export function drawCell(style: EdStyle, ctx: CanvasRenderingContext2D, c: EdCell, x: number, y: number, t: number, cx: number, cy: number): void {
  const floor = BY_KIND.get(c.f);
  if (isClassic(style)) {
    if (!floor || !sprite(style, ctx, floor.image, 0, x, y, t)) {
      ctx.fillStyle = '#444';
      ctx.fillRect(x, y, t, t);
    }
  } else sketchFloor(style, ctx, c.f, x, y, t, cx, cy);
  if (c.i) {
    const e = BY_KIND.get(c.i);
    if (e) drawEntry(style, ctx, e, x, y, t);
  }
  if (c.s === 'st_oxyd') drawOxyd(style, ctx, c.sa?.symbol ?? '?', c.sa?.flavor ?? 'b', x, y, t);
  else if (c.s) {
    const e = BY_KIND.get(c.s);
    if (e) drawEntry(style, ctx, e, x, y, t);
    else sketchWall(isClassic(style) ? 'retro16' : style, ctx, x, y, t);
  }
}

export interface Overlay {
  hover?: { x: number; y: number } | null;
  rect?: { x0: number; y0: number; x1: number; y1: number } | null;
  selected?: { x: number; y: number } | null;
  marked?: { x: number; y: number }[];
  /** Connection lines source → target (cells). */
  links?: { from: { x: number; y: number }; to: { x: number; y: number }; active: boolean }[];
  grid?: boolean;
}

export function drawLevel(style: EdStyle, ctx: CanvasRenderingContext2D, l: EditorLevel, t: number, o: Overlay = {}): void {
  ctx.imageSmoothingEnabled = t < 32 || t % 32 !== 0;
  for (let y = 0; y < l.height; y++) for (let x = 0; x < l.width; x++) drawCell(style, ctx, l.cells[y * l.width + x], x * t, y * t, t, x, y);
  for (const a of l.actors) {
    const e = BY_KIND.get(a.k);
    if (e) drawEntry(style, ctx, e, Math.floor(a.x) * t, Math.floor(a.y) * t, t);
  }
  if (l.start) drawMarble(style, ctx, l.start.x * t, l.start.y * t, t);

  if (o.grid) {
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < l.width; x++) ctx.moveTo(x * t + 0.5, 0), ctx.lineTo(x * t + 0.5, l.height * t);
    for (let y = 1; y < l.height; y++) ctx.moveTo(0, y * t + 0.5), ctx.lineTo(l.width * t, y * t + 0.5);
    ctx.stroke();
  }
  for (const k of o.links ?? []) {
    ctx.strokeStyle = k.active ? '#22e6ff' : 'rgba(34,230,255,0.55)';
    ctx.lineWidth = k.active ? 3 : 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo((k.from.x + 0.5) * t, (k.from.y + 0.5) * t);
    ctx.lineTo((k.to.x + 0.5) * t, (k.to.y + 0.5) * t);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc((k.to.x + 0.5) * t, (k.to.y + 0.5) * t, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const m of o.marked ?? []) {
    ctx.strokeStyle = '#ff4d6d';
    ctx.lineWidth = 3;
    ctx.strokeRect(m.x * t + 1.5, m.y * t + 1.5, t - 3, t - 3);
  }
  if (o.rect) {
    const x0 = Math.min(o.rect.x0, o.rect.x1);
    const y0 = Math.min(o.rect.y0, o.rect.y1);
    const w = Math.abs(o.rect.x1 - o.rect.x0) + 1;
    const h = Math.abs(o.rect.y1 - o.rect.y0) + 1;
    ctx.fillStyle = 'rgba(34,230,255,0.18)';
    ctx.fillRect(x0 * t, y0 * t, w * t, h * t);
    ctx.strokeStyle = '#22e6ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 * t + 1, y0 * t + 1, w * t - 2, h * t - 2);
  }
  if (o.selected) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(o.selected.x * t + 1, o.selected.y * t + 1, t - 2, t - 2);
  }
  if (o.hover && !o.rect) {
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(o.hover.x * t + 0.5, o.hover.y * t + 0.5, t - 1, t - 1);
  }
}
