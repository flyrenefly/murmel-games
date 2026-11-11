import type { Level } from './level';
import { ALL_FACES, EAST, NORTH, SOUTH, WEST } from './objects';
import FLOORS from './floors.generated.json';

// Rolling physics modelled on Enigma (GPL-2.0-or-later, src/world.cc), which
// reproduces the Oxyd feel:
// - mouse movement becomes a force (MouseSpeed × pixels × floor adhesion),
//   applied for one 10 ms world tick,
// - friction force grows with speed^0.8 and depends on the floor,
// - stones reflect the marble fully elastically,
// - a stone only "feels" a hit above 0.3 tiles/s (slower is just a touch).
// Coordinates in tile units: x = column, y = row; cell (c, r) spans [c, c+1] × [r, r+1].

export const MARBLE_RADIUS = 19 / 64;
export const PHYSICS_DT = 0.0025; // Enigma ActorTimeStep
const WORLD_TICK = 0.01; // Enigma world tick: mouse force lasts this long
const MAX_SPEED = 70; // Enigma MAXVEL, tiles per second
const RESTITUTION = 1.0; // Enigma stone contacts
const HIT_SPEED = 0.3; // below: touch, above: hit
const CONTACT_ZONE = 0.02; // distance in which a stone counts as touched (no overlap)
// While a constant push (keys, tilt) presses into a stone, slow impacts do not bounce,
// so the marble rests instead of jittering. Enigma has no constant push (mouse only),
// so mouse play keeps Enigma's fully elastic behaviour.
const REST_SPEED = 2.0;
export const DEFAULT_MOUSE_SPEED = 4; // Enigma default option "MouseSpeed" (1–15)

const FLOOR_TABLE = FLOORS as unknown as Record<string, [number, number]>;
const DEFAULT_FLOOR = { friction: 5.0, adhesion: 3.0 }; // fl_gray
const floorCache = new Map<string, { friction: number; adhesion: number }>();

/**
 * Friction and adhesion of an Enigma floor kind (from objects.xml). Variants
 * such as fl_lawn_a or fl_gray_framed fall back to their base kind.
 */
export function floorProps(kind: string): { friction: number; adhesion: number } {
  let p = floorCache.get(kind);
  if (!p) {
    let k = kind;
    while (!(k in FLOOR_TABLE) && k.lastIndexOf('_') > 2) k = k.slice(0, k.lastIndexOf('_'));
    const v = FLOOR_TABLE[k];
    p = v ? { friction: v[0], adhesion: v[1] } : DEFAULT_FLOOR;
    floorCache.set(kind, p);
  }
  return p;
}

export type Contact =
  | { kind: 'signal'; index: number; speed: number }
  | { kind: 'wall'; speed: number }
  /** nx/ny: contact normal (stone → marble), vn: speed along it before the bounce (< 0). */
  | { kind: 'object'; col: number; row: number; speed: number; nx: number; ny: number; vn: number; hit: boolean };

/** Dynamic blockers (doors, switches): blocking faces of a cell, 0 = free. */
export interface Blockers {
  blockAt(col: number, row: number): number;
}

export class PhysicsWorld {
  /** Solid cells: -1 = free, -2 = wall, >= 0 = index of the signal stone. */
  private readonly solid: Int32Array;
  private readonly cells: Level['cells'];
  private readonly width: number;
  private readonly height: number;
  private readonly pos = { x: 0, y: 0 };
  private readonly vel = { x: 0, y: 0 };
  private readonly mouse = { x: 0, y: 0 };
  private mouseTime = 0;
  private readonly axisForce = { x: 0, y: 0 };
  private active = true;
  private touching = new Set<number>();
  private nowTouching = new Set<number>();
  private normals: number[] = []; // contact normals of the last step (x, y pairs)
  readonly mass = 1;

