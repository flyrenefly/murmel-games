// Geister im Spiel (docs/SPEC-geister.md): which runs can play along, loading them, the own best run in
// this browser (IndexedDB) and the account switch "Meine Läufe als Geist zeigen". Everything is optional:
// offline or without the API only the local run is offered.

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const netz: Fetch = (...a) => fetch(...a);

/** A ghost on the server (GET /api/geister/level). `zeit` in physics steps. */
export interface ServerGeist {
  id: number;
  name: string | null;
  zeit: number;
  platz: number;
  ich: boolean;
}

/** One entry of the choice: `quelle` is 'lokal' or the id of a leaderboard entry. */
export interface Option {
  titel: string;
  quelle: 'lokal' | number;
}

const istGeist = (g: unknown): g is ServerGeist => {
  const x = g as ServerGeist;
  return !!x && Number.isInteger(x.id) && Number.isInteger(x.zeit) && Number.isInteger(x.platz) && typeof x.ich === 'boolean' && (x.name === null || typeof x.name === 'string');
};

export async function geisterListe(level: string, fetchFn: Fetch = netz): Promise<ServerGeist[]> {
  try {
    const res = await fetchFn(`/api/geister/level?${new URLSearchParams({ id: level })}`, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json()) as { geister?: unknown };
    return Array.isArray(data.geister) ? data.geister.filter(istGeist) : [];
  } catch {
    return []; // offline or the static copy without API
  }
}

export async function geistLaden(id: number, fetchFn: Fetch = netz): Promise<unknown> {
  try {
    const res = await fetchFn(`/api/geister/lauf/${id}`, { credentials: 'same-origin' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** The account switch; null without account or API. */
export async function freigabeLaden(fetchFn: Fetch = netz): Promise<boolean | null> {
  try {
    const res = await fetchFn('/api/geister/freigabe', { credentials: 'same-origin', cache: 'no-store' });
    const data = res.ok ? ((await res.json()) as { an?: unknown }) : null;
    return typeof data?.an === 'boolean' ? data.an : null;
  } catch {
    return null;
  }
}

export async function freigabeSetzen(an: boolean, fetchFn: Fetch = netz): Promise<boolean> {
  try {
    const res = await fetchFn('/api/geister/freigabe', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ an }),
    });
    return res.status === 204;
  } catch {
    return false;
  }
}

/** The choice at the level start: the own best run (local or server, the better), then the others by place. */
export function auswahl(lokal: { steps: number } | null, server: ServerGeist[], zeit: (steps: number) => string): Option[] {
  const out: Option[] = [];
  const meiner = server.find((g) => g.ich);
  if (meiner && (!lokal || meiner.zeit < lokal.steps)) out.push({ titel: `Deine Bestzeit ${zeit(meiner.zeit)}`, quelle: meiner.id });
  else if (lokal) out.push({ titel: `Deine Bestzeit ${zeit(lokal.steps)}`, quelle: 'lokal' });
  for (const g of server) {
    if (!g.ich) out.push({ titel: `Platz ${g.platz} · ${g.name ?? 'Spieler ohne Namen'} · ${zeit(g.zeit)}`, quelle: g.id });
  }
  return out;
}

// ---------- own best run per level in this browser ----------

const DB = 'murmel-geister';
const STORE = 'laeufe';

function db(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}

async function mitStore<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  try {
    return await new Promise<T>((ok, fail) => {
      const req = f(d.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => ok(req.result);
      req.onerror = () => fail(req.error);
    });
  } finally {
    d.close();
  }
}

/** The own best run of a level, or null (also when IndexedDB is not available, e.g. private windows). */
export async function eigenerLauf(level: string): Promise<{ steps: number } | null> {
  try {
    const r = (await mitStore('readonly', (s) => s.get(level))) as { steps?: unknown } | undefined;
    return r && Number.isInteger(r.steps) ? (r as { steps: number }) : null;
  } catch {
    return null;
  }
}

/** Keeps a won run if it is the best of this level so far. */
export async function eigenenLaufSpeichern(rec: { level: string; steps: number }): Promise<void> {
  try {
    const alt = await eigenerLauf(rec.level);
    if (!alt || rec.steps < alt.steps) await mitStore('readwrite', (s) => s.put(rec, rec.level));
  } catch {
    // no IndexedDB: the ghost of the own run is just not there later
  }
}
