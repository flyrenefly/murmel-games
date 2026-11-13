// Input: mouse (pointer lock, relative movement), keyboard, device tilt, swipe, gamepad.

import { attitude, type Mat3, screenTilt, type Steering, swipeToMouse, TAP_MS, TAP_SLOP, TapTracker } from './steuerung';

export class Input {
  private mx = 0;
  private my = 0;
  private readonly keys = new Set<string>();
  private tiltX = 0;
  private tiltY = 0;
  tiltEnabled = false;
  locked = false;
  /** Touch: swiping over the playing field moves like the mouse (src/steuerung.ts). */
  swipeEnabled = false;
  /** Called on a double tap on the playing field (touch). */
  onDoubleTap: () => void = () => undefined;
  private now: Mat3 | null = null;
  private rest: Mat3 | null = null;
  private tiltListening = false;

  constructor(
    private readonly target: HTMLElement,
    onLockChange: (locked: boolean) => void,
  ) {
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.target;
      onLockChange(this.locked);
    });
    // Relative movement counts with and without pointer lock: some embedded
    // browsers refuse the lock, then the plain mouse movement still steers.
    // (The game only reads it while playing.)
    let lastX: number | null = null;
    let lastY: number | null = null;
    // Phones send a made-up mousemove with each tap: it must not push the marble.
    let touchedAt = -Infinity;
    document.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') touchedAt = e.timeStamp;
    });
    document.addEventListener('mousemove', (e) => {
      if (e.timeStamp - touchedAt < 1000) {
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      }
      let dx = e.movementX;
      let dy = e.movementY;
      if (!this.locked && dx === 0 && dy === 0 && lastX !== null && lastY !== null) {
        // Fallback for browsers that report no movementX/Y.
        dx = e.clientX - lastX;
        dy = e.clientY - lastY;
      }
      lastX = e.clientX;
      lastY = e.clientY;
      this.mx += dx;
      this.my += dy;
    });
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.listenTouches();
  }

  requestLock(): void {
    if (this.tiltEnabled || matchMedia('(pointer: coarse)').matches) return;
    // Can be refused (e.g. embedded previews); the keyboard still works then.
    Promise.resolve(this.target.requestPointerLock?.()).catch(() => undefined);
  }

  releaseLock(): void {
    if (this.locked) document.exitPointerLock();
  }

  /** Accumulated mouse movement in pixels since the last call. */
  takeMouse(): [number, number] {
    const r: [number, number] = [this.mx, this.my];
    this.mx = this.my = 0;
    return r;
  }

  /** Continuous direction from keys, tilt and gamepad, each axis in [-1, 1]. */
  axis(): [number, number] {
    let x = 0;
    let y = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) x -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) x += 1;
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) y -= 1;
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) y += 1;
    if (this.tiltEnabled) {
      x += this.tiltX;
      y += this.tiltY;
    }
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad) continue;
      const [ax, ay] = pad.axes;
      if (Math.hypot(ax, ay) > 0.15) {
        x += ax;
        y += ay;
      }
    }
    return [clamp(x), clamp(y)];
  }

  anyMoveKey(): boolean {
    return ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].some((k) => this.keys.has(k));
  }

  /** Device tilt; on iOS this needs a permission request from a tap. */
  async enableTilt(): Promise<boolean> {
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    if (!DOE) return false;
    try {
      if (typeof DOE.requestPermission === 'function' && (await DOE.requestPermission()) !== 'granted') return false;
    } catch {
      return false;
    }
    if (!this.tiltListening) {
      this.tiltListening = true;
      window.addEventListener('deviceorientation', (e) => {
        if (e.beta === null || e.gamma === null) return;
        // the full attitude, not the Euler angles: no jumps when held steeply, upside down or on the side
        this.now = attitude(e.alpha ?? 0, e.beta, e.gamma);
        this.rest ??= this.now;
        this.updateTilt();
      });
      screen.orientation?.addEventListener?.('change', () => this.updateTilt());
    }
    this.tiltEnabled = true;
    this.swipeEnabled = false;
    return true;
  }

  /** Steering on touch devices; tilting needs enableTilt() first. */
  setSteering(steering: Steering): void {
    if (steering === 'tilt') {
      this.swipeEnabled = false;
      this.tiltEnabled = this.tiltListening;
    } else {
      this.tiltEnabled = false;
      this.swipeEnabled = true;
    }
    this.tiltX = this.tiltY = 0;
    this.updateTilt();
  }

  /**
   * The current attitude becomes the rest pose: only tilting away from it steers.
   * Without a sensor reading yet, the first reading becomes the rest pose.
   */
  setRest(): void {
    this.rest = this.now;
    this.updateTilt();
  }

  private updateTilt(): void {
    if (!this.now || !this.rest) {
      this.tiltX = this.tiltY = 0;
      return;
    }
    [this.tiltX, this.tiltY] = screenTilt(this.rest, this.now, screen.orientation?.angle ?? (window as { orientation?: number }).orientation ?? 0);
  }

  /** Touches on the playing field: swipe like a touchpad, double tap for onDoubleTap. */
  private listenTouches(): void {
    const taps = new TapTracker();
    let id: number | null = null;
    let x = 0;
    let y = 0;
    let travel = 0;
    let t0 = 0;
    document.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || id !== null) return;
      // buttons, menus and links keep their own taps
      if (!(e.target instanceof HTMLCanvasElement)) return;
      id = e.pointerId;
      x = e.clientX;
      y = e.clientY;
      travel = 0;
      t0 = e.timeStamp;
    });
    document.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - x;
      const dy = e.clientY - y;
      x = e.clientX;
      y = e.clientY;
      travel += Math.hypot(dx, dy);
      if (!this.swipeEnabled) return;
      const [mx, my] = swipeToMouse(dx, dy);
      this.mx += mx;
      this.my += my;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      if (e.type === 'pointerup' && travel <= TAP_SLOP && e.timeStamp - t0 <= TAP_MS && taps.tap(e.timeStamp, x, y)) this.onDoubleTap();
    };
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  }
}

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}
