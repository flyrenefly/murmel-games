// Fortschritt auf allen Geräten (docs/SPEC-sync.md): compares the local progress with the account's
// copy on the server (/api/fortschritt, server/src/sync.ts). Merging is mergeProgress from
// src/game/progress.ts – solved stays solved, the better time wins. Without account or network the game
// plays on locally; the next sync brings everything along. No dialogs: only a status line.
import { mergeProgress, parseProgress, type Progress } from './game/progress';

export interface ServerStand {
  version: number;
  geaendert: string | null;
  fortschritt: unknown;
}

/** Answer of a call: data, or the HTTP status (0 = no network / no API). */
export type Antwort<T> = { ok: true; daten: T } | { ok: false; status: number; daten?: ServerStand };

export interface SyncApi {
  holen(): Promise<Antwort<ServerStand>>;
  /** 409: `daten` is the newer state on the server. */
  hochladen(basis: number, p: Progress): Promise<Antwort<{ version: number; geaendert: string }>>;
}

type Fetch = typeof fetch;

/** The real API (same origin, session cookie). */
export function syncApi(base = '/api/fortschritt', fetchFn: Fetch = (...a) => fetch(...a)): SyncApi {
  async function call<T>(method: string, body?: unknown): Promise<Antwort<T>> {
    let res: Response;
    try {
      res = await fetchFn(base, {
        method,
        credentials: 'same-origin',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return { ok: false, status: 0 };
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      /* no JSON: no API behind this address (emergency copy, local preview) */
    }
    if (data === null || typeof data !== 'object' || res.status === 404) return { ok: false, status: 0 };
    if (res.ok) return { ok: true, daten: data as T };
    return { ok: false, status: res.status, daten: res.status === 409 ? (data as ServerStand) : undefined };
  }
  return {
    holen: () => call<ServerStand>('GET'),
    hochladen: (basis, p) => call('PUT', { basis, fortschritt: { levels: p.levels, solved: p.solved } }),
  };
}

export type SyncStatus =
  | { art: 'ok'; zeit: string }
  | { art: 'laeuft' }
  | { art: 'offline' }
  | { art: 'abgemeldet' }
  | { art: 'gesperrt' }
  | { art: 'fehler' };

/** The server's progress, checked like a loaded file (untrusted). */
function serverProgress(s: ServerStand): Progress {
  const f = (s.fortschritt ?? {}) as { levels?: unknown; solved?: unknown };
  return parseProgress(JSON.stringify({ v: 1, app: 'murmel', levels: f.levels ?? {}, solved: f.solved ?? [] })).progress;
}

/** JSON with sorted keys: PostgreSQL (jsonb) does not keep the key order. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}
export const sameProgress = (a: Progress, b: Progress): boolean => canonical(a) === canonical(b);

const TRIES = 3;

/**
 * One sync: fetch, merge, upload if the server lacks something (with the version it was read at;
 * 409 = another device was faster: merge its state and try again), then keep the merged state locally.
 * `lokal` is read again at the end, so runs finished during the sync are kept as well.
 */
export async function abgleichen(lokal: () => Progress, speichern: (p: Progress) => void, api: SyncApi, now: () => Date = () => new Date()): Promise<SyncStatus> {
  const r = await api.holen();
  if (!r.ok) return fehlerStatus(r.status);
  let stand = r.daten;
  for (let i = 0; i < TRIES; i++) {
    let server: Progress;
    try {
      server = serverProgress(stand);
    } catch {
      return { art: 'fehler' };
    }
    const zusammen = mergeProgress(lokal(), server);
    if (sameProgress(zusammen, mergeProgress(server, server))) {
      speichern(mergeProgress(lokal(), zusammen));
      return { art: 'ok', zeit: now().toISOString() };
    }
    const up = await api.hochladen(stand.version, zusammen);
    if (up.ok) {
      speichern(mergeProgress(lokal(), zusammen));
      return { art: 'ok', zeit: now().toISOString() };
    }
    // Blocked: nothing can be uploaded, but the account's progress still comes to this device.
    if (up.status === 403) {
      speichern(mergeProgress(lokal(), server));
      return { art: 'gesperrt' };
    }
    if (up.status !== 409 || !up.daten) return fehlerStatus(up.status);
    stand = up.daten;
  }
  return { art: 'fehler' };
}

function fehlerStatus(status: number): SyncStatus {
  if (status === 0) return { art: 'offline' };
  if (status === 401) return { art: 'abgemeldet' };
  if (status === 403) return { art: 'gesperrt' };
  return { art: 'fehler' };
}

/**
 * When to sync: start, sign-in, after a win (bundled), back online. One sync at a time; a request
 * during a running one runs right after it. Without account (401) nothing happens until the next
 * sign-in, so wins do not send requests that cannot succeed.
 */
export class Abgleich {
  status: SyncStatus = { art: 'abgemeldet' };
  private laeuft: Promise<void> | null = null;
  private nochmal = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly hoerer = new Set<(s: SyncStatus) => void>();
  private readonly lokal: () => Progress;
  private readonly speichern: (p: Progress) => void;
  private readonly api: SyncApi;

  constructor(lokal: () => Progress, speichern: (p: Progress) => void, api: SyncApi = syncApi()) {
    this.lokal = lokal;
    this.speichern = speichern;
    this.api = api;
  }

  /** Calls f now and on every change; returns the unsubscribe function. */
  beobachten(f: (s: SyncStatus) => void): () => void {
    this.hoerer.add(f);
    f(this.status);
    return () => this.hoerer.delete(f);
  }

  private setzen(s: SyncStatus): void {
    this.status = s;
    for (const f of this.hoerer) f(s);
  }

  /** Signed in (or the account state is unknown): sync now. */
  jetzt(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.laeuft) {
      this.nochmal = true;
      return this.laeuft;
    }
    this.setzen({ art: 'laeuft' });
    this.laeuft = (async () => {
      let s: SyncStatus;
      try {
        s = await abgleichen(this.lokal, this.speichern, this.api);
      } catch {
        s = { art: 'fehler' };
      }
      this.setzen(s);
      this.laeuft = null;
      if (this.nochmal) {
        this.nochmal = false;
        await this.jetzt();
      }
    })();
    return this.laeuft;
  }

  /** After a win and similar: in a moment, bundled; skipped while signed out. */
  bald(ms = 2000): void {
    if (this.status.art === 'abgemeldet' || this.status.art === 'gesperrt') return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.jetzt(), ms);
  }

  /** Back online: only if something is waiting. */
  online(): void {
    if (this.status.art === 'offline' || this.status.art === 'fehler') void this.jetzt();
  }

  /** Signed out or account deleted: the progress stays on this device. */
  abgemeldet(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.setzen({ art: 'abgemeldet' });
  }
}

/** Status line for the progress page. */
export function statusText(s: SyncStatus, heute: Date = new Date()): string {
  switch (s.art) {
    case 'ok': {
      const d = new Date(s.zeit);
      const gleicherTag = d.toDateString() === heute.toDateString();
      return gleicherTag
        ? `Auf allen Geräten abgeglichen um ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}.`
        : `Auf allen Geräten abgeglichen am ${d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}.`;
    }
    case 'laeuft':
      return 'Wird abgeglichen …';
    case 'offline':
      return 'Wartet auf Netz – wird später nachgereicht.';
    case 'gesperrt':
      return 'Konto gesperrt – Abgleich pausiert.';
    case 'fehler':
      return 'Abgleich gerade nicht möglich – wird später nachgereicht.';
    case 'abgemeldet':
      return 'Nur auf diesem Gerät. Mit einem Konto auf allen Geräten.';
  }
}
