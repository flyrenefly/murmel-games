// Spielstand in der Cloud (docs/SPEC-cloudstand.md): a run is saved as its start value plus the input
// recording up to the save point (gzip + base64) and a check code of the state there. Continuing replays
// the input without graphics; the check code proves the replay reached the same state (another game
// version or browser engine may not). Only signed in; without an account nothing leaves the device.
import { type DecodedInput, decodeInput } from './game/recording';
import type { GameSession } from './game/session';

/** One hour of play at 400 physics steps per second (as the leaderboard and the server). */
export const MAX_STEPS = 3600 * 400;
/** Base64 characters the server keeps. */
export const MAX_DATA = 2_000_000;
/** Unpacked recordings larger than this are not read (a broken or hostile save). */
const MAX_UNPACKED = 32 * 1024 * 1024;
/** fetch keepalive (page hidden or closing) takes at most 64 KB. */
const KEEPALIVE_MAX = 60_000;

/** What the server stores for a level (PUT /api/spielstand?level=…). */
export interface Stand {
  pack: string;
  seed: number;
  leben: number | null;
  steps: number;
  version: string;
  pruef: string;
  daten: string;
}

export interface StandInfo {
  level: string;
  pack: string;
  steps: number;
  gespeichert: string;
}

/** Can this browser pack and unpack saves? */
export const cloudMoeglich = (): boolean => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

// ---------- check code ----------

/** 53-bit string hash (cyrb53) as hex: short and good enough to notice a different state. */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

const round = (v: number) => Math.round(v * 1000) || 0;

/** Check code of a run's state: steps, falls, Oxyd colors and states, inventories, marbles (to 1/1000 field). */
export function pruefcode(s: GameSession): string {
  const marbles = s.physics.marbles.map((m, i) => `${round(m.pos.x)}:${round(m.pos.y)}:${s.falling[i] >= 0 ? 'f' : ''}`).join(';');
  const text = [s.steps, s.falls, s.board.states.map((st, i) => s.board.symbolOf(i) + st).join(','), s.objects.inventories.map((inv) => inv.join(',')).join('/'), marbles].join('|');
  return `${s.steps}-${hash(text)}`;
}

// ---------- packing ----------

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** JSON text → gzip → base64. */
export async function packen(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return toBase64(new Uint8Array(await new Response(stream).arrayBuffer()));
}

/** base64 → gzip → text; throws on broken data or more than `max` bytes unpacked. */
export async function entpacken(daten: string, max = MAX_UNPACKED): Promise<string> {
  const bin = atob(daten);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new Error('Spielstand zu groß');
    }
    parts.push(value);
  }
  return new TextDecoder().decode(await new Blob(parts as BlobPart[]).arrayBuffer());
}

// ---------- save and restore ----------

/** The save of a running level (null: nothing worth saving, or longer than an hour). */
export async function standAus(s: GameSession, pack: string, leben: number | null, version: string): Promise<Stand | null> {
  if (s.won || s.steps <= 0 || s.steps > MAX_STEPS) return null;
  const rec = s.recording();
  const daten = await packen(JSON.stringify({ v: rec.v, steps: rec.steps, input: rec.input }));
  return { pack, seed: s.seed, leben, steps: s.steps, version: /^[0-9A-Za-z._-]{1,64}$/.test(version) ? version : 'dev', pruef: pruefcode(s), daten };
}

/** Unpacks and checks a save from the server (untrusted). */
export async function eingabeAus(stand: Stand): Promise<DecodedInput> {
  if (!Number.isInteger(stand.steps) || stand.steps < 1 || stand.steps > MAX_STEPS) throw new Error('Spielstand ungültig');
  const input = decodeInput(JSON.parse(await entpacken(stand.daten)));
  if (input.steps !== stand.steps) throw new Error('Spielstand ungültig');
  return input;
}

/**
 * Replays the saved input into a fresh run (same seed and lives), in slices so the page stays
 * responsive; `fortschritt` gets 0..1. Throws if the run ends early or the state differs at the end.
 */
