import type { LeaderboardStore, RankedEntry } from './bestenliste.ts';
import type { AccountStore } from './konten.ts';
import type { Recording } from './loesbarkeit.ts';

interface Row {
  id: number;
  accountId: number;
  level: string;
  steps: number;
  createdAt: Date;
  recording: Recording;
}

/**
 * LeaderboardStore in memory, for tests without PostgreSQL. Display names come from `names`, the
 * blocked flag from the account store – like the join in src/bestenliste-db.ts.
 */
export function memoryLeaderboardStore(accounts: AccountStore, names: Map<number, string> = new Map()): LeaderboardStore & { rows: Row[] } {
  const rows: Row[] = [];
  let nextId = 1;
  const order = (a: Row, b: Row) => a.steps - b.steps || a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id;
  const visible = async (level: string) => {
    const out: Row[] = [];
    for (const r of rows) if (r.level === level && !(await accounts.account(r.accountId))?.blocked) out.push(r);
    return out.sort(order);
  };

  return {
    rows,
    async submit({ accountId, level, steps, recording, now }) {
      const cur = rows.find((r) => r.accountId === accountId && r.level === level);
      if (!cur) {
        rows.push({ id: nextId++, accountId, level, steps, createdAt: now, recording });
        return { improved: true, steps };
      }
      if (steps >= cur.steps) return { improved: false, steps: cur.steps };
      Object.assign(cur, { steps, createdAt: now, recording });
      return { improved: true, steps };
    },
    async ranking(level, limit, accountId) {
      const list = await visible(level);
      const entries: RankedEntry[] = list
        .map((r, i) => ({ id: r.id, accountId: r.accountId, name: names.get(r.accountId) ?? null, steps: r.steps, createdAt: r.createdAt, rank: i + 1 }))
        .filter((e) => e.rank <= limit || e.accountId === accountId);
      return { total: list.length, entries };
    },
    async mine(accountId) {
      const out = [];
      for (const r of rows.filter((x) => x.accountId === accountId)) {
        const list = await visible(r.level);
        const rank = list.indexOf(r) + 1;
        if (rank > 0) out.push({ level: r.level, steps: r.steps, rank });
      }
      return out.sort((a, b) => a.level.localeCompare(b.level));
    },
    async entry(id) {
      const r = rows.find((x) => x.id === id);
      return r ? { id: r.id, accountId: r.accountId, level: r.level } : null;
    },
    async remove(id) {
      const i = rows.findIndex((x) => x.id === id);
      if (i < 0) return false;
      rows.splice(i, 1);
      return true;
    },
  };
}
