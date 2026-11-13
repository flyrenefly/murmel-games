import type { ForumStore, Post, ReportedPost, Topic } from './forum.ts';

/**
 * ForumStore in memory, for tests without PostgreSQL. forum.test.ts runs the same flows against this
 * and, with TEST_DATABASE_URL, against the real store (src/forum-db.ts).
 */
export function memoryForumStore(): ForumStore {
  const names = new Map<number, string>();
  type T = Omit<Topic, 'author' | 'team' | 'replies' | 'votes' | 'hidden'>;
  type P = Omit<Post, 'author'> & { hiddenAt: Date | null };
  const topics = new Map<number, T>();
  const posts = new Map<number, P>();
  const votes = new Set<string>();
  const reports = new Map<string, { postId: number; reason: string }>();
  let nextTopic = 1;
  let nextPost = 1;

  const postOut = (p: P): Post => ({ id: p.id, topicId: p.topicId, accountId: p.accountId, author: names.get(p.accountId) ?? '', team: p.team, first: p.first, body: p.body, hidden: p.hidden, createdAt: p.createdAt });
  const postsOf = (topicId: number) => [...posts.values()].filter((p) => p.topicId === topicId).sort((a, b) => a.id - b.id);
  const topicOut = (t: T): Topic => {
    const ps = postsOf(t.id);
    const first = ps.find((p) => p.first)!;
    return {
      ...t,
      author: names.get(t.accountId) ?? '',
      team: first.team,
      replies: ps.length - 1,
      votes: [...votes].filter((v) => v.startsWith(`${t.id}:`)).length,
      hidden: first.hidden,
    };
  };

  return {
    async displayName(accountId) {
      return names.get(accountId) ?? null;
    },
    async setDisplayName(accountId, name) {
      for (const [a, n] of names) if (a !== accountId && n.toLowerCase() === name.toLowerCase()) return false;
      names.set(accountId, name);
      return true;
    },
    async topics(f) {
      const list = [...topics.values()]
        .map(topicOut)
        .filter((t) => (!f.category || t.category === f.category) && (!f.status || t.status === f.status) && (f.withHidden || !t.hidden))
        .sort((a, b) => (f.sort === 'stimmen' ? b.votes - a.votes : 0) || b.lastPostAt.getTime() - a.lastPostAt.getTime() || b.id - a.id);
      return list.slice(f.offset, f.offset + f.limit);
    },
    async topic(id) {
      const t = topics.get(id);
      return t ? topicOut(t) : null;
    },
    async posts(topicId) {
      return postsOf(topicId).map(postOut);
    },
    async post(id) {
      const p = posts.get(id);
      return p ? postOut(p) : null;
    },
    async addTopic(t) {
      const id = nextTopic++;
      topics.set(id, { id, accountId: t.accountId, category: t.category, status: 'offen', title: t.title, level: t.level, version: t.version, createdAt: t.now, lastPostAt: t.now });
      const pid = nextPost++;
      posts.set(pid, { id: pid, topicId: id, accountId: t.accountId, team: t.team, first: true, body: t.body, hidden: false, hiddenAt: null, createdAt: t.now });
      return id;
    },
    async addPost(p) {
      const id = nextPost++;
      posts.set(id, { id, topicId: p.topicId, accountId: p.accountId, team: p.team, first: false, body: p.body, hidden: false, hiddenAt: null, createdAt: p.now });
      const t = topics.get(p.topicId);
      if (t) t.lastPostAt = p.now;
      return id;
    },
    async countPosts(accountId, since) {
      return [...posts.values()].filter((p) => p.accountId === accountId && p.createdAt >= since).length;
    },
    async countTopics(accountId, since) {
      return [...topics.values()].filter((t) => t.accountId === accountId && t.createdAt >= since).length;
    },
    async deletePost(id) {
      const p = posts.get(id);
      if (!p) return;
      const gone = p.first ? postsOf(p.topicId).map((x) => x.id) : [id];
      for (const g of gone) {
        posts.delete(g);
        for (const [k, r] of reports) if (r.postId === g) reports.delete(k);
      }
      if (p.first) {
        topics.delete(p.topicId);
        for (const v of votes) if (v.startsWith(`${p.topicId}:`)) votes.delete(v);
      }
    },
    async setVote(topicId, accountId, on) {
      if (on) votes.add(`${topicId}:${accountId}`);
      else votes.delete(`${topicId}:${accountId}`);
    },
    async votedBy(accountId, topicIds) {
      return new Set(topicIds.filter((t) => votes.has(`${t}:${accountId}`)));
    },
    async report(postId, accountId, reason) {
      const k = `${postId}:${accountId}`;
      if (!reports.has(k)) reports.set(k, { postId, reason });
    },
    async setStatus(topicId, status) {
      const t = topics.get(topicId);
      if (t) t.status = status;
    },
    async setHidden(postId, hidden, now) {
      const p = posts.get(postId);
      if (p) Object.assign(p, { hidden, hiddenAt: hidden ? now : null });
    },
    async clearReports(postId) {
      for (const [k, r] of reports) if (r.postId === postId) reports.delete(k);
    },
    async reported() {
      const by = new Map<number, string[]>();
      for (const r of reports.values()) by.set(r.postId, [...(by.get(r.postId) ?? []), r.reason]);
      const out: ReportedPost[] = [];
      for (const [postId, reasons] of by) {
        const p = posts.get(postId)!;
        out.push({ ...postOut(p), topicTitle: topics.get(p.topicId)?.title ?? '', reports: reasons.length, reasons: reasons.filter(Boolean) });
      }
      return out.sort((a, b) => b.reports - a.reports || a.id - b.id);
    },
  };
}
