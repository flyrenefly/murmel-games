// The built Enigma world as editor level (docs/SPEC-enigma-upload.md U3): only what the editor palette
// offers, so the result goes through the existing publish path (sanitizeLevel, replay, admin review).

import { DEFAULT_FLOOR, type EdCell, type EditorLevel } from '../editor/model';
import { BY_KIND } from '../editor/palette';
import { type EnigmaDatei, UploadError } from './datei';
import type { Decl, Welt } from './welt';

/** Attributes player levels keep (sanitizeLevel in src/editor/link.ts). */
const KEPT = ['name', 'target', 'action', 'interval'];
/** Attributes the conversion reads itself (no hint when they are not kept). */
const READ: Record<string, string[]> = {
  st_oxyd: ['oxydcolor', 'flavor'],
  st_door: ['flavor', 'faces'],
  st_door_d: ['faces'],
  st_grate: ['flavor'],
  st_box: ['flavor'],
  st_oneway: ['orientation'],
};
/** Wall variants that only differ in their edges (tools/import-enigma.mjs STONE_BASE). */
const WALL_EDGES = /^(st_(?:bluesand|brick|panel|rawglass))(?:_[nesw]+|_quad)$/;
const MARBLE = /^ac_marble(_black)?$/;
/** Enigma direction constants (WEST, SOUTH, EAST, NORTH) → oneway suffix. */
const DIRS = ['w', 's', 'e', 'n'];

/** Enigma kinds whose look comes from attributes, as the editor names them (defaults from Enigma's stones/*.cc). */
export function editorKind(d: Decl): string {
  const a = d.a;
  switch (d.k) {
    case 'st_door': {
      const flavor = a.flavor ?? 'd';
      return flavor === 'd' && a.faces === 'ew' ? 'st_door_d_ew' : `st_door_${flavor}`;
    }
    case 'st_door_d':
      return a.faces === 'ew' ? 'st_door_d_ew' : d.k;
    case 'st_grate':
      return `st_grate_${a.flavor ?? 'cross'}`;
    case 'st_box':
      return `st_box_${a.flavor ?? 'wood'}`;
    case 'st_oneway':
      return `st_oneway_${DIRS[Number(a.orientation ?? 3)] ?? 'n'}`;
    default:
      return d.k;
  }
}

export interface Umgewandelt {
  level: EditorLevel;
  /** What was left out or changed (shown before opening the editor). */
  hinweise: string[];
}

/** A floor of the palette, also from a variant that only differs in its look (fl_lawn_a → fl_lawn). */
function floorKind(k: string): string | null {
  if (/_heating/.test(k)) return null; // melts or dries during play
  let c = k;
  for (;;) {
    if (isFloor(c)) return c;
    const i = c.lastIndexOf('_');
    if (i <= 2) return null;
    c = c.slice(0, i);
  }
}
const isFloor = (k: string) => BY_KIND.get(k)?.layer === 'floor';
const isWall = (k: string) => BY_KIND.get(k)?.wall === true;
const isObject = (k: string, layer: 'stone' | 'item') => {
  const e = BY_KIND.get(k);
  return !!e && e.layer === layer && !e.wall;
};

