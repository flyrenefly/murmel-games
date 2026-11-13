import type { Sql } from 'postgres';
import type { Account, AccountStore, Passkey, Provider, Role } from './konten.ts';

interface AccountRow {
  id: string;
  email: string;
  role: Role;
  created_at: Date;
  blocked_at: Date | null;
}
const account = (r: AccountRow): Account => ({ id: Number(r.id), email: r.email, role: r.role, createdAt: r.created_at, blocked: r.blocked_at !== null });

interface PasskeyRow {
  id: string;
  public_key: Buffer;
  counter: string;
  transports: string[];
  name: string;
  created_at: Date;
  last_used_at: Date | null;
}
const passkey = (r: PasskeyRow): Passkey => ({
  id: r.id,
  publicKey: new Uint8Array(r.public_key),
  counter: Number(r.counter),
  transports: r.transports,
  name: r.name,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
});

/** Accounts in PostgreSQL (migrations/003_konten.sql). */
export function accountStore(sql: Sql): AccountStore {
  return {
    async addLoginToken(email, hash, now, expires) {
      await sql`insert into login_tokens (token_hash, email, created_at, expires_at) values (${hash}, ${email}, ${now}, ${expires})`;
    },

    async countLoginTokens(email, since) {
      const [r] = await sql<{ n: number }[]>`select count(*)::int as n from login_tokens where email = ${email} and created_at >= ${since}`;
      return r.n;
    },

    async redeemLoginToken(hash, now) {
      // One statement: two simultaneous clicks cannot both use the link.
      const [r] = await sql<{ email: string }[]>`
        update login_tokens set used_at = ${now}
        where token_hash = ${hash} and used_at is null and expires_at > ${now}
        returning email::text`;
      return r?.email ?? null;
    },

    async signIn(identity, role) {
      return sql.begin(async (tx) => {
        let [row] = await tx<AccountRow[]>`
          select a.id, a.email::text, a.role, a.created_at, a.blocked_at from account_identities i join accounts a on a.id = i.account_id
          where i.provider = ${identity.provider} and i.subject = ${identity.subject}`;
        if (!row) {
          // Same verified address = same person: link the new sign-in method to the existing account.
          [row] = await tx<AccountRow[]>`
            insert into accounts (email) values (${identity.email})
            on conflict (email) do update set email = accounts.email
            returning id, email::text, role, created_at, blocked_at`;
          await tx`
            insert into account_identities (provider, subject, account_id, email) values (${identity.provider}, ${identity.subject}, ${row.id}, ${identity.email})
            on conflict do nothing`;
        } else {
          // keep the address the provider confirmed last (shown on the account page)
          await tx`update account_identities set email = ${identity.email} where provider = ${identity.provider} and subject = ${identity.subject}`;
        }
        if (row.role !== role) {
          await tx`update accounts set role = ${role} where id = ${row.id}`;
          row = { ...row, role };
        }
        return account(row);
      });
    },

    async identities(accountId) {
      const rows = await sql<{ provider: Provider; subject: string; email: string | null; created_at: Date }[]>`
        select provider, subject, email::text, created_at from account_identities
        where account_id = ${accountId} order by created_at, provider, subject`;
      return rows.map((r) => ({ provider: r.provider, subject: r.subject, email: r.email, createdAt: r.created_at }));
    },

    async linkIdentity(accountId, identity) {
      // A method that belongs to another account stays there (no silent moving of sign-ins).
      const rows = await sql`
        insert into account_identities (provider, subject, account_id, email)
        values (${identity.provider}, ${identity.subject}, ${accountId}, ${identity.email})
        on conflict (provider, subject) do update set email = excluded.email
        where account_identities.account_id = excluded.account_id
        returning 1`;
      return rows.length ? 'ok' : 'vergeben';
    },

    async unlinkIdentity(accountId, provider, subject) {
      return (await sql`delete from account_identities where account_id = ${accountId} and provider = ${provider} and subject = ${subject} returning 1`).length > 0;
    },

    async account(accountId) {
      const [r] = await sql<AccountRow[]>`select id, email::text, role, created_at, blocked_at from accounts where id = ${accountId}`;
      return r ? account(r) : null;
    },

    async setRole(accountId, role) {
      await sql`update accounts set role = ${role} where id = ${accountId}`;
    },

    async setBlocked(accountId, blocked, now) {
      await sql`update accounts set blocked_at = ${blocked ? now : null} where id = ${accountId}`;
    },

    async addSession(accountId, hash, expires) {
      await sql`insert into sessions (token_hash, account_id, expires_at) values (${hash}, ${accountId}, ${expires})`;
    },

    async sessionAccount(hash, now) {
      const [r] = await sql<AccountRow[]>`
        select a.id, a.email::text, a.role, a.created_at, a.blocked_at from sessions s join accounts a on a.id = s.account_id
        where s.token_hash = ${hash} and s.expires_at > ${now}`;
      return r ? account(r) : null;
    },

    async deleteSession(hash) {
      await sql`delete from sessions where token_hash = ${hash}`;
    },

    async deleteSessions(accountId) {
      await sql`delete from sessions where account_id = ${accountId}`;
    },

    async deleteAccount(accountId) {
      // Sessions, passkeys, sign-in methods and challenges go with it (on delete cascade). Login links
      // are keyed by address, not account: remove them too.
      await sql.begin(async (tx) => {
        await tx`delete from login_tokens where email = (select email from accounts where id = ${accountId})`;
        await tx`delete from accounts where id = ${accountId}`;
      });
    },

    async passkeys(accountId) {
      const rows = await sql<PasskeyRow[]>`
        select id, public_key, counter, transports, name, created_at, last_used_at from passkeys
        where account_id = ${accountId} order by created_at, id`;
      return rows.map(passkey);
    },

    async addPasskey(accountId, p) {
      await sql`
        insert into passkeys (id, account_id, public_key, counter, transports, name)
        values (${p.id}, ${accountId}, ${Buffer.from(p.publicKey)}, ${p.counter}, ${p.transports}, ${p.name})`;
    },

    async passkey(id) {
      const [r] = await sql<(PasskeyRow & { account_id: string; email: string; role: Role; account_created: Date; blocked_at: Date | null })[]>`
        select p.id, p.public_key, p.counter, p.transports, p.name, p.created_at, p.last_used_at,
          a.id as account_id, a.email::text, a.role, a.created_at as account_created, a.blocked_at
        from passkeys p join accounts a on a.id = p.account_id where p.id = ${id}`;
      if (!r) return null;
      return { passkey: passkey(r), account: account({ id: r.account_id, email: r.email, role: r.role, created_at: r.account_created, blocked_at: r.blocked_at }) };
    },

    async usePasskey(id, counter, now) {
      await sql`update passkeys set counter = ${counter}, last_used_at = ${now} where id = ${id}`;
    },

    async deletePasskey(accountId, id) {
      return (await sql`delete from passkeys where account_id = ${accountId} and id = ${id} returning 1`).length > 0;
    },

    async addChallenge(hash, purpose, challenge, accountId, expires) {
      await sql`
        insert into webauthn_challenges (id_hash, purpose, challenge, account_id, expires_at)
        values (${hash}, ${purpose}, ${challenge}, ${accountId}, ${expires})`;
    },

    async takeChallenge(hash, purpose, now) {
      const [r] = await sql<{ challenge: string; account_id: string | null; expires_at: Date }[]>`
        delete from webauthn_challenges where id_hash = ${hash} and purpose = ${purpose}
        returning challenge, account_id, expires_at`;
      if (!r || r.expires_at <= now) return null;
      return { challenge: r.challenge, accountId: r.account_id === null ? null : Number(r.account_id) };
    },

    async cleanup(now) {
      await sql`delete from login_tokens where expires_at < ${new Date(now.getTime() - 86_400_000)}`;
      await sql`delete from sessions where expires_at < ${now}`;
      await sql`delete from webauthn_challenges where expires_at < ${now}`;
    },

    async recordSignIn(accountId, day) {
      await sql.begin(async (tx) => {
        // who signed in is only kept for the current day; earlier days keep just the totals
        await tx`delete from signin_seen where day < ${day}`;
        const fresh = (await tx`insert into signin_seen (day, account_id) values (${day}, ${accountId}) on conflict do nothing returning 1`).length;
        await tx`
          insert into signin_day (day, sign_ins, accounts) values (${day}, 1, ${fresh})
          on conflict (day) do update set sign_ins = signin_day.sign_ins + 1, accounts = signin_day.accounts + excluded.accounts`;
      });
    },

    async accountHistory(since) {
      const [b] = await sql<{ n: number }[]>`select count(*)::int as n from accounts where blocked_at is not null`;
      const created = await sql<{ day: string; count: number }[]>`
        select to_char(created_at at time zone 'Europe/Berlin', 'YYYY-MM-DD') as day, count(*)::int as count
        from accounts where (created_at at time zone 'Europe/Berlin')::date >= ${since} group by 1 order by 1`;
      const signIns = await sql<{ day: string; signIns: number; accounts: number }[]>`
        select to_char(day, 'YYYY-MM-DD') as day, sign_ins as "signIns", accounts from signin_day where day >= ${since} order by day`;
      return { blocked: b.n, created: [...created], signIns: [...signIns] };
    },

    async overview() {
      const [r] = await sql<{ accounts: number; admins: number; passkeys: number }[]>`
        select (select count(*)::int from accounts) as accounts,
          (select count(*)::int from accounts where role = 'admin') as admins,
          (select count(*)::int from passkeys) as passkeys`;
      return { accounts: r.accounts, admins: r.admins, passkeys: r.passkeys };
    },
  };
}
