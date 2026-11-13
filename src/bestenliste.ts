// Bestenliste in the game (docs/SPEC-bestenliste.md): send a won run, wait for the server's replay,
// show the place. Everything is optional – offline, without an account or without the API the game
// plays as before and only says so in one line.
import type { Recording } from './game/session';

type Fetch = typeof fetch;

/** Result of a check (GET /api/bestenliste/pruefung/:id). `zeit`/`lauf` in physics steps. */
export type Pruefung =
  | { status: 'wartet' }
  | { status: 'angenommen'; lauf: number; zeit: number; neu: boolean; platz: number | null; von: number }
  | { status: 'abgelehnt'; grund: string };

/** Own entries per level (GET /api/bestenliste/meine). */
export type Meine = Map<string, { zeit: number; platz: number }>;

export const NICHT_ERREICHBAR = 'Bestenliste gerade nicht erreichbar.';

async function json(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null; // no JSON: the static copy without API
  }
}

/** Sends a won run; the id of the check, or a message to show. */
export async function einreichen(rec: Recording, version: string, fetchFn: Fetch = (...a) => fetch(...a)): Promise<{ id: string } | { fehler: string }> {
  let res: Response;
  try {
    res = await fetchFn('/api/bestenliste', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...rec, version }),
    });
  } catch {
    return { fehler: NICHT_ERREICHBAR };
  }
  const data = await json(res);
  if (res.status === 202 && typeof data?.id === 'string') return { id: data.id };
  if (res.status === 401) return { fehler: 'Anmelden, um in die Bestenliste zu kommen.' };
  const msg = typeof data?.error === 'string' && res.status !== 404 ? data.error : NICHT_ERREICHBAR;
  return { fehler: msg };
}

/** Asks for the result until it is there (about two minutes at most). */
export async function abwarten(
  id: string,
  fetchFn: Fetch = (...a) => fetch(...a),
  pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  versuche = 90,
): Promise<Pruefung> {
  for (let i = 0; i < versuche; i++) {
    await pause(i < 5 ? 400 : 1500);
    let res: Response;
    try {
      res = await fetchFn(`/api/bestenliste/pruefung/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store' });
    } catch {
      continue; // a short network gap: ask again
    }
    const data = await json(res);
    if (res.status === 404) return { status: 'abgelehnt', grund: 'Prüfung abgebrochen. Deine Zeit bleibt auf diesem Gerät gespeichert.' };
    if (!res.ok || !data) continue;
    if (data.status !== 'wartet') return data as Pruefung;
  }
  return { status: 'abgelehnt', grund: 'Die Prüfung dauert zu lange. Schau später in die Rangliste.' };
}

/** Own places per level; empty without account or API. */
export async function meineLaden(fetchFn: Fetch = (...a) => fetch(...a)): Promise<Meine> {
  const out: Meine = new Map();
  try {
    const res = await fetchFn('/api/bestenliste/meine', { credentials: 'same-origin', cache: 'no-store' });
    const data = res.ok ? await json(res) : null;
    const levels = (data?.levels ?? {}) as Record<string, { zeit?: unknown; platz?: unknown }>;
    for (const [id, v] of Object.entries(levels)) {
      if (typeof v?.zeit === 'number' && typeof v?.platz === 'number') out.set(id, { zeit: v.zeit, platz: v.platz });
    }
  } catch {
    // offline: no places
  }
  return out;
}

/** Only runs that can improve the own entry cost the server a replay. */
export function lohntSich(steps: number, server: { zeit: number } | undefined): boolean {
  return !server || steps < server.zeit;
}

/** The line in the win message; `zeit` formats physics steps. */
export function ergebnisText(p: Pruefung, zeit: (steps: number) => string): string {
  if (p.status === 'wartet') return 'Bestenliste: wird geprüft …';
  if (p.status === 'abgelehnt') return `Bestenliste: ${p.grund}`;
  const platz = p.platz ? `Platz ${p.platz} von ${p.von}` : `${p.von} Einträge`;
  return p.neu ? `Bestenliste: ${platz} · neue persönliche Bestzeit` : `Bestenliste: ${platz} (deine Bestzeit ${zeit(p.zeit)})`;
}

/** Address of the ranking page of a level. */
export function ranglistenUrl(level: string, titel: string): string {
  return `bestenliste.html?${new URLSearchParams({ level, titel })}`;
}
