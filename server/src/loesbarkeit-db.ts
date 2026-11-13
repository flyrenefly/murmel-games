import type { Sql } from 'postgres';
import type { CheckResult, Recording, RunSummary, SolvabilityStore, StoredSolution } from './loesbarkeit.ts';

/** SolvabilityStore in PostgreSQL (migrations/005_loesbarkeit.sql). */
export function solvabilityStore(sql: Sql): SolvabilityStore {
  const solutionCols = sql`id::int as id, level, level_hash as "levelHash", steps, created_at as "createdAt"`;
  const resultCols = sql`level, kind, ref, status, steps, recorded_steps as "recordedSteps", level_changed as "levelChanged", is_new as "isNew", error`;
  const runCols = sql`id::int as id, started_at as "startedAt", finished_at as "finishedAt", version, levels, probe_ok as "probeOk",
    probe_lua as "probeLua", probe_failed as "probeFailed", solutions, solved, unsolved, failed, solved_levels as "solvedLevels",
    new_failures as "newFailures", error`;
  const iso = <T extends { createdAt?: unknown; startedAt?: unknown; finishedAt?: unknown }>(row: T): T => {
    const out = { ...row } as Record<string, unknown>;
    for (const k of ['createdAt', 'startedAt', 'finishedAt']) if (out[k] instanceof Date) out[k] = (out[k] as Date).toISOString();
    return out as T;
  };

  return {
    async addSolution({ level, recordingHash, recording, steps, accountId }) {
      const [row] = await sql<{ id: number }[]>`
        insert into solutions (level, recording_hash, recording, steps, account_id)
        values (${level}, ${recordingHash}, ${sql.json(recording as never)}, ${steps}, ${accountId})
        on conflict (level, recording_hash) do nothing returning id::int as id`;
      if (row) return { id: row.id, created: true };
      const [old] = await sql<{ id: number }[]>`select id::int as id from solutions where level = ${level} and recording_hash = ${recordingHash}`;
      return { id: old.id, created: false };
    },
    async recording(id) {
      const [row] = await sql<{ recording: Recording }[]>`select recording from solutions where id = ${id}`;
      return row?.recording ?? null;
    },
    async deleteSolution(id) {
      return (await sql`delete from solutions where id = ${id}`).count > 0;
    },
    async solutions() {
      return (await sql<StoredSolution[]>`select ${solutionCols} from solutions order by id desc`).map(iso);
    },
    async solutionsWithRecordings() {
      return (await sql<(StoredSolution & { recording: Recording })[]>`select ${solutionCols}, recording from solutions order by id desc`).map(iso);
    },
    async levelSolutions(level, limit) {
      return (await sql<{ recording: Recording }[]>`select recording from solutions where level = ${level} order by steps, id limit ${limit}`).map((r) => r.recording);
    },
    async setLevelHash(id, hash) {
      await sql`update solutions set level_hash = ${hash} where id = ${id} and level_hash is null`;
    },
    async latestResults() {
      return [...(await sql<CheckResult[]>`
        select ${resultCols} from solvability_results
        where run_id = (select id from solvability_runs where error is null order by id desc limit 1)`)];
    },
    async saveRun(run, results) {
      return sql.begin(async (tx) => {
        const [{ id }] = await tx<{ id: number }[]>`
          insert into solvability_runs (started_at, finished_at, version, levels, probe_ok, probe_lua, probe_failed, solutions,
            solved, unsolved, failed, solved_levels, new_failures, error)
          values (${run.startedAt}, ${run.finishedAt}, ${run.version}, ${run.levels}, ${run.probeOk}, ${run.probeLua}, ${run.probeFailed},
            ${run.solutions}, ${run.solved}, ${run.unsolved}, ${run.failed}, ${run.solvedLevels}, ${run.newFailures}, ${run.error})
          returning id::int as id`;
        // in chunks: ~1200 probes plus the solutions each night
        for (let i = 0; i < results.length; i += 500) {
          const rows = results.slice(i, i + 500).map((r) => ({
            run_id: id, level: r.level, kind: r.kind, ref: r.ref, status: r.status, steps: r.steps, recorded_steps: r.recordedSteps,
            level_changed: r.levelChanged, is_new: r.isNew, error: r.error,
          }));
          await tx`insert into solvability_results ${tx(rows)}`;
        }
        return id;
      });
    },
    async runs(limit) {
      return (await sql<RunSummary[]>`select ${runCols} from solvability_runs order by id desc limit ${limit}`).map(iso);
    },
    async problems(runId) {
      return [...(await sql<CheckResult[]>`
        select ${resultCols} from solvability_results
        where run_id = ${runId} and (status in ('fehler', 'lua', 'nicht-geloest') or level_changed)
        order by is_new desc, level, kind, ref`)];
    },
    async levelHistory(level, limit) {
      return (await sql<(CheckResult & { runId: number; finishedAt: string; version: string })[]>`
        select s.level, s.kind, s.ref, s.status, s.steps, s.recorded_steps as "recordedSteps", s.level_changed as "levelChanged",
          s.is_new as "isNew", s.error, r.id::int as "runId", r.finished_at as "finishedAt", r.version
        from solvability_results s join solvability_runs r on r.id = s.run_id
        where s.level = ${level} and r.id in (select id from solvability_runs order by id desc limit ${limit})
        order by r.id desc, s.kind, s.ref`).map(iso);
    },
    async prune(before) {
      await sql`delete from solvability_runs where finished_at < ${before}`;
    },
  };
}
