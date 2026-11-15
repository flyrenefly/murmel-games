// The built Enigma world as editor level (docs/SPEC-enigma-upload.md U3): only what the editor palette
// offers, so the result goes through the existing publish path (sanitizeLevel, replay, admin review).

import { DEFAULT_FLOOR, type EdCell, type EditorLevel } from '../editor/model';
import { docText, MAIN_PEARLS, MAX_DOC_TEXT, MAX_DOCS } from '../editor/link';
import { BY_KIND } from '../editor/palette';
import { type EnigmaDatei, UploadError } from './datei';
import type { Decl, Welt } from './welt';

/** Attributes every player-level object keeps (sanitizeLevel in src/editor/link.ts); more as palette properties. */
const KEPT = ['name', 'target', 'action', 'interval'];
/** Attributes the conversion reads itself to choose the kind (no hint when they are not kept). */
const READ: Record<string, string[]> = {
  st_oxyd: ['oxydcolor', 'flavor'],
  st_door: ['flavor', 'faces'],
  st_door_d: ['faces'],
  st_grate: ['flavor'],
  st_box: ['flavor'],
  st_oneway: ['orientation'],
  st_laser: ['orientation'],
  st_boulder: ['orientation'],
  st_turnstilearm: ['orientation'],
  st_mirror: ['flavor'],
  st_passage: ['color'],
  st_chess: ['color'],
  st_switch: ['color'],
  st_blur: ['flavor'],
  st_rotator: ['counterclock'],
  st_shogun: ['flavor'],
  it_shogun: ['flavor'],
  it_magnet: ['state'],
  it_bomb: ['color'],
  ac_pearl: ['color'],
};
/** Floors whose plain Enigma name means one flavour (InverseFloor, YinyangFloor defaults). */
const FLOOR_ALIAS: Record<string, string> = { fl_inverse: 'fl_inverse_white', fl_yinyang: 'fl_yinyang_yin' };
/** Mirror kind suffixes (st_mirror_slab_ntm): direction and the flags t(ransparent), m(ovable). */
const MIRROR = /^st_mirror(?:_(slab|triangle|sheets))?(?:_([nesw])(t?)(m?)(c?))?$/;
const DIR_VALUE: Record<string, string> = { w: '0', s: '1', e: '2', n: '3' };
const SLOPE_BY_DIR = ['fl_slope_pw', 'fl_slope_ps', 'fl_slope_pe', 'fl_slope_pn', 'fl_slope_inw', 'fl_slope_isw', 'fl_slope_ise', 'fl_slope_ine'];
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
    case 'st_laser':
      return `st_laser_${DIRS[Number(a.orientation ?? 2)] ?? 'e'}`;
    case 'st_boulder':
      return `st_boulder_${DIRS[Number(a.orientation ?? 3)] ?? 'n'}`;
    case 'st_turnstilearm':
      return `st_turnstilearm_${DIRS[Number(a.orientation ?? 3)] ?? 'n'}`;
    case 'st_passage':
      return a.color === '1' ? 'st_passage_white' : 'st_passage_black';
    case 'st_chess':
      return a.color === '1' ? 'st_chess_white' : 'st_chess_black';
    case 'st_switch':
      return a.color === '0' ? 'st_switch_black' : a.color === '1' ? 'st_switch_white' : d.k;
    case 'st_blur':
      return `st_blur_${a.flavor ?? 'straight'}`;
    case 'st_rotator':
      return a.counterclock === 'true' ? 'st_rotator_ccw' : 'st_rotator_cw';
    case 'st_shogun':
    case 'it_shogun':
      return `${d.k}_${a.flavor ?? 's'}`;
    case 'it_magnet':
      return a.state === '1' ? 'it_magnet_on' : 'it_magnet_off';
    case 'it_meditation':
      return 'it_meditation_hollow';
    case 'it_crack':
      return 'it_crack_s';
    case 'it_bomb':
    case 'it_bomb_black':
      return a.color === '1' ? 'it_bomb_white' : 'it_bomb';
    case 'ac_pearl':
      return a.color === '0' ? 'ac_pearl_black' : 'ac_pearl_white';
    default: {
      // st_passage_black_square → st_passage_black (the flavor comes as attribute, see editorAttrs)
      const passage = /^(st_passage_(?:black|white))_\w+$/.exec(d.k);
      if (passage) return passage[1];
      const mirror = MIRROR.exec(d.k);
      if (mirror) return `st_mirror_${a.flavor ?? mirror[1] ?? 'slab'}`;
      return d.k;
    }
  }
}

/** Attributes the kind's name carries in Enigma that the editor keeps as properties (mirror suffixes, passage shapes). */
function kindAttrs(d: Decl): Record<string, string> {
  const out: Record<string, string> = {};
  const passage = /^st_passage_(?:black|white)_(\w+)$/.exec(d.k);
  if (passage) out.flavor = passage[1];
  const mirror = MIRROR.exec(d.k);
  if (mirror?.[2]) {
    out.orientation = DIR_VALUE[mirror[2]];
    if (mirror[3]) out.transparent = 'true';
    if (mirror[4]) out.movable = 'true';
  }
  return out;
}

export interface Umgewandelt {
  level: EditorLevel;
  /** What was left out or changed (shown before opening the editor). */
  hinweise: string[];
}

