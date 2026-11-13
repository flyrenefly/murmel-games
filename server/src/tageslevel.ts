import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { type CatalogEntry, type Checker, type CheckQueue, type JobState, OPEN_PER_ACCOUNT, parseRun, QUEUE_MAX, type RankedEntry, SUBMISSIONS_PER_HOUR } from './bestenliste.ts';
import { requireAccount } from './konten.ts';
import { RateLimit } from './limit.ts';
import type { Recording, SolvabilityStore } from './loesbarkeit.ts';

/**
 * Tageslevel und Wochenaufgabe (docs/SPEC-tageslevel.md): every day and every ISO week the server picks
 * one level (proven solvable ones first, Nutzerentscheidung 13.11.2026) and a start value; each has its
 * own ranking of replayed times. Submissions use the leaderboard's checker and queue.
 */

export type Art = 'tag' | 'woche';
export const ARTEN: readonly Art[] = ['tag', 'woche'];

export interface DailyTask {
  art: Art;
  /** '2026-11-13' (Berlin day) or '2026-W46' (ISO week in Berlin). */
  zeitraum: string;
  level: string;
  pack: string;
  index: number;
  titel: string;
  seed: number;
}

export interface DailyStore {
  task(art: Art, zeitraum: string): Promise<DailyTask | null>;
  /** Stores the choice unless one is there already; returns the stored one. */
  saveTask(t: DailyTask): Promise<DailyTask>;
  /** Levels chosen (day or week) since then. */
  recentLevels(since: Date): Promise<Set<string>>;
  /** Levels with at least one leaderboard entry (proven solvable). */
  leaderboardLevels(): Promise<Set<string>>;
  /** Keeps the run if it beats the account's entry for the task. */
  submit(e: { art: Art; zeitraum: string; accountId: number; steps: number; recording: Recording; now: Date }): Promise<{ improved: boolean; steps: number }>;
  /** Best `limit` entries and the account's own; blocked accounts are left out. */
  ranking(art: Art, zeitraum: string, limit: number, accountId: number | null): Promise<{ total: number; entries: RankedEntry[] }>;
  /** Deletes tasks (and their runs) chosen before the date. */
  prune(before: Date): Promise<void>;
}

const MINUTE = 60_000;
const DAY = 86_400_000;
/** A run may arrive this long after its period ended (someone finishing at midnight). */
export const GRACE_MS = 15 * MINUTE;
/** A level is not picked again within this time. */
export const FREE_DAYS = 60;
/** Tasks and runs are kept this long. */
export const KEEP_DAYS = 400;
export const TOP_DAILY = 10;

// ---------- periods (Berlin time) ----------

const berlinParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function parts(t: number): { y: number; m: number; d: number; offset: number } {
  const p = Object.fromEntries(berlinParts.formatToParts(new Date(t)).map((x) => [x.type, Number(x.value)]));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return { y: p.year, m: p.month, d: p.day, offset: asUtc - Math.floor(t / 1000) * 1000 };
}

/** The instant of 0:00 Berlin time on that calendar day (month 1-based; overflowing days roll over). */
function berlinMidnight(y: number, m: number, d: number): Date {
  const local = Date.UTC(y, m - 1, d);
  let t = local - parts(local).offset;
  t = local - parts(t).offset; // the offset of the result itself (DST changes)
  return new Date(t);
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** The current day and ISO week in Berlin, each with its end. */
export function periods(now: Date): Record<Art, { zeitraum: string; bis: Date }> {
  const { y, m, d } = parts(now.getTime());
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = (date.getUTCDay() + 6) % 7; // Monday 0
  const thursday = new Date(date.getTime() + (3 - dow) * DAY);
  const isoYear = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(isoYear, 0, 1)) / (7 * DAY));
  return {
    tag: { zeitraum: `${y}-${pad(m)}-${pad(d)}`, bis: berlinMidnight(y, m, d + 1) },
    woche: { zeitraum: `${isoYear}-W${pad(week)}`, bis: berlinMidnight(y, m, d + 7 - dow) },
  };
}

/** The period is the current one, or ended at most GRACE_MS ago. */
export function isOpen(art: Art, zeitraum: string, now: Date): boolean {
  return periods(now)[art].zeitraum === zeitraum || periods(new Date(now.getTime() - GRACE_MS))[art].zeitraum === zeitraum;
}

// ---------- choice ----------

const hash32 = (text: string) => createHash('sha256').update(text).digest().readUInt32BE(0);

/** Start value of the task's run: the same for everyone. */
export const seedFor = (art: Art, zeitraum: string): number => hash32(`seed:${art}:${zeitraum}`);

/**
 * The level of a period: proven solvable and not recent, else probed and not recent, else probed.
 * `probeOk` null = no nightly run yet: every level counts as probed.
 */
export function pick(art: Art, zeitraum: string, catalog: CatalogEntry[], pool: { proven: Set<string>; probeOk: Set<string> | null; recent: Set<string> }): CatalogEntry {
  const probed = catalog.filter((e) => !pool.probeOk || pool.probeOk.has(e.id));
  const fresh = probed.filter((e) => !pool.recent.has(e.id));
  const proven = fresh.filter((e) => pool.proven.has(e.id));
  const from = proven.length ? proven : fresh.length ? fresh : probed.length ? probed : catalog;
  return from[hash32(`pick:${art}:${zeitraum}`) % from.length];
}

// ---------- routes ----------