export async function nachspielen(s: GameSession, input: DecodedInput, pruef: string, fortschritt: (anteil: number) => void = () => {}, scheibe = 20_000): Promise<void> {
  let n = 0;
  for (const step of input) {
    for (const a of step.actions) s.act(a);
    s.step({ fx: step.fx, fy: step.fy, ax: step.ax, ay: step.ay });
    if (s.won || s.restartRequested) throw new Error('Spielstand passt nicht');
    if (++n % scheibe === 0) {
      fortschritt(n / input.steps);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  fortschritt(1);
  if (pruefcode(s) !== pruef) throw new Error('Spielstand passt nicht');
}

// ---------- API ----------

/** Answer of a call: data, or the HTTP status (0 = no network / no API). */
export type Antwort<T> = { ok: true; daten: T } | { ok: false; status: number };

export interface CloudApi {
  liste(): Promise<Antwort<{ staende: StandInfo[] }>>;
  holen(level: string): Promise<Antwort<Stand & { level: string; gespeichert: string }>>;
  sichern(level: string, stand: Stand, keepalive?: boolean): Promise<Antwort<{ gespeichert: string }>>;
  loeschen(level: string): Promise<Antwort<null>>;
}

type Fetch = typeof fetch;

/** The real API (same origin, session cookie). */
export function cloudApi(base = '/api/spielstand', fetchFn: Fetch = (...a) => fetch(...a)): CloudApi {
  async function call<T>(method: string, level?: string, body?: unknown, keepalive = false): Promise<Antwort<T>> {
    let res: Response;
    try {
      res = await fetchFn(level === undefined ? base : `${base}?level=${encodeURIComponent(level)}`, {
        method,
        credentials: 'same-origin',
        keepalive,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return { ok: false, status: 0 };
    }
    if (res.status === 204) return { ok: true, daten: null as T };
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      /* no JSON: no API behind this address (emergency copy, local preview) */
    }
    if (data === null || typeof data !== 'object') return { ok: false, status: 0 };
    if (res.ok) return { ok: true, daten: data as T };
    // 404 with the API's JSON answer: no save; without it no API (handled above)
    return { ok: false, status: res.status };
  }
  return {
    liste: () => call('GET'),
    holen: (level) => call('GET', level),
    sichern: (level, stand, keepalive) => call('PUT', level, stand, keepalive),
    loeschen: (level) => call('DELETE', level),
  };
}

export type SichernErgebnis = 'ok' | 'zu-lang' | 'offline' | 'fehler';

export const SICHERN_TEXT: Record<SichernErgebnis | 'laeuft', string> = {
  laeuft: 'Wird in der Cloud gesichert …',
  ok: 'In der Cloud gesichert – auf einem anderen Gerät weiterspielen.',
  'zu-lang': 'Dieser Lauf ist zu lang für die Cloud.',
  offline: 'Sichern gerade nicht möglich – kein Netz.',
  fehler: 'Sichern gerade nicht möglich.',
};

/** The saves of the signed-in account and what this device saved last (to skip unchanged saves). */
export class CloudSpeicher {
  /** Known saves by level (from the list, and own saves). */
  readonly staende = new Map<string, StandInfo>();
  private readonly zuletzt = new Map<string, string>();
  private listeZeit = 0;
  private readonly api: CloudApi;
  private readonly now: () => number;

  constructor(api: CloudApi = cloudApi(), now: () => number = Date.now) {
    this.api = api;
    this.now = now;
  }

  private key = (s: GameSession) => `${s.seed}:${s.steps}:${s.recording().input.length}`;

  /** Fetches the list of saves (at most every 30 s unless forced); true if it changed. */
  async liste(erzwingen = false): Promise<boolean> {
    if (!erzwingen && this.now() - this.listeZeit < 30_000) return false;
    this.listeZeit = this.now();
    const r = await this.api.liste();
    if (!r.ok) return false;
    const vorher = JSON.stringify([...this.staende.values()]);
    this.staende.clear();
    for (const s of r.daten.staende) this.staende.set(s.level, s);
    return JSON.stringify([...this.staende.values()]) !== vorher;
  }

  /** Saves the run unless this device already saved exactly this state. */
  async sichern(s: GameSession, pack: string, leben: number | null, version: string, keepalive = false): Promise<SichernErgebnis> {
    const level = s.level.id;
    if (s.won || s.steps <= 0) return 'fehler'; // nothing to continue
    if (this.zuletzt.get(level) === this.key(s)) return 'ok';
    const key = this.key(s);
    const stand = await standAus(s, pack, leben, version);
    if (!stand || stand.daten.length > MAX_DATA) return 'zu-lang';
    const r = await this.api.sichern(level, stand, keepalive && stand.daten.length < KEEPALIVE_MAX);
    if (!r.ok) return r.status === 0 ? 'offline' : r.status === 413 ? 'zu-lang' : 'fehler';
    this.zuletzt.set(level, key);
    this.staende.set(level, { level, pack, steps: stand.steps, gespeichert: r.daten.gespeichert });
    return 'ok';
  }

  /** A restored run counts as saved as it is. */
  gesichert(s: GameSession): void {
    this.zuletzt.set(s.level.id, this.key(s));
  }

  /** The save of a level, unpacked and checked; or the reason why not. */
  async laden(level: string): Promise<{ ok: true; stand: Stand; eingabe: DecodedInput } | { ok: false; grund: string }> {
    const r = await this.api.holen(level);
    if (!r.ok) {
      if (r.status === 404) this.staende.delete(level);
      return { ok: false, grund: r.status === 0 ? 'Der Spielstand ist gerade nicht erreichbar.' : r.status === 404 ? 'Kein Spielstand mehr in der Cloud.' : 'Der Spielstand ließ sich nicht laden.' };
    }
    try {
      return { ok: true, stand: r.daten, eingabe: await eingabeAus(r.daten) };
    } catch {
      return { ok: false, grund: 'Der Spielstand ist beschädigt.' };
    }
  }

  /** After a win: the save of this level goes (only if there is one). */
  async loeschen(level: string): Promise<void> {
    if (!this.staende.has(level) && !this.zuletzt.has(level)) return;
    this.staende.delete(level);
    this.zuletzt.delete(level);
    await this.api.loeschen(level);
  }

  /** Signed out: forget the account's saves on this device. */
  vergessen(): void {
    this.staende.clear();
    this.zuletzt.clear();
    this.listeZeit = 0;
  }
}
