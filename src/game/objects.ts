// Interactive Enigma objects (GPL-2.0-or-later, modelled on Enigma's src/Object.cc,
// StateObject.cc, items/Trigger.cc, stones/Switch.cc, stones/Door.cc, SimpleStones.cc):
// switches, triggers and doors that talk to each other by messages, grates,
// documents, pushable boxes (stones/BoxStone.cc, stones.cc maybe_push_stone) and
// timers (stones/TimerStone.cc), quake stones (stones/QuakeStone.cc), death stones
// (stones/DeathStone.cc), one-way stones (stones/OneWayStone.cc) and puzzle stones
// (stones/PuzzleStone.cc), wormholes (items/WormHole.cc) and impulse stones
// (stones/StoneImpulse.cc).
// Times in milliseconds, cells in tile units.

/** One object of a level file: cell, Enigma kind and attributes as text. */
export interface ObjectDef {
  x: number;
  y: number;
  k: string;
  a?: Record<string, string>;
}

export type ObjectClass = 'door' | 'switch' | 'trigger' | 'document' | 'grate' | 'box' | 'timer' | 'quake' | 'death' | 'oneway' | 'puzzle' | 'wormhole' | 'impulse' | 'meditation' | 'landmine' | 'seed' | 'boulder' | 'wand' | 'oxydref' | 'spring' | 'chameleon' | 'extralife' | 'passage' | 'yinyang' | 'swap' | 'fourswitch' | 'chess' | 'blur' | 'vortex' | 'tool' | 'actorimpulse' | 'flag' | 'springboard' | 'magnet' | 'sensor' | 'key' | 'keyswitch' | 'laser' | 'mirror' | 'crack' | 'scales' | 'bridge' | 'counter' | 'pull' | 'rotator' | 'blocker' | 'laserswitch' | 'window' | 'breakstone' | 'explosion' | 'debris' | 'dynamite' | 'bomb' | 'coin' | 'coinslot' | 'thief' | 'bag' | 'dispenser' | 'lightpassenger' | 'turnstile' | 'turnstilearm' | 'ice' | 'shogun' | 'shogundot' | 'knight' | 'deathitem' | 'puller' | 'strip' | 'burnable' | 'cross' | 'squashed' | 'polarswitch' | 'barrier' | 'magic' | 'ghost' | 'disco' | 'monoflop' | 'flash' | 'scissors' | 'rubberstone' | 'bottle' | 'portal' | 'pipe' | 'mail' | 'volcano' | 'brake' | 'flthief' | 'charge' | 'surprise' | 'trap' | 'stsurprise' | 'spitter' | 'yystone' | 'jamb' | 'floorref';

/** Items (it_*): they lie on the floor, stones can move onto them. */
const ITEM_CLASSES = new Set<ObjectClass>(['trigger', 'document', 'wormhole', 'meditation', 'landmine', 'seed', 'wand', 'spring', 'extralife', 'yinyang', 'vortex', 'tool', 'flag', 'springboard', 'magnet', 'sensor', 'key', 'crack', 'explosion', 'debris', 'dynamite', 'bomb', 'coin', 'bag', 'shogundot', 'deathitem', 'puller', 'strip', 'burnable', 'cross', 'squashed', 'bottle', 'pipe', 'surprise', 'trap']);
/** Item::actor_hit: pick-up radius (ItemTraits radius, default 0.3). */
const PICKUP_RADIUS: Partial<Record<ObjectClass, number>> = { seed: 0.2, wand: 0.3, spring: 0.3, extralife: 0.3, yinyang: 0.3, tool: 0.3, flag: 0.3, key: 0.3, dynamite: 0.3, coin: 0.3, bag: 0.3, puller: 0.3, bottle: 0.3, pipe: 0.3, surprise: 0.3 };
/** German names of inventory items for the display. */
export const ITEM_NAMES: Record<string, string> = { it_seed: 'Samen', it_seed_wood: 'Samen', it_seed_hay: 'Samen', it_seed_greenbrown: 'Samen', it_magicwand: 'Zauberstab', it_spring: 'Feder', it_spring_keep: 'Feder', it_spring_drop: 'Feder (fällt ab)', it_extralife: 'Extraleben', it_yinyang: 'Yin-Yang', it_ring: 'Ring', it_spoon: 'Löffel', it_flag: 'Fahne', it_flag_black: 'Fahne', it_flag_white: 'weiße Fahne', it_key: 'Schlüssel', it_wrench: 'Schraubenschlüssel', it_hammer: 'Hammer', it_dynamite: 'Dynamit', it_coin: 'Münze', it_coin_s: 'kleine Münze', it_coin_m: 'Münze', it_coin_l: 'große Münze', it_floppy: 'Diskette', it_sword: 'Schwert', it_umbrella: 'Schirm', it_puller: 'Zieher', it_puller_n: 'Zieher ↑', it_puller_e: 'Zieher →', it_puller_s: 'Zieher ↓', it_puller_w: 'Zieher ←', it_extinguisher: 'Feuerlöscher (voll)', it_extinguisher_full: 'Feuerlöscher (voll)', it_extinguisher_medium: 'Feuerlöscher (halb)', it_extinguisher_empty: 'Feuerlöscher (leer)', it_coffee: 'Kaffee', it_coffee_drop: 'Kaffee', it_spade: 'Spaten', it_brush: 'Pinsel', it_cherry: 'Kirsche', it_banana: 'Banane', it_bottle: 'Flasche', it_bottle_idle: 'Flasche', it_pin: 'Nadel', it_glasses: 'Brille', it_glasses_broken: 'kaputte Brille', it_brake: 'Bremse', it_bag: 'Sack', it_weight: 'Gewicht', it_surprise: 'Überraschung', it_pencil: 'Stift', it_rubberband: 'Gummiband', it_drop: 'Tropfen' };
for (const c of ['', '_w', '_s', '_sw', '_e', '_ew', '_es', '_n', '_nw', '_ns', '_ne']) ITEM_NAMES[`it_pipe${c}`] = 'Rohr';
// Keys with a code (KeySwitch "code"): it_key_<code> in the inventory
for (let i = 1; i <= 99; i++) ITEM_NAMES[`it_key_${i}`] = `Schlüssel ${i}`;

function yinyangInstant(o: GameObject): boolean {
  return o.attrs.instant !== undefined && o.attrs.instant !== '' ? truthy(o.attrs.instant) : o.kind === 'st_yinyang_instant';
}

/** CannonBall: flight time = the marble jump animation. */
const CANNON_MS = 560;

/** st_quaking: ping-pong of 4 frames, repeated, 50 ms each (one animcb cycle). */
const VOLCANO_QUAKE_MS = 16 * 50;

/** it_seed_growing: 13 frames à 120 ms (models-2d.lua), then the stone appears. */
export const SEED_GROW_FRAMES = [0, 1, 0, 2, 0, 1, 0, 3, 4, 3, 0, 3, 4];
export const SEED_GROW_MS = SEED_GROW_FRAMES.length * 120;
/** st_box_wood_growing: 3 frames à 130 ms; touching marbles shatter meanwhile (BoxStone). */
export const BOX_GROW_MS = 3 * 130;
/** Inventory::max_items. */
export const MAX_ITEMS = 12;

/** Meditation states (Meditation.cc): negative = dents that pull, positive = hills that push. */
const MEDITATION_STATE: Record<string, number> = {
  it_meditation: -2,
  it_meditation_caldera: -3,
  it_meditation_hollow: -2,
  it_meditation_dent: -1,
  it_meditation_bump: 1,
  it_meditation_hill: 2,
  it_meditation_volcano: 3,
};
const MEDITATION_KIND = ['it_meditation_caldera', 'it_meditation_hollow', 'it_meditation_dent', '', 'it_meditation_bump', 'it_meditation_hill', 'it_meditation_volcano'];
/** Image of a meditation item in state s (−3 … 3). */
export const meditationImage = (s: number): string => MEDITATION_KIND[s + 3] || 'it_meditation_hollow';
/** it_explosion: one frame of 50 ms (models-2d.lua). */
export const EXPLOSION_MS = 50;
/** Floors an explosion cannot dig into (flf_indestructible). */
const HARD_FLOORS = new Set(['fl_abyss', 'fl_water', 'fl_swamp']);

/** Face bits as in Enigma's DirectionBits. */
export const WEST = 1;
export const SOUTH = 2;
export const EAST = 4;
export const NORTH = 8;
export const ALL_FACES = 15;
/** blockAt flag: the faces are thin window panes that block from both sides (WindowStone). */
export const PANES = 16;

const FRAME_MS = 60;
/** Number of animation frames of a door opening/closing (models-2d.lua). */
const DOOR_FRAMES: Record<string, number> = { a: 2, b: 8, c: 2, d: 7 };
const SWITCH_FRAMES = 3;
/** st_quaking: 4 frames ping-pong, twice, 50 ms each. */
export const QUAKE_MS = 16 * 50;
/** st_death-anim: 3 frames à 140 ms. */
export const DEATH_MS = 3 * 140;
/** Enigma Direction numbers (WEST 0, SOUTH 1, EAST 2, NORTH 3) as face bits. */
const DIR_FACE = [1, 2, 4, 8];
const DIR_SUFFIX: Record<string, number> = { w: 0, s: 1, e: 2, n: 3 };
/** Puzzle stones: Enigma colour number of yellow ones (blue is 4). */
const PUZZLE_YELLOW = '3';
/** PuzzleStone::explodeStone: neighbours ignite after 0.2 s; it_explosion lasts 50 ms. */
const PUZZLE_FUSE_MS = 200;
export const PUZZLE_EXPLODE_MS = 50;
/** st_stoneimpulse: expanding 4 × 55 ms, shrinking 5 × 55 ms (longer on purpose, models-2d.lua). */
export const IMPULSE_EXPAND_MS = 4 * 55;
export const IMPULSE_SHRINK_MS = 5 * 55;
/** Bridge floor of a fallen puzzle (server::FallenPuzzle default). */
export const FALLEN_PUZZLE = 'fl_gray';
/** Steps in face-bit order with their bit: W, S, E, N. */
const STEPS: [number, number, number][] = [
  [-1, 0, 1],
  [0, 1, 2],
  [1, 0, 4],
  [0, -1, 8],
];
/** st_boulder<dir>a: 3 frames à 120 ms (models-2d.lua); each cycle end decides (BoulderStone::animcb). */
export const BOULDER_MS = 3 * 120;
/** Enigma directions for light: WEST 0, SOUTH 1, EAST 2, NORTH 3 (bits 1 << d). */
const L_DX = [-1, 0, 1, 0];
const L_DY = [0, 1, 0, -1];
const L_W = 1;
const L_S = 2;
const L_E = 4;
const L_N = 8;
const DIR_LETTER: Record<string, number> = { w: 0, s: 1, e: 2, n: 3 };

/** LaserStone orientation: attribute (Enigma direction) or kind suffix, default east. */
function laserDir(o: GameObject): number {
  const v = Number(o.attrs.orientation);
  if (o.attrs.orientation !== undefined && o.attrs.orientation !== '' && v >= 0 && v <= 3) return v;
  return DIR_LETTER[/^st_laser_([nesw])$/.exec(o.kind)?.[1] ?? 'e'];
}

const MIRROR_KIND = /^st_mirror(?:_(slab|triangle|sheets))?(?:_([nesw])(t?)(m?)(c?))?$/;

/** MirrorStone flags from kind and attributes (flavor, transparent, movable, counterclock). */
function mirrorFlags(o: GameObject): { triangle: boolean; pane: boolean; side: boolean; movable: boolean; counterclock: boolean } {
  const m = MIRROR_KIND.exec(o.kind);
  const flavor = o.attrs.flavor || m?.[1] || 'slab';
  const side = flavor === 'sheets';
  const flag = (a: string, def: boolean) => (o.attrs[a] !== undefined && o.attrs[a] !== '' ? truthy(o.attrs[a]) : def);
  return {
    triangle: flavor === 'triangle',
    side,
    pane: side || flag('transparent', m?.[3] === 't'),
    movable: flag('movable', m?.[4] === 'm'),
    counterclock: flag('counterclock', m?.[5] === 'c'),
  };
}

/** MirrorStone::emissionDirections: outgoing beams for the incoming beam directions. */
const MIRROR_OUT = (() => {
  const W = 1, S = 2, E = 4, N = 8;
  const e = (n: number, ea: number, s: number, w: number) => (n << 12) | (ea << 8) | (s << 4) | w;
  return [
    e(W, S, E, N), e(S, 0, N, 0), e(E, N, W, S), e(0, W, 0, E),
    e(W, N | S, W, E), e(W | E, S, N, S), e(E, W, E, N | S), e(S, N, W | E, N),
    e(W | N, S | E, E | S, N | W), e(S | N, 0, N | S, 0), e(E | N, N | E, W | S, S | W), e(0, W | E, 0, E | W),
    e(W | N, N | S | E, W | S, E | W), e(W | E | N, S | E, N | S, S | W), e(E | N, W | E, E | S, N | S | W), e(S | N, N | E, W | E | S, N | W),
    0, 0, 0, 0, 0, 0, 0, 0,
    e(W | N, S | E, E | S, N | W), e(S | N, E, N | S, W), e(E | N, N | E, W | S, S | W), e(N, W | E, S, E | W),
    0, 0, 0, 0,
  ];
})();

function mirrorOut(o: GameObject, incoming: number): number {
  const f = mirrorFlags(o);
  const cand = MIRROR_OUT[(f.side ? 16 : 0) | (f.pane ? 8 : 0) | (f.triangle ? 4 : 0) | o.state];
  let out = 0;
  if (incoming & L_N) out |= (cand >> 12) & 15;
  if (incoming & L_E) out |= (cand >> 8) & 15;
  if (incoming & L_S) out |= (cand >> 4) & 15;
  if (incoming & L_W) out |= cand & 15;
  return out;
}

/** FlagItem colour: it_flag / it_flag_black 0, it_flag_white 1. */
function flagColor(kind: string): number {
  return kind === 'it_flag_white' ? 1 : 0;
}

/** Items, and blockers while open (it_blocker); everything else in a cell is a stone. */
function isItem(o: GameObject): boolean {
  return ITEM_CLASSES.has(o.cls) || (o.cls === 'blocker' && o.blocker?.phase === 'open') || (o.cls === 'blocker' && o.blocker === undefined && o.kind.startsWith('it_'));
}

/** BlockerStone shrinking/growing: 3 frames à 60 ms. */
const BLOCKER_MS = 3 * 60;

/** WindowStone faces: from $connections (open sides) or the kind suffix (st_window = south). */
export function windowFaces(o: GameObject): number {
  if (o.attrs.$connections !== undefined && o.attrs.$connections !== '') return ALL_FACES ^ (Number(o.attrs.$connections) & ALL_FACES);
  const s = /^st_window_([nesw]+)$/.exec(o.kind)?.[1] ?? 's';
  return (s.includes('w') ? WEST : 0) | (s.includes('s') ? SOUTH : 0) | (s.includes('e') ? EAST : 0) | (s.includes('n') ? NORTH : 0);
}

/** ChargeStone: attribute charge, else +1 / -1 / 0 by kind. */
export function chargeOf(o: GameObject): number {
  const v = Number(o.attrs.charge);
  if (o.attrs.charge !== undefined && o.attrs.charge !== '' && Number.isFinite(v)) return v;
  return o.kind === 'st_charge_plus' ? 1 : o.kind === 'st_charge_minus' ? -1 : 0;
}

/** BagItem::BAGSIZE */
const BAG_SIZE = 13;
/** A bag in the inventory: "it_bag" or "it_bag:item,item…" with its contents. */
export function isBag(kind: string | undefined): boolean {
  return kind === 'it_bag' || !!kind?.startsWith('it_bag:');
}
export function bagContents(kind: string): string[] {
  const i = kind.indexOf(':');
  return i < 0 ? [] : kind.slice(i + 1).split(',').filter(Boolean);
}
function bagKind(contents: string[]): string {
  return contents.length ? `it_bag:${contents.join(',')}` : 'it_bag';
}

/** it_pipe connections as Enigma direction bits (W 1, S 2, E 4, N 8); it_pipe = ew. */
export function pipeBits(o: GameObject): number {
  const s = /^it_pipe_([nesw]+)$/.exec(o.kind)?.[1] ?? 'ew';
  return (s.includes('w') ? 1 : 0) | (s.includes('s') ? 2 : 0) | (s.includes('e') ? 4 : 0) | (s.includes('n') ? 8 : 0);
}

/** MailStone orientation (Enigma W0 S1 E2 N3) from the attribute or the kind (st_mail = north). */
export function mailDir(o: GameObject): number {
  const v = o.attrs.orientation;
  if (v !== undefined && v !== '' && Number.isInteger(Number(v))) return Number(v) & 3;
  return { w: 0, s: 1, e: 2, n: 3 }[/^st_mail_([nesw])$/.exec(o.kind)?.[1] ?? 'n'] ?? 3;
}

/** MagicStone flavor: brick, oxyda, oxydc (from the kind or the flavor attribute). */
export function magicFlavor(o: GameObject): string {
  return o.attrs.flavor || /^st_magic_(\w+)$/.exec(o.kind)?.[1] || 'brick';
}

/** GhostStone flavor: purplemarble, greenbrown, break. */
function ghostFlavor(o: GameObject): string {
  return o.attrs.flavor || /^st_ghost_(\w+)$/.exec(o.kind)?.[1] || 'purplemarble';
}

/** FlatStone / PlasterStone kinds built as break stones: flat (breakable), cracked, fire (burnable), plaster. */
const FLAT_BREAK: Record<string, string> = { st_flat_breakable: 'flat', st_flat_breaking: 'flat', st_flat_cracked: 'cracked', st_flat_burnable: 'fire', st_plaster_breakable: 'plaster' };

/** BreakStone type from the kind (st_break = plain); FlatStone/PlasterStone types from FLAT_BREAK. */
function breakType(o: GameObject): string {
  return FLAT_BREAK[o.kind] ?? /^st_break_(\w+)$/.exec(o.kind)?.[1] ?? 'plain';
}

/** Breaks with the st_flat_break animation (6 × 50 ms). */
function flatBreak(t: string): boolean {
  return t === 'laser' || t === 'bug' || t === 'flat' || t === 'cracked' || t === 'fire' || t === 'plaster';
}

function breakMs(o: GameObject): number {
  return flatBreak(breakType(o)) ? 6 * 50 : 10 * 50;
}

/** processLight breaks it: BreakStone (not bug), breakable FlatStone/PlasterStone. */
function lightBreaks(t: string): boolean {
  return t !== 'bug' && t !== 'cracked' && t !== 'fire';
}

/** "ignite" / "_explosion" break it: BreakStone (not bug), FlatStone breakable or cracked, PlasterStone breakable. */
function explosionBreaks(t: string): boolean {
  return t !== 'bug' && t !== 'fire';
}

/** DispenserStone: the item it gives. */
function dispenserItem(o: GameObject): string {
  const f = /^st_dispenser_(\w+)$/.exec(o.kind)?.[1] ?? 'bombblack';
  return f === 'bombwhite' ? 'it_bomb_white' : f === 'dynamite' ? 'it_dynamite' : f === 'extralife' ? 'it_extralife' : 'it_bomb_black';
}

/** ThiefStone emerge/retreat: 7 frames à 80 ms. */
const THIEF_MS = 7 * 80;

/** CoinSlot insert animation: 18 frames à 20 ms. */
const COIN_INSERT_MS = 18 * 20;

/** Items an explosion leaves alone (itf_indestructible) – the others are destroyed. */
const INDESTRUCTIBLE = new Set<ObjectClass>(['sensor', 'magnet', 'wormhole', 'vortex', 'springboard', 'trigger', 'meditation', 'debris', 'key']);

/** StripItem connections: $connections or the kind suffix. */
export function stripConnections(o: GameObject): number {
  if (o.attrs.$connections !== undefined && o.attrs.$connections !== '') return Number(o.attrs.$connections) & ALL_FACES;
  const s = /^it_strip_([nesw]+)$/.exec(o.kind)?.[1] ?? '';
  return (s.includes('w') ? WEST : 0) | (s.includes('s') ? SOUTH : 0) | (s.includes('e') ? EAST : 0) | (s.includes('n') ? NORTH : 0);
}

/** it_burnable_ignited / _burning: 8 frames à 100 ms (models-2d.lua), then Floor::on_burnable_animcb. */
const FIRE_MS = 8 * 100;
/** Floor heating animation (fl_ice/fl_water/fl_swamp_heating): 8 frames à 240 ms. */
const HEATING_MS = 8 * 240;
/** Floors that burn by default (objects.xml: burnable default true). */
const BURNABLE_FLOORS = /^fl_(adhesionless|aquamarine|bast|bluegray|bluegreen|blueslab|hay|ivory|lawn|plank|platinum|red|redslab|rough|samba|tigris|wood|bridge_bw)/;
/** Floors that leave no ash (objects.xml: noash default true). */
const NOASH_FLOORS = /^fl_(abyss|bridge|ice|swamp|water)/;
/** $firetransform: the floor after it burnt. */
function fireTransform(floor: string): string {
  if (/^fl_(bast|bridge|plank|samba|wood)/.test(floor)) return 'fl_abyss';
  if (/^fl_(lawn|swamp)/.test(floor)) return 'fl_dunes';
  if (floor.startsWith('fl_ice')) return 'fl_water';
  if (floor.startsWith('fl_water')) return 'fl_swamp';
  return '';
}
/** $heattransform: the floor after fire next to it (heating animation). */
function heatTransform(floor: string): string {
  if (floor.startsWith('fl_ice')) return 'fl_water';
  if (floor.startsWith('fl_water')) return 'fl_swamp';
  if (floor.startsWith('fl_swamp')) return 'fl_dunes';
  return '';
}
/** BurnableItem state from the kind (it_burnable = invisible). */
export function burnState(o: GameObject): string {
  return /^it_burnable_(\w+)$/.exec(o.kind)?.[1] ?? 'invisible';
}
/** Items with itf_fireproof (fire does not replace them). */
const FIREPROOF_CLASSES = new Set<ObjectClass>(['dynamite', 'bomb', 'crack', 'meditation', 'debris', 'explosion', 'vortex']);
type FireFlags = { message: boolean; first: boolean; last: boolean };

/** RotatorStone: one turn of the animation (8 × 70 ms). */
const ROTATOR_TURN_MS = 8 * 70;

/** RotatorStone movable (kind _movable or attribute). */
function rotatorMovable(o: GameObject): boolean {
  return o.attrs.movable !== undefined && o.attrs.movable !== '' ? truthy(o.attrs.movable) : o.kind.endsWith('_movable');
}

/** it_crack_*_anim: 5 frames à 120 ms. */
const CRACK_DISSOLVE_MS = 5 * 120;

/** server::BumperForce and the PingPong frames of st_actorimpulse_anim. */
const BUMPER_FORCE = 200;
const BUMPER_FRAMES = [0, 1, 2, 2, 1, 0];
/** ChessStone: knight move when rolling sideways faster than this; animations 5 × 120 ms. */
const CHESS_HIT = 1.5;
const CHESS_ANIM_MS = 5 * 120;
/** SwapStone: GameTimer alarm after 0.1 s ends the exchange. */
export const SWAP_MS = 100;
/** World::GetPushDirection: speed into a stone face needed to push it (tiles/s). */
export const PUSH_SPEED = 4;
/** Floors a box sinks into, becoming a floor itself (BoxStone::maybe_fall_or_stopfire). */
const SINK_FLOORS = new Set(['fl_abyss', 'fl_water', 'fl_swamp']);

/** What the objects need to know about the level around them. */
export interface ObjectEnv {
  /** A fixed stone (wall, Oxyd stone) or the level border is at this cell. */
  stoneAt(col: number, row: number): boolean;
  floorAt(col: number, row: number): string;
  setFloor(col: number, row: number, kind: string): void;
  /** Plain stone of the map in a cell (null = none; 'st_oxyd' for Oxyd stones). */
  staticStone?(col: number, row: number): string | null;
  /** Change the plain stone of a cell (st_swap exchanging places with a wall). */
  setStaticStone?(col: number, row: number, kind: string | null, hollow?: boolean): void;
  /** The plain stone of a cell lets laser light through (Stone::is_transparent: glass, hollow). */
  transparentAt?(col: number, row: number): boolean;
  /** A fire attribute of the cell's floor (burnable, secure, eternal, noash, fastfire, ignitable), if set. */
  floorAttr?(col: number, row: number, key: string): string | undefined;
  /** Cells whose floor floods at the level start (fl_water_source, FloodStream FLOODING). */
  floodSources?(): [number, number][];
}

const NO_ENV: ObjectEnv = { stoneAt: () => false, floorAt: () => 'fl_gray', setFloor: () => {} };

/**
 * Old levels (Enigma compatibility < 1.10, API 1) use other message names; Enigma
 * translates them per receiving class (api1init.lua MessageRenaming).
 */
const API1_RENAMING: Record<string, string> = {
  // api1init.lua MessageRenaming, by Murmel object class
  bridge__openclose: 'toggle',
  bridge__signal: 'toggle',
  blocker__trigger: 'toggle',
  blocker__openclose: 'toggle',
  burnable__trigger: 'ignite',
  magnet__onoff: 'toggle',
  meditation__trigger: 'flip',
  vortex__openclose: 'toggle',
  vortex__trigger: 'toggle',
  wormhole__onoff: 'toggle',
  boulder__direction: 'orientate',
  door__openclose: 'toggle',
  fourswitch__trigger: 'toggle',
  keyswitch__onoff: 'toggle',
  laser__onoff: 'toggle',
  lightpassenger__trigger: 'toggle',
  lightpassenger__onoff: 'toggle',
  mirror__trigger: 'turn',
  oneway__direction: 'orientate',
  oxydref__trigger: 'open',
  passage__trigger: 'signal',
  polarswitch__onoff: 'toggle',
  quake__trigger: 'toggle',
  impulse__trigger: 'signal',
  switch__onoff: 'toggle',
  volcano__trigger: 'toggle',
};

export interface GameObject {
  /** Enigma object id ("$id"), referenced as "#id". */
  id: string;
  name: string;
  kind: string;
  cls: ObjectClass;
  col: number;
  row: number;
  /** External state: door 1 = open, switch 1 = on, trigger 1 = pressed. */
  state: number;
  /** Running animation towards state `to`, started at `since`, `dur` ms long. */
  moving: { to: number; since: number; dur: number } | null;
  attrs: Record<string, string>;
  /** Picked up (documents) or sunk into the floor (boxes). */
  gone: boolean;
  /** Timer: time of the next alarm (ms), and the value it will send. */
  alarm?: { at: number; value: boolean };
  /** Puzzle stone: 'pending' (cluster about to explode), 'ignited' (explodes at `fuse`), 'exploding'. */
  puzzle?: 'pending' | 'ignited' | 'exploding';
  fuse?: number;
  /** Wormhole: teleport disabled until this time (attribute interval). */
  engagedUntil?: number;
  /** Impulse stone: phase and the Enigma direction the impulse came from (-1 = none). */
  impulse?: { phase: 'expanding' | 'shrinking'; incoming: number };
  /** Landmine: exploding since this time (it_explosion_hollow). */
  exploding?: number;
  /** Boulder (BoulderStone): phase and start of the current animation cycle. */
  boulder?: { phase: 'init' | 'idle' | 'active' | 'falling'; since: number };
  /** st_spitter: its phase, since when, and the velocity of the ball it loads. */
  spit?: { phase: 'active' | 'loading' | 'spitting' | 'breaking'; since: number; vx: number; vy: number };
  /** st_monoflop: when it switches off again. */
  alarmAt?: number;
  /** st_laserflop: held on by laser light. */
  lasered?: boolean;
  /** it_cross: an actor inside (last seen), and when the alarm rings. */
  cross?: { seen: number; inside: boolean; at: number };
  /** Explosion, debris, burning dynamite or bomb: start of its animation. */
  blast?: number;
  /** Bomb hit by a stone: explodes at this time (Bomb::ignite, 0.01 s). */
  igniteAt?: number;
  /** Turnstile pivot: start of the last rotation (60 ms animation). */
  pivotTurn?: number;
  /** Light passenger: next move time, skate direction (-1 none), blocked, blinking, breaking start. */
  pass?: { next: number; dir: number; blocked: boolean; blink: boolean; breaking?: number };
  /** Thief: phase (none = idle), its start, the marble robbed and the loot in its bag. */
  thief?: { phase?: 'emerge' | 'retreat' | 'capture'; since?: number; victim?: number; loot: string[] };
  /** fl_thief: marbles on the floor in the last step (actor_enter). */
  inside?: number[];
  /** Bag (it_bag): the items it holds. */
  loot?: string[];
  /** Coin slot: inserting since, time bought until, seconds waiting to be added after the insert. */
  slot?: { inserting?: number; until: number; add: number };
  /** BreakStone: start of BREAKING (removed after the animation). */
  breaking?: number;
  /** Blocker: stone (solid, shrinking, growing) or item (open, with its lock state). */
  blocker?: { phase: 'solid' | 'shrinking' | 'growing' | 'open'; since: number; lock: 'idle' | 'new' | 'locked' | 'unlocked'; stone?: GameObject | null };
  /** Rotator: start of the current turn, and the neighbours remembered for its impulses. */
  rotor?: { since: number; alarm?: number; neighbors?: (GameObject | null)[] };
  /** Bridge floor: phase, its start and whether it was closed explicitly (OBJBIT_EXPLICIT). */
  bridge?: { phase: 'open' | 'closed' | 'opening' | 'closing'; since: number; explicit: boolean };
  /** Scales and shogun dots: checked once (the initial state acts not). */
  scales?: boolean;
  /** Crack: start of DISSOLVING (the floor breaks away after 5 × 120 ms). */
  dissolving?: number;
  /** Springboard: start of its animation (it_springboard_anim). */
  bounce?: number;
  /** Meditation: the pearl resting in it and since when (-1 = engaged after 1 s). */
  meditatist?: { marble: number; since: number };
  /** ActorImpulseStone: start of the PULSING animation (idle when unset or over). */
  pulse?: number;
  /** Vortex: phase, its start, the swallowed marble, destination index and target vortex. */
  vortex?: { phase: 'open' | 'closed' | 'opening' | 'closing' | 'swallowing' | 'warping' | 'emitting'; since: number; marble?: number; idx?: number; target?: GameObject };
  /** Chess stone (ChessStone): phase, its start and the knight's destination. */
  chess?: { phase: 'idle' | 'disappearing' | 'appearing' | 'capturing' | 'captured' | 'falling' | 'sinking'; since: number; dest?: [number, number] };
  /** Four switch: has turned before (FourSwitch::m_inactive_so_far is false). */
  turned?: boolean;
  /** Swap stone: moved at this time in this Enigma direction (0.1 s animation). */
  swapped?: { since: number; dir: number };
  /** Seed: growing since this time; box: grown from a seed, growing since this time. */
  growing?: number;
}

