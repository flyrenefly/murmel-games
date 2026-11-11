// Rubber bands (ot_rubberband), ported from Enigma (GPL-2.0-or-later, others/Rubberband.cc):
// a spring between an actor and another actor or a stone centre. Between `min` and `max`
// it pulls with strength · (len − length) when longer than `length` (and pushes when
// shorter than `threshold`); at the limits it acts as a rope or rod with hard constraints.

/** A rubber band in a level file: actor indexes (0 = black marble, n = actors[n − 1]). */
export interface RubberDef {
  a: number;
  /** Second anchor: actor index, or the centre of a stone [x, y]. */
  b: number | [number, number];
  strength?: number;
  length?: number;
  threshold?: number;
  min?: number;
  max?: number;
}

export interface RubberBody {
  readonly pos: { x: number; y: number };
  readonly prev: { x: number; y: number };
  readonly vel: { x: number; y: number };
  readonly mass: number;
}

/** Forces of one step: f = force (contacts may cancel it), c = collision force (always applies). */
export interface BodyForce {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

const EPS = 0.02; // distance limit for the constraints
const VIOLATION_STRENGTH = 50; // server::RubberViolationStrength

export class Rubberband {
  readonly strength: number;
  readonly length: number;
  readonly threshold: number;
  readonly min: number;
  readonly max: number;
  /** The band started outside min/max: pull back gently instead of a hard jump. */
  private maxViolation = false;
  private minViolation = false;

  constructor(
    def: RubberDef,
    readonly a1: RubberBody,
    /** Second actor, or null for a stone anchor. */
    readonly a2: RubberBody | null,
    private readonly fixed: { x: number; y: number } | null,
  ) {
    this.strength = def.strength ?? 10;
    this.length = def.length ?? 1;
    this.threshold = def.threshold ?? 0;
    this.min = def.min ?? 0;
    this.max = def.max ?? 0;
    // Rubberband::message("_recheck")
    const len = this.len();
    if (this.max > 0 && len > this.max) this.maxViolation = true;
    else if (len < this.min) this.minViolation = true;
  }

  /** Position of the second anchor. */
  get end(): { x: number; y: number } {
    return this.a2 ? this.a2.pos : this.fixed!;
  }

  private len(): number {
    const e = this.end;
    return Math.hypot(e.x - this.a1.pos.x, e.y - this.a1.pos.y);
  }

  /**
   * Rubberband::applyForces. f1/f2: forces of the anchors in this step (f2 null for a stone),
   * n1/n2: number of bands on each anchor, dt: physics step.
   */
  apply(f1: BodyForce, f2: BodyForce | null, n1: number, n2: number, dt: number): void {
    const { a1, a2, min, max } = this;
    const e = this.end;
    const vx = e.x - a1.pos.x;
    const vy = e.y - a1.pos.y;
    const len = Math.hypot(vx, vy);
    if (this.maxViolation && len <= max) this.maxViolation = false;
    if (this.minViolation && len >= min) this.minViolation = false;

    if (min + EPS <= len && (len <= max - EPS || max === 0)) {
      // Spring between the limits.
      let k = 0;
      if (len > this.length) k = (this.strength * (len - this.length)) / len;
      else if (len < this.threshold && len > 0) k = (this.strength * (len - this.threshold)) / len;
      f1.fx += vx * k;
      f1.fy += vy * k;
      // Enigma's code assigns the second ActorInfo by reference here (a copy, since 1.30's
      // renaming); the intended effect is the opposite force on the second actor.
      if (f2) {
        f2.fx -= vx * k;
        f2.fy -= vy * k;
      }
      return;
    }
    const nx = len > 0 ? vx / len : 0;
    const ny = len > 0 ? vy / len : 0;
    let isMax = len > max - EPS;
    let isMin = len < min + EPS;

    if (!a2 || !f2) {
      // Stone anchor: rope/rod constraint on the actor alone.
      let force1 = nx * f1.fx + ny * f1.fy;
      if ((!isMin && force1 > 0) || (!isMax && force1 < 0)) force1 = 0;
      f1.fx -= force1 * nx;
      f1.fy -= force1 * ny;
      let relspeed = a1.vel.x * nx + a1.vel.y * ny; // positive for shrinking distance
      if ((!isMin && relspeed > 0) || (!isMax && relspeed < 0)) relspeed = 0;
      // damping for inverse friction and multiple connections
      let k = (-(1 + 0.8 / n1) * relspeed * a1.mass) / dt;
      if (isMax && len > max && relspeed <= 0 && !this.maxViolation) {
        const dlen = Math.max(0, Math.min(len - max, len - (min + EPS)));
        k = (a1.mass * dlen) / dt / dt;
      }
      if (isMin && len < min && relspeed >= 0 && !this.minViolation) {
        let dlen = len - min;
        if (max > 0) dlen = Math.min(0, Math.max(len - min, len - (max - EPS)));
        k = (a1.mass * dlen) / dt / dt;
      }
      if (isMax && this.maxViolation) k += VIOLATION_STRENGTH;
      else if (isMin && this.minViolation) k -= VIOLATION_STRENGTH;
      f1.cx += k * nx;
      f1.cy += k * ny;
      return;
    }

    // Two actors.
    const mass = a1.mass + a2.mass;
    if (isMax && isMin) {
      isMax = len > (max - min) / 2;
      isMin = !isMax;
    }
    const numRubbers = n1 + n2 - 1;
    let force1 = nx * f1.fx + ny * f1.fy;
    let force2 = nx * f2.fx + ny * f2.fy;
    if ((!isMin && force1 > 0) || (!isMax && force1 < 0)) force1 = 0;
    if ((!isMin && force2 < 0) || (!isMax && force2 > 0)) force2 = 0;
    const s1 = -force1 + ((force1 + force2) * a1.mass) / mass;
    const s2 = -force2 + ((force1 + force2) * a2.mass) / mass;
    f1.fx += s1 * nx;
    f1.fy += s1 * ny;
    f2.fx += s2 * nx;
    f2.fy += s2 * ny;
    let relspeed = nx * (a2.vel.x - a1.vel.x) + ny * (a2.vel.y - a1.vel.y); // speed of extension
    const dmu = (2 * a1.mass * a2.mass) / (a1.mass + a2.mass);
    if ((isMax && relspeed < 0) || (isMin && relspeed > 0)) relspeed = 0;
    let k = ((dmu * relspeed) / dt) * (0.5 + 0.4 / numRubbers);
    if (isMax && len > max && relspeed >= 0 && !this.maxViolation) {
      const dlen = Math.max(0, Math.min(len - max, len - (min + EPS)));
      k = (dmu * dlen) / dt / dt;
    }
    if (isMin && len < min && relspeed <= 0 && !this.minViolation) {
      let dlen = len - min;
      if (max > 0) dlen = Math.min(0, Math.max(len - min, len - (max - EPS)));
      k = (dmu * dlen) / dt / dt;
    }
    if (isMax && this.maxViolation) k += VIOLATION_STRENGTH;
    else if (isMax && this.minViolation) k -= VIOLATION_STRENGTH; // sic (Enigma)
    f1.cx += k * nx;
    f1.cy += k * ny;
    f2.cx -= k * nx;
    f2.cy -= k * ny;
  }
}
