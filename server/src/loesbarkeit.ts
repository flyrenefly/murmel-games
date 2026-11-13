import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from './konten.ts';
import { LEVEL_ID } from './stats.ts';

/**
 * Lösbarkeitsprüfung (docs/SPEC-loesbarkeit.md): solutions admins save after a win, the results of the
 * nightly run, the admin view's API, and the run itself (runNight) without the tools, so it is testable.
 */

export type CheckStatus = 'ok' | 'lua' | 'fehler' | 'geloest' | 'nicht-geloest';

/** One check of one night: the load probe of a level (ref '') or one solution ('repo:<file>', 'db:<id>'). */
export interface CheckResult {
  level: string;
  kind: 'probe' | 'solution';
  ref: string;
  status: CheckStatus;
  steps: number | null;
  recordedSteps: number | null;
  levelChanged: boolean;
  /** Was fine in the run before (or there was none) and is broken now. */
  isNew: boolean;
  error: string | null;
}

export interface RunCounts {
  levels: number;
  probeOk: number;
  probeLua: number;
  probeFailed: number;
  solutions: number;
  solved: number;
  unsolved: number;
  failed: number;
  solvedLevels: number;
  newFailures: number;
}

export interface RunSummary extends RunCounts {
  id: number;
  startedAt: string;
  finishedAt: string;
  version: string;
  error: string | null;
}

export interface StoredSolution {
  id: number;
  level: string;
  levelHash: string | null;
  steps: number;
  createdAt: string;
}

export interface SolvabilityStore {
  /** Saves a solution once per level and recording; `created` false = it was there already. */
  addSolution(s: { level: string; recordingHash: Buffer; recording: Recording; steps: number; accountId: number | null }): Promise<{ id: number; created: boolean }>;
  /** The recording of a stored solution. */
  recording(id: number): Promise<Recording | null>;
  deleteSolution(id: number): Promise<boolean>;
  /** All stored solutions (newest first); with the recordings for the nightly run. */
  solutions(): Promise<StoredSolution[]>;
  solutionsWithRecordings(): Promise<(StoredSolution & { recording: Recording })[]>;
  /** Binds solutions to the level content they were first checked with. */
  setLevelHash(id: number, hash: string): Promise<void>;
  /** Results of the newest run that finished without its own error. */
  latestResults(): Promise<CheckResult[]>;
  saveRun(run: { startedAt: Date; finishedAt: Date; version: string; error: string | null } & RunCounts, results: CheckResult[]): Promise<number>;
  /** Newest runs first. */
  runs(limit: number): Promise<RunSummary[]>;
  /** Results of a run that need a look: broken probes, solutions that do not win, changed levels. */
  problems(runId: number): Promise<CheckResult[]>;
  /** Results of one level over the newest runs. */
  levelHistory(level: string, limit: number): Promise<(CheckResult & { runId: number; finishedAt: string; version: string })[]>;
  /** Deletes runs that finished before the date (their results go with them). */
  prune(before: Date): Promise<void>;
}

// ---------- recordings ----------

/** A recording as stored (docs/SPEC-aufzeichnung.md, format 1), only the known fields. */
export interface Recording {
  v: 1;
  level: string;
  seed: number;
  dt: number;
  steps: number;
  result: 'sieg';
  input: unknown[];
  levelHash?: string;
}

/** Two hours of play at 400 physics steps per second. */
export const MAX_STEPS = 2 * 3600 * 400;
const MAX_ENTRIES = 300_000;
const PHYSICS_DT = 0.0025;
const levelPattern = new RegExp(LEVEL_ID);

/**
 * Checks the outer form of an uploaded win (untrusted JSON). Whether it really wins is decided by the
 * nightly replay – the API has no game code. Returns the recording or a message for the admin.
 */
export function parseRecording(body: unknown): Recording | string {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.v !== 1) return 'unbekanntes Aufzeichnungsformat';
  if (typeof b.level !== 'string' || !levelPattern.test(b.level)) return 'Level-Kennung fehlt oder ist ungültig';
  if (typeof b.seed !== 'number' || !Number.isInteger(b.seed) || b.seed < 0 || b.seed >= 2 ** 32) return 'Startwert ungültig';
  if (b.dt !== PHYSICS_DT) return 'anderer Physiktakt';
  if (typeof b.steps !== 'number' || !Number.isInteger(b.steps) || b.steps < 1 || b.steps > MAX_STEPS) return 'Schrittzahl ungültig';
  if (b.result !== 'sieg') return 'nur gewonnene Läufe sind Lösungen';
  if (!Array.isArray(b.input) || b.input.length === 0 || b.input.length > MAX_ENTRIES) return 'Eingaben fehlen oder sind zu viele';
  for (const e of b.input) {
    if (!Array.isArray(e) || e.length < 2 || e.length > 5 || !e.every((x) => typeof x === 'string' || Number.isInteger(x))) return 'Eingaben ungültig';
  }
  return { v: 1, level: b.level, seed: b.seed, dt: PHYSICS_DT, steps: b.steps, result: 'sieg', input: b.input };
}

