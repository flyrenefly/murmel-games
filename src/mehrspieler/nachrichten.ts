// Messages on the WebRTC data channel between the two players (docs/SPEC-mehrspieler.md 5.2).
// JSON, every message { v: 1, t, … }; parseNachricht drops anything unknown or malformed.

export const PROTOKOLL = 1;

export type Art = 'gemeinsam' | 'rennen';
/** Player actions that travel over the network (the yin-yang swap does not exist in co-op). */
export type Aktion = 'use' | 'drop' | 'rotate';
export const AKTIONEN: readonly Aktion[] = ['use', 'drop', 'rotate'];

/** Input of one player in one step: mouse impulse and key/tilt force. */
export type Steuerung = [fx: number, fy: number, ax: number, ay: number];

/**
 * A run of identical physics steps (co-op, host → guest): n steps with the host's and the guest's
 * input, whether the host held the pickup lock, and the actions applied before the first step.
 */
export type Lauf = [n: number, host: Steuerung, gast: Steuerung, sperre: 0 | 1, aktionen: [spieler: 0 | 1, aktion: Aktion][]];

/** Position and velocity of every marble [x, y, vx, vy] after a batch (corrects the guest). */
export type Murmeln = [number, number, number, number][];

export type Nachricht =
  | { t: 'hallo'; version: string }
  | { t: 'start'; art: Art; pack: string; index: number; levelId: string; seed: number }
  | { t: 'bereit'; levelId: string }
  | { t: 'los' }
  | { t: 'eingabe'; fx: number; fy: number; ax: number; ay: number; aktionen: Aktion[] }
  | { t: 'schritte'; ab: number; l: Lauf[]; m: Murmeln; ende?: boolean }
  | { t: 'stand'; x: number; y: number; farbe: number; schritte: number }
  | { t: 'ziel'; schritte: number }
  | { t: 'neustart' }
  | { t: 'tschuess' };

export function encode(n: Nachricht): string {
  return JSON.stringify({ v: PROTOKOLL, ...n });
}

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const int = (x: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): x is number => Number.isInteger(x) && (x as number) >= min && (x as number) <= max;
const str = (x: unknown, max = 200): x is string => typeof x === 'string' && x.length <= max;
const aktion = (x: unknown): x is Aktion => AKTIONEN.includes(x as Aktion);
const steuerung = (x: unknown): x is Steuerung => Array.isArray(x) && x.length === 4 && x.every(num);
const lauf = (x: unknown): x is Lauf =>
  Array.isArray(x) &&
  x.length === 5 &&
  int(x[0], 1, 100_000) &&
  steuerung(x[1]) &&
  steuerung(x[2]) &&
  (x[3] === 0 || x[3] === 1) &&
  Array.isArray(x[4]) &&
  x[4].length <= 16 &&
  x[4].every((a: unknown) => Array.isArray(a) && a.length === 2 && (a[0] === 0 || a[0] === 1) && aktion(a[1]));
const murmeln = (x: unknown): x is Murmeln => Array.isArray(x) && x.length <= 64 && x.every((m) => Array.isArray(m) && m.length === 4 && m.every(num));

/** The message, or null when it is not a valid message of this protocol version. */
export function parseNachricht(raw: unknown): Nachricht | null {
  if (typeof raw !== 'string' || raw.length > 256 * 1024) return null;
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object' || m.v !== PROTOKOLL) return null;
  switch (m.t) {
    case 'hallo':
      return str(m.version, 64) ? { t: 'hallo', version: m.version } : null;
    case 'start':
      return (m.art === 'gemeinsam' || m.art === 'rennen') && str(m.pack, 100) && int(m.index, 0, 100_000) && str(m.levelId) && int(m.seed, 0, 0xffffffff)
        ? { t: 'start', art: m.art, pack: m.pack, index: m.index, levelId: m.levelId, seed: m.seed }
        : null;
    case 'bereit':
      return str(m.levelId) ? { t: 'bereit', levelId: m.levelId } : null;
    case 'eingabe':
      return num(m.fx) && num(m.fy) && num(m.ax) && num(m.ay) && Array.isArray(m.aktionen) && m.aktionen.length <= 16 && m.aktionen.every(aktion)
        ? { t: 'eingabe', fx: m.fx, fy: m.fy, ax: m.ax, ay: m.ay, aktionen: m.aktionen }
        : null;
    case 'schritte':
      return int(m.ab) && Array.isArray(m.l) && m.l.length <= 4096 && m.l.every(lauf) && murmeln(m.m) && (m.ende === undefined || typeof m.ende === 'boolean')
        ? { t: 'schritte', ab: m.ab, l: m.l, m: m.m, ...(m.ende ? { ende: true } : {}) }
        : null;
    case 'stand':
      return num(m.x) && num(m.y) && int(m.farbe, 0, 2) && int(m.schritte) ? { t: 'stand', x: m.x, y: m.y, farbe: m.farbe, schritte: m.schritte } : null;
    case 'ziel':
      return int(m.schritte) ? { t: 'ziel', schritte: m.schritte } : null;
    case 'los':
    case 'neustart':
    case 'tschuess':
      return { t: m.t };
    default:
      return null;
  }
}

/** One recorded co-op step before it is packed into runs. */
export interface Schritt {
  host: Steuerung;
  gast: Steuerung;
  sperre: 0 | 1;
  aktionen: [0 | 1, Aktion][];
}

const gleich = (a: Steuerung, b: Steuerung) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

/** Packs steps into runs: identical input repeats (keys held, no mouse) cost one entry. */
export function packen(schritte: readonly Schritt[]): Lauf[] {
  const out: Lauf[] = [];
  for (const s of schritte) {
    const last = out.at(-1);
    if (last && s.aktionen.length === 0 && gleich(last[1], s.host) && gleich(last[2], s.gast) && last[3] === s.sperre) last[0]++;
    else out.push([1, s.host, s.gast, s.sperre, s.aktionen]);
  }
  return out;
}

/** The steps of runs again (inverse of packen). */
export function entpacken(laeufe: readonly Lauf[]): Schritt[] {
  const out: Schritt[] = [];
  for (const [n, host, gast, sperre, aktionen] of laeufe) {
    for (let i = 0; i < n; i++) out.push({ host, gast, sperre, aktionen: i === 0 ? aktionen : [] });
  }
  return out;
}
