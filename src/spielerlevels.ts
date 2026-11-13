// Spieler-Levels in the browser (docs/SPEC-spielerlevels.md): the solved playtest the editor needs for
// publishing, the upload with its check, and the game's side of '#spieler=<id>'. Everything is optional:
// offline or without the API the game and the editor work as before.
import type { LevelFile } from './game/level';
import type { Recording } from './game/session';

type Fetch = typeof fetch;
const doFetch: Fetch = (...a) => fetch(...a);

export const PLAYER_PACK = 'spieler';
export const LICENSE = 'CC-BY-SA-4.0';
export const LICENSE_LABEL = 'CC BY-SA 4.0';
export const isPlayerLevel = (id: string): boolean => id.startsWith('spieler:');
export const NICHT_ERREICHBAR = 'Spieler-Levels sind gerade nicht erreichbar.';

// ---------- storage (localStorage, never required) ----------

const SOLVED = 'murmel.spielerlevels.geloest';
const CACHE = 'murmel.spielerlevels.cache';
/** Solved playtests kept for the editor, and played levels kept for offline play. */
export const MAX_SOLVED = 5;
export const MAX_CACHED = 30;

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode or full: the next playtest can store it again
  }
}

/** Keeps `entry` first, without older entries of the same key, at most `max`. */
export function keepNewest<T>(list: T[], entry: T, key: (t: T) => string, max: number): T[] {
  return [entry, ...list.filter((x) => key(x) !== key(entry))].slice(0, max);
}

interface Solved {
  data: string;
  recording: Recording;
}

/** A won playtest of a level from a link (its link data): the editor may publish it with this run. */
export function rememberSolution(data: string, recording: Recording): void {
  if (recording.result !== 'sieg') return;
  write(SOLVED, keepNewest(read<Solved[]>(SOLVED, []), { data, recording }, (s) => s.data, MAX_SOLVED));
}

/** The won run for exactly this level (link data of its current state), or null. */
export function solutionFor(data: string): Recording | null {
  return read<Solved[]>(SOLVED, []).find((s) => s.data === data)?.recording ?? null;
}

// ---------- game: '#spieler=<id>' ----------

/** Level id from a location hash '#spieler=<n>', or null. */
export function playerIdFromHash(hash: string): number | null {
  const m = /^#spieler=([1-9][0-9]{0,15})$/.exec(hash);
  return m ? Number(m[1]) : null;
}

export type PlayerResult = { ok: true; file: LevelFile; offline: boolean } | { ok: false; error: string } | null;

/**
 * Loads the level of a '#spieler=<n>' hash from the API; offline it uses the copy from the last time.
 * null if the hash is no player level.
 */
export async function loadPlayerLevel(hash: string, fetchFn: Fetch = doFetch): Promise<PlayerResult> {
  const n = playerIdFromHash(hash);
  if (n === null) return null;
  const cached = () => read<LevelFile[]>(CACHE, []).find((f) => f.id === `spieler:${n}`) ?? null;
  let res: Response;
  try {
    res = await fetchFn(`/api/spielerlevels/${n}/datei`, { credentials: 'same-origin', cache: 'no-store' });
  } catch {
    const c = cached();
    return c ? { ok: true, file: c, offline: true } : { ok: false, error: `${NICHT_ERREICHBAR} Dieses Level war noch nicht auf diesem Gerät.` };
  }
  if (res.status === 404) return { ok: false, error: 'Dieses Spieler-Level gibt es nicht (mehr) oder es wartet noch auf Freigabe.' };
  let file: LevelFile | null = null;
  try {
    file = res.ok ? ((await res.json()) as LevelFile) : null;
  } catch {
    file = null;
  }
  if (!file || file.id !== `spieler:${n}` || !Array.isArray(file.map)) {
    const c = cached();
    return c ? { ok: true, file: c, offline: true } : { ok: false, error: NICHT_ERREICHBAR };
  }
  write(CACHE, keepNewest(read<LevelFile[]>(CACHE, []), file, (f) => f.id, MAX_CACHED));
  return { ok: true, file, offline: false };
}

/** The list page, optionally at one level (rating, reporting). */
export const listUrl = (levelId?: string): string => `./spielerlevels.html${levelId && isPlayerLevel(levelId) ? `#level-${levelId.slice(8)}` : ''}`;

// ---------- editor: upload ----------

export type Pruefung = { status: 'wartet' } | { status: 'angenommen'; level: number } | { status: 'abgelehnt'; grund: string };

async function json(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface UploadRequest {
  level: LevelFile;
  loesung: Recording;
  titel: string;
  beschreibung: string;
  ersetzt?: number;
  version: string;
}

/** Sends a level with its solution; the id of the check, or a message (name: a display name is missing). */
export async function hochladen(req: UploadRequest, fetchFn: Fetch = doFetch): Promise<{ id: string } | { fehler: string; name?: boolean }> {
  let res: Response;
  try {
    res = await fetchFn('/api/spielerlevels', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...req, lizenz: LICENSE }),
    });
  } catch {
    return { fehler: NICHT_ERREICHBAR };
  }
  const data = await json(res);
  if (res.status === 202 && typeof data?.id === 'string') return { id: data.id };
  if (res.status === 401) return { fehler: 'Bitte melde dich zuerst an.' };
  if (res.status === 413) return { fehler: 'Das Level oder die Lösung ist zu groß.' };
  const fehler = typeof data?.error === 'string' && res.status !== 404 ? data.error : NICHT_ERREICHBAR;
  return data?.name === true ? { fehler, name: true } : { fehler };
}

/** Asks for the result until it is there (about two minutes at most). */
export async function pruefungAbwarten(
  id: string,
  fetchFn: Fetch = doFetch,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  versuche = 90,
): Promise<Exclude<Pruefung, { status: 'wartet' }>> {
  for (let i = 0; i < versuche; i++) {
    await pause(i < 5 ? 400 : 1500);
    let res: Response;
    try {
      res = await fetchFn(`/api/spielerlevels/pruefung/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store' });
    } catch {
      continue;
    }
    const data = await json(res);
    if (res.status === 404) return { status: 'abgelehnt', grund: typeof data?.error === 'string' ? data.error : 'Prüfung abgebrochen.' };
    if (!res.ok || !data) continue;
    if (data.status === 'angenommen' && typeof data.level === 'number') return { status: 'angenommen', level: data.level };
    if (data.status === 'abgelehnt') return { status: 'abgelehnt', grund: String(data.grund ?? 'Abgelehnt.') };
  }
  return { status: 'abgelehnt', grund: 'Die Prüfung dauert ungewöhnlich lange. Unter „Meine Levels“ siehst du später, ob es geklappt hat.' };
}

// ---------- texts ----------

export type LevelStatus = 'wartet' | 'frei' | 'abgelehnt' | 'zurueckgezogen' | 'ersetzt';

export const STATUS_TEXT: Record<LevelStatus, string> = {
  wartet: 'Wartet auf Freigabe',
  frei: 'Veröffentlicht',
  abgelehnt: 'Abgelehnt',
  zurueckgezogen: 'Zurückgezogen',
  ersetzt: 'Durch neue Version ersetzt',
};

/** "4,5 ★ (12 Bewertungen)" or "Noch nicht bewertet". */
export function ratingText(stars: number | null, votes: number): string {
  if (stars === null || votes === 0) return 'Noch nicht bewertet';
  return `${stars.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ★ (${votes === 1 ? '1 Bewertung' : `${votes} Bewertungen`})`;
}
