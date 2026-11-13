import type { Sql } from 'postgres';
import type { PushStore, PushSubscription } from './webpush.ts';

/** Web-Push subscriptions in PostgreSQL (migrations/013_webpush.sql). */
export function pushStore(sql: Sql): PushStore {
  return {
    async save(s, now) {
      // a new subscription keeps nothing of an old one with the same endpoint but its row
      await sql`
        insert into push_subscriptions (endpoint, p256dh, auth, tag, woche, created_at)
        values (${s.endpoint}, ${s.p256dh}, ${s.auth}, ${s.tag}, ${s.woche}, ${now})
        on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, tag = excluded.tag, woche = excluded.woche`;
    },
    async remove(endpoint) {
      await sql`delete from push_subscriptions where endpoint = ${endpoint}`;
    },
    async count() {
      const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from push_subscriptions`;
      return n;
    },
    async list(arts) {
      return sql<PushSubscription[]>`
        select endpoint, p256dh, auth, tag, woche from push_subscriptions
        where (tag and ${arts.includes('tag')}) or (woche and ${arts.includes('woche')})
        order by created_at`;
    },
    async claim(art, zeitraum, now) {
      const rows = await sql`insert into push_sent (art, zeitraum, sent_at) values (${art}, ${zeitraum}, ${now}) on conflict do nothing returning 1`;
      // keep the table small: a year is plenty to know what was sent
      await sql`delete from push_sent where sent_at < ${new Date(now.getTime() - 400 * 86_400_000)}`;
      return rows.length === 1;
    },
  };
}