/** A floor of the palette, also from a variant that only differs in its look (fl_lawn_a → fl_lawn). */
function floorKind(k: string, a: Record<string, string> = {}): string | null {
  if (/_heating/.test(k)) return null; // melts or dries during play
  // fl_slope with a slope attribute (SlopeFloor.cc directions 0–7): planar or inner corner, same force
  if (k === 'fl_slope') return SLOPE_BY_DIR[Number(a.slope)] ?? null;
  let c = FLOOR_ALIAS[k] ?? k;
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
  let shortened = 0;

  /** Connection attributes, and the properties of the editor kind with an allowed value. */
  const attrs = (d: Decl, k: string, editor: string): Record<string, string> | undefined => {
    const out: Record<string, string> = {};
    const props = BY_KIND.get(editor)?.props ?? [];
    const a = { ...kindAttrs(d), ...d.a };
    for (const [key, v] of Object.entries(a)) {
      const prop = props.find((p) => p.key === key);
      if (KEPT.includes(key)) out[key] = v;
      else if (key === 'text' && BY_KIND.get(editor)?.text) {
        // a document: the text of its i18n key (Enigma shows the key itself when there is none)
        const raw = datei.texts[v] ?? v;
        const t = docText(raw);
        if (t) out.text = t;
        if ([...raw.replace(/\s+/g, ' ').trim()].length > MAX_DOC_TEXT) shortened++;
      } else if (prop?.options.some(([value]) => value === v)) {
        if (v !== prop.options[0][0]) out[key] = v; // the first value is the default
      } else if (!READ[k]?.includes(key) && !key.startsWith('_')) dropped.add(`${key} von ${d.k}`);
    }
    for (const t of (out.target ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean)) if (welt.isFunction(t)) callbacks.add(`${d.k} über die Lua-Funktion „${t}“`);
    return Object.keys(out).length ? out : undefined;
  };

  const cells: EdCell[] = welt.cells.map((z, i) => {
    const c: EdCell = { f: DEFAULT_FLOOR };
    if (z.fl) {
      const f = floorKind(z.fl.k, z.fl.a);
      if (f) c.f = f;
      else miss(z.fl.k);
      // a slope's force is always SlopeForce 25 in player levels
      if (f?.startsWith('fl_slope') && z.fl.a.strength !== undefined) dropped.add(`strength von ${z.fl.k}`);
    } else hinweise.push(`Bei ${i % welt.w}, ${Math.floor(i / welt.w)} fehlt ein Boden; dort liegt jetzt ${DEFAULT_FLOOR}.`);
    if (z.st) stone(c, z.st);
    if (z.it) {
      const ek = editorKind(z.it);
      const k = isObject(ek, 'item') ? ek : null;
      if (k) {
        c.i = k;
        const a = attrs(z.it, z.it.k, k);
        if (a) c.ia = a;
      } else miss(ek);
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
      const a = attrs(d, d.k, k);
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
    const k = editorKind(a);
    if (BY_KIND.get(k)?.layer === 'actor') {
      actors.push({ k, x: a.x, y: a.y });
      for (const key of Object.keys(a.a)) if (!key.startsWith('_') && !READ[a.k]?.includes(key)) dropped.add(`${key} von ${a.k}`);
    } else miss(k);
  }
  // Meditation without a black marble: the first pearl is the main ball (as tools/import-enigma.mjs)
  const mainPearl = marbles.length === 0 ? actors.find((a) => MAIN_PEARLS.has(a.k)) : undefined;
  if (mainPearl) actors.splice(actors.indexOf(mainPearl), 1);
  for (const k of welt.unsupported) miss(k);

  if (callbacks.size) throw new UploadError(`Das Level steuert ${[...callbacks].join(', ')}. Lua ist in Spieler-Levels nicht erlaubt.`);
  if (missing.size)
    throw new UploadError(
      `Diese Objekte kann ein Spieler-Level noch nicht enthalten: ${[...missing].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => (n > 1 ? `${k} (${n}×)` : k)).join(', ')}.`,
    );

  if (marbles.length !== 1 && !mainPearl)
    throw new UploadError(`Das Level braucht genau eine schwarze Murmel oder, als Meditation, eine Perle (gefunden: ${marbles.length} Murmeln).`);

  const docs = cells.filter((c) => c.i === 'it_document').length;
  if (docs > MAX_DOCS) throw new UploadError(`Das Level enthält ${docs} Dokumente; ein Spieler-Level darf höchstens ${MAX_DOCS} enthalten.`);
  if (shortened) hinweise.push(`${shortened === 1 ? 'Ein Dokumenttext wurde' : `${shortened} Dokumenttexte wurden`} auf ${MAX_DOC_TEXT} Zeichen gekürzt.`);

  const world = Object.keys(welt.world);
  if (world.length) hinweise.push(`Nicht übernommene Welteinstellungen: ${world.join(', ')}.`);
  if (dropped.size) hinweise.push(`Nicht übernommene Eigenschaften: ${[...dropped].slice(0, 12).join(', ')}${dropped.size > 12 ? ' …' : ''}.`);
  hinweise.push(...welt.hints);
  const m = mainPearl ?? marbles[0];
  return {
    level: {
      title: datei.title || 'Enigma-Level',
      author: '',
      width: welt.w,
      height: welt.h,
      cells,
      actors,
      start: { x: Math.floor(m.x), y: Math.floor(m.y) },
      ...(mainPearl ? { mainPearl: mainPearl.k } : {}),
    },
    hinweise: hinweise.slice(0, 8),
  };
}
