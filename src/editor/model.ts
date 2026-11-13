// The editor's level model: a grid of cells with floor, stone and item, plus actors and the start.
// It converts to and from the game's LevelFile (src/game/level.ts), which stays unchanged.

import type { ActorDef } from '../game/actors';
import { type CellDef, DEFAULT_LEGEND, type LevelFile } from '../game/level';
import type { ObjectDef } from '../game/objects';
import { BY_KIND, OXYD_COLORS, type PaletteEntry } from './palette';

export interface EdCell {
  /** Floor kind. */
  f: string;
  /** Stone kind: a wall, an object stone or 'st_oxyd'. */
  s?: string;
  /** Stone attributes (Oxyd: symbol and flavor; object stones: name, target, action …). */
  sa?: Record<string, string>;
  /** Item kind (it_*). */
  i?: string;
  ia?: Record<string, string>;
}

export interface EditorLevel {
  title: string;
  author: string;
  width: number;
  height: number;
  /** Row by row, width × height. */
  cells: EdCell[];
  actors: ActorDef[];
  /** Start cell of the marble, or null. */
  start: { x: number; y: number } | null;
}

export const MIN_W = 5;
export const MAX_W = 60;
export const MIN_H = 5;
export const MAX_H = 40;
export const DEFAULT_FLOOR = 'fl_gray';
export const DEFAULT_WALL = 'st_granite';
/** Licence of player levels (user decision 13.11.2026), SPDX id; `spielerlevels` takes it over. */
export const LICENSE = 'CC-BY-SA-4.0';
export const LICENSE_NOTE = 'Geteilte und exportierte Levels sind öffentlich und stehen unter der Lizenz CC BY-SA 4.0: Andere dürfen sie spielen, verändern und weitergeben, mit Nennung des Autors und unter derselben Lizenz.';

/** A new level: walls around, grey floor, the marble in the middle and one Oxyd pair. */
export function newLevel(width = 20, height = 13): EditorLevel {
  const cells: EdCell[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) cells.push(x === 0 || y === 0 || x === width - 1 || y === height - 1 ? { f: DEFAULT_FLOOR, s: DEFAULT_WALL } : { f: DEFAULT_FLOOR });
  const lvl: EditorLevel = { title: '', author: '', width, height, cells, actors: [], start: { x: Math.floor(width / 2), y: Math.floor(height / 2) } };
  if (width >= 5 && height >= 5) {
    setOxyd(lvl, 2, 2, 'A', 'b');
    setOxyd(lvl, width - 3, height - 3, 'A', 'b');
  }
  return lvl;
}

export const cellOf = (l: EditorLevel, x: number, y: number): EdCell | null => (x < 0 || y < 0 || x >= l.width || y >= l.height ? null : l.cells[y * l.width + x]);

export function clone(l: EditorLevel): EditorLevel {
  return JSON.parse(JSON.stringify(l)) as EditorLevel;
}

function setOxyd(l: EditorLevel, x: number, y: number, symbol: string, flavor: string): void {
  const c = cellOf(l, x, y);
  if (!c) return;
  c.s = 'st_oxyd';
  c.sa = { symbol, flavor };
}

