// Input: mouse (pointer lock, relative movement), keyboard, device tilt, gamepad.

export class Input {
  private mx = 0;
  private my = 0;
  private readonly keys = new Set<string>();
  private tiltX = 0;
  private tiltY = 0;
  tiltEnabled = false;
  locked = false;

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
    document.addEventListener('mousemove', (e) => {
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
    window.addEventListener('deviceorientation', (e) => {
      const portrait = window.innerHeight >= window.innerWidth;
      const beta = e.beta ?? 0; // front/back
      const gamma = e.gamma ?? 0; // left/right
      const angle = (screen.orientation?.angle ?? 0) % 360;
      let tx = portrait ? gamma : angle === 90 ? beta : -beta;
      let ty = portrait ? beta - 25 : angle === 90 ? -gamma - 25 : gamma - 25;
      tx = Math.abs(tx) < 2 ? 0 : tx;
      ty = Math.abs(ty) < 2 ? 0 : ty;
      this.tiltX = clamp(tx / 25);
      this.tiltY = clamp(ty / 25);
    });
    this.tiltEnabled = true;
    return true;
  }
}

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}
