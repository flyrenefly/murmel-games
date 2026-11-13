import type { PushStore, PushSubscription } from './webpush.ts';

/** PushStore in memory, for tests without PostgreSQL. */
export function memoryPushStore(): PushStore & { all(): PushSubscription[] } {
  const subs = new Map<string, PushSubscription>();
  const sent = new Set<string>();
  return {
    all: () => [...subs.values()],
    async save(s) {
      subs.set(s.endpoint, { ...s });
    },
    async remove(endpoint) {
      subs.delete(endpoint);
    },
    async count() {
      return subs.size;
    },
    async list(arts) {
      return [...subs.values()].filter((s) => (s.tag && arts.includes('tag')) || (s.woche && arts.includes('woche'))).map((s) => ({ ...s }));
    },
    async claim(art, zeitraum) {
      const k = `${art}:${zeitraum}`;
      if (sent.has(k)) return false;
      sent.add(k);
      return true;
    },
  };
}
