import type { FastifyInstance } from 'fastify';
import { requireAccount, requireSignedIn } from './konten.ts';
import { RateLimit } from './limit.ts';

/**
 * Spielstand in der Cloud (docs/SPEC-cloudstand.md): per account and level at most one saved run –
 * start value plus the input recording up to the save point (gzip + base64, opaque to the server) and a
 * check code of the state there. The server has no game logic: it checks form and size, keeps the newest
 * save, at most MAX_SAVES per account, and drops saves after KEEP_DAYS. Only the own account reads them;
 * no route shows anybody else's, and saves never reach a leaderboard.
 */

export interface CloudSave {
  level: string;
  pack: string;
  seed: number;
  leben: number | null;
  steps: number;
  version: string;
  pruef: string;
  daten: string;
}

export interface CloudSaveInfo {
  level: string;
  pack: string;
  steps: number;
  updatedAt: string;
}

export interface CloudSaveStore {
  /** The account's saves without data, newest first. */
  list(accountId: number): Promise<CloudSaveInfo[]>;
  get(accountId: number, level: string): Promise<(CloudSave & { updatedAt: string }) | null>;
  /** Stores (or replaces) the save of this level; a new level beyond MAX_SAVES drops the oldest. */
  put(accountId: number, save: CloudSave, now: Date): Promise<void>;
  delete(accountId: number, level: string): Promise<void>;
  /** Removes all saves older than `before`; returns how many. */
  expire(before: Date): Promise<number>;
}

export const MAX_SAVES = 20;
export const KEEP_DAYS = 90;
/** One hour of play at 400 physics steps per second (as the leaderboard). */
export const MAX_STEPS = 3600 * 400;
export const MAX_DATA = 2_000_000;
export const BODY_LIMIT = 2.5 * 1024 * 1024;
export const REQUESTS_PER_15_MIN = 120;
const MINUTE = 60_000;
const DAY = 86_400_000;

// Level ids as in src/game/progress.ts (at most 200 characters), without control characters.
const levelProp = { type: 'string', pattern: '^[^\\u0000-\\u001f\\u007f]{1,200}$' } as const;
const saveSchema = {
  type: 'object',
  required: ['pack', 'seed', 'leben', 'steps', 'version', 'pruef', 'daten'],
  additionalProperties: false,
  properties: {
    pack: { type: 'string', pattern: '^[^\\u0000-\\u001f\\u007f]{1,100}$' },
    seed: { type: 'integer', minimum: 0, maximum: 2 ** 32 - 1 },
    leben: { type: ['integer', 'null'], minimum: 0, maximum: 99 },
    steps: { type: 'integer', minimum: 1, maximum: MAX_STEPS },
    version: { type: 'string', pattern: '^[0-9A-Za-z._-]{1,64}$' },
    pruef: { type: 'string', pattern: '^[0-9A-Za-z._:,|-]{1,200}$' },
    // base64 of the gzip-compressed recording; the server never unpacks it
    daten: { type: 'string', minLength: 1, maxLength: MAX_DATA, pattern: '^[A-Za-z0-9+/]+={0,2}$' },
  },
} as const;
const query = (required: boolean) => ({ type: 'object', required: required ? ['level'] : [], additionalProperties: false, properties: { level: levelProp } }) as const;

/** GET/PUT/DELETE /api/spielstand (needs the account routes: req.account). */
export function cloudSaveRoutes(app: FastifyInstance, opts: { store: CloudSaveStore; origin: string; now?: () => Date; timer?: boolean }): void {
  const { store, origin, now = () => new Date() } = opts;
  const limit = new RateLimit(REQUESTS_PER_15_MIN, 15 * MINUTE);

  // After requireSignedIn/requireAccount: no-store, CSRF and the limit per account.
  const guard = async (req: Parameters<typeof requireAccount>[0], reply: Parameters<typeof requireAccount>[1]) => {
    reply.header('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.headers.origin !== undefined && req.headers.origin !== origin) return reply.code(403).send({ error: 'fremde Herkunft' });
    if (req.account && !limit.take(String(req.account.id), now().getTime())) {
      return reply.code(429).send({ error: 'Zu viele Anfragen. Bitte warte ein paar Minuten.' });
    }
  };
  const cutoff = () => new Date(now().getTime() - KEEP_DAYS * DAY);
  const fresh = (iso: string) => new Date(iso) >= cutoff();

  // Reading works for blocked accounts too; without ?level the list (no data), with it one save.
  app.get<{ Querystring: { level?: string } }>('/api/spielstand', { preHandler: [requireSignedIn, guard], schema: { querystring: query(false) } }, async (req, reply) => {
    const id = req.account!.id;
    if (req.query.level === undefined) {
      const staende = (await store.list(id)).filter((s) => fresh(s.updatedAt));
      return { staende: staende.map((s) => ({ level: s.level, pack: s.pack, steps: s.steps, gespeichert: s.updatedAt })) };
    }
    const s = await store.get(id, req.query.level);
    if (!s || !fresh(s.updatedAt)) return reply.code(404).send({ error: 'kein Spielstand' });
    const { updatedAt, ...rest } = s;
    return { ...rest, gespeichert: updatedAt };
  });

  app.put<{ Querystring: { level: string }; Body: Omit<CloudSave, 'level'> }>(
    '/api/spielstand',
    { preHandler: [requireAccount, guard], bodyLimit: BODY_LIMIT, schema: { querystring: query(true), body: saveSchema } },
    async (req) => {
      const t = now();
      await store.put(req.account!.id, { ...req.body, level: req.query.level }, t);
      return { gespeichert: t.toISOString() };
    },
  );

  // Deleting works for blocked accounts too: it only removes their own data.
  app.delete<{ Querystring: { level: string } }>('/api/spielstand', { preHandler: [requireSignedIn, guard], schema: { querystring: query(true) } }, async (req, reply) => {
    await store.delete(req.account!.id, req.query.level);
    return reply.code(204).send();
  });

  if (opts.timer) {
    // once a day the old saves go (reading already hides them)
    let timer: NodeJS.Timeout | undefined;
    let stopped = false;
    const run = async () => {
      try {
        await store.expire(cutoff());
      } catch (err) {
        app.log.warn({ err }, 'cloud save cleanup failed');
      }
      if (!stopped) timer = setTimeout(run, DAY);
    };
    app.addHook('onReady', async () => {
      timer = setTimeout(run, MINUTE);
    });
    app.addHook('onClose', async () => {
      stopped = true;
      clearTimeout(timer);
    });
  }
}
