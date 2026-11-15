// What the editor can place: a curated list of kinds Murmel really supports (src/game/objects.ts,
// src/game/actors.ts, floors.generated.json). palette.test.ts checks every entry against the game.
// Labels, groups and property texts stay German in the data (they are ids and dictionary keys);
// paletteText() shows them in the page's language (src/i18n/en/editor-palette.ts).

import { sprache } from '../i18n';
import EN from '../i18n/en/editor-palette';

/** Where an entry goes: cell floor, cell stone (wall, object stone or Oxyd), cell item, actor, start. */
export type Layer = 'floor' | 'stone' | 'item' | 'actor' | 'start' | 'oxyd';

/** Role in a connection: sources have `target`/`action`, targets have `name`. */
export type Role = 'source' | 'target';

export interface PaletteEntry {
  kind: string;
  layer: Layer;
  group: string;
  label: string;
  /** Image of the classic sets (public/enigma/gfx32/<image>.png) and its frame in the strip. */
  image: string;
  /** Frame in a strip, or [column, row] in a sheet. */
  frame?: number | [number, number];
  /** Plain stone in the map (true) or an interactive object in `objects` (false). */
  wall?: boolean;
  role?: Role;
  /** Default attributes of a new object. */
  attrs?: Record<string, string>;
  /** Properties a player may choose: only these values pass sanitizeLevel (no free text). */
  props?: Prop[];
  /** Small mark on the preview (direction arrow …) where the image alone does not tell. */
  badge?: string;
  /** Slope floors: the constant floor force (derived from the kind, never read from a file). */
  force?: [number, number];
  /** Start entries: the main ball is this pearl instead of the black marble. */
  mainPearl?: string;
  /** Documents: a plain text the player writes (attribute `text`, see docText in link.ts). */
  text?: boolean;
}

/** A chooseable attribute: key, label and the allowed values with their labels (first = default). */
export interface Prop {
  key: string;
  label: string;
  options: [string, string][];
}

export const GROUPS = [
  'Spezial',
  'Böden',
  'Gefälle',
  'Wände',
  'Bewegliche Steine',
  'Schalter und Türen',
  'Laser und Spiegel',
  'Mechanik',
  'Gefahren',
  'Gegenstände',
  'Meditation',
  'Murmeln und Perlen',
  'Gegner',
] as const;

const floor = (kind: string, label: string, image = kind, more: Partial<PaletteEntry> = {}): PaletteEntry => ({ kind, layer: 'floor', group: 'Böden', label, image, ...more });
const wall = (kind: string, label: string): PaletteEntry => ({ kind, layer: 'stone', group: 'Wände', label, image: kind, wall: true });
const stone = (group: string, kind: string, label: string, image = kind, more: Partial<PaletteEntry> = {}): PaletteEntry => ({ kind, layer: 'stone', group, label, image, ...more });
const item = (kind: string, label: string, image = kind, group = 'Gegenstände', more: Partial<PaletteEntry> = {}): PaletteEntry => ({ kind, layer: 'item', group, label, image, ...more });
const actor = (group: string, kind: string, label: string, image = kind, badge?: string): PaletteEntry => ({ kind, layer: 'actor', group, label, image, ...(badge ? { badge } : {}) });

/** Enigma directions as attribute values (WEST 0, SOUTH 1, EAST 2, NORTH 3). */
const ORIENTATION: Prop = { key: 'orientation', label: 'Ausrichtung', options: [['3', 'Norden ↑'], ['2', 'Osten →'], ['1', 'Süden ↓'], ['0', 'Westen ←']] };
const yesNo = (key: string, label: string): Prop => ({ key, label, options: [['false', 'nein'], ['true', 'ja']] });
const ARROW: Record<string, string> = { n: '↑', e: '→', s: '↓', w: '←' };
/** Labels with a direction written out, so each is a dictionary key. */
const BOULDER: Record<string, string> = { n: 'Rollstein ↑', e: 'Rollstein →', s: 'Rollstein ↓', w: 'Rollstein ←' };
const TURNSTILE_ARM: Record<string, string> = { n: 'Drehkreuzarm ↑', e: 'Drehkreuzarm →', s: 'Drehkreuzarm ↓', w: 'Drehkreuzarm ←' };

