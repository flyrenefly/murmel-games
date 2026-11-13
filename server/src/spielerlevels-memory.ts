import type { AccountStore } from './konten.ts';
import type { Recording } from './loesbarkeit.ts';
import type { LevelStatus, PlayerLevel, PlayerLevelStore, ReportedLevel } from './spielerlevels.ts';

interface Row {
  id: number;
  accountId: number;
  title: string;
  description: string;
  file: Record<string, unknown>;
  levelHash: string;
  recording: Recording;
  steps: number;
  status: LevelStatus;
  reason: string | null;
  replaces: number | null;
  createdAt: Date;
  publishedAt: Date | null;
  notifiedAt: Date | null;
}

/**
 * PlayerLevelStore in memory, for tests without PostgreSQL. Display names come from `names`, the
 * blocked flag from the account store, "solved" from `solved` (the leaderboard) – like the joins in
 * src/spielerlevels-db.ts.
 */
export function memoryPlayerLevelStore(
  accounts: AccountStore,
  names: Map<number, string> = new Map(),
  solved: (accountId: number, level: string) => Promise<boolean> = async () => false,
): PlayerLevelStore & { rows: Row[] } {
  const rows: Row[] = [];
  const ratings = new Map<string, number>();
  const reports = new Map<string, { levelId: number; reason: string; dismissed: boolean }>();
  let nextId = 1;
  let lastMail: Date | null = null;

  const votes = (id: number) => [...ratings].filter(([k]) => k.startsWith(`${id}:`)).map(([, v]) => v);
  const open = (id: number) => [...reports.values()].filter((r) => r.levelId === id && !r.dismissed);
  async function view(r: Row, withFile = false): Promise<PlayerLevel> {
    const v = votes(r.id);
    const map = r.file.map as string[];
    return {
      id: r.id,
      accountId: r.accountId,
      author: names.get(r.accountId) ?? null,
      authorBlocked: (await accounts.account(r.accountId))?.blocked ?? false,
      title: r.title,
      description: r.description,
      ...(withFile ? { file: structuredClone(r.file) } : {}),
      width: Math.max(...map.map((s) => s.length)),
      height: map.length,
      steps: r.steps,
      status: r.status,
      reason: r.reason,
      replaces: r.replaces,
      createdAt: r.createdAt,
      publishedAt: r.publishedAt,
      stars: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null,
      votes: v.length,
      reports: open(r.id).length,
    };
  }
  const score = (l: PlayerLevel) => ((l.stars ?? 0) * l.votes + 9) / (l.votes + 3);

  return {
    rows,
    async displayName(accountId) {
      return names.get(accountId) ?? null;
    },
    async countUploads(accountId, since) {
      return rows.filter((r) => r.accountId === accountId && r.createdAt >= since).length;
    },
    async countWaiting(accountId) {
      return rows.filter((r) => r.accountId === accountId && r.status === 'wartet').length;
    },
    async create(l) {
      const replaces = l.replaces !== null && rows.some((r) => r.id === l.replaces && r.accountId === l.accountId) ? l.replaces : null;
      const id = nextId++;
      rows.push({ id, accountId: l.accountId, title: l.title, description: l.description, file: structuredClone(l.file), levelHash: l.levelHash, recording: l.recording, steps: l.steps, status: 'wartet', reason: null, replaces, createdAt: l.now, publishedAt: null, notifiedAt: null });
      return id;
    },
    async level(id) {
      const r = rows.find((x) => x.id === id);
      return r ? view(r, true) : null;
    },
    async list(f) {
      const q = f.search.toLowerCase();
      const out: PlayerLevel[] = [];
      for (const r of rows) {
        if (r.status !== 'frei') continue;
        const l = await view(r);
        if (l.reports > 0 || l.authorBlocked) continue;
        if (q && ![l.title, l.description, l.author ?? ''].some((t) => t.toLowerCase().includes(q))) continue;
        out.push(l);
      }
      const newest = (a: PlayerLevel, b: PlayerLevel) => b.publishedAt!.getTime() - a.publishedAt!.getTime() || b.id - a.id;
      out.sort(f.sort === 'beliebt' ? (a, b) => score(b) - score(a) || b.votes - a.votes || newest(a, b) : newest);
      return out.slice(f.offset, f.offset + f.limit);
    },
    async mine(accountId) {
      const own = rows.filter((r) => r.accountId === accountId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);
      return Promise.all(own.map((r) => view(r)));
    },
    async pending() {
      const out: ReportedLevel[] = [];
      for (const r of rows) {
        const reasons = open(r.id).map((x) => x.reason);
        if (r.status === 'wartet' || reasons.length) out.push({ ...(await view(r)), reasons });
      }
      return out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
    },
    async setStatus(id, status, reason, now, review) {
      const r = rows.find((x) => x.id === id);
      if (!r) return;
      r.status = status;
      r.reason = reason;
      if (status === 'frei') {
        r.publishedAt ??= now;
        const old = rows.find((x) => x.id === r.replaces && x.accountId === r.accountId);
        if (old && old.status !== 'abgelehnt') old.status = 'ersetzt';
      }
      if (status === 'wartet') r.notifiedAt = null;
      if (review) for (const x of open(id)) x.dismissed = true;
    },
    async remove(id) {
      const i = rows.findIndex((x) => x.id === id);
      if (i < 0) return false;
      rows.splice(i, 1);
      for (const r of rows) if (r.replaces === id) r.replaces = null;
      for (const k of [...ratings.keys()]) if (k.startsWith(`${id}:`)) ratings.delete(k);
      for (const [k, v] of [...reports]) if (v.levelId === id) reports.delete(k);
      return true;
    },
    async solved(accountId, levelId) {
      return solved(accountId, `spieler:${levelId}`);
    },
    async rate(levelId, accountId, stars) {
      ratings.set(`${levelId}:${accountId}`, stars);
      const v = votes(levelId);
      return { stars: v.reduce((a, b) => a + b, 0) / v.length, votes: v.length };
    },
    async rating(levelId, accountId) {
      return ratings.get(`${levelId}:${accountId}`) ?? null;
    },
    async report(levelId, accountId, reason) {
      const k = `${levelId}:${accountId}`;
      if (reports.has(k)) return false;
      reports.set(k, { levelId, reason, dismissed: false });
      return true;
    },
    async dismissReports(levelId) {
      for (const x of open(levelId)) x.dismissed = true;
    },
    async unnotified() {
      return rows.filter((r) => r.status === 'wartet' && !r.notifiedAt).map((r) => ({ id: r.id, title: r.title, author: names.get(r.accountId) ?? null }));
    },
    async lastNotified() {
      return lastMail;
    },
    async markNotified(ids, now) {
      for (const r of rows) if (ids.includes(r.id)) r.notifiedAt = now;
      lastMail = now;
    },
  };
}
