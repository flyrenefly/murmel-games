import { type ActorDef, createEnemies, type Enemy, enemyKind, type EnemyKind, KILLER_MOUSE_FACTOR } from './actors';
import type { Level } from './level';
import { type BodyForce, Rubberband } from './rubber';
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
  | ({ kind: 'signal'; index: number; speed: number } & Toucher)
  | ({ kind: 'wall'; speed: number } & Toucher)
  /** nx/ny: contact normal (stone → actor), vn: speed along it before the bounce (< 0). */
  | ({ kind: 'object'; col: number; row: number; speed: number; nx: number; ny: number; vn: number; hit: boolean; vx: number; vy: number } & Toucher)
  /** A marble collided with another actor (rotor, top, killer). */
  | { kind: 'actor'; actor: EnemyKind; marble: number; speed: number }
  /** A marble sank in the swamp. */
  | { kind: 'sunk'; marble: number };

/** Who touched a stone: marble index (-1 = another actor) and its colour (0 black, 1 white, 2 none). */
export interface Toucher {
  by: number;
  color: number;
}

/** A marble: black (the player's) or white (second marble, swapped with the yin-yang). */
export interface Marble extends Body {
  readonly color: number;
  /** Position before the last physics step (for interpolation). */
  readonly prev: { x: number; y: number };
  /** false while falling/shattered. */
  active: boolean;
  /** BasicBall::sinkDepth: 0 = on the floor, SINK_DEPTH = sunk. */
  sink: number;
  /** JUMPING: seconds of the jump left (0 = on the floor). */
  jump: number;
  /** ac_pearl (Pearl, BasicBall): small, always follows the mouse, never the swapped-to marble. */
  readonly pearl: boolean;
  /** White marble of player 2 in a single game (controllers 2, no yin-yang): no mouse at all. */
  passive: boolean;
  /** "essential" actor: its final death restarts the level. */
  essential: boolean;
}

/** Pearl traits (Balls.cc): radius 13/64, mass 0.7; adhesion 1 like the marble. */
export const PEARL_RADIUS = 13 / 64;
const PEARL_MASS = 0.7;
const isPearl = (k: string): boolean => /^ac_pearl(_white|_black)?$/.test(k);

/** ac_marble-jump: PingPong of 4 frames à 70 ms (models-2d.lua). */
export const JUMP_SECONDS = 8 * 0.07;

/** Swamp (Swamp::get_sink_speed, server::SwampSinkSpeed): sinks at 4, rises above speed 6. */
const SWAMP_SINK_SPEED = 4;
const SWAMP_RAISE_SPEED = 6;
export const SINK_DEPTH = 7; // BasicBall::maxSinkDepth

function makeMarble(color: number, x: number, y: number, pearl = false, vel = { x: 0, y: 0 }): Marble {
  return {
    pos: { x, y },
    vel,
    prev: { x, y },
    radius: pearl ? PEARL_RADIUS : MARBLE_RADIUS,
    mass: pearl ? PEARL_MASS : 1,
    pearl,
    passive: false,
    essential: false,
    color,
    active: true,
    sink: 0,
    jump: 0,
    normals: [],
    touching: new Set(),
    nowTouching: new Set(),
  };
}

/** A rolling body: the marble or another actor. */
interface Body {
  readonly pos: { x: number; y: number };
  /** Position before the last physics step (for interpolation). */
  readonly prev: { x: number; y: number };
  readonly vel: { x: number; y: number };
  readonly radius: number;
  readonly mass: number;
  normals: number[]; // contact normals of the last step (x, y pairs)
  touching: Set<number>;
  nowTouching: Set<number>;
}

/** Dynamic blockers (doors, switches): blocking faces of a cell, 0 = free. */
export interface Blockers {
  /** color: 0 black, 1 white (marbles, pearls, killers), 2 = no colour. */
  blockAt(col: number, row: number, color?: number): number;
}

