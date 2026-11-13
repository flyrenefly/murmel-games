import type { RankedEntry } from './bestenliste.ts';
import type { memoryLeaderboardStore } from './bestenliste-memory.ts';
import type { AccountStore } from './konten.ts';
import type { Recording } from './loesbarkeit.ts';
import type { Art, DailyStore, DailyTask } from './tageslevel.ts';

interface Run {
  id: number;
  art: Art;
  zeitraum: string;
  accountId: number;
  steps: number;
  createdAt: Date;
  recording: Recording;
}

/** DailyStore in memory, for tests without PostgreSQL; names and blocked flags like the SQL join. */
export function memoryDailyStore(accounts: AccountStore, names: Map<number, string>, board: ReturnType<typeof memoryLeaderboardStore>): DailyStore {
  const tasks: (DailyTask & { createdAt: Date })[] = [];
  let runs: Run[] = [];
  let nextId = 1;
  const order = (a: Run, b: Run) => a.steps - b.steps || a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id;
  const strip = ({ createdAt: _c, ...t }: DailyTask & { createdAt: Date }): DailyTask => t;

  return {
    async task(art, zeitraum) {
      const t = tasks.find((x) => x.art === art && x.zeitraum === zeitraum);
      return t ? strip(t) : null;
    },
    async saveTask(t) {
      const cur = tasks.find((x) => x.art === t.art && x.zeitraum === t.zeitraum);
      if (cur) return strip(cur);
      tasks.push({ ...t, createdAt: new Date() });
      return t;
    },
    async recentLevels(since) {
      return new Set(tasks.filter((t) => t.createdAt >= since).map((t) => t.level));
    },
    async leaderboardLevels() {
      return new Set(board.rows.map((r) => r.level));
    },
    async submit({ art, zeitraum, accountId, steps, recording, now }) {
      const cur = runs.find((r) => r.art === art && r.zeitraum === zeitraum && r.accountId === accountId);
      if (!cur) {
        runs.push({ id: nextId++, art, zeitraum, accountId, steps, createdAt: now, recording });
        return { improved: true, steps };
      }
      if (steps >= cur.steps) return { improved: false, steps: cur.steps };
      Object.assign(cur, { steps, createdAt: now, recording });
      return { improved: true, steps };
    },
    async ranking(art, zeitraum, limit, accountId) {
      const list: Run[] = [];
      for (const r of runs) if (r.art === art && r.zeitraum === zeitraum && !(await accounts.account(r.accountId))?.blocked) list.push(r);
      list.sort(order);
      const entries: RankedEntry[] = list
        .map((r, i) => ({ id: r.id, accountId: r.accountId, name: names.get(r.accountId) ?? null, steps: r.steps, createdAt: r.createdAt, rank: i + 1 }))
        .filter((e) => e.rank <= limit || e.accountId === accountId);
      return { total: list.length, entries };
    },
    async prune(before) {
      const gone = tasks.filter((t) => t.createdAt < before);
      for (const t of gone) {
        tasks.splice(tasks.indexOf(t), 1);
        runs = runs.filter((r) => !(r.art === t.art && r.zeitraum === t.zeitraum));
      }
    },
  };
}
