import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { requireAccount, requireSignedIn } from './konten.ts';
import { RateLimit } from './limit.ts';
import { parseRecording, type Recording, recordingHash, type SolvabilityStore } from './loesbarkeit.ts';
import { LEVEL_ID } from './stats.ts';

/**
 * Bestenliste (docs/SPEC-bestenliste.md): a won run is replayed on the server before its time counts.
 * Submitting answers at once (202); the replay runs in a queue with limited parallelism, and the game
 * fetches the result. Rankings per level: top 100 and the own place.
 */

// ---------- data model ----------

export interface RankedEntry {
  id: number;
  accountId: number;
  /** Display name (never the mail address); null = none chosen yet. */
  name: string | null;
  steps: number;
  createdAt: Date;
  /** 1-based; ties are broken by the earlier run, then the entry id. */
  rank: number;
}

/** Storage of the rankings (PostgreSQL: src/bestenliste-db.ts, memory: src/bestenliste-memory.ts). */
export interface LeaderboardStore {
  /**
   * Keeps the run if it beats the account's entry for the level (or there is none).
   * Returns whether it did and the account's best steps afterwards.
   */
  submit(e: { accountId: number; level: string; steps: number; levelHash: string; version: string; recording: Recording; now: Date }): Promise<{ improved: boolean; steps: number }>;
  /** The best `limit` entries of a level and the account's own (also below the limit). Blocked accounts are left out. */
  ranking(level: string, limit: number, accountId: number | null): Promise<{ total: number; entries: RankedEntry[] }>;
  /** Steps and place of every level the account has an entry for. */
  mine(accountId: number): Promise<{ level: string; steps: number; rank: number }[]>;
  entry(id: number): Promise<{ id: number; accountId: number; level: string } | null>;
  remove(id: number): Promise<boolean>;
}

/** Replays a recording with the game code of the running version. */
export interface Checker {
  /** false: no game code here (the API still runs, submitting answers 503). */
  available(): boolean;
  /**
   * geloest/nicht-geloest/fehler as in src/game/check.ts; 'unbekannt' = the level does not exist in this
   * version. `steps` are the replayed ones.
   */
  check(rec: Recording): Promise<{ status: 'geloest' | 'nicht-geloest' | 'fehler' | 'unbekannt'; steps: number; levelHash?: string; error?: string }>;
  /** Replays a recording of a given (already checked) level, e.g. a player level (docs/SPEC-spielerlevels.md). */
  checkFile?(file: LevelJson, rec: Recording): Promise<{ status: 'geloest' | 'nicht-geloest' | 'fehler'; steps: number; error?: string }>;
  /**
   * An uploaded editor level: only editor content (sanitizeLevel, never Lua), then the solution must win.
   * 'ungueltig' = the level itself is refused (error says why); `file` is the checked level to store.
   */
  checkLevel?(raw: unknown, rec: Recording): Promise<{ status: 'geloest' | 'nicht-geloest' | 'fehler' | 'ungueltig'; steps: number; file?: LevelJson; error?: string }>;
}

/** A LevelFile as JSON (the server has no game types). */
export type LevelJson = Record<string, unknown>;

// ---------- limits ----------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** One hour of play at 400 physics steps per second. */
export const MAX_STEPS = 3600 * 400;
export const SUBMISSIONS_PER_HOUR = 30;
export const OPEN_PER_ACCOUNT = 2;
export const QUEUE_MAX = 50;
export const TOP = 100;
/** Results wait this long for the game to fetch them. */
const KEEP_RESULT_MS = 10 * MINUTE;
const BODY_LIMIT = 2 * 1024 * 1024;

/** Recording check for the leaderboard: the solution format plus the length limit, input counted too. */
export function parseRun(body: unknown): Recording | string {
  const rec = parseRecording(body);
  if (typeof rec === 'string') return rec === 'nur gewonnene Läufe sind Lösungen' ? 'nur gewonnene Läufe kommen in die Bestenliste' : rec;
  if (rec.steps > MAX_STEPS) return 'Lauf länger als eine Stunde';
  // the replay plays every counted step: a huge count must not hide behind a small `steps`
  let counted = 0;
  for (const e of rec.input as unknown[][]) {
    const n = e[0];
    if (typeof n !== 'number' || n < 1) return 'Eingaben ungültig';
    counted += n;
    if (counted > MAX_STEPS + rec.input.length) return 'Lauf länger als eine Stunde';
  }
  return rec;
}

// ---------- queue ----------

/** What the queue keeps per job: 'wartet' until the job is done (leaderboard runs and player levels share it). */
export type QueueState = { status: 'wartet' } | { status: 'angenommen' | 'abgelehnt'; [key: string]: unknown };

export type JobState =
  | { status: 'wartet' }
  | { status: 'angenommen'; lauf: number; zeit: number; neu: boolean; platz: number | null; von: number }
  | { status: 'abgelehnt'; grund: string };

interface Job {
  id: string;
  accountId: number;
  run: () => Promise<QueueState>;
  state: QueueState;
  doneAt: number;
}

