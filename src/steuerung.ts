// Touch steering without the browser: device attitude relative to a rest pose, swipe as a
// touchpad, double taps, and the remembered choice "Neigen / Wischen". Pure functions only;
// src/input.ts wires them to the browser events.

/** 3 × 3 rotation matrix, row-major. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];
type Vec3 = readonly [number, number, number];

const RAD = Math.PI / 180;

/**
 * Device attitude from `deviceorientation` (W3C: R = Rz(alpha) · Rx(beta) · Ry(gamma), maps device
 * coordinates to earth coordinates). The matrix is the same for every Euler spelling of one
 * attitude, so the jumps of beta/gamma near the vertical or upside down do not reach the game.
 */
export function attitude(alpha: number, beta: number, gamma: number): Mat3 {
  const [ca, sa] = [Math.cos(alpha * RAD), Math.sin(alpha * RAD)];
  const [cb, sb] = [Math.cos(beta * RAD), Math.sin(beta * RAD)];
  const [cg, sg] = [Math.cos(gamma * RAD), Math.sin(gamma * RAD)];
  return [
    ca * cg - sa * sb * sg, -sa * cb, ca * sg + sa * sb * cg,
    sa * cg + ca * sb * sg, ca * cb, sa * sg - ca * sb * cg,
    -cb * sg, sb, cb * cg,
  ];
}

/** Tilt for full speed (as before: 25°) and the old dead zone of 2° per axis. */
const FULL = Math.sin(25 * RAD);
const DEAD = Math.sin(2 * RAD);

/**
 * Tilt relative to the rest pose, in screen coordinates: x to the right, y downwards, each in [-1, 1].
 * `rest` and `now` come from attitude(); `screenAngle` is screen.orientation.angle.
 *
 * The rotation from rest to now is taken in the device's own frame, so the same hand movement
 * steers the same way whether the player sits, lies on the back (screen facing down) or on the side:
 * - y (pitch): turning about the screen's horizontal axis; top edge away from the eyes rolls up.
 * - x (roll): turning about the screen's vertical axis when the phone lies flat or faces down,
 *   blending smoothly into turning like a steering wheel when the phone stands upright.
 */
export function screenTilt(rest: Mat3, now: Mat3, screenAngle: number): [number, number] {
  // relative rotation D = restᵀ · now (columns: the device axes now, in rest-device coordinates)
  const d = (i: number, j: number) => rest[i] * now[j] + rest[3 + i] * now[3 + j] + rest[6 + i] * now[6 + j];
  // rotation vector sin(θ) · axis
  const w: Vec3 = [(d(2, 1) - d(1, 2)) / 2, (d(0, 2) - d(2, 0)) / 2, (d(1, 0) - d(0, 1)) / 2];
  // screen axes in device coordinates
  const a = screenAngle * RAD;
  const sx: Vec3 = [Math.cos(a), -Math.sin(a), 0];
  const sy: Vec3 = [Math.sin(a), Math.cos(a), 0];
  // which way is up in the rest pose (device coordinates): the bottom row of rest
  const up: Vec3 = [rest[6], rest[7], rest[8]];
  const upX = dot(up, sx);
  const upY = dot(up, sy);
  const upN = up[2];
  // roll axis: the screen's vertical axis when flat or facing down, the screen normal when upright
  const k = Math.abs(upN) + upX * upX;
  const roll = norm([sy[0] * k, sy[1] * k, -upY]);
  return [axis(dot(w, roll)), axis(dot(w, sx))];
}

function axis(v: number): number {
  // dead zone without a step: the value starts from 0 at its edge
  const m = Math.abs(v) - DEAD;
  if (m <= 0) return 0;
  return Math.sign(v) * Math.min(1, m / (FULL - DEAD));
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// ---------- swipe (touchpad) ----------

/**
 * Finger movement → mouse movement. The finger travels less than a mouse on a desk, so it counts
 * a little more; the result takes the same way as the mouse (mouse speed, physics).
 */
export const SWIPE_GAIN = 1.5;
export function swipeToMouse(dx: number, dy: number): [number, number] {
  return [dx * SWIPE_GAIN, dy * SWIPE_GAIN];
}

/** A touch is a tap when the finger moved at most this far (CSS px) … */
export const TAP_SLOP = 10;
/** … and was lifted within this time (ms). */
export const TAP_MS = 300;
/** Two taps within this time (ms) and distance (CSS px) are a double tap. */
export const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_DIST = 40;

/** Counts taps; tap() says whether this tap completes a double tap. */
export class TapTracker {
  private last: { t: number; x: number; y: number } | null = null;

  tap(t: number, x: number, y: number): boolean {
    const l = this.last;
    if (l && t - l.t <= DOUBLE_TAP_MS && Math.hypot(x - l.x, y - l.y) <= DOUBLE_TAP_DIST) {
      this.last = null;
      return true;
    }
    this.last = { t, x, y };
    return false;
  }
}

// ---------- the choice "Steuerung: Neigen / Wischen" ----------

export type Steering = 'tilt' | 'swipe';

/** Reads the remembered choice; anything unknown means tilting (the old behaviour). */
export function parseSteering(value: unknown): Steering {
  return value === 'swipe' ? 'swipe' : 'tilt';
}

/** The settings store of main.ts (localStorage with the prefix "murmel."). */
export interface SettingsStore {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
}
const STEERING_KEY = 'steuerung';
export function loadSteering(store: SettingsStore): Steering {
  return parseSteering(store.get<unknown>(STEERING_KEY, 'tilt'));
}
export function saveSteering(store: SettingsStore, steering: Steering): void {
  store.set(STEERING_KEY, steering);
}
