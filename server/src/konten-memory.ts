import type { Account, AccountStore, Passkey } from './konten.ts';

/**
 * AccountStore in memory, for tests without PostgreSQL. konten.test.ts runs the same flows against
 * this and, with TEST_DATABASE_URL, against the real store (src/konten-db.ts).
 */
export function memoryStore(): AccountStore {
  const key = (b: Buffer) => b.toString('hex');
  const accounts = new Map<number, Account>();
  const identities = new Map<string, number>();
  const tokens = new Map<string, { email: string; created: Date; expires: Date; used: boolean }>();
  const sessions = new Map<string, { accountId: number; expires: Date }>();
  const passkeys = new Map<string, Passkey & { accountId: number }>();
  const challenges = new Map<string, { purpose: string; challenge: string; accountId: number | null; expires: Date }>();
  let nextId = 1;
  const strip = ({ accountId: _a, ...p }: Passkey & { accountId: number }): Passkey => ({ ...p });

  return {
    async addLoginToken(email, hash, now, expires) {
      tokens.set(key(hash), { email, created: now, expires, used: false });
    },
    async countLoginTokens(email, since) {
      return [...tokens.values()].filter((t) => t.email === email && t.created >= since).length;
    },
    async redeemLoginToken(hash, now) {
      const t = tokens.get(key(hash));
      if (!t || t.used || t.expires <= now) return null;
      t.used = true;
      return t.email;
    },
    async signIn(identity, role) {
      let id = identities.get(`${identity.provider}:${identity.subject}`);
      if (id === undefined) {
        id = [...accounts.values()].find((a) => a.email === identity.email.toLowerCase())?.id;
        if (id === undefined) {
          id = nextId++;
          accounts.set(id, { id, email: identity.email.toLowerCase(), role: 'player', createdAt: new Date(), blocked: false });
        }
        identities.set(`${identity.provider}:${identity.subject}`, id);
      }
      const a = accounts.get(id)!;
      a.role = role;
      return { ...a };
    },
    async setRole(accountId, role) {
      const a = accounts.get(accountId);
      if (a) a.role = role;
    },
    async setBlocked(accountId, blocked) {
      const a = accounts.get(accountId);
      if (a) a.blocked = blocked;
    },
    async addSession(accountId, hash, expires) {
      sessions.set(key(hash), { accountId, expires });
    },
    async sessionAccount(hash, now) {
      const s = sessions.get(key(hash));
      const a = s && s.expires > now ? accounts.get(s.accountId) : undefined;
      return a ? { ...a } : null;
    },
    async deleteSession(hash) {
      sessions.delete(key(hash));
    },
    async deleteSessions(accountId) {
      for (const [k, s] of sessions) if (s.accountId === accountId) sessions.delete(k);
    },
    async deleteAccount(accountId) {
      const email = accounts.get(accountId)?.email;
      accounts.delete(accountId);
      for (const [k, v] of identities) if (v === accountId) identities.delete(k);
      for (const [k, s] of sessions) if (s.accountId === accountId) sessions.delete(k);
      for (const [k, p] of passkeys) if (p.accountId === accountId) passkeys.delete(k);
      for (const [k, t] of tokens) if (t.email === email) tokens.delete(k);
    },
    async passkeys(accountId) {
      return [...passkeys.values()].filter((p) => p.accountId === accountId).map(strip);
    },
    async addPasskey(accountId, p) {
      if (passkeys.has(p.id)) throw new Error('duplicate passkey');
      passkeys.set(p.id, { ...p, accountId, createdAt: new Date(), lastUsedAt: null });
    },
    async passkey(id) {
      const p = passkeys.get(id);
      const a = p && accounts.get(p.accountId);
      return p && a ? { passkey: strip(p), account: { ...a } } : null;
    },
    async usePasskey(id, counter, now) {
      const p = passkeys.get(id);
      if (p) Object.assign(p, { counter, lastUsedAt: now });
    },
    async deletePasskey(accountId, id) {
      const p = passkeys.get(id);
      if (!p || p.accountId !== accountId) return false;
      passkeys.delete(id);
      return true;
    },
    async addChallenge(hash, purpose, challenge, accountId, expires) {
      challenges.set(key(hash), { purpose, challenge, accountId, expires });
    },
    async takeChallenge(hash, purpose, now) {
      const c = challenges.get(key(hash));
      if (!c || c.purpose !== purpose) return null;
      challenges.delete(key(hash));
      return c.expires > now ? { challenge: c.challenge, accountId: c.accountId } : null;
    },
    async cleanup(now) {
      for (const [k, s] of sessions) if (s.expires <= now) sessions.delete(k);
    },
    async overview() {
      const all = [...accounts.values()];
      return { accounts: all.length, admins: all.filter((a) => a.role === 'admin').length, passkeys: passkeys.size };
    },
  };
}
