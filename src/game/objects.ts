// Interactive Enigma objects (GPL-2.0-or-later, modelled on Enigma's src/Object.cc,
// StateObject.cc, items/Trigger.cc, stones/Switch.cc, stones/Door.cc, SimpleStones.cc):
// switches, triggers and doors that talk to each other by messages, grates,
// documents and pushable boxes (stones/BoxStone.cc, stones.cc maybe_push_stone).
// Times in milliseconds, cells in tile units.

/** One object of a level file: cell, Enigma kind and attributes as text. */
export interface ObjectDef {
  x: number;
  y: number;
  k: string;
  a?: Record<string, string>;
}

export type ObjectClass = 'door' | 'switch' | 'trigger' | 'document' | 'grate' | 'box';

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
}

export type ObjectEvent =
  | { type: 'text'; text: string }
  | { type: 'shatter' }
  | { type: 'floor'; col: number; row: number }
  | { type: 'sound'; name: 'switch' | 'door' | 'triggerdown' | 'triggerup' | 'pickup' | 'move' };

export function objectClass(kind: string): ObjectClass | null {
  if (/^st_door(_[abcd])?(_ew)?(_open)?$/.test(kind)) return 'door';
  if (/^st_switch(_black|_white)?(_instant)?$/.test(kind)) return 'switch';
  if (kind === 'it_trigger') return 'trigger';
  if (kind === 'it_document') return 'document';
  if (/^st_grate(_cross|_framed)?$/.test(kind)) return 'grate';
  if (/^st_box(_wood(_[hv])?|_hay|_rock)?$/.test(kind)) return 'box';
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
    }
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
      if (o.cls === 'switch' || (o.cls === 'box' && !o.gone)) return ALL_FACES;
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
      if (o.cls !== 'switch') continue;
      const c = o.attrs.color;
      const ic = c === undefined || c === '' ? 0 : Number(c) + 1;
      if (ic === 0 || ic === color + 1) this.setState(o, target(o) === 1 ? 0 : 1);
    }
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

  /** Trigger::updateIState: pressed by the marble or a stone on it. */
  private updateTriggers(col: number, row: number): void {
    const pressed = (col === this.marble.col && row === this.marble.row) || this.at(col, row).some((x) => x.cls === 'box' && !x.gone);
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

function initialState(kind: string, a: Record<string, string>): number {
  const s = a.$state ?? a.state;
  if (s !== undefined && s !== '') return Number(s) ? 1 : 0;
  return kind.endsWith('_open') ? 1 : 0;
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