/** Jobs run in submission order, at most `parallel` at a time; results are kept a few minutes. */
export class CheckQueue {
  private readonly jobs = new Map<string, Job>();
  private readonly waiting: Job[] = [];
  private running = 0;
  private seq = 0;
  private readonly parallel: number;
  private readonly now: () => number;

  constructor(parallel = 1, now = () => Date.now()) {
    this.parallel = Math.max(1, parallel);
    this.now = now;
  }

  /** Open jobs (waiting or running), all or of one account. */
  open(accountId?: number): number {
    let n = 0;
    for (const j of this.jobs.values()) if (j.state.status === 'wartet' && (accountId === undefined || j.accountId === accountId)) n++;
    return n;
  }

  add(accountId: number, run: () => Promise<QueueState>): string {
    this.prune();
    const id = `${Date.now().toString(36)}${(++this.seq).toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const job: Job = { id, accountId, run, state: { status: 'wartet' }, doneAt: 0 };
    this.jobs.set(id, job);
    this.waiting.push(job);
    this.pump();
    return id;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /** Resolves when no job is open (tests). */
  async idle(): Promise<void> {
    while (this.open() > 0) await new Promise((r) => setTimeout(r, 5));
  }

  private pump(): void {
    while (this.running < this.parallel && this.waiting.length) {
      const job = this.waiting.shift()!;
      this.running++;
      job
        .run()
        .catch((): QueueState => ({ status: 'abgelehnt', grund: 'Die Prüfung ist fehlgeschlagen. Bitte versuch es später noch einmal.' }))
        .then((state) => {
          job.state = state;
          job.doneAt = this.now();
          this.running--;
          this.pump();
        });
    }
  }

  private prune(): void {
    const t = this.now();
    for (const [id, j] of this.jobs) if (j.state.status !== 'wartet' && t - j.doneAt > KEEP_RESULT_MS) this.jobs.delete(id);
  }
}

// ---------- routes ----------

export interface LeaderboardOptions {
  store: LeaderboardStore;
  checker: Checker;
  /** Version of the running game (MURMEL_VERSION). */
  version: string;
  /** Public address of the game (CSRF check). */
  origin: string;
  /** Replays at the same time (one checker process: keep 1). */
  parallel?: number;
  /** Lösbarkeitsprüfung: a checked win of an admin is also stored as a solution for the nightly run. */
  solutions?: SolvabilityStore;
  /**
   * Player levels (docs/SPEC-spielerlevels.md): the checked level for an id 'spieler:<n>' if the account
   * may play it, else null. Without it, runs of player levels are refused like unknown levels.
   */
  playerFile?: (level: string, account: { id: number; role: string }) => Promise<LevelJson | null>;
  /** Shared queue (player levels use the same checker process). */
  queue?: CheckQueue;
  now?: () => Date;
}

/** SHA-256 of a level's JSON, like levelHash in tools/lib/levels.mjs. */
export const levelHashOf = (file: LevelJson): string => createHash('sha256').update(JSON.stringify(file)).digest('hex');

export const sameVersion = (a: string, b: string) => a.length >= 7 && b.length >= 7 && (a.startsWith(b) || b.startsWith(a));

/** /api/bestenliste: submit (account), result, rankings (open), own places (account), delete (owner or admin). */
export function leaderboardRoutes(app: FastifyInstance, opts: LeaderboardOptions): CheckQueue {
  const { store, checker, version, origin, now = () => new Date() } = opts;
  const queue = opts.queue ?? new CheckQueue(opts.parallel ?? 1, () => now().getTime());
  const perHour = new RateLimit(SUBMISSIONS_PER_HOUR, HOUR);

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/bestenliste') || req.method === 'GET' || req.method === 'HEAD') return;
    // CSRF: writes only from the game's own page (the cookie is SameSite=Strict as well).
    if (req.headers.origin !== undefined && req.headers.origin !== origin) return reply.code(403).send({ error: 'fremde Herkunft' });
  });

  /** Replays the run and, if it wins, keeps it when it is the account's best. */
  async function judge(accountId: number, admin: boolean, rec: Recording, clientVersion: string | null): Promise<JobState> {
    const player = rec.level.startsWith('spieler:');
    const r = player ? await checkPlayer(accountId, admin, rec) : await checker.check(rec);
    if (r.status === 'unbekannt') return { status: 'abgelehnt', grund: 'Dieses Level gibt es in der aktuellen Spielversion nicht.' };
    if (r.status !== 'geloest') {
      if (clientVersion && !sameVersion(clientVersion, version)) return { status: 'abgelehnt', grund: 'Dein Spiel ist nicht auf dem neuesten Stand – bitte die Seite neu laden.' };
      if (r.status === 'fehler' && /Zeitüberschreitung/.test(r.error ?? '')) return { status: 'abgelehnt', grund: 'Die Prüfung dauerte zu lange.' };
      return { status: 'abgelehnt', grund: r.status === 'fehler' ? 'Der Lauf ließ sich nicht nachspielen.' : 'Beim Nachspielen wurde das Level nicht gelöst.' };
    }
    // admins only (docs/SPEC-bestenliste.md): the checked win also serves the nightly Lösbarkeitsprüfung
    if (admin && opts.solutions && !player) {
      await opts.solutions.addSolution({ level: rec.level, recordingHash: recordingHash(rec), recording: rec, steps: rec.steps, accountId }).catch(() => {});
    }
    const kept = await store.submit({ accountId, level: rec.level, steps: r.steps, levelHash: r.levelHash ?? '', version, recording: rec, now: now() });
    const { total, entries } = await store.ranking(rec.level, 0, accountId);
    const me = entries.find((e) => e.accountId === accountId);
    return { status: 'angenommen', lauf: r.steps, zeit: kept.steps, neu: kept.improved, platz: me?.rank ?? null, von: total };
  }

  /** A run of a player level: replayed with the stored, checked level (its id never changes its content). */
  async function checkPlayer(accountId: number, admin: boolean, rec: Recording): Promise<Awaited<ReturnType<Checker['check']>>> {
    const file = opts.playerFile && checker.checkFile ? await opts.playerFile(rec.level, { id: accountId, role: admin ? 'admin' : 'player' }) : null;
    if (!file) return { status: 'unbekannt', steps: 0 };
    const r = await checker.checkFile!(file, rec);
    return { ...r, levelHash: levelHashOf(file) };
  }

  app.post<{ Body: Record<string, unknown> }>('/api/bestenliste', { preHandler: requireAccount, bodyLimit: BODY_LIMIT }, async (req, reply) => {
    if (!checker.available()) return reply.code(503).send({ error: 'Die Bestenliste ist gerade nicht verfügbar.' });
    const rec = parseRun(req.body);
    if (typeof rec === 'string') return reply.code(400).send({ error: rec });
    const a = req.account!;
    if (queue.open(a.id) >= OPEN_PER_ACCOUNT) return reply.code(429).send({ error: 'Es werden schon Läufe von dir geprüft. Bitte einen Moment warten.' });
    if (queue.open() >= QUEUE_MAX) return reply.code(503).send({ error: 'Gerade ist viel los. Bitte versuch es später noch einmal.' });
    if (a.role !== 'admin' && !perHour.take(String(a.id), now().getTime())) {
      return reply.code(429).send({ error: `Höchstens ${SUBMISSIONS_PER_HOUR} Läufe pro Stunde. Bitte versuch es später noch einmal.` });
    }
    const v = typeof req.body?.version === 'string' ? req.body.version.slice(0, 40) : null;
    const id = queue.add(a.id, () => judge(a.id, a.role === 'admin', rec, v));
    return reply.code(202).send({ id });
  });

  app.get<{ Params: { id: string } }>(
    '/api/bestenliste/pruefung/:id',
    { preHandler: requireAccount, schema: { params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-z0-9]{1,40}$' } } } } },
    async (req, reply) => {
      const job = queue.get(req.params.id);
      if (!job || job.accountId !== req.account!.id) return reply.code(404).send({ error: 'Prüfung nicht gefunden – vielleicht wurde der Server neu gestartet.' });
      reply.header('Cache-Control', 'no-store');
      return job.state;
    },
  );

  app.get<{ Querystring: { id?: string } }>(
    '/api/bestenliste/level',
    { schema: { querystring: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: LEVEL_ID } } } } },
    async (req, reply) => {
      const level = req.query.id!;
      const me = req.account?.id ?? null;
      const { total, entries } = await store.ranking(level, TOP, me);
      reply.header('Cache-Control', 'no-store');
      const row = (e: RankedEntry) => ({ id: e.id, platz: e.rank, name: e.name, zeit: e.steps, datum: e.createdAt.toISOString(), ich: e.accountId === me });
      const own = entries.find((e) => e.accountId === me);
      return {
        level,
        anzahl: total,
        eintraege: entries.filter((e) => e.rank <= TOP).map(row),
        ich: own ? { id: own.id, platz: own.rank, zeit: own.steps } : null,
        admin: req.account?.role === 'admin',
      };
    },
  );

  app.get('/api/bestenliste/meine', { preHandler: requireSignedIn }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const levels: Record<string, { zeit: number; platz: number }> = {};
    for (const m of await store.mine(req.account!.id)) levels[m.level] = { zeit: m.steps, platz: m.rank };
    return { levels };
  });

  app.delete<{ Params: { id: string } }>(
    '/api/bestenliste/eintrag/:id',
    { preHandler: requireSignedIn, schema: { params: { type: 'object', properties: { id: { type: 'string', pattern: '^[1-9][0-9]{0,15}$' } } } } },
    async (req, reply) => {
      const e = await store.entry(Number(req.params.id));
      const a = req.account!;
      if (!e) return reply.code(404).send({ error: 'Eintrag nicht gefunden' });
      // own entries can always be deleted (blocked accounts too); others only by admins
      if (e.accountId !== a.id && a.role !== 'admin') return reply.code(403).send({ error: 'nicht berechtigt' });
      await store.remove(e.id);
      return reply.code(204).send();
    },
  );

  return queue;
}