export function zuEditorLevel(datei: EnigmaDatei, welt: Welt): Umgewandelt {
  const missing = new Map<string, number>();
  const miss = (k: string) => missing.set(k, (missing.get(k) ?? 0) + 1);
  const hinweise: string[] = [];
  const dropped = new Set<string>();
  const callbacks = new Set<string>();

  const attrs = (d: Decl, k: string): Record<string, string> | undefined => {
    const out: Record<string, string> = {};
    for (const [key, v] of Object.entries(d.a)) {
      if (KEPT.includes(key)) out[key] = v;
      else if (!READ[k]?.includes(key) && !key.startsWith('_')) dropped.add(`${key} von ${d.k}`);
    }
    for (const t of (out.target ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean)) if (welt.isFunction(t)) callbacks.add(`${d.k} über die Lua-Funktion „${t}“`);
    return Object.keys(out).length ? out : undefined;
  };

  const cells: EdCell[] = welt.cells.map((z, i) => {
    const c: EdCell = { f: DEFAULT_FLOOR };
    if (z.fl) {
      const f = floorKind(z.fl.k);
      if (f) c.f = f;
      else miss(z.fl.k);
    } else hinweise.push(`Bei ${i % welt.w}, ${Math.floor(i / welt.w)} fehlt ein Boden; dort liegt jetzt ${DEFAULT_FLOOR}.`);
    if (z.st) stone(c, z.st);
    if (z.it) {
      const k = isObject(z.it.k, 'item') ? z.it.k : null;
      if (k) {
        c.i = k;
        const a = attrs(z.it, k);
        if (a) c.ia = a;
      } else miss(z.it.k);
    }
    return c;
  });

  function stone(c: EdCell, d: Decl): void {
    const oxyd = /^st_oxyd(?:_([a-e]))?$/.exec(d.k);
    if (oxyd) {
      const color = Number(d.a.oxydcolor);
      const flavor = d.a.flavor ?? oxyd[1] ?? 'b';
      c.s = 'st_oxyd';
      c.sa = { symbol: Number.isInteger(color) && color >= 0 && color < 26 ? String.fromCharCode(65 + color) : '?', flavor: /^[a-d]$/.test(flavor) ? flavor : 'b' };
      return;
    }
    const k = editorKind(d);
    if (isObject(k, 'stone')) {
      c.s = k;
      const a = attrs(d, d.k);
      if (a) c.sa = a;
      return;
    }
    // walls: only variants that differ in their edges (st_brick_n), never st_granite_movable or st_flat_breakable
    const wall = isWall(k) ? k : (WALL_EDGES.exec(k)?.[1] ?? null);
    if (wall) {
      c.s = wall;
      for (const key of Object.keys(d.a)) if (!key.startsWith('_') && key !== 'name') dropped.add(`${key} von ${d.k}`);
      return;
    }
    miss(k);
  }

  const marbles = welt.actors.filter((a) => MARBLE.test(a.k));
  const actors: EditorLevel['actors'] = [];
  for (const a of welt.actors) {
    if (MARBLE.test(a.k)) continue;
    if (BY_KIND.get(a.k)?.layer === 'actor') {
      actors.push({ k: a.k, x: a.x, y: a.y });
      for (const key of Object.keys(a.a)) if (!key.startsWith('_')) dropped.add(`${key} von ${a.k}`);
    } else miss(a.k);
  }
  for (const k of welt.unsupported) miss(k);

  if (callbacks.size) throw new UploadError(`Das Level steuert ${[...callbacks].join(', ')}. Lua ist in Spieler-Levels nicht erlaubt.`);
  if (missing.size)
    throw new UploadError(
      `Diese Objekte kann ein Spieler-Level noch nicht enthalten: ${[...missing].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => (n > 1 ? `${k} (${n}×)` : k)).join(', ')}.`,
    );

  if (marbles.length !== 1) throw new UploadError(`Das Level braucht genau eine schwarze Murmel (gefunden: ${marbles.length}).`);

  const world = Object.keys(welt.world);
  if (world.length) hinweise.push(`Nicht übernommene Welteinstellungen: ${world.join(', ')}.`);
  if (dropped.size) hinweise.push(`Nicht übernommene Eigenschaften: ${[...dropped].slice(0, 12).join(', ')}${dropped.size > 12 ? ' …' : ''}.`);
  hinweise.push(...welt.hints);
  const m = marbles[0];
  return {
    level: {
      title: datei.title || 'Enigma-Level',
      author: '',
      width: welt.w,
      height: welt.h,
      cells,
      actors,
      start: { x: Math.floor(m.x), y: Math.floor(m.y) },
    },
    hinweise: hinweise.slice(0, 8),
  };
}