/**
 * Slopes (SlopeFloor.cc, models-2d.lua): shape, label, direction of the force and the subimage in the
 * fl_slope sheet (6 × 4, column by column). The force is SlopeForce 25 along the direction.
 */
const SLOPES: [string, string, number, number, number][] = [
  ['pn', 'Gefälle ↑', 0, -1, 2],
  ['pe', 'Gefälle →', 1, 0, 3],
  ['ps', 'Gefälle ↓', 0, 1, 1],
  ['pw', 'Gefälle ←', -1, 0, 4],
  ['inw', 'Innenecke ↖', -1, -1, 12],
  ['ine', 'Innenecke ↗', 1, -1, 10],
  ['ise', 'Innenecke ↘', 1, 1, 9],
  ['isw', 'Innenecke ↙', -1, 1, 11],
  ['onw', 'Außenecke ↖', -1, -1, 8],
  ['one', 'Außenecke ↗', 1, -1, 7],
  ['ose', 'Außenecke ↘', 1, 1, 5],
  ['osw', 'Außenecke ↙', -1, 1, 6],
];
export const SLOPE_FORCE = 25;
const round = (v: number) => Math.round(v * 1000) / 1000 + 0; // + 0: no -0
const slope = ([shape, label, dx, dy, sub]: (typeof SLOPES)[number]): PaletteEntry => {
  const n = Math.hypot(dx, dy);
  return { kind: `fl_slope_${shape}`, layer: 'floor', group: 'Gefälle', label, image: 'fl_slope', frame: [Math.floor((sub - 1) / 4), (sub - 1) % 4], force: [round((dx / n) * SLOPE_FORCE), round((dy / n) * SLOPE_FORCE)] };
};

