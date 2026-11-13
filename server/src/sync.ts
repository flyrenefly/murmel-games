import type { FastifyInstance } from 'fastify';
import { requireAccount, requireSignedIn } from './konten.ts';
import { RateLimit } from './limit.ts';

/**
 * Fortschritt auf allen Geräten (docs/SPEC-sync.md): one record per account with the player's own,
 * UNVERIFIED progress (format of src/game/progress.ts). The server has no game logic and merges
 * nothing: it stores a new state only when the browser knew the current version (optimistic lock);
 * otherwise 409 with the current state, which the browser merges and sends again. These times never
 * reach a leaderboard (verified times: module bestenliste).
 */

export interface SyncProgress {
  levels: Record<string, unknown>;
  solved: string[];
}

export interface SyncRecord {
  version: number;
  updatedAt: string;
  data: SyncProgress;
}

export type PutResult = { ok: true; version: number; updatedAt: string } | { ok: false; current: SyncRecord | null };

export interface SyncStore {
  /** The account's record, or null before the first upload. */
  get(accountId: number): Promise<SyncRecord | null>;
  /** Stores data if `basis` is the current version (0 = none yet); otherwise returns the current record. */
  put(accountId: number, basis: number, data: SyncProgress, now: Date): Promise<PutResult>;
}

export const MAX_LEVELS = 5000;
export const BODY_LIMIT = 1024 * 1024;
export const REQUESTS_PER_15_MIN = 120;
const MINUTE = 60_000;

// Level ids as in src/game/progress.ts (at most 200 characters), without control characters.
const ID = '^[^\\u0000-\\u001f\\u007f]{1,200}$';
const count = { type: 'integer', minimum: 0, maximum: 999_999_999 } as const;
const date = { type: 'string', minLength: 1, maxLength: 40 } as const;
const levelSchema = {
  type: 'object',
  required: ['solves', 'attempts'],
  additionalProperties: false,
  properties: {
    solves: count,
    attempts: count,
    playSteps: count,
    falls: count,
    lastPlayed: date,
    best: {
      type: 'object',
      required: ['steps', 'falls', 'seed', 'date'],
      additionalProperties: false,
      properties: { steps: { ...count, minimum: 1 }, falls: count, seed: { type: 'integer', minimum: 0, maximum: 2 ** 32 - 1 }, date },
    },
  },
} as const;
export const progressSchema = {
  type: 'object',
  required: ['levels', 'solved'],
  additionalProperties: false,
  properties: {
    levels: { type: 'object', maxProperties: MAX_LEVELS, propertyNames: { pattern: ID }, additionalProperties: levelSchema },
    solved: { type: 'array', maxItems: MAX_LEVELS, items: { type: 'string', pattern: ID } },
  },
} as const;

const json = (r: SyncRecord | null) =>
  r ? { version: r.version, geaendert: r.updatedAt, fortschritt: r.data } : { version: 0, geaendert: null, fortschritt: { levels: {}, solved: [] } };

/** GET and PUT /api/fortschritt (needs the account routes: req.account). */
export function syncRoutes(app: FastifyInstance, opts: { store: SyncStore; origin: string; now?: () => Date }): void {
  const { store, origin, now = () => new Date() } = opts;
  const limit = new RateLimit(REQUESTS_PER_15_MIN, 15 * MINUTE);

  // After requireSignedIn/requireAccount: no-store, CSRF and the limit per account.
  const guard = async (req: Parameters<typeof requireAccount>[0], reply: Parameters<typeof requireAccount>[1]) => {
    reply.header('Cache-Control', 'no-store');
    // CSRF: writes only from the game's own page (SameSite=Strict as a second fence)
    if (req.method !== 'GET' && req.headers.origin !== undefined && req.headers.origin !== origin) return reply.code(403).send({ error: 'fremde Herkunft' });
    if (req.account && !limit.take(String(req.account.id), now().getTime())) {
      return reply.code(429).send({ error: 'Zu viele Abgleiche. Bitte warte ein paar Minuten.' });
    }
  };

  // Reading one's own progress works for blocked accounts too.
  app.get('/api/fortschritt', { preHandler: [requireSignedIn, guard] }, async (req) => json(await store.get(req.account!.id)));

  app.put<{ Body: { basis: number; fortschritt: SyncProgress } }>(
    '/api/fortschritt',
    {
      preHandler: [requireAccount, guard],
      bodyLimit: BODY_LIMIT,
      schema: {
        body: {
          type: 'object',
          required: ['basis', 'fortschritt'],
          additionalProperties: false,
          properties: { basis: { type: 'integer', minimum: 0, maximum: 2 ** 31 - 1 }, fortschritt: progressSchema },
        },
      },
    },
    async (req, reply) => {
      const r = await store.put(req.account!.id, req.body.basis, req.body.fortschritt, now());
      if (!r.ok) return reply.code(409).send({ error: 'Der Fortschritt wurde inzwischen auf einem anderen Gerät geändert.', ...json(r.current) });
      return { version: r.version, geaendert: r.updatedAt };
    },
  );
}
