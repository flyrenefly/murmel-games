import type { Sql } from 'postgres';
import type { LevelStatus, PlayerLevel, PlayerLevelStore, ReportedLevel } from './spielerlevels.ts';

interface Row {
  id: string;
  account_id: string;
  author: string | null;
  author_blocked: boolean;
  title: string;
  description: string;
  file?: Record<string, unknown>;
  width: number;
  height: number;
  steps: number;
  status: LevelStatus;
  reason: string | null;
  replaces: string | null;
  created_at: Date;
  published_at: Date | null;
  stars: string | null;
  votes: number;
  reports: number;
  reasons?: string[];
}

const level = (r: Row): PlayerLevel => ({
  id: Number(r.id),
  accountId: Number(r.account_id),
  author: r.author,
  authorBlocked: r.author_blocked,
  title: r.title,
  description: r.description,
  ...(r.file ? { file: r.file } : {}),
  width: r.width,
  height: r.height,
  steps: r.steps,
  status: r.status,
  reason: r.reason,
  replaces: r.replaces === null ? null : Number(r.replaces),
  createdAt: r.created_at,
  publishedAt: r.published_at,
  stars: r.stars === null ? null : Number(r.stars),
  votes: r.votes,
  reports: r.reports,
});

/** LIKE pattern for a search text (its own % and _ are literal). */
const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Spieler-Levels in PostgreSQL (migrations/009_spielerlevels.sql). */
export function playerLevelStore(sql: Sql): PlayerLevelStore {
  // every column of a level except the file and the recording, with author, rating and open reports
  const cols = sql`
    p.id, p.account_id, a.display_name as author, a.blocked_at is not null as author_blocked, p.title, p.description,
    jsonb_array_length(p.file->'map') as height,
    (select max(char_length(m.v)) from jsonb_array_elements_text(p.file->'map') m(v))::int as width,
    p.steps, p.status, p.reason, p.replaces, p.created_at, p.published_at,
    (select avg(stars) from player_level_ratings r where r.level_id = p.id) as stars,
    (select count(*)::int from player_level_ratings r where r.level_id = p.id) as votes,
    (select count(*)::int from player_level_reports x where x.level_id = p.id and x.dismissed_at is null) as reports`;

  return {
    async displayName(accountId) {
      const [r] = await sql<{ display_name: string | null }[]>`select display_name from accounts where id = ${accountId}`;
      return r?.display_name ?? null;
    },

    async countUploads(accountId, since) {
      const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from player_levels where account_id = ${accountId} and created_at >= ${since}`;
      return n;
    },

    async countWaiting(accountId) {
      const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from player_levels where account_id = ${accountId} and status = 'wartet'`;
      return n;
    },

    async create(l) {
      const [{ id }] = await sql<{ id: string }[]>`
        insert into player_levels (account_id, title, description, file, level_hash, recording, steps, replaces, created_at)
        values (${l.accountId}, ${l.title}, ${l.description}, ${sql.json(l.file as never)}, ${l.levelHash}, ${sql.json(l.recording as never)}, ${l.steps},
                (select id from player_levels where id = ${l.replaces} and account_id = ${l.accountId}), ${l.now})
        returning id`;
      return Number(id);
    },

    async level(id) {
      const [r] = await sql<Row[]>`select ${cols}, p.file from player_levels p join accounts a on a.id = p.account_id where p.id = ${id}`;
      return r ? level(r) : null;
    },

    async list(f) {
      const q = f.search ? like(f.search) : null;
      const rows = await sql<Row[]>`
        select * from (
          select ${cols} from player_levels p join accounts a on a.id = p.account_id
          where p.status = 'frei' and a.blocked_at is null
            and not exists (select 1 from player_level_reports x where x.level_id = p.id and x.dismissed_at is null)
            ${q ? sql`and (p.title ilike ${q} or p.description ilike ${q} or a.display_name ilike ${q})` : sql``}
        ) l
        order by ${f.sort === 'beliebt' ? sql`(coalesce(l.stars, 0) * l.votes + 9) / (l.votes + 3) desc, l.votes desc,` : sql``} l.published_at desc, l.id desc
        limit ${f.limit} offset ${f.offset}`;
      return rows.map(level);
    },

    async mine(accountId) {
      const rows = await sql<Row[]>`select ${cols} from player_levels p join accounts a on a.id = p.account_id where p.account_id = ${accountId} order by p.created_at desc, p.id desc`;
      return rows.map(level);
    },

    async pending() {
      const rows = await sql<Row[]>`
        select ${cols},
          coalesce((select array_agg(x.reason order by x.created_at) from player_level_reports x where x.level_id = p.id and x.dismissed_at is null), '{}') as reasons
        from player_levels p join accounts a on a.id = p.account_id
        where p.status = 'wartet' or exists (select 1 from player_level_reports x where x.level_id = p.id and x.dismissed_at is null)
        order by p.created_at, p.id`;
      return rows.map((r): ReportedLevel => ({ ...level(r), reasons: r.reasons ?? [] }));
    },

    async setStatus(id, status, reason, now, review) {
      await sql.begin(async (tx) => {
        const [r] = await tx<{ replaces: string | null; account_id: string }[]>`
          update player_levels set status = ${status}, reason = ${reason},
            published_at = case when ${status}::text = 'frei' then coalesce(published_at, ${now}::timestamptz) else published_at end,
            reviewed_at = case when ${review}::boolean then ${now}::timestamptz else reviewed_at end,
            notified_at = case when ${status}::text = 'wartet' then null else notified_at end
          where id = ${id} returning replaces, account_id`;
        if (r && status === 'frei' && r.replaces !== null) {
          await tx`update player_levels set status = 'ersetzt' where id = ${r.replaces} and account_id = ${r.account_id} and status <> 'abgelehnt'`;
        }
        if (review) await tx`update player_level_reports set dismissed_at = ${now} where level_id = ${id} and dismissed_at is null`;
      });
    },

    async remove(id) {
      return (await sql`delete from player_levels where id = ${id}`).count > 0;
    },

    async solved(accountId, levelId) {
      const [r] = await sql`select 1 from leaderboard where account_id = ${accountId} and level = ${`spieler:${levelId}`}`;
      return !!r;
    },

    async rate(levelId, accountId, stars, now) {
      await sql`
        insert into player_level_ratings (level_id, account_id, stars, created_at) values (${levelId}, ${accountId}, ${stars}, ${now})
        on conflict (level_id, account_id) do update set stars = excluded.stars, created_at = excluded.created_at`;
      const [r] = await sql<{ stars: string | null; votes: number }[]>`select avg(stars) as stars, count(*)::int as votes from player_level_ratings where level_id = ${levelId}`;
      return { stars: r.stars === null ? null : Number(r.stars), votes: r.votes };
    },

    async rating(levelId, accountId) {
      const [r] = await sql<{ stars: number }[]>`select stars from player_level_ratings where level_id = ${levelId} and account_id = ${accountId}`;
      return r ? r.stars : null;
    },

    async report(levelId, accountId, reason, now) {
      const r = await sql`
        insert into player_level_reports (level_id, account_id, reason, created_at) values (${levelId}, ${accountId}, ${reason}, ${now})
        on conflict do nothing`;
      return r.count > 0;
    },

    async dismissReports(levelId, now) {
      await sql`update player_level_reports set dismissed_at = ${now} where level_id = ${levelId} and dismissed_at is null`;
    },

    async unnotified() {
      const rows = await sql<{ id: string; title: string; author: string | null }[]>`
        select p.id, p.title, a.display_name as author from player_levels p join accounts a on a.id = p.account_id
        where p.status = 'wartet' and p.notified_at is null order by p.created_at, p.id`;
      return rows.map((r) => ({ id: Number(r.id), title: r.title, author: r.author }));
    },

    async lastNotified() {
      const [r] = await sql<{ sent_at: Date }[]>`select sent_at from player_level_mail`;
      return r?.sent_at ?? null;
    },

    async markNotified(ids, now) {
      await sql.begin(async (tx) => {
        await tx`update player_levels set notified_at = ${now} where id in ${tx(ids)}`;
        await tx`insert into player_level_mail (sent_at) values (${now}) on conflict (only_row) do update set sent_at = excluded.sent_at`;
      });
    },
  };
}