export type ObjectEvent =
  | { type: 'text'; text: string }
  /** An inventory changed outside a pick-up (key switch). */
  | { type: 'items' }
  /** PullStone: actors in the stone's new cell are warped into its old cell. */
  | { type: 'pullWarp'; fromCol: number; fromRow: number; toCol: number; toRow: number }
  /** TurnstilePivot rotated: main moves (or shatters) the marbles in the swept fields. */
  | { type: 'turnstile'; col: number; row: number; cw: boolean; red: boolean; sender: number; seen: boolean[] }
  /** LaserBeam::actor_hit → "_laserhit": marble i shatters. */
  | { type: 'laserhit'; marble: number }
  /** YinyangStone::switchPlayer: the other marble is steered. */
  | { type: 'swapPlayer' }
  /** FlashStone::actor_hit: the other marble gets this force. */
  | { type: 'flash'; marble: number; fx: number; fy: number }
  /** ChargeStone::actor_hit: the marble takes the stone's charge. */
  | { type: 'charge'; marble: number; charge: number }
  /** ScissorsStone::actor_hit: the marble's bands snap; if any did, the stone performs its action (col/row). */
  | { type: 'scissors'; marble: number; col: number; row: number }
  /** RubberbandStone::actor_hit: a band from the marble to this stone (scissor: others snap first). */
  | { type: 'rubberband'; marble: number; col: number; row: number; scissor: boolean; strength?: number; length?: number; threshold?: number; max?: number }
  /** Debris::actor_hit → "_fall": marble i falls. */
  | { type: 'fall'; marble: number }
  /** marble: index of the marble that shatters. */
  | { type: 'shatter'; marble: number }
  | { type: 'floor'; col: number; row: number }
  | { type: 'quake' }
  /** Springboard: marble i jumps ("_jump"). */
  | { type: 'jump'; marble: number }
  /** A vortex swallowed marble i (BasicBall FALLING_VORTEX). */
  | { type: 'vortexGrab'; marble: number }
  /** A vortex gives marble i out at x/y; cut = scissor (its rubber bands snap); rise = out of a vortex (it jumps). */
  | { type: 'vortexWarp'; marble: number; x: number; y: number; cut: boolean; rise: boolean }
  /** A message to a named Oxyd stone (open, close, toggle, signal, shuffle, closeall …). */
  | { type: 'oxydMsg'; col: number; row: number; msg: string; value: boolean }
  /** A stone triggered the Oxyd stone in this cell (OxydStone "_trigger" → tryOpen). */
  | { type: 'oxyd'; col: number; row: number }
  | { type: 'sound'; name: 'switch' | 'door' | 'triggerdown' | 'triggerup' | 'pickup' | 'move' | 'explode' | 'fakeoxyd' | 'landmine' | 'mirror' | 'laser' | 'glass' | 'bomb' };

export function objectClass(kind: string): ObjectClass | null {
  if (/^st_door(_[abcd])?(_ew)?(_open)?$/.test(kind)) return 'door';
  if (/^st_switch(_black|_white)?(_instant)?$/.test(kind)) return 'switch';
  if (kind === 'it_trigger') return 'trigger';
  if (kind === 'it_document') return 'document';
  if (/^st_grate(_cross|_framed)?$/.test(kind)) return 'grate';
  if (/^st_box(_wood(_[hv])?|_hay|_rock)?$/.test(kind)) return 'box';
  if (MOVABLE_STONE.test(kind)) return 'box'; // pushed like a box, but does not sink
  if (kind === 'st_timer' || kind === 'ot_timer') return 'timer'; // ot_timer: TimerGadget, no cell
  if (kind === 'st_quake' || kind === 'st_fake_quake') return 'quake';
  if (kind in MEDITATION_STATE) return 'meditation';
  if (kind === 'it_landmine') return 'landmine';
  if (/^st_boulder(_[nesw])?$/.test(kind)) return 'boulder';
  if (kind === 'it_seed' || kind === 'it_seed_wood' || kind === 'it_seed_hay' || kind === 'it_seed_greenbrown' || kind === 'it_seed_volcano') return 'seed';
  if (/^st_volcano(_idle|_active|_new|_growing)?$/.test(kind)) return 'volcano';
  if (kind === 'it_magicwand') return 'wand';
  if (kind === 'it_extralife') return 'extralife';
  if (kind === 'it_yinyang') return 'yinyang';
  // Plain inventory items whose use main.ts handles (Ring, Spoon)
  if (kind === 'it_ring' || kind === 'it_spoon' || kind === 'it_wrench' || kind === 'it_hammer' || kind === 'it_floppy' || kind === 'it_sword' || kind === 'it_umbrella') return 'tool';
  if (kind === 'it_death') return 'deathitem';
  if (/^it_burnable(_invisible|_oil|_ignited|_burning|_ash|_fireproof)?$/.test(kind)) return 'burnable';
  if (/^it_extinguisher(_full|_medium|_empty)?$/.test(kind)) return 'tool';
  if (/^it_(coffee|coffee_drop|spade|brush|cherry|banana|pin|glasses|glasses_broken|weight|pencil|rubberband|drop)$/.test(kind)) return 'tool';
  if (/^it_bottle(_idle|_broken)?$/.test(kind)) return 'bottle';
  if (kind === 'it_cross') return 'cross';
  if (kind === 'it_squashed') return 'squashed';
  if (/^it_strip(_[nesw]+)?$/.test(kind)) return 'strip';
  if (/^it_puller(_[nesw])?$/.test(kind)) return 'puller';
  if (/^st_actorimpulse(_invisible)?$/.test(kind)) return 'actorimpulse';
  if (/^it_flag(_black|_white)?$/.test(kind)) return 'flag';
  if (kind === 'it_springboard') return 'springboard';
  if (/^it_magnet(_on|_off)?$/.test(kind)) return 'magnet';
  if (/^it_sensor(_inverse|_exit|_filter[01])?$/.test(kind)) return 'sensor';
  if (/^it_key(_\d+)?$/.test(kind)) return 'key';
  if (kind === 'st_key' || kind === 'st_floppy') return 'keyswitch';
  if (/^st_laser(_[nesw])?$/.test(kind)) return 'laser';
  if (/^it_crack(_[isml])?(_water)?$/.test(kind)) return 'crack';
  if (kind === 'fl_scales') return 'scales';
  if (kind === 'fl_bridge') return 'bridge';
  if (kind === 'ot_counter') return 'counter';
  if (kind === 'st_pull') return 'pull';
  if (kind === 'st_laserswitch') return 'laserswitch';
  if (/^st_window(_[nesw]+)?$/.test(kind)) return 'window';
  if (/^st_break(_plain|_black|_white|_oxydc|_boulder|_bug|_laser)?$/.test(kind)) return 'breakstone';
  if (FLAT_BREAK[kind]) return 'breakstone';
  if (/^it_explosion_(nil|hollow|crack|debris)$/.test(kind)) return 'explosion';
  if (kind === 'it_debris' || kind === 'it_debris_water') return 'debris';
  if (kind === 'it_dynamite' || kind === 'it_dynamite_burning') return 'dynamite';
  if (/^it_bomb(_black|_white)?(_burning)?$/.test(kind)) return 'bomb';
  if (/^it_coin(_s|_m|_l)?$/.test(kind)) return 'coin';
  if (kind === 'st_thief') return 'thief';
  if (kind === 'fl_thief') return 'flthief';
  if (kind === 'it_surprise') return 'surprise';
  if (kind === 'st_surprise') return 'stsurprise';
  if (kind === 'st_spitter') return 'spitter';
  if (kind === 'fl_ref') return 'floorref';
  if (/^st_jamb(_black|_white)?$/.test(kind)) return 'jamb';
  if (/^st_yinyang(_instant|_active|_inactive)?$/.test(kind)) return 'yystone';
  if (kind === 'it_trap') return 'trap';
  if (/^st_charge(_plus|_minus|_zero)?$/.test(kind)) return 'charge';
  if (kind === 'st_ice') return 'ice';
  if (kind === 'st_polarswitch') return 'polarswitch';
  if (kind === 'st_barrier') return 'barrier';
  if (/^st_magic(_brick|_oxyda|_oxydc)?$/.test(kind)) return 'magic';
  if (/^st_ghost(_purplemarble|_greenbrown|_break)?$/.test(kind)) return 'ghost';
  if (/^st_disco(_light|_medium|_dark)?$/.test(kind)) return 'disco';
  if (kind === 'st_monoflop' || kind === 'st_laserflop' || kind === 'st_laserflop_on') return 'monoflop';
  if (kind === 'st_flash') return 'flash';
  if (kind === 'st_scissors') return 'scissors';
  if (/^st_portal(_horse|_pearl|_glass)?$/.test(kind)) return 'portal';
  if (/^it_pipe(_[nesw]{1,2})?$/.test(kind)) return 'pipe';
  if (/^st_mail(_[nesw])?$/.test(kind)) return 'mail';
  if (kind === 'st_brake' || kind === 'it_brake') return 'brake';
  if (kind === 'st_rubberband') return 'rubberstone';
  if (kind === 'st_knight') return 'knight';
  if (/^st_shogun(_s|_m|_sm|_l|_sl|_ml|_sml)?$/.test(kind)) return 'shogun';
  if (/^it_shogun(_s|_m|_l)?$/.test(kind)) return 'shogundot';
  if (/^st_turnstile(_red|_green)?$/.test(kind)) return 'turnstile';
  if (/^st_turnstilearm(_[nesw])?$/.test(kind)) return 'turnstilearm';
  if (/^st_lightpassenger(_on|_off)?$/.test(kind)) return 'lightpassenger';
  if (/^st_dispenser(_bombblack|_bombwhite|_dynamite|_extralife)?$/.test(kind)) return 'dispenser';
  if (kind === 'it_bag') return 'bag';
  if (kind === 'st_coinslot' || kind === 'st_coinslot_instant') return 'coinslot';
  if (/^(st|it)_blocker(_new)?$/.test(kind)) return 'blocker';
  if (/^st_rotator(_cw|_ccw)?(_movable)?$/.test(kind)) return 'rotator';
  if (MIRROR_KIND.test(kind)) return 'mirror';
  if (kind === 'st_swap') return 'swap';
  if (kind === 'st_fourswitch') return 'fourswitch';
  if (/^it_vortex(_open|_closed)?$/.test(kind)) return 'vortex';
  if (/^st_blur(_straight|_cross|_magic)?$/.test(kind)) return 'blur';
  if (/^st_chess(_black|_white)?$/.test(kind)) return 'chess';
  // ChameleonStone: looks like the floor, actors pass (STONE_PASS), other stones do not
  if (kind === 'st_chameleon') return 'chameleon';
  if (PASSAGE.test(kind)) return 'passage';
  if (/^it_spring(_keep|_drop)?$/.test(kind)) return 'spring';
  // A named Oxyd stone as message target; the stone itself is part of the level map.
  if (kind === 'st_oxyd_ref') return 'oxydref';
  if (kind === 'st_death' || kind === 'st_death_invisible' || kind === 'st_death_movable') return 'death';
  if (/^st_oneway(_black|_white)?(_[nesw])?$/.test(kind)) return 'oneway';
  if (/^st_puzzle(_blue|_yellow)?$/.test(kind)) return 'puzzle';
  if (/^it_wormhole(_on|_off)?$/.test(kind)) return 'wormhole';
  if (kind === 'st_stoneimpulse' || kind === 'st_stoneimpulse_hollow' || kind === 'st_stoneimpulse_movable') return 'impulse';
  return null;
}

/**
 * Plain stones that move like a wood box (StandardStone/GlassStone with MOVABLE_STANDARD):
 * st_brownie and the _movable variants. Unlike BoxStone they do not sink or build bridges.
 */
export const MOVABLE_STONE = /^st_(brownie|plop|(granite|camouflage|redbrown|greenbrown|invisible|rawglass|lightglass|darkglass|flat|plaster)_movable)$/;

/** Image and shadow of a movable plain stone (models-2d.lua); invisible ones draw nothing. */
export function movableLook(kind: string): { image: string; shadow: string } | null {
  if (kind === 'st_invisible_movable') return null;
  if (kind === 'st_brownie') return { image: 'st_brownie', shadow: 'sh_round' };
  if (kind === 'st_plop') return { image: 'st_plop_slate', shadow: 'sh_solid' }; // DefStone st_plop_slate
  const image = kind.replace(/_movable$/, '');
  return { image, shadow: /glass$/.test(image) ? 'sh_rawglass' : 'sh_solid' };
}

/** A hollow puzzle stone (OBJBIT_HOLLOW, exported as $hollow): the marble passes through it. */
export const isHollow = (o: GameObject): boolean => o.attrs.$hollow === 'true';

/** PassageStone: st_passage[_black|_white][_square|_slash|_cross|_frame|_backslash]. */
const PASSAGE = /^st_passage(_black|_white)?(_square|_slash|_cross|_frame|_backslash)?$/;
/** Image and shadow of a passage stone (state 0 black, 1 white; models-2d.lua). */
export function passageLook(o: GameObject): { image: string; shadow: string } {
  const flavor = o.attrs.flavor || o.attrs.$flavor || PASSAGE.exec(o.kind)?.[2]?.slice(1) || 'square';
  return { image: `st_passage_${o.state === 1 ? 'white' : 'black'}_${flavor}`, shadow: flavor === 'square' ? 'sh_round' : `sh_passage_${flavor}` };
}

/** Messages the objects understand (others need Lua or unsupported objects). */
export const SUPPORTED_ACTIONS = new Set(['', 'toggle', 'signal', 'open', 'on', 'close', 'off', 'nop', 'grow']);

const truthy = (v: string | undefined): boolean => v === 'true' || (v !== undefined && v !== '' && v !== 'false' && v !== '0');

export function splitTokens(v: string | undefined): string[] {
  return (v ?? '').split(/[;,]/).map((t) => t.trim()).filter((t) => t !== '');
}

export class ObjectWorld {
  readonly objects: GameObject[] = [];
  /** player::InhibitPickup: while a mouse button (or the drop key) is held, the current player picks up nothing. */
  inhibitPickup = false;
  /** Respawn position set by a dropped flag, per marble colour (black 0, white 1). */
  readonly flagRespawn: ({ x: number; y: number } | undefined)[] = [undefined, undefined];
  readonly events: ObjectEvent[] = [];
  private readonly byCell = new Map<number, GameObject[]>();
  private now = 0;
  /** Lua function as action target (Object::performAction → lua::CallFunc). */
  onCallback: ((fn: string, value: boolean | number, sender: GameObject) => void) | null = null;
  /** wo["FallenPuzzle"]: floor that a sunk puzzle stone leaves. */
  fallenPuzzle = FALLEN_PUZZLE;
  /** Inventory of the player (item kinds, first = used by a click; Inventory::add_item inserts in front). */
  readonly inventories: string[][] = [[], []];
  /** The current player (YIN 0, YANG 1): player::CurrentPlayer. */
  player = 0;
  /** Owner of a marble (actor owner attribute): items it picks up go to that inventory. */
  ownerOf: (marble: number) => number = () => 0;
  /** Marble i is a pearl (ac_pearl_*): a meditatist for the meditation hollows. */
  isPearl: (marble: number) => boolean = () => false;
  /** The current player's inventory. */
  get inventory(): string[] {
    return this.inventories[this.player];
  }
  private nextId = 0;
  /** Cell of each marble's centre (-1 = gone); init = false until its first marbleAt. */
  private marbles: { col: number; row: number; init: boolean }[] = [];

  constructor(
    defs: readonly ObjectDef[],
    readonly width: number,
    /** Localised texts of documents (key → text). */
    private readonly texts: Record<string, string> = {},
    private readonly env: ObjectEnv = NO_ENV,
    private readonly random: () => number = Math.random,
    /** Enigma compatibility version of the level (API 1 below 1.10). */
    private readonly compat = 1.1,
  ) {
    for (const d of defs) {
      const cls = objectClass(d.k);
      if (!cls) continue;
      const a = d.a ?? {};
      const o: GameObject = {
        id: a.$id ?? '',
        name: a.name ?? '',
        kind: d.k,
        cls,
        col: d.x,
        row: d.y,
        state: initialState(d.k, a),
        moving: null,
        attrs: a,
        gone: false,
      };
      // Enigma clones a wood box as one of two grain directions (BoxStone::clone).
      if (o.kind === 'st_box_wood') o.kind = this.random() < 0.5 ? 'st_box_wood_h' : 'st_box_wood_v';
      this.objects.push(o);
      this.place(o);
      if (o.cls === 'timer' && o.state === 1) this.startTimer(o);
    }
  }

  /** TimerStone::updateAlarm: next alarm after `interval` seconds, first value true. */
  private startTimer(o: GameObject): void {
    o.alarm = { at: this.now + timerInterval(o), value: true };
  }

  private place(o: GameObject): void {
    if (o.col < 0 || o.cls === 'oxydref' || o.cls === 'scales' || o.cls === 'bridge' || o.cls === 'flthief' || o.cls === 'floorref') return; // other objects (ot_timer) have no cell; Oxyd stones and scales are map cells
    const key = o.row * this.width + o.col;
    const list = this.byCell.get(key);
    if (list) list.push(o);
    else this.byCell.set(key, [o]);
  }

  private unplace(o: GameObject): void {
    if (o.col < 0 || o.cls === 'oxydref' || o.cls === 'scales' || o.cls === 'bridge' || o.cls === 'flthief' || o.cls === 'floorref') return;
    const key = o.row * this.width + o.col;
    const list = (this.byCell.get(key) ?? []).filter((x) => x !== o);
    if (list.length) this.byCell.set(key, list);
    else this.byCell.delete(key);
  }

  /** A stone (fixed or object) occupies the cell. */
  private stoneAt(col: number, row: number): boolean {
    if (this.env.stoneAt(col, row)) return true;
    return this.at(col, row).some((o) => !o.gone && !isItem(o));
  }

  private at(col: number, row: number): GameObject[] {
    return this.byCell.get(row * this.width + col) ?? [];
  }

  /**
   * Which faces of a cell block the marble: 0 = free, ALL_FACES = solid,
   * otherwise the face bits (door d).
   */
  blockAt(col: number, row: number, color = 2, invisible = false, by = -1, shielded = false, actor = ''): number {
    for (const o of this.at(col, row)) {
      // PortalStone::collision_response: only its actor passes (horse; pearl: the white pearl)
      if (o.cls === 'portal' && !o.gone) {
        const f = o.attrs.flavor || /^st_portal_(\w+)$/.exec(o.kind)?.[1] || 'horse';
        if ((f === 'horse' && actor === 'horse') || (f === 'pearl' && actor === 'pearl_white')) continue;
        return ALL_FACES;
      }
      // VolcanoStone::collision_response: a new one (still a seed) lets actors pass
      if (o.cls === 'volcano' && !o.gone) {
        if (o.state === 2) continue;
        return ALL_FACES;
      }
      if ((o.cls === 'magic' || o.cls === 'ghost' || o.cls === 'monoflop' || o.cls === 'flash' || o.cls === 'scissors' || o.cls === 'rubberstone' || o.cls === 'mail' || o.cls === 'charge' || o.cls === 'stsurprise' || o.cls === 'spitter' || o.cls === 'yystone' || o.cls === 'jamb') && !o.gone) return ALL_FACES;
      // PolarSwitchStone::collision_response: invisible actors pass
      if (o.cls === 'polarswitch' && !o.gone) {
        if (invisible) continue;
        return ALL_FACES;
      }
      // BarrierStone::collision_response: rebounds actors carrying its item (all: any item), else they pass
      if (o.cls === 'barrier' && !o.gone) {
        const f = o.attrs.flavor || 'all';
        if (f === 'it_drop' && actor === 'rotor') return ALL_FACES;
        if (by < 0) continue;
        const inv = this.inventories[this.ownerOf(by)] ?? this.inventory;
        const holds = f === 'all' ? inv.length > 0 : inv.some((k) => k === f || k.startsWith(f + '_')) || (f === 'it_umbrella' && shielded) || (f === 'it_cherry' && invisible) || (f === 'it_drop' && actor === 'rotor');
        if (holds) return ALL_FACES;
        continue;
      }
      // invisible actors pass blue windows (WindowStone) and raw glass (GlassStone, not light/dark movable)
      if (invisible && ((o.cls === 'window' && !truthy(o.attrs.secure)) || o.kind === 'st_rawglass_movable')) continue;
      if (o.cls === 'door') {
        if (o.state === 1 && !o.moving) continue;
        return doorFaces(o);
      }
      if (o.cls === 'switch' || o.cls === 'timer' || o.cls === 'quake' || o.cls === 'death' || o.cls === 'boulder' || o.cls === 'swap' || o.cls === 'pull' || o.cls === 'rotator' || o.cls === 'fourswitch' || o.cls === 'chess' || o.cls === 'blur' || o.cls === 'actorimpulse' || o.cls === 'keyswitch' || o.cls === 'laser' || o.cls === 'mirror' || o.cls === 'laserswitch' || o.cls === 'breakstone' || o.cls === 'coinslot' || o.cls === 'thief' || o.cls === 'dispenser' || o.cls === 'lightpassenger' || o.cls === 'turnstile' || o.cls === 'turnstilearm' || o.cls === 'ice' || o.cls === 'shogun' || (o.cls === 'knight' && o.state < 4) || (o.cls === 'blocker' && (o.blocker ? o.blocker.phase === 'solid' || o.blocker.phase === 'growing' : !o.kind.startsWith('it_'))) || (o.cls === 'box' && !o.gone)) return ALL_FACES;
      if (o.cls === 'oneway') return onewayFaces(o);
      if (o.cls === 'window' && !o.gone) return windowFaces(o) | PANES;
      // PassageStone::collision_response: only an actor of the stone's colour passes.
      if (o.cls === 'passage') {
        if (color !== o.state) return ALL_FACES;
        continue;
      }
      // PuzzleStone::collision_response: exploding stones let the marble pass.
      // PuzzleStone::collision_response: hollow or exploding stones let the marble pass.
      if (o.cls === 'puzzle' && !o.gone && o.puzzle !== 'exploding' && !isHollow(o)) return ALL_FACES;
      // StoneImpulse::collision_response: a hollow one only blocks while it is active.
      if (o.cls === 'impulse' && (o.kind !== 'st_stoneimpulse_hollow' || o.impulse)) return ALL_FACES;
    }
    return 0;
  }

  /**
   * The marble hit the stone in this cell. color: 0 = black marble, 1 = white.
   * nx/ny: contact normal (stone → marble), vn: marble speed along it (negative = into the stone).
   */
  hit(col: number, row: number, color = 0, nx = 0, ny = 0, vn = 0, vx = 0, vy = 0, by = -1): void {
    for (const o of [...this.at(col, row)]) {
      if (o.cls === 'yystone') {
        // YinyangStone::actor_hit: an idle one turns (6 × 140 ms), then switches the player (instant: at once)
        if (o.state === 0) this.yinyangActivate(o);
        return;
      }
      if (o.cls === 'spitter') {
        // SpitterStone::actor_hit: an extra life in the inventory loads a cannonball with the actor's
        // velocity (before the bounce), at most range / 0.56
        const s = (o.spit ??= { phase: 'active', since: 0, vx: 0, vy: 0 });
        if (s.phase !== 'active' || o.state === 0 || by < 0) return;
        const inv = this.inventories[this.ownerOf(by)] ?? this.inventory;
        const li = inv.indexOf('it_extralife');
        if (li < 0) return;
        inv.splice(li, 1);
        this.events.push({ type: 'items' });
        const vp = vx * nx + vy * ny;
        let px = vx + (vn - vp) * nx;
        let py = vy + (vn - vp) * ny;
        const num = (k: string, def: number) => (o.attrs[k] !== undefined && o.attrs[k] !== '' ? Number(o.attrs[k]) : def);
        const f = num('hit_strength', 1);
        [px, py] = [(num('hit_distortion_xx', 1) * px + num('hit_distortion_xy', 0) * py) * f, (num('hit_distortion_yx', 0) * px + num('hit_distortion_yy', 1) * py) * f];
        const max = num('range', 100) / 0.56;
        const v = Math.hypot(px, py);
        if (v > max) [px, py] = [(px / v) * max, (py / v) * max];
        o.spit = { phase: 'loading', since: this.now, vx: px, vy: py };
        return;
      }
      if (o.cls === 'stsurprise') {
        // SurpriseStone::actor_hit: its action, then a random stone of its selection replaces it
        this.performAction(o, true);
        if (o.gone) return;
        const sel = (o.attrs.selection ?? '').split(/[,;]/).map((t) => t.trim()).filter(Boolean);
        const list = sel.length ? sel : ['st_grate_cross', 'st_death', 'st_surprise', 'st_lightglass_hollow', 'st_knight', 'st_thief', 'st_flat_breakable', 'st_flat_breaking', 'st_puzzle_yellow'];
        this.transformStone(o, list[Math.floor(this.random() * list.length)]);
        return;
      }
      if (o.cls === 'charge') {
        // ChargeStone::actor_hit: the actor gets its charge; animation 140 ms
        o.pulse = this.now;
        if (by >= 0) this.events.push({ type: 'charge', marble: by, charge: chargeOf(o) });
        return;
      }
      if (o.cls === 'volcano') {
        // VolcanoStone::actor_hit: an active one breaks with the hammer; a growing one shatters
        if (o.state === 1 && this.wields('it_hammer')) {
          o.state = 4;
          o.blast = this.now;
        } else if (o.state === 3 && by >= 0) this.events.push({ type: 'shatter', marble: by });
        return;
      }
      if (o.cls === 'mail') {
        // MailStone::actor_hit: the first item goes through the pipes and drops behind the last one
        if (by < 0) return;
        const inv = this.inventories[this.ownerOf(by)] ?? this.inventory;
        if (!inv.length) return;
        const end = this.pipeEnd(o.col, o.row, mailDir(o));
        if (end && this.canDropAt(end[0] + 0.5, end[1] + 0.5)) this.dropKind(inv.shift()!, end[0], end[1]);
        return;
      }
      if (o.cls === 'scissors') {
        // ScissorsStone::actor_hit: snip (130 ms) and "disconnect" the actor
        if (by >= 0) {
          o.pulse = this.now;
          this.events.push({ type: 'scissors', marble: by, col: o.col, row: o.row });
        }
        return;
      }
      if (o.cls === 'rubberstone') {
        if (by >= 0) {
          const n = (k: string) => (o.attrs[k] !== undefined && o.attrs[k] !== '' ? Number(o.attrs[k]) : undefined);
          this.events.push({ type: 'rubberband', marble: by, col: o.col, row: o.row, scissor: o.attrs.scissor === undefined || o.attrs.scissor === '' ? true : truthy(o.attrs.scissor), strength: n('strength'), length: n('length'), threshold: n('threshold'), max: n('max') });
        }
        return;
      }
      if (o.cls === 'monoflop') {
        // MonoFlopStone::actor_hit → setState(1)
        this.monoflopOn(o);
        return;
      }
      if (o.cls === 'flash') {
        // FlashStone::actor_hit: the other marble gets distortedVelocity(velocity, 20); animation 6 frames
        o.pulse = this.now;
        if (by >= 0) {
          const num = (k: string, def: number) => (o.attrs[k] !== undefined && o.attrs[k] !== '' ? Number(o.attrs[k]) : def);
          const f = num('hit_strength', 20);
          this.events.push({ type: 'flash', marble: by, fx: (num('hit_distortion_xx', 1) * vx + num('hit_distortion_xy', 0) * vy) * f, fy: (num('hit_distortion_yx', 0) * vx + num('hit_distortion_yy', 1) * vy) * f });
        }
        return;
      }
      if (o.cls === 'magic') {
        // MagicStone::actor_hit: brick + magic wand → st_rawglass; oxyda → light glass, oxydc → raw glass (movable)
        const f = magicFlavor(o);
        if (f === 'brick' && this.wields('it_magicwand')) this.transformStone(o, 'st_rawglass');
        else if (f === 'oxyda') this.transformStone(o, 'st_lightglass_movable');
        else if (f === 'oxydc') this.transformStone(o, 'st_rawglass_movable');
        return;
      }
      if (o.cls === 'ghost') {
        // GhostStone::actor_hit: purplemarble + brush → st_purplemarble, greenbrown + wand → st_greenbrown,
        // break + brush → st_break_oxydc
        const f = ghostFlavor(o);
        if (f === 'purplemarble' && this.wields('it_brush')) this.transformStone(o, 'st_purplemarble');
        else if (f === 'greenbrown' && this.wields('it_magicwand')) this.transformStone(o, 'st_greenbrown');
        else if (f === 'break' && this.wields('it_brush')) this.transformStone(o, 'st_break_oxydc');
        return;
      }
      if (o.cls === 'polarswitch') {
        // PolarSwitchStone::actor_hit: toggle
        this.setPolar(o, 1 - o.state);
        return;
      }
      if (o.cls === 'keyswitch') {
        this.hitKeySwitch(o, by);
        return;
      }
      if (o.cls === 'window') {
        this.hitWindow(o, nx, ny, vn, by);
        return;
      }
      if (o.cls === 'coinslot') {
        this.hitCoinslot(o, by);
        return;
      }
      if (o.cls === 'knight') {
        // KnightStone::actor_hit: the sword wears him down (4 hits); without one the marble shatters
        if (o.state >= 4) return;
        if (this.wields('it_sword')) {
          o.state++;
          if (o.state === 4) this.events.push({ type: 'text', text: "All right, we'll call it a draw" });
        } else if (by >= 0) this.events.push({ type: 'shatter', marble: by });
        return;
      }
      if (o.cls === 'shogun') {
        // Stone::actor_hit → impulse: the innermost piece moves
        const face = (Math.abs(nx) === 1 && ny === 0) || (Math.abs(ny) === 1 && nx === 0);
        if (face && vn < -PUSH_SPEED) this.shogunMove(o, -nx, -ny);
        return;
      }
      if (o.cls === 'ice') {
        // IceBlock: MOVABLE_STANDARD – pushed like a box while idle
        const face = (Math.abs(nx) === 1 && ny === 0) || (Math.abs(ny) === 1 && nx === 0);
        if (face && vn < -PUSH_SPEED && o.breaking === undefined) this.push(o, -nx, -ny);
        return;
      }
      if (o.cls === 'turnstilearm') {
        // Stone::actor_hit → impulse in the push direction → TurnstileArm::on_impulse
        const face = (Math.abs(nx) === 1 && ny === 0) || (Math.abs(ny) === 1 && nx === 0);
        if (face && vn < -PUSH_SPEED) this.armImpulse(o, STEPS.findIndex(([x, y]) => x === -nx && y === -ny), by);
        return;
      }
      if (o.cls === 'lightpassenger') {
        // LightPassengerStone::actor_hit: a blinking one breaks with the hammer
        const p = o.pass;
        if (p?.blink && p.breaking === undefined && this.wields('it_hammer')) {
          p.breaking = this.now;
          this.events.push({ type: 'sound', name: 'explode' });
        }
        return;
      }
      if (o.cls === 'dispenser') {
        // DispenserStone::actor_hit: one item from its stock (1000) into the inventory
        const stock = numAttr(o.attrs.stock, 1000);
        const inv = by >= 0 ? (this.inventories[this.ownerOf(by)] ?? this.inventory) : this.inventory;
        if (stock > 0 && inv.length < MAX_ITEMS && o.breaking === undefined) {
          inv.unshift(dispenserItem(o));
          o.attrs = { ...o.attrs, stock: String(stock - 1) };
          this.events.push({ type: 'items' }, { type: 'sound', name: 'pickup' });
        }
        return;
      }
      if (o.cls === 'breakstone') {
        // BreakStone::actor_hit: the hammer breaks plain, oxydc and boulder ones, black/white
        // only for a marble of that colour
        const t = breakType(o);
        // BreakStone::actor_hit: st_break_bug breaks when the bug (ac_bug) hits it
        if (t === 'bug' && by === -2) {
          this.breakStone(o);
          return;
        }
        // FlatStone/PlasterStone::actor_hit: the hammer breaks breakable and cracked ones
        if (this.wields('it_hammer') && (t === 'plain' || t === 'oxydc' || t === 'boulder' || t === 'flat' || t === 'cracked' || t === 'plaster' || (t === 'black' && color === 0) || (t === 'white' && color === 1))) this.breakStone(o);
        return;
      }
      if (o.cls === 'mirror') {
        // MirrorStone::actor_hit: a movable one is pushed first; then it turns (wrench: back)
        const face = (Math.abs(nx) === 1 && ny === 0) || (Math.abs(ny) === 1 && nx === 0);
        if (mirrorFlags(o).movable && face && vn < -PUSH_SPEED) this.push(o, -nx, -ny);
        this.turnMirror(o, this.wields('it_wrench') ? -1 : 1);
        return;
      }
      if (o.cls === 'fourswitch') {
        this.turnFourswitch(o); // FourSwitch::actor_hit
        continue;
      }
      if (o.cls === 'chess') {
        this.hitChess(o, color, nx, ny, vn, vx, vy);
        return;
      }
      if (o.cls === 'blur') {
        // BlurStone::actor_hit: straight → passage of the marble's colour, cross → the other one;
        // magic (looks like cross) only with the wand
        if ((color === 0 || color === 1) && (o.state !== 2 || this.wields('it_magicwand'))) {
          const c = o.state === 0 ? color : 1 - color;
          o.kind = `st_passage_${c === 1 ? 'white' : 'black'}_square`;
          o.cls = 'passage';
          o.state = c;
          o.attrs = { ...o.attrs, $flavor: 'square' };
          this.events.push({ type: 'sound', name: 'switch' });
        }
        return;
      }
      if (o.cls === 'swap') {
        // Stone::actor_hit → impulse in the push direction (SwapStone::on_impulse)
        const face = (Math.abs(nx) === 1 && ny === 0) || (Math.abs(ny) === 1 && nx === 0);
        if (face && vn < -PUSH_SPEED) this.swapStone(o, -nx, -ny);
        return;
      }
      if (o.cls === 'rotator') {
        // RotatorStone::actor_hit: the wrench reverses it; a movable one is pushed
        if (this.wields('it_wrench')) o.state = 1 - o.state;
        const face = (Math.abs(nx) === 1 && ny === 0) || (Math.abs(ny) === 1 && nx === 0);
        if (rotatorMovable(o) && face && vn < -PUSH_SPEED) this.push(o, -nx, -ny);
        return;
      }
      if (o.cls === 'pull') {
        // PullStone::on_impulse: moves against the impulse, towards the marble
        const face = (Math.abs(nx) === 1 && ny === 0) || (Math.abs(ny) === 1 && nx === 0);
        if (face && vn < -PUSH_SPEED) this.swapStone(o, nx, ny, true);
        return;
      }
      if (o.cls === 'box') {
        // Only a hit on a face (axis normal) fast enough pushes, away from the marble.
        const face = (Math.abs(nx) === 1 && ny === 0) || (Math.abs(ny) === 1 && nx === 0);
        if (face && vn < -PUSH_SPEED && !o.gone) {
          this.push(o, -nx, -ny);
          this.propagateWire(o, STEPS.findIndex(([x, y]) => x === -nx && y === -ny)); // Stone::propagateImpulse
        }
        continue;
      }
      if (o.cls === 'quake') {
        this.quake(o);
        continue;
      }
      if (o.cls === 'impulse') {
        // StoneImpulse::actor_hit: the slightest hit starts it (hollow ones are passed through).
        // StoneImpulse movable: a push on a face moves it (and it pulses with that direction)
        if (o.kind === 'st_stoneimpulse_movable') {
          const face = (Math.abs(nx) === 1 && ny === 0) || (Math.abs(ny) === 1 && nx === 0);
          if (face && vn < -PUSH_SPEED && !o.impulse && this.push(o, -nx, -ny)) {
            this.startImpulse(o, STEPS.findIndex(([x, y]) => x === -nx && y === -ny));
            continue;
          }
        }
        if (o.kind !== 'st_stoneimpulse_hollow') this.startImpulse(o, -1);
        continue;
      }
      // BoulderStone::actor_hit: the magic wand turns a boulder round.
      if (o.cls === 'boulder') {
        if (this.wields('it_magicwand') && o.boulder?.phase !== 'falling') this.boulderTurn(o, (o.state + 2) % 4);
        continue;
      }
      // OneWayStone::actor_hit: the wand turns a plain one-way stone round (not black/white ones).
      if (o.cls === 'oneway') {
        const coloured = (o.attrs.color ?? '') !== '' || /_(black|white)/.test(o.kind);
        if (!coloured && this.wields('it_magicwand')) o.state = (o.state + 2) % 4;
        continue;
      }
      if (o.cls === 'puzzle') {
        this.hitPuzzle(o, nx, ny, vn);
        return; // the puzzle may have moved: no further objects of this cell
      }
      if (o.cls !== 'switch') continue;
      const c = o.attrs.color;
      const ic = c === undefined || c === '' ? 0 : Number(c) + 1;
      if (ic === 0 || ic === color + 1) this.setState(o, target(o) === 1 ? 0 : 1);
    }
  }