export const PALETTE: PaletteEntry[] = [
  { kind: 'start', layer: 'start', group: 'Spezial', label: 'Murmel (Start)', image: 'ac_marble_black' },
  { kind: 'start_pearl_white', layer: 'start', group: 'Spezial', label: 'Weiße Perle (Start)', image: 'ac_pearl_white', mainPearl: 'ac_pearl_white' },
  { kind: 'start_pearl_black', layer: 'start', group: 'Spezial', label: 'Schwarze Perle (Start)', image: 'ac_pearl_black', mainPearl: 'ac_pearl_black' },
  { kind: 'st_oxyd', layer: 'oxyd', group: 'Spezial', label: 'Oxyd-Stein', image: 'st_oxydb' },

  floor('fl_gray', 'Grau'),
  floor('fl_abyss', 'Abgrund'),
  floor('fl_water', 'Wasser'),
  floor('fl_swamp', 'Sumpf'),
  floor('fl_ice', 'Eis'),
  floor('fl_sand', 'Sand'),
  floor('fl_wood', 'Holz'),
  floor('fl_plank', 'Planken'),
  floor('fl_metal', 'Metall'),
  floor('fl_lawn', 'Rasen'),
  floor('fl_hay', 'Heu'),
  floor('fl_brick', 'Ziegel'),
  floor('fl_marble', 'Marmor'),
  floor('fl_rock', 'Fels'),
  floor('fl_concrete', 'Beton'),
  floor('fl_bluegray', 'Blaugrau'),
  floor('fl_bluegreen', 'Blaugrün'),
  floor('fl_aquamarine', 'Aquamarin'),
  floor('fl_red', 'Rot'),
  floor('fl_white', 'Weiß'),
  floor('fl_dark', 'Dunkel'),
  floor('fl_darkgray', 'Dunkelgrau'),
  floor('fl_bright', 'Hell'),
  floor('fl_dunes', 'Dünen'),
  floor('fl_sahara', 'Sahara'),
  floor('fl_samba', 'Samba'),
  floor('fl_tigris', 'Tigris'),
  floor('fl_himalaya', 'Himalaya'),
  floor('fl_space', 'Weltraum'),
  floor('fl_woven', 'Gewebe'),
  floor('fl_gravel', 'Kies'),
  floor('fl_platinum', 'Platin'),
  floor('fl_pinkbumps', 'Rosa Noppen'),
  floor('fl_bast', 'Bast'),
  floor('fl_ivory', 'Elfenbein'),
  floor('fl_mortar', 'Mörtel'),
  floor('fl_redslab', 'Rote Platten'),
  floor('fl_blueslab', 'Blaue Platten'),
  floor('fl_rough', 'Rau'),
  floor('fl_stone', 'Stein'),
  floor('fl_adhesionless', 'Glatt'),
  floor('fl_inverse_white', 'Umkehrboden'),
  floor('fl_inverse_gray', 'Umkehrboden grau'),
  floor('fl_fake_abyss', 'Scheinabgrund', 'fl_abyss', { badge: '✓' }),
  floor('fl_yinyang_yin', 'Yin-Boden'),
  floor('fl_yinyang_yang', 'Yang-Boden'),

  ...SLOPES.map(slope),

  wall('st_granite', 'Granit'),
  wall('st_greenbrown', 'Grünbraun'),
  wall('st_redbrown', 'Rotbraun'),
  wall('st_brick', 'Ziegel'),
  wall('st_bluegray', 'Blaugrau'),
  wall('st_bluesand', 'Blausand'),
  wall('st_concrete', 'Beton'),
  wall('st_darkgray', 'Dunkelgrau'),
  wall('st_metal', 'Metall'),
  wall('st_brownmarble', 'Brauner Marmor'),
  wall('st_redmarble', 'Roter Marmor'),
  wall('st_purplemarble', 'Lila Marmor'),
  wall('st_panel', 'Täfelung'),
  wall('st_plaster', 'Putz'),
  wall('st_rawglass', 'Rohglas'),
  wall('st_lightglass', 'Helles Glas'),
  wall('st_darkglass', 'Dunkles Glas'),
  wall('st_redrock', 'Roter Fels'),
  wall('st_tigris', 'Tigris'),
  wall('st_woven', 'Gewebe'),
  wall('st_yellow', 'Gelb'),
  wall('st_pinkbumps', 'Rosa Noppen'),
  wall('st_greengray', 'Grüngrau'),
  wall('st_purplegray', 'Lilagrau'),
  wall('st_beads', 'Perlen'),
  wall('st_ancient', 'Alt'),
  wall('st_camouflage', 'Tarnung'),
  wall('st_flat', 'Flach'),
  wall('st_redfiber', 'Rote Faser'),
  wall('st_brownpyramid', 'Pyramide'),
  { ...wall('st_invisible', 'Unsichtbare Wand'), image: 'st_darkgray', badge: '◌' },

  stone('Bewegliche Steine', 'st_box_wood', 'Holzkiste'),
  stone('Bewegliche Steine', 'st_box_hay', 'Heukiste'),
  stone('Bewegliche Steine', 'st_box_rock', 'Felskiste'),
  stone('Bewegliche Steine', 'st_brownie', 'Brauner Stein'),
  stone('Bewegliche Steine', 'st_granite_movable', 'Granit, schiebbar', 'st_granite'),
  stone('Bewegliche Steine', 'st_greenbrown_movable', 'Grünbraun, schiebbar', 'st_greenbrown'),
  stone('Bewegliche Steine', 'st_swap', 'Tauschstein'),
  stone('Bewegliche Steine', 'st_break_plain', 'Zerbrechlich'),
  stone('Bewegliche Steine', 'st_flat_movable', 'Flach, schiebbar', 'st_flat'),
  stone('Bewegliche Steine', 'st_plop', 'Plopp-Stein', 'st_plop_slate'),
  stone('Bewegliche Steine', 'st_rawglass_movable', 'Rohglas, schiebbar', 'st_rawglass'),
  stone('Bewegliche Steine', 'st_flat_breakable', 'Flach, zerbrechlich', 'st_flat', { badge: '✕' }),
  stone('Bewegliche Steine', 'st_knight', 'Ritter', 'st_knight'),
  stone('Bewegliche Steine', 'st_break_black', 'Zerbrechlich schwarz', 'st_break_black'),
  stone('Bewegliche Steine', 'st_break_white', 'Zerbrechlich weiß', 'st_break_white'),
  stone('Bewegliche Steine', 'st_break_oxydc', 'Zerbrechlich, Oxyd-Look', 'st_break_oxydc'),
  stone('Bewegliche Steine', 'st_chess_black', 'Springer schwarz', 'st_chess_black'),
  stone('Bewegliche Steine', 'st_chess_white', 'Springer weiß', 'st_chess_white'),
  ...(['s', 'm', 'sm', 'l', 'sl', 'ml', 'sml'] as const).map((f, i) => stone('Bewegliche Steine', `st_shogun_${f}`, `Shogun ${f.toUpperCase()}`, 'st_shogun', { frame: i })),

  stone('Schalter und Türen', 'st_switch', 'Schalter', 'st_switch', { role: 'source' }),
  { ...item('it_trigger', 'Bodenschalter', 'it_trigger', 'Schalter und Türen'), role: 'source' },
  stone('Schalter und Türen', 'st_timer', 'Zeitgeber', 'st_timer', { role: 'source', attrs: { interval: '2' } }),
  stone('Schalter und Türen', 'st_door_d', 'Tür waagerecht', 'st_door_d_ns', { frame: 6, role: 'target' }),
  stone('Schalter und Türen', 'st_door_d_ew', 'Tür senkrecht', 'st_door_d_ew', { frame: 6, role: 'target' }),
  stone('Schalter und Türen', 'st_door_b', 'Tür, versenkbar', 'st_flat', { role: 'target' }),
  stone('Schalter und Türen', 'st_door_c', 'Gittertür', 'st_grate_framed', { role: 'target' }),
  stone('Schalter und Türen', 'st_grate_cross', 'Gitter'),
  stone('Schalter und Türen', 'st_oneway_n', 'Einbahn ↑', 'st_oneway', { frame: 1 }),
  stone('Schalter und Türen', 'st_oneway_e', 'Einbahn →', 'st_oneway', { frame: 0 }),
  stone('Schalter und Türen', 'st_oneway_s', 'Einbahn ↓', 'st_oneway', { frame: 2 }),
  stone('Schalter und Türen', 'st_oneway_w', 'Einbahn ←', 'st_oneway', { frame: 3 }),
  stone('Schalter und Türen', 'st_door_a', 'Tür, Oxyd-Look', 'st_oxyda', { role: 'target' }),
  stone('Schalter und Türen', 'st_grate_framed', 'Gitter mit Rahmen'),
  stone('Schalter und Türen', 'st_switch_black', 'Schalter schwarz', 'st_switch_black', { role: 'source' }),
  stone('Schalter und Türen', 'st_switch_white', 'Schalter weiß', 'st_switch_white', { role: 'source' }),
  stone('Schalter und Türen', 'st_fourswitch', 'Vierfachschalter', 'st_fourswitch', { role: 'source' }),
  stone('Schalter und Türen', 'st_key', 'Schlüsselschalter', 'st_key_off', { role: 'source' }),
  stone('Schalter und Türen', 'st_floppy', 'Diskettenschalter', 'st_floppy_off', { role: 'source' }),
  stone('Schalter und Türen', 'st_coinslot', 'Münzschlitz', 'st_coinslot', { role: 'source' }),
  { ...item('it_sensor', 'Sensor', 'it_sensor', 'Schalter und Türen'), role: 'source' },
  ...(['black', 'white'] as const).map((c) =>
    stone('Schalter und Türen', `st_passage_${c}`, c === 'black' ? 'Farbdurchlass schwarz' : 'Farbdurchlass weiß', `st_passage_${c}_square`, {
      props: [{ key: 'flavor', label: 'Form', options: [['square', 'Quadrat'], ['slash', 'Schräg /'], ['backslash', 'Schräg \\'], ['cross', 'Kreuz'], ['frame', 'Rahmen']] }],
    }),
  ),
  stone('Schalter und Türen', 'st_blur_straight', 'Yin-Yang-Durchlass', 'st_blur_straight'),
  stone('Schalter und Türen', 'st_blur_cross', 'Yin-Yang-Kreuz', 'st_blur_cross'),

  ...(['n', 'e', 's', 'w'] as const).map((d, i) =>
    stone('Laser und Spiegel', `st_laser_${d}`, `Laser ${ARROW[d]}`, 'st_laser', { frame: [i, 1], role: 'target', props: [{ key: 'state', label: 'Zu Beginn', options: [['0', 'aus'], ['1', 'an']] }] }),
  ),
  stone('Laser und Spiegel', 'st_mirror_slab', 'Spiegel', 'st_mirror_static', { frame: [2, 0], props: [ORIENTATION, yesNo('movable', 'Schiebbar'), yesNo('transparent', 'Halbdurchlässig')] }),
  stone('Laser und Spiegel', 'st_mirror_triangle', 'Dreieckspiegel', 'st_mirror_static', { frame: [0, 0], props: [ORIENTATION, yesNo('movable', 'Schiebbar'), yesNo('transparent', 'Halbdurchlässig')] }),
  stone('Laser und Spiegel', 'st_lightpassenger', 'Lichtreiter', 'st_lightpassenger', { role: 'target' }),

  stone('Mechanik', 'st_stoneimpulse', 'Impulsstein'),
  stone('Mechanik', 'st_stoneimpulse_hollow', 'Impulsstein, hohl', 'st_stoneimpulse_hollow'),
  stone('Mechanik', 'st_stoneimpulse_movable', 'Impulsstein, schiebbar', 'st_stoneimpulse', { badge: '⇄' }),
  stone('Mechanik', 'st_actorimpulse', 'Flipper'),
  stone('Mechanik', 'st_actorimpulse_invisible', 'Flipper, unsichtbar', 'st_actorimpulse', { badge: '◌' }),
  ...(['n', 'e', 's', 'w'] as const).map((d, i) => stone('Mechanik', `st_boulder_${d}`, BOULDER[d], 'st_boulder', { frame: [i, 0] })),
  stone('Mechanik', 'st_rotator_cw', 'Drehstein ↻', 'st_rotator_cw'),
  stone('Mechanik', 'st_rotator_ccw', 'Drehstein ↺', 'st_rotator_ccw'),
  stone('Mechanik', 'st_turnstile', 'Drehkreuz', 'st_turnstile'),
  ...(['n', 'e', 's', 'w'] as const).map((d) => stone('Mechanik', `st_turnstilearm_${d}`, TURNSTILE_ARM[d], 'st_puzzle_blue', { frame: [0, 0], badge: ARROW[d] })),
  stone('Mechanik', 'st_pull', 'Zugstein'),
  stone('Mechanik', 'st_quake', 'Bebenstein'),
  stone('Mechanik', 'st_fake_quake', 'Bebenstein, harmlos', 'st_quake', { badge: '✓' }),

  stone('Gefahren', 'st_death', 'Todesstein'),
  stone('Gefahren', 'st_death_invisible', 'Todesstein, unsichtbar', 'st_death', { badge: '◌' }),
  item('it_landmine', 'Landmine', 'it_landmine', 'Gefahren'),
  item('it_death', 'Totenkopf', 'it_death', 'Gefahren'),
  item('it_bomb', 'Bombe', 'it_bomb', 'Gefahren'),
  item('it_crack_s', 'Riss', 'it_crack_abyss', 'Gefahren'),
  item('it_crack_m', 'Riss, mittel', 'it_crack_abyss', 'Gefahren', { frame: 1 }),
  item('it_crack_l', 'Riss, groß', 'it_crack_abyss', 'Gefahren', { frame: 2 }),
  item('it_bomb_white', 'Bombe weiß', 'it_bomb', 'Gefahren', { frame: [1, 0] }),
  stone('Gefahren', 'st_thief', 'Dieb', 'st_bluegray', { badge: '✋' }),

  item('it_extralife', 'Extraleben'),
  item('it_hammer', 'Hammer'),
  item('it_umbrella', 'Schirm'),
  item('it_spring', 'Feder'),
  item('it_magicwand', 'Zauberstab'),
  item('it_dynamite', 'Dynamit'),
  item('it_seed', 'Samen'),
  item('it_coin_m', 'Münze', 'it_coin_m'),
  item('it_key', 'Schlüssel'),
  item('it_wrench', 'Schraubenschlüssel'),
  item('it_sword', 'Schwert'),
  item('it_ring', 'Ring'),
  item('it_spoon', 'Löffel'),
  item('it_floppy', 'Diskette'),
  item('it_cherry', 'Kirsche'),
  item('it_banana', 'Banane'),
  item('it_brush', 'Pinsel'),
  item('it_spade', 'Spaten'),
  item('it_coffee', 'Kaffee'),
  item('it_glasses', 'Brille'),
  item('it_flag_black', 'Fahne', 'it_flag_black'),
  item('it_springboard', 'Sprungbrett'),
  item('it_spring_keep', 'Feder, bleibt', 'it_spring', 'Gegenstände', { badge: '∞' }),
  item('it_spring_drop', 'Feder, fällt ab', 'it_spring', 'Gegenstände', { badge: '↓' }),
  item('it_yinyang', 'Yin-Yang'),
  item('it_magnet_on', 'Magnet an', 'it_magnet_on'),
  item('it_magnet_off', 'Magnet aus', 'it_magnet_off'),
  item('it_coin_s', 'Münze, klein', 'it_coin_s'),
  item('it_coin_l', 'Münze, groß', 'it_coin_l'),
  item('it_cross', 'Kreuz'),
  item('it_document', 'Dokument', 'it_document', 'Gegenstände', { text: true }),
  item('it_shogun_s', 'Shogun-Punkt S', 'it_shogun_s'),
  item('it_shogun_m', 'Shogun-Punkt M', 'it_shogun_m'),
  item('it_shogun_l', 'Shogun-Punkt L', 'it_shogun_l'),

  item('it_meditation_hollow', 'Mulde', 'it_meditation_hollow', 'Meditation'),
  item('it_meditation_dent', 'Delle', 'it_meditation_dent', 'Meditation'),
  item('it_meditation_caldera', 'Krater', 'it_meditation_caldera', 'Meditation'),
  item('it_meditation_bump', 'Buckel', 'it_meditation_bump', 'Meditation'),
  item('it_meditation_hill', 'Hügel', 'it_meditation_hill', 'Meditation'),
  item('it_meditation_volcano', 'Vulkan', 'it_meditation_volcano', 'Meditation'),

  actor('Murmeln und Perlen', 'ac_marble_white', 'Weiße Murmel'),
  actor('Murmeln und Perlen', 'ac_pearl_white', 'Weiße Perle'),
  actor('Murmeln und Perlen', 'ac_pearl_black', 'Schwarze Perle'),

  actor('Gegner', 'ac_rotor', 'Rotor'),
  actor('Gegner', 'ac_top', 'Kreisel'),
  actor('Gegner', 'ac_bug', 'Käfer'),
  actor('Gegner', 'ac_killer', 'Killer', 'ac_pearl_white', '!'),
];

export const BY_KIND = new Map(PALETTE.map((e) => [e.kind, e]));

/** Oxyd colours (symbols) the editor offers; '?' = random pair at level start. */
export const OXYD_COLORS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
/** Oxyd looks (flavor). */
export const OXYD_FLAVORS = ['a', 'b', 'c', 'd'] as const;

/** A palette text (label, group, property, option) in the page's language; unknown texts stay as they are. */
export function paletteText(de: string): string {
  return sprache() === 'en' ? ((EN as Record<string, string>)[de] ?? de) : de;
}

/** Entries matching a search text (label or group in German or the page's language, or kind; case-insensitive). */
export function searchPalette(text: string): PaletteEntry[] {
  const q = text.trim().toLowerCase();
  if (!q) return PALETTE;
  const has = (s: string) => s.toLowerCase().includes(q) || paletteText(s).toLowerCase().includes(q);
  return PALETTE.filter((e) => has(e.label) || e.kind.includes(q) || has(e.group));
}

/** Action names a source may use (SUPPORTED_ACTIONS), with German labels (shown via paletteText). */
export const ACTIONS: [string, string][] = [
  ['', 'umschalten'],
  ['open', 'öffnen'],
  ['close', 'schließen'],
];
