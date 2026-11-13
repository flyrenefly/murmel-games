import type { FastifyInstance } from 'fastify';
import { TOP, type LeaderboardStore } from './bestenliste.ts';
import { type AccountStore, requireSignedIn } from './konten.ts';
import type { Recording } from './loesbarkeit.ts';
import { LEVEL_ID } from './stats.ts';

/**
 * Geister (docs/SPEC-geister.md): leaderboard runs played along as a see-through marble. The own run is
 * always available; other players' runs only if they switched on "Meine Läufe als Geist zeigen"
 * (Nutzerentscheidung 13.11.2026) and are not blocked. No new recordings: they stay in the leaderboard.
 */

export interface GhostStore {
  consent(accountId: number): Promise<boolean>;
  setConsent(accountId: number, on: boolean, now: Date): Promise<void>;
  /** Of these accounts, the ones that show their runs. */
  consenting(accountIds: number[]): Promise<Set<number>>;
  /** Owner and recording of a leaderboard entry. */
  run(entryId: number): Promise<{ accountId: number; level: string; recording: Recording } | null>;
}

/** Other players' ghosts offered per level (best places first). */
export const GHOSTS_PER_LEVEL = 10;

export function ghostRoutes(app: FastifyInstance, opts: { store: GhostStore; leaderboard: LeaderboardStore; accounts: AccountStore; origin: string; now: () => Date }): void {
  const { store, leaderboard, accounts, origin, now } = opts;

  app.get('/api/geister/freigabe', { preHandler: requireSignedIn }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { an: await store.consent(req.account!.id) };
  });

  app.put<{ Body: { an: boolean } }>(
    '/api/geister/freigabe',
    {
      preHandler: requireSignedIn,
      schema: { body: { type: 'object', required: ['an'], additionalProperties: false, properties: { an: { type: 'boolean' } } } },
    },
    async (req, reply) => {
      // CSRF: writes only from the game's own page (SameSite=Strict as a second fence)
      if (req.headers.origin !== undefined && req.headers.origin !== origin) return reply.code(403).send({ error: 'fremde Herkunft' });
      await store.setConsent(req.account!.id, req.body.an, now());
      return reply.code(204).send();
    },
  );

  app.get<{ Querystring: { id?: string } }>(
    '/api/geister/level',
    { schema: { querystring: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: LEVEL_ID } } } } },
    async (req, reply) => {
      const me = req.account?.id ?? null;
      const { entries } = await leaderboard.ranking(req.query.id!, TOP, me);
      const shown = await store.consenting(entries.filter((e) => e.accountId !== me).map((e) => e.accountId));
      let others = 0;
      const geister = [];
      for (const e of entries) {
        const ich = e.accountId === me;
        if (!ich && (!shown.has(e.accountId) || ++others > GHOSTS_PER_LEVEL)) continue;
        geister.push({ id: e.id, name: e.name, zeit: e.steps, platz: e.rank, ich });
      }
      reply.header('Cache-Control', 'no-store');
      return { geister };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/geister/lauf/:id',
    { schema: { params: { type: 'object', properties: { id: { type: 'string', pattern: '^[1-9][0-9]{0,15}$' } } } } },
    async (req, reply) => {
      const run = await store.run(Number(req.params.id));
      const own = run !== null && run.accountId === req.account?.id;
      if (!run || (!own && !((await store.consent(run.accountId)) && (await accounts.account(run.accountId))?.blocked === false))) {
        return reply.code(404).send({ error: 'Diesen Lauf gibt es nicht als Geist.' });
      }
      reply.header('Cache-Control', 'private, max-age=300');
      return run.recording;
    },
  );
}