  /** Any contact of marble `marble` with the stone in this cell, also a soft one (Stone::actor_touch). */
  touch(col: number, row: number, marble = 0): void {
    for (const o of this.at(col, row)) {
      // PuzzleStone::actor_contact: ignited or exploding puzzle stones shatter the marble.
      if (o.cls === 'puzzle' && (o.puzzle === 'ignited' || o.puzzle === 'exploding')) this.events.push({ type: 'shatter', marble });
      // ThiefStone::actor_touch: even a slight touch makes an idle thief emerge
      if (o.cls === 'thief' && !o.gone && !o.thief?.phase) o.thief = { ...(o.thief ?? { loot: [] }), phase: 'emerge', since: this.now, victim: marble };
      if (o.cls !== 'death') continue;
      // DeathStone::actor_touch: the marble shatters, the stone pulses.
      this.events.push({ type: 'shatter', marble });
      if (!o.moving) o.moving = { to: 0, since: this.now, dur: DEATH_MS };
    }
  }

  /**
   * QuakeStone: an idle quake stone shakes and closes all Oxyd stones.
   * FakeStone (st_fake_quake): looks and shakes the same, but closes nothing.
   */
  private quake(o: GameObject): void {
    if (o.moving) return; // already shaking
    o.moving = { to: 0, since: this.now, dur: QUAKE_MS };
    if (o.kind === 'st_fake_quake') this.events.push({ type: 'sound', name: 'fakeoxyd' });
    else this.events.push({ type: 'quake' });
  }

  /** Stone::move_stone: move a box one cell if the cell is free. */
  push(o: GameObject, dx: number, dy: number): boolean {
    const col = o.col + dx;
    const row = o.row + dy;
    if (this.stoneAt(col, row)) return false;
    const oldCol = o.col;
    const oldRow = o.row;
    this.unplace(o);
    o.col = col;
    o.row = row;
    this.place(o);
    this.events.push({ type: 'sound', name: 'move' });
    // Stone::on_move: a stone moving onto the marble shatters it.
    this.shatterAt(col, row);
    this.stoneHitsItems(col, row);
    // FlatStone::on_floor_change: a movable flat stone falls into the abyss or drowns – no bridge
    // PlopStone::on_floor_change likewise drowns
    if ((o.kind === 'st_flat_movable' || o.kind === 'st_plop') && SINK_FLOORS.has(this.env.floorAt(col, row))) {
      o.gone = true;
      this.unplace(o);
      this.events.push({ type: 'sound', name: 'explode' });
    }
    if (o.cls === 'ice' && this.env.floorAt(col, row) === 'fl_water') {
      this.env.setFloor(col, row, 'fl_ice');
      this.events.push({ type: 'floor', col, row });
    }
    if (o.kind.startsWith('st_box') && SINK_FLOORS.has(this.env.floorAt(col, row))) {
      o.gone = true;
      this.unplace(o);
      this.env.setFloor(col, row, bridgeFloor(o.kind));
      this.events.push({ type: 'floor', col, row });
    }
    this.updateTriggers(oldCol, oldRow);
    this.updateTriggers(col, row);
    return true;
  }

  // ---------- puzzle stones (PuzzleStone.cc, Enigma mode) ----------

  private puzzleAt(col: number, row: number, color: string): GameObject | null {
    return this.at(col, row).find((x) => x.cls === 'puzzle' && !x.gone && (x.attrs.color ?? '') === color) ?? null;
  }

  private conn(o: GameObject): number {
    return Number(o.attrs.$connections) || 0;
  }

  /** findFragment: stones joined by matching connections; complete = no open connection. */
  puzzleFragment(o: GameObject): { cluster: GameObject[]; complete: boolean } {
    const color = o.attrs.color ?? '';
    const seen = new Set([o]);
    const todo = [o];
    let complete = true;
    while (todo.length) {
      const p = todo.pop()!;
      for (const [dx, dy, bit] of STEPS) {
        if (!(this.conn(p) & bit)) continue;
        const q = this.puzzleAt(p.col + dx, p.row + dy, color);
        const back = bit === 1 ? 4 : bit === 4 ? 1 : bit === 2 ? 8 : 2;
        if (!q || !(this.conn(q) & back)) {
          complete = false;
          continue;
        }
        if (!seen.has(q)) {
          seen.add(q);
          todo.push(q);
        }
      }
    }
    return { cluster: [...seen], complete };
  }

  /** findAdjacents: all puzzle stones of the colour touching each other. */
  private puzzleAdjacents(o: GameObject): GameObject[] {
    const color = o.attrs.color ?? '';
    const seen = new Set([o]);
    const todo = [o];
    while (todo.length) {
      const p = todo.pop()!;
      for (const [dx, dy] of STEPS) {
        const q = this.puzzleAt(p.col + dx, p.row + dy, color);
        if (q && !seen.has(q)) {
          seen.add(q);
          todo.push(q);
        }
      }
    }
    return [...seen];
  }

  private hitPuzzle(o: GameObject, nx: number, ny: number, vn: number): void {
    if (isHollow(o)) return; // PuzzleStone::actor_hit: a hollow stone ignores hits
    if (o.puzzle) return; // not idle
    const face = (Math.abs(nx) === 1 && ny === 0) || (Math.abs(ny) === 1 && nx === 0);
    if (!face) return; // contact_face is NODIR: neither rotation nor move
    const dx = -nx;
    const dy = -ny;
    const push = vn < -PUSH_SPEED;
    if (o.attrs.color === PUZZLE_YELLOW) {
      if (this.explodePuzzle(o)) return;
      // A single yellow stone moves like a box, otherwise its line rotates.
      if (push && this.puzzleFragment(o).cluster.length === 1 && !this.stoneAt(o.col + dx, o.row + dy)) {
        this.movePuzzles([o], dx, dy, false);
      } else this.rotatePuzzleLine(o, dx, dy);
    } else {
      // BLUE: with the wand first try to explode the cluster, then move it, then rotate the line.
      const wand = this.wields('it_magicwand');
      if (wand && this.explodePuzzle(o)) return;
      const before = o.col * 1000 + o.row;
      if (push) this.moveCluster(o, dx, dy);
      if (wand && o.col * 1000 + o.row === before) this.rotatePuzzleLine(o, dx, dy);
    }
  }

  /** explodeCluster: a complete fragment that touches no other stone of its colour explodes. */
  private explodePuzzle(o: GameObject): boolean {
    const { cluster, complete } = this.puzzleFragment(o);
    if (!complete || this.puzzleAdjacents(o).length !== cluster.length) return false;
    for (const p of cluster) p.puzzle = 'pending';
    this.explodeStone(o);
    return true;
  }

  private explodeStone(o: GameObject): void {
    o.puzzle = 'exploding';
    o.moving = { to: 0, since: this.now, dur: PUZZLE_EXPLODE_MS };
    this.events.push({ type: 'sound', name: 'explode' });
    for (const [dx, dy] of STEPS) {
      const q = this.puzzleAt(o.col + dx, o.row + dy, o.attrs.color ?? '');
      if (q && q.puzzle === 'pending') {
        q.puzzle = 'ignited';
        q.fuse = this.now + PUZZLE_FUSE_MS;
      }
    }
  }

  /** rotateLine: the same-coloured stones from o in a direction shift by one, the last wraps to o's place. */
  private rotatePuzzleLine(o: GameObject, dx: number, dy: number): void {
    const color = o.attrs.color ?? '';
    const line: GameObject[] = [];
    for (let c = o.col, r = o.row, p = this.puzzleAt(c, r, color); p; c += dx, r += dy, p = this.puzzleAt(c, r, color)) line.push(p);
    if (line.length < 2) return;
    const cells = line.map((p) => [p.col, p.row]);
    line.forEach((p) => this.unplace(p));
    line.forEach((p, i) => {
      const [c, r] = cells[(i + 1) % cells.length];
      p.col = c;
      p.row = r;
      this.place(p);
      this.stoneHitsItems(c, r);
    });
    this.events.push({ type: 'sound', name: 'move' });
  }

  /** moveCluster: the whole fragment moves if every target cell is free or part of it. */
  private moveCluster(o: GameObject, dx: number, dy: number): void {
    const { cluster, complete } = this.puzzleFragment(o);
    const members = new Set(cluster);
    for (const p of cluster) {
      const c = p.col + dx;
      const r = p.row + dy;
      if (this.env.stoneAt(c, r)) return;
      if (this.at(c, r).some((x) => !x.gone && !isItem(x) && !members.has(x))) return;
    }
    // Pushed by the marble (waterSink): water always takes the cluster, abyss only a complete one.
    const bridge = cluster.every((p) => {
      const fl = this.env.floorAt(p.col + dx, p.row + dy);
      return (fl === 'fl_abyss' && complete) || fl === 'fl_water';
    });
    this.movePuzzles(cluster, dx, dy, bridge);
  }

  private movePuzzles(list: GameObject[], dx: number, dy: number, bridge: boolean): void {
    const old = list.map((p) => [p.col, p.row]);
    list.forEach((p) => this.unplace(p));
    for (const p of list) {
      p.col += dx;
      p.row += dy;
      this.place(p);
      if (!isHollow(p)) this.shatterAt(p.col, p.row); // PuzzleStone::on_move
      this.stoneHitsItems(p.col, p.row);
    }
    this.events.push({ type: 'sound', name: 'move' });
    if (bridge) {
      for (const p of list) {
        p.gone = true;
        this.unplace(p);
        this.env.setFloor(p.col, p.row, this.fallenPuzzle);
        this.events.push({ type: 'floor', col: p.col, row: p.row });
      }
    }
    for (const [c, r] of old) this.updateTriggers(c, r);
    for (const p of list) this.updateTriggers(p.col, p.row);
  }

  // ---------- impulse stones (StoneImpulse.cc) ----------

  /** setIState(EXPANDING): only an idle stone starts. incoming: Enigma direction or -1. */
  private startImpulse(o: GameObject, incoming: number): void {
    if (o.impulse || o.gone) return;
    o.impulse = { phase: 'expanding', incoming };
    o.moving = { to: 0, since: this.now, dur: IMPULSE_EXPAND_MS };
    // A marble inside an active hollow impulse stone shatters (actor_inside).
    if (o.kind === 'st_stoneimpulse_hollow') this.shatterAt(o.col, o.row);
  }

  private inWire = false;

  /** Stone::propagateImpulse: every fellow (ot_wire) gets the impulse too, without passing it on. */
  private propagateWire(o: GameObject, d: number): void {
    if (this.inWire || d < 0 || !o.attrs.fellows) return;
    this.inWire = true;
    const done = new Set<GameObject>([o]);
    for (const t of splitTokens(o.attrs.fellows)) {
      for (const f of this.resolve(t)) {
        if (done.has(f) || f.gone || isItem(f)) continue;
        done.add(f);
        this.sendImpulse(f.col, f.row, d);
      }
    }
    this.inWire = false;
  }

  /** ot_wire: lines between wired stones (x1, y1, x2, y2 in tile units), each pair once. */
  wireLines(): number[] {
    const out: number[] = [];
    const seen = new Set<string>();
    for (const o of this.objects) {
      if (o.gone || !o.attrs.fellows) continue;
      for (const t of splitTokens(o.attrs.fellows)) {
        for (const f of this.resolve(t)) {
          if (f.gone || f === o) continue;
          const key = o.id < f.id ? `${o.id}-${f.id}` : `${f.id}-${o.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(o.col + 0.5, o.row + 0.5, f.col + 0.5, f.row + 0.5);
        }
      }
    }
    return out;
  }

  /** Stone::send_impulse: a stone receives an impulse in Enigma direction d. */
  private sendImpulse(col: number, row: number, d: number): void {
    const [dx, dy] = STEPS[d];
    const hit = this.at(col, row).filter((o) => !o.gone && !isItem(o));
    for (const o of [...this.at(col, row)]) {
      if (o.gone) continue;
      if (o.cls === 'impulse') {
        // StoneImpulse::on_impulse: a movable one moves first
        if (o.kind === 'st_stoneimpulse_movable') this.push(o, dx, dy);
        this.startImpulse(o, d);
      }
      else if (o.cls === 'box' || (o.cls === 'death' && (o.kind === 'st_death_movable' || truthy(o.attrs.movable)))) this.push(o, dx, dy); // DeathStone MOVABLE: moved by impulses
      else if (o.cls === 'swap') this.swapStone(o, dx, dy);
      else if (o.cls === 'pull') this.swapStone(o, -dx, -dy, true);
      else if (o.cls === 'turnstilearm') this.armImpulse(o, d, -1);
      else if (o.cls === 'ice' && o.breaking === undefined) this.push(o, dx, dy);
      else if (o.cls === 'shogun') this.shogunMove(o, dx, dy);
      else if (o.cls === 'lightpassenger' && (o.state === 0 || !this.lit.has(o.row * this.width + o.col))) this.push(o, dx, dy);
      else if ((o.cls === 'rotator' && rotatorMovable(o)) || (o.cls === 'mirror' && mirrorFlags(o).movable)) this.push(o, dx, dy);
      else if (o.cls === 'boulder' && o.boulder?.phase !== 'falling') this.boulderMove(o, d);
      else if (o.cls === 'puzzle' && !o.puzzle) this.moveCluster(o, dx, dy);
    }
    // Stone::on_impulse: move first, then propagateImpulse to the wired fellows
    for (const o of hit) this.propagateWire(o, d);
  }

  // ---------- wormholes (WormHole.cc) ----------

  /** Sum of the wormhole pulls on the marble at x/y (WormHole::globalForce, not scaled by the floor). */
  fieldForce(x: number, y: number, flying = false): [number, number] {
    let fx = 0;
    let fy = 0;
    // Meditation::add_force: dents pull towards the centre, hills push away (volcano: crater inside).
    // Item forces act only on the floor (World::get_local_force); wormholes pull as a global force.
    for (const o of flying ? [] : this.at(Math.floor(x), Math.floor(y))) {
      if (o.cls !== 'meditation' || o.gone) continue;
      const vx = x - (o.col + 0.5);
      const vy = y - (o.row + 0.5);
      const dist = Math.hypot(vx, vy);
      const s = o.state;
      if (dist > (Math.abs(s) > 1 ? 0.5 : 0.3)) continue;
      const k = (s < 0 ? -1 : 1) * (Math.abs(s) === 3 && dist < 0.3 ? -1 : 1) * 90; // server::HoleForce = 1
      fx += k * vx;
      fy += k * vy;
    }
    for (const o of this.objects) {
      if ((o.cls !== 'wormhole' && o.cls !== 'magnet') || o.state !== 1 || o.gone) continue;
      const strength = 0.6 * numAttr(o.attrs.strength, 30);
      const range = numAttr(o.attrs.range, 10);
      const dx = o.col + 0.5 - x;
      const dy = o.row + 0.5 - y;
      const sq = dx * dx + dy * dy;
      // Magnet::globalForce from 0.2, WormHole::globalForce from 0.025
      if (sq >= (o.cls === 'magnet' ? 0.04 : 0.025) && sq < range * range) {
        fx += (strength / sq) * dx;
        fy += (strength / sq) * dy;
      }
    }
    return [fx, fy];
  }

  /**
   * An actor (marble index, or -1 for another actor) is at x/y; call after every physics step.
   * Landmine::actor_hit: closer than 0.3 to the centre it explodes; the explosion shatters
   * marbles in its cell (Explosion::actor_hit).
   */
  actorStep(x: number, y: number, marble: number, radius = 19 / 64): void {
    if (marble >= 0) {
      // BoxStone::actor_inside / actor_contact: a growing box shatters the marble.
      for (let dc = -1; dc <= 1; dc++)
        for (let dr = -1; dr <= 1; dr++) {
          const c = Math.floor(x) + dc;
          const r = Math.floor(y) + dr;
          if (!this.at(c, r).some((o) => o.cls === 'box' && !o.gone && o.growing !== undefined)) continue;
          const nx = Math.min(Math.max(x, c), c + 1);
          const ny = Math.min(Math.max(y, r), r + 1);
          if (Math.hypot(x - nx, y - ny) < radius + 0.01) this.events.push({ type: 'shatter', marble });
        }
      // Meditation::actor_hit: a pearl resting near the centre for 1 s engages the hollow
      if (this.isPearl(marble)) {
        for (const o of this.objects) {
          if (o.cls !== 'meditation' || o.gone) continue;
          const here = o.col === Math.floor(x) && o.row === Math.floor(y);
          const d = Math.hypot(x - (o.col + 0.5), y - (o.row + 0.5));
          // Meditation::isMeditating: closer than 0.24, or 0.4 for hollows/calderas and hills/volcanos
          const meditating = here && (d < 0.24 || ((o.state <= -2 || o.state >= 2) && d < 0.4));
          if (o.meditatist?.marble === marble) {
            if (!meditating) o.meditatist = undefined; // left the hollow (actor_leave)
            else if (o.meditatist.since !== -1 && this.now - o.meditatist.since >= 1000) o.meditatist = { marble, since: -1 };
          } else if (!o.meditatist && meditating && !this.objects.some((p) => p.meditatist?.marble === marble)) {
            o.meditatist = { marble, since: this.now };
          }
        }
      }
      // DeathItem::actor_hit: whoever is in its field shatters (it_death_anim 4 × 100 ms)
      for (const o of this.at(Math.floor(x), Math.floor(y))) {
        if (o.cls !== 'deathitem' || o.gone) continue;
        this.events.push({ type: 'shatter', marble });
        if (o.blast === undefined || this.now - o.blast >= 400) o.blast = this.now;
      }
      // BrakeStone::actor_inside: closer than 0.3 to the centre → picked up as it_brake
      for (const o of [...this.at(Math.floor(x), Math.floor(y))]) {
        if (o.cls !== 'brake' || o.gone) continue;
        const inv = this.inventories[this.ownerOf(marble)] ?? this.inventory;
        if (inv.length >= MAX_ITEMS || Math.hypot(x - (o.col + 0.5), y - (o.row + 0.5)) >= 0.3) continue;
        this.remove(o);
        inv.unshift('it_brake');
        this.events.push({ type: 'sound', name: 'pickup' }, { type: 'items' });
      }
      // TrapItem::actor_hit: an actor on the floor falls; the trap opens (it_trap_breaking)
      for (const o of this.at(Math.floor(x), Math.floor(y))) {
        if (o.cls !== 'trap' || o.gone) continue;
        this.events.push({ type: 'fall', marble });
        if (o.state === 0) {
          o.state = 1;
          o.blast = this.now;
        }
      }
      // Bottle::actor_hit: a broken bottle shatters an actor on the floor
      for (const o of this.at(Math.floor(x), Math.floor(y))) {
        if (o.kind === 'it_bottle_broken' && !o.gone) this.events.push({ type: 'shatter', marble });
      }
      // CrossItem::actor_enter: a marble starts the alarm (interval, default 10 s)
      for (const o of this.at(Math.floor(x), Math.floor(y))) {
        if (o.cls !== 'cross' || o.gone) continue;
        const c = (o.cross ??= { seen: 0, inside: false, at: 0 });
        c.seen = this.now;
        if (!c.inside) {
          c.inside = true;
          if (o.state === 0) {
            o.state = 1;
            c.at = this.now + (Number(o.attrs.interval) || 10) * 1000;
          }
        }
      }
      // BurnableItem::actor_hit: fire (ignited, burning) shatters
      for (const o of this.at(Math.floor(x), Math.floor(y))) {
        if (o.cls === 'burnable' && !o.gone && (burnState(o) === 'ignited' || burnState(o) === 'burning')) this.events.push({ type: 'shatter', marble });
      }
      // Explosion::actor_hit shatters, Debris::actor_hit lets fall
      for (const o of this.at(Math.floor(x), Math.floor(y))) {
        if (o.gone) continue;
        if (o.cls === 'explosion') this.events.push({ type: 'shatter', marble });
        else if (o.cls === 'debris') this.events.push({ type: 'fall', marble });
      }
      // LaserBeam::actor_hit: closer than 0.21 to the beam's axis → "_laserhit"
      const beam = this.beams.get(Math.floor(y) * this.width + Math.floor(x)) ?? 0;
      if (beam) {
        const dx = Math.abs(x - Math.floor(x) - 0.5);
        const dy = Math.abs(y - Math.floor(y) - 0.5);
        if ((beam & (L_W | L_E) && dy < 0.21) || (beam & (L_N | L_S) && dx < 0.21)) this.events.push({ type: 'laserhit', marble });
      }
      // Springboard::actor_hit: an actor on the floor within 0.3 (each axis) of the centre jumps
      for (const o of this.at(Math.floor(x), Math.floor(y))) {
        if (o.cls !== 'springboard' || o.gone) continue;
        if (Math.abs(x - (o.col + 0.5)) <= 0.3 && Math.abs(y - (o.row + 0.5)) <= 0.3) {
          o.bounce = this.now;
          this.events.push({ type: 'jump', marble });
        }
      }
      // Vortex::actor_hit: an open vortex swallows a marble closer than 0.25; autoopen opens it
      for (const o of this.at(Math.floor(x), Math.floor(y))) {
        if (o.cls !== 'vortex' || o.gone) continue;
        const v = this.vortexOf(o);
        const d = Math.hypot(x - (o.col + 0.5), y - (o.row + 0.5));
        if (v.phase === 'open' && d < 0.25) {
          o.vortex = { phase: 'swallowing', since: this.now, marble, idx: 0 };
          this.events.push({ type: 'vortexGrab', marble });
        } else if (v.phase === 'closed' && d > 0.25 && truthy(o.attrs.autoopen)) this.vortexSet(o, 1);
      }
      // Item::actor_hit (SeedItem: radius 0.2, not while growing; others 0.3) → Player::pick_up.
      for (const o of [...this.at(Math.floor(x), Math.floor(y))]) {
        const radius = PICKUP_RADIUS[o.cls];
        const inv = this.inventories[this.ownerOf(marble)] ?? this.inventory;
        const intoBag = isBag(inv[0]) && bagContents(inv[0]).length < BAG_SIZE && !(o.cls === 'bag' && !(o.loot ?? []).length);
        if (radius === undefined || o.gone || o.growing !== undefined || (inv.length >= MAX_ITEMS && !intoBag && o.cls !== 'bag')) continue;
        if ((o.cls === 'dynamite' || o.cls === 'puller') && o.blast !== undefined) continue; // isStatic while burning / active
        if (o.kind === 'it_bottle_broken') continue; // itf_static
        if (this.inhibitPickup && this.ownerOf(marble) === this.player) continue;
        if (Math.hypot(x - (o.col + 0.5), y - (o.row + 0.5)) >= radius) continue;
        if (o.cls === 'bag') {
          // BagItem::actor_hit: the inventory takes its items (not into a bag in front), then maybe the bag
          const loot = [...(o.loot ?? [])];
          const before = loot.length;
          if (!(isBag(inv[0]) && bagContents(inv[0]).length < BAG_SIZE)) while (inv.length < MAX_ITEMS && loot.length) inv.unshift(loot.shift()!);
          // Inventory::willAddItem: an empty bag not into a full inventory or behind another bag
          const takeBag = inv.length < MAX_ITEMS && !(loot.length === 0 && isBag(inv[0]));
          if (takeBag) {
            o.gone = true;
            this.unplace(o);
            inv.unshift(bagKind(loot));
          } else o.loot = loot;
          if (takeBag || loot.length !== before) this.events.push({ type: 'sound', name: 'pickup' }, { type: 'items' });
          continue;
        }
        o.gone = true;
        this.unplace(o);
        let kind = o.cls === "key" && this.keyCode(o) ? `it_key_${this.keyCode(o)}` : o.kind;
        // items whose attributes matter after the drop (it_surprise: target, selection) carry them along
        if (o.cls === 'surprise' || o.kind === 'it_rubberband') {
          kind = `${o.kind}#${++this.carriedId}`;
          this.carried.set(kind, o.attrs);
        }
        // Inventory::add_item: into a bag in front that is not full
        if (intoBag) inv[0] = bagKind([kind, ...bagContents(inv[0])]);
        else inv.unshift(kind);
        if (o.cls === 'flag') this.flagRespawn[flagColor(o.kind)] = undefined;
        this.events.push({ type: 'sound', name: 'pickup' });
      }
    }
    for (const o of [...this.at(Math.floor(x), Math.floor(y))]) {
      if (o.cls !== 'landmine' || o.gone) continue;
      if (o.exploding === undefined) {
        if (Math.hypot(x - (o.col + 0.5), y - (o.row + 0.5)) < 0.3) this.explode(o);
      }
      if (o.exploding !== undefined && marble >= 0) this.events.push({ type: 'shatter', marble });
    }
  }

