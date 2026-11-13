import Fastify, { type FastifyInstance } from 'fastify';

/** What the API needs from the database (the real one: src/db.ts). */
export interface Database {
  /** Resolves when the database answers, rejects otherwise. */
  ping(): Promise<void>;
}

export interface AppOptions {
  /** Commit of the running release. */
  version: string;
  db: Database;
  /** Request log (off in tests). */
  logger?: boolean;
}

export function buildApp({ version, db, logger = false }: AppOptions): FastifyInstance {
  const app = Fastify({ logger, bodyLimit: 64 * 1024 });

  // Operations: is the API up and does the database answer? Details stay in the server log.
  app.get('/api/health', async (req, reply) => {
    try {
      await db.ping();
      return { ok: true, version, db: 'ok' };
    } catch (err) {
      req.log.error({ err }, 'database ping failed');
      return reply.code(503).send({ ok: false, version, db: 'fehler' });
    }
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'nicht gefunden' }));

  return app;
}