  constructor(
    level: Level,
    private readonly blockers: Blockers | null = null,
  ) {
    this.width = level.width;
    this.height = level.height;
    this.solid = new Int32Array(level.width * level.height).fill(-1);
    this.cells = level.cells; // live: boxes turn into floors
    level.cells.forEach((c, i) => {
      if (c.stone !== null && c.stone !== 'st_oxyd') this.solid[i] = -2;
    });
    for (const s of level.signals) this.solid[s.row * level.width + s.col] = s.index;
    this.respawn(level.start.x, level.start.y);
  }

  private solidAt(c: number, r: number): number {
    if (c < 0 || r < 0 || c >= this.width || r >= this.height) return -2;
    return this.solid[r * this.width + c];
  }

  private floorProps(): { friction: number; adhesion: number } {
    const c = Math.floor(this.pos.x);
    const r = Math.floor(this.pos.y);
    const kind = c >= 0 && r >= 0 && c < this.width && r < this.height ? this.cells[r * this.width + c].floor : 'fl_gray';
    return floorProps(kind);
  }

  /** Mouse movement in pixels, already multiplied by the mouse speed option. */
  addMouseForce(fx: number, fy: number): void {
    if (!this.active) return;
    this.mouse.x += fx;
    this.mouse.y += fy;
    this.mouseTime = WORLD_TICK;
  }

  /** Continuous force from keys/tilt/gamepad, before floor adhesion. */
  setAxisForce(fx: number, fy: number): void {
    this.axisForce.x = fx;
    this.axisForce.y = fy;
  }

