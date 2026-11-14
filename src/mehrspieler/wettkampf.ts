// Wettkampf (docs/SPEC-wettkampf.md): the parts without DOM – server messages, the input stream from
// the run's recording, catching up with the clock, the other racers as ghosts, the standings.
import type { Entry } from '../game/recording';
import type { ActorSprite } from '../render/classic';

/** Physics step in ms (PHYSICS_DT); the server judges by the same clock. */
export const SCHRITT_MS = 2.5;
/** Input goes to the server this often. */
export const SENDEN_MS = 100;
/** Behind the clock by more than this, the run catches up with steps without input… */
export const AUFHOLEN_AB = 400;
/** …at most this many per frame. */
export const AUFHOLEN_MAX = 4000;

export type Rolle = 'fahrer' | 'zuschauer';
export type Status = 'faehrt' | 'ziel' | 'raus';
export type Phase = 'lobby' | 'laden' | 'rennen';
export interface LevelWahl {
  pack: string;
  index: number;
  id: string;
}
export interface Platz {
  nr: number;
  platz: number | null;
  zeit: number | null;
  status: Status;
  grund?: string;
}
/** [nr, x, y, colour, steps, status, time] */
export type StandZeile = [number, number, number, number, number, Status, number | null];

export type WkNachricht =
  | { t: 'raum'; code: string; du: number; rolle: Rolle }
  | { t: 'lobby'; leiter: number; fahrer: number[]; zuschauer: number; level: LevelWahl; phase: Phase }
  | { t: 'runde'; runde: number; level: LevelWahl; seed: number; fahrer: number[] }
  | { t: 'los'; runde: number; in: number }
  | { t: 'stand'; runde: number; f: StandZeile[] }
  | { t: 'verlauf'; runde: number; fahrer: number; i: number; e: Entry[] }
  | { t: 'ergebnis'; runde: number; plaetze: Platz[]; abbruch?: boolean }
  | { t: 'fehler'; grund: string };

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const int = (x: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): x is number => Number.isInteger(x) && (x as number) >= min && (x as number) <= max;
const str = (x: unknown, max = 200): x is string => typeof x === 'string' && x.length <= max;
const STATUS: readonly Status[] = ['faehrt', 'ziel', 'raus'];
const level = (x: unknown): x is LevelWahl => !!x && typeof x === 'object' && str((x as LevelWahl).pack, 100) && int((x as LevelWahl).index) && str((x as LevelWahl).id);
const zeile = (z: unknown): z is StandZeile =>
  Array.isArray(z) && z.length === 7 && int(z[0], 1, 4) && num(z[1]) && num(z[2]) && int(z[3], 0, 2) && int(z[4]) && STATUS.includes(z[5]) && (z[6] === null || int(z[6]));
const eintrag = (e: unknown): e is Entry =>
  Array.isArray(e) && int(e[0], 1) && ((e.length === 2 && typeof e[1] === 'string') || ((e.length === 3 || e.length === 5) && e.slice(1).every((v) => int(v, -1e9, 1e9))));

/** A message of the server, or null when it is not one this version understands. */
export function parseWk(raw: unknown): WkNachricht | null {
  if (typeof raw !== 'string') return null;
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  switch (m.t) {
    case 'raum':
      return str(m.code, 5) && int(m.du, 0, 4) && (m.rolle === 'fahrer' || m.rolle === 'zuschauer') ? { t: 'raum', code: m.code, du: m.du, rolle: m.rolle } : null;
    case 'lobby':
      return int(m.leiter, 0, 4) && Array.isArray(m.fahrer) && m.fahrer.every((n) => int(n, 1, 4)) && int(m.zuschauer) && level(m.level) && (m.phase === 'lobby' || m.phase === 'laden' || m.phase === 'rennen')
        ? { t: 'lobby', leiter: m.leiter, fahrer: m.fahrer, zuschauer: m.zuschauer, level: m.level, phase: m.phase }
        : null;
    case 'runde':
      return int(m.runde) && level(m.level) && int(m.seed, 0, 0xffffffff) && Array.isArray(m.fahrer) && m.fahrer.every((n) => int(n, 1, 4))
        ? { t: 'runde', runde: m.runde, level: m.level, seed: m.seed, fahrer: m.fahrer }
        : null;
    case 'los':
      return int(m.runde) && int(m.in, 0, 60_000) ? { t: 'los', runde: m.runde, in: m.in } : null;
    case 'stand':
      return int(m.runde) && Array.isArray(m.f) && m.f.length <= 4 && m.f.every(zeile) ? { t: 'stand', runde: m.runde, f: m.f } : null;
    case 'verlauf':
      return int(m.runde) && int(m.fahrer, 1, 4) && int(m.i) && Array.isArray(m.e) && m.e.every(eintrag) ? { t: 'verlauf', runde: m.runde, fahrer: m.fahrer, i: m.i, e: m.e } : null;
    case 'ergebnis':
      return int(m.runde) &&
        Array.isArray(m.plaetze) &&
        m.plaetze.every((p: Platz) => p && int(p.nr, 1, 4) && (p.platz === null || int(p.platz, 1, 4)) && (p.zeit === null || int(p.zeit)) && STATUS.includes(p.status))
        ? { t: 'ergebnis', runde: m.runde, plaetze: m.plaetze as Platz[], ...(m.abbruch ? { abbruch: true } : {}) }
        : null;
    case 'fehler':
      return str(m.grund, 40) ? { t: 'fehler', grund: m.grund } : null;
    default:
      return null;
  }
}

