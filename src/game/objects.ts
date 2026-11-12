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

export type ObjectClass = 'door' | 'switch' | 'trigger' | 'document' | 'grate' | 'box' | 'timer' | 'quake' | 'death' | 'oneway' | 'puzzle' | 'wormhole' | 'impulse' | 'meditation' | 'landmine' | 'seed' | 'boulder' | 'wand' | 'oxydref' | 'spring' | 'chameleon' | 'extralife' | 'passage' | 'yinyang';

/** Items (it_*): they lie on the floor, stones can move onto them. */
const ITEM_CLASSES = new Set<ObjectClass>(['trigger', 'document', 'wormhole', 'meditation', 'landmine', 'seed', 'wand', 'spring', 'extralife', 'yinyang']);
/** Item::actor_hit: pick-up radius (ItemTraits radius, default 0.3). */
const PICKUP_RADIUS: Partial<Record<ObjectClass, number>> = { seed: 0.2, wand: 0.3, spring: 0.3, extralife: 0.3, yinyang: 0.3 };
/** German names of inventory items for the display. */
export const ITEM_NAMES: Record<string, string> = { it_seed: 'Samen', it_seed_wood: 'Samen', it_magicwand: 'Zauberstab', it_spring: 'Feder', it_spring_keep: 'Feder', it_spring_drop: 'Feder (fällt ab)', it_extralife: 'Extraleben', it_yinyang: 'Yin-Yang' };

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
  /** Seed: growing since this time; box: grown from a seed, growing since this time. */
  growing?: number;
}

export type ObjectEvent =
  | { type: 'text'; text: string }
  /** marble: index of the marble that shatters. */
  | { type: 'shatter'; marble: number }
  | { type: 'floor'; col: number; row: number }
  | { type: 'quake' }
  /** A message to a named Oxyd stone (open, close, toggle, signal, shuffle, closeall …). */
  | { type: 'oxydMsg'; col: number; row: number; msg: string; value: boolean }
  /** A stone triggered the Oxyd stone in this cell (OxydStone "_trigger" → tryOpen). */
  | { type: 'oxyd'; col: number; row: number }
  | { type: 'sound'; name: 'switch' | 'door' | 'triggerdown' | 'triggerup' | 'pickup' | 'move' | 'explode' | 'fakeoxyd' | 'landmine' };

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
  if (kind === 'st_stoneimpulse' || kind === 'st_stoneimpulse_hollow') return 'impulse';
  return null;
}

/**
 * Plain stones that move like a wood box (StandardStone/GlassStone with MOVABLE_STANDARD):
 * st_brownie and the _movable variants. Unlike BoxStone they do not sink or build bridges.
 */
export const MOVABLE_STONE = /^st_(brownie|(granite|camouflage|redbrown|invisible|rawglass|lightglass|darkglass)_movable)$/;

