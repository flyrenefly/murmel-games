// Interactive Enigma objects (GPL-2.0-or-later, modelled on Enigma's src/Object.cc,
// StateObject.cc, items/Trigger.cc, stones/Switch.cc, stones/Door.cc, SimpleStones.cc):
// switches, triggers and doors that talk to each other by messages, grates,
// documents, pushable boxes (stones/BoxStone.cc, stones.cc maybe_push_stone) and
// timers (stones/TimerStone.cc), quake stones (stones/QuakeStone.cc), death stones
// (stones/DeathStone.cc), one-way stones (stones/OneWayStone.cc) and puzzle stones
// (stones/PuzzleStone.cc) and wormholes (items/WormHole.cc).
// Times in milliseconds, cells in tile units.

/** One object of a level file: cell, Enigma kind and attributes as text. */
export interface ObjectDef {
  x: number;
  y: number;
  k: string;
  a?: Record<string, string>;
}

export type ObjectClass = 'door' | 'switch' | 'trigger' | 'document' | 'grate' | 'box' | 'timer' | 'quake' | 'death' | 'oneway' | 'puzzle' | 'wormhole';

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
/** Bridge floor of a fallen puzzle (server::FallenPuzzle default). */
const FALLEN_PUZZLE = 'fl_gray';
/** Steps in face-bit order with their bit: W, S, E, N. */
const STEPS: [number, number, number][] = [
  [-1, 0, 1],
  [0, 1, 2],
  [1, 0, 4],
  [0, -1, 8],
];
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
}

export type ObjectEvent =
  | { type: 'text'; text: string }
  | { type: 'shatter' }
  | { type: 'floor'; col: number; row: number }
  | { type: 'quake' }
  | { type: 'sound'; name: 'switch' | 'door' | 'triggerdown' | 'triggerup' | 'pickup' | 'move' | 'explode' };

export function objectClass(kind: string): ObjectClass | null {
  if (/^st_door(_[abcd])?(_ew)?(_open)?$/.test(kind)) return 'door';
  if (/^st_switch(_black|_white)?(_instant)?$/.test(kind)) return 'switch';
  if (kind === 'it_trigger') return 'trigger';
  if (kind === 'it_document') return 'document';
  if (/^st_grate(_cross|_framed)?$/.test(kind)) return 'grate';
  if (/^st_box(_wood(_[hv])?|_hay|_rock)?$/.test(kind)) return 'box';
  if (kind === 'st_timer') return 'timer';
  if (kind === 'st_quake') return 'quake';
  if (kind === 'st_death' || kind === 'st_death_invisible') return 'death';
  if (/^st_oneway(_black|_white)?(_[nesw])?$/.test(kind)) return 'oneway';
  if (/^st_puzzle(_blue|_yellow)?$/.test(kind)) return 'puzzle';
  if (/^it_wormhole(_on|_off)?$/.test(kind)) return 'wormhole';
  return null;
}

/** Messages the objects understand (others need Lua or unsupported objects). */
export const SUPPORTED_ACTIONS = new Set(['', 'toggle', 'signal', 'open', 'on', 'close', 'off', 'nop']);

const truthy = (v: string | undefined): boolean => v === 'true' || (v !== undefined && v !== '' && v !== 'false' && v !== '0');

export function splitTokens(v: string | undefined): string[] {
  return (v ?? '').split(/[;,]/).map((t) => t.trim()).filter((t) => t !== '');
}

export class ObjectWorld {
  readonly objects: GameObject[] = [];
  readonly events: ObjectEvent[] = [];
  private readonly byCell = new Map<number, GameObject[]>();
  private now = 0;
  private marble = { col: -1, row: -1 };
  private initialized = false;

  constructor(
    defs: readonly ObjectDef[],
    private readonly width: number,
    /** Localised texts of documents (key → text). */
    private readonly texts: Record<string, string> = {},
    private readonly env: ObjectEnv = NO_ENV,
    random: () => number = Math.random,
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
      if (o.kind === 'st_box_wood') o.kind = random() < 0.5 ? 'st_box_wood_h' : 'st_box_wood_v';
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
    const key = o.row * this.width + o.col;
    const list = this.byCell.get(key);
    if (list) list.push(o);
    else this.byCell.set(key, [o]);
  }

  private unplace(o: GameObject): void {
    const key = o.row * this.width + o.col;
    const list = (this.byCell.get(key) ?? []).filter((x) => x !== o);
    if (list.length) this.byCell.set(key, list);
    else this.byCell.delete(key);
  }

  /** A stone (fixed or object) occupies the cell. */
  private stoneAt(col: number, row: number): boolean {
    if (this.env.stoneAt(col, row)) return true;
    return this.at(col, row).some((o) => !o.gone && o.cls !== 'trigger' && o.cls !== 'document');
  }

  private at(col: number, row: number): GameObject[] {
    return this.byCell.get(row * this.width + col) ?? [];
  }

