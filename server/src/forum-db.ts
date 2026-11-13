import type { Sql } from 'postgres';
import type { Category, ForumStore, Post, Status, Topic } from './forum.ts';

interface TopicRow {
  id: string;
  account_id: string;
  author: string | null;
  team: boolean;
  category: Category;
  status: Status;
  title: string;
  level: string | null;
  version: string | null;
  created_at: Date;
  last_post_at: Date;
  replies: number;
  votes: number;
  hidden: boolean;
}
const topic = (r: TopicRow): Topic => ({
  id: Number(r.id),
  accountId: Number(r.account_id),
  author: r.author ?? '',
  team: r.team,
  category: r.category,
  status: r.status,
  title: r.title,
  level: r.level,
  version: r.version,
  createdAt: r.created_at,
  lastPostAt: r.last_post_at,
  replies: r.replies,
  votes: r.votes,
  hidden: r.hidden,
});

interface PostRow {
  id: string;
  topic_id: string;
  account_id: string;
  author: string | null;
  team: boolean;
  first: boolean;
  body: string;
  hidden: boolean;
  created_at: Date;
}
const post = (r: PostRow): Post => ({
  id: Number(r.id),
  topicId: Number(r.topic_id),
  accountId: Number(r.account_id),
  author: r.author ?? '',
  team: r.team,
  first: r.first,
  body: r.body,
  hidden: r.hidden,
  createdAt: r.created_at,
});

/** Forum in PostgreSQL (migrations/004_forum.sql). */
export function forumStore(sql: Sql): ForumStore {
  const topicSelect = () => sql`
    select t.id, t.account_id, a.display_name as author, f.team, t.category, t.status, t.title, t.level, t.version,
      t.created_at, t.last_post_at, f.hidden_at is not null as hidden,
      (select count(*)::int from forum_posts p where p.topic_id = t.id and not p.first) as replies,
      (select count(*)::int from forum_votes v where v.topic_id = t.id) as votes
    from forum_topics t
    join accounts a on a.id = t.account_id
    join forum_posts f on f.topic_id = t.id and f.first`;
  const postSelect = () => sql`
    select p.id, p.topic_id, p.account_id, a.display_name as author, p.team, p.first, p.body, p.hidden_at is not null as hidden, p.created_at
    from forum_posts p join accounts a on a.id = p.account_id`;

  return {
    async displayName(accountId) {
      const [r] = await sql<{ display_name: string | null }[]>`select display_name from accounts where id = ${accountId}`;
      return r?.display_name ?? null;
    },

    async setDisplayName(accountId, name) {
      try {
        await sql`update accounts set display_name = ${name} where id = ${accountId}`;
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') return false; // unique: name taken
        throw err;
      }
    },

    async topics(f) {
      const rows = await sql<TopicRow[]>`
        select * from (${topicSelect()}) x
        where true
          ${f.category ? sql`and category = ${f.category}` : sql``}
          ${f.status ? sql`and status = ${f.status}` : sql``}
          ${f.withHidden ? sql`` : sql`and not hidden`}
        order by ${f.sort === 'stimmen' ? sql`votes desc,` : sql``} last_post_at desc, id desc
        limit ${f.limit} offset ${f.offset}`;
      return rows.map(topic);
    },

    async topic(id) {
      const [r] = await sql<TopicRow[]>`${topicSelect()} where t.id = ${id}`;
      return r ? topic(r) : null;
    },

    async posts(topicId) {
      return (await sql<PostRow[]>`${postSelect()} where p.topic_id = ${topicId} order by p.id`).map(post);
    },

    async post(id) {
      const [r] = await sql<PostRow[]>`${postSelect()} where p.id = ${id}`;
      return r ? post(r) : null;
    },

    async addTopic(t) {
      return sql.begin(async (tx) => {
        const [r] = await tx<{ id: string }[]>`
          insert into forum_topics (account_id, category, title, level, version, created_at, last_post_at)
          values (${t.accountId}, ${t.category}, ${t.title}, ${t.level}, ${t.version}, ${t.now}, ${t.now}) returning id`;
        await tx`insert into forum_posts (topic_id, account_id, first, body, team, created_at) values (${r.id}, ${t.accountId}, true, ${t.body}, ${t.team}, ${t.now})`;
        return Number(r.id);
      });
    },

    async addPost(p) {
      return sql.begin(async (tx) => {
        const [r] = await tx<{ id: string }[]>`
          insert into forum_posts (topic_id, account_id, body, team, created_at) values (${p.topicId}, ${p.accountId}, ${p.body}, ${p.team}, ${p.now}) returning id`;
        await tx`update forum_topics set last_post_at = ${p.now} where id = ${p.topicId}`;
        return Number(r.id);
      });
    },

    async countPosts(accountId, since) {
      const [r] = await sql<{ n: number }[]>`select count(*)::int as n from forum_posts where account_id = ${accountId} and created_at >= ${since}`;
      return r.n;
    },

    async countTopics(accountId, since) {
      const [r] = await sql<{ n: number }[]>`select count(*)::int as n from forum_topics where account_id = ${accountId} and created_at >= ${since}`;
      return r.n;
    },

    async deletePost(id) {
      // The first post takes its topic along (replies, votes, reports: on delete cascade).
      await sql.begin(async (tx) => {
        const [p] = await tx<{ topic_id: string; first: boolean }[]>`delete from forum_posts where id = ${id} returning topic_id, first`;
        if (p?.first) await tx`delete from forum_topics where id = ${p.topic_id}`;
      });
    },

    async setVote(topicId, accountId, on) {
      if (on) await sql`insert into forum_votes (topic_id, account_id) values (${topicId}, ${accountId}) on conflict do nothing`;
      else await sql`delete from forum_votes where topic_id = ${topicId} and account_id = ${accountId}`;
    },

    async votedBy(accountId, topicIds) {
      if (!topicIds.length) return new Set();
      const rows = await sql<{ topic_id: string }[]>`select topic_id from forum_votes where account_id = ${accountId} and topic_id in ${sql(topicIds)}`;
      return new Set(rows.map((r) => Number(r.topic_id)));
    },

    async report(postId, accountId, reason, now) {
      await sql`insert into forum_reports (post_id, account_id, reason, created_at) values (${postId}, ${accountId}, ${reason}, ${now}) on conflict do nothing`;
    },

    async setStatus(topicId, status) {
      await sql`update forum_topics set status = ${status} where id = ${topicId}`;
    },

    async setHidden(postId, hidden, now) {
      await sql`update forum_posts set hidden_at = ${hidden ? now : null} where id = ${postId}`;
    },

    async clearReports(postId) {
      await sql`delete from forum_reports where post_id = ${postId}`;
    },

    async reported() {
      const rows = await sql<(PostRow & { topic_title: string; reports: number; reasons: string[] })[]>`
        select x.*, t.title as topic_title, r.reports, r.reasons
        from (select post_id, count(*)::int as reports, coalesce(array_agg(reason order by created_at) filter (where reason <> ''), '{}') as reasons
              from forum_reports group by post_id) r
        join (${postSelect()}) x on x.id = r.post_id
        join forum_topics t on t.id = x.topic_id
        order by r.reports desc, x.id`;
      return rows.map((r) => ({ ...post(r), topicTitle: r.topic_title, reports: r.reports, reasons: r.reasons }));
    },
  };
}