export function recordingHash(r: Recording): Buffer {
  const { level, seed, dt, steps, input } = r;
  return createHash('sha256').update(JSON.stringify({ level, seed, dt, steps, input })).digest();
}

// ---------- the nightly run ----------

/** What the tools report (tools/check-load.mjs and tools/check-solutions.mjs, --json). */
export interface ToolOutput {
  probes: { level: string; status: 'ok' | 'lua' | 'fehler'; steps?: number; error?: string }[];
  solutions: {
    /** 'repo:<file>' or 'db:<id>' */
    ref: string;
    level: string | null;
    status: 'geloest' | 'nicht-geloest' | 'fehler';
    steps?: number;
    recordedSteps?: number | null;
    levelHash?: string;
    levelChanged?: boolean;
    error?: string;
    luaError?: string;
  }[];
}

const key = (r: Pick<CheckResult, 'kind' | 'level' | 'ref'>) => `${r.kind}\n${r.level}\n${r.ref}`;
const broken = (r: Pick<CheckResult, 'kind' | 'status'>) => (r.kind === 'probe' ? r.status === 'fehler' : r.status !== 'geloest');

/** Marks results that are broken now but were not in the run before (a missing earlier result counts as fine). */
export function markNew(before: CheckResult[], now: CheckResult[]): CheckResult[] {
  const prev = new Map(before.map((r) => [key(r), r]));
  return now.map((r) => {
    const p = prev.get(key(r));
    return { ...r, isNew: broken(r) && !(p && broken(p)) };
  });
}

export function toResults(out: ToolOutput): CheckResult[] {
  const text = (s: string | undefined) => (s ? s.slice(0, 500) : null);
  return [
    ...out.probes.map((p): CheckResult => ({
      level: p.level, kind: 'probe', ref: '', status: p.status, steps: p.steps ?? null, recordedSteps: null, levelChanged: false, isNew: false, error: text(p.error),
    })),
    ...out.solutions.map((s): CheckResult => ({
      level: s.level ?? '?', kind: 'solution', ref: s.ref, status: s.status, steps: s.steps ?? null, recordedSteps: s.recordedSteps ?? null,
      levelChanged: s.levelChanged === true, isNew: false, error: text(s.error ?? (s.luaError ? `Lua: ${s.luaError}` : undefined)),
    })),
  ];
}

export function countResults(results: CheckResult[]): RunCounts {
  const n = (kind: CheckResult['kind'], status: CheckStatus) => results.filter((r) => r.kind === kind && r.status === status).length;
  const sol = results.filter((r) => r.kind === 'solution');
  return {
    levels: results.filter((r) => r.kind === 'probe').length,
    probeOk: n('probe', 'ok'),
    probeLua: n('probe', 'lua'),
    probeFailed: n('probe', 'fehler'),
    solutions: sol.length,
    solved: n('solution', 'geloest'),
    unsolved: n('solution', 'nicht-geloest'),
    failed: n('solution', 'fehler'),
    solvedLevels: new Set(sol.filter((r) => r.status === 'geloest').map((r) => r.level)).size,
    newFailures: results.filter((r) => r.isNew).length,
  };
}

const ADMIN_PAGE = '/loesbarkeit.html';

export function failureMail(origin: string, version: string, counts: RunCounts, fresh: CheckResult[]): { subject: string; text: string } {
  const label = { ok: 'ok', lua: 'Lua-Fehler', fehler: 'Fehler', geloest: 'gelöst', 'nicht-geloest': 'nicht mehr gelöst' } as const;
  const lines = fresh.slice(0, 50).map((r) => {
    const what = r.kind === 'probe' ? 'Ladeprobe' : `Lösung ${r.ref}`;
    return `- ${r.level}: ${what} – ${label[r.status]}${r.levelChanged ? ' (Level geändert)' : ''}${r.error ? `: ${r.error}` : ''}`;
  });
  if (fresh.length > 50) lines.push(`… und ${fresh.length - 50} weitere`);
  return {
    subject: `Murmel: ${fresh.length} ${fresh.length === 1 ? 'Level' : 'Levels'} neu kaputt (Lösbarkeitsprüfung)`,
    text: [
      `Die nächtliche Lösbarkeitsprüfung (Stand ${version}) meldet neue Fehlschläge:`,
      '',
      ...lines,
      '',
      `Gesamt: ${counts.levels} Levels, Ladeprobe ${counts.probeFailed} Fehler; ${counts.solutions} Lösungen, ${counts.solved} gelöst, ${counts.unsolved} nicht gelöst, ${counts.failed} Fehler.`,
      `Übersicht: ${origin}${ADMIN_PAGE}`,
      '',
      'Diese Mail kommt nur, wenn etwas neu kaputt ist.',
    ].join('\n'),
  };
}

export interface NightOptions {
  store: SolvabilityStore;
  version: string;
  /** Runs the tools on the repository solutions plus the given stored ones. */
  check(stored: (StoredSolution & { recording: Recording })[]): Promise<ToolOutput>;
  mailer: { send(to: string, subject: string, text: string): Promise<void> } | null;
  admins: string[];
  origin: string;
  now?: () => Date;
  log?: (msg: string) => void;
  /** Days a run is kept. */
  keepDays?: number;
}

