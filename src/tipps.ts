// Tipps im Spiel (docs/SPEC-tipps.md): where solutions come from (the build's solutions/, then admin
// solutions from the server), which one fits (it must replay to the win) and when a player is stuck.
// Everything is optional: offline only the build's solutions count, without any there is no tip.
import { type Fahrplan, fahrplan } from './game/tipp';
import type { LevelFile } from './game/level';
import { PHYSICS_DT } from './game/physics';
import type { StartLua } from './game/session';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const netz: Fetch = (...a) => fetch(...a);

/** The repository's solutions, each a chunk of its own: loaded with the first tip of its level. */
const BUILD = import.meta.glob('../solutions/**/*.json', { import: 'default' }) as Record<string, () => Promise<unknown>>;

/** Like tools/lib/solutions.mjs: solutions/murmel/01.json → 01, solutions/enigma/a/b.json → enigma:a/b. */
export function levelIdAusPfad(path: string): string | null {
  const m = /solutions\/([\w-]+)\/(.+)\.json$/.exec(path);
  if (!m) return null;
  return m[1] === 'murmel' ? m[2] : `${m[1]}:${m[2]}`;
}

export type Quellen = Record<string, () => Promise<unknown>>;

function buildNachLevel(quellen: Quellen): Map<string, () => Promise<unknown>> {
  const out = new Map<string, () => Promise<unknown>>();
  for (const [p, load] of Object.entries(quellen)) {
    const id = levelIdAusPfad(p);
    if (id) out.set(id, load);
  }
  return out;
}

const buildIndex = buildNachLevel(BUILD);

/** Admin solutions of a level from the server (GET /api/tipps/loesungen); [] offline or without API. */
export async function serverLoesungen(level: string, fetchFn: Fetch = netz): Promise<unknown[]> {
  try {
    const res = await fetchFn(`/api/tipps/loesungen?${new URLSearchParams({ level })}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { loesungen?: unknown };
    return Array.isArray(data.loesungen) ? data.loesungen : [];
  } catch {
    return [];
  }
}

export interface TippQuellen {
  /** Solutions in the build by level (tests pass their own). */
  build?: Map<string, () => Promise<unknown>>;
  fetchFn?: Fetch;
  startLua?: StartLua;
  /** Awaited now and then while a solution is replayed (the page stays responsive). */
  pause?: () => Promise<void>;
}

/** The first solution of the level that replays to the win: build first, then the server's. */
export async function fahrplanSuchen(file: LevelFile, q: TippQuellen = {}): Promise<Fahrplan | null> {
  const load = (q.build ?? buildIndex).get(file.id);
  if (load) {
    try {
      const f = await fahrplan(file, await load(), q.startLua, q.pause);
      if (f) return f;
    } catch {
      // the chunk did not load (offline before it was cached): try the server
    }
  }
  for (const l of await serverLoesungen(file.id, q.fetchFn)) {
    const f = await fahrplan(file, l, q.startLua, q.pause);
    if (f) return f;
  }
  return null;
}

/** One search per level content (a level from the editor may share its id with an older version); none found is asked again later (offline now, online then). */
const cache = new WeakMap<LevelFile, Promise<Fahrplan | null>>();

export function fahrplanFuer(file: LevelFile, q: TippQuellen = {}): Promise<Fahrplan | null> {
  let p = cache.get(file);
  if (!p) {
    p = fahrplanSuchen(file, q).then((f) => {
      if (!f) cache.delete(file);
      return f;
    });
    cache.set(file, p);
  }
  return p;
}

/** Stuck: this long without progress … */
export const HAENGEN_SCHRITTE = Math.round(180 / PHYSICS_DT);
/** … or this many falls without progress. */
export const HAENGEN_STUERZE = 5;

/** Notices a player who makes no progress (the situation key stays the same). */
export class Haengen {
  private key: string | null = null;
  private seitSchritt = 0;
  private seitStuerze = 0;

  /** Feeds the current situation; true when the player is stuck. */
  pruefen(key: string, steps: number, falls: number): boolean {
    // a new run (restart) starts at 0 steps again
    if (key !== this.key || steps < this.seitSchritt) {
      this.key = key;
      this.seitSchritt = steps;
      this.seitStuerze = falls;
      return false;
    }
    return steps - this.seitSchritt >= HAENGEN_SCHRITTE || falls - this.seitStuerze >= HAENGEN_STUERZE;
  }
}