  /**
   * player::ActivateFirstItem: drop the first inventory item into the marble's cell if no item
   * lies there (Item::can_drop_at). A dropped seed starts growing (SeedItem::on_drop).
   */
  dropItem(x: number, y: number): boolean {
    const col = Math.floor(x);
    const row = Math.floor(y);
    // BrakeItem::can_drop_at / drop: a st_brake where no stone is (items do not matter)
    if (this.inventory[0] === 'it_brake') {
      if (this.stoneObjectAt(col, row) || this.env.stoneAt(col, row)) return false;
      this.inventory.shift();
      this.add('st_brake', 'brake', col, row);
      return true;
    }
    if (this.inventory.length === 0 || this.at(col, row).some((o) => !o.gone && isItem(o))) return false;
    if (this.beams.has(row * this.width + col)) return false;
    if (col < 0 || row < 0 || col >= this.width) return false;
    this.dropKind(this.inventory.shift()!, col, row);
    return true;
  }

  /** Attributes of carried items (inventory kind "it_surprise#n"). */
  private carried = new Map<string, Record<string, string>>();
  private carriedId = 0;

  /** Item::drop: an item of this kind lands in the cell (with its on_drop effects). */
  private dropKind(kind: string, col: number, row: number): void {
    if (kind.startsWith('it_rubberband')) {
      // the item keeps its attributes (anchor2, strength …) on the floor
      const o = this.add('it_rubberband', 'tool', col, row);
      o.attrs = { ...(this.carried.get(kind) ?? {}) };
      this.carried.delete(kind);
      return;
    }
    if (kind.startsWith('it_surprise')) {
      // SurpriseItem::on_drop: its action, then it becomes a random item of its selection
      const o = this.add('it_surprise', 'surprise', col, row);
      o.attrs = { ...(this.carried.get(kind) ?? {}) };
      this.carried.delete(kind);
      this.performAction(o, true);
      if (o.gone) return;
      const sel = (o.attrs.selection ?? '').split(/[,;]/).map((t) => t.trim()).filter(Boolean);
      const list = sel.length ? sel : ['it_umbrella', 'it_spring_keep', 'it_dynamite', 'it_coffee', 'it_hammer'];
      const next = list[Math.floor(this.random() * list.length)];
      const cls = objectClass(next);
      this.remove(o);
      if (cls) this.add(next, cls, col, row);
      return;
    }
    if (isBag(kind)) {
      const bag = this.add('it_bag', 'bag', col, row);
      bag.loot = bagContents(kind);
      return;
    }
    const o = this.add(kind, objectClass(kind) ?? 'seed', col, row);
    if (o.cls === 'seed') this.startGrowing(o);
    if (o.cls === 'flag') this.flagRespawn[flagColor(kind)] = { x: col + 0.5, y: row + 0.5 };
    if (o.cls === 'dynamite' || o.cls === 'puller') this.burn(o); // Dynamite/PullerItem::on_drop
    if (kind === 'it_cherry') {
      // Cherry::on_drop
      o.kind = 'it_squashed';
      o.cls = 'squashed';
    }
    this.updateTriggers(col, row);
  }

  /**
   * PipeItem::findPipeEndpoint: from the mail stone in direction d (Enigma W0 S1 E2 N3) along the
   * pipes; the first cell where no pipe continues. null: a broken or circular pipe.
   */
  private pipeEnd(col: number, row: number, d: number): [number, number] | null {
    let c = col;
    let r = row;
    let dir = d;
    for (let guard = 0; guard < 10000; guard++) {
      c += L_DX[dir];
      r += L_DY[dir];
      if (c < 0 || r < 0 || c >= this.width) return null;
      const it = this.itemAt(c, r);
      if (!it || it.cls !== 'pipe') return [c, r];
      const bits = pipeBits(it);
      const back = 1 << ((dir + 2) % 4);
      if (!(bits & back)) return [c, r];
      const rest = bits & ~back;
      const next = [1, 2, 4, 8].indexOf(rest);
      if (next < 0) return null;
      dir = next;
      if (c === col && r === row && dir === d) return null;
    }
    return null;
  }

  /** Item::can_drop_at: no item in the cell. */
  canDropAt(x: number, y: number): boolean {
    if (this.beams.has(Math.floor(y) * this.width + Math.floor(x))) return false; // the beam is an item (it_laserbeam)
    return !this.at(Math.floor(x), Math.floor(y)).some((o) => !o.gone && isItem(o));
  }

  /** Right click: player::RotateInventory(+1) → Inventory::rotate_left (the first item goes last). */
  rotateInventory(): void {
    if (this.inventory.length > 1) this.inventory.push(this.inventory.shift()!);
  }

  /** player::WieldedItemIs: the first inventory item. */
  private wields(kind: string): boolean {
    return this.inventory[0] === kind;
  }

  private add(kind: string, cls: ObjectClass, col: number, row: number): GameObject {
    const o: GameObject = { id: `new${this.nextId++}`, name: '', kind, cls, col, row, state: 0, moving: null, attrs: {}, gone: false };
    this.objects.push(o);
    this.place(o);
    return o;
  }

  /** SeedItem::startGrowing. */
  private startGrowing(o: GameObject): void {
    if (o.growing !== undefined || o.gone) return;
    o.growing = this.now;
  }

  /** it_springboard_anim: ReverseFrames of 2 images à 120 ms (frame 1, then 0). */
  springboardFrame(o: GameObject): number {
    return o.bounce !== undefined && this.now - o.bounce < 120 ? 1 : 0;
  }

  // ---------- lasers and mirrors (laser.cc, LaserStone.cc, MirrorStone.cc) ----------

  /** Laser beams per cell (it_laserbeam: direction bits W 1, S 2, E 4, N 8). */
  readonly beams = new Map<number, number>();
  /** Light arriving at stones and items per cell (GridObject light bits, for photo reactions). */
  private lit = new Map<number, number>();
  private lightDone = false;
  private lightClock = 0;

  /** Called every update: like Enigma's RecalcLight at the end of each 10 ms tick. */
  private lightStep(dt: number): void {
    this.lightClock += dt;
    if (this.lightDone && this.lightClock < 10) return;
    this.lightClock = 0;
    this.recalcLight();
  }

  private transparentObject(o: GameObject): boolean {
    if (o.cls === 'passage' || o.cls === 'grate' || o.cls === 'pull' || o.cls === 'ice') return true;
    if (o.cls === 'knight') return o.state >= 4; // KnightStone::is_floating when beaten
    if (o.cls === 'door') return o.state === 1 && !o.moving;
    if (o.cls === 'puzzle') return isHollow(o);
    if (o.cls === 'box') return /^st_(rawglass|lightglass)_movable$/.test(o.kind);
    if (o.cls === 'polarswitch') return o.state === 1; // PolarSwitchStone::is_transparent when ON
    if (o.cls === 'ghost') return ghostFlavor(o) !== 'purplemarble'; // GhostStone::is_transparent
    if (o.cls === 'disco' || o.cls === 'portal') return true; // DiscoStone/PortalStone::is_floating
    if (o.cls === 'barrier') return false;
    return false;
  }

  /** PerformRecalcLight: emit from every laser that is on; afterwards photo objects react. */
  private recalcLight(): void {
    const beams = new Map<number, number>();
    const lit = new Map<number, number>();
    const mirrorIn = new Map<GameObject, number>();
    const W = this.width;
    const stack: [number, number, number][] = [];
    for (const o of this.objects) if (o.cls === 'laser' && !o.gone && o.state === 1) stack.push([o.col, o.row, laserDir(o)]);
    const light = (c: number, r: number, bit: number) => lit.set(r * W + c, (lit.get(r * W + c) ?? 0) | bit);
    while (stack.length) {
      const [c0, r0, d] = stack.pop()!;
      const c = c0 + L_DX[d];
      const r = r0 + L_DY[d];
      if (c < 0 || r < 0 || c >= W) continue;
      const bit = 1 << d;
      const st = this.at(c, r).find((x) => !x.gone && !isItem(x) && x.cls !== 'oxydref');
      let pass = true;
      if (st) {
        if (st.cls === 'mirror') {
          // MirrorStone::processLight: emit into the directions that the new light adds
          const before = mirrorIn.get(st) ?? 0;
          if (before & bit) continue;
          mirrorIn.set(st, before | bit);
          const add = mirrorOut(st, before | bit) & ~mirrorOut(st, before);
          for (let nd = 0; nd < 4; nd++) if (add & (1 << nd)) stack.push([c, r, nd]);
          continue;
        }
        light(c, r, bit);
        pass = this.transparentObject(st);
      } else if (this.env.stoneAt(c, r)) {
        light(c, r, bit);
        pass = this.env.staticStone?.(c, r) != null && (this.env.transparentAt?.(c, r) ?? false);
      }
      if (!pass) continue;
      // an item stops the beam (Item::processLight)
      if (this.at(c, r).some((x) => !x.gone && isItem(x))) {
        light(c, r, bit);
        continue;
      }
      const b = beams.get(r * W + c) ?? 0;
      if (b & bit) continue;
      beams.set(r * W + c, b | bit);
      stack.push([c, r, d]);
    }
    // GridObject::postLaserRecalc (not on the initial calculation)
    if (this.lightDone) {
      let newBeam = false;
      for (const [k, b] of beams) if ((b & ~(this.beams.get(k) ?? 0)) !== 0) newBeam = true;
      if (newBeam) this.events.push({ type: 'sound', name: 'laser' });
      for (const [k, now] of lit) {
        const old = this.lit.get(k) ?? 0;
        const added = now & ~old;
        if (!added) continue;
        const c = k % W;
        const r = Math.floor(k / W);
        // OxydStone::lightDirChanged: light where there was none → tryOpen
        if (old === 0 && this.env.staticStone?.(c, r) === 'st_oxyd') this.events.push({ type: 'oxyd', col: c, row: r });
        for (const o of this.at(c, r)) {
          if (o.gone) continue;
          if (o.cls === 'boulder') o.state = (o.state + 2) % 4; // BoulderStone: turn round
          else if (o.cls === 'impulse' && o.kind !== 'st_stoneimpulse_hollow') this.startImpulse(o, -1);
          else if (o.cls === 'rotator') o.state = 1 - o.state; // RotatorStone::lightDirChanged
          else if (o.cls === 'breakstone' && lightBreaks(breakType(o))) this.breakStone(o); // BreakStone::processLight
        }
      }
    }
    // Dynamite::processLight burns, Bomb::processLight explodes
    for (const o of this.objects) {
      if (o.gone || !lit.has(o.row * W + o.col)) continue;
      if (o.cls === 'dynamite') this.burn(o);
      else if (o.cls === 'bomb') this.bombExplode(o);
      else if (o.cls === 'brake') this.brakeExplode(o); // BrakeStone::processLight
      else if (o.kind === 'it_banana') o.kind = 'it_cherry'; // Banana::processLight
    }
    // BreakStone::processLight: any light breaks it (not st_break_bug), also at the start
    for (const o of this.objects) if (o.cls === 'breakstone' && !o.gone && lightBreaks(breakType(o)) && lit.has(o.row * W + o.col)) this.breakStone(o);
    // MonoFlopStone (st_laserflop)::lightDirChanged: on while lit (action on OFF → on), the timer starts when the light goes
    for (const o of this.objects) {
      if (o.cls !== 'monoflop' || o.gone || !o.kind.startsWith('st_laserflop')) continue;
      const on = (lit.get(o.row * W + o.col) ?? 0) !== 0;
      if (on && !o.lasered) {
        o.lasered = true;
        o.alarmAt = undefined;
        const was = o.state;
        o.state = 1;
        if (was === 0 && this.lightDone) this.performAction(o, true);
      } else if (!on && o.lasered) {
        o.lasered = false;
        o.alarmAt = this.now + (Number(o.attrs.interval) || 1.8) * 1000;
      }
    }
    // LaserSwitch::lightDirChanged: on with light, off without (the initial state acts not)
    for (const o of this.objects) {
      if (o.cls !== 'laserswitch' || o.gone) continue;
      const on = (lit.get(o.row * W + o.col) ?? 0) !== 0 ? 1 : 0;
      if (on === o.state) continue;
      o.state = on;
      if (this.lightDone) this.performAction(o, on === 1);
    }
    this.beams.clear();
    for (const [k, b] of beams) this.beams.set(k, b);
    this.lit = lit;
    this.lightDone = true;
  }

  /** MirrorStone::toggleState (dir 1) / the wrench (-1): turn by 90°, counterclock reverses. */
  private turnMirror(o: GameObject, dir: number): void {
    const ccw = mirrorFlags(o).counterclock ? -dir : dir;
    o.state = ccw > 0 ? (o.state + 3) % 4 : (o.state + 1) % 4; // rotate_cw: N→E→S→W
    this.events.push({ type: 'sound', name: 'mirror' });
  }

  /** st_mirror_static/_movable sheet: column (triangle, triangle t, planar, planar t, sheets), row N E S W. */
  mirrorLook(o: GameObject): { image: string; col: number; row: number } {
    const f = mirrorFlags(o);
    const col = f.triangle ? (f.pane ? 1 : 0) : f.side ? 4 : f.pane ? 3 : 2;
    return { image: f.movable ? 'st_mirror_movable' : 'st_mirror_static', col, row: 3 - o.state };
  }

  /** st_laser sheet: column N E S W, row 1 off, rows 1..8 animated (100 ms) when on. */
  laserLook(o: GameObject): { col: number; row: number } {
    return { col: 3 - laserDir(o), row: o.state === 1 ? 1 + (Math.floor(this.now / 100) % 8) : 1 };
  }

  // ---------- explosions (world.cc, Dynamite.cc, Bomb.cc, SimpleItems.cc Explosion/Debris) ----------

  /** Dynamite/Bomb::burn: the fuse starts (dynamite 15, bombs 9 frames à 100 ms). */
  private burn(o: GameObject): void {
    if (o.blast === undefined) o.blast = this.now;
  }

  private bombBlack(o: GameObject): boolean {
    return o.attrs.color !== undefined && o.attrs.color !== '' ? Number(o.attrs.color) === 0 : !o.kind.includes('white');
  }

  /** Bomb::explode: its sound, the effect (black: neighbours, white: all eight), debris here. */
  private bombExplode(o: GameObject): void {
    if (o.gone) return;
    const black = this.bombBlack(o);
    this.remove(o);
    this.events.push({ type: 'sound', name: 'bomb' });
    this.explosionEffect(o.col, o.row, black ? 'black' : 'white');
    this.addExplosion(o.col, o.row, 3);
  }

  /** Dynamite::explode: ignites the 3 × 3 field, a hollow (ice: a water crack) remains. */
  private dynamiteExplode(o: GameObject): void {
    if (o.gone) return;
    this.remove(o);
    this.events.push({ type: 'sound', name: 'landmine' }); // dynamite = explosion2
    this.explosionEffect(o.col, o.row, 'dynamite');
    this.addExplosion(o.col, o.row, this.env.floorAt(o.col, o.row) === 'fl_ice' ? 2 : 1);
  }

  private addExplosion(col: number, row: number, strength: number): GameObject {
    const kind = ['it_explosion_nil', 'it_explosion_hollow', 'it_explosion_crack', 'it_explosion_debris'][strength];
    const e = this.add(kind, 'explosion', col, row);
    e.state = strength;
    e.blast = this.now;
    return e;
  }

  /** SendExplosionEffect: the centre, its 4 neighbours and the 4 diagonal cells. */
  private explosionEffect(col: number, row: number, type: 'dynamite' | 'black' | 'white'): void {
    const cells: [number, number, boolean][] = [[0, 0, true], [0, -1, true], [1, 0, true], [0, 1, true], [-1, 0, true], [1, -1, false], [1, 1, false], [-1, 1, false], [-1, -1, false]];
    for (const [dx, dy, direct] of cells) {
      const c = col + dx;
      const r = row + dy;
      if (c < 0 || r < 0 || c >= this.width) continue;
      if (type === 'dynamite' || (type === 'black' && !direct)) this.igniteAt(c, r);
      else this.explosionAt(col, row, c, r, type === 'black' ? 0 : 3);
    }
  }

  /** "ignite" to stone and item of a cell. */
  private igniteAt(c: number, r: number): void {
    for (const o of [...this.at(c, r)]) {
      if (o.gone) continue;
      if (o.cls === 'breakstone' && explosionBreaks(breakType(o))) this.breakStone(o);
      else if (o.cls === 'ice') this.breakStone(o);
      else if (o.cls === 'dynamite' || o.cls === 'bomb') this.burn(o);
      else if (o.cls === 'crack') this.crack(o);
      else if (o.cls === 'burnable') this.floorIgnite(c, r);
    }
  }

  /** world.cc explosion(): stone gets "_explosion"; the item becomes an explosion (stronger wins). */
  private explosionAt(sc: number, sr: number, c: number, r: number, strength: number): void {
    for (const o of [...this.at(c, r)]) {
      if (o.gone || isItem(o)) continue;
      if (o.cls === 'dispenser' || o.cls === 'ice') this.breakStone(o); // DispenserStone/IceBlock "_explosion"
      if (o.cls === 'brake') this.brakeExplode(o);
      if (o.cls === 'breakstone' && explosionBreaks(breakType(o))) this.breakStone(o);
      else if (o.cls === 'window' && !truthy(o.attrs.secure)) {
        // WindowStone "_explosion": the faces towards the explosion (all, if it is here) break
        let faces = windowFaces(o);
        for (const [bit, dx, dy] of [[WEST, -1, 0], [SOUTH, 0, 1], [EAST, 1, 0], [NORTH, 0, -1]] as const) {
          if ((faces & bit) && ((c + dx === sc && r + dy === sr) || (c === sc && r === sr))) faces &= ~bit;
        }
        if (faces !== windowFaces(o)) {
          o.attrs = { ...o.attrs, $connections: String(ALL_FACES ^ faces) };
          this.events.push({ type: 'sound', name: 'glass' });
          if (!faces) this.remove(o);
        }
      }
    }
    if (c === sc && r === sr) return;
    const item = this.at(c, r).find((x) => !x.gone && isItem(x));
    if (item) {
      if (item.cls === 'explosion') {
        if (strength > item.state) {
          this.remove(item);
          this.addExplosion(c, r, strength);
        }
        return;
      }
      if (item.cls === 'dynamite' || item.cls === 'bomb') {
        this.burn(item);
        return;
      }
      if (item.cls === 'crack') {
        // Crack::message "_explosion": debris
        this.remove(item);
        const d = this.add(this.crackWater(item) ? 'it_debris_water' : 'it_debris', 'debris', c, r);
        d.blast = this.now;
        return;
      }
      if (item.cls === 'landmine') {
        this.explode(item);
        return;
      }
      if (item.cls === 'burnable') {
        // BurnableItem "_explosion": the floor gets "ignite"
        this.floorIgnite(c, r);
        return;
      }
      if (INDESTRUCTIBLE.has(item.cls)) return;
      this.remove(item);
    }
    this.addExplosion(c, r, strength);
  }

  private blastStep(o: GameObject): void {
    if (o.blast === undefined && (o.kind.endsWith('_burning') || ((o.cls === 'dynamite' || o.cls === 'bomb') && o.attrs.$state === '1'))) o.blast = this.now;
    if (o.cls === 'bomb') {
      if (o.igniteAt !== undefined && this.now >= o.igniteAt) this.bombExplode(o);
      else if (o.blast !== undefined && this.now - o.blast >= 9 * 100) this.bombExplode(o);
      return;
    }
    if (o.blast === undefined) return;
    const age = this.now - o.blast;
    if (o.cls === 'dynamite') {
      if (age >= 15 * 100) this.dynamiteExplode(o);
      return;
    }
    if (o.cls === 'puller') {
      // PullerItem::animcb: the stone on the far side gets an impulse towards it, then it vanishes
      if (age < 16 * 100) return;
      const d = DIR_LETTER[/^it_puller_([nesw])$/.exec(o.kind)?.[1] ?? 'w'];
      this.remove(o);
      this.sendImpulse(o.col - L_DX[d], o.row - L_DY[d], d);
      this.events.push({ type: 'sound', name: 'landmine' });
      this.addExplosion(o.col, o.row, 0);
      return;
    }
    if (o.cls === 'debris') {
      // Debris::animcb: the floor breaks away
      if (age >= 8 * 50) {
        this.remove(o);
        this.env.setFloor(o.col, o.row, o.kind === 'it_debris_water' ? 'fl_water' : 'fl_abyss');
        this.events.push({ type: 'floor', col: o.col, row: o.row });
      }
      return;
    }
    // Explosion::animcb: hollow, water crack or debris on a destructible floor, else nothing
    if (age < EXPLOSION_MS) return;
    this.remove(o);
    const floor = this.env.floorAt(o.col, o.row);
    if (o.state === 0 || HARD_FLOORS.has(floor)) return;
    if (o.state === 1) {
      const h = this.add('it_meditation_hollow', 'meditation', o.col, o.row);
      h.state = -2;
    } else if (o.state === 2) {
      const k = this.add('it_crack_m_water', 'crack', o.col, o.row);
      k.state = 1;
      k.attrs = { flavor: 'water' };
    } else {
      const d = this.add(floor === 'fl_water' ? 'it_debris_water' : 'it_debris', 'debris', o.col, o.row);
      d.blast = this.now;
    }
  }

  /** Render frames: dynamite idle / burning 15, bombs from the it_bomb sheet, debris 8 × 50 ms. */
  blastLook(o: GameObject): { image: string; col: number; row: number } {
    const age = o.blast === undefined ? -1 : this.now - o.blast;
    if (o.cls === 'explosion') return { image: 'it_explosion', col: 0, row: 0 };
    if (o.cls === 'debris') return { image: o.kind === 'it_debris_water' ? 'it_crack_water' : 'it_crack_abyss', col: 0, row: Math.min(7, Math.floor(age / 50)) };
    if (o.cls === 'dynamite') return age < 0 ? { image: 'it_dynamite', col: 0, row: 0 } : { image: 'it_dynamite_burning', col: 0, row: Math.min(14, Math.floor(age / 100)) };
    // it_bomb: column 0 black, 1 white; row 0 idle, 1..9 burning
    return { image: 'it_bomb', col: this.bombBlack(o) ? 0 : 1, row: age < 0 ? 0 : 1 + Math.min(8, Math.floor(age / 100)) };
  }

/** Stone::transform: the stone becomes another one – a plain map stone or an object. */
  private transformStone(o: GameObject, kind: string): void {
    this.events.push({ type: 'sound', name: 'switch' });
    this.remove(o);
    const cls = objectClass(kind);
    if (cls) {
      const n = this.add(kind, cls, o.col, o.row);
      if (kind === 'st_puzzle_yellow') n.attrs = { color: '3' };
      n.state = initialState(kind, n.attrs);
      this.shatterAt(o.col, o.row);
    } else if (kind.endsWith('_hollow')) this.env.setStaticStone?.(o.col, o.row, kind.replace(/_hollow$/, ''), true);
    else {
      this.env.setStaticStone?.(o.col, o.row, kind);
      this.shatterAt(o.col, o.row);
    }
  }

/** MonoFlopStone::setState(1): off → on with its action; on → the timer starts again. */
  private monoflopOn(o: GameObject): void {
    const ms = (Number(o.attrs.interval) || 1.8) * 1000;
    if (o.lasered) return; // ON_LASER: setState(1) changes nothing
    if (o.state === 1) {
      o.alarmAt = this.now + ms;
      return;
    }
    o.state = 1;
    o.alarmAt = this.now + ms;
    this.events.push({ type: 'sound', name: 'switch' });
    this.performAction(o, true);
  }

  /** Centre of a stone object by its id, following its move animation (rubber band anchors). */
  anchorAt(id: string): { x: number; y: number } | null {
    const o = this.objects.find((x) => x.id === id && !x.gone);
    return o ? { x: o.col + 0.5, y: o.row + 0.5 } : null;
  }

  // ---------- volcano (VolcanoStone.cc) ----------

  private volcanoSet(o: GameObject, s: number): void {
    o.state = s;
    o.blast = this.now;
  }

  /** VolcanoStone::animcb: new → growing → active; each quake cycle spreads and may finish; breaking ends. */
  private volcanoStep(o: GameObject): void {
    const age = this.now - (o.blast ?? 0);
    if (o.state === 2 && age >= SEED_GROW_MS) {
      this.volcanoSet(o, 3);
      this.updateTriggers(o.col, o.row);
    } else if (o.state === 3 && age >= 3 * 80) this.volcanoSet(o, 1);
    else if (o.state === 4 && age >= 6 * 50) this.remove(o);
    else if (o.state === 1 && age >= VOLCANO_QUAKE_MS) {
      for (const d of [3, 2, 1, 0]) if (this.random() > 0.7) this.volcanoSpread(o, o.col + L_DX[d], o.row + L_DY[d]);
      if ((!truthy(o.attrs.secure) || this.volcanoSurrounded(o)) && this.random() > 0.95) this.volcanoSet(o, 5);
      else o.blast = this.now;
    }
    // actor_inside: growing, active and breaking volcanos shatter actors in their cell
    if (o.state === 1 || o.state === 3 || o.state === 4) this.shatterAt(o.col, o.row);
  }

  private volcanoSpread(o: GameObject, c: number, r: number): void {
    if (c < 0 || r < 0 || c >= this.width || this.env.stoneAt(c, r) || this.stoneObjectAt(c, r)) return;
    const n = this.add('st_volcano_new', 'volcano', c, r);
    n.state = 2;
    n.blast = this.now;
    n.attrs = { secure: o.attrs.secure ?? '' };
  }

  /** neighborsVulcanized: every free neighbour has another active volcano next to it. */
  private volcanoSurrounded(o: GameObject): boolean {
    for (let d = 0; d < 4; d++) {
      const c = o.col + L_DX[d];
      const r = o.row + L_DY[d];
      if (this.env.stoneAt(c, r) || this.stoneObjectAt(c, r)) continue;
      let ok = false;
      for (let e = 0; e < 4 && !ok; e++) {
        const v = this.stoneObjectAt(c + L_DX[e], r + L_DY[e]);
        ok = !!v && v !== o && v.cls === 'volcano' && (v.state === 1 || v.state === 2 || v.state === 3);
      }
      if (!ok) return false;
    }
    return true;
  }

  /** Image and frame of a volcano. */
  volcanoLook(o: GameObject): { image: string; frame: number; shadow: string } {
    const age = Math.max(0, this.now - (o.blast ?? 0));
    if (o.state === 2) return { image: 'it_seed', frame: SEED_GROW_FRAMES[Math.min(SEED_GROW_FRAMES.length - 1, Math.floor(age / 120))], shadow: '' };
    if (o.state === 3) return { image: 'st_volcano_growing', frame: Math.min(2, Math.floor(age / 80)), shadow: 'sh_round' };
    if (o.state === 1) return { image: 'st_quake', frame: [0, 1, 2, 3, 3, 2, 1, 0][Math.floor(age / 50) % 8], shadow: 'sh_round' };
    if (o.state === 4) return { image: 'st_quake_break', frame: Math.min(5, Math.floor(age / 50)), shadow: 'sh_round' };
    return { image: 'st_flat', frame: 0, shadow: 'sh_solid' };
  }

  /** ScissorsStone: the cut succeeded – perform the action (true). */
  scissorsCut(col: number, row: number): void {
    const o = this.at(col, row).find((x) => x.cls === 'scissors' && !x.gone);
    if (o) this.performAction(o, true);
  }

  /**
   * Glasses::updateGlasses: what the current player sees through glasses in the inventory
   * (it_glasses = DEATH 1 + HOLLOW 2 + LIGHTPASSENGER 16; broken ones nothing).
   */
  glassesBits(): number {
    return this.inventory.includes('it_glasses') ? 1 | 2 | 16 : 0;
  }

/** Attributes of a carried item (inventory kind "it_rubberband#n"). */
  carriedAttrs(kind: string): Record<string, string> {
    return this.carried.get(kind) ?? {};
  }

  /** The first inventory item is used up (ITEM_KILL). */
  useFirst(): void {
    const k = this.inventory.shift();
    if (k) this.carried.delete(k);
  }

