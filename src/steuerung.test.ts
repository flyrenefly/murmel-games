import { describe, expect, it } from 'vitest';
import { attitude, loadSteering, type Mat3, parseSteering, saveSteering, screenTilt, swipeToMouse, SWIPE_GAIN, TapTracker } from './steuerung';

// ---------- helpers: rotations in device coordinates ----------
const R = Math.PI / 180;
function mul(a: Mat3, b: Mat3): Mat3 {
  const m: number[] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m.push(a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j]);
  return m as unknown as Mat3;
}
const rx = (d: number): Mat3 => [1, 0, 0, 0, Math.cos(d * R), -Math.sin(d * R), 0, Math.sin(d * R), Math.cos(d * R)];
const ry = (d: number): Mat3 => [Math.cos(d * R), 0, Math.sin(d * R), 0, 1, 0, -Math.sin(d * R), 0, Math.cos(d * R)];
const rz = (d: number): Mat3 => [Math.cos(d * R), -Math.sin(d * R), 0, Math.sin(d * R), Math.cos(d * R), 0, 0, 0, 1];

/** Euler angles as Chrome reports them: beta in [-180, 180), gamma in [-90, 90). */
function euler(m: Mat3): [number, number, number] {
  const sb = Math.max(-1, Math.min(1, m[7]));
  // cos(gamma) ≥ 0, so cos(beta) has the sign of m[8] = cos(beta)·cos(gamma)
  let cb = Math.sqrt(1 - sb * sb);
  if (m[8] < 0) cb = -cb;
  const beta = Math.atan2(sb, cb) / R;
  const gamma = Math.atan2(-m[6] / cb, m[8] / cb) / R;
  const alpha = Math.atan2(-m[1] / cb, m[4] / cb) / R;
  return [((alpha % 360) + 360) % 360, beta, gamma];
}

/** Hand movements relative to the device: tilt the right edge away from the eyes, the top edge towards them, … */
const rightEdgeAway = (d: number) => ry(d);
const topEdgeAway = (d: number) => rx(-d);
const steerRight = (d: number) => rz(-d);

const near = (a: [number, number], b: [number, number]) => {
  expect(a[0]).toBeCloseTo(b[0], 2);
  expect(a[1]).toBeCloseTo(b[1], 2);
};

// ---------- poses (earth: z up) ----------
const sitting = attitude(30, 40, 0); // phone in front of the chest, top raised by 40°
const onBack = attitude(0, 180, 0); // lying on the back, phone above the face, screen facing down
const upright = attitude(0, 90, 0); // phone upright in front of the face
const onSide = mul(attitude(0, 90, 0), rz(90)); // lying on the side, portrait locked: the phone's x axis is vertical

describe('attitude (deviceorientation → rotation matrix)', () => {
  it('lying flat, screen up: identity', () => {
    near([attitude(0, 0, 0)[0], attitude(0, 0, 0)[8]], [1, 1]);
  });

  it('gives the same matrix for both Euler spellings of one attitude', () => {
    // past gamma = 90°, browsers report beta + 180, gamma − 180, alpha + 180
    const a = attitude(20, 70, 80);
    const b = attitude(200, 110, -100);
    for (let i = 0; i < 9; i++) expect(a[i]).toBeCloseTo(b[i], 10);
  });

  it('round-trips through the Euler spelling of the test helper', () => {
    const m = mul(onBack, ry(30));
    const back = attitude(...euler(m));
    for (let i = 0; i < 9; i++) expect(back[i]).toBeCloseTo(m[i], 8);
  });
});