/** What the stream needs of a run: its recording so far. */
export interface Aufzeichnend {
  recording(): { input: Entry[] };
}

const schritteIn = (e: readonly Entry[]) => e.reduce((n, x) => n + (typeof x[1] === 'number' ? x[0] : 0), 0);

/**
 * The racer's input for the server, taken from the session's recording (the exact numbers the run
 * used). The last entry may still grow: a run of equal steps is sent as far as it got (the rest
 * follows as its own entry), the same action twice before a step waits – until `alles` (the win, a
 * restart) sends everything.
 */
export class Strom {
  /** Steps sent so far (all tries). */
  ab = 0;
  private index = 0;
  /** Steps of the entry at `index` already sent. */
  private teil = 0;

  /** New entries of the run since the last call. */
  nehmen(s: Aufzeichnend, alles = false): { ab: number; e: Entry[] } {
    const input = s.recording().input;
    const e: Entry[] = [];
    for (; this.index < input.length; this.index++, this.teil = 0) {
      const x = input[this.index];
      const letzter = this.index === input.length - 1;
      if (typeof x[1] === 'string') {
        if (letzter && !alles) break;
        e.push([x[0], x[1]] as Entry);
        continue;
      }
      if (x[0] > this.teil) e.push([x[0] - this.teil, ...x.slice(1)] as Entry);
      if (letzter && !alles) {
        this.teil = x[0];
        break;
      }
    }
    const ab = this.ab;
    this.ab += schritteIn(e);
    return { ab, e };
  }

  /** The run starts over: the rest of the old run, then the restart. */
  neustart(alt: Aufzeichnend | null): { ab: number; e: Entry[] } {
    const rest = alt ? this.nehmen(alt, true) : { ab: this.ab, e: [] };
    this.index = 0;
    this.teil = 0;
    return { ab: rest.ab, e: [...rest.e, [1, 'restart']] };
  }
}

/** Steps a run must add without input to keep up with the clock (0 when it is close enough). */
export function aufholen(msSeitLos: number, schritte: number): number {
  const soll = Math.floor(msSeitLos / SCHRITT_MS);
  const fehlt = soll - schritte;
  return fehlt > AUFHOLEN_AB ? Math.min(fehlt, AUFHOLEN_MAX) : 0;
}

/** The other racers, smoothed towards the referee's positions (10 per second). */
export class Geister {
  private ziel = new Map<number, { x: number; y: number; farbe: number; aktiv: boolean }>();
  private jetzt = new Map<number, { x: number; y: number }>();

  /** Positions of the referee; `ohne` = own number (not drawn). */
  stand(f: readonly StandZeile[], ohne: number): void {
    const da = new Set<number>();
    for (const [nr, x, y, farbe, schritte, status] of f) {
      if (nr === ohne) continue;
      da.add(nr);
      this.ziel.set(nr, { x, y, farbe, aktiv: status === 'faehrt' && schritte > 0 });
    }
    for (const nr of [...this.ziel.keys()]) if (!da.has(nr)) this.ziel.delete(nr);
  }

  leeren(): void {
    this.ziel.clear();
    this.jetzt.clear();
  }

  sprites(dt: number): ActorSprite[] {
    const out: ActorSprite[] = [];
    for (const [nr, z] of this.ziel) {
      if (!z.aktiv) continue;
      let g = this.jetzt.get(nr);
      // exponential smoothing: about 90 % of the way in 100 ms; jumps (respawn, restart) at once
      if (!g || Math.hypot(z.x - g.x, z.y - g.y) > 3) this.jetzt.set(nr, (g = { x: z.x, y: z.y }));
      else {
        const k = 1 - Math.exp(-dt * 23);
        g.x += (z.x - g.x) * k;
        g.y += (z.y - g.y) * k;
      }
      out.push({ kind: 'marble', color: z.farbe, x: g.x, y: g.y, fall: -1, ghost: true });
    }
    return out;
  }
}

export const GRUND_TEXT: Record<string, string> = {
  aufgegeben: 'aufgegeben',
  weg: 'hat den Raum verlassen',
  abweichung: 'vom Server nicht bestätigt',
  'zu-schnell': 'zu schnell (Uhr)',
  'zu-langsam': 'zu lange weg',
  zeit: 'Zeit abgelaufen',
  ungueltig: 'ungültige Eingaben',
  fehler: 'Fehler beim Rechnen',
};

export interface RanglistenZeile {
  nr: number;
  du: boolean;
  /** 1., 2., … for finished racers; null while racing or when out. */
  platz: number | null;
  status: Status;
  /** Steps: finishing time, or steps so far. */
  schritte: number;
}

/** Standings: finished by time (equal time, equal place), then racing by progress, then the ones out. */
export function rangliste(f: readonly StandZeile[], du: number): RanglistenZeile[] {
  const zeiten = f.filter((z) => z[5] === 'ziel').map((z) => z[6] as number);
  const rang = (s: Status) => (s === 'ziel' ? 0 : s === 'faehrt' ? 1 : 2);
  return f
    .map(([nr, , , , schritte, status, zeit]): RanglistenZeile => ({
      nr,
      du: nr === du,
      platz: status === 'ziel' && zeit !== null ? 1 + zeiten.filter((z) => z < zeit).length : null,
      status,
      schritte: status === 'ziel' && zeit !== null ? zeit : schritte,
    }))
    .sort((a, b) => rang(a.status) - rang(b.status) || (a.status === 'ziel' ? a.schritte - b.schritte : 0) || a.nr - b.nr);
}
