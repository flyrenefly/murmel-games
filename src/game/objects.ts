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

export type ObjectClass = 'door' | 'switch' | 'trigger' | 'document' | 'grate' | 'box' | 'timer' | 'quake' | 'death' | 'oneway' | 'puzzle' | 'wormhole' | 'impulse' | 'meditation' | 'landmine' | 'seed' | 'boulder' | 'wand' | 'oxydref' | 'spring' | 'chameleon' | 'extralife' | 'passage' | 'yinyang' | 'swap' | 'fourswitch' | 'chess' | 'blur' | 'vortex' | 'tool' | 'actorimpulse' | 'flag' | 'springboard' | 'magnet' | 'sensor' | 'key' | 'keyswitch' | 'laser' | 'mirror' | 'crack' | 'scales' | 'bridge' | 'counter' | 'pull' | 'rotator' | 'blocker' | 'laserswitch';

/** Items (it_*): they lie on the floor, stones can move onto them. */
const ITEM_CLASSES = new Set<ObjectClass>(['trigger', 'document', 'wormhole', 'meditation', 'landmine', 'seed', 'wand', 'spring', 'extralife', 'yinyang', 'vortex', 'tool', 'flag', 'springboard', 'magnet', 'sensor', 'key', 'crack']);
/** Item::actor_hit: pick-up radius (ItemTraits radius, default 0.3). */
const PICKUP_RADIUS: Partial<Record<ObjectClass, number>> = { seed: 0.2, wand: 0.3, spring: 0.3, extralife: 0.3, yinyang: 0.3, tool: 0.3, flag: 0.3, key: 0.3 };
/** German names of inventory items for the display. */
export const ITEM_NAMES: Record<string, string> = { it_seed: 'Samen', it_seed_wood: 'Samen', it_magicwand: 'Zauberstab', it_spring: 'Feder', it_spring_keep: 'Feder', it_spring_drop: 'Feder (fällt ab)', it_extralife: 'Extraleben', it_yinyang: 'Yin-Yang', it_ring: 'Ring', it_spoon: 'Löffel', it_flag: 'Fahne', it_flag_black: 'Fahne', it_flag_white: 'weiße Fahne', it_key: 'Schlüssel', it_wrench: 'Schraubenschlüssel' };
// Keys with a code (KeySwitch "code"): it_key_<code> in the inventory
for (let i = 1; i <= 99; i++) ITEM_NAMES[`it_key_${i}`] = `Schlüssel ${i}`;

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
  setStaticStone?(col: number, row: number, kind: string | null): void;
  /** The plain stone of a cell lets laser light through (Stone::is_transparent: glass, hollow). */
  transparentAt?(col: number, row: number): boolean;
}

const NO_ENV: ObjectEnv = { stoneAt: () => false, floorAt: () => 'fl_gray', setFloor: () => {} };

/**
 * Old levels (Enigma compatibility < 1.10, API 1) use other message names; Enigma
 * translates them per receiving class (api1init.lua MessageRenaming).
 */
