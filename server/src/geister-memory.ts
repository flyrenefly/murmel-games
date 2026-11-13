import type { memoryLeaderboardStore } from './bestenliste-memory.ts';
import type { GhostStore } from './geister.ts';

/** GhostStore in memory, for tests without PostgreSQL; the runs come from the memory leaderboard. */
export function memoryGhostStore(board: ReturnType<typeof memoryLeaderboardStore>): GhostStore {
  const on = new Set<number>();
  return {
    async consent(accountId) {
      return on.has(accountId);
    },
    async setConsent(accountId, value) {
      if (value) on.add(accountId);
      else on.delete(accountId);
    },
    async consenting(ids) {
      return new Set(ids.filter((id) => on.has(id)));
    },
    async run(entryId) {
      const r = board.rows.find((x) => x.id === entryId);
      return r ? { accountId: r.accountId, level: r.level, recording: r.recording } : null;
    },
  };
}