  /**
   * Which faces of a cell block the marble: 0 = free, ALL_FACES = solid,
   * otherwise the face bits (door d).
   */
  blockAt(col: number, row: number): number {
    for (const o of this.at(col, row)) {
      if (o.cls === 'door') {
        if (o.state === 1 && !o.moving) continue;
        return doorFaces(o);
      }
      if (o.cls === 'switch' || o.cls === 'timer' || o.cls === 'quake' || o.cls === 'death' || (o.cls === 'box' && !o.gone)) return ALL_FACES;
      if (o.cls === 'oneway') return onewayFaces(o);
      // PuzzleStone::collision_response: exploding stones let the marble pass.
      if (o.cls === 'puzzle' && !o.gone && o.puzzle !== 'exploding') return ALL_FACES;
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

  /** Any contact with the stone in this cell, also a soft one (Stone::actor_touch). */
  touch(col: number, row: number): void {
    for (const o of this.at(col, row)) {
      // PuzzleStone::actor_contact: ignited or exploding puzzle stones shatter the marble.
      if (o.cls === 'puzzle' && (o.puzzle === 'ignited' || o.puzzle === 'exploding')) this.events.push({ type: 'shatter' });
      if (o.cls !== 'death') continue;
      // DeathStone::actor_touch: the marble shatters, the stone pulses.
      this.events.push({ type: 'shatter' });
      if (!o.moving) o.moving = { to: 0, since: this.now, dur: DEATH_MS };
    }
  }

  /** QuakeStone: an idle quake stone shakes and closes all Oxyd stones. */
  private quake(o: GameObject): void {
    if (o.moving) return; // already shaking
    o.moving = { to: 0, since: this.now, dur: QUAKE_MS };
    this.events.push({ type: 'quake' });
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
    if (col === this.marble.col && row === this.marble.row) this.events.push({ type: 'shatter' });
    if (SINK_FLOORS.has(this.env.floorAt(col, row))) {
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
    } else if (push) {
      this.moveCluster(o, dx, dy);
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
      if (this.at(c, r).some((x) => !x.gone && x.cls !== 'trigger' && x.cls !== 'document' && !members.has(x))) return;
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
      if (p.col === this.marble.col && p.row === this.marble.row) this.events.push({ type: 'shatter' });
    }
    this.events.push({ type: 'sound', name: 'move' });
    if (bridge) {
      for (const p of list) {
        p.gone = true;
        this.unplace(p);
        this.env.setFloor(p.col, p.row, FALLEN_PUZZLE);
        this.events.push({ type: 'floor', col: p.col, row: p.row });
      }
    }
    for (const [c, r] of old) this.updateTriggers(c, r);
    for (const p of list) this.updateTriggers(p.col, p.row);
  }

  // ---------- wormholes (WormHole.cc) ----------

  /** Sum of the wormhole pulls on the marble at x/y (WormHole::globalForce, not scaled by the floor). */
  fieldForce(x: number, y: number): [number, number] {
    let fx = 0;
    let fy = 0;
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
      (col === this.marble.col && row === this.marble.row) || this.at(col, row).some((x) => (x.cls === 'box' || x.cls === 'puzzle') && !x.gone);
    for (const o of this.at(col, row)) {
      if (o.cls !== 'trigger' || o.state === (pressed ? 1 : 0)) continue;
      o.state = pressed ? 1 : 0;
      this.events.push({ type: 'sound', name: pressed ? 'triggerdown' : 'triggerup' });
      this.performAction(o, pressed);
    }
  }

  /** Cell of the marble centre; call after every physics step. */
  marbleAt(col: number, row: number): void {
    if (!this.initialized) {
      this.initialized = true;
      this.marble = { col, row };
      for (const o of this.at(col, row)) if (o.cls === 'trigger') o.state = 1; // no action at start
      this.pickUp(col, row);
      return;
    }
    if (col === this.marble.col && row === this.marble.row) return;
    const old = this.marble;
    this.marble = { col, row };
    this.updateTriggers(old.col, old.row);
    this.updateTriggers(col, row);
    this.pickUp(col, row);
  }

  /** The marble is gone (fell, shattered): triggers under it are released. */
  marbleGone(): void {
    if (!this.initialized) return;
    this.marbleAt(-1, -1);
  }

  /** Start over at the next marbleAt (respawn: no trigger action, like a new level). */
  resetMarble(): void {
    this.initialized = false;
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
      if (!m || this.now - m.since < m.dur) continue;
      o.moving = null;
      o.state = m.to;
      if (o.cls === 'door' && o.state === 0) this.shatterIfInside(o);
      if (o.cls === 'switch' && !truthy(o.attrs.instant)) this.performAction(o, o.state === 1);
    }
  }

  /** Animation progress 0..1 towards the target state (1 when not moving). */
  progress(o: GameObject): number {
    return o.moving ? Math.min(1, (this.now - o.moving.since) / o.moving.dur) : 1;
  }

  private shatterIfInside(o: GameObject): void {
    if (o.col === this.marble.col && o.row === this.marble.row) this.events.push({ type: 'shatter' });
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
      if (msg === 'toggle' || (msg === 'signal' && value)) this.quake(o);
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
      for (const obj of this.resolve(t)) this.message(obj, action === '' ? 'toggle' : action, value);
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
  const s = a.$state ?? a.state;
  if (s !== undefined && s !== '') return Number(s) ? 1 : 0;
  return kind.endsWith('_open') || kind === 'st_timer' || kind === 'it_wormhole' || kind === 'it_wormhole_on' ? 1 : 0;
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