/** One nightly run: check, compare with the run before, store, mail the admins about what broke. */
export async function runNight(o: NightOptions): Promise<{ runId: number; counts: RunCounts; fresh: CheckResult[] }> {
  const now = o.now ?? (() => new Date());
  const log = o.log ?? (() => {});
  const startedAt = now();
  const stored = await o.store.solutionsWithRecordings();
  let results: CheckResult[] = [];
  let error: string | null = null;
  try {
    const out = await o.check(stored);
    results = markNew(await o.store.latestResults(), toResults(out));
    // stored solutions without a level hash are bound to the level as it is now
    for (const s of out.solutions) {
      const id = /^db:(\d+)$/.exec(s.ref)?.[1];
      const sol = id && stored.find((x) => x.id === Number(id));
      if (sol && !sol.levelHash && s.levelHash) await o.store.setLevelHash(sol.id, s.levelHash);
    }
  } catch (e) {
    error = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
    log(`Lauf gescheitert: ${error}`);
  }
  const counts = countResults(results);
  const runId = await o.store.saveRun({ startedAt, finishedAt: now(), version: o.version, error, ...counts }, results);
  await o.store.prune(new Date(now().getTime() - (o.keepDays ?? 90) * 86_400_000));
  const fresh = results.filter((r) => r.isNew);
  log(`Lauf ${runId}: ${counts.levels} Levels, ${counts.solutions} Lösungen, ${counts.solved} gelöst, ${fresh.length} neu kaputt`);
  const mail = fresh.length ? failureMail(o.origin, o.version, counts, fresh) : error ? { subject: 'Murmel: Lösbarkeitsprüfung gescheitert', text: `Der Nachtlauf (Stand ${o.version}) ist gescheitert:\n\n${error}\n\n${o.origin}${ADMIN_PAGE}` } : null;
  if (mail && o.mailer) {
    for (const to of o.admins) {
      try {
        await o.mailer.send(to, mail.subject, mail.text);
      } catch (e) {
        log(`Mail an Admin gescheitert: ${e instanceof Error ? e.message : e}`);
      }
    }
  } else if (mail) log('Keine Mail: SMTP oder ADMIN_EMAILS fehlen');
  return { runId, counts, fresh };
}

// ---------- admin API ----------

const ID = '^[1-9][0-9]{0,15}$';

/** /api/admin/loesungen (save, list, download, delete) and /api/admin/loesbarkeit (results). */
export function solvabilityRoutes(app: FastifyInstance, store: SolvabilityStore): void {
  // A won run; its size grows with play time and mouse movement (one entry per changed step).
  app.post('/api/admin/loesungen', { preHandler: requireAdmin, bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const rec = parseRecording(req.body);
    if (typeof rec === 'string') return reply.code(400).send({ error: rec });
    const { id, created } = await store.addSolution({ level: rec.level, recordingHash: recordingHash(rec), recording: rec, steps: rec.steps, accountId: req.account!.id });
    return reply.code(created ? 201 : 200).send({ id, neu: created });
  });

  app.get('/api/admin/loesungen', { preHandler: requireAdmin }, async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { loesungen: await store.solutions() };
  });

  // Download: the file goes into the repository as solutions/<pack>/<name>.json (tools/lib/solutions.mjs).
  app.get<{ Params: { id: string } }>('/api/admin/loesungen/:id', { preHandler: requireAdmin, schema: { params: { type: 'object', properties: { id: { type: 'string', pattern: ID } } } } }, async (req, reply) => {
    const rec = await store.recording(Number(req.params.id));
    if (!rec) return reply.code(404).send({ error: 'nicht gefunden' });
    const name = `${rec.level.split(/[:/]/).at(-1)!.replace(/[^\w.-]/g, '_')}.json`;
    reply.header('Cache-Control', 'no-store').header('Content-Disposition', `attachment; filename="${name}"`);
    return rec;
  });

  app.delete<{ Params: { id: string } }>('/api/admin/loesungen/:id', { preHandler: requireAdmin, schema: { params: { type: 'object', properties: { id: { type: 'string', pattern: ID } } } } }, async (req, reply) => {
    return (await store.deleteSolution(Number(req.params.id))) ? { ok: true } : reply.code(404).send({ error: 'nicht gefunden' });
  });

  app.get('/api/admin/loesbarkeit', { preHandler: requireAdmin }, async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const runs = await store.runs(30);
    const latest = runs[0] ?? null;
    return { lauf: latest, verlauf: runs, probleme: latest ? await store.problems(latest.id) : [], loesungen: (await store.solutions()).length };
  });

  app.get<{ Querystring: { id?: string } }>('/api/admin/loesbarkeit/level', { preHandler: requireAdmin }, async (req, reply) => {
    const id = req.query.id;
    if (typeof id !== 'string' || !levelPattern.test(id)) return reply.code(400).send({ error: 'Level-Kennung fehlt' });
    reply.header('Cache-Control', 'no-store');
    return { level: id, verlauf: await store.levelHistory(id, 30), loesungen: (await store.solutions()).filter((s) => s.level === id) };
  });
}
