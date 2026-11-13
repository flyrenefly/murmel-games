// What the editor can place: a curated list of kinds Murmel really supports (src/game/objects.ts,
// src/game/actors.ts, floors.generated.json). palette.test.ts checks every entry against the game.

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
  frame?: number;
  /** Plain stone in the map (true) or an interactive object in `objects` (false). */
  wall?: boolean;
  role?: Role;
  /** Default attributes of a new object. */
  attrs?: Record<string, string>;
}

export const GROUPS = ['Spezial', 'Böden', 'Wände', 'Bewegliche Steine', 'Schalter und Türen', 'Gefahren', 'Gegenstände', 'Gegner'] as const;

const floor = (kind: string, label: string): PaletteEntry => ({ kind, layer: 'floor', group: 'Böden', label, image: kind });
const wall = (kind: string, label: string): PaletteEntry => ({ kind, layer: 'stone', group: 'Wände', label, image: kind, wall: true });
const stone = (group: string, kind: string, label: string, image = kind, more: Partial<PaletteEntry> = {}): PaletteEntry => ({ kind, layer: 'stone', group, label, image, ...more });
const item = (kind: string, label: string, image = kind, group = 'Gegenstände'): PaletteEntry => ({ kind, layer: 'item', group, label, image });

export const PALETTE: PaletteEntry[] = [
  { kind: 'start', layer: 'start', group: 'Spezial', label: 'Murmel (Start)', image: 'ac_marble_black' },
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

  stone('Bewegliche Steine', 'st_box_wood', 'Holzkiste'),
  stone('Bewegliche Steine', 'st_box_hay', 'Heukiste'),
  stone('Bewegliche Steine', 'st_box_rock', 'Felskiste'),
  stone('Bewegliche Steine', 'st_brownie', 'Brauner Stein'),
  stone('Bewegliche Steine', 'st_granite_movable', 'Granit, schiebbar', 'st_granite'),
  stone('Bewegliche Steine', 'st_greenbrown_movable', 'Grünbraun, schiebbar', 'st_greenbrown'),
  stone('Bewegliche Steine', 'st_swap', 'Tauschstein'),
  stone('Bewegliche Steine', 'st_break_plain', 'Zerbrechlich'),

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

  stone('Gefahren', 'st_death', 'Todesstein'),
  item('it_landmine', 'Landmine', 'it_landmine', 'Gefahren'),
  item('it_death', 'Totenkopf', 'it_death', 'Gefahren'),
  item('it_bomb', 'Bombe', 'it_bomb', 'Gefahren'),
  item('it_crack_s', 'Riss', 'it_crack_abyss', 'Gefahren'),

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

  { kind: 'ac_rotor', layer: 'actor', group: 'Gegner', label: 'Rotor', image: 'ac_rotor' },
  { kind: 'ac_top', layer: 'actor', group: 'Gegner', label: 'Kreisel', image: 'ac_top' },
  { kind: 'ac_bug', layer: 'actor', group: 'Gegner', label: 'Käfer', image: 'ac_bug' },
];

export const BY_KIND = new Map(PALETTE.map((e) => [e.kind, e]));

/** Oxyd colours (symbols) the editor offers; '?' = random pair at level start. */
export const OXYD_COLORS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
/** Oxyd looks (flavor). */
export const OXYD_FLAVORS = ['a', 'b', 'c', 'd'] as const;

/** Entries matching a search text (label, kind or group, case-insensitive). */
export function searchPalette(text: string): PaletteEntry[] {
  const q = text.trim().toLowerCase();
  if (!q) return PALETTE;
  return PALETTE.filter((e) => e.label.toLowerCase().includes(q) || e.kind.includes(q) || e.group.toLowerCase().includes(q));
}

/** Action names a source may use (SUPPORTED_ACTIONS), with German labels. */
export const ACTIONS: [string, string][] = [
  ['', 'umschalten'],
  ['open', 'öffnen'],
  ['close', 'schließen'],
];
