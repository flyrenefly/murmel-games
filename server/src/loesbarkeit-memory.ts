import type { CheckResult, Recording, RunSummary, SolvabilityStore, StoredSolution } from './loesbarkeit.ts';

/** Results the admin view lists first: broken, Lua errors, not winning, or the level changed. */
export const isProblem = (r: CheckResult) => r.status === 'fehler' || r.status === 'lua' || r.status === 'nicht-geloest' || r.levelChanged;

/** SolvabilityStore in memory, for tests; loesbarkeit.test.ts runs the same checks against PostgreSQL. */
export function memorySolvabilityStore(): SolvabilityStore {
  const solutions: (StoredSolution & { recording: Recording; hash: string; accountId: number | null })[] = [];
  const runs: RunSummary[] = [];
  const results = new Map<number, CheckResult[]>();
  let nextSolution = 1;
  let nextRun = 1;
  const pub = ({ recording: _r, hash: _h, accountId: _a, ...s }: (typeof solutions)[number]): StoredSolution => ({ ...s });
  const order = (a: CheckResult, b: CheckResult) => Number(b.isNew) - Number(a.isNew) || a.level.localeCompare(b.level) || a.kind.localeCompare(b.kind) || a.ref.localeCompare(b.ref);

  return {
    async addSolution({ level, recordingHash, recording, steps, accountId }) {
      const hash = recordingHash.toString('hex');
      const old = solutions.find((s) => s.level === level && s.hash === hash);
      if (old) return { id: old.id, created: false };
      const id = nextSolution++;
      solutions.push({ id, level, levelHash: null, steps, createdAt: new Date().toISOString(), recording, hash, accountId });
      return { id, created: true };
    },
    async recording(id) {
      return solutions.find((s) => s.id === id)?.recording ?? null;
    },
    async deleteSolution(id) {
      const i = solutions.findIndex((s) => s.id === id);
      if (i < 0) return false;
      solutions.splice(i, 1);
      return true;
    },
    async solutions() {
      return solutions.map(pub).reverse();
    },
    async solutionsWithRecordings() {
      return solutions.map((s) => ({ ...pub(s), recording: s.recording })).reverse();
    },
    async setLevelHash(id, hash) {
      const s = solutions.find((x) => x.id === id);
      if (s) s.levelHash = hash;
    },
    async latestResults() {
      const run = runs.find((r) => !r.error);
      return run ? (results.get(run.id) ?? []) : [];
    },
    async saveRun({ startedAt, finishedAt, ...rest }, list) {
      const id = nextRun++;
      runs.unshift({ id, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), ...rest });
      results.set(id, list.map((r) => ({ ...r })));
      return id;
    },
    async runs(limit) {
      return runs.slice(0, limit);
    },
    async problems(runId) {
      return (results.get(runId) ?? []).filter(isProblem).sort(order);
    },
    async levelHistory(level, limit) {
      return runs.slice(0, limit).flatMap((run) =>
        (results.get(run.id) ?? []).filter((r) => r.level === level).map((r) => ({ ...r, runId: run.id, finishedAt: run.finishedAt, version: run.version })),
      );
    },
    async prune(before) {
      for (let i = runs.length - 1; i >= 0; i--) {
        if (new Date(runs[i].finishedAt) < before) {
          results.delete(runs[i].id);
          runs.splice(i, 1);
        }
      }
    },
  };
}
