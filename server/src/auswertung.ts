import type { FastifyInstance, FastifyRequest } from 'fastify';
import { RateLimit } from './limit.ts';
import { berlinDay, LEVEL_ID } from './stats.ts';

/**
 * Auswertung (docs/SPEC-auswertung.md): where players fail or give up. The game sends counters of ended
 * runs per pack and level in one bundle; the API adds them to the Berlin day's rows and forgets the
 * request. No IP address, check value, account or single run is stored; the IP address is only held in
 * memory for the request limit (limit.ts) and never logged.
 */

/** Counters of one level, as sent and as read (summed over the days). */
export interface LevelCounts {
  pack: string;
  level: string;
  gestartet: number;
  geloest: number;
  neustart: number;
  abbruch: number;
  abstuerze: number;
  /** How often the way from the tips (docs/SPEC-tipps.md) was shown. */
  wegGezeigt: number;
  /** Play time classes of solved runs: < 1, 1–3, 3–10, 10–30, ≥ 30 minutes. */
  zeitGeloest: number[];
  /** The same for abandoned runs. */
  zeitAbbruch: number[];
}

export interface AuswertungStore {
  /** Adds the counters to the rows of `day` (YYYY-MM-DD); the first entry of a new day deletes rows older than a year. */
  record(day: string, levels: LevelCounts[]): Promise<void>;
  /** Sums per pack and level since a day (YYYY-MM-DD), ordered by pack and level. */
  summary(since: string): Promise<LevelCounts[]>;
}

export const MAX_LEVELS = 50;
export const MAX_COUNT = 500;
export const MAX_FALLS = 10_000;
/** Bundles per IP address and window: a page sends one per 20 ended runs and when hidden or left, so this
 * leaves room for a whole class or family behind one address. */
export const BUNDLES_PER_IP = 120;
export const BUNDLE_WINDOW_MS = 15 * 60_000;
/** Rows are kept this many days. */
export const KEEP_DAYS = 365;
export const COUNTERS = ['gestartet', 'geloest', 'neustart', 'abbruch', 'abstuerze', 'wegGezeigt'] as const;

const count = { type: 'integer', minimum: 0, maximum: MAX_COUNT };
const classes = { type: 'array', minItems: 5, maxItems: 5, items: count };
const levelSchema = {
  type: 'object',
  additionalProperties: false,
  // wegGezeigt is optional (pages from before it was added do not send it) and then counts 0
  required: ['pack', 'level', ...COUNTERS.filter((k) => k !== 'wegGezeigt'), 'zeitGeloest', 'zeitAbbruch'],
  properties: {
    pack: { type: 'string', pattern: LEVEL_ID },
    level: { type: 'string', pattern: LEVEL_ID },
    gestartet: count,
    geloest: count,
    neustart: count,
    abbruch: count,
    abstuerze: { type: 'integer', minimum: 0, maximum: MAX_FALLS },
    wegGezeigt: { ...count, default: 0 },
    zeitGeloest: classes,
    zeitAbbruch: classes,
  },
};

/** The oldest day kept when `day` is today. */
export function oldestKept(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/** Adds b to a (counters and time classes element by element). */
export function addCounts(a: LevelCounts, b: LevelCounts): LevelCounts {
  const out = { ...a, zeitGeloest: a.zeitGeloest.map((n, i) => n + b.zeitGeloest[i]), zeitAbbruch: a.zeitAbbruch.map((n, i) => n + b.zeitAbbruch[i]) };
  for (const k of COUNTERS) out[k] = a[k] + b[k];
  return out;
}

export function auswertungRoutes(
  app: FastifyInstance,
  opts: { store: AuswertungStore; mayRead: (req: FastifyRequest) => boolean; now: () => Date },
): void {
  const { store, mayRead, now } = opts;
  const ipLimit = new RateLimit(BUNDLES_PER_IP, BUNDLE_WINDOW_MS);

  app.post<{ Body: { levels: LevelCounts[] } }>(
    '/api/auswertung',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['levels'],
          properties: { levels: { type: 'array', minItems: 1, maxItems: MAX_LEVELS, items: levelSchema } },
        },
      },
    },
    async (req, reply) => {
      // too many bundles from one address: dropped without a log line (the game ignores the answer)
      if (!ipLimit.take(req.ip, now().getTime())) return reply.code(429).send({ error: 'Zu viele Anfragen. Bitte warte ein paar Minuten.' });
      try {
        await store.record(berlinDay(now()), req.body.levels);
      } catch (err) {
        // The game never waits for the answer; lost counters are no error for the player.
        req.log.error({ err }, 'auswertung failed');
      }
      return reply.code(204).send();
    },
  );

  // Reading: signed-in admins or the STATS_TOKEN, like /api/statistik.
  app.get<{ Querystring: { tage?: string } }>('/api/statistik/auswertung', async (req, reply) => {
    if (!mayRead(req)) return reply.code(401).send({ error: 'nicht berechtigt' });
    const days = Math.min(Math.max(Math.trunc(Number(req.query.tage ?? 30)) || 30, 1), 366);
    const since = berlinDay(new Date(now().getTime() - (days - 1) * 86_400_000));
    reply.header('Cache-Control', 'no-store');
    return { levels: await store.summary(since) };
  });
}
