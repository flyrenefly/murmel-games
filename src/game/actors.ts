// Other actors besides the player's marble, modelled on Enigma (GPL-2.0-or-later):
// - ac_rotor and ac_top (actors/Rotors.cc) chase the marble within `range` with the
//   force `strength`, otherwise they return home (`gohome`),
// - ac_killer (actors/KillerActor.cc) follows the mouse like the marble, with
//   twice the mouse force and less mass, so it is faster.
// All of them shatter the marble on contact and bounce off stones and each other.

/** An actor as stored in a level file (Enigma position in tile units). */
export interface ActorDef {
  k: string;
  x: number;
  y: number;
  a?: Record<string, string>;
}

export type EnemyKind = 'rotor' | 'top' | 'killer' | 'bug' | 'horse';

/** Radius and mass (ActorTraits). */
const TRAITS: Record<EnemyKind, { radius: number; mass: number }> = {
  rotor: { radius: 22 / 64, mass: 0.8 },
  top: { radius: 16 / 64, mass: 0.8 },
  killer: { radius: 13 / 64, mass: 0.7 },
  bug: { radius: 12 / 64, mass: 0.7 },
  horse: { radius: 24 / 64, mass: 1.2 },
};

/** Killer: attribute adhesion 2.0 = factor on the mouse force (marbles: 1.0). */
export const KILLER_MOUSE_FACTOR = 2;

export function enemyKind(kind: string): EnemyKind | null {
  if (kind === 'ac_rotor') return 'rotor';
  if (kind === 'ac_top') return 'top';
  if (kind === 'ac_bug') return 'bug';
  if (kind === 'ac_horse') return 'horse';
  if (kind === 'ac_killer' || kind === 'ac_killer_white' || kind === 'ac_killer_black') return 'killer';
  return null;
}

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : fallback;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  return v === undefined || v === '' ? fallback : v === 'true' || v === '1';
}

export class Enemy {
  readonly pos: { x: number; y: number };
  readonly vel = { x: 0, y: 0 };
  /** Position before the last physics step (for interpolation). */
  readonly prev: { x: number; y: number };
  readonly home: { x: number; y: number };
  readonly radius: number;
  readonly mass: number;
  /** RotorBase: attack range and force, return to the start position when idle. */
  readonly range: number;
  readonly strength: number;
  readonly gohome: boolean;
  /** Killer colour: 1 = white (ac_killer_white), 0 = black. */
  readonly color: number;
  /** RotorBase: chase only the nearest ball; probability to chase only the steered marble. */
  readonly attacknearest: boolean;
  readonly prefercurrent: number;
  /** Horse: destinations, the current one, steady (no braking), loop. */
  readonly dests: [number, number][];
  destIdx: number;
  readonly steady: boolean;
  readonly loop: boolean;
  readonly horseStrength: number;
  private keepStrategy = 0;
  private currentOnly = false;
  normals: number[] = [];
  touching = new Set<number>();
  nowTouching = new Set<number>();

  constructor(
    readonly kind: EnemyKind,
    def: ActorDef,
  ) {
    const a = def.a ?? {};
    this.pos = { x: def.x, y: def.y };
    this.prev = { x: def.x, y: def.y };
    this.home = { x: def.x, y: def.y };
    ({ radius: this.radius, mass: this.mass } = TRAITS[kind]);
    this.range = num(a.range, 5);
    this.strength = num(a.strength, 10);
    this.gohome = bool(a.gohome, true);
    this.color = kind === 'killer' ? num(a.color, def.k === 'ac_killer_black' ? 0 : 1) : 0;
    this.attacknearest = bool(a.attacknearest, false);
    this.prefercurrent = num(a.prefercurrent, 0);
    // Horse: destinations "x,y;x,y…", strength, steady, loop, destidx
    this.dests = (a.dests ?? '').split(';').filter(Boolean).map((p) => p.split(',').map(Number) as [number, number]);
    this.destIdx = num(a.destidx, 0);
    this.steady = bool(a.steady, true);
    this.loop = bool(a.loop, true);
    this.horseStrength = num(a.strength, 10);
  }

  /**
   * Horse::think: towards the current destination with strength; a non-steady horse brakes in time.
   * Close enough (0.2 steady, 0.1 else): the next destination, from the first again with loop.
   */
  horseForce(): [number, number] {
    const t = this.dests[this.destIdx];
    if (!t || this.horseStrength < 0) return [0, 0];
    let dx = t[0] - this.pos.x;
    let dy = t[1] - this.pos.y;
    let d = Math.hypot(dx, dy);
    if (d < (this.steady ? 0.2 : 0.1)) {
      this.destIdx++;
      if (this.destIdx >= this.dests.length) {
        if (!this.loop) return [0, 0];
        this.destIdx = 0;
      }
      const n = this.dests[this.destIdx];
      dx = n[0] - this.pos.x;
      dy = n[1] - this.pos.y;
      d = Math.hypot(dx, dy);
    }
    const v2 = this.vel.x * this.vel.x + this.vel.y * this.vel.y;
    if (!this.steady && v2 > 0 && (v2 * 0.6) / this.horseStrength > d - 0.05) {
      const v = Math.sqrt(v2);
      return [(-this.vel.x / v) * this.horseStrength, (-this.vel.y / v) * this.horseStrength];
    }
    return d > 0 ? [(dx / d) * this.horseStrength, (dy / d) * this.horseStrength] : [0, 0];
  }

  /**
   * RotorBase::think: force towards the living marbles within range (sum of the
   * directions), otherwise towards home.
   */
  chaseForce(marbles: readonly { x: number; y: number; current?: boolean }[], dt = 0, random: () => number = Math.random): [number, number] {
    // every 0.8–1.6 s decide whether to chase only the steered marble (prefercurrent)
    this.keepStrategy -= dt;
    if (this.keepStrategy < 0) {
      this.keepStrategy = 0.8 + random() * 0.8;
      this.currentOnly = random() < this.prefercurrent;
    }
    let tx = 0;
    let ty = 0;
    let target = false;
    let best = Infinity;
    for (const m of marbles) {
      const dx = m.x - this.pos.x;
      const dy = m.y - this.pos.y;
      const d = Math.hypot(dx, dy);
      if (!(d < this.range && d > 0)) continue;
      if ((this.attacknearest && !this.currentOnly) || (this.currentOnly && m.current)) {
        // the nearest one (of the steered marble only, if currentOnly)
        if (d < best) {
          best = d;
          tx = dx;
          ty = dy;
          target = true;
        }
      } else if (!this.currentOnly) {
        tx += dx / d;
        ty += dy / d;
        target = true;
      }
    }
    if (!target && this.gohome) {
      tx = this.home.x - this.pos.x;
      ty = this.home.y - this.pos.y;
    }
    const len = Math.hypot(tx, ty);
    if (len > 0.2) {
      tx /= len;
      ty /= len;
    }
    // addForce(v · strength/6), and Enigma multiplies the accumulated force by 6.
    return [tx * this.strength, ty * this.strength];
  }
}

export function createEnemies(defs: readonly ActorDef[]): Enemy[] {
  const out: Enemy[] = [];
  for (const d of defs) {
    const k = enemyKind(d.k);
    if (k) out.push(new Enemy(k, d));
  }
  return out;
}
