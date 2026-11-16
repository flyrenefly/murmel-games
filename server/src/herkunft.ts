import type { FastifyInstance, FastifyRequest } from 'fastify';
import { RateLimit } from './limit.ts';
import { berlinDay } from './stats.ts';

/**
 * Herkunft (docs/SPEC-herkunft.md): from which sites visitors came, per day. A page sends only the
 * domain of a foreign referrer, once per browser tab session; the API checks and normalizes it and adds
 * one to the Berlin day's row. No IP address, user agent, path or single visit is stored; the IP address
 * is only held in memory for the request limit (limit.ts) and never logged.
 */

export interface HerkunftRow {
  day: string;
  domain: string;
  anzahl: number;
}

export interface HerkunftStore {
  /** Adds one visit from `domain` (already normalized) to `day` (YYYY-MM-DD); at most MAX_DOMAINS_PER_DAY
   * domains a day. The first entry of a new day deletes rows older than 13 months. */
  record(day: string, domain: string): Promise<void>;
  /** All rows since a day (YYYY-MM-DD), ordered by day and domain. */
  rows(since: string): Promise<HerkunftRow[]>;
}

/** Longest host name (RFC 1035). */
export const MAX_DOMAIN = 253;
/** Distinct domains a day: referrer spam cannot fill the table; known domains still count. */
export const MAX_DOMAINS_PER_DAY = 500;
/** Domains seen fewer times are only shown as a sum („andere“). */
export const MIN_SHOWN = 3;
/** Reports per IP address and window: one per tab session, so this leaves room for a school behind one address. */
export const HERKUNFT_PER_IP = 60;
export const HERKUNFT_WINDOW_MS = 15 * 60_000;
/** Rows are kept this many months. */
export const KEEP_MONTHS = 13;
/** Our own domain and its subdomains are no origin. */
const OWN = 'murmel.games';

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** The last label must start with a letter: no IPv4 address, no numeric top-level domain. */
const TLD = /^[a-z][a-z0-9-]*$/;

/**
 * The domain as counted: trimmed, lower case, without a final dot and a leading `www.`. null for anything
 * that is no plain host name with at least two labels (paths, ports, addresses, non-ASCII, …) and for
 * our own domain.
 */
export function normalizeDomain(raw: string): string | null {
  let d = raw.trim().toLowerCase();
  if (d.endsWith('.')) d = d.slice(0, -1);
  if (d.startsWith('www.')) d = d.slice(4);
  if (!d || d.length > MAX_DOMAIN) return null;
  const labels = d.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l)) || !TLD.test(labels[labels.length - 1])) return null;
  if (d === OWN || d.endsWith(`.${OWN}`)) return null;
  return d;
}

/** The oldest day kept when `day` is today: the same day 13 months earlier, clamped to the month's end. */
export function oldestKept(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 - KEEP_MONTHS, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

export interface DomainCount {
  domain: string;
  anzahl: number;
}
export interface Zusammenfassung {
  besucher: number;
  domains: DomainCount[];
  /** Domains below MIN_SHOWN: only how many and their sum. */
  andere: { domains: number; anzahl: number };
}
export interface Bericht {
  /** Newest day first; only days with visits. */
  tage: (Zusammenfassung & { day: string })[];
  /** Summed over the period; a domain shown here may be below MIN_SHOWN on every single day. */
  gesamt: Zusammenfassung;
}

function zusammenfassen(counts: Map<string, number>, min: number): Zusammenfassung {
  const all = [...counts].map(([domain, anzahl]) => ({ domain, anzahl })).sort((a, b) => b.anzahl - a.anzahl || (a.domain < b.domain ? -1 : 1));
  const klein = all.filter((c) => c.anzahl < min);
  return {
    besucher: all.reduce((n, c) => n + c.anzahl, 0),
    domains: all.filter((c) => c.anzahl >= min),
    andere: { domains: klein.length, anzahl: klein.reduce((n, c) => n + c.anzahl, 0) },
  };
}

/** The report of the admin statistics: per day and summed, rare domains only as a sum. */
export function bericht(rows: HerkunftRow[], min = MIN_SHOWN): Bericht {
  const days = new Map<string, Map<string, number>>();
  const total = new Map<string, number>();
  for (const r of rows) {
    if (!days.has(r.day)) days.set(r.day, new Map());
    const d = days.get(r.day)!;
    d.set(r.domain, (d.get(r.domain) ?? 0) + r.anzahl);
    total.set(r.domain, (total.get(r.domain) ?? 0) + r.anzahl);
  }
  return {
    tage: [...days].sort(([a], [b]) => (a < b ? 1 : -1)).map(([day, counts]) => ({ day, ...zusammenfassen(counts, min) })),
    gesamt: zusammenfassen(total, min),
  };
}

export function herkunftRoutes(
  app: FastifyInstance,
  opts: { store: HerkunftStore; mayRead: (req: FastifyRequest) => boolean; now: () => Date },
): void {
  const { store, mayRead, now } = opts;
  const ipLimit = new RateLimit(HERKUNFT_PER_IP, HERKUNFT_WINDOW_MS);

  app.post<{ Body: { domain: string } }>(
    '/api/herkunft',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['domain'],
          properties: { domain: { type: 'string', minLength: 1, maxLength: MAX_DOMAIN + 1 } },
        },
      },
    },
    async (req, reply) => {
      const domain = normalizeDomain(req.body.domain);
      if (!domain) return reply.code(400).send({ error: 'ungültige Domain' });
      // too many reports from one address: dropped without a log line (the page ignores the answer)
      if (!ipLimit.take(req.ip, now().getTime())) return reply.code(429).send({ error: 'Zu viele Anfragen. Bitte warte ein paar Minuten.' });
      try {
        await store.record(berlinDay(now()), domain);
      } catch (err) {
        // The page never waits for the answer; a lost count is no error for the visitor.
        req.log.error({ err }, 'herkunft failed');
      }
      return reply.code(204).send();
    },
  );

  // Reading: signed-in admins or the STATS_TOKEN, like /api/statistik.
  app.get<{ Querystring: { tage?: string } }>('/api/statistik/herkunft', async (req, reply) => {
    if (!mayRead(req)) return reply.code(401).send({ error: 'nicht berechtigt' });
    const days = Math.min(Math.max(Math.trunc(Number(req.query.tage ?? 30)) || 30, 1), 366);
    const since = berlinDay(new Date(now().getTime() - (days - 1) * 86_400_000));
    reply.header('Cache-Control', 'no-store');
    return bericht(await store.rows(since));
  });
}