describe('screenTilt: rest pose and hand movements', () => {
  for (const [name, rest] of [
    ['sitting', sitting],
    ['on the back, screen facing down', onBack],
    ['upright', upright],
    ['on the side', onSide],
  ] as const) {
    describe(name, () => {
      it('is still in the rest pose', () => {
        near(screenTilt(rest, rest, 0), [0, 0]);
      });
      it('top edge away from the eyes rolls the marble up, towards them down', () => {
        expect(screenTilt(rest, mul(rest, topEdgeAway(10)), 0)[1]).toBeLessThan(-0.3);
        expect(screenTilt(rest, mul(rest, topEdgeAway(-10)), 0)[1]).toBeGreaterThan(0.3);
        expect(Math.abs(screenTilt(rest, mul(rest, topEdgeAway(10)), 0)[0])).toBeLessThan(0.05);
      });
      it('reaches full speed at 25°', () => {
        expect(screenTilt(rest, mul(rest, topEdgeAway(-25)), 0)[1]).toBeCloseTo(1, 2);
      });
      it('ignores the old dead zone of up to 2°', () => {
        near(screenTilt(rest, mul(rest, topEdgeAway(1.5)), 0), [0, 0]);
      });
    });
  }

  it('sitting: right edge away from the eyes rolls the marble right', () => {
    const [x, y] = screenTilt(sitting, mul(sitting, rightEdgeAway(10)), 0);
    // the roll axis leans towards the steering wheel by the 40° of the rest pose: a little weaker
    expect(x).toBeGreaterThan(0.2);
    expect(Math.abs(y)).toBeLessThan(0.05);
  });

  it('on the back: the same hand movement as sitting, the same direction', () => {
    expect(screenTilt(onBack, mul(onBack, rightEdgeAway(10)), 0)[0]).toBeCloseTo((Math.sin(10 * R) - Math.sin(2 * R)) / (Math.sin(25 * R) - Math.sin(2 * R)), 2);
    expect(screenTilt(onBack, mul(onBack, rightEdgeAway(-10)), 0)[0]).toBeLessThan(-0.3);
  });

  it('upright: turning like a steering wheel steers left and right', () => {
    expect(screenTilt(upright, mul(upright, steerRight(10)), 0)[0]).toBeGreaterThan(0.3);
    expect(screenTilt(upright, mul(upright, steerRight(-10)), 0)[0]).toBeLessThan(-0.3);
  });

  it('on the side: right edge away from the eyes rolls right (gyroscope part of the attitude)', () => {
    expect(screenTilt(onSide, mul(onSide, rightEdgeAway(10)), 0)[0]).toBeGreaterThan(0.3);
  });

  it('works for a rest pose at any compass heading', () => {
    const turned = attitude(250, 40, 0);
    near(screenTilt(turned, mul(turned, topEdgeAway(-10)), 0),screenTilt(sitting, mul(sitting, topEdgeAway(-10)), 0));
  });

  it('follows screen.orientation.angle: in landscape (90°) the device y axis is the screen x axis', () => {
    const flat = attitude(0, 0, 0);
    // landscape-primary: the device top is the screen's left edge; raising it rolls the marble right
    const [x, y] = screenTilt(flat, mul(flat, rx(10)), 90);
    expect(x).toBeGreaterThan(0.3);
    expect(Math.abs(y)).toBeLessThan(0.05);
    // raising the device's right edge (= screen top) rolls the marble down
    const [x2, y2] = screenTilt(flat, mul(flat, ry(-10)), 90);
    expect(Math.abs(x2)).toBeLessThan(0.05);
    expect(y2).toBeGreaterThan(0.3);
  });
});

describe('screenTilt: no jumps near the vertical', () => {
  it('stays smooth while the phone turns through gamma = ±90° (where beta jumps by 180°)', () => {
    const rest = attitude(0, 60, 0);
    let prev: [number, number] | null = null;
    let jumped = false;
    // roll steadily from 70° to 110° about the device's y axis, fed through the browser's Euler spelling
    for (let d = 70; d <= 110; d += 0.5) {
      const now = attitude(...euler(mul(attitude(0, 60, 0), ry(d))));
      const t = screenTilt(rest, now, 0);
      if (prev && (Math.abs(t[0] - prev[0]) > 0.05 || Math.abs(t[1] - prev[1]) > 0.05)) jumped = true;
      prev = t;
    }
    expect(jumped).toBe(false);
  });

  it('stays smooth while the top edge rises through beta = 90°', () => {
    const rest = attitude(0, 85, 5);
    let prev: [number, number] | null = null;
    for (let d = -10; d <= 10; d += 0.5) {
      const now = attitude(...euler(mul(rest, rx(d))));
      const t = screenTilt(rest, now, 0);
      if (prev) expect(Math.abs(t[1] - prev[1])).toBeLessThan(0.05);
      prev = t;
    }
  });
});

describe('swipe and taps', () => {
  it('turns finger movement into mouse movement', () => {
    expect(swipeToMouse(10, -4)).toEqual([10 * SWIPE_GAIN, -4 * SWIPE_GAIN]);
    expect(swipeToMouse(0, 0)).toEqual([0, 0]);
  });

  it('recognises a double tap close in time and place', () => {
    const t = new TapTracker();
    expect(t.tap(0, 100, 100)).toBe(false);
    expect(t.tap(200, 110, 105)).toBe(true);
    // a third tap starts over
    expect(t.tap(300, 110, 105)).toBe(false);
  });

  it('does not count taps too far apart in time or place', () => {
    const t = new TapTracker();
    t.tap(0, 100, 100);
    expect(t.tap(600, 100, 100)).toBe(false);
    expect(t.tap(700, 300, 100)).toBe(false);
  });
});

describe('remembered choice', () => {
  function memoryStore() {
    const data = new Map<string, string>();
    return {
      data,
      get<T>(key: string, fallback: T): T {
        const v = data.get(key);
        return v === undefined ? fallback : (JSON.parse(v) as T);
      },
      set(key: string, value: unknown) {
        data.set(key, JSON.stringify(value));
      },
    };
  }

  it('tilting is the default, unknown values too', () => {
    expect(loadSteering(memoryStore())).toBe('tilt');
    expect(parseSteering('kaputt')).toBe('tilt');
    expect(parseSteering(null)).toBe('tilt');
  });

  it('keeps the choice', () => {
    const s = memoryStore();
    saveSteering(s, 'swipe');
    expect(loadSteering(s)).toBe('swipe');
    saveSteering(s, 'tilt');
    expect(loadSteering(s)).toBe('tilt');
  });
});