const API1_RENAMING: Record<string, string> = {
  door__openclose: 'toggle',
  switch__onoff: 'toggle',
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
  /** Blocker: stone (solid, shrinking, growing) or item (open, with its lock state). */
  blocker?: { phase: 'solid' | 'shrinking' | 'growing' | 'open'; since: number; lock: 'idle' | 'new' | 'locked' | 'unlocked'; stone?: GameObject | null };
  /** Rotator: start of the current turn, and the neighbours remembered for its impulses. */
  rotor?: { since: number; alarm?: number; neighbors?: (GameObject | null)[] };
  /** Bridge floor: phase, its start and whether it was closed explicitly (OBJBIT_EXPLICIT). */
  bridge?: { phase: 'open' | 'closed' | 'opening' | 'closing'; since: number; explicit: boolean };
  /** Scales: checked once (the initial state acts not). */
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
  /** LaserBeam::actor_hit → "_laserhit": marble i shatters. */
  | { type: 'laserhit'; marble: number }
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
  | { type: 'sound'; name: 'switch' | 'door' | 'triggerdown' | 'triggerup' | 'pickup' | 'move' | 'explode' | 'fakeoxyd' | 'landmine' | 'mirror' | 'laser' };

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
  if (kind === 'it_seed' || kind === 'it_seed_wood') return 'seed';
  if (kind === 'it_magicwand') return 'wand';
  if (kind === 'it_extralife') return 'extralife';
  if (kind === 'it_yinyang') return 'yinyang';
  // Plain inventory items whose use main.ts handles (Ring, Spoon)
  if (kind === 'it_ring' || kind === 'it_spoon' || kind === 'it_wrench') return 'tool';
  if (/^st_actorimpulse(_invisible)?$/.test(kind)) return 'actorimpulse';
  if (/^it_flag(_black|_white)?$/.test(kind)) return 'flag';
  if (kind === 'it_springboard') return 'springboard';
  if (/^it_magnet(_on|_off)?$/.test(kind)) return 'magnet';
  if (/^it_sensor(_inverse|_exit|_filter[01])?$/.test(kind)) return 'sensor';
  if (/^it_key(_\d+)?$/.test(kind)) return 'key';
  if (kind === 'st_key') return 'keyswitch';
  if (/^st_laser(_[nesw])?$/.test(kind)) return 'laser';
  if (/^it_crack(_[isml])?(_water)?$/.test(kind)) return 'crack';
  if (kind === 'fl_scales') return 'scales';
  if (kind === 'fl_bridge') return 'bridge';
  if (kind === 'ot_counter') return 'counter';
  if (kind === 'st_pull') return 'pull';
  if (kind === 'st_laserswitch') return 'laserswitch';
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
  if (kind === 'st_death' || kind === 'st_death_invisible') return 'death';
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
export const MOVABLE_STONE = /^st_(brownie|plop|(granite|camouflage|redbrown|greenbrown|invisible|rawglass|lightglass|darkglass|flat)_movable)$/;

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
    if (o.col < 0 || o.cls === 'oxydref' || o.cls === 'scales' || o.cls === 'bridge') return; // other objects (ot_timer) have no cell; Oxyd stones and scales are map cells
    const key = o.row * this.width + o.col;
    const list = this.byCell.get(key);
    if (list) list.push(o);
    else this.byCell.set(key, [o]);
  }

  private unplace(o: GameObject): void {
    if (o.col < 0 || o.cls === 'oxydref' || o.cls === 'scales' || o.cls === 'bridge') return;
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
  blockAt(col: number, row: number, color = 2): number {
    for (const o of this.at(col, row)) {
      if (o.cls === 'door') {
        if (o.state === 1 && !o.moving) continue;
        return doorFaces(o);
      }
      if (o.cls === 'switch' || o.cls === 'timer' || o.cls === 'quake' || o.cls === 'death' || o.cls === 'boulder' || o.cls === 'swap' || o.cls === 'pull' || o.cls === 'rotator' || o.cls === 'fourswitch' || o.cls === 'chess' || o.cls === 'blur' || o.cls === 'actorimpulse' || o.cls === 'keyswitch' || o.cls === 'laser' || o.cls === 'mirror' || o.cls === 'laserswitch' || (o.cls === 'blocker' && (o.blocker ? o.blocker.phase === 'solid' || o.blocker.phase === 'growing' : !o.kind.startsWith('it_'))) || (o.cls === 'box' && !o.gone)) return ALL_FACES;
      if (o.cls === 'oneway') return onewayFaces(o);
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
      if (o.cls === 'keyswitch') {
        this.hitKeySwitch(o, by);
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
        if (face && vn < -PUSH_SPEED && !o.gone) this.push(o, -nx, -ny);
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

  /** Stone::send_impulse: a stone receives an impulse in Enigma direction d. */
  private sendImpulse(col: number, row: number, d: number): void {
    const [dx, dy] = STEPS[d];
    for (const o of [...this.at(col, row)]) {
      if (o.gone) continue;
      if (o.cls === 'impulse') {
        // StoneImpulse::on_impulse: a movable one moves first
        if (o.kind === 'st_stoneimpulse_movable') this.push(o, dx, dy);
        this.startImpulse(o, d);
      }
      else if (o.cls === 'box') this.push(o, dx, dy);
      else if (o.cls === 'swap') this.swapStone(o, dx, dy);
      else if (o.cls === 'pull') this.swapStone(o, -dx, -dy, true);
      else if ((o.cls === 'rotator' && rotatorMovable(o)) || (o.cls === 'mirror' && mirrorFlags(o).movable)) this.push(o, dx, dy);
      else if (o.cls === 'boulder' && o.boulder?.phase !== 'falling') this.boulderMove(o, d);
      else if (o.cls === 'puzzle' && !o.puzzle) this.moveCluster(o, dx, dy);
    }
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
        if (radius === undefined || o.gone || o.growing !== undefined || inv.length >= MAX_ITEMS) continue;
        if (this.inhibitPickup && this.ownerOf(marble) === this.player) continue;
        if (Math.hypot(x - (o.col + 0.5), y - (o.row + 0.5)) >= radius) continue;
        o.gone = true;
        this.unplace(o);
        inv.unshift(o.cls === "key" && this.keyCode(o) ? `it_key_${this.keyCode(o)}` : o.kind);
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
    if (this.inventory.length === 0 || this.at(col, row).some((o) => !o.gone && isItem(o))) return false;
    if (this.beams.has(row * this.width + col)) return false;
    if (col < 0 || row < 0 || col >= this.width) return false;
    const kind = this.inventory.shift()!;
    const o = this.add(kind, objectClass(kind) ?? 'seed', col, row);
    if (o.cls === 'seed') this.startGrowing(o);
    if (o.cls === 'flag') this.flagRespawn[flagColor(kind)] = { x: col + 0.5, y: row + 0.5 };
    return true;
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
    if (o.cls === 'passage' || o.cls === 'grate' || o.cls === 'pull') return true;
    if (o.cls === 'door') return o.state === 1 && !o.moving;
    if (o.cls === 'puzzle') return isHollow(o);
    if (o.cls === 'box') return /^st_(rawglass|lightglass)_movable$/.test(o.kind);
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
        }
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
      inv.unshift(code ? `it_key_${code}` : 'it_key');
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
      if (m.init && m.col === o.col && m.row === o.row) mass += this.isPearl(i) ? 0.7 : 1;
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
  coversFloor(x: number, y: number): boolean {
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
      else if (o.cls === 'seed' && !o.gone) this.startGrowing(o);
      else if (o.cls === 'meditation' && !o.gone) this.shovel(o);
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
      if (o.cls === 'seed' && !o.gone && o.growing !== undefined && this.now - o.growing >= SEED_GROW_MS) {
        o.gone = true;
        this.unplace(o);
        for (const s of this.at(o.col, o.row)) {
          if (s.cls === 'box' && !s.gone) {
            s.gone = true;
            this.unplace(s);
          }
        }
        const box = this.add(this.random() < 0.5 ? 'st_box_wood_h' : 'st_box_wood_v', 'box', o.col, o.row);
        box.growing = this.now;
        this.shatterAt(o.col, o.row);
        this.updateTriggers(o.col, o.row);
      }
      // BoxStone::animcb: grown; on abyss, water or swamp it becomes a bridge.
      if (o.cls === 'box' && !o.gone && o.growing !== undefined && this.now - o.growing >= BOX_GROW_MS) {
        o.growing = undefined;
        if (SINK_FLOORS.has(this.env.floorAt(o.col, o.row))) {
          o.gone = true;
          this.unplace(o);
          this.env.setFloor(o.col, o.row, bridgeFloor(o.kind));
          this.events.push({ type: 'floor', col: o.col, row: o.row });
        }
      }
    }
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
  sendMessage(o: GameObject, msg: string, value: boolean): void {
    if (!o.gone) this.message(o, msg, value);
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
      else if (msg === 'turn') this.turnMirror(o, 1);
      else if (msg === 'turnback') this.turnMirror(o, -1);
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
  if (/^st_oneway/.test(kind)) return onewayDir(kind, a);
  // Vortex: 1 open, 0 closed
  if (/^it_vortex/.test(kind)) return kind === 'it_vortex_closed' ? 0 : a.$state === '0' ? 0 : 1;
  // RotatorStone: 0 clockwise, 1 counterclockwise
  if (/^st_rotator/.test(kind)) return a.counterclock !== undefined && a.counterclock !== '' ? (truthy(a.counterclock) ? 1 : 0) : kind.includes('_ccw') ? 1 : 0;
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