export interface DailyOptions {
  store: DailyStore;
  checker: Checker;
  queue: CheckQueue;
  solvability?: SolvabilityStore;
  origin: string;
  now: () => Date;
}

export function dailyRoutes(app: FastifyInstance, opts: DailyOptions): void {
  const { store, checker, queue, solvability, origin, now } = opts;
  const perHour = new RateLimit(SUBMISSIONS_PER_HOUR, 60 * MINUTE);

  /** The stored task of the period, chosen now if there is none yet. */
  async function taskFor(art: Art, zeitraum: string): Promise<DailyTask> {
    const stored = await store.task(art, zeitraum);
    if (stored) return stored;
    const catalog = await checker.catalog!();
    const results = (await solvability?.latestResults()) ?? [];
    const probes = results.filter((r) => r.kind === 'probe');
    const proven = await store.leaderboardLevels();
    for (const r of results) if (r.kind === 'solution' && r.status === 'geloest') proven.add(r.level);
    const recent = await store.recentLevels(new Date(now().getTime() - FREE_DAYS * DAY));
    const e = pick(art, zeitraum, catalog, { proven, probeOk: probes.length ? new Set(probes.filter((r) => r.status === 'ok').map((r) => r.level)) : null, recent });
    await store.prune(new Date(now().getTime() - KEEP_DAYS * DAY));
    return store.saveTask({ art, zeitraum, level: e.id, pack: e.pack, index: e.index, titel: e.title, seed: seedFor(art, zeitraum) });
  }

  app.get('/api/tageslevel', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!checker.catalog || !checker.available()) return reply.code(503).send({ error: 'Tageslevel gerade nicht verfügbar.' });
    const p = periods(now());
    const me = req.account?.id ?? null;
    const out: Record<string, unknown> = {};
    for (const art of ARTEN) {
      const t = await taskFor(art, p[art].zeitraum);
      const { total, entries } = await store.ranking(art, t.zeitraum, TOP_DAILY, me);
      const own = entries.find((e) => e.accountId === me);
      out[art] = {
        ...t,
        bis: p[art].bis.toISOString(),
        anzahl: total,
        top: entries.filter((e) => e.rank <= TOP_DAILY).map((e) => ({ platz: e.rank, name: e.name, zeit: e.steps })),
        ich: own ? { platz: own.rank, zeit: own.steps } : null,
      };
    }
    return out;
  });

  app.post<{ Body: Record<string, unknown> }>('/api/tageslevel/lauf', { preHandler: requireAccount, bodyLimit: 2 * 1024 * 1024 }, async (req, reply) => {
    // CSRF: writes only from the game's own page (the cookie is SameSite=Strict as well)
    if (req.headers.origin !== undefined && req.headers.origin !== origin) return reply.code(403).send({ error: 'fremde Herkunft' });
    const art = req.body?.art;
    const zeitraum = req.body?.zeitraum;
    if (!ARTEN.includes(art as Art) || typeof zeitraum !== 'string' || zeitraum.length > 20) return reply.code(400).send({ error: 'Aufgabe unbekannt' });
    const rec = parseRun(req.body);
    if (typeof rec === 'string') return reply.code(400).send({ error: rec });
    const task = await store.task(art as Art, zeitraum);
    if (!task) return reply.code(404).send({ error: 'Diese Aufgabe gibt es nicht.' });
    if (!isOpen(task.art, zeitraum, now())) return reply.code(400).send({ error: 'Diese Aufgabe ist vorbei.' });
    if (rec.level !== task.level) return reply.code(400).send({ error: 'Der Lauf gehört zu einem anderen Level.' });
    if (rec.seed !== task.seed) return reply.code(400).send({ error: 'Der Lauf hat einen anderen Startwert als die Aufgabe.' });
    const a = req.account!;
    if (queue.open(a.id) >= OPEN_PER_ACCOUNT) return reply.code(429).send({ error: 'Es werden schon Läufe von dir geprüft. Bitte einen Moment warten.' });
    if (queue.open() >= QUEUE_MAX) return reply.code(503).send({ error: 'Gerade ist viel los. Bitte versuch es später noch einmal.' });
    if (a.role !== 'admin' && !perHour.take(String(a.id), now().getTime())) {
      return reply.code(429).send({ error: `Höchstens ${SUBMISSIONS_PER_HOUR} Läufe pro Stunde. Bitte versuch es später noch einmal.` });
    }
    const id = queue.add(a.id, async (): Promise<JobState> => {
      const r = await checker.check(rec);
      if (r.status !== 'geloest') {
        if (r.status === 'fehler' && /Zeitüberschreitung/.test(r.error ?? '')) return { status: 'abgelehnt', grund: 'Die Prüfung dauerte zu lange.' };
        return { status: 'abgelehnt', grund: r.status === 'fehler' ? 'Der Lauf ließ sich nicht nachspielen.' : 'Beim Nachspielen wurde das Level nicht gelöst.' };
      }
      const kept = await store.submit({ art: task.art, zeitraum, accountId: a.id, steps: r.steps, recording: rec, now: now() });
      const { total, entries } = await store.ranking(task.art, zeitraum, 0, a.id);
      const mine = entries.find((e) => e.accountId === a.id);
      return { status: 'angenommen', lauf: r.steps, zeit: kept.steps, neu: kept.improved, platz: mine?.rank ?? null, von: total };
    });
    return reply.code(202).send({ id });
  });
}
