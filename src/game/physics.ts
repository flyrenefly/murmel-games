import type { Level } from './level';

// Small purpose-built physics: one marble (circle) against a grid of solid
// tiles. Much smaller and faster than a general physics engine.
// Coordinates in tile units: x = column, y = row; cell (c, r) spans [c, c+1] × [r, r+1].

export const MARBLE_RADIUS = 0.3;
export const PHYSICS_DT = 1 / 120;
const MAX_SPEED = 14; // tiles per second
const DAMPING = 0.55; // per second, rolling resistance
const RESTITUTION = 0.45;
const WALL_FRICTION = 0.05; // fraction of tangential speed lost on impact
const SUBSTEP_MAX_MOVE = 0.08; // tiles per substep (no tunnelling)

export type Contact = { kind: 'signal'; index: number; speed: number } | { kind: 'wall'; speed: number };

export class PhysicsWorld {
  /** Solid cells: -1 = free, -2 = wall, >= 0 = index of the signal stone. */
  private readonly solid: Int32Array;
  private readonly width: number;
  private readonly height: number;
  private readonly pos = { x: 0, y: 0 };
  private readonly vel = { x: 0, y: 0 };
  private active = true;
  private touching = new Set<number>();
  private nowTouching = new Set<number>();
  readonly mass = 1;

  constructor(level: Level) {
    this.width = level.width;
    this.height = level.height;
    this.solid = new Int32Array(level.width * level.height).fill(-1);
    level.cells.forEach((c, i) => {
      if (c.stone === 'wall') this.solid[i] = -2;
    });
    for (const s of level.signals) this.solid[s.row * level.width + s.col] = s.index;
    this.respawn(level.start.col, level.start.row);
  }

  private solidAt(c: number, r: number): number {
    if (c < 0 || r < 0 || c >= this.width || r >= this.height) return -2;
    return this.solid[r * this.width + c];
  }

  step(onContact: (c: Contact) => void): void {
    if (!this.active) return;
    const dt = PHYSICS_DT;
    const damp = Math.exp(-DAMPING * dt);
    this.vel.x *= damp;
    this.vel.y *= damp;
    const speed = Math.hypot(this.vel.x, this.vel.y);
    if (speed > MAX_SPEED) {
      this.vel.x *= MAX_SPEED / speed;
      this.vel.y *= MAX_SPEED / speed;
    }

    const steps = Math.max(1, Math.ceil((Math.min(speed, MAX_SPEED) * dt) / SUBSTEP_MAX_MOVE));
    const h = dt / steps;
    this.nowTouching.clear();
    for (let s = 0; s < steps; s++) {
      this.pos.x += this.vel.x * h;
      this.pos.y += this.vel.y * h;
      this.collide(onContact);
    }
    // Swap contact sets: a contact is "new" only if it was not touching last step.
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
        if (kind === -1) continue;
        // Closest point of the cell to the marble centre.
        const qx = Math.max(col, Math.min(this.pos.x, col + 1));
        const qy = Math.max(row, Math.min(this.pos.y, row + 1));
        let nx = this.pos.x - qx;
        let ny = this.pos.y - qy;
        let dist = Math.hypot(nx, ny);
        if (dist >= r) continue;
        if (dist < 1e-9) {
          // Centre inside the cell: push out along the shortest axis.
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
        const pen = r - dist;
        this.pos.x += nx * pen;
        this.pos.y += ny * pen;
        const vn = this.vel.x * nx + this.vel.y * ny;
        if (vn < 0) {
          const tx = this.vel.x - vn * nx;
          const ty = this.vel.y - vn * ny;
          this.vel.x = tx * (1 - WALL_FRICTION) - RESTITUTION * vn * nx;
          this.vel.y = ty * (1 - WALL_FRICTION) - RESTITUTION * vn * ny;
        }
        const key = row * this.width + col;
        if (!this.touching.has(key) && !this.nowTouching.has(key)) {
          const speed = Math.max(0, -vn);
          onContact(kind >= 0 ? { kind: 'signal', index: kind, speed } : { kind: 'wall', speed });
        }
        this.nowTouching.add(key);
      }
    }
  }

  applyImpulse(x: number, y: number): void {
    if (!this.active) return;
    this.vel.x += x / this.mass;
    this.vel.y += y / this.mass;
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

  respawn(col: number, row: number): void {
    this.pos.x = col + 0.5;
    this.pos.y = row + 0.5;
    this.vel.x = this.vel.y = 0;
    this.touching.clear();
    this.active = true;
  }

  dispose(): void {
    /* nothing to free */
  }
}