/** Resizes, keeping the content at the top left; new cells get the default floor. */
export function resize(l: EditorLevel, width: number, height: number): EditorLevel {
  width = Math.min(MAX_W, Math.max(MIN_W, Math.round(width)));
  height = Math.min(MAX_H, Math.max(MIN_H, Math.round(height)));
  const cells: EdCell[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cells.push(cellOf(l, x, y) ?? { f: DEFAULT_FLOOR });
  const inside = (p: { x: number; y: number }) => p.x < width && p.y < height;
  return {
    ...l,
    width,
    height,
    cells,
    actors: l.actors.filter((a) => inside({ x: Math.floor(a.x), y: Math.floor(a.y) })),
    start: l.start && inside(l.start) ? l.start : null,
  };
}

/** Oxyd colour the next stone should get: one still missing a partner, else an unused one. */
export function nextOxydColor(l: EditorLevel): string {
  const count = oxydCounts(l);
  for (const c of OXYD_COLORS) if ((count.get(c) ?? 0) % 2 === 1) return c;
  return OXYD_COLORS.find((c) => !count.has(c)) ?? OXYD_COLORS[0];
}

export function oxydCounts(l: EditorLevel): Map<string, number> {
  const count = new Map<string, number>();
  for (const c of l.cells) if (c.s === 'st_oxyd') count.set(c.sa?.symbol ?? '?', (count.get(c.sa?.symbol ?? '?') ?? 0) + 1);
  return count;
}

/** All names in use (connection targets). */
export function names(l: EditorLevel): Set<string> {
  const out = new Set<string>();
  for (const c of l.cells) {
    if (c.sa?.name) out.add(c.sa.name);
    if (c.ia?.name) out.add(c.ia.name);
  }
  return out;
}

function freeName(l: EditorLevel, base: string): string {
  const used = names(l);
  for (let i = 1; ; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`;
}

export interface PaintOptions {
  /** Oxyd colour ('auto' = nextOxydColor) and look. */
  oxydColor?: string;
  oxydFlavor?: string;
}

/** Puts a palette entry into a cell. Returns false if nothing changed. */
export function paint(l: EditorLevel, x: number, y: number, e: PaletteEntry, opt: PaintOptions = {}): boolean {
  const c = cellOf(l, x, y);
  if (!c) return false;
  const before = JSON.stringify([c, l.start, l.actors]);
  switch (e.layer) {
    case 'floor':
      c.f = e.kind;
      break;
    case 'stone':
      if (c.s === e.kind) return false; // keep its name and connection
      c.s = e.kind;
      delete c.sa;
      if (e.attrs) c.sa = { ...e.attrs };
      if (e.role === 'target') c.sa = { ...(c.sa ?? {}), name: freeName(l, 'tuer') };
      if (l.start?.x === x && l.start.y === y) l.start = null;
      break;
    case 'oxyd': {
      const color = !opt.oxydColor || opt.oxydColor === 'auto' ? nextOxydColor(l) : opt.oxydColor;
      if (c.s === 'st_oxyd' && c.sa?.symbol === color && c.sa.flavor === (opt.oxydFlavor ?? 'b')) return false;
      setOxyd(l, x, y, color, opt.oxydFlavor ?? 'b');
      if (l.start?.x === x && l.start.y === y) l.start = null;
      break;
    }
    case 'item':
      if (c.i === e.kind) return false;
      c.i = e.kind;
      delete c.ia;
      if (e.attrs) c.ia = { ...e.attrs };
      break;
    case 'actor':
      l.actors = l.actors.filter((a) => Math.floor(a.x) !== x || Math.floor(a.y) !== y);
      l.actors.push({ k: e.kind, x: x + 0.5, y: y + 0.5 });
      break;
    case 'start':
      l.start = { x, y };
      delete c.s;
      delete c.sa;
      break;
  }
  return JSON.stringify([c, l.start, l.actors]) !== before;
}

/** Eraser: removes actor, item and stone of the cell (the floor stays). */
export function erase(l: EditorLevel, x: number, y: number): boolean {
  const c = cellOf(l, x, y);
  if (!c) return false;
  const actors = l.actors.filter((a) => Math.floor(a.x) !== x || Math.floor(a.y) !== y);
  const changed = actors.length !== l.actors.length || !!c.s || !!c.i || (l.start?.x === x && l.start.y === y);
  l.actors = actors;
  delete c.s;
  delete c.sa;
  delete c.i;
  delete c.ia;
  if (l.start?.x === x && l.start.y === y) l.start = null;
  return changed;
}

/** A connection source in a cell (stone or item with role 'source'). */
export function sourceAt(l: EditorLevel, x: number, y: number): { layer: 'stone' | 'item'; entry: PaletteEntry; attrs: Record<string, string> } | null {
  const c = cellOf(l, x, y);
  if (!c) return null;
  if (c.s && BY_KIND.get(c.s)?.role === 'source') return { layer: 'stone', entry: BY_KIND.get(c.s)!, attrs: (c.sa ??= {}) };
  if (c.i && BY_KIND.get(c.i)?.role === 'source') return { layer: 'item', entry: BY_KIND.get(c.i)!, attrs: (c.ia ??= {}) };
  return null;
}

/** Connection targets (doors) with their names and cells. */
export function targets(l: EditorLevel): { name: string; x: number; y: number; entry: PaletteEntry }[] {
  const out: { name: string; x: number; y: number; entry: PaletteEntry }[] = [];
  l.cells.forEach((c, i) => {
    const e = c.s ? BY_KIND.get(c.s) : undefined;
    if (e?.role === 'target' && c.sa?.name) out.push({ name: c.sa.name, x: i % l.width, y: Math.floor(i / l.width), entry: e });
  });
  return out;
}

/** Sources with their target name (for drawing connection lines and the checks). */
export function sources(l: EditorLevel): { x: number; y: number; target: string; entry: PaletteEntry }[] {
  const out: { x: number; y: number; target: string; entry: PaletteEntry }[] = [];
  for (let y = 0; y < l.height; y++)
    for (let x = 0; x < l.width; x++) {
      const s = sourceAt(l, x, y);
      if (s) out.push({ x, y, target: s.attrs.target ?? '', entry: s.entry });
    }
  return out;
}

// ---------- LevelFile ----------

/** Characters for the legend: readable ones first, then a large Unicode block. */
const CHARS = '.#~,;:_=+*%&$!/|<>^0123456789abcdefghijklmnopqrstuvwxyz';
const charAt = (i: number) => (i < CHARS.length ? CHARS[i] : String.fromCharCode(0x100 + i - CHARS.length));

/** The level as a LevelFile (deterministic: the same level gives the same file). */
export function toLevelFile(l: EditorLevel, id = 'eigen'): LevelFile {
  const legend: Record<string, CellDef> = {};
  const byKey = new Map<string, string>();
  const objects: ObjectDef[] = [];
  const map: string[] = [];
  for (let y = 0; y < l.height; y++) {
    let row = '';
    for (let x = 0; x < l.width; x++) {
      const c = l.cells[y * l.width + x];
      const def: CellDef = { floor: c.f };
      const entry = c.s ? BY_KIND.get(c.s) : undefined;
      if (c.s === 'st_oxyd') {
        def.stone = 'st_oxyd';
        def.symbol = c.sa?.symbol ?? '?';
        def.flavor = c.sa?.flavor ?? 'b';
      } else if (c.s && (entry?.wall ?? !entry)) def.stone = c.s;
      else if (c.s) objects.push(obj(x, y, c.s, c.sa));
      if (c.i) objects.push(obj(x, y, c.i, c.ia));
      const key = JSON.stringify(def);
      let ch = byKey.get(key);
      if (!ch) {
        ch = charAt(byKey.size);
        byKey.set(key, ch);
        legend[ch] = def;
      }
      row += ch;
    }
    map.push(row);
  }
  const file: LevelFile = { id, title: l.title.trim() || 'Ohne Titel', author: l.author.trim(), license: LICENSE, map, legend };
  if (l.start) file.start = { x: l.start.x + 0.5, y: l.start.y + 0.5 };
  if (objects.length) file.objects = objects;
  if (l.actors.length) file.actors = l.actors.map((a) => ({ k: a.k, x: a.x, y: a.y, ...(a.a && Object.keys(a.a).length ? { a: { ...a.a } } : {}) }));
  return file;
}

function obj(x: number, y: number, k: string, a?: Record<string, string>): ObjectDef {
  const attrs = Object.fromEntries(Object.entries(a ?? {}).filter(([, v]) => v !== ''));
  return Object.keys(attrs).length ? { x, y, k, a: attrs } : { x, y, k };
}

/** Result of reading a LevelFile: the level plus what could not be taken over. */
export interface Imported {
  level: EditorLevel;
  /** Kinds the editor does not offer (dropped). */
  dropped: string[];
}

/** A LevelFile as editor level (only kinds of the palette; others are reported in `dropped`). */
export function fromLevelFile(file: LevelFile): Imported {
  const legend = { ...DEFAULT_LEGEND, ...(file.legend ?? {}) };
  const height = Math.min(MAX_H, file.map.length);
  const width = Math.min(MAX_W, Math.max(0, ...file.map.map((r) => r.length)));
  const dropped = new Set<string>();
  const cells: EdCell[] = [];
  let start: { x: number; y: number } | null = file.start ? { x: Math.floor(file.start.x), y: Math.floor(file.start.y) } : null;
  for (let y = 0; y < height; y++) {
    const line = file.map[y].padEnd(width, '#');
    for (let x = 0; x < width; x++) {
      const ch = line[x];
      const def: CellDef | undefined = legend[ch] ?? (/^[A-Z]$/.test(ch) ? { floor: 'fl_gray', stone: 'st_oxyd', symbol: ch } : undefined);
      const floor = def?.floor === 'stone' ? 'fl_gray' : def?.floor === 'abyss' ? 'fl_abyss' : def?.floor ?? DEFAULT_FLOOR;
      const c: EdCell = { f: BY_KIND.get(floor)?.layer === 'floor' ? floor : (dropped.add(floor), DEFAULT_FLOOR) };
      const stone = def?.stone === 'wall' ? 'st_greenbrown' : def?.stone === 'signal' ? 'st_oxyd' : def?.stone;
      if (stone === 'st_oxyd') {
        c.s = 'st_oxyd';
        c.sa = { symbol: def?.symbol ?? '?', flavor: def?.flavor ?? 'b' };
      } else if (stone) {
        if (BY_KIND.get(stone)?.wall) c.s = stone;
        else dropped.add(stone);
      }
      if (def?.start && !file.start) start = { x, y };
      cells.push(c);
    }
  }
  const level: EditorLevel = { title: file.title ?? '', author: file.author ?? '', width, height, cells, actors: [], start };
  for (const o of file.objects ?? []) {
    const e = BY_KIND.get(o.k);
    const c = cellOf(level, o.x, o.y);
    if (!e || !c || (e.layer !== 'stone' && e.layer !== 'item') || e.wall) {
      dropped.add(o.k);
      continue;
    }
    const attrs = keepAttrs(o.a);
    if (e.layer === 'stone') {
      c.s = o.k;
      if (attrs) c.sa = attrs;
    } else {
      c.i = o.k;
      if (attrs) c.ia = attrs;
    }
  }
  for (const a of file.actors ?? []) {
    if (BY_KIND.get(a.k)?.layer === 'actor' && cellOf(level, Math.floor(a.x), Math.floor(a.y))) level.actors.push({ k: a.k, x: Math.floor(a.x) + 0.5, y: Math.floor(a.y) + 0.5 });
    else dropped.add(a.k);
  }
  if (start && !cellOf(level, start.x, start.y)) start = null;
  level.start = start;
  return { level, dropped: [...dropped] };
}

/** Attributes the editor keeps (the rest is engine state of imported levels). */
export const KEPT_ATTRS = ['name', 'target', 'action', 'interval', 'flavor'];

function keepAttrs(a: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!a) return undefined;
  const out: Record<string, string> = {};
  for (const k of KEPT_ATTRS) if (typeof a[k] === 'string') out[k] = a[k];
  return Object.keys(out).length ? out : undefined;
}