  /** An object by name, or "@@pattern": the one matching nearest to x/y (RubberbandItem anchor2). */
  findAnchor(name: string, x: number, y: number): { x: number; y: number; id: string } | null {
    const nearest = name.startsWith('@@');
    const p = nearest ? name.slice(2) : name;
    const re = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    let best: GameObject | null = null;
    let bd = Infinity;
    for (const o of this.objects) {
      if (o.gone || !o.name || !re.test(o.name)) continue;
      const d = Math.hypot(o.col + 0.5 - x, o.row + 0.5 - y);
      if (!nearest) return { x: o.col + 0.5, y: o.row + 0.5, id: o.id };
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best ? { x: best.col + 0.5, y: best.row + 0.5, id: best.id } : null;
  }

  /** BrakeStone::explode: gone, it_explosion_nil in its place. */
  private brakeExplode(o: GameObject): void {
    if (o.gone) return;
    this.remove(o);
    if (!this.itemAt(o.col, o.row)) this.addExplosion(o.col, o.row, 0);
  }

  // ---------- spitter and cannonballs (SpitterStone.cc, CannonBall.cc) ----------

  /** Flying cannonballs: start position, velocity and start time (flight = the jump animation, 0.56 s). */
  private balls: { x: number; y: number; vx: number; vy: number; t0: number }[] = [];

  private spitterStep(o: GameObject): void {
    const s = o.spit;
    if (!s || s.phase === 'active') return;
    const age = this.now - s.since;
    if (s.phase === 'loading' && age >= 5 * 100 + 50) {
      this.balls.push({ x: o.col + 0.5, y: o.row + 0.5, vx: s.vx, vy: s.vy, t0: this.now });
      o.spit = { ...s, phase: 'spitting', since: this.now };
    } else if (s.phase === 'spitting' && age >= 6 * 175) o.spit = { ...s, phase: 'active', since: this.now };
    else if (s.phase === 'breaking' && age >= 6 * 100) {
      // SpitterStone::animcb BREAKING: a meditation hollow remains
      this.remove(o);
      if (!this.itemAt(o.col, o.row)) {
        const h = this.add('it_meditation_hollow', 'meditation', o.col, o.row);
        h.state = -2;
      }
    }
  }

  private ballStep(): void {
    for (let k = this.balls.length - 1; k >= 0; k--) {
      const b = this.balls[k];
      if (this.now - b.t0 < CANNON_MS) continue;
      this.balls.splice(k, 1);
      const t = CANNON_MS / 1000;
      this.cannonLand(Math.floor(b.x + b.vx * t), Math.floor(b.y + b.vy * t));
    }
  }

  /** CannonBall::animcb: the stone gets "_cannonball", else the item, else the floor breaks. */
  private cannonLand(c: number, r: number): void {
    if (c < 0 || r < 0 || c >= this.width) return;
    const st = this.stoneObjectAt(c, r);
    const fixed = st ? null : this.env.staticStone?.(c, r);
    if (st || fixed) {
      if (st?.cls === 'yystone' && st.state === 0) this.yinyangActivate(st);
      else if (st?.cls === 'spitter' && !truthy(st.attrs.secure)) st.spit = { phase: 'breaking', since: this.now, vx: 0, vy: 0 };
      else if (st?.cls === 'ice') this.breakStone(st);
      else if (st?.cls === 'impulse') this.startImpulse(st, -1);
      else if (st?.cls === 'puzzle') this.explodePuzzle(st);
      else if (fixed === 'st_oxyd') this.events.push({ type: 'oxyd', col: c, row: r }); // OxydStone "_cannonball": tryOpen
      else if (fixed === 'st_brownpyramid') this.env.setStaticStone?.(c, r, null);
      return;
    }
    const it = this.itemAt(c, r);
    if (it) {
      if (it.cls === 'dynamite' || it.cls === 'bomb') {
        if (it.cls === 'bomb') this.bombExplode(it);
        else this.dynamiteExplode(it);
      } else if (it.cls === 'crack') {
        this.remove(it);
        const d = this.add(this.crackWater(it) ? 'it_debris_water' : 'it_debris', 'debris', c, r);
        d.blast = this.now;
      } else if (!INDESTRUCTIBLE.has(it.cls)) {
        this.remove(it);
        this.addExplosion(c, r, 3);
        return;
      }
      this.shatterAt(c, r);
      return;
    }
    if (HARD_FLOORS.has(this.env.floorAt(c, r))) this.shatterAt(c, r);
    else this.addExplosion(c, r, 3);
  }

  /** Flying cannonballs for the renderer: position and flight progress 0..1. */
  cannonballs(): { x: number; y: number; t: number }[] {
    return this.balls.map((b) => {
      const t = Math.min(1, (this.now - b.t0) / CANNON_MS);
      return { x: b.x + (b.vx * t * CANNON_MS) / 1000, y: b.y + (b.vy * t * CANNON_MS) / 1000, t };
    });
  }

  /** Image and frame of a spitter. */
  spitterLook(o: GameObject): { image: string; frame: number } {
    const s = o.spit;
    const age = s ? this.now - s.since : this.now;
    if (o.state === 0 && (!s || s.phase === 'active')) return { image: 'st_spitter_idle', frame: 0 };
    if (s?.phase === 'loading') return { image: 'st_spitter_loading', frame: Math.min(5, Math.floor(age / 100)) };
    if (s?.phase === 'spitting') return { image: 'st_spitter_spitting', frame: Math.min(5, Math.floor(age / 175)) };
    if (s?.phase === 'breaking') return { image: 'st_spitter_breaking', frame: Math.min(5, Math.floor(age / 100)) };
    return { image: 'st_spitter_idle', frame: Math.floor(this.now / 150) % 6 };
  }

  // YinyangStone: 0 idle, 1 active (turning), 2 inactive
  private yinyangActivate(o: GameObject): void {
    o.state = 1;
    o.pulse = this.now;
    if (yinyangInstant(o)) this.yinyangSwitch(o);
  }

  private yinyangSwitch(o: GameObject): void {
    this.events.push({ type: 'swapPlayer' });
    this.performAction(o, true);
  }

  /** The object whose action is being performed (Message::sender), e.g. for st_jamb. */
  private sender: GameObject | null = null;

  /** Milliseconds since a time of the object clock. */
  ageOf(t: number): number {
    return this.now - t;
  }

  /** PolarSwitchStone::setState: light glass (ON, transparent) or dark glass; performs its action. */
  private setPolar(o: GameObject, s: number): void {
    if (o.state === s) return;
    o.state = s;
    this.performAction(o, s === 1);
  }

  // ---------- fire (floors.cc fire system, BurnableItem.cc, Extinguisher.cc) ----------

  // ---------- flood (FloodStream.cc) ----------

  /** FloodStream cells in state FLOODING (index → interval in ms). */
  private flooding = new Map<number, number>();
  /** Their pending alarm (one-shot, GameTimer.set_alarm(…, false)). */
  private floodAlarm = new Map<number, number>();
  private floodInit = false;

  private floodInterval(c: number, r: number): number {
    const v = Number(this.env.floorAttr?.(c, r, 'interval'));
    return (Number.isFinite(v) && v > 0 ? v : 0.2) * 1000;
  }

  /** FloodStream::setState(FLOODING): water and framed wood/hay/rock; the alarm starts. */
  private startFlood(c: number, r: number, ms: number): void {
    const idx = r * this.width + c;
    if (this.flooding.has(idx)) return;
    this.flooding.set(idx, ms);
    this.floodAlarm.set(idx, this.now + ms);
  }

  /** FloodStream::message "_checkflood" (a stone changed nearby): flooding cells try again. */
  private floodCheck(col: number, row: number): void {
    if (!this.flooding.size) return;
    for (const [dx, dy] of [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const idx = (row + dy) * this.width + col + dx;
      const ms = this.flooding.get(idx);
      if (ms !== undefined && !this.floodAlarm.has(idx)) this.floodAlarm.set(idx, this.now + ms);
    }
  }

  /** Water kills cracks and burnable items (not oil) where it appears. */
  private floodItems(c: number, r: number): void {
    for (const it of [...this.at(c, r)]) {
      if (it.gone) continue;
      if (it.cls === 'crack' || (it.cls === 'burnable' && burnState(it) !== 'oil')) this.remove(it);
    }
  }

  /** FloodStream::tryFlood from a flooding neighbour (from: Enigma direction back to it). */
  private tryFlood(c: number, r: number, from: number, ms: number): void {
    if (c < 0 || r < 0 || c >= this.width) return;
    const floor = this.env.floorAt(c, r);
    if (floor === 'fl_water' || /^fl_(wood|hay|rock)_framed/.test(floor)) {
      if (floor === 'fl_water') this.floodItems(c, r);
      this.startFlood(c, r, ms);
      return;
    }
    if (!truthy(this.env.floorAttr?.(c, r, 'floodable') ?? '')) return;
    const st = this.stoneObjectAt(c, r);
    if (st ? !(st.cls === 'box' || this.allowsSpreading(st, from)) : this.env.staticStone?.(c, r)) return;
    // fl_water_source: new flooding water; a box on it sinks and becomes a bridge
    this.env.setFloor(c, r, 'fl_water');
    this.events.push({ type: 'floor', col: c, row: r });
    this.floodItems(c, r);
    if (st && st.kind.startsWith('st_box')) {
      this.remove(st);
      this.env.setFloor(c, r, bridgeFloor(st.kind));
      this.events.push({ type: 'sound', name: 'move' });
      return;
    }
    this.startFlood(c, r, ms);
  }

  /** FloodStream::alarm: flood the four neighbours the stone here lets through. */
  private floodStep(): void {
    if (!this.floodInit) {
      this.floodInit = true;
      for (const [c, r] of this.env.floodSources?.() ?? []) this.startFlood(c, r, this.floodInterval(c, r));
    }
    for (const [idx, at] of [...this.floodAlarm]) {
      if (this.now < at) continue;
      this.floodAlarm.delete(idx);
      const c = idx % this.width;
      const r = Math.floor(idx / this.width);
      const floor = this.env.floorAt(c, r);
      if (floor !== 'fl_water' && !/^fl_(wood|hay|rock)_framed/.test(floor)) {
        this.flooding.delete(idx); // the floor changed (bridge): no more flood here
        continue;
      }
      const st = this.stoneObjectAt(c, r);
      if (!st && this.env.staticStone?.(c, r)) continue;
      const ms = this.flooding.get(idx) ?? 200;
      for (const d of [3, 2, 1, 0]) {
        if (st && !(st.cls === 'box' || this.allowsSpreading(st, d))) continue;
        this.tryFlood(c + L_DX[d], r + L_DY[d], (d + 2) % 4, ms);
      }
    }
  }

  /** Floor::fire_countdown per cell (default 1). */
  private fireCountdown = new Map<number, number>();
  /** Floors in their heating animation: start and the floor they become. */
  private heating = new Map<number, { since: number; to: string; from: string }>();

  /** Floor::has_firetype: burnable items decide burnable/ignitable, else the floor (attribute or default). */
  private fireType(c: number, r: number, key: 'burnable' | 'ignitable' | 'secure' | 'eternal' | 'noash' | 'fastfire'): boolean {
    const it = this.itemAt(c, r);
    if (it?.cls === 'burnable' && (key === 'burnable' || key === 'ignitable')) {
      const s = burnState(it);
      if (s === 'invisible' || s === 'oil') return true;
      return false;
    }
    const v = this.env.floorAttr?.(c, r, key);
    if (v !== undefined && v !== '') return truthy(v);
    const floor = this.env.floorAt(c, r);
    if (key === 'burnable') return BURNABLE_FLOORS.test(floor);
    if (key === 'noash') return NOASH_FLOORS.test(floor);
    return false;
  }

  private fireproof(it: GameObject): boolean {
    if (it.cls === 'burnable') return burnState(it) !== 'invisible' && burnState(it) !== 'oil';
    return FIREPROOF_CLASSES.has(it.cls) || /^it_extinguisher(_full|_medium)?$/.test(it.kind) || it.kind === 'it_trap';
  }

  /** Stone::allowsSpreading (dir in Enigma order, -1 = none): floating stones, open doors, window faces. */
  private allowsSpreading(st: GameObject, dir: number): boolean {
    if (st.cls === 'door') return st.state === 1 || !!st.moving;
    if (st.cls === 'window') return dir < 0 || !(windowFaces(st) & (1 << dir));
    if (st.cls === 'puzzle') return st.kind.includes('hollow') || truthy(st.attrs.hollow);
    if (st.cls === 'chameleon') return true;
    return false;
  }

  private movableStone(st: GameObject): boolean {
    return st.cls === 'box' || st.cls === 'ice' || st.kind.endsWith('_movable');
  }

  /** Floor::force_fire: it_burnable_ignited replaces the item here. */
  private forceFire(c: number, r: number): boolean {
    for (const it of [...this.at(c, r)]) if (!it.gone && isItem(it)) this.remove(it);
    const f = this.add('it_burnable_ignited', 'burnable', c, r);
    f.blast = this.now;
    this.fireCountdown.set(r * this.width + c, 0);
    return true;
  }

  /** Floor "ignite" (from the burnable item): only if the floor is ignitable. */
  private floorIgnite(c: number, r: number): void {
    if (this.fireType(c, r, 'ignitable')) this.tryIgnite(c, r, -1, { message: true, first: false, last: false });
  }

  /** Floor::try_ignite (Enigma mode). */
  private tryIgnite(c: number, r: number, src: number, f: FireFlags): boolean {
    if (c < 0 || r < 0 || c >= this.width) return false;
    const idx = r * this.width + c;
    if (this.heating.has(idx)) return false;
    const st = this.stoneObjectAt(c, r);
    if (st) {
      if (!this.movableStone(st) && !this.allowsSpreading(st, src)) return false;
    } else if (this.env.staticStone?.(c, r)) return false;
    if (!this.fireType(c, r, 'burnable')) return false;
    const it = this.itemAt(c, r);
    if (it) return this.fireproof(it) ? false : this.forceFire(c, r);
    const it2 = this.at(c, r).find((o) => o.cls === 'burnable' && !o.gone);
    const cd = it2 && (burnState(it2) === 'invisible' || burnState(it2) === 'oil') ? 0 : (this.fireCountdown.get(idx) ?? 1);
    if (cd === 0 || f.message || this.fireType(c, r, 'fastfire') || (f.last && this.fireType(c, r, 'secure'))) return this.forceFire(c, r);
    this.fireCountdown.set(idx, Math.max(cd - 1, 0));
    return false;
  }

  /** Item "heat": dynamite and bombs start burning, cracks break (caught: no fire). */
  private heatItem(it: GameObject): boolean {
    if (it.cls === 'dynamite' || it.cls === 'bomb') {
      this.burn(it);
      return true;
    }
    if (it.cls === 'crack') {
      this.remove(it);
      const d = this.add(this.crackWater(it) ? 'it_debris_water' : 'it_debris', 'debris', it.col, it.row);
      d.blast = this.now;
      return true;
    }
    return false;
  }

  /** Stone "heat": st_box_rock blocks the fire. */
  private heatStone(st: GameObject): boolean {
    if (st.cls === 'breakstone' && breakType(st) === 'fire') {
      this.breakStone(st); // FlatStone "heat" (burnable, not movable)
      return true;
    }
    return st.kind === 'st_box_rock';
  }

  /** Floor::on_heattransform: ice, water and swamp start their heating animation. */
  private heatFloor(c: number, r: number, f: FireFlags): boolean {
    const floor = this.env.floorAt(c, r);
    const to = heatTransform(floor);
    if (!(f.message || f.first) || !to) return false;
    const idx = r * this.width + c;
    if (!this.heating.has(idx)) this.heating.set(idx, { since: this.now, to, from: floor.startsWith('fl_ice') ? 'fl_ice' : floor.startsWith('fl_water') ? 'fl_water' : 'fl_swamp' });
    return true;
  }

  /** Floor::try_heating. */
  private tryHeating(c: number, r: number, src: number, f: FireFlags): boolean {
    if (c < 0 || r < 0 || c >= this.width) return false;
    const secure = f.last && this.fireType(c, r, 'secure');
    const doItem = f.message || secure || this.random() > 0.3;
    let reaction = false;
    if (doItem) {
      const it = this.itemAt(c, r);
      if (it && this.heatItem(it)) reaction = true;
    }
    reaction = this.heatFloor(c, r, f) || reaction;
    if (doItem) {
      const st = this.stoneObjectAt(c, r);
      if (st && this.heatStone(st)) reaction = true;
    }
    if (doItem && !reaction) return this.tryIgnite(c, r, src, f);
    return reaction;
  }

  /** Floor::stop_fire: the item goes, the floor may transform, ash unless the new floor is noash. */
  private stopFire(c: number, r: number): void {
    for (const it of [...this.at(c, r)]) if (!it.gone && isItem(it)) this.remove(it);
    this.fireCountdown.delete(r * this.width + c);
    const to = fireTransform(this.env.floorAt(c, r));
    if (to) {
      this.env.setFloor(c, r, to);
      this.events.push({ type: 'floor', col: c, row: r });
    }
    if (!this.fireType(c, r, 'noash')) this.add('it_burnable_ash', 'burnable', c, r);
  }

  /** Floor::on_burnable_animcb: burn the stone here, heat the neighbours, burn on or stop. */
  private burnableStep(o: GameObject): void {
    const s = burnState(o);
    if (s !== 'ignited' && s !== 'burning') return;
    // fire placed in the level burns from the start (blast unset = 0)
    if (this.now - (o.blast ?? 0) < FIRE_MS) return;
    const { col: c, row: r } = o;
    const justIgnited = s === 'ignited';
    // stone "_fire": wood and hay boxes burn away
    const here = this.stoneObjectAt(c, r);
    if (here && /^st_box_(wood|hay)/.test(here.kind)) this.remove(here);
    else if (here?.cls === 'breakstone' && breakType(here) === 'fire') this.breakStone(here); // FlatStone "_fire"
    const cont = justIgnited || this.fireType(c, r, 'eternal') || this.random() < 0.7;
    const f: FireFlags = { message: false, first: justIgnited, last: !cont };
    const st = this.stoneObjectAt(c, r);
    const fixed = !st && !!this.env.staticStone?.(c, r);
    for (const d of [3, 2, 1, 0]) {
      if (fixed || (st && !this.allowsSpreading(st, d))) continue;
      this.tryHeating(c + L_DX[d], r + L_DY[d], (d + 2) % 4, f);
    }
    if (o.gone) return;
    if (cont) {
      this.remove(o);
      const n = this.add('it_burnable_burning', 'burnable', c, r);
      n.blast = this.now;
    } else this.stopFire(c, r);
  }

  /** Floor::animcb: the heating animation ended – the floor transforms. */
  private heatingStep(): void {
    for (const [idx, h] of this.heating) {
      if (this.now - h.since < HEATING_MS) continue;
      this.heating.delete(idx);
      const c = idx % this.width;
      const r = Math.floor(idx / this.width);
      this.env.setFloor(c, r, h.to);
      this.events.push({ type: 'floor', col: c, row: r });
    }
  }

  /** Heating floors for the renderer: cell, animation image and frame. */
  heatingCells(): { col: number; row: number; image: string; frame: number }[] {
    return [...this.heating].map(([idx, h]) => ({
      col: idx % this.width,
      row: Math.floor(idx / this.width),
      image: `${h.from}_heating`,
      frame: Math.min(7, Math.floor((this.now - h.since) / 240)),
    }));
  }

  /** it_burnable look: image and frame (null = invisible). */
  burnableLook(o: GameObject): { image: string; frame: number } | null {
    const s = burnState(o);
    const age = o.blast === undefined ? 0 : Math.max(0, this.now - o.blast);
    if (s === 'oil') return { image: 'it_burnable_oil', frame: (o.col * 7 + o.row * 3) % 4 };
    if (s === 'ignited') return { image: 'it_burnable_ignite', frame: Math.min(7, Math.floor(age / 100)) };
    if (s === 'burning') return { image: 'it_burnable_burning', frame: Math.min(7, Math.floor(age / 100)) };
    if (s === 'ash' || s === 'fireproof') return { image: `it_burnable_${s}`, frame: -1 };
    return null;
  }

/**
   * Brush::activate: "_brush" to the item under the marble – ash, foam, squashed cherries and
   * crosses are cleaned away. The brush is dropped afterwards (ITEM_DROP).
   */
  brushAt(x: number, y: number): void {
    const it = this.itemAt(Math.floor(x), Math.floor(y));
    if (!it) return;
    if ((it.cls === 'burnable' && (burnState(it) === 'ash' || burnState(it) === 'fireproof')) || it.cls === 'squashed' || it.cls === 'cross' || it.kind === 'it_bottle_broken') this.remove(it);
  }

  /**
   * Pencil::activate: a cross (on ice a small water crack) under the marble; the pencil is used up.
   * False: nothing drawn (an item lies there, or abyss, water, swamp, bridge) – it stays.
   */
  pencilAt(x: number, y: number): boolean {
    const c = Math.floor(x);
    const r = Math.floor(y);
    if (this.itemAt(c, r)) return false;
    const floor = this.env.floorAt(c, r);
    if (/^fl_(abyss|water|swamp|bridge)/.test(floor)) return false;
    if (floor === 'fl_ice') {
      const k = this.add('it_crack_s_water', 'crack', c, r);
      k.attrs = { flavor: 'water' };
    } else this.add('it_cross', 'cross', c, r);
    this.inventory.shift();
    return true;
  }

  /** Spade::activate: "shovel" to the item under the marble (meditation hollows and hills). False: no item – dropped. */
  spadeAt(x: number, y: number): boolean {
    const it = this.itemAt(Math.floor(x), Math.floor(y));
    if (!it) return false;
    if (it.cls === 'meditation') this.shovel(it);
    return true;
  }

  /** Extinguisher::extinguish: burnable items become fireproof; free cells get foam. */
  private extinguish(c: number, r: number): void {
    if (c < 0 || r < 0 || c >= this.width || this.env.floorAt(c, r) === 'fl_abyss' && this.env.stoneAt(c, r)) return;
    const it = this.itemAt(c, r);
    if (it) {
      if (it.cls === 'burnable') {
        it.kind = 'it_burnable_fireproof';
        it.blast = undefined;
      }
    } else this.add('it_burnable_fireproof', 'burnable', c, r);
  }

  /**
   * Extinguisher::activate with the first inventory item: full (13 cells) or medium (5 cells),
   * then one step emptier. False: empty – the caller drops it (ITEM_DROP).
   */
  useExtinguisher(x: number, y: number): boolean {
    const k = this.inventory[0] ?? '';
    const state = k === 'it_extinguisher_empty' ? 0 : k === 'it_extinguisher_medium' ? 1 : 2;
    if (state < 1) return false;
    const c = Math.floor(x);
    const r = Math.floor(y);
    const cells = [[0, 0], [0, -1], [0, 1], [1, 0], [-1, 0]];
    if (state === 2) cells.push([0, -2], [1, -1], [0, 2], [-1, 1], [2, 0], [1, 1], [-2, 0], [-1, -1]);
    for (const [dx, dy] of cells) this.extinguish(c + dx, r + dy);
    this.inventory[0] = state === 2 ? 'it_extinguisher_medium' : 'it_extinguisher_empty';
    return true;
  }

  // ---------- shoguns (ShogunStone.cc, ShogunDot.cc) ----------

  /**
   * ShogunStone::on_impulse: the innermost (smallest) piece of the stack moves – onto a free cell or
   * into a stack whose pieces are all bigger; actors there shatter.
   */
  private shogunMove(o: GameObject, dx: number, dy: number): void {
    if (o.gone || !o.state) return;
    const piece = o.state & -o.state;
    const c = o.col + dx;
    const r = o.row + dy;
    if (c < 0 || r < 0 || c >= this.width) return;
    const target = this.at(c, r).find((x) => x.cls === 'shogun' && !x.gone);
    if (target) {
      if ((target.state & (2 * piece - 1)) !== 0) return;
    } else if (this.stoneAt(c, r)) return;
    o.state &= ~piece;
    if (!o.state) this.remove(o);
    if (target) target.state |= piece;
    else {
      const n = this.add('st_shogun', 'shogun', c, r);
      n.state = piece;
    }
    this.events.push({ type: 'sound', name: 'move' });
    this.shatterAt(c, r);
    this.updateTriggers(o.col, o.row);
    this.updateTriggers(c, r);
  }

  /** ShogunDot: active while exactly its stack stands on it (s; s+m; s+m+l); acts on changes. */
  private shogunDotStep(o: GameObject): void {
    const holes = /^it_shogun_l$/.test(o.kind) ? 16 : o.kind === 'it_shogun_m' ? 8 : 4;
    const required = ((holes / 4) * 2 - 1) * 4;
    const st = this.at(o.col, o.row).find((x) => x.cls === 'shogun' && !x.gone);
    const on = st && st.state === required ? 1 : 0;
    if (o.scales === undefined) {
      o.scales = true; // first check: no action
      o.state = on;
      return;
    }
    if (on === o.state) return;
    o.state = on;
    this.performAction(o, on === 1);
  }

  /** st_shogun: frame = holes / 4 − 1; shadow of the smallest piece. */
  shogunLook(o: GameObject): { frame: number; shadow: string } {
    const m = o.state & 28;
    return { frame: Math.max(0, Math.min(6, m / 4 - 1)), shadow: m & 4 ? 'sh_shogun_s' : m & 8 ? 'sh_shogun_m' : 'sh_shogun_l' };
  }

  // ---------- turnstiles (Turnstile.cc) ----------

  /** TurnstileArm::on_impulse: rotate the pivot (actions by arm side and impulse), else move. */
  private armImpulse(o: GameObject, d: number, sender: number): void {
    if (d < 0) return;
    const s = o.state;
    const pivot = this.at(o.col - L_DX[s], o.row - L_DY[s]).find((x) => x.cls === 'turnstile' && !x.gone);
    if (!pivot) {
      this.push(o, L_DX[d], L_DY[d]);
      return;
    }
    // [arm side][impulse]: 1 = right (clockwise), -1 = left, 0 = stay (W S E N)
    const ACTIONS = [[0, -1, 0, 1], [1, 0, -1, 0], [0, 1, 0, -1], [-1, 0, 1, 0]];
    const a = ACTIONS[s][d];
    if (!a) return;
    let cw = a === 1;
    if (!this.turnstileRed(pivot) && sender >= 0 && this.wields('it_wrench')) cw = !cw;
    this.rotateTurnstile(pivot, cw, sender, o);
  }

  private turnstileRed(p: GameObject): boolean {
    return (p.attrs.flavor || (p.kind === 'st_turnstile_green' ? 'green' : 'red')) !== 'green';
  }

  /** The arms of a pivot by side bit (W 1, S 2, E 4, N 8). */
  private turnstileArms(p: GameObject): Map<number, GameObject> {
    const arms = new Map<number, GameObject>();
    for (let d = 0; d < 4; d++) {
      const a = this.at(p.col + L_DX[d], p.row + L_DY[d]).find((x) => x.cls === 'turnstilearm' && !x.gone && x.state === d);
      if (a) arms.set(d, a);
    }
    return arms;
  }

  /** TurnstilePivot::rotate: only if the swept cells are free; arms move, items get hit. */
  private rotateTurnstile(p: GameObject, cw: boolean, sender: number, initiator: GameObject | null): boolean {
    if (p.pivotTurn !== undefined && this.now - p.pivotTurn < 60) return false;
    const arms = this.turnstileArms(p);
    const bits = [...arms.keys()].reduce((b, d) => b | (1 << d), 0);
    const free = (dx: number, dy: number) => !this.stoneAt(p.col + dx, p.row + dy);
    let ok = true;
    if (cw) {
      if (bits & L_N) ok &&= free(1, -1) && (!!(bits & L_E) || free(1, 0));
      if (bits & L_W) ok &&= free(-1, -1) && (!!(bits & L_N) || free(0, -1));
      if (bits & L_S) ok &&= free(-1, 1) && (!!(bits & L_W) || free(-1, 0));
      if (bits & L_E) ok &&= free(1, 1) && (!!(bits & L_S) || free(0, 1));
    } else {
      if (bits & L_N) ok &&= free(-1, -1) && (!!(bits & L_W) || free(-1, 0));
      if (bits & L_W) ok &&= free(-1, 1) && (!!(bits & L_S) || free(0, 1));
      if (bits & L_S) ok &&= free(1, 1) && (!!(bits & L_E) || free(1, 0));
      if (bits & L_E) ok &&= free(1, -1) && (!!(bits & L_N) || free(0, -1));
    }
    if (!ok) return false;
    p.pivotTurn = this.now;
    this.events.push({ type: 'sound', name: 'move' }); // movesmall; turnstileleft/right are missing in Enigma
    // rotate_arms: take them all off, then put them on their new sides
    const moved: [GameObject, number][] = [];
    for (const [d, a] of arms) {
      this.unplace(a);
      moved.push([a, cw ? (d + 3) % 4 : (d + 1) % 4]);
    }
    let newBits = 0;
    for (const [a, nd] of moved) {
      const [oc, or] = [a.col, a.row];
      a.col = p.col + L_DX[nd];
      a.row = p.row + L_DY[nd];
      a.state = nd;
      this.place(a);
      newBits |= 1 << nd;
      this.stoneHitsItems(a.col, a.row);
      this.updateTriggers(oc, or);
      this.updateTriggers(a.col, a.row);
    }
    // calc_arm_seen: the swept cells around the pivot (NW, N, NE, E, SE, S, SW, W)
    const NEEDED = [
      [L_W, L_N, L_N, L_E, L_E, L_S, L_S, L_W],
      [L_N, L_N, L_E, L_E, L_S, L_S, L_W, L_W],
    ];
    const TO_X = [-1, 0, 1, 1, 1, 0, -1, -1];
    const TO_Y = [-1, -1, -1, 0, 1, 1, 1, 0];
    const seen = NEEDED[cw ? 1 : 0].map((b) => (newBits & b) !== 0);
    seen.forEach((s, i) => s && this.stoneHitsItems(p.col + TO_X[i], p.row + TO_Y[i]));
    this.events.push({ type: 'turnstile', col: p.col, row: p.row, cw, red: this.turnstileRed(p), sender, seen });
    // the other arms pass the rotation on to the stones beyond them
    for (const [a, nd] of moved) if (a !== initiator) this.sendImpulse(a.col + L_DX[nd], a.row + L_DY[nd], nd);
    this.performAction(p, !cw);
    return true;
  }

  /** Pivot: st_turnstile(_green) frame 0, while turning frame 1 then 0 (2 × 30 ms). */
  turnstileLook(o: GameObject): { image: string; frame: number } {
    const age = o.pivotTurn === undefined ? 1e9 : this.now - o.pivotTurn;
    return { image: this.turnstileRed(o) ? 'st_turnstile' : 'st_turnstile_green', frame: age < 30 ? 1 : 0 };
  }

  // ---------- light passengers (LightPassengerStone.cc) ----------

  /**
   * LightPassengerStone::alarm: while lit and on, every interval (0.05 s) it skates along the light;
   * blocked, it pushes the stone ahead the next time; with light from both axes it keeps its way.
   */
  private passengerStep(o: GameObject): void {
    o.pass ??= { next: this.now, dir: -1, blocked: false, blink: false };
    const p = o.pass;
    if (p.breaking !== undefined) {
      if (this.now - p.breaking >= 7 * 50) this.remove(o);
      return;
    }
    const light = this.lit.get(o.row * this.width + o.col) ?? 0;
    if (o.state !== 1 || !light) {
      p.blink = false;
      p.next = this.now + numAttr(o.attrs.interval, 0.05) * 1000;
      return;
    }
    if (this.now < p.next) return;
    p.next = this.now + Math.max(20, numAttr(o.attrs.interval, 0.05) * 1000);
    if (p.blocked && p.dir >= 0) {
      this.sendImpulse(o.col + L_DX[p.dir], o.row + L_DY[p.dir], p.dir);
      p.blocked = false;
    }
    let toSouth = (light & L_N ? -1 : 0) + (light & L_S ? 1 : 0);
    let toWest = (light & L_E ? -1 : 0) + (light & L_W ? 1 : 0);
    if (toSouth * toWest !== 0) {
      if (p.dir === 3 || p.dir === 1) toSouth = 0;
      if (p.dir === 2 || p.dir === 0) toWest = 0;
      if (p.dir === -1) {
        toSouth = this.random() < 0.5 ? 0 : toSouth;
        toWest = toSouth ? 0 : toWest;
      }
    }
    // Enigma directions W 0, S 1, E 2, N 3: it skates the way the light travels
    p.dir = toSouth === 1 ? 1 : toSouth === -1 ? 3 : toWest === 1 ? 0 : toWest === -1 ? 2 : -1;
    if (p.dir === -1) {
      p.blink = true;
      return;
    }
    p.blink = false;
    if (this.stoneAt(o.col + L_DX[p.dir], o.row + L_DY[p.dir])) p.blocked = true;
    else this.push(o, L_DX[p.dir], L_DY[p.dir]);
  }

  /** st_lightpassenger (on), _off, blinking (frames 1..6 PingPong à 75 ms), breaking 7 × 50 ms. */
  passengerLook(o: GameObject): { image: string; frame: number } {
    const p = o.pass;
    if (p?.breaking !== undefined) return { image: 'st_lightpassenger_break', frame: Math.min(6, Math.floor((this.now - p.breaking) / 50)) };
    if (o.state !== 1) return { image: 'st_lightpassenger_off', frame: 0 };
    if (p?.blink) return { image: 'st_lightpassenger', frame: [1, 2, 3, 4, 5, 6, 6, 5, 4, 3, 2, 1][Math.floor(this.now / 75) % 12] };
    return { image: 'st_lightpassenger', frame: 0 };
  }

  // ---------- thieves (ThiefStone.cc) ----------

  private thiefStep(o: GameObject): void {
    const t = o.thief!;
    const age = this.now - (t.since ?? 0);
    if (t.phase === 'emerge' && age >= THIEF_MS) {
      // ThiefStone::doSteal: a random item of the robbed marble's owner goes into the bag
      if (t.victim !== undefined && t.victim >= 0) {
        const inv = this.inventories[this.ownerOf(t.victim)] ?? this.inventory;
        if (inv.length) {
          const [it] = inv.splice(Math.floor(this.random() * inv.length), 1);
          t.loot.push(it);
          this.events.push({ type: 'items' });
        }
      }
      // ThiefFloor::doSteal: also a portable item lying on it
      if (o.cls === 'flthief') {
        const item = this.itemAt(o.col, o.row);
        if (item && PICKUP_RADIUS[item.cls] !== undefined) {
          t.loot.push(item.kind);
          this.remove(item);
        }
      }
      o.thief = { ...t, phase: 'retreat', since: this.now };
    } else if (t.phase === 'retreat' && age >= THIEF_MS) o.thief = { loot: t.loot };
    else if (t.phase === 'capture' && age >= 12 * 80) {
      // the stone thief is gone; the floor thief is CAPTURED for good
      if (o.cls === 'flthief') {
        o.state = 1;
        o.thief = { loot: [] };
      } else this.remove(o);
    }
  }

  /** ThiefStone "_capture": its bag drops (with an item lying there) unless a static item is here. */
  private captureThief(o: GameObject): void {
    const t = o.thief ?? { loot: [] };
    const item = this.at(o.col, o.row).find((x) => !x.gone && isItem(x));
    const loot = [...t.loot];
    if (item && PICKUP_RADIUS[item.cls] !== undefined) {
      loot.push(item.kind);
      this.remove(item);
    }
    if (loot.length && !this.at(o.col, o.row).some((x) => !x.gone && isItem(x))) {
      const bag = this.add('it_bag', 'bag', o.col, o.row);
      bag.loot = loot;
    }
    o.thief = { phase: 'capture', since: this.now, loot: [] };
  }

  /** Animation frame (100 ms each) since a start time. */
  dispenserFrameAt(start: number): number {
    return Math.floor((this.now - start) / 100);
  }

  /** st_dispenser_*: frame 0, breaking 7 × 50 ms. */
  dispenserFrame(o: GameObject): number {
    return o.breaking === undefined ? 0 : Math.min(6, Math.floor((this.now - o.breaking) / 50));
  }

  /** st_bluegray with thief_template 0..6 (80 ms) while emerging/retreating; capture 12 × 80 ms. */
  thiefLook(o: GameObject): { image: string; frame: number; overlay: boolean } {
    const t = o.thief;
    const f = t?.since === undefined ? 0 : Math.floor((this.now - t.since) / 80);
    if (t?.phase === 'capture') return o.cls === 'flthief' ? { image: 'thief_capture_template', frame: Math.min(11, f), overlay: true } : { image: 'st_thief_capture', frame: Math.min(11, f), overlay: false };
    if (t?.phase === 'emerge') return { image: 'thief_template', frame: Math.min(6, f), overlay: true };
    if (t?.phase === 'retreat') return { image: 'thief_template', frame: 6 - Math.min(6, f), overlay: true };
    return { image: '', frame: 0, overlay: false };
  }

  // ---------- coin slots (CoinSlot.cc, Coin.cc) ----------

  private slotOf(o: GameObject): NonNullable<GameObject['slot']> {
    o.slot ??= { until: 0, add: 0 };
    return o.slot;
  }

  private slotInstant(o: GameObject): boolean {
    return o.attrs.instant !== undefined && o.attrs.instant !== '' ? truthy(o.attrs.instant) : o.kind === 'st_coinslot_instant';
  }

  /** CoinSlot::actor_hit: a coin in hand buys interval_s/_m/_l seconds (3/6/12; -2 rejects). */
  private hitCoinslot(o: GameObject, by: number): void {
    const s = this.slotOf(o);
    const instant = this.slotInstant(o);
    if (s.inserting !== undefined && !instant) return;
    const inv = by >= 0 ? (this.inventories[this.ownerOf(by)] ?? this.inventory) : this.inventory;
    const coin = inv[0];
    if (!coin || !/^it_coin(_s|_m|_l)?$/.test(coin)) return;
    const size = coin === 'it_coin_m' ? 'm' : coin === 'it_coin_l' ? 'l' : 's';
    const interval = numAttr(o.attrs[`interval_${size}`], size === 's' ? 3 : size === 'm' ? 6 : 12);
    if (interval === -2) return;
    inv.shift();
    this.events.push({ type: 'items' });
    if (interval <= 0) return;
    if (instant) {
      const wasOn = o.state === 1;
      s.until = Math.max(s.until, this.now) + interval * 1000;
      o.state = 1;
      if (!wasOn) this.performAction(o, true);
    } else s.add += interval;
    s.inserting = this.now;
  }

  /** CoinSlot::animcb / alarm: after the insert the time counts; when it runs out, off. */
  private coinslotStep(o: GameObject): void {
    const s = this.slotOf(o);
    if (s.inserting !== undefined && this.now - s.inserting >= COIN_INSERT_MS) {
      s.inserting = undefined;
      if (!this.slotInstant(o)) {
        s.until = Math.max(s.until, this.now) + s.add * 1000;
        s.add = 0;
        if (o.state !== 1) {
          o.state = 1;
          this.performAction(o, true);
        }
      }
    }
    if (o.state === 1 && s.inserting === undefined && this.now >= s.until) {
      o.state = 0;
      this.performAction(o, false);
    }
  }

  /** st_coinslot (off), st_coinslot_insert 18 × 20 ms while inserting, its last frame when on. */
  coinslotLook(o: GameObject): { image: string; frame: number } {
    const s = this.slotOf(o);
    if (s.inserting !== undefined) return { image: 'st_coinslot_insert', frame: Math.min(17, Math.floor((this.now - s.inserting) / 20)) };
    return o.state === 1 ? { image: 'st_coinslot_insert', frame: 17 } : { image: 'st_coinslot', frame: 0 };
  }

  // ---------- breakable stones (BreakStone.cc) ----------

  /** BreakStone::doBreak: BREAKING animation, then the stone is gone (stonedestroy = explosion0). */
  private breakStone(o: GameObject): void {
    if (o.breaking !== undefined) return;
    o.breaking = this.now;
    this.events.push({ type: 'sound', name: 'explode' });
  }

  /** Image and frame: st_break_<type> 10 × 50 ms; laser/bug: st_flat / st_break_bug, st_flat_break 6 × 50 ms. */
  breakLook(o: GameObject): { image: string; frame: number; solid: boolean } {
    const t = breakType(o);
    const flat = flatBreak(t);
    const age = o.breaking === undefined ? -1 : this.now - o.breaking;
    const solid = t === 'oxydc' || t === 'boulder' || flat;
    const idle: Record<string, string> = { laser: 'st_flat', flat: 'st_flat', cracked: 'st_flat_cracked', fire: 'st_flat_fire', plaster: 'st_plaster' };
    if (age < 0) return { image: idle[t] ?? `st_break_${t}`, frame: 0, solid };
    if (flat) return { image: 'st_flat_break', frame: Math.min(5, Math.floor(age / 50)), solid };
    return { image: `st_break_${t}`, frame: Math.min(9, Math.floor(age / 50)), solid };
  }

  // ---------- windows (WindowStone.cc) ----------

  /**
   * WindowStone::actor_hit: impulse = speed into the pane × mass. Above 35 the marble shatters, above
   * 22 (15 with a hammer in hand) the pane breaks – not for secure (green) windows.
   */
  private hitWindow(o: GameObject, nx: number, ny: number, vn: number, by: number): void {
    const faces = windowFaces(o);
    if (!faces) return;
    // which pane: the marble inside the cell hits the far one, outside the near one
    const m = by >= 0 ? this.slot(by) : null;
    const inside = !!m && m.col === o.col && m.row === o.row;
    let face = 0;
    if (Math.abs(nx) >= Math.abs(ny)) face = (nx < 0) !== inside ? WEST : EAST;
    else face = (ny < 0) !== inside ? NORTH : SOUTH;
    if (!(faces & face)) return;
    const mass = by >= 0 && this.isPearl(by) ? 0.7 : 1;
    const impulse = -vn * mass;
    const secure = truthy(o.attrs.secure);
    const threshold = 22 - (this.wields('it_hammer') ? 7 : 0);
    if (secure) return;
    if (impulse > 35 && by >= 0) this.events.push({ type: 'shatter', marble: by });
    else if (impulse > threshold) {
      // WindowStone::breakFaces
      const rest = faces & ~face;
      o.attrs = { ...o.attrs, $connections: String(ALL_FACES ^ rest) };
      this.events.push({ type: 'sound', name: 'glass' });
      if (rest === 0) this.remove(o);
    }
  }

  // ---------- key switches (KeySwitch.cc) ----------

  /** Code of a key or key switch ('' = none); keys carry it in their kind (it_key_<code>). */
  private keyCode(o: GameObject | string): string {
    if (typeof o === 'string') return /^it_key_(\d+)$/.exec(o)?.[1] ?? '';
    return o.attrs.code ?? /^it_key_(\d+)$/.exec(o.kind)?.[1] ?? '';
  }

  /**
   * KeySwitch::actor_hit: off + the matching key in hand → the key goes in, on; on → the key comes
   * back (if the inventory has room), off. "secure": not while the actor stands on a target.
   */
  private hitKeySwitch(o: GameObject, by: number): void {
    const inv = by >= 0 ? (this.inventories[this.ownerOf(by)] ?? this.inventory) : this.inventory;
    if (truthy(o.attrs.secure) && this.compat >= 1.1 && by >= 0) {
      const m = this.slot(by);
      for (const t of splitTokens(o.attrs.target)) if (this.resolve(t).some((x) => x.col === m.col && x.row === m.row)) return;
    }
    const code = this.keyCode(o);
    if (o.state === 1) {
      if (inv.length >= MAX_ITEMS) return;
      inv.unshift(o.kind === 'st_floppy' ? 'it_floppy' : code ? `it_key_${code}` : 'it_key');
    } else if (o.kind === 'st_floppy') {
      // FloppySwitch::actor_hit: the floppy in hand goes in
      if (inv[0] !== 'it_floppy') return;
      inv.shift();
    } else {
      if (!inv[0] || this.objectClassOf(inv[0]) !== 'key' || this.keyCode(inv[0]) !== code) return;
      inv.shift();
    }
    o.state = 1 - o.state;
    this.events.push({ type: 'items' }, { type: 'sound', name: 'switch' });
    this.performAction(o, o.state === 1);
  }

  private objectClassOf(kind: string): ObjectClass | null {
    return objectClass(kind);
  }

  /** st_key_on/off: frame = code 1..8 unless invisible, else 0. */
  keySwitchFrame(o: GameObject): number {
    const c = Number(this.keyCode(o));
    return !truthy(o.attrs.invisible) && c >= 1 && c <= 8 ? c : 0;
  }

  // ---------- blockers (BlockerStone.cc, BlockerItem.cc) ----------

  private blockerOf(o: GameObject): NonNullable<GameObject['blocker']> {
    o.blocker ??= { phase: o.kind.startsWith('it_') ? 'open' : o.kind === 'st_blocker_new' ? 'growing' : 'solid', since: this.now, lock: 'idle' };
    return o.blocker;
  }

  /** BlockerStone::setIState: a running animation reverses from where it is. */
  private blockerSet(o: GameObject, phase: 'shrinking' | 'growing'): void {
    const b = this.blockerOf(o);
    if (b.phase === 'open' || b.phase === phase) return;
    const running = b.phase === 'shrinking' || b.phase === 'growing';
    const done = running ? Math.min(BLOCKER_MS, this.now - b.since) : BLOCKER_MS;
    o.blocker = { ...b, phase, since: running ? this.now - (BLOCKER_MS - done) : this.now };
  }

  /** BlockerItem::grow: the item becomes a growing stone. */
  private blockerGrow(o: GameObject): void {
    o.blocker = { phase: 'growing', since: this.now, lock: 'idle' };
    o.kind = 'st_blocker';
    this.events.push({ type: 'sound', name: 'move' });
  }

  /** The stone (not this blocker) in the blocker's cell. */
  private blockerStoneOn(o: GameObject): GameObject | null {
    return this.at(o.col, o.row).find((x) => x !== o && !x.gone && !isItem(x)) ?? null;
  }

  private blockerStep(o: GameObject): void {
    const b = this.blockerOf(o);
    const age = this.now - b.since;
    if (b.phase === 'shrinking' && age >= BLOCKER_MS) {
      // BlockerStone::animcb: becomes it_blocker (NEW: a boulder is awaited for 0.5 s)
      o.blocker = { phase: 'open', since: this.now, lock: 'new', stone: null };
      o.kind = 'it_blocker';
      this.performAction(o, true);
      return;
    }
    if (b.phase === 'growing') {
      // actors inside a growing blocker shatter (not with autoclose)
      if (!truthy(o.attrs.autoclose)) this.shatterAt(o.col, o.row);
      if (age >= BLOCKER_MS) {
        o.blocker = { phase: 'solid', since: this.now, lock: 'idle' };
        o.kind = 'st_blocker';
        this.performAction(o, false);
      }
      return;
    }
    if (b.phase !== 'open') return;
    if (b.lock === 'new' && age >= 500) b.lock = 'idle'; // BlockerItem::alarm
    // BlockerItem::stone_change
    const st = this.blockerStoneOn(o);
    if (st !== (b.stone ?? null)) {
      b.stone = st;
      if (st) {
        if (st.cls === 'boulder') b.lock = b.lock === 'idle' ? 'unlocked' : b.lock === 'new' ? 'locked' : b.lock;
        else if (b.lock !== 'unlocked') b.lock = 'locked';
      } else if (b.lock === 'locked') b.lock = 'idle';
      else if (b.lock === 'unlocked') this.blockerGrow(o);
    }
  }

  /** BlockerItem::actor_leave: autoclose closes the open blocker behind an actor. */
  private blockerLeave(col: number, row: number): void {
    for (const o of this.at(col, row)) if (o.cls === 'blocker' && !o.gone && o.blocker?.phase === 'open' && truthy(o.attrs.autoclose)) this.blockerClose(o);
  }

  /** BlockerItem::setState(0): close (locked: when the stone leaves; idle/new: grow now). */
  private blockerClose(o: GameObject): void {
    const b = this.blockerOf(o);
    if (b.phase !== 'open') {
      if (b.phase === 'shrinking') this.blockerSet(o, 'growing');
      return;
    }
    if (b.lock === 'locked') b.lock = 'unlocked';
    else if (b.lock === 'idle' || b.lock === 'new') this.blockerGrow(o);
  }

  /** BlockerItem::setState(1) / BlockerStone open: shrink, or revoke a pending close. */
  private blockerOpen(o: GameObject): void {
    const b = this.blockerOf(o);
    if (b.phase === 'open') {
      if (b.lock === 'unlocked') b.lock = 'locked';
    } else this.blockerSet(o, 'shrinking');
  }

  /** st_blocker sheet: 0 solid, 3 item; shrinking 1→3, growing 3→1 (3 × 60 ms). */
  blockerLook(o: GameObject): { frame: number; stone: boolean } {
    const b = this.blockerOf(o);
    const f = Math.min(2, Math.floor((this.now - b.since) / 60));
    if (b.phase === 'solid') return { frame: 0, stone: true };
    if (b.phase === 'open') return { frame: 3, stone: false };
    return { frame: b.phase === 'shrinking' ? 1 + f : 3 - f, stone: true };
  }

  // ---------- rotators (RotatorStone.cc) ----------

  /**
   * RotatorStone::animcb/alarm: after each turn (8 × 70 ms) it notes its four neighbour stones and
   * 0.1 s later pushes each one still there round it (clockwise: west → north, …).
   */
  private rotatorStep(o: GameObject): void {
    o.rotor ??= { since: this.now };
    const r = o.rotor;
    if (r.alarm !== undefined && this.now >= r.alarm) {
      r.alarm = undefined;
      for (let d = 0; d < 4; d++) {
        const c = o.col + L_DX[d];
        const w = o.row + L_DY[d];
        const n = r.neighbors?.[d];
        if (!n || n.gone || n.col !== c || n.row !== w) continue;
        this.sendImpulse(c, w, o.state === 0 ? (d + 3) % 4 : (d + 1) % 4);
      }
    }
    if (this.now - r.since >= ROTATOR_TURN_MS) {
      r.since = this.now;
      r.neighbors = [0, 1, 2, 3].map((d) => this.at(o.col + L_DX[d], o.row + L_DY[d]).find((x) => !x.gone && !isItem(x)) ?? null);
      r.alarm = this.now + 100;
    }
  }

  /** st_rotator_cw/_ccw: 8 frames à 70 ms, running all the time. */
  rotatorLook(o: GameObject): { image: string; frame: number } {
    const since = o.rotor?.since ?? 0;
    return { image: o.state === 1 ? 'st_rotator_ccw' : 'st_rotator_cw', frame: Math.min(7, Math.floor((this.now - since) / 70)) };
  }

  // ---------- bridges (BridgeFloor.cc) ----------

  private bridgeOf(o: GameObject): NonNullable<GameObject['bridge']> {
    if (!o.bridge) {
      const explicit = o.state === 0;
      o.bridge = { phase: explicit || this.bridgeStone(o) ? 'closed' : 'open', since: -1e9, explicit };
      this.bridgeFloor(o);
    }
    return o.bridge;
  }

  /** A stone that is not floating (hollow) lies on the bridge. */
  private bridgeStone(o: GameObject): boolean {
    return this.at(o.col, o.row).some((x) => !x.gone && !isItem(x) && x.kind !== 'st_stoneimpulse_hollow' && !isHollow(x));
  }

  private bridgeImage(o: GameObject): string {
    const f = o.attrs.flavor || 'gc';
    return f === 'gc' ? 'fl_bridge_gc' : 'fl_bridge_bw';
  }

  /** The floor kind follows the phase: walkable only when closed. */
  private bridgeFloor(o: GameObject): void {
    const kind = `${this.bridgeImage(o)}_${o.bridge!.phase === 'closed' ? 'closed' : 'open'}`;
    if (this.env.floorAt(o.col, o.row) === kind) return;
    this.env.setFloor(o.col, o.row, kind);
    this.events.push({ type: 'floor', col: o.col, row: o.row });
  }

  private bridgeMs(o: GameObject): number {
    return (o.attrs.flavor || 'gc') === 'gc' ? 10 * 70 : 9 * 70;
  }

  /** BridgeFloor::set_iState: a running animation reverses from where it is. */
  private bridgeAnim(o: GameObject, phase: 'opening' | 'closing'): void {
    const b = this.bridgeOf(o);
    const dur = this.bridgeMs(o);
    const done = b.phase === 'opening' || b.phase === 'closing' ? Math.min(dur, this.now - b.since) : dur;
    o.bridge = { ...b, phase, since: b.phase === 'opening' || b.phase === 'closing' ? this.now - (dur - done) : this.now };
    this.bridgeFloor(o);
  }

  /** BridgeFloor::setState: 1 opens (not under a stone), 0 closes; remembers an explicit close. */
  private bridgeSet(o: GameObject, open: number): void {
    const b = this.bridgeOf(o);
    if (open === 1 && (b.phase === 'closed' || b.phase === 'closing') && !this.bridgeStone(o)) this.bridgeAnim(o, 'opening');
    else if (open === 0 && (b.phase === 'open' || b.phase === 'opening')) this.bridgeAnim(o, 'closing');
    o.bridge!.explicit = open === 0;
  }

  /** BridgeFloor::stone_change and animcb. */
  private bridgeStep(o: GameObject): void {
    const b = this.bridgeOf(o);
    const stone = this.bridgeStone(o);
    if (stone && (b.phase === 'open' || b.phase === 'opening')) this.bridgeAnim(o, 'closing');
    else if (!stone && (b.phase === 'closed' || b.phase === 'closing') && !b.explicit) this.bridgeAnim(o, 'opening');
    const c = o.bridge!;
    if ((c.phase === 'opening' || c.phase === 'closing') && this.now - c.since >= this.bridgeMs(o)) {
      o.bridge = { ...c, phase: c.phase === 'opening' ? 'open' : 'closed', since: this.now };
      this.bridgeFloor(o);
    }
    o.state = o.bridge!.phase === 'closed' ? 0 : 1;
  }

  /** Animation frame while opening/closing (fl_bridge_gc: 10 frames, others 9 incl. closed/open), else null. */
  bridgeLook(o: GameObject): { image: string; frame: number } | null {
    const b = this.bridgeOf(o);
    if (b.phase !== 'opening' && b.phase !== 'closing') return null;
    const gc = (o.attrs.flavor || 'gc') === 'gc';
    const n = gc ? 10 : 9;
    const f = Math.min(n - 1, Math.floor((this.now - b.since) / 70));
    // gc: closing 0..9, opening reversed; others: opening 0..8 (closed → open), closing reversed
    const frame = gc ? (b.phase === 'closing' ? f : n - 1 - f) : b.phase === 'opening' ? f : n - 1 - f;
    const flavor = o.attrs.flavor || 'gc';
    if (gc) return { image: 'fl_bridge_gc', frame };
    // others: frame 0 = closed image, 1..7 the sheet, 8 = open image
    if (frame === 0) return { image: 'fl_bridge_bw_closed', frame: 0 };
    if (frame === n - 1) return { image: 'fl_bridge_bw_open', frame: 0 };
    return { image: `fl_bridge_${flavor}`, frame: frame - 1 };
  }

  // ---------- scales (ScalesFloor.cc) ----------

  /**
   * ScalesFloor::updateIState: pressed by a stone (not hollow; puzzles always) or by the mass of the
   * actors in the cell (marbles 1, pearls 0.7; not jumping) reaching min (1.8). The first check acts not.
   */
  private scalesStep(o: GameObject): void {
    const stone = this.env.stoneAt(o.col, o.row) || this.at(o.col, o.row).some((x) => !x.gone && !isItem(x) && x.kind !== 'st_stoneimpulse_hollow');
    let mass = 0;
    this.marbles.forEach((m, i) => {
      // ScalesFloor "_update_mass": the actor with the weights it carries (it_weight mass 10)
      if (m.init && m.col === o.col && m.row === o.row) mass += (this.isPearl(i) ? 0.7 : 1) + 10 * (this.inventories[this.ownerOf(i)] ?? this.inventory).filter((k) => k === 'it_weight').length;
    });
    const on = stone || mass >= numAttr(o.attrs.min, 1.8) ? 1 : 0;
    if (o.scales === undefined) {
      o.scales = true;
      o.state = on;
      return;
    }
    if (on === o.state) return;
    o.state = on;
    this.events.push({ type: 'sound', name: on ? 'triggerdown' : 'triggerup' });
    this.performAction(o, on === 1);
  }

  // ---------- cracks (Crack.cc) ----------

  private crackWater(o: GameObject): boolean {
    return o.attrs.flavor !== undefined && o.attrs.flavor !== '' ? o.attrs.flavor === 'water' : o.kind.endsWith('_water');
  }

  /** Floor::is_destructible: not abyss, water or swamp. */
  private destructible(col: number, row: number): boolean {
    const f = this.env.floorAt(col, row);
    return !!f && f !== 'fl_abyss' && f !== 'fl_water' && f !== 'fl_swamp';
  }

  /** Crack::crack: with probability fragility (invisible: also spreading) one stage further. */
  private crack(o: GameObject): void {
    if (!this.destructible(o.col, o.row) || o.state >= 3) return;
    const fragility = numAttr(o.attrs.fragility, 1);
    const spreading = numAttr(o.attrs.spreading, 0.5);
    if ((o.state === -1 && this.random() < spreading) || this.random() < fragility) {
      o.state++;
      if (o.state === 3) o.dissolving = this.now; // sound-defaults.lua: crack is silent
    }
  }

  /** Crack::actor_enter: crack, and below DISSOLVING crack or seed the neighbour floors. */
  private crackEnter(col: number, row: number): void {
    for (const o of this.at(col, row)) {
      if (o.cls !== 'crack' || o.gone) continue;
      this.crack(o);
      if (o.state >= 3) continue;
      const water = this.crackWater(o);
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const c = col + dx;
        const r = row + dy;
        if (c < 0 || r < 0 || c >= this.width || !this.destructible(c, r)) continue;
        if (water && this.env.floorAt(c, r) === 'fl_space') continue;
        const item = this.at(c, r).find((x) => !x.gone && isItem(x));
        if (item) {
          if (!water && item.cls === 'crack') this.crack(item); // message "crack"
        } else if (this.random() < numAttr(o.attrs.spreading, 0.5)) {
          const n = this.add(water ? 'it_crack_i_water' : 'it_crack_i', 'crack', c, r);
          n.state = -1;
          n.attrs = { ...(o.attrs.fragility !== undefined ? { fragility: o.attrs.fragility } : {}), ...(o.attrs.spreading !== undefined ? { spreading: o.attrs.spreading } : {}), ...(water ? { flavor: 'water' } : {}) };
        }
      }
    }
  }

  /** Crack::animcb: the floor becomes abyss (water for water cracks), the crack is gone. */
  private crackDissolved(o: GameObject): void {
    this.remove(o);
    this.env.setFloor(o.col, o.row, this.crackWater(o) ? 'fl_water' : 'fl_abyss');
    this.events.push({ type: 'floor', col: o.col, row: o.row });
  }

  /** it_crack_abyss/_water sheet: stage 0..2, dissolving frames 3..7 à 120 ms; invisible: null. */
  crackLook(o: GameObject): { image: string; frame: number } | null {
    if (o.state < 0) return null;
    const image = this.crackWater(o) ? 'it_crack_water' : 'it_crack_abyss';
    if (o.state >= 3) return { image, frame: 3 + Math.min(4, Math.floor((this.now - (o.dissolving ?? this.now)) / 120)) };
    return { image, frame: o.state };
  }

  // ---------- sensors (Sensor.cc) ----------

  /** An actor entered (leave = false) or left the cell: sensors (exit sensors on leaving) act. */
  private sensorStep(col: number, row: number, leave: boolean): void {
    for (const o of this.at(col, row)) {
      if (o.cls !== 'sensor' || o.gone || /filter/.test(o.kind)) continue;
      if (this.sensorExit(o) !== leave) continue;
      o.bounce = this.now;
      this.sensorAction(o);
    }
  }

  private sensorExit(o: GameObject): boolean {
    return o.attrs.exit !== undefined ? truthy(o.attrs.exit) : o.kind === 'it_sensor_exit';
  }

  /** performAction(true), inverted for it_sensor_inverse / _filter0 (their "inverse" default). */
  private sensorAction(o: GameObject): void {
    const kindInverse = o.kind === 'it_sensor_inverse' || o.kind === 'it_sensor_filter0';
    this.performAction(o, !(kindInverse && o.attrs.inverse === undefined));
  }

  /** it_sensor(_exit)_hit: 2 images à 300 ms, three times; invisible sensors are not drawn. */
  sensorLook(o: GameObject): { image: string; frame: number } | null {
    const invisible = o.attrs.invisible !== undefined ? truthy(o.attrs.invisible) : /filter/.test(o.kind);
    if (invisible) return null;
    const age = o.bounce === undefined ? Infinity : this.now - o.bounce;
    return { image: this.sensorExit(o) ? 'it_sensor_exit' : 'it_sensor', frame: age < 1800 ? Math.floor(age / 300) % 2 : 0 };
  }

  // ---------- meditation (Meditation.cc, ChangeMeditation) ----------

  /** Engaged hollows (a pearl rested there 1 s) and how many essential ones exist. */
  meditationCount(): { engaged: number; essential: number; essentialEngaged: number } {
    let engaged = 0;
    let essential = 0;
    let essentialEngaged = 0;
    for (const o of this.objects) {
      if (o.cls !== 'meditation' || o.gone) continue;
      const on = o.meditatist?.since === -1;
      const ess = o.attrs.essential === '1';
      if (on) engaged++;
      if (ess) essential++;
      if (ess && on) essentialEngaged++;
    }
    return { engaged, essential, essentialEngaged };
  }

  /** ChangeMeditation: every pearl engaged in a hollow and every essential hollow engaged. */
  meditationDone(pearls: number): boolean {
    if (pearls <= 0) return false;
    const c = this.meditationCount();
    return c.essential === c.essentialEngaged && c.engaged === pearls;
  }

  // ---------- actor impulse stones (ActorImpulseStone.cc) ----------

  /**
   * ActorImpulseStone::actor_hit: an idle bumper pushes the actor away from its centre with
   * distortedVelocity(direction, strength) (BumperForce 200) and pulses; returns that force or null.
   */
  bump(col: number, row: number, x: number, y: number): [number, number] | null {
    const o = this.at(col, row).find((b) => b.cls === 'actorimpulse' && !b.gone);
    if (!o || this.pulsing(o)) return null;
    o.pulse = this.now;
    const dx = x - (col + 0.5);
    const dy = y - (row + 0.5);
    const d = Math.hypot(dx, dy) || 1;
    const [vx, vy] = [dx / d, dy / d];
    const num = (k: string, def: number) => (o.attrs[k] !== undefined && o.attrs[k] !== '' ? Number(o.attrs[k]) : def);
    const f = num('hit_strength', num('strength', BUMPER_FORCE));
    return [(num('hit_distortion_xx', 1) * vx + num('hit_distortion_xy', 0) * vy) * f, (num('hit_distortion_yx', 0) * vx + num('hit_distortion_yy', 1) * vy) * f];
  }

  private pulsing(o: GameObject): boolean {
    return o.pulse !== undefined && this.now - o.pulse < BUMPER_FRAMES.length * 30;
  }

  /** st_actorimpulse_anim: PingPong over 3 frames à 30 ms; idle frame 0. */
  actorimpulseFrame(o: GameObject): number {
    return this.pulsing(o) ? BUMPER_FRAMES[Math.floor((this.now - o.pulse!) / 30)] : 0;
  }

  /** st_actorimpulse_invisible is drawn only while it pulses (no glasses yet). */
  actorimpulseVisible(o: GameObject): boolean {
    const invisible = o.attrs.invisible !== undefined ? truthy(o.attrs.invisible) : o.kind.endsWith('_invisible');
    return !invisible || this.pulsing(o);
  }

  // ---------- vortices (Vortex.cc) ----------

  private vortexOf(o: GameObject): NonNullable<GameObject['vortex']> {
    o.vortex ??= { phase: o.state === 1 ? 'open' : 'closed', since: -1e9 };
    return o.vortex;
  }

  /** Vortex::setState: open (1) or close (0), with the 4 × 100 ms animation. */
  private vortexSet(o: GameObject, open: number): void {
    const v = this.vortexOf(o);
    if (open === 1 && (v.phase === 'closed' || v.phase === 'closing')) o.vortex = { phase: 'opening', since: this.now };
    else if (open === 0 && (v.phase === 'open' || v.phase === 'opening')) o.vortex = { phase: 'closing', since: this.now };
    o.state = open;
  }

  /** Vortex covers the floor within 0.25 of its centre (Vortex::covers_floor). */
  coversFloor(x: number, y: number, speed = 0): boolean {
    // StripItem::covers_floor: a plank along its connections, wider when fast
    for (const o of this.at(Math.floor(x), Math.floor(y))) {
      if (o.cls !== 'strip' || o.gone) continue;
      const c = stripConnections(o);
      const d = 0.183125 + Math.min(0.125, Math.max(0, speed / 400));
      const cx = o.col + 0.5;
      const cy = o.row + 0.5;
      if ((Math.abs(y - cy) <= d && (Math.abs(x - cx) <= d || (x <= cx + d && c & WEST) || (x >= cx - d && c & EAST))) ||
          (Math.abs(x - cx) <= d && ((y <= cy + d && c & NORTH) || (y >= cy - d && c & SOUTH)))) return true;
    }
    return this.at(Math.floor(x), Math.floor(y)).some((o) => o.cls === 'vortex' && !o.gone && Math.hypot(x - (o.col + 0.5), y - (o.row + 0.5)) < 0.25);
  }

  /** Vortex::emit_actor / warp_to: give the marble out, close (autoclose), perform the action. */
  private vortexRelease(o: GameObject, at: GameObject | { x: number; y: number }, cut: boolean): void {
    const v = this.vortexOf(o);
    const pos = 'col' in at ? { x: at.col + 0.5, y: at.row + 0.5 } : at;
    if (v.marble !== undefined) this.events.push({ type: 'vortexWarp', marble: v.marble, x: pos.x, y: pos.y, cut, rise: 'col' in at });
    o.vortex = { phase: 'open', since: this.now };
    o.state = 1;
    if (at !== o) {
      if (truthy(o.attrs.autoclose)) this.vortexSet(o, 0);
      this.performAction(o, true);
    }
  }

  /** Vortex::perform_warp: to destination idx – another vortex (opened if needed) or a point. */
  private vortexWarp(o: GameObject): void {
    const v = this.vortexOf(o);
    const dests = (o.attrs.dests ?? '').split(';').filter((s) => s !== '').map((s) => s.split(',').map(Number));
    const cut = o.attrs.scissor === undefined ? this.compat >= 1.1 : truthy(o.attrs.scissor);
    const dest = dests[v.idx ?? 0];
    if (!dest) {
      this.vortexRelease(o, o, false); // no (more) destinations: back out here
      return;
    }
    const [dx, dy] = dest;
    const target = this.at(Math.floor(dx), Math.floor(dy)).find((x) => x.cls === 'vortex' && !x.gone);
    if (!target) {
      this.vortexRelease(o, { x: dx, y: dy }, cut);
      return;
    }
    if (this.stoneAt(target.col, target.row)) {
      // blocked destination vortex: try the next one after 0.8 s
      o.vortex = { ...v, phase: 'warping', since: this.now + 400, idx: (v.idx ?? 0) + 1 };
      return;
    }
    const t = this.vortexOf(target);
    if (t.phase === 'open' || t.phase === 'opening') this.vortexRelease(o, target, cut);
    else if (t.phase === 'closed' || t.phase === 'closing') {
      this.vortexSet(target, 1);
      o.vortex = { ...v, phase: 'emitting', since: this.now, target };
    } else this.vortexRelease(o, o, false); // busy: back out here
  }

  private vortexStep(o: GameObject): void {
    const v = this.vortexOf(o);
    const age = this.now - v.since;
    if (v.phase === 'opening' && age >= 400) o.vortex = { phase: 'open', since: this.now };
    else if (v.phase === 'closing' && age >= 400) o.vortex = { phase: 'closed', since: this.now };
    else if ((v.phase === 'swallowing' || v.phase === 'warping') && age >= 400) this.vortexWarp(o);
    else if (v.phase === 'emitting' && age >= 400) {
      const cut = o.attrs.scissor === undefined ? this.compat >= 1.1 : truthy(o.attrs.scissor);
      this.vortexRelease(o, v.target ?? o, cut && v.target !== undefined);
    }
  }

  /** it_vortex: frame 0 open … 3 closed; opening/closing 100 ms per frame. */
  vortexFrame(o: GameObject): number {
    const v = this.vortexOf(o);
    const f = Math.min(3, Math.floor((this.now - v.since) / 100));
    if (v.phase === 'closed') return 3;
    if (v.phase === 'opening') return 3 - f;
    if (v.phase === 'closing') return f;
    return 0;
  }

  // ---------- chess stones (ChessStone.cc) ----------

  /**
   * ChessStone::actor_hit: the wand flips the colour; a marble of the stone's colour pushing a
   * face (GetPushDirection) while rolling sideways faster than 1.5 moves it like a knight.
   */
  private hitChess(o: GameObject, color: number, nx: number, ny: number, vn: number, vx: number, vy: number): void {
    if (this.wields('it_magicwand')) {
      o.state = 1 - o.state;
      return;
    }
    if (color !== o.state) return;
    const face = (Math.abs(nx) === 1 && ny === 0) || (Math.abs(ny) === 1 && nx === 0);
    if (!face || vn >= -PUSH_SPEED) return;
    const d1: [number, number] = [-nx, -ny];
    let d2: [number, number] | null = null;
    if (d1[0] === 0) d2 = vx > CHESS_HIT ? [1, 0] : vx < -CHESS_HIT ? [-1, 0] : null;
    else d2 = vy > CHESS_HIT ? [0, 1] : vy < -CHESS_HIT ? [0, -1] : null;
    if (d2) this.chessMove(o, d1, d2);
  }

  /** ChessStone::maybe_move_to: two cells in d1, one in d2; capture a chess stone of the other colour. */
  private chessMove(o: GameObject, d1: [number, number], d2: [number, number]): void {
    if ((o.chess?.phase ?? 'idle') !== 'idle') return;
    const dest: [number, number] = [o.col + 2 * d1[0] + d2[0], o.row + 2 * d1[1] + d2[1]];
    if (dest[0] < 0 || dest[1] < 0 || dest[0] >= this.width || this.env.floorAt(dest[0], dest[1]) === undefined) return;
    const other = this.at(dest[0], dest[1]).find((x) => !x.gone && !isItem(x));
    if (!other && !this.stoneAt(dest[0], dest[1])) {
      o.chess = { phase: 'disappearing', since: this.now, dest };
      return;
    }
    // ThiefStone "_capture": the knight takes an idle thief
    if (other?.cls === 'thief' && !other.thief?.phase) {
      this.captureThief(other);
      o.chess = { phase: 'capturing', since: this.now, dest };
      return;
    }
    // _capture: only an idle chess stone of the other colour gives way
    if (other?.cls === 'chess' && other.state !== o.state && (other.chess?.phase ?? 'idle') === 'idle') {
      other.chess = { phase: 'captured', since: this.now };
      o.chess = { phase: 'capturing', since: this.now, dest };
    }
  }

  /** ChessStone::animcb / alarm, and on_floor_change after a move. */
  private chessStep(o: GameObject): void {
    const c = o.chess;
    if (!c) return;
    const age = this.now - c.since;
    if (c.phase === 'captured' && age >= CHESS_ANIM_MS) this.remove(o);
    else if (c.phase === 'falling' && age >= CHESS_ANIM_MS) this.remove(o);
    else if (c.phase === 'sinking' && age >= 5 * 500) this.remove(o);
    else if (c.phase === 'capturing' && age >= 100) {
      // ChessStone::alarm: the captured stone is gone (or never goes): move or give up
      const [dc, dr] = c.dest!;
      if (!this.stoneAt(dc, dr)) o.chess = { phase: 'disappearing', since: this.now, dest: c.dest };
      else if (age >= 100 * 21) o.chess = { phase: 'idle', since: this.now }; // max_capture_retry = 20
    } else if (c.phase === 'disappearing' && age >= CHESS_ANIM_MS) {
      const [dc, dr] = c.dest!;
      if (!this.stoneAt(dc, dr)) {
        const [oc, or] = [o.col, o.row];
        this.unplace(o);
        o.col = dc;
        o.row = dr;
        this.place(o);
        this.events.push({ type: 'sound', name: 'move' });
        this.shatterAt(dc, dr); // Stone::on_move
        this.stoneHitsItems(dc, dr);
        this.updateTriggers(oc, or);
        this.updateTriggers(dc, dr);
      }
      o.chess = { phase: 'appearing', since: this.now };
    } else if (c.phase === 'appearing' && age >= CHESS_ANIM_MS) {
      // on_floor_change remembered until IDLE: abyss → fall, swamp → sink
      const floor = this.env.floorAt(o.col, o.row);
      o.chess = { phase: floor === 'fl_abyss' ? 'falling' : floor === 'fl_swamp' ? 'sinking' : 'idle', since: this.now };
    }
  }

  /** st_chess_<colour>: 5 frames; idle 0, (dis)appearing 120 ms each, sinking 500 ms each. */
  chessFrame(o: GameObject): number {
    const c = o.chess;
    if (!c || c.phase === 'idle') return 0;
    const age = this.now - c.since;
    if (c.phase === 'sinking') return Math.min(4, Math.floor(age / 500));
    const f = Math.min(4, Math.floor(age / 120));
    return c.phase === 'appearing' ? 4 - f : c.phase === 'capturing' ? 0 : f;
  }

  // ---------- four switches (FourSwitch.cc) ----------

  /**
   * FourSwitch::turn: one step clockwise (counterclock: anticlockwise). With state targets
   * (target_0 … target_3) the old direction gets false (not on the first turn) and the new
   * one true; with a plain "target" the new direction is sent as value (API 1: true for W/E).
   */
  private turnFourswitch(o: GameObject): void {
    const global = !!o.attrs.target;
    if (!global && o.turned) this.performAction(o, false);
    o.turned = true;
    // Enigma directions W0 S1 E2 N3: clockwise N→E→S→W is −1
    o.state = truthy(o.attrs.counterclock) ? (o.state + 1) % 4 : (o.state + 3) % 4;
    this.events.push({ type: 'sound', name: 'switch' });
    if (global) {
      if (this.compat < 1.1) this.performAction(o, o.state % 2 === 0);
      else this.performAction(o, o.state !== 0, o.state);
    } else this.performAction(o, true);
  }

  /** st_fourswitch image: frames n e s w. */
  fourswitchFrame(o: GameObject): number {
    return [3, 2, 1, 0][o.state & 3];
  }

  // ---------- swap stones (SwapStone.cc) ----------

  /**
   * SwapStone::on_impulse: exchange places with the stone in direction dx/dy. Nothing happens
   * without a stone there, with a moving one or (deviation) with an Oxyd stone, whose place is
   * fixed in Murmel.
   */
  /**
   * SwapStone::on_impulse: exchange places with the stone in direction dx/dy. pull (PullStone):
   * may also move onto a free floor, and actors in the destination are put into the old cell.
   */
  private swapStone(o: GameObject, dx: number, dy: number, pull = false): boolean {
    if (o.gone || (o.swapped && this.now - o.swapped.since < SWAP_MS)) return false;
    const c = o.col + dx;
    const r = o.row + dy;
    if (c < 0 || r < 0 || c >= this.width) return false;
    const other = this.at(c, r).find((x) => !x.gone && !isItem(x));
    const plain = other ? null : (this.env.staticStone?.(c, r) ?? null);
    if (other) {
      if (other.swapped && this.now - other.swapped.since < SWAP_MS) return false;
      if (other.cls === 'puzzle' && other.puzzle) return false; // PuzzleStone::is_removable
      if (other.cls === 'boulder' && other.boulder?.phase === 'falling') return false;
    } else if (pull && !plain) {
      if (this.env.stoneAt(c, r)) return false; // outside the level
    } else if (!plain || plain === 'st_oxyd' || !this.env.setStaticStone) return false;
    const [oc, or] = [o.col, o.row];
    this.unplace(o);
    if (other) {
      this.unplace(other);
      other.col = oc;
      other.row = or;
      this.place(other);
    } else if (plain) {
      this.env.setStaticStone!(c, r, null);
      this.env.setStaticStone!(oc, or, plain);
    }
    if (pull) this.events.push({ type: 'pullWarp', fromCol: c, fromRow: r, toCol: oc, toRow: or });
    o.col = c;
    o.row = r;
    this.place(o);
    o.swapped = { since: this.now, dir: STEPS.findIndex(([x, y]) => x === dx && y === dy) };
    this.events.push({ type: 'sound', name: 'move' });
    this.updateTriggers(oc, or);
    this.updateTriggers(c, r);
    return true;
  }

  /** Swap stone animation: frame 0 = idle, 1–4 = st_swap_n, _s, _e, _w while moving. */
  swapFrame(o: GameObject): number {
    if (!o.swapped || this.now - o.swapped.since >= SWAP_MS) return 0;
    return [4, 2, 3, 1][o.swapped.dir] ?? 0; // Enigma dir W0 S1 E2 N3
  }

  // ---------- boulders (BoulderStone.cc) ----------

  /** BoulderStone::haveObstacle: a stone in the next cell. */
  private boulderBlocked(o: GameObject, d: number): boolean {
    const [dx, dy] = STEPS[d];
    return this.stoneAt(o.col + dx, o.row + dy);
  }

  /** BoulderStone::triggerObstacle: only Oxyd stones react (tryOpen on a raising trigger). */
  private boulderTrigger(o: GameObject, d: number, raising: boolean): void {
    const [dx, dy] = STEPS[d];
    // BlockerStone::message("_trigger"): shrinks
    if (raising) for (const b of this.at(o.col + dx, o.row + dy)) if (b.cls === 'blocker' && !b.gone) this.blockerSet(b, 'shrinking');
    // BreakStone::message("_trigger"): a boulder breaks st_break_boulder
    if (raising) for (const b of this.at(o.col + dx, o.row + dy)) if (b.cls === 'breakstone' && !b.gone && breakType(b) === 'boulder') this.breakStone(b);
    // MirrorStone::message("_trigger", 1): turns
    if (raising) for (const m of this.at(o.col + dx, o.row + dy)) if (m.cls === 'mirror' && !m.gone) this.turnMirror(m, 1);
    // ActorImpulseStone::message("_trigger", true): sends the boulder back
    if (raising)
      for (const b of this.at(o.col + dx, o.row + dy))
        if (b.cls === 'actorimpulse' && !b.gone) {
          o.state = (o.state + 2) % 4;
          b.pulse = this.now;
        }
    if (raising) this.events.push({ type: 'oxyd', col: o.col + dx, row: o.row + dy });
    // FourSwitch::message("_trigger", false): turns
    if (!raising) for (const f of this.at(o.col + dx, o.row + dy)) if (f.cls === 'fourswitch' && !f.gone) this.turnFourswitch(f);
    // PassageStone::message("_trigger"): toggles on every trigger
    for (const p of this.at(o.col + dx, o.row + dy)) if (p.cls === 'passage' && !p.gone) p.state = 1 - p.state;
  }

  /** Stone::move_stone + BoulderStone::on_move; on an abyss the boulder falls (on_floor_change). */
  private boulderMove(o: GameObject, d: number): boolean {
    const [dx, dy] = STEPS[d];
    if (!this.push(o, dx, dy)) return false;
    o.boulder = { phase: 'active', since: this.now };
    this.boulderTrigger(o, o.state, true);
    if (this.env.floorAt(o.col, o.row) === 'fl_abyss') o.boulder = { phase: 'falling', since: this.now };
    return true;
  }

  /** BoulderStone::setDir (messages turn, turnback, flip). */
  private boulderTurn(o: GameObject, d: number): void {
    if (d === o.state || o.boulder?.phase === 'falling') return;
    o.state = d;
    o.boulder = { phase: 'active', since: this.now };
    this.boulderTrigger(o, d, true);
  }

  /** BoulderStone::animcb at the end of every animation cycle. */
  private boulderCycle(o: GameObject): void {
    const b = o.boulder!;
    const d = o.state;
    if (b.phase === 'falling') {
      o.gone = true;
      this.unplace(o);
      this.updateTriggers(o.col, o.row);
      return;
    }
    if (b.phase === 'init') {
      b.phase = 'idle';
      if (!this.boulderBlocked(o, d)) this.boulderMove(o, d);
    } else if (b.phase === 'idle') {
      if (!this.boulderBlocked(o, d)) b.phase = 'active';
    } else {
      this.boulderTrigger(o, d, false);
      if (!this.boulderMove(o, d)) b.phase = 'idle';
    }
  }

  /** Landmine::explode → it_explosion_hollow. */
  private explode(o: GameObject): void {
    if (o.exploding !== undefined) return;
    o.exploding = this.now;
    this.events.push({ type: 'sound', name: 'landmine' });
  }

  /** Stone::on_stonehit of the items under a stone that just moved here. */
  private stoneHitsItems(col: number, row: number): void {
    for (const o of [...this.at(col, row)]) {
      if (o.cls === 'landmine' && !o.gone) this.explode(o);
      else if (o.cls === 'coin' && !o.gone) o.kind = o.kind === 'it_coin_m' ? 'it_coin_l' : o.kind === 'it_coin_l' ? 'it_coin_l' : 'it_coin_m'; // Coin::on_stonehit
      else if (o.cls === 'bomb' && !o.gone && o.blast === undefined && o.igniteAt === undefined) o.igniteAt = this.now + 10; // Bomb::on_stonehit
      else if (o.cls === 'seed' && !o.gone) this.startGrowing(o);
      else if (o.cls === 'meditation' && !o.gone) this.shovel(o);
      else if (o.kind === 'it_glasses' && !o.gone) {
        // Glasses::on_stonehit: they break
        o.kind = 'it_glasses_broken';
        this.events.push({ type: 'sound', name: 'glass' });
      } else if (o.kind !== 'it_bottle_broken' && o.cls === 'bottle' && !o.gone) {
        // Bottle::on_stonehit: it breaks
        o.kind = 'it_bottle_broken';
        this.events.push({ type: 'sound', name: 'glass' });
      } else if ((o.kind === 'it_cherry' || o.kind === 'it_banana') && !o.gone) {
        // Cherry/Banana::on_stonehit
        o.kind = 'it_squashed';
        o.cls = 'squashed';
      }
    }
  }

  /** Meditation::shovel: one step flatter; a flat one disappears. */
  private shovel(o: GameObject): void {
    const s = o.state > 0 ? o.state - 1 : o.state + 1;
    if (s === 0) {
      o.gone = true;
      this.unplace(o);
    } else o.state = s;
  }

  /** WormHole::actor_hit: marble centre within 0.125 of a wormhole centre → its destination. */
  warpTarget(x: number, y: number): { x: number; y: number; cut: boolean } | null {
    for (const o of this.at(Math.floor(x), Math.floor(y))) {
      if (o.cls !== 'wormhole' || (o.engagedUntil ?? -1) > this.now) continue;
      const dx = x - (o.col + 0.5);
      const dy = y - (o.row + 0.5);
      if (dx * dx + dy * dy >= 0.015625) continue;
      const m = /^(-?[\d.]+),(-?[\d.]+)$/.exec(o.attrs.dest ?? '');
      if (!m) continue;
      const latency = numAttr(o.attrs.interval, 0);
      if (latency > 0) o.engagedUntil = this.now + latency * 1000;
      // WormHole: scissor cuts the rubber bands of the warped actor
      return { x: Number(m[1]), y: Number(m[2]), cut: truthy(o.attrs.scissor) };
    }
    return null;
  }

  /** Trigger::updateIState: pressed by the marble or a stone on it. */
  private updateTriggers(col: number, row: number): void {
    this.floodCheck(col, row);
    const pressed =
      this.marbles.some((m) => m.col === col && m.row === row) || this.at(col, row).some((x) => (x.cls === 'box' || x.cls === 'puzzle') && !x.gone);
    for (const o of this.at(col, row)) {
      if (o.cls !== 'trigger' || o.state === (pressed ? 1 : 0)) continue;
      o.state = pressed ? 1 : 0;
      this.events.push({ type: 'sound', name: pressed ? 'triggerdown' : 'triggerup' });
      this.performAction(o, pressed);
    }
  }

  /** Every marble whose centre is in this cell shatters (a stone moved onto it). */
  private shatterAt(col: number, row: number): void {
    this.marbles.forEach((m, i) => {
      if (m.col === col && m.row === row) this.events.push({ type: 'shatter', marble: i });
    });
  }

  private slot(i: number): { col: number; row: number; init: boolean; realCol?: number; realRow?: number } {
    while (this.marbles.length <= i) this.marbles.push({ col: -1, row: -1, init: false });
    return this.marbles[i];
  }

  /** Cell of marble i's centre; call after every physics step. */
  marbleAt(col: number, row: number, i = 0): void {
    const m = this.slot(i);
    if (!m.init) {
      m.init = true;
      m.col = col;
      m.row = row;
      for (const o of this.at(col, row)) if (o.cls === 'trigger') o.state = 1; // no action at start
      this.pickUp(col, row);
      m.realCol = col;
      m.realRow = row;
      return;
    }
    // Sensor::actor_enter / actor_leave: a real change of the grid cell (not jumping or dying)
    if (col >= 0 && (col !== m.realCol || row !== m.realRow)) {
      if (m.realCol !== undefined && m.realCol >= 0) {
        this.sensorStep(m.realCol, m.realRow!, true);
        this.blockerLeave(m.realCol, m.realRow!);
      }
      this.sensorStep(col, row, false);
      this.crackEnter(col, row);
      m.realCol = col;
      m.realRow = row;
    }
    if (col === m.col && row === m.row) return;
    const oldCol = m.col;
    const oldRow = m.row;
    m.col = col;
    m.row = row;
    this.updateTriggers(oldCol, oldRow);
    this.updateTriggers(col, row);
    this.pickUp(col, row);
  }

  /** Marble i is gone (fell, shattered): triggers under it are released. */
  marbleGone(i = 0): void {
    // flying, dying or warped: a pearl leaves its hollow
    for (const o of this.objects) if (o.meditatist?.marble === i) o.meditatist = undefined;
    if (!this.slot(i).init) return;
    this.marbleAt(-1, -1, i);
  }

  /** Start over at the next marbleAt (respawn: no trigger action, like a new level). */
  resetMarble(i = 0): void {
    this.slot(i).init = false;
  }

  private pickUp(col: number, row: number): void {
    for (const o of this.at(col, row)) {
      if (o.cls !== 'document' || o.gone) continue;
      o.gone = true;
      this.events.push({ type: 'sound', name: 'pickup' });
      const key = o.attrs.text ?? '';
      this.events.push({ type: 'text', text: this.texts[key] ?? key });
    }
  }

  /** Advance animations by ms milliseconds. */
  update(ms: number): void {
    this.now += ms;
    this.lightStep(ms);
    for (const o of this.objects) {
      if (o.cls === 'chess' && !o.gone) this.chessStep(o);
      if (o.cls === 'vortex' && !o.gone) this.vortexStep(o);
      if (o.cls === 'scales' && !o.gone) this.scalesStep(o);
      if (o.cls === 'bridge' && !o.gone) this.bridgeStep(o);
      if (o.cls === 'rotator' && !o.gone) this.rotatorStep(o);
      if (o.cls === 'blocker' && !o.gone) this.blockerStep(o);
      if (o.cls === 'breakstone' && !o.gone && o.breaking === undefined && o.kind === 'st_flat_breaking') o.breaking = this.now;
      if (o.cls === 'breakstone' && !o.gone && o.breaking !== undefined && this.now - o.breaking >= breakMs(o)) this.remove(o);
      if (o.cls === 'ice' && !o.gone && o.breaking !== undefined && this.now - o.breaking >= 5 * 50) {
        // IceBlock::animcb (BREAKING): CoverFloor fl_ice here and on the four neighbours (not abyss)
        this.remove(o);
        for (const [dx, dy] of [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const c = o.col + dx;
          const r = o.row + dy;
          if (c < 0 || r < 0 || c >= this.width || this.env.floorAt(c, r) === 'fl_abyss') continue;
          this.env.setFloor(c, r, 'fl_ice');
          this.events.push({ type: 'floor', col: c, row: r });
          for (const it of this.at(c, r)) if (!it.gone && (it.cls === 'crack' || (it.cls === 'meditation' && it.state < 0))) this.remove(it);
        }
      }
      if (o.cls === 'dispenser' && !o.gone && o.breaking !== undefined && this.now - o.breaking >= 7 * 50) {
        // DispenserStone::animcb: neighbouring dispensers break too, the item here ignites
        this.remove(o);
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) for (const n of this.at(o.col + dx, o.row + dy)) if (n.cls === 'dispenser' && !n.gone) this.breakStone(n);
        const item = this.at(o.col, o.row).find((x) => !x.gone && isItem(x));
        if (item) this.igniteAt(o.col, o.row);
        else this.addExplosion(o.col, o.row, 0);
      }
      if (o.cls === 'coinslot' && !o.gone) this.coinslotStep(o);
      if (o.cls === 'burnable' && !o.gone) this.burnableStep(o);
      if (o.cls === 'volcano' && !o.gone) this.volcanoStep(o);
      if (o.cls === 'spitter' && !o.gone) this.spitterStep(o);
      if (o.cls === 'yystone' && !o.gone && o.state === 1) {
        o.pulse ??= this.now;
        if (this.now - o.pulse >= 6 * 140) {
          // YinyangStone::animcb: idle again with loop, else inactive; the switch unless instant
          o.state = truthy(o.attrs.loop) ? 0 : 2;
          if (!yinyangInstant(o)) this.yinyangSwitch(o);
        }
      }
      // st_laserflop_on starts ON_TIMER
      if (o.cls === 'monoflop' && !o.gone && o.state === 1 && o.alarmAt === undefined && !o.lasered) o.alarmAt = this.now + (Number(o.attrs.interval) || 1.8) * 1000;
      if (o.cls === 'monoflop' && !o.gone && o.state === 1 && o.alarmAt !== undefined && this.now >= o.alarmAt) {
        // MonoFlopStone::alarm: off, action false
        o.state = 0;
        o.alarmAt = undefined;
        this.performAction(o, false);
      }
      if (o.cls === 'cross' && !o.gone && o.cross) {
        // CrossItem::actor_leave cancels the alarm; CrossItem::alarm performs the action
        if (o.cross.inside && this.now - o.cross.seen > 150) {
          o.cross.inside = false;
          if (o.state === 1) o.state = 0;
        }
        if (o.state === 1 && this.now >= o.cross.at) {
          o.state = 0;
          this.performAction(o, true);
        }
      }
      if (o.cls === 'lightpassenger' && !o.gone) this.passengerStep(o);
      if (o.cls === 'shogundot' && !o.gone) this.shogunDotStep(o);
      if (o.cls === 'thief' && !o.gone && o.thief?.phase) this.thiefStep(o);
      if (o.cls === 'flthief' && !o.gone) {
        // ThiefFloor::actor_enter: an idle floor thief emerges for a marble arriving on the floor
        const inside = this.marbles.flatMap((m, i) => (m.init && m.col === o.col && m.row === o.row ? [i] : []));
        const fresh = inside.find((i) => !(o.inside ?? []).includes(i));
        o.inside = inside;
        if (o.state === 0 && !o.thief?.phase) {
          const knight = this.stoneObjectAt(o.col, o.row);
          if (knight?.cls === 'chess') this.captureThief(o); // ChessStone → "_capture"
          else if (fresh !== undefined) o.thief = { ...(o.thief ?? { loot: [] }), phase: 'emerge', since: this.now, victim: fresh };
        }
        if (o.thief?.phase) this.thiefStep(o);
      }
      if ((o.cls === 'explosion' || o.cls === 'debris' || o.cls === 'dynamite' || o.cls === 'bomb' || o.cls === 'puller') && !o.gone) this.blastStep(o);
      if (o.cls === 'crack' && !o.gone && o.dissolving !== undefined && this.now - o.dissolving >= CRACK_DISSOLVE_MS) this.crackDissolved(o);
      if (o.cls === 'boulder' && !o.gone) {
        o.boulder ??= { phase: 'init', since: 0 };
        // one decision per finished cycle; a move restarts the cycle (init_model)
        while (!o.gone && this.now - o.boulder.since >= BOULDER_MS) {
          const before = o.boulder;
          before.since += BOULDER_MS;
          this.boulderCycle(o);
        }
      }
      // Explosion::animcb: a hollow remains unless the floor cannot be dug.
      if (o.exploding !== undefined && this.now - o.exploding >= EXPLOSION_MS) {
        o.exploding = undefined;
        if (HARD_FLOORS.has(this.env.floorAt(o.col, o.row))) {
          o.gone = true;
          this.unplace(o);
        } else {
          o.kind = 'it_meditation_hollow';
          o.cls = 'meditation';
          o.state = -2;
        }
      }
      // SeedItem::animcb: the seed becomes st_box_wood_growing, replacing any stone there.
      if (o.kind === 'it_seed_volcano' && !o.gone && o.growing !== undefined && this.now - o.growing >= SEED_GROW_MS) {
        // SeedItem::animcb: st_volcano_growing replaces the stone here
        o.gone = true;
        this.unplace(o);
        for (const s of this.at(o.col, o.row)) if (!s.gone && !isItem(s)) this.remove(s);
        const v = this.add('st_volcano_growing', 'volcano', o.col, o.row);
        v.state = 3;
        v.blast = this.now;
        v.attrs = { secure: o.attrs.secure ?? '' };
        continue;
      }
      if (o.cls === 'seed' && !o.gone && o.growing !== undefined && this.now - o.growing >= SEED_GROW_MS) {
        o.gone = true;
        this.unplace(o);
        for (const s of this.at(o.col, o.row)) {
          if (s.cls === 'box' && !s.gone) {
            s.gone = true;
            this.unplace(s);
          }
        }
        // SeedItem::animcb: wood → st_box_wood, hay → st_box_hay, greenbrown → st_greenbrown (fixed)
        const grown = o.kind === 'it_seed_hay' ? 'st_box_hay' : o.kind === 'it_seed_greenbrown' ? 'st_greenbrown' : this.random() < 0.5 ? 'st_box_wood_h' : 'st_box_wood_v';
        const box = this.add(grown, 'box', o.col, o.row);
        box.growing = this.now;
        this.shatterAt(o.col, o.row);
        this.updateTriggers(o.col, o.row);
      }
      // BoxStone::animcb: grown; on abyss, water or swamp it becomes a bridge.
      if (o.cls === 'box' && !o.gone && o.growing !== undefined && this.now - o.growing >= BOX_GROW_MS) {
        o.growing = undefined;
        if (o.kind === 'st_greenbrown' && this.env.setStaticStone) {
          // GreenBrownStone: a plain fixed stone
          this.remove(o);
          this.env.setStaticStone(o.col, o.row, 'st_greenbrown');
          continue;
        }
        if (SINK_FLOORS.has(this.env.floorAt(o.col, o.row))) {
          o.gone = true;
          this.unplace(o);
          this.env.setFloor(o.col, o.row, bridgeFloor(o.kind));
          this.events.push({ type: 'floor', col: o.col, row: o.row });
        }
      }
    }
    this.heatingStep();
    this.floodStep();
    this.ballStep();
    for (const o of this.objects) {
      const imp = o.impulse;
      if (imp && o.moving && this.now - o.moving.since >= o.moving.dur) {
        if (imp.phase === 'expanding') {
          // SHRINKING: impulse to all four neighbours (StoneImpulse::setIState).
          imp.phase = 'shrinking';
          o.moving = { to: 0, since: this.now, dur: IMPULSE_SHRINK_MS };
          for (let d = 0; d < 4; d++) this.sendImpulse(o.col + STEPS[d][0], o.row + STEPS[d][1], d);
        } else {
          o.impulse = undefined;
          o.moving = null;
        }
      }
    }
    for (const o of this.objects) {
      if (o.puzzle === 'ignited' && o.fuse !== undefined && this.now >= o.fuse) this.explodeStone(o);
      if (o.puzzle === 'exploding' && o.moving && this.now - o.moving.since >= o.moving.dur) {
        // PuzzleStone::animcb: the stone is gone.
        o.gone = true;
        o.moving = null;
        this.unplace(o);
      }
    }
    for (const o of this.objects) {
      // TimerStone::alarm: send the value, flip it; a non-looping timer stops.
      while (o.alarm && this.now >= o.alarm.at) {
        const value = o.alarm.value;
        if (o.attrs.loop === 'false') {
          o.alarm = undefined;
          o.state = 0;
        } else o.alarm = { at: o.alarm.at + timerInterval(o), value: !value };
        this.performAction(o, value);
      }
    }
    for (const o of this.objects) {
      const m = o.moving;
      if (!m || this.now - m.since < m.dur || o.impulse) continue;
      o.moving = null;
      o.state = m.to;
      if (o.cls === 'door' && o.state === 0) this.shatterIfInside(o);
      if (o.cls === 'switch' && !truthy(o.attrs.instant)) this.performAction(o, o.state === 1);
    }
  }

  /** Animation progress 0..1 towards the target state (1 when not moving). */
  /** A message from a Lua callback (obj:open(), obj:message("toggle") …). */
  sendMessage(o: GameObject, msg: string, value: boolean, num?: number): void {
    if (!o.gone) this.message(o, msg, value, num);
  }

  /** The stone (non-item) object in a cell. */
  stoneObjectAt(col: number, row: number): GameObject | null {
    return this.at(col, row).find((o) => !o.gone && !isItem(o)) ?? null;
  }

  /** The item object in a cell. */
  itemAt(col: number, row: number): GameObject | null {
    return this.at(col, row).find((o) => !o.gone && isItem(o)) ?? null;
  }

  /** wo[pos] = {kind, …} from a Lua callback: a new object (null if Murmel has no such object). */
  create(kind: string, col: number, row: number, attrs: Record<string, string>): GameObject | null {
    const cls = objectClass(kind);
    if (!cls) return null;
    const o = this.add(kind === 'st_box_wood' ? (this.random() < 0.5 ? 'st_box_wood_h' : 'st_box_wood_v') : kind, cls, col, row);
    o.attrs = { ...attrs };
    o.name = attrs.name ?? '';
    o.state = initialState(kind, attrs);
    if (o.cls === 'timer' && o.state === 1) this.startTimer(o);
    this.updateTriggers(col, row);
    return o;
  }

  /** obj:kill() / wo[pos] = {"st_nil"}. */
  remove(o: GameObject): void {
    if (o.gone) return;
    o.gone = true;
    this.unplace(o);
    this.updateTriggers(o.col, o.row);
  }

  /** Boulder animation: frame 0–2 of the current cycle and whether it is falling. */
  boulderFrame(o: GameObject): { frame: number; falling: boolean } {
    const b = o.boulder ?? { phase: 'init', since: 0 };
    return { frame: Math.min(2, Math.floor(Math.max(0, this.now - b.since) / 120)), falling: b.phase === 'falling' };
  }

  /** Milliseconds since a seed or grown box started growing (-1 = not growing). */
  growAge(o: GameObject): number {
    return o.growing === undefined ? -1 : this.now - o.growing;
  }

  progress(o: GameObject): number {
    return o.moving ? Math.min(1, (this.now - o.moving.since) / o.moving.dur) : 1;
  }

  private shatterIfInside(o: GameObject): void {
    this.shatterAt(o.col, o.row);
  }

  private setState(o: GameObject, s: number): void {
    if (o.cls === 'timer') {
      // TimerStone::setState: 1 starts the timer (value true first), 0 stops it.
      if (s === o.state) return;
      o.state = s;
      if (s === 1) this.startTimer(o);
      else o.alarm = undefined;
      return;
    }
    if (o.cls === 'wormhole' || o.cls === 'magnet') {
      o.state = s; // on/off switches the pull (a wormhole teleports either way)
      return;
    }
    if (o.cls !== 'door' && o.cls !== 'switch') return; // others ignore state writes
    const to = target(o);
    if (s === to) return;
    const frames = o.cls === 'door' ? (DOOR_FRAMES[doorFlavor(o)] ?? 2) : SWITCH_FRAMES;
    const dur = frames * FRAME_MS;
    if (o.moving) {
      // Reverse a running animation from where it is.
      const done = Math.min(dur, this.now - o.moving.since);
      o.moving = { to: s, since: this.now - (dur - done), dur };
    } else {
      o.moving = { to: s, since: this.now, dur };
    }
    if (o.cls === 'door') {
      this.events.push({ type: 'sound', name: 'door' });
      if (s === 0) this.shatterIfInside(o);
    } else {
      this.events.push({ type: 'sound', name: 'switch' });
      if (truthy(o.attrs.instant)) this.performAction(o, s === 1);
    }
  }

  private message(o: GameObject, msg: string, value: boolean, num?: number): void {
    if (this.compat < 1.1) msg = API1_RENAMING[`${o.cls}__${msg}`] ?? msg;
    // "kill": the object is gone
    if (msg === 'kill') {
      this.remove(o);
      return;
    }
    if (o.cls === 'floorref') {
      // Floor messages: fire (setfire, forcefire, stopfire, heat, ignite); a FloodStream floor starts flooding
      const f: FireFlags = { message: true, first: false, last: false };
      const c = o.col;
      const r = o.row;
      if (msg === 'forcefire') this.forceFire(c, r);
      else if (msg === 'setfire') this.tryIgnite(c, r, -1, f);
      else if (msg === 'ignite') this.floorIgnite(c, r);
      else if (msg === 'heat') this.tryHeating(c, r, -1, f);
      else if (msg === 'stopfire') {
        const it = this.itemAt(c, r);
        if (it?.cls === 'burnable' && (burnState(it) === 'ignited' || burnState(it) === 'burning')) {
          // Floor::stop_fire(message): no transformation, ash unless noash
          this.remove(it);
          if (!this.fireType(c, r, 'noash')) this.add('it_burnable_ash', 'burnable', c, r);
        }
      } else if ((msg === 'toggle' || msg === 'on' || (msg === 'signal' && value)) && (this.env.floorAt(c, r) === 'fl_water' || /^fl_(wood|hay|rock)_framed/.test(this.env.floorAt(c, r)))) {
        this.startFlood(c, r, this.floodInterval(c, r));
      }
      return;
    }
    // "ignite": burnable items set their floor on fire, dynamite and bombs burn, cracks crack
    if (msg === 'ignite' && (o.cls === 'burnable' || o.cls === 'dynamite' || o.cls === 'bomb' || o.cls === 'crack')) {
      if (o.cls === 'burnable') this.floorIgnite(o.col, o.row);
      else if (o.cls === 'crack') this.crack(o);
      else this.burn(o);
      return;
    }
    if (o.cls === 'quake') {
      // A fake quake stone has no messages.
      if (o.kind !== 'st_fake_quake' && (msg === 'toggle' || (msg === 'signal' && value))) this.quake(o);
      return;
    }
    if (o.cls === 'impulse') {
      if (msg === 'signal' && value) this.startImpulse(o, -1);
      return;
    }
    if (o.cls === 'meditation') {
      // Meditation::message / toggleState
      const s = o.state;
      if (msg === 'flip') o.state = -s;
      else if (msg === 'signal') o.state = value ? Math.abs(s) : -Math.abs(s);
      else if (msg === 'shovel') this.shovel(o);
      else if (msg === 'toggle') o.state = { [-3]: 2, [-2]: 3, [-1]: 1, 1: -1, 2: -3, 3: -2 }[s] ?? s;
      return;
    }
    if (o.cls === 'landmine') return;
    if (o.cls === 'monoflop') {
      // MonoFlopStone::setState: on / signal 1 switch on (or renew the timer); off is ignored
      if (msg === 'on' || (msg === 'signal' && value) || msg === 'toggle') this.monoflopOn(o);
      return;
    }
    if (o.cls === 'volcano') {
      // VolcanoStone: _trigger / toggle wake an inactive one; setState (signal, on, off) while inactive or active
      if (msg === 'toggle' || msg === '_trigger') {
        if (o.state === 0) this.volcanoSet(o, 1);
      } else if (o.state <= 1 && (msg === 'signal' || msg === 'on' || msg === 'off')) this.volcanoSet(o, msg === 'on' || (msg === 'signal' && value) ? 1 : 0);
      return;
    }
    if (o.cls === 'disco') {
      // DiscoStone::message: lighten, darken (old levels: by 2), signal (1 lighter, 0 darker by 2)
      const old = this.compat < 1.1;
      if (msg === 'lighten') o.state = Math.max(0, o.state - (old ? 2 : 1));
      else if (msg === 'darken') o.state = Math.min(2, o.state + (old ? 2 : 1));
      else if (msg === 'signal') o.state = Math.max(0, Math.min(2, o.state + (value ? -2 : 2)));
      return;
    }
    if (o.cls === 'window') {
      // WindowStone "inner_pull" (direction): the opposite face moves to that side, if free
      if (msg === 'inner_pull' && num !== undefined) {
        const d = num & 3;
        const faces = windowFaces(o);
        const to = 1 << d;
        const from = 1 << ((d + 2) % 4);
        if (!(faces & from) || faces & to) return;
        const n = this.stoneObjectAt(o.col + L_DX[d], o.row + L_DY[d]);
        if (this.env.staticStone?.(o.col + L_DX[d], o.row + L_DY[d]) || (n && (n.cls !== 'window' || windowFaces(n) & from))) return;
        o.attrs = { ...o.attrs, $connections: String(ALL_FACES ^ ((faces & ~from) | to)) };
        // a portable item here moves along (or is squashed if the next cell has one)
        const it = this.itemAt(o.col, o.row);
        if (it && PICKUP_RADIUS[it.cls] !== undefined) {
          this.remove(it);
          if (this.itemAt(o.col + L_DX[d], o.row + L_DY[d])) this.add('it_squashed', 'squashed', o.col, o.row);
          else this.add(it.kind, it.cls, o.col + L_DX[d], o.row + L_DY[d]).attrs = it.attrs;
        }
      }
      return;
    }
    if (o.cls === 'jamb') {
      // JambStone "signal" from a stone (not an item): the neighbours in the sender's row (or column) get 1,
      // the other two 0
      const from = this.sender;
      if (msg === 'signal' && from && !isItem(from)) {
        const row = from.row === o.row;
        for (const [dx, dy, horiz] of [[1, 0, true], [-1, 0, true], [0, -1, false], [0, 1, false]] as const) {
          const n = this.stoneObjectAt(o.col + dx, o.row + dy);
          if (n) this.message(n, 'signal', horiz === row, horiz === row ? 1 : 0);
        }
      }
      return;
    }
    if (o.cls === 'polarswitch') {
      // StateObject messages: on, off, toggle, signal
      if (msg === 'on' || msg === 'open') this.setPolar(o, 1);
      else if (msg === 'off' || msg === 'close') this.setPolar(o, 0);
      else if (msg === 'toggle') this.setPolar(o, 1 - o.state);
      else if (msg === 'signal') this.setPolar(o, value ? 1 : 0);
      return;
    }
    if (o.cls === 'passage') {
      // PassageStone: signal toggles the colour (any value); otherwise StateObject messages
      if (msg === 'signal' || msg === 'toggle') o.state = 1 - o.state;
      else if (msg === 'open' || msg === 'on') o.state = 1;
      else if (msg === 'close' || msg === 'off') o.state = 0;
      return;
    }
    if (o.cls === 'oxydref') {
      this.events.push({ type: 'oxydMsg', col: o.col, row: o.row, msg, value });
      return;
    }
    if (o.cls === 'blocker') {
      // BlockerStone/BlockerItem messages: open = shrink, close = grow, toggle, signal
      const b = this.blockerOf(o);
      if (msg === 'open' || msg === 'on' || (msg === 'signal' && value)) this.blockerOpen(o);
      else if (msg === 'close' || msg === 'off' || (msg === 'signal' && !value)) this.blockerClose(o);
      else if (msg === 'toggle') {
        if (b.phase === 'open') {
          if (b.lock === 'unlocked') b.lock = 'locked';
          else this.blockerClose(o);
        } else if (b.phase === 'shrinking') this.blockerSet(o, 'growing');
        else this.blockerSet(o, 'shrinking');
      }
      return;
    }
    if (o.cls === 'turnstile') {
      // TurnstilePivot::message: signal (0 = clockwise), turn, turnback
      const cc = truthy(o.attrs.counterclock);
      if (msg === 'signal') this.rotateTurnstile(o, !value, -1, null);
      else if (msg === 'turn' || msg === 'turnback') this.rotateTurnstile(o, (msg === 'turn') !== cc, -1, null);
      return;
    }
    if (o.cls === 'turnstilearm') {
      if (msg === 'orientate' && num !== undefined && num >= 0 && num <= 3) o.state = num;
      return;
    }
    if (o.cls === 'lightpassenger') {
      // on/off/toggle/signal; a boulder's _trigger toggles
      if (msg === 'on' || (msg === 'signal' && value)) o.state = 1;
      else if (msg === 'off' || (msg === 'signal' && !value)) o.state = 0;
      else if (msg === 'toggle') o.state = 1 - o.state;
      return;
    }
    if (o.cls === 'dynamite' || o.cls === 'bomb') {
      // ignite / explode (Dynamite/Bomb::message), signal 1 = burning
      if (msg === 'ignite' || (msg === 'signal' && value) || msg === 'on') this.burn(o);
      else if (msg === 'explode') o.cls === 'bomb' ? this.bombExplode(o) : this.dynamiteExplode(o);
      return;
    }
    if (o.cls === 'counter') {
      // CounterGadget::message: signal counts up (true) or down; target_<n>/action_<n> act
      if (msg === 'signal') {
        o.state += (num ?? (value ? 1 : 0)) ? 1 : -1;
        if (o.attrs[`target_${o.state}`] !== undefined || o.attrs[`action_${o.state}`] !== undefined) this.performAction(o, true);
      }
      return;
    }
    if (o.cls === 'bridge') {
      // StateObject messages → BridgeFloor::setState / toggleState
      const b = this.bridgeOf(o);
      const closed = b.phase === 'closed' || b.phase === 'closing';
      if (msg === 'open' || msg === 'on') this.bridgeSet(o, 1);
      else if (msg === 'close' || msg === 'off') this.bridgeSet(o, 0);
      else if (msg === 'signal') this.bridgeSet(o, value ? 1 : 0);
      else if (msg === 'toggle') {
        if (closed && this.bridgeStone(o)) b.explicit = !b.explicit;
        else this.bridgeSet(o, closed ? 1 : 0);
      }
      return;
    }
    if (o.cls === 'crack') {
      // Crack::message: crack / ignite
      if (msg === 'crack' || msg === 'ignite') this.crack(o);
      return;
    }
    if (o.cls === 'laser') {
      // LaserStone::message / setState: on, off, toggle, signal; orientate, turn, turnback
      if (msg === 'orientate' && num !== undefined) o.attrs = { ...o.attrs, orientation: String(num) };
      else if (msg === 'turn' || msg === 'turnback') {
        const cw = (msg === 'turn') !== truthy(o.attrs.counterclock);
        o.attrs = { ...o.attrs, orientation: String(cw ? (laserDir(o) + 3) % 4 : (laserDir(o) + 1) % 4) };
      } else if (msg === 'on' || msg === 'off' || msg === 'toggle' || msg === 'signal') {
        o.state = msg === 'on' ? 1 : msg === 'off' ? 0 : msg === 'toggle' ? 1 - o.state : value ? 1 : 0;
      }
      return;
    }
    if (o.cls === 'mirror') {
      // MirrorStone::message: orientate, turn/turnback, signal 1 and _trigger toggle
      if (msg === 'orientate' && num !== undefined && num >= 0 && num <= 3) o.state = num;
      else if (msg === 'turn' || msg === 'turnback') this.turnMirror(o, (msg === 'turn') !== truthy(o.attrs.counterclock) ? 1 : -1);
      else if ((msg === 'signal' || msg === 'toggle') && (num ?? (value ? 1 : 0)) === 1) this.turnMirror(o, 1);
      return;
    }
    if (o.cls === 'keyswitch') {
      // StateObject messages → KeySwitch::setState (performs its action on a change)
      const to = msg === 'toggle' ? 1 - o.state : msg === 'on' ? 1 : msg === 'off' ? 0 : msg === 'signal' ? (value ? 1 : 0) : o.state;
      if (to !== o.state) {
        o.state = to;
        this.events.push({ type: 'sound', name: 'switch' });
        this.performAction(o, to === 1);
      }
      return;
    }
    if (o.cls === 'sensor') {
      // Sensor::message: a filter passes signal 1 on
      if (msg === 'signal' && /filter/.test(o.kind) && (num ?? (value ? 1 : 0)) === 1) this.sensorAction(o);
      return;
    }
    if (o.cls === 'vortex') {
      // StateObject messages → Vortex::setState / toggleState
      const v = this.vortexOf(o);
      const isOpen = v.phase === 'open' || v.phase === 'opening';
      if (msg === 'open' || msg === 'on' || (msg === 'signal' && value)) this.vortexSet(o, 1);
      else if (msg === 'close' || msg === 'off' || (msg === 'signal' && !value)) this.vortexSet(o, 0);
      else if (msg === 'toggle') this.vortexSet(o, isOpen ? 0 : 1);
      return;
    }
    if (o.cls === 'chess') {
      // ChessStone::message: signal sets the colour, flip toggles it
      if (msg === 'signal') o.state = (num ?? (value ? 1 : 0)) === 1 ? 1 : 0;
      else if (msg === 'flip') o.state = 1 - o.state;
      return;
    }
    if (o.cls === 'fourswitch') {
      // FourSwitch::message: signal with an odd value (or any in API 1) and a falling _trigger turn it
      if (msg === 'toggle' || (msg === 'signal' && ((num ?? (value ? 1 : 0)) % 2 === 1 || this.compat < 1.1))) this.turnFourswitch(o);
      return;
    }
    if (o.cls === 'boulder') {
      // BoulderStone::message "orientate": the direction of the value
      if (msg === 'orientate' && num !== undefined) {
        this.boulderTurn(o, num & 3);
        return;
      }
      // BoulderStone::message: turn (clockwise), turnback, flip; counterclock swaps turn directions
      const ccw = truthy(o.attrs.counterclock);
      const cw = (d: number) => (d + 3) % 4; // W→N→E→S→W in Enigma numbering (W0 S1 E2 N3)
      const acw = (d: number) => (d + 1) % 4;
      if (msg === 'turn') this.boulderTurn(o, ccw ? acw(o.state) : cw(o.state));
      else if (msg === 'turnback') this.boulderTurn(o, ccw ? cw(o.state) : acw(o.state));
      else if (msg === 'flip') this.boulderTurn(o, (o.state + 2) % 4);
      return;
    }
    if (o.cls === 'seed') {
      // SeedItem::message: grow or signal (any value) starts growing.
      if (msg === 'grow' || msg === 'signal') this.startGrowing(o);
      return;
    }
    if (o.cls === 'oneway') {
      // OneWayStone::message: signal and flip reverse the direction.
      if (msg === 'signal' || msg === 'flip' || msg === 'toggle') o.state = (o.state + 2) % 4;
      else if (msg === 'orientate' && num !== undefined && num >= 0 && num <= 3) o.state = num; // OneWayStone "orientate"
      return;
    }
    switch (msg) {
      case 'toggle':
        this.setState(o, target(o) === 1 ? 0 : 1);
        break;
      case 'signal':
        this.setState(o, value ? 1 : 0);
        break;
      case 'open':
      case 'on':
        this.setState(o, 1);
        break;
      case 'close':
      case 'off':
        this.setState(o, 0);
        break;
      default: // nop and unknown messages are ignored
    }
  }

  /** Enigma Object::performAction: send the action messages to all targets. */
  performAction(o: GameObject, value: boolean, num?: number): void {
    if (truthy(o.attrs.inverse)) {
      value = !value;
      if (num !== undefined && o.cls === 'fourswitch') num = 3 - num; // FourSwitch::invertActionValue
    }
    const s = o.state;
    this.sender = o;
    const targets = splitTokens(o.attrs[`target_${s}`] ?? o.attrs.target);
    const actions = splitTokens(o.attrs[`action_${s}`] ?? o.attrs.action);
    targets.forEach((t, i) => {
      const action = actions[i] ?? '';
      const objs = this.resolve(t);
      // No target object: a Lua function of the level, if any (action "callback" or empty).
      if (objs.length === 0 && (action === '' || action === 'callback')) this.onCallback?.(t, num ?? value, o);
      for (const obj of objs) this.message(obj, action === '' ? 'toggle' : action, value, num);
    });
  }

  /** Objects named by a target token: "#id", a name or a name pattern with * and ?. */
  resolve(token: string): GameObject[] {
    if (/^#\d+$/.test(token)) return this.objects.filter((o) => `#${o.id}` === token);
    if (token.startsWith('%')) return [];
    if (/[*?]/.test(token)) {
      const re = new RegExp(`^${token.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
      return this.objects.filter((o) => o.name !== '' && re.test(o.name));
    }
    return this.objects.filter((o) => o.name === token);
  }
}

function target(o: GameObject): number {
  return o.moving ? o.moving.to : o.state;
}

/** Direction of a one-way stone: attribute, exported state or kind suffix (default north). */
function onewayDir(kind: string, a: Record<string, string>): number {
  for (const v of [a.orientation, a.$state, a.state]) if (v !== undefined && v !== '' && Number.isInteger(Number(v))) return Number(v) & 3;
  const m = /_([nesw])$/.exec(kind);
  return m ? DIR_SUFFIX[m[1]] : 3;
}

/**
 * OneWayStone::collision_response: the black marble passes a plain or black stone
 * against the arrow only from outside the arrow side; a white one-way stone blocks it.
 */
function onewayFaces(o: GameObject): number {
  return o.attrs.color === '1' || o.kind.includes('_white') ? ALL_FACES : DIR_FACE[o.state & 3];
}

function initialState(kind: string, a: Record<string, string>): number {
  // YinyangStone: kinds _active / _inactive
  if (/^st_yinyang/.test(kind)) return kind === 'st_yinyang_active' ? 1 : kind === 'st_yinyang_inactive' ? 2 : 0;
  // SpitterStone: 1 active (default), 0 idle
  if (kind === 'st_spitter') return a.$state === '0' ? 0 : 1;
  // MonoFlopStone st_laserflop_on: ON_PENDING (on, the timer runs, no action)
  if (kind === 'st_laserflop_on') return 1;
  // VolcanoStone: 0 inactive, 1 active, 2 new, 3 growing, 4 breaking, 5 finished
  if (/^st_volcano/.test(kind)) return kind === 'st_volcano_active' || a.$state === '1' ? 1 : kind === 'st_volcano_new' ? 2 : kind === 'st_volcano_growing' ? 3 : 0;
  // DiscoStone: 0 light, 1 medium, 2 dark
  if (/^st_disco/.test(kind)) return a.$state !== undefined && a.$state !== '' ? Number(a.$state) : kind === 'st_disco_dark' ? 2 : kind === 'st_disco_medium' ? 1 : 0;
  if (/^st_oneway/.test(kind)) return onewayDir(kind, a);
  // Vortex: 1 open, 0 closed
  if (/^it_vortex/.test(kind)) return kind === 'it_vortex_closed' ? 0 : a.$state === '0' ? 0 : 1;
  // RotatorStone: 0 clockwise, 1 counterclockwise
  if (/^st_rotator/.test(kind)) return a.counterclock !== undefined && a.counterclock !== '' ? (truthy(a.counterclock) ? 1 : 0) : kind.includes('_ccw') ? 1 : 0;
  // KnightStone: hits taken 0..4
  if (kind === 'st_knight') return Math.min(4, Math.max(0, Math.trunc(Number(a.$state)) || 0));
  // ShogunStone: state = hole bits (s 4, m 8, l 16) from flavor or kind
  if (/^st_shogun/.test(kind)) {
    const f = a.flavor || /^st_shogun_(\w+)$/.exec(kind)?.[1] || 's';
    return (f.includes('s') ? 4 : 0) | (f.includes('m') ? 8 : 0) | (f.includes('l') ? 16 : 0) || 4;
  }
  // TurnstileArm: state = side of the pivot it sits on (W 0, S 1, E 2, N 3), default north
  if (/^st_turnstilearm/.test(kind)) {
    const v = Number(a.orientation ?? a.$state);
    if ((a.orientation ?? a.$state) !== undefined && v >= 0 && v <= 3) return v;
    return DIR_LETTER[/^st_turnstilearm_([nesw])$/.exec(kind)?.[1] ?? 'n'];
  }
  // LightPassengerStone: on unless _off
  if (/^st_lightpassenger/.test(kind)) return a.$state !== undefined && a.$state !== '' ? (Number(a.$state) ? 1 : 0) : kind.endsWith('_off') ? 0 : 1;
  // CoinSlot: always off at the start
  if (kind === 'st_coinslot' || kind === 'st_coinslot_instant') return 0;
  // CounterGadget: any whole number
  if (kind === 'ot_counter') return Math.trunc(Number(a.$state ?? a.state)) || 0;
  // Crack: INVISIBLE -1, SMALL 0, MEDIUM 1, LARGE 2
  if (/^it_crack/.test(kind)) {
    const s = Number(a.$state);
    if (a.$state !== undefined && a.$state !== '' && s >= -1 && s <= 2) return s;
    return /^it_crack_i/.test(kind) ? -1 : /^it_crack_m/.test(kind) ? 1 : /^it_crack_l/.test(kind) ? 2 : 0;
  }
  // MirrorStone: state = orientation (Enigma direction W 0, S 1, E 2, N 3), default north
  if (MIRROR_KIND.test(kind)) {
    const v = Number(a.orientation);
    if (a.orientation !== undefined && a.orientation !== '' && v >= 0 && v <= 3) return v;
    return DIR_LETTER[MIRROR_KIND.exec(kind)?.[2] ?? 'n'];
  }
  // BlurStone: 0 straight, 1 cross, 2 magic
  if (/^st_blur/.test(kind)) {
    const f = a.flavor || a.$flavor || /^st_blur_(\w+)$/.exec(kind)?.[1] || 'straight';
    return f === 'magic' ? 2 : f === 'cross' ? 1 : 0;
  }
  // ChessStone: state = colour (0 black, 1 white)
  if (/^st_chess/.test(kind)) return a.color !== undefined && a.color !== '' ? (Number(a.color) === 1 ? 1 : 0) : kind.endsWith('_white') ? 1 : 0;
  // FourSwitch: state = direction (default north)
  if (kind === 'st_fourswitch') return Number.isInteger(Number(a.$state)) && a.$state !== '' && a.$state !== undefined ? Number(a.$state) & 3 : 3;
  // PassageStone: state = colour (0 black, 1 white)
  if (PASSAGE.test(kind)) {
    const c = a.color ?? a.$state;
    return c !== undefined && c !== '' ? (Number(c) === 1 ? 1 : 0) : kind.includes('_white') ? 1 : 0;
  }
  // Boulder: direction from orientation or kind suffix, default north ($state is internal)
  if (/^st_boulder/.test(kind)) return onewayDir(kind, { orientation: a.orientation ?? '' });
  if (kind in MEDITATION_STATE) {
    const s = Number(a.$state);
    return a.$state && Number.isInteger(s) && s !== 0 && Math.abs(s) <= 3 ? s : MEDITATION_STATE[kind];
  }
  const s = a.$state ?? a.state;
  if (s !== undefined && s !== '') return Number(s) ? 1 : 0;
  return kind.endsWith('_open') || kind === 'st_timer' || kind === 'ot_timer' || kind === 'it_wormhole' || kind === 'it_wormhole_on' || kind === 'it_magnet_on' || kind === 'fl_bridge' ? 1 : 0;
}

function numAttr(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : fallback;
}

/** Timer interval in ms (objects.xml default 1 s). */
function timerInterval(o: GameObject): number {
  const v = Number(o.attrs.interval);
  return (Number.isFinite(v) && v > 0 ? v : 1) * 1000;
}

/** Floor a box turns into when it sinks (BoxStone::maybe_fall_or_stopfire). */
export function bridgeFloor(kind: string): string {
  if (kind === 'st_box_hay') return 'fl_hay_framed';
  if (kind === 'st_box_rock') return 'fl_rock_framed';
  return kind === 'st_box_wood_v' ? 'fl_wood_framed_v' : 'fl_wood_framed_h';
}

export function doorFlavor(o: GameObject): string {
  return o.attrs.flavor || /^st_door_([abcd])/.exec(o.kind)?.[1] || 'd';
}

/** Blocking faces of a closed door: a/b/c all sides, d the sides without connection. */
export function doorFaces(o: GameObject): number {
  if (doorFlavor(o) !== 'd') return ALL_FACES;
  const c = o.attrs.$connections;
  const conn = c !== undefined && c !== '' ? Number(c) : o.kind.includes('_ew') ? NORTH | SOUTH : WEST | EAST;
  return ALL_FACES ^ conn;
}