/** Image and shadow of a movable plain stone (models-2d.lua); invisible ones draw nothing. */
export function movableLook(kind: string): { image: string; shadow: string } | null {
  if (kind === 'st_invisible_movable') return null;
  if (kind === 'st_brownie') return { image: 'st_brownie', shadow: 'sh_round' };
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
  readonly events: ObjectEvent[] = [];
  private readonly byCell = new Map<number, GameObject[]>();
  private now = 0;
  /** Lua function as action target (Object::performAction → lua::CallFunc). */
  onCallback: ((fn: string, value: boolean, sender: GameObject) => void) | null = null;
  /** wo["FallenPuzzle"]: floor that a sunk puzzle stone leaves. */
  fallenPuzzle = FALLEN_PUZZLE;
  /** Inventory of the player (item kinds, first = used by a click; Inventory::add_item inserts in front). */
  readonly inventories: string[][] = [[], []];
  /** The current player (YIN 0, YANG 1): player::CurrentPlayer. */
  player = 0;
  /** Owner of a marble (actor owner attribute): items it picks up go to that inventory. */
  ownerOf: (marble: number) => number = () => 0;
  /** The current player's inventory. */
  get inventory(): string[] {
    return this.inventories[this.player];
  }
  private nextId = 0;
  /** Cell of each marble's centre (-1 = gone); init = false until its first marbleAt. */
  private marbles: { col: number; row: number; init: boolean }[] = [];

  constructor(
    defs: readonly ObjectDef[],
    private readonly width: number,
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
    if (o.col < 0 || o.cls === 'oxydref') return; // other objects (ot_timer) have no cell; Oxyd stones are map cells
    const key = o.row * this.width + o.col;
    const list = this.byCell.get(key);
    if (list) list.push(o);
    else this.byCell.set(key, [o]);
  }

  private unplace(o: GameObject): void {
    if (o.col < 0 || o.cls === 'oxydref') return;
    const key = o.row * this.width + o.col;
    const list = (this.byCell.get(key) ?? []).filter((x) => x !== o);
    if (list.length) this.byCell.set(key, list);
    else this.byCell.delete(key);
  }

  /** A stone (fixed or object) occupies the cell. */
  private stoneAt(col: number, row: number): boolean {
    if (this.env.stoneAt(col, row)) return true;
    return this.at(col, row).some((o) => !o.gone && !ITEM_CLASSES.has(o.cls));
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
      if (o.cls === 'switch' || o.cls === 'timer' || o.cls === 'quake' || o.cls === 'death' || o.cls === 'boulder' || (o.cls === 'box' && !o.gone)) return ALL_FACES;
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
  hit(col: number, row: number, color = 0, nx = 0, ny = 0, vn = 0): void {
    for (const o of [...this.at(col, row)]) {
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
      if (this.at(c, r).some((x) => !x.gone && !ITEM_CLASSES.has(x.cls) && !members.has(x))) return;
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
      if (o.cls === 'impulse') this.startImpulse(o, d);
      else if (o.cls === 'box') this.push(o, dx, dy);
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
      if (o.cls !== 'wormhole' || o.state !== 1) continue;
      const strength = 0.6 * numAttr(o.attrs.strength, 30);
      const range = numAttr(o.attrs.range, 10);
      const dx = o.col + 0.5 - x;
      const dy = o.row + 0.5 - y;
      const sq = dx * dx + dy * dy;
      if (sq >= 0.025 && sq < range * range) {
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
      // Item::actor_hit (SeedItem: radius 0.2, not while growing; others 0.3) → Player::pick_up.
      for (const o of [...this.at(Math.floor(x), Math.floor(y))]) {
        const radius = PICKUP_RADIUS[o.cls];
        const inv = this.inventories[this.ownerOf(marble)] ?? this.inventory;
        if (radius === undefined || o.gone || o.growing !== undefined || inv.length >= MAX_ITEMS) continue;
        if (Math.hypot(x - (o.col + 0.5), y - (o.row + 0.5)) >= radius) continue;
        o.gone = true;
        this.unplace(o);
        inv.unshift(o.kind);
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
    if (this.inventory.length === 0 || this.at(col, row).some((o) => !o.gone && ITEM_CLASSES.has(o.cls))) return false;
    if (col < 0 || row < 0 || col >= this.width) return false;
    const kind = this.inventory.shift()!;
    const o = this.add(kind, objectClass(kind) ?? 'seed', col, row);
    if (o.cls === 'seed') this.startGrowing(o);
    return true;
  }

  /** Item::can_drop_at: no item in the cell. */
  canDropAt(x: number, y: number): boolean {
    return !this.at(Math.floor(x), Math.floor(y)).some((o) => !o.gone && ITEM_CLASSES.has(o.cls));
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

  // ---------- boulders (BoulderStone.cc) ----------

  /** BoulderStone::haveObstacle: a stone in the next cell. */
  private boulderBlocked(o: GameObject, d: number): boolean {
    const [dx, dy] = STEPS[d];
    return this.stoneAt(o.col + dx, o.row + dy);
  }

  /** BoulderStone::triggerObstacle: only Oxyd stones react (tryOpen on a raising trigger). */
  private boulderTrigger(o: GameObject, d: number, raising: boolean): void {
    const [dx, dy] = STEPS[d];
    if (raising) this.events.push({ type: 'oxyd', col: o.col + dx, row: o.row + dy });
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
  warpTarget(x: number, y: number): { x: number; y: number } | null {
    for (const o of this.at(Math.floor(x), Math.floor(y))) {
      if (o.cls !== 'wormhole' || (o.engagedUntil ?? -1) > this.now) continue;
      const dx = x - (o.col + 0.5);
      const dy = y - (o.row + 0.5);
      if (dx * dx + dy * dy >= 0.015625) continue;
      const m = /^(-?[\d.]+),(-?[\d.]+)$/.exec(o.attrs.dest ?? '');
      if (!m) continue;
      const latency = numAttr(o.attrs.interval, 0);
      if (latency > 0) o.engagedUntil = this.now + latency * 1000;
      return { x: Number(m[1]), y: Number(m[2]) };
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

  private slot(i: number): { col: number; row: number; init: boolean } {
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
      return;
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
    for (const o of this.objects) {
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
    return this.at(col, row).find((o) => !o.gone && !ITEM_CLASSES.has(o.cls)) ?? null;
  }

  /** The item object in a cell. */
  itemAt(col: number, row: number): GameObject | null {
    return this.at(col, row).find((o) => !o.gone && ITEM_CLASSES.has(o.cls)) ?? null;
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
    if (o.cls === 'wormhole') {
      o.state = s; // on/off switches the pull; teleporting works either way
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

  private message(o: GameObject, msg: string, value: boolean): void {
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
    if (o.cls === 'boulder') {
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
  performAction(o: GameObject, value: boolean): void {
    if (truthy(o.attrs.inverse)) value = !value;
    const s = o.state;
    const targets = splitTokens(o.attrs[`target_${s}`] ?? o.attrs.target);
    const actions = splitTokens(o.attrs[`action_${s}`] ?? o.attrs.action);
    targets.forEach((t, i) => {
      const action = actions[i] ?? '';
      const objs = this.resolve(t);
      // No target object: a Lua function of the level, if any (action "callback" or empty).
      if (objs.length === 0 && (action === '' || action === 'callback')) this.onCallback?.(t, value, o);
      for (const obj of objs) this.message(obj, action === '' ? 'toggle' : action, value);
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
  return kind.endsWith('_open') || kind === 'st_timer' || kind === 'ot_timer' || kind === 'it_wormhole' || kind === 'it_wormhole_on' ? 1 : 0;
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