export class PhysicsWorld {
  /** Solid cells: -1 = free, -2 = wall, >= 0 = index of the signal stone. */
  private readonly solid: Int32Array;
  private readonly cells: Level['cells'];
  private readonly width: number;
  private readonly height: number;
  /** Marble 0 is black; a white marble (ac_marble_white) follows. */
  readonly marbles: Marble[];
  /** Index of the marble the player steers. */
  private cur = 0;
  /** Rubber bands (ot_rubberband). */
  readonly rubbers: Rubberband[] = [];
  /** Number of bands per body (damping of multiple connections). */
  private readonly bandCount = new Map<Body, number>();
  /** Rotors, tops and killers. */
  readonly enemies: Enemy[];
  private readonly mouse = { x: 0, y: 0 };
  private mouseTime = 0;
  private readonly axisForce = { x: 0, y: 0 };
  /** Global forces (wormholes): added unscaled, like Enigma's force fields. */
  /** Force field at x/y; flying = a jumping marble (only global forces act on it). */
  private field: ((x: number, y: number, flying: boolean) => [number, number]) | null = null;
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
    this.marbles = [makeMarble(0, level.start.x, level.start.y)];
    const white = (level.actors ?? []).find((a) => a.k === 'ac_marble_white');
    if (white) {
      const w = makeMarble(1, white.x, white.y);
      w.passive = white.a?.passive === 'true';
      w.essential = white.a?.essential === '1';
      this.marbles.push(w);
    }
    // Pearls: more balls of the player (velocity_x/_y as given by the level).
    const pearls = new Map<ActorDef, Marble>();
    for (const a of level.actors ?? []) {
      if (!isPearl(a.k)) continue;
      const color = a.k === 'ac_pearl_black' || a.a?.color === '0' ? 0 : 1;
      const p = makeMarble(color, a.x, a.y, true, { x: Number(a.a?.velocity_x) || 0, y: Number(a.a?.velocity_y) || 0 });
      this.marbles.push(p);
      pearls.set(a, p);
    }
    // Bodies by actor index: 0 = black marble, n = level.actors[n - 1].
    const bodies: (Body | null)[] = [this.marbles[0]];
    let ei = 0;
    for (const a of level.actors ?? []) {
      if (pearls.has(a)) bodies.push(pearls.get(a)!);
      else if (a.k === 'ac_marble_white') bodies.push(this.marbles[1]);
      else if (ei < this.enemies.length && this.enemies[ei].kind === enemyKind(a.k)) bodies.push(this.enemies[ei++]);
      else bodies.push(null);
    }
    for (const r of level.rubbers ?? []) {
      const a1 = bodies[r.a];
      const a2 = typeof r.b === 'number' ? bodies[r.b] : null;
      if (!a1 || (typeof r.b === 'number' && !a2)) continue;
      const fixed = typeof r.b === 'number' ? null : { x: r.b[0], y: r.b[1] };
      this.rubbers.push(new Rubberband(r, a1, a2, fixed));
      for (const b of [a1, a2]) if (b) this.bandCount.set(b, (this.bandCount.get(b) ?? 0) + 1);
    }
  }

  private solidAt(c: number, r: number): number {
    if (c < 0 || r < 0 || c >= this.width || r >= this.height) return -2;
    return this.solid[r * this.width + c];
  }

  /** Floor::add_force: the constant force of the floor under the actor (slopes, force_x/y). */
  private floorForce(pos: { x: number; y: number }): [number, number] {
    const c = Math.floor(pos.x);
    const r = Math.floor(pos.y);
    if (c < 0 || r < 0 || c >= this.width || r >= this.height) return [0, 0];
    return this.cells[r * this.width + c].force ?? [0, 0];
  }

  private floorProps(pos: { x: number; y: number }): { friction: number; adhesion: number } {
    const c = Math.floor(pos.x);
    const r = Math.floor(pos.y);
    const kind = c >= 0 && r >= 0 && c < this.width && r < this.height ? this.cells[r * this.width + c].floor : 'fl_gray';
    return floorProps(kind);
  }

  /** Mouse movement in pixels, already multiplied by the mouse speed option. */
  addMouseForce(fx: number, fy: number): void {
    if (!this.marbles[this.cur].active) return;
    this.mouse.x += fx;
    this.mouse.y += fy;
    this.mouseTime = WORLD_TICK;
  }

  /** wo["FrictionStrength"] (server::FrictionFactor); negative values accelerate. */
  frictionFactor = 1;

  /** A stone appeared (true) or vanished in a cell at runtime (Lua callbacks). */
  setSolid(col: number, row: number, solid: boolean): void {
    if (col < 0 || row < 0 || col >= this.width || row >= this.height) return;
    const i = row * this.width + col;
    if (this.solid[i] >= 0) return; // Oxyd stones stay
    this.solid[i] = solid ? -2 : -1;
  }

  /** BasicBall "_jump" (it_spring): only a marble on the floor can jump. */
  jump(i = this.cur): boolean {
    const m = this.marbles[i];
    if (!m || !m.active || m.jump > 0) return false;
    m.jump = JUMP_SECONDS;
    m.sink = 0; // change_state resets the sink depth
    return true;
  }

  setForceField(field: ((x: number, y: number, flying: boolean) => [number, number]) | null): void {
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
    for (const b of [...this.enemies, ...this.marbles]) {
      b.prev.x = b.pos.x;
      b.prev.y = b.pos.y;
    }
    this.actorContacts(onContact);

    // 1. Forces of every moving body (World::move_actors).
    const forces = new Map<Body, BodyForce & { friction: number }>();
    const add = (b: Body, fx: number, fy: number, friction: number, flying = false) => {
      if (this.field) {
        const [gx, gy] = this.field(b.pos.x, b.pos.y, flying);
        fx += gx;
        fy += gy;
      }
      forces.set(b, { fx, fy, cx: 0, cy: 0, friction });
    };
    this.marbles.forEach((m, i) => {
      if (!m.active) return;
      // World::get_local_force: a jumping marble feels no mouse, floor, item or friction.
      if (m.jump > 0) {
        add(m, 0, 0, 0, true);
        return;
      }
      const { friction, adhesion } = this.floorProps(m.pos);
      // Only the marble of the current player feels the mouse (Floor::process_mouseforce);
      // pearls have controllers = 3 and always do.
      const k = i === this.cur || m.pearl ? adhesion : 0;
      const [ffx, ffy] = this.floorForce(m.pos);
      add(m, (this.axisForce.x + mx) * k + ffx, (this.axisForce.y + my) * k + ffy, friction);
    });
    const targets = this.marbles.flatMap((m, i) => (m.active ? [{ x: m.pos.x, y: m.pos.y, current: i === this.cur }] : []));
    for (const e of this.enemies) {
      const { friction, adhesion } = this.floorProps(e.pos);
      const [ffx, ffy] = this.floorForce(e.pos);
      if (e.kind === 'killer') {
        // Steered like the marble (controllers = 3), with the killer's mouse force factor.
        add(e, (this.axisForce.x + mx) * adhesion * KILLER_MOUSE_FACTOR + ffx, (this.axisForce.y + my) * adhesion * KILLER_MOUSE_FACTOR + ffy, friction);
      } else {
        const [cx, cy] = e.chaseForce(targets, dt);
        add(e, cx + ffx, cy + ffy, friction);
      }
    }
    // 2. Rubber bands (bands of a falling marble rest).
    for (const r of this.rubbers) {
      const f1 = forces.get(r.a1 as Body);
      const f2 = r.a2 ? forces.get(r.a2 as Body) : null;
      if (!f1 || (r.a2 && !f2)) continue;
      r.apply(f1, f2 ?? null, this.bandCount.get(r.a1 as Body) ?? 1, r.a2 ? (this.bandCount.get(r.a2 as Body) ?? 1) : 0, dt);
    }
    // 3. Move and collide.
    this.marbles.forEach((m, i) => {
      const f = forces.get(m);
      if (!f) return;
      this.advance(m, f);
      this.collide(m, onContact, { by: i, color: m.color });
      if (m.jump > 0) m.jump = Math.max(0, m.jump - dt);
      else this.sinkStep(m, i, onContact);
    });
    for (const e of this.enemies) {
      this.advance(e, forces.get(e)!);
      // Other actors hit stones too (Oxyd stones open for any actor), but do not touch them.
      this.collide(e, onContact, { by: -1, color: e.kind === 'killer' ? e.color : 2 });
    }
  }

  /** BasicBall::sink: sinking into the swamp, rising again when fast enough. */
  private sinkStep(m: Marble, i: number, onContact: (c: Contact) => void): void {
    const c = Math.floor(m.pos.x);
    const r = Math.floor(m.pos.y);
    const floor = c >= 0 && r >= 0 && c < this.width && r < this.height ? this.cells[r * this.width + c].floor : '';
    if (floor !== 'fl_swamp') {
      m.sink = 0;
      return;
    }
    const v = Math.hypot(m.vel.x, m.vel.y);
    m.sink = Math.max(0, m.sink + SWAMP_SINK_SPEED * (1 - v / SWAMP_RAISE_SPEED) * PHYSICS_DT);
    if (m.sink >= SINK_DEPTH) {
      m.vel.x = m.vel.y = 0; // stop!
      m.active = false; // BUBBLING until the respawn
      onContact({ kind: 'sunk', marble: i });
    }
  }

  /** One integration step of a body (World::advanceActor). */
  private advance(b: Body, f: BodyForce & { friction: number }): void {
    const dt = PHYSICS_DT;
    let { fx, fy } = f;
    const friction = f.friction * this.frictionFactor;
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
    // Collision forces (rubber band limits) are not cancelled by contacts.
    fx += f.cx;
    fy += f.cy;
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
      if (friction < 0) {
        // inverse, accelerating friction: limit the speed again
        const w = Math.hypot(vel.x, vel.y);
        if (w > MAX_SPEED) {
          vel.x *= MAX_SPEED / w;
          vel.y *= MAX_SPEED / w;
        }
      }
    }
    b.pos.x += vel.x * dt;
    b.pos.y += vel.y * dt;
  }

  /**
   * World::handle_actor_contact: overlapping actors moving towards each other bounce
   * elastically (restitution 1, reduced mass); the marble shatters on another actor.
   */
  private actorContacts(onContact: (c: Contact) => void): void {
    // World::handle_actor_contact: actors rebound only when both are on the floor (or both fly).
    const marbles = this.marbles.filter((m) => m.active && m.jump <= 0);
    const bodies: Body[] = [...marbles, ...this.enemies];
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
        // Marbles come first: a1 is a marble whenever one of the two is.
        const mi = this.marbles.indexOf(a1 as Marble);
        if (mi >= 0 && j >= marbles.length) onContact({ kind: 'actor', actor: (a2 as Enemy).kind, marble: mi, speed: relspeed });
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

  private collide(b: Body, onContact: (c: Contact) => void, who: Toucher): void {
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
          this.contactBox(b, col, row, kind, onContact, who);
          continue;
        }
        const faces = this.blockers?.blockAt(col, row, who.color) ?? 0;
        if (faces === 0) continue;
        if (faces === ALL_FACES) {
          this.contactBox(b, col, row, -3, onContact, who);
          continue;
        }
        // Door d: only the closed faces block, and only from outside (Door::collision_response).
        const { x, y } = b.pos;
        if (faces & NORTH && y < row) this.contactAt(b, Math.max(col, Math.min(x, col + 1)), row, col, row, -3, onContact, who);
        if (faces & SOUTH && y > row + 1) this.contactAt(b, Math.max(col, Math.min(x, col + 1)), row + 1, col, row, -3, onContact, who);
        if (faces & WEST && x < col) this.contactAt(b, col, Math.max(row, Math.min(y, row + 1)), col, row, -3, onContact, who);
        if (faces & EAST && x > col + 1) this.contactAt(b, col + 1, Math.max(row, Math.min(y, row + 1)), col, row, -3, onContact, who);
      }
    }
    const t = b.touching;
    b.touching = b.nowTouching;
    b.nowTouching = t;
  }

  /** Contact with a solid cell. kind: -2 wall, -3 object, >= 0 signal stone index. */
  private contactBox(b: Body, col: number, row: number, kind: number, onContact: (c: Contact) => void, who: Toucher): void {
    const qx = Math.max(col, Math.min(b.pos.x, col + 1));
    const qy = Math.max(row, Math.min(b.pos.y, row + 1));
    this.contactAt(b, qx, qy, col, row, kind, onContact, who);
  }

  /**
   * Contact with the closest point (qx, qy) of a blocking shape in cell (col, row).
   * Other actors (who.by < 0) hit stones but do not touch them (no death stones).
   */
  private contactAt(b: Body, qx: number, qy: number, col: number, row: number, kind: number, onContact: (c: Contact) => void, who: Toucher): void {
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
      const pushing = b === this.marbles[this.cur] && this.axisForce.x * nx + this.axisForce.y * ny < 0;
      const e = pushing && -vn < REST_SPEED ? 0 : RESTITUTION;
      vel.x -= (1 + e) * vn * nx;
      vel.y -= (1 + e) * vn * ny;
      const { by, color } = who;
      if (isNew && kind === -3 && (by >= 0 || speed >= HIT_SPEED)) {
        // Marbles also feel soft touches (death stones); hit = above the hit threshold.
        onContact({ kind: 'object', col, row, speed, nx, ny, vn, hit: speed >= HIT_SPEED, by, color, vx: vel.x, vy: vel.y });
      } else if (isNew && kind !== -3 && speed >= HIT_SPEED) {
        onContact(kind >= 0 ? { kind: 'signal', index: kind, speed, by, color } : { kind: 'wall', speed, by, color });
      }
    }
    b.nowTouching.add(key);
  }

  /** Position of the steered marble. */
  get position(): { x: number; y: number } {
    return this.marbles[this.cur].pos;
  }

  get velocity(): { x: number; y: number } {
    return this.marbles[this.cur].vel;
  }

  /** Index of the steered marble. */
  get current(): number {
    return this.cur;
  }

  /** Yin-yang: steer the other marble (player::SwapPlayers). */
  /** Marbles one can switch between with the yin-yang (not the pearls). */
  get steerable(): number {
    return this.marbles.filter((m) => !m.pearl && !m.passive).length;
  }

  /** player::SwapPlayers: to the other marble (also a passive one, through a yin-yang item). */
  swap(): boolean {
    if (this.marbles.filter((m) => !m.pearl).length < 2) return false;
    do this.cur = (this.cur + 1) % this.marbles.length;
    while (this.marbles[this.cur].pearl);
    this.mouse.x = this.mouse.y = 0;
    this.mouseTime = 0;
    return true;
  }

  setActive(active: boolean, i = this.cur): void {
    this.marbles[i].active = active;
  }

  /** Actor "disconnect" (vortex/wormhole scissor): its rubber bands snap. */
  cutRubbers(i: number): void {
    const m = this.marbles[i];
    for (let k = this.rubbers.length - 1; k >= 0; k--) {
      const r = this.rubbers[k];
      if (r.a1 === m || r.a2 === m) this.rubbers.splice(k, 1);
    }
  }

  /** Put the marble at x/y (tile units, marble centre) and stop it. */
  respawn(x: number, y: number, i = this.cur): void {
    const m = this.marbles[i];
    m.pos.x = x;
    m.pos.y = y;
    m.vel.x = m.vel.y = 0;
    this.mouse.x = this.mouse.y = 0;
    this.mouseTime = 0;
    m.touching.clear();
    m.normals = [];
    m.sink = 0;
    m.prev.x = x;
    m.prev.y = y;
    m.active = true;
  }

  /** Test helper: set the velocity directly. */
  setVelocity(x: number, y: number): void {
    this.marbles[this.cur].vel.x = x;
    this.marbles[this.cur].vel.y = y;
  }

  dispose(): void {
    /* nothing to free */
  }
}
