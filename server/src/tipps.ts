import type { FastifyInstance } from 'fastify';
import { RateLimit } from './limit.ts';
import { parseRecording, type SolvabilityStore } from './loesbarkeit.ts';
import { LEVEL_ID } from './stats.ts';

/**
 * Tipps (docs/SPEC-tipps.md): admin solutions of a level for everyone, so the game can show the next step
 * of a player who is stuck. Only the recording goes out (its known fields): no account, id or date.
 */

/** Solutions per answer: the game takes the first one that still wins. */
export const SOLUTIONS_PER_LEVEL = 3;
export const REQUESTS_PER_MINUTE = 60;

export function tipRoutes(app: FastifyInstance, opts: { store: SolvabilityStore; now?: () => number }): void {
  const { store, now = () => Date.now() } = opts;
  const limit = new RateLimit(REQUESTS_PER_MINUTE, 60_000);

  app.get<{ Querystring: { level?: string } }>(
    '/api/tipps/loesungen',
    { schema: { querystring: { type: 'object', required: ['level'], properties: { level: { type: 'string', pattern: LEVEL_ID } } } } },
    async (req, reply) => {
      if (!limit.take(req.ip, now())) return reply.code(429).send({ error: 'zu viele Anfragen' });
      const loesungen = (await store.levelSolutions(req.query.level!, SOLUTIONS_PER_LEVEL)).map(parseRecording).filter((r) => typeof r !== 'string');
      reply.header('Cache-Control', 'public, max-age=3600');
      return { loesungen };
    },
  );
}
