/**
 * Tipps (docs/SPEC-tipps.md): the next step from a stored solution. The solution is replayed once without
 * graphics into a timetable of stations (Oxyd pair, item, pearl, goal); the player's situation picks the
 * first station not reached yet, and a ghost shows the solution's way from the station before it.
 */
import { Geist } from './geist';
import type { LevelFile } from './level';
import { ITEM_NAMES } from './objects';
import { PHYSICS_DT } from './physics';
import type { DecodedInput } from './recording';
import { startReplay } from './replay';
import type { GameSession, StartLua } from './session';

export type Station =
  | { art: 'paar'; schritt: number; steine: [number, number]; nr: number }
  | { art: 'gegenstand'; schritt: number; name: string }
  | { art: 'perle'; schritt: number; nr: number }
  | { art: 'ziel'; schritt: number };

/** A solution that wins, with its stations in order (the last one is always the goal). */
export interface Fahrplan {
  loesung: unknown;
  stationen: Station[];
  schritte: number;
  /** Level size, for "oben links". */
  breite: number;
  hoehe: number;
  /** Position of every Oxyd stone of the solution's run. */
  steine: { col: number; row: number; symbol: string }[];
}

/** What the player has reached so far. */
export interface Lage {
  /** Indices of solved Oxyd stones. */
  geloest: Set<number>;
  paare: number;
  inventar: string[];
  perlen: number;
  /** Current symbol of each Oxyd stone in the player's run (they differ with random colours). */
  symbole: string[];
}

/** One stretch of the solution: from the step after the last reached station to the next station. */
export interface Abschnitt {
  von: number;
  bis: number;
  station: Station;
}

/** At most this long per shown way, then the next tip shows the next part. */
export const ZEIGEN_SCHRITTE = Math.round(15 / PHYSICS_DT);
/** The ghost goes on a little past the station. */
export const NACHLAUF_SCHRITTE = Math.round(1 / PHYSICS_DT);

const basis = (item: string) => item.split(':')[0];

export function lageVon(s: GameSession): Lage {
  const geloest = new Set<number>();
  s.board.states.forEach((st, i) => st === 'solved' && geloest.add(i));
  return {
    geloest,
    paare: s.board.solvedPairs,
    inventar: s.objects.inventory.map(basis),
    perlen: s.objects.meditationCount().engaged,
    symbole: s.board.states.map((_, i) => s.board.symbolOf(i)),
  };
}

/** The progress as a key: equal keys = no progress (the "stuck" clock in src/tipps.ts). */
export function lageSchluessel(l: Lage): string {
  return `${[...l.geloest].sort((a, b) => a - b).join(',')}|${[...new Set(l.inventar)].sort().join(',')}|${l.perlen}`;
}

/**
 * Replays a solution (untrusted JSON) of `file` to its win and notes the stations. Null when it does not
 * fit or does not win. `pause` is awaited every few thousand steps so the page stays responsive.
 */
export async function fahrplan(file: LevelFile, loesung: unknown, startLua?: StartLua, pause?: () => Promise<void>): Promise<Fahrplan | null> {
  let s: GameSession;
  let input: DecodedInput;
  try {
    ({ session: s, input } = await startReplay(file, loesung, { startLua }));
  } catch {
    return null;
  }
  const stationen: Station[] = [];
  let states = [...s.board.states];
  const gesehen = new Set(s.objects.inventory.map(basis));
  let perlen = s.objects.meditationCount().engaged;
  let paarNr = 0;
  let perlNr = perlen;
  let n = 0;
  try {
    for (const step of input) {
      for (const a of step.actions) s.act(a);
      s.step(step);
      const now = s.board.states;
      const neu: number[] = [];
      for (let i = 0; i < now.length; i++) if (now[i] === 'solved' && states[i] !== 'solved') neu.push(i);
      // a pair is solved with both stones in the same step; a quake can close them again
      for (let k = 0; k + 1 < neu.length; k += 2) stationen.push({ art: 'paar', schritt: s.steps, steine: [neu[k], neu[k + 1]], nr: ++paarNr });
      states = [...now];
      for (const item of s.objects.inventory) {
        const b = basis(item);
        if (!gesehen.has(b)) {
          gesehen.add(b);
          stationen.push({ art: 'gegenstand', schritt: s.steps, name: b });
        }
      }
      const p = s.objects.meditationCount().engaged;
      if (p > perlen) stationen.push({ art: 'perle', schritt: s.steps, nr: ++perlNr });
      perlen = p;
      if (s.won) break;
      if (pause && ++n % 4000 === 0) await pause();
    }
  } catch {
    return null;
  }
  if (!s.won) return null;
  stationen.push({ art: 'ziel', schritt: s.steps });
  return {
    loesung,
    stationen,
    schritte: s.steps,
    breite: s.level.width,
    hoehe: s.level.height,
    steine: s.board.states.map((_, i) => ({ col: s.level.signals[i]?.col ?? -1, row: s.level.signals[i]?.row ?? -1, symbol: s.board.symbolOf(i) })),
  };
}