  step(onContact: (c: Contact) => void): void {
    if (!this.active) return;
    const dt = PHYSICS_DT;
    const { friction, adhesion } = this.floorProps();

    let fx = this.axisForce.x * adhesion;
    let fy = this.axisForce.y * adhesion;
    if (this.mouseTime > 0) {
      fx += this.mouse.x * adhesion;
      fy += this.mouse.y * adhesion;
      this.mouseTime -= dt;
      if (this.mouseTime <= 1e-9) {
        this.mouse.x = this.mouse.y = 0;
        this.mouseTime = 0;
      }
    }
    // No pushing into stones the marble already rests against.
    for (let i = 0; i < this.normals.length; i += 2) {
      const nx = this.normals[i];
      const ny = this.normals[i + 1];
      const fn = fx * nx + fy * ny;
      if (fn < 0) {
        fx -= fn * nx;
        fy -= fn * ny;
      }
    }

    this.vel.x += (dt * fx) / this.mass;
    this.vel.y += (dt * fy) / this.mass;
    let v = Math.hypot(this.vel.x, this.vel.y);
    if (v > MAX_SPEED) {
      this.vel.x *= MAX_SPEED / v;
      this.vel.y *= MAX_SPEED / v;
      v = MAX_SPEED;
    }
    if (v > 0) {
      // Friction force: direction of motion, magnitude friction · v^0.8.
      const dv = Math.min(v, (dt * friction * Math.pow(v, 0.8)) / this.mass);
      this.vel.x -= (this.vel.x / v) * dv;
      this.vel.y -= (this.vel.y / v) * dv;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    this.nowTouching.clear();
    this.normals = [];
    this.collide(onContact);
    const t = this.touching;
    this.touching = this.nowTouching;
    this.nowTouching = t;
  }

  private collide(onContact: (c: Contact) => void): void {
    const r = MARBLE_RADIUS;
    const c0 = Math.floor(this.pos.x - r);
    const c1 = Math.floor(this.pos.x + r);
    const r0 = Math.floor(this.pos.y - r);
    const r1 = Math.floor(this.pos.y + r);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const kind = this.solidAt(col, row);
        if (kind !== -1) {
          this.contactBox(col, row, kind, onContact);
          continue;
        }
        const faces = this.blockers?.blockAt(col, row) ?? 0;
        if (faces === 0) continue;
        if (faces === ALL_FACES) {
          this.contactBox(col, row, -3, onContact);
          continue;
        }
        // Door d: only the closed faces block, and only from outside (Door::collision_response).
        const { x, y } = this.pos;
        if (faces & NORTH && y < row) this.contactAt(Math.max(col, Math.min(x, col + 1)), row, col, row, -3, onContact);
        if (faces & SOUTH && y > row + 1) this.contactAt(Math.max(col, Math.min(x, col + 1)), row + 1, col, row, -3, onContact);
        if (faces & WEST && x < col) this.contactAt(col, Math.max(row, Math.min(y, row + 1)), col, row, -3, onContact);
        if (faces & EAST && x > col + 1) this.contactAt(col + 1, Math.max(row, Math.min(y, row + 1)), col, row, -3, onContact);
      }
    }
  }

  /** Contact with a solid cell. kind: -2 wall, -3 object, >= 0 signal stone index. */
  private contactBox(col: number, row: number, kind: number, onContact: (c: Contact) => void): void {
    const qx = Math.max(col, Math.min(this.pos.x, col + 1));
    const qy = Math.max(row, Math.min(this.pos.y, row + 1));
    this.contactAt(qx, qy, col, row, kind, onContact);
  }

  /** Contact with the closest point (qx, qy) of a blocking shape in cell (col, row). */
  private contactAt(qx: number, qy: number, col: number, row: number, kind: number, onContact: (c: Contact) => void): void {
    const r = MARBLE_RADIUS;
    let nx = this.pos.x - qx;
    let ny = this.pos.y - qy;
    let dist = Math.hypot(nx, ny);
    if (dist >= r + CONTACT_ZONE) return;
    if (dist >= r) {
      // Resting contact without overlap: only stop forces into the stone.
      this.normals.push(nx / dist, ny / dist);
      return;
    }
    if (dist < 1e-9) {
      const dl = this.pos.x - col;
      const dr = col + 1 - this.pos.x;
      const du = this.pos.y - row;
      const dd = row + 1 - this.pos.y;
      const m = Math.min(dl, dr, du, dd);
      [nx, ny] = m === dl ? [-1, 0] : m === dr ? [1, 0] : m === du ? [0, -1] : [0, 1];
      dist = -m;
    } else {
      nx /= dist;
      ny /= dist;
    }
    this.pos.x += nx * (r - dist);
    this.pos.y += ny * (r - dist);
    this.normals.push(nx, ny);
    const vn = this.vel.x * nx + this.vel.y * ny;
    const key = row * this.width + col;
    const isNew = !this.touching.has(key) && !this.nowTouching.has(key);
    if (vn < 0) {
      const speed = Math.hypot(this.vel.x, this.vel.y);
      const pushing = this.axisForce.x * nx + this.axisForce.y * ny < 0;
      const e = pushing && -vn < REST_SPEED ? 0 : RESTITUTION;
      this.vel.x -= (1 + e) * vn * nx;
      this.vel.y -= (1 + e) * vn * ny;
      if (isNew && kind === -3) {
        // Objects also feel soft touches (death stones); hit = above the hit threshold.
        onContact({ kind: 'object', col, row, speed, nx, ny, vn, hit: speed >= HIT_SPEED });
      } else if (isNew && speed >= HIT_SPEED) {
        onContact(
          kind >= 0
            ? { kind: 'signal', index: kind, speed }
            : kind === -3
              ? { kind: 'object', col, row, speed, nx, ny, vn, hit: true }
              : { kind: 'wall', speed },
        );
      }
    }
    this.nowTouching.add(key);
  }

  get position(): { x: number; y: number } {
    return this.pos;
  }

  get velocity(): { x: number; y: number } {
    return this.vel;
  }

  setActive(active: boolean): void {
    this.active = active;
  }

  /** Put the marble at x/y (tile units, marble centre) and stop it. */
  respawn(x: number, y: number): void {
    this.pos.x = x;
    this.pos.y = y;
    this.vel.x = this.vel.y = 0;
    this.mouse.x = this.mouse.y = 0;
    this.mouseTime = 0;
    this.touching.clear();
    this.normals = [];
    this.active = true;
  }

  /** Test helper: set the velocity directly. */
  setVelocity(x: number, y: number): void {
    this.vel.x = x;
    this.vel.y = y;
  }

  dispose(): void {
    /* nothing to free */
  }
}
