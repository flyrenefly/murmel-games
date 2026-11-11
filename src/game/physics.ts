import { createEnemies, type Enemy, type EnemyKind, KILLER_MOUSE_FACTOR } from './actors';
import type { Level } from './level';
import { ALL_FACES, EAST, NORTH, SOUTH, WEST } from './objects';
import FLOORS from './floors.generated.json';

// Rolling physics modelled on Enigma (GPL-2.0-or-later, src/world.cc), which
// reproduces the Oxyd feel:
// - mouse movement becomes a force (MouseSpeed × pixels × floor adhesion),
//   applied for one 10 ms world tick,
// - friction force grows with speed^0.8 and depends on the floor,
// - stones reflect the marble fully elastically,
// - a stone only "feels" a hit above 0.3 tiles/s (slower is just a touch),
// - actors bounce off each other elastically (World::handle_actor_contact).
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
  | { kind: 'object'; col: number; row: number; speed: number; nx: number; ny: number; vn: number; hit: boolean }
  /** The marble collided with another actor (rotor, top, killer). */
  | { kind: 'actor'; actor: EnemyKind; speed: number };

/** A rolling body: the marble or another actor. */
interface Body {
  readonly pos: { x: number; y: number };
  readonly vel: { x: number; y: number };
  readonly radius: number;
  readonly mass: number;
  normals: number[]; // contact normals of the last step (x, y pairs)
  touching: Set<number>;
  nowTouching: Set<number>;
}

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
  private readonly marble: Body = {
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    radius: MARBLE_RADIUS,
    mass: 1,
    normals: [],
    touching: new Set(),
    nowTouching: new Set(),
  };
  /** Rotors, tops and killers. */
  readonly enemies: Enemy[];
  private readonly mouse = { x: 0, y: 0 };
  private mouseTime = 0;
  private readonly axisForce = { x: 0, y: 0 };
  /** Global forces (wormholes): added unscaled, like Enigma's force fields. */
  private field: ((x: number, y: number) => [number, number]) | null = null;
  private active = true;
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
    this.enemies = createEnemies(level.actors ?? []);
    this.respawn(level.start.x, level.start.y);
  }

  private solidAt(c: number, r: number): number {
    if (c < 0 || r < 0 || c >= this.width || r >= this.height) return -2;
    return this.solid[r * this.width + c];
  }

  private floorProps(pos: { x: number; y: number }): { friction: number; adhesion: number } {
    const c = Math.floor(pos.x);
    const r = Math.floor(pos.y);
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

  setForceField(field: ((x: number, y: number) => [number, number]) | null): void {
    this.field = field;
  }

  /** Continuous force from keys/tilt/gamepad, before floor adhesion. */
  setAxisForce(fx: number, fy: number): void {
    this.axisForce.x = fx;
    this.axisForce.y = fy;
  }

  step(onContact: (c: Contact) => void): void {
    const dt = PHYSICS_DT;
    // Mouse force of this world tick (Enigma: one tick of 10 ms per mouse event).
    let mx = 0;
    let my = 0;
    if (this.mouseTime > 0) {
      mx = this.mouse.x;
      my = this.mouse.y;
      this.mouseTime -= dt;
      if (this.mouseTime <= 1e-9) {
        this.mouse.x = this.mouse.y = 0;
        this.mouseTime = 0;
      }
    }
    for (const e of this.enemies) {
      e.prev.x = e.pos.x;
      e.prev.y = e.pos.y;
    }
    this.actorContacts(onContact);

    if (this.active) {
      const m = this.marble;
      const { friction, adhesion } = this.floorProps(m.pos);
      this.advance(m, (this.axisForce.x + mx) * adhesion, (this.axisForce.y + my) * adhesion, friction);
      this.collide(m, onContact);
    }
    const target = this.active ? this.marble.pos : null;
    for (const e of this.enemies) {
      const { friction, adhesion } = this.floorProps(e.pos);
      let fx: number;
      let fy: number;
      if (e.kind === 'killer') {
        // Steered like the marble (controllers = 3), with the killer's mouse force factor.
        fx = (this.axisForce.x + mx) * adhesion * KILLER_MOUSE_FACTOR;
        fy = (this.axisForce.y + my) * adhesion * KILLER_MOUSE_FACTOR;
      } else [fx, fy] = e.chaseForce(target);
      this.advance(e, fx, fy, friction);
      this.collide(e, null);
    }
  }

  /** One integration step of a body (World::advanceActor). */
  private advance(b: Body, fx: number, fy: number, friction: number): void {
    const dt = PHYSICS_DT;
    if (this.field) {
      const [gx, gy] = this.field(b.pos.x, b.pos.y);
      fx += gx;
      fy += gy;
    }
    // No pushing into stones the body already rests against.
    for (let i = 0; i < b.normals.length; i += 2) {
      const nx = b.normals[i];
      const ny = b.normals[i + 1];
      const fn = fx * nx + fy * ny;
      if (fn < 0) {
        fx -= fn * nx;
        fy -= fn * ny;
      }
    }
    const vel = b.vel;
    vel.x += (dt * fx) / b.mass;
    vel.y += (dt * fy) / b.mass;
    let v = Math.hypot(vel.x, vel.y);
    if (v > MAX_SPEED) {
      vel.x *= MAX_SPEED / v;
      vel.y *= MAX_SPEED / v;
      v = MAX_SPEED;
    }
    if (v > 0) {
      // Friction force: direction of motion, magnitude friction · v^0.8.
      const dv = Math.min(v, (dt * friction * Math.pow(v, 0.8)) / b.mass);
      vel.x -= (vel.x / v) * dv;
      vel.y -= (vel.y / v) * dv;
    }
    b.pos.x += vel.x * dt;
    b.pos.y += vel.y * dt;
  }

  /**
   * World::handle_actor_contact: overlapping actors moving towards each other bounce
   * elastically (restitution 1, reduced mass); the marble shatters on another actor.
   */
  private actorContacts(onContact: (c: Contact) => void): void {
    const bodies: Body[] = this.active ? [this.marble, ...this.enemies] : this.enemies;
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a1 = bodies[i];
        const a2 = bodies[j];
        let nx = a1.pos.x - a2.pos.x;
        let ny = a1.pos.y - a2.pos.y;
        const dist = Math.hypot(nx, ny);
        if (dist >= a1.radius + a2.radius || dist < 1e-9) continue;
        nx /= dist;
        ny /= dist;
        const relspeed = (a2.vel.x - a1.vel.x) * nx + (a2.vel.y - a1.vel.y) * ny;
        if (relspeed < 0) continue; // moving apart
        if (a1 === this.marble) onContact({ kind: 'actor', actor: (a2 as Enemy).kind, speed: relspeed });
        const dmu = a1.mass === a2.mass ? a1.mass : (2 * a1.mass * a2.mass) / (a1.mass + a2.mass);
        const j1 = (dmu * relspeed) / a1.mass;
        const j2 = (dmu * relspeed) / a2.mass;
        a1.vel.x += j1 * nx;
        a1.vel.y += j1 * ny;
        a2.vel.x -= j2 * nx;
        a2.vel.y -= j2 * ny;
      }
    }
  }

  private collide(b: Body, onContact: ((c: Contact) => void) | null): void {
    b.nowTouching.clear();
    b.normals = [];
    const r = b.radius;
    const c0 = Math.floor(b.pos.x - r);
    const c1 = Math.floor(b.pos.x + r);
    const r0 = Math.floor(b.pos.y - r);
    const r1 = Math.floor(b.pos.y + r);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const kind = this.solidAt(col, row);
        if (kind !== -1) {
          this.contactBox(b, col, row, kind, onContact);
          continue;
        }
        const faces = this.blockers?.blockAt(col, row) ?? 0;
        if (faces === 0) continue;
        if (faces === ALL_FACES) {
          this.contactBox(b, col, row, -3, onContact);
          continue;
        }
        // Door d: only the closed faces block, and only from outside (Door::collision_response).
        const { x, y } = b.pos;
        if (faces & NORTH && y < row) this.contactAt(b, Math.max(col, Math.min(x, col + 1)), row, col, row, -3, onContact);
        if (faces & SOUTH && y > row + 1) this.contactAt(b, Math.max(col, Math.min(x, col + 1)), row + 1, col, row, -3, onContact);
        if (faces & WEST && x < col) this.contactAt(b, col, Math.max(row, Math.min(y, row + 1)), col, row, -3, onContact);
        if (faces & EAST && x > col + 1) this.contactAt(b, col + 1, Math.max(row, Math.min(y, row + 1)), col, row, -3, onContact);
      }
    }
    const t = b.touching;
    b.touching = b.nowTouching;
    b.nowTouching = t;
  }

  /** Contact with a solid cell. kind: -2 wall, -3 object, >= 0 signal stone index. */
  private contactBox(b: Body, col: number, row: number, kind: number, onContact: ((c: Contact) => void) | null): void {
    const qx = Math.max(col, Math.min(b.pos.x, col + 1));
    const qy = Math.max(row, Math.min(b.pos.y, row + 1));
    this.contactAt(b, qx, qy, col, row, kind, onContact);
  }

  /**
   * Contact with the closest point (qx, qy) of a blocking shape in cell (col, row).
   * onContact = null: the body bounces without telling the stone (other actors).
   */
  private contactAt(b: Body, qx: number, qy: number, col: number, row: number, kind: number, onContact: ((c: Contact) => void) | null): void {
    const r = b.radius;
    const pos = b.pos;
    const vel = b.vel;
    let nx = pos.x - qx;
    let ny = pos.y - qy;
    let dist = Math.hypot(nx, ny);
    if (dist >= r + CONTACT_ZONE) return;
    if (dist >= r) {
      // Resting contact without overlap: only stop forces into the stone.
      b.normals.push(nx / dist, ny / dist);
      return;
    }
    if (dist < 1e-9) {
      const dl = pos.x - col;
      const dr = col + 1 - pos.x;
      const du = pos.y - row;
      const dd = row + 1 - pos.y;
      const m = Math.min(dl, dr, du, dd);
      [nx, ny] = m === dl ? [-1, 0] : m === dr ? [1, 0] : m === du ? [0, -1] : [0, 1];
      dist = -m;
    } else {
      nx /= dist;
      ny /= dist;
    }
    pos.x += nx * (r - dist);
    pos.y += ny * (r - dist);
    b.normals.push(nx, ny);
    const vn = vel.x * nx + vel.y * ny;
    const key = row * this.width + col;
    const isNew = !b.touching.has(key) && !b.nowTouching.has(key);
    if (vn < 0) {
      const speed = Math.hypot(vel.x, vel.y);
      const pushing = b === this.marble && this.axisForce.x * nx + this.axisForce.y * ny < 0;
      const e = pushing && -vn < REST_SPEED ? 0 : RESTITUTION;
      vel.x -= (1 + e) * vn * nx;
      vel.y -= (1 + e) * vn * ny;
      if (!onContact) {
        /* other actors do not trigger stones */
      } else if (isNew && kind === -3) {
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
    b.nowTouching.add(key);
  }

  get position(): { x: number; y: number } {
    return this.marble.pos;
  }

  get velocity(): { x: number; y: number } {
    return this.marble.vel;
  }

  setActive(active: boolean): void {
    this.active = active;
  }

  /** Put the marble at x/y (tile units, marble centre) and stop it. */
  respawn(x: number, y: number): void {
    const m = this.marble;
    m.pos.x = x;
    m.pos.y = y;
    m.vel.x = m.vel.y = 0;
    this.mouse.x = this.mouse.y = 0;
    this.mouseTime = 0;
    m.touching.clear();
    m.normals = [];
    this.active = true;
  }

  /** Test helper: set the velocity directly. */
  setVelocity(x: number, y: number): void {
    this.marble.vel.x = x;
    this.marble.vel.y = y;
  }

  dispose(): void {
    /* nothing to free */
  }
}