/** Are both stones a pair for the player too (same symbol in the player's run)? */
function paarFuerSpieler(f: Fahrplan, st: Extract<Station, { art: 'paar' }>, l: Lage): boolean {
  const [a, b] = st.steine;
  return l.symbole[a] !== undefined && l.symbole[a] === l.symbole[b] && l.symbole[a] === f.steine[a]?.symbol;
}

function erreichtDirekt(f: Fahrplan, st: Station, l: Lage): boolean {
  switch (st.art) {
    case 'paar':
      return paarFuerSpieler(f, st, l) ? l.geloest.has(st.steine[0]) && l.geloest.has(st.steine[1]) : l.paare >= st.nr;
    case 'perle':
      return l.perlen >= st.nr;
    case 'gegenstand':
      return l.inventar.includes(st.name);
    case 'ziel':
      return false;
  }
}

/** The stretch to the first station the player has not reached. */
export function abschnitt(f: Fahrplan, l: Lage): Abschnitt {
  const direkt = f.stationen.map((st) => erreichtDirekt(f, st, l));
  const erreicht = (i: number) => {
    if (direkt[i]) return true;
    // an item may be used up meanwhile: a later pair or pearl the player has shows it was there
    return f.stationen[i].art === 'gegenstand' && f.stationen.some((st, j) => j > i && st.art !== 'gegenstand' && direkt[j]);
  };
  let i = 0;
  while (i < f.stationen.length - 1 && erreicht(i)) i++;
  return { von: i > 0 ? f.stationen[i - 1].schritt : 0, bis: f.stationen[i].schritt, station: f.stationen[i] };
}

/**
 * The steps the ghost shows: from the stretch's start (or where the last tip of the same stretch stopped)
 * to the station plus a moment, at most ZEIGEN_SCHRITTE.
 */
export function fenster(f: Fahrplan, a: Abschnitt, bisher: number | null): { start: number; ende: number } {
  const start = bisher !== null && bisher > a.von && bisher < a.bis ? bisher : a.von;
  return { start, ende: Math.min(a.bis + NACHLAUF_SCHRITTE, start + ZEIGEN_SCHRITTE, f.schritte) };
}

function ort(f: Fahrplan, i: number): string {
  const s = f.steine[i];
  if (!s || s.col < 0) return '';
  const h = ['links', '', 'rechts'][Math.min(2, Math.floor((s.col * 3) / f.breite))];
  const v = ['oben', '', 'unten'][Math.min(2, Math.floor((s.row * 3) / f.hoehe))];
  return [v, h].filter(Boolean).join(' ') || 'in der Mitte';
}

/** The sentence of the first tip stage. */
export function satz(f: Fahrplan, a: Abschnitt, l: Lage): string {
  const st = a.station;
  switch (st.art) {
    case 'paar': {
      if (!paarFuerSpieler(f, st, l)) return 'Als Nächstes: ein weiteres Oxyd-Paar.';
      const [x, y] = st.steine.map((i) => ort(f, i));
      if (!x || !y) return 'Als Nächstes: ein Oxyd-Paar.';
      return x === y ? `Als Nächstes: ein Oxyd-Paar – beide Steine ${x}.` : `Als Nächstes: ein Oxyd-Paar – ${x} und ${y}.`;
    }
    case 'gegenstand':
      return `Als Nächstes: ${ITEM_NAMES[st.name] ?? 'einen Gegenstand'} einsammeln.`;
    case 'perle':
      return 'Als Nächstes: eine Perle in eine Mulde.';
    case 'ziel':
      return 'Als Nächstes: der Weg ins Ziel.';
  }
}

/** The ghost of a tip: the solution fast-forwarded to `start`, then one solution step per own step. */
export class TippGeist {
  private constructor(
    private readonly geist: Geist,
    readonly start: number,
    readonly ende: number,
    private readonly eigenerStart: number,
  ) {}

  /** `eigeneSchritte`: the own run's steps when the tip starts. */
  static async create(file: LevelFile, f: Fahrplan, w: { start: number; ende: number }, eigeneSchritte: number, startLua?: StartLua): Promise<TippGeist> {
    const g = await Geist.create(file, f.loesung, startLua);
    g.vorspulen(w.start);
    return new TippGeist(g, w.start, w.ende, eigeneSchritte);
  }

  get schritte(): number {
    return this.geist.schritte;
  }

  get fertig(): boolean {
    return this.geist.schritte >= this.ende || this.geist.imZiel;
  }

  /** In step with the own run (`eigeneSchritte` now), never past the end of the window. */
  folgen(eigeneSchritte: number): void {
    this.geist.folgen(Math.min(this.ende, this.start + eigeneSchritte - this.eigenerStart));
  }

  sprite(alpha: number): ReturnType<Geist['sprite']> {
    return this.fertig ? null : this.geist.sprite(alpha);
  }
}
