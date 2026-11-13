import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type AccountStore, requireAccount, requireAdmin } from './konten.ts';
import { RateLimit } from './limit.ts';
import { LEVEL_ID } from './stats.ts';

// ---------- data model ----------

export const CATEGORIES = ['fehler', 'verbesserung', 'frage', 'level'] as const;
export const STATUSES = ['offen', 'geplant', 'erledigt'] as const;
export type Category = (typeof CATEGORIES)[number];
export type Status = (typeof STATUSES)[number];

export interface Topic {
  id: number;
  accountId: number;
  author: string;
  team: boolean;
  category: Category;
  status: Status;
  title: string;
  level: string | null;
  version: string | null;
  createdAt: Date;
  lastPostAt: Date;
  replies: number;
  votes: number;
  /** The first post is hidden: the topic is hidden for everybody but admins. */
  hidden: boolean;
}

export interface Post {
  id: number;
  topicId: number;
  accountId: number;
  author: string;
  team: boolean;
  first: boolean;
  body: string;
  hidden: boolean;
  createdAt: Date;
}

export interface ReportedPost extends Post {
  topicTitle: string;
  reports: number;
  reasons: string[];
}

export interface TopicFilter {
  category?: Category;
  status?: Status;
  sort: 'neu' | 'stimmen';
  /** Admins also see hidden topics. */
  withHidden: boolean;
  limit: number;
  offset: number;
}

/** Storage for the forum (PostgreSQL: src/forum-db.ts, memory: src/forum-memory.ts). */
export interface ForumStore {
  displayName(accountId: number): Promise<string | null>;
  /** false: the name is taken (ignoring case). */
  setDisplayName(accountId: number, name: string): Promise<boolean>;
  topics(f: TopicFilter): Promise<Topic[]>;
  topic(id: number): Promise<Topic | null>;
  posts(topicId: number): Promise<Post[]>;
  post(id: number): Promise<Post | null>;
  addTopic(t: { accountId: number; team: boolean; category: Category; title: string; body: string; level: string | null; version: string | null; now: Date }): Promise<number>;
  addPost(p: { topicId: number; accountId: number; team: boolean; body: string; now: Date }): Promise<number>;
  /** Posts (topics included) written by the account since a time (limit per account). */
  countPosts(accountId: number, since: Date): Promise<number>;
  countTopics(accountId: number, since: Date): Promise<number>;
  /** Removes a post; the first post removes its whole topic. */
  deletePost(id: number): Promise<void>;
  setVote(topicId: number, accountId: number, on: boolean): Promise<void>;
  /** Topic ids among the given ones that the account voted for. */
  votedBy(accountId: number, topicIds: number[]): Promise<Set<number>>;
  report(postId: number, accountId: number, reason: string, now: Date): Promise<void>;
  setStatus(topicId: number, status: Status): Promise<void>;
  setHidden(postId: number, hidden: boolean, now: Date): Promise<void>;
  /** Removes the reports of a post (admin handled them). */
  clearReports(postId: number): Promise<void>;
  reported(): Promise<ReportedPost[]>;
}

export interface ForumOptions {
  store: ForumStore;
  accounts: AccountStore;
  /** Public address of the game (CSRF check). */
  origin: string;
  now?: () => Date;
}

// ---------- limits and helpers ----------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Per account and hour. */
export const TOPICS_PER_HOUR = 5;
export const POSTS_PER_HOUR = 20;
const PAGE = 30;

/**
 * Plain text as typed: line breaks kept, CR and other control characters dropped, at most two empty
 * lines in a row, trimmed. HTML is not touched here; the page shows text only via textContent.
 */
export function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

const NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,22}[\p{L}\p{N}]$/u;
/** Display name: 3–24 letters, digits, space, dot, underscore, hyphen; starts and ends with a letter or digit. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const n = raw.normalize('NFC').trim().replace(/ {2,}/g, ' ');
  return NAME.test(n) && !/admin|murmel|team|moderat/i.test(n) ? n : null;
}

const LEVEL = new RegExp(LEVEL_ID);
const VERSION = /^[\w.-]{1,40}$/;

function topicJson(t: Topic, voted: boolean, admin: boolean) {
  return {
    id: t.id,
    kategorie: t.category,
    status: t.status,
    titel: t.title,
    autor: t.author,
    team: t.team,
    level: t.level,
    version: t.version,
    erstellt: t.createdAt.toISOString(),
    letzte: t.lastPostAt.toISOString(),
    antworten: t.replies,
    stimmen: t.votes,
    gestimmt: voted,
    ...(admin ? { ausgeblendet: t.hidden, kontoId: t.accountId } : {}),
  };
}

function postJson(p: Post, me: number | null, admin: boolean, blocked?: boolean) {
  return {
    id: p.id,
    autor: p.author,
    team: p.team,
    erster: p.first,
    // hidden posts: only admins see the text
    text: p.hidden && !admin ? null : p.body,
    ausgeblendet: p.hidden,
    erstellt: p.createdAt.toISOString(),
    eigen: me === p.accountId,
    ...(admin ? { kontoId: p.accountId, gesperrt: blocked ?? false } : {}),
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Display name of the signed-in account (forum writes). */
    forumName?: string;
  }
}

// ---------- routes ----------

/** Forum: /api/forum. Reading is open, writing needs an account that is not blocked (requireAccount). */
export function forumRoutes(app: FastifyInstance, opts: ForumOptions): void {
  const { store, accounts, origin, now = () => new Date() } = opts;
  // Per IP, over all writes (topics, replies, votes, reports, admin actions).
  const ipLimit = new RateLimit(40, 15 * MINUTE);

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/forum') || req.method === 'GET' || req.method === 'HEAD') return;
    // CSRF: writes only from the game's own page (the cookie is SameSite=Strict as well).
    if (req.headers.origin !== undefined && req.headers.origin !== origin) return reply.code(403).send({ error: 'fremde Herkunft' });
    // req.account comes from the accounts hook (registered first). Admins moderate without the IP window.
    if (req.account?.role !== 'admin' && !ipLimit.take(req.ip, now().getTime())) return reply.code(429).send({ error: 'Zu viele Anfragen. Bitte warte ein paar Minuten.' });
  });

  const isAdmin = (req: FastifyRequest) => req.account?.role === 'admin';
  const id = { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } } as const;

  /** Writing needs a display name: the forum never shows the mail address. */
  async function requireName(req: FastifyRequest, reply: FastifyReply) {
    const name = await store.displayName(req.account!.id);
    if (!name) return reply.code(409).send({ error: 'Bitte wähle zuerst einen Anzeigenamen.', name: true });
    req.forumName = name;
  }

  async function perHour(req: FastifyRequest, reply: FastifyReply, topic: boolean): Promise<boolean> {
    const since = new Date(now().getTime() - HOUR);
    const a = req.account!.id;
    if (topic && (await store.countTopics(a, since)) >= TOPICS_PER_HOUR) {
      reply.code(429).send({ error: `Höchstens ${TOPICS_PER_HOUR} neue Themen pro Stunde. Bitte versuch es später noch einmal.` });
      return false;
    }
    if ((await store.countPosts(a, since)) >= POSTS_PER_HOUR) {
      reply.code(429).send({ error: `Höchstens ${POSTS_PER_HOUR} Beiträge pro Stunde. Bitte versuch es später noch einmal.` });
      return false;
    }
    return true;
  }

  /** Visible topic or 404 (hidden ones only for admins). */
  async function visibleTopic(req: FastifyRequest, reply: FastifyReply, topicId: number) {
    const t = await store.topic(topicId);
    if (!t || (t.hidden && !isAdmin(req))) {
      reply.code(404).send({ error: 'Dieses Thema gibt es nicht (mehr).' });
      return null;
    }
    return t;
  }

  // Who am I in the forum? Always 200.
  app.get('/api/forum/ich', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const a = req.account;
    if (!a) return { angemeldet: false };
    return { angemeldet: true, name: await store.displayName(a.id), admin: a.role === 'admin', gesperrt: a.blocked };
  });

  app.put<{ Body: { name: string } }>(
    '/api/forum/name',
    { preHandler: requireAccount, schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: { type: 'string', maxLength: 60 } } } } },
    async (req, reply) => {
      const name = cleanName(req.body.name);
      if (!name) return reply.code(400).send({ error: 'Der Name braucht 3 bis 24 Zeichen: Buchstaben, Ziffern, Leerzeichen, Punkt, Strich. Namen wie „Admin“ oder „Team“ sind vergeben.' });
      if (!(await store.setDisplayName(req.account!.id, name))) return reply.code(409).send({ error: 'Diesen Namen hat schon jemand. Bitte wähle einen anderen.' });
      return { name };
    },
  );

  app.get<{ Querystring: { kategorie?: string; status?: string; sort?: string; seite?: string } }>('/api/forum/themen', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const q = req.query;
    const category = CATEGORIES.find((c) => c === q.kategorie);
    const status = STATUSES.find((s) => s === q.status);
    const page = Math.min(Math.max(Math.trunc(Number(q.seite ?? 1)) || 1, 1), 1000);
    const admin = isAdmin(req);
    const list = await store.topics({ category, status, sort: q.sort === 'stimmen' ? 'stimmen' : 'neu', withHidden: admin, limit: PAGE + 1, offset: (page - 1) * PAGE });
    const shown = list.slice(0, PAGE);
    const voted = req.account ? await store.votedBy(req.account.id, shown.map((t) => t.id)) : new Set<number>();
    return { themen: shown.map((t) => topicJson(t, voted.has(t.id), admin)), weitere: list.length > PAGE, seite: page };
  });

  app.get<{ Params: { id: number } }>('/api/forum/themen/:id', { schema: { params: id } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const t = await visibleTopic(req, reply, req.params.id);
    if (!t) return reply;
    const admin = isAdmin(req);
    const me = req.account?.id ?? null;
    const posts = await store.posts(t.id);
    const blocked = new Map<number, boolean>();
    if (admin) {
      for (const a of new Set(posts.map((p) => p.accountId))) blocked.set(a, (await accounts.account(a))?.blocked ?? false);
    }
    const voted = me !== null && (await store.votedBy(me, [t.id])).has(t.id);
    return { thema: topicJson(t, voted, admin), beitraege: posts.map((p) => postJson(p, me, admin, blocked.get(p.accountId))) };
  });

  app.post<{ Body: { kategorie: Category; titel: string; text: string; level?: string; version?: string } }>(
    '/api/forum/themen',
    {
      preHandler: [requireAccount, requireName],
      schema: {
        body: {
          type: 'object',
          required: ['kategorie', 'titel', 'text'],
          additionalProperties: false,
          properties: {
            kategorie: { enum: [...CATEGORIES] },
            titel: { type: 'string', maxLength: 200 },
            text: { type: 'string', maxLength: 6000 },
            level: { type: 'string', maxLength: 120 },
            version: { type: 'string', maxLength: 40 },
          },
        },
      },
    },
    async (req, reply) => {
      const title = cleanText(req.body.titel).replace(/\s+/g, ' ');
      const body = cleanText(req.body.text);
      if (title.length < 3 || title.length > 120) return reply.code(400).send({ error: 'Der Titel braucht 3 bis 120 Zeichen.' });
      if (body.length < 1 || body.length > 5000) return reply.code(400).send({ error: 'Der Text braucht 1 bis 5000 Zeichen.' });
      const level = req.body.level && LEVEL.test(req.body.level) ? req.body.level : null;
      const version = req.body.version && VERSION.test(req.body.version) ? req.body.version : null;
      if (!(await perHour(req, reply, true))) return reply;
      const a = req.account!;
      const topicId = await store.addTopic({ accountId: a.id, team: a.role === 'admin', category: req.body.kategorie, title, body, level, version, now: now() });
      return reply.code(201).send({ id: topicId });
    },
  );

  app.post<{ Params: { id: number }; Body: { text: string } }>(
    '/api/forum/themen/:id/antworten',
    {
      preHandler: [requireAccount, requireName],
      schema: { params: id, body: { type: 'object', required: ['text'], additionalProperties: false, properties: { text: { type: 'string', maxLength: 6000 } } } },
    },
    async (req, reply) => {
      const t = await visibleTopic(req, reply, req.params.id);
      if (!t) return reply;
      const body = cleanText(req.body.text);
      if (body.length < 1 || body.length > 5000) return reply.code(400).send({ error: 'Der Text braucht 1 bis 5000 Zeichen.' });
      if (!(await perHour(req, reply, false))) return reply;
      const a = req.account!;
      const postId = await store.addPost({ topicId: t.id, accountId: a.id, team: a.role === 'admin', body, now: now() });
      return reply.code(201).send({ id: postId });
    },
  );

  // Thumbs up: one account, one vote. { an: false } takes it back.
  app.post<{ Params: { id: number }; Body: { an: boolean } }>(
    '/api/forum/themen/:id/stimme',
    { preHandler: requireAccount, schema: { params: id, body: { type: 'object', required: ['an'], additionalProperties: false, properties: { an: { type: 'boolean' } } } } },
    async (req, reply) => {
      const t = await visibleTopic(req, reply, req.params.id);
      if (!t) return reply;
      await store.setVote(t.id, req.account!.id, req.body.an);
      const after = await store.topic(t.id);
      return { stimmen: after?.votes ?? 0, gestimmt: req.body.an };
    },
  );

  app.post<{ Params: { id: number }; Body: { grund?: string } | undefined }>(
    '/api/forum/beitraege/:id/melden',
    { preHandler: requireAccount, schema: { params: id, body: { type: ['object', 'null'], additionalProperties: false, properties: { grund: { type: 'string', maxLength: 400 } } } } },
    async (req, reply) => {
      const p = await store.post(req.params.id);
      if (!p || (p.hidden && !isAdmin(req))) return reply.code(404).send({ error: 'Diesen Beitrag gibt es nicht (mehr).' });
      await store.report(p.id, req.account!.id, cleanText(req.body?.grund ?? '').slice(0, 300), now());
      return { gemeldet: true };
    },
  );

  // Delete one's own post (the first one deletes the topic with its replies). Blocked accounts may too.
  app.delete<{ Params: { id: number } }>('/api/forum/beitraege/:id', { schema: { params: id } }, async (req, reply) => {
    if (!req.account) return reply.code(401).send({ error: 'nicht angemeldet' });
    const p = await store.post(req.params.id);
    if (!p) return reply.code(404).send({ error: 'Diesen Beitrag gibt es nicht (mehr).' });
    if (p.accountId !== req.account.id) return reply.code(403).send({ error: 'Nur eigene Beiträge lassen sich löschen.' });
    await store.deletePost(p.id);
    return { geloescht: true, thema: p.first };
  });

  // ---------- admins ----------

  app.put<{ Params: { id: number }; Body: { status: Status } }>(
    '/api/forum/themen/:id/status',
    { preHandler: requireAdmin, schema: { params: id, body: { type: 'object', required: ['status'], additionalProperties: false, properties: { status: { enum: [...STATUSES] } } } } },
    async (req, reply) => {
      if (!(await store.topic(req.params.id))) return reply.code(404).send({ error: 'Dieses Thema gibt es nicht (mehr).' });
      await store.setStatus(req.params.id, req.body.status);
      return { status: req.body.status };
    },
  );

  // Hide or show a post again; handles its reports. Hiding the first post hides the topic.
  app.put<{ Params: { id: number }; Body: { ausgeblendet: boolean } }>(
    '/api/forum/beitraege/:id/ausgeblendet',
    { preHandler: requireAdmin, schema: { params: id, body: { type: 'object', required: ['ausgeblendet'], additionalProperties: false, properties: { ausgeblendet: { type: 'boolean' } } } } },
    async (req, reply) => {
      if (!(await store.post(req.params.id))) return reply.code(404).send({ error: 'Diesen Beitrag gibt es nicht (mehr).' });
      await store.setHidden(req.params.id, req.body.ausgeblendet, now());
      await store.clearReports(req.params.id);
      return { ausgeblendet: req.body.ausgeblendet };
    },
  );

  // Reports checked, post stays as it is.
  app.delete<{ Params: { id: number } }>('/api/forum/beitraege/:id/meldungen', { preHandler: requireAdmin, schema: { params: id } }, async (req) => {
    await store.clearReports(req.params.id);
    return { erledigt: true };
  });

  app.get('/api/forum/meldungen', { preHandler: requireAdmin }, async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const list = await store.reported();
    return {
      meldungen: list.map((p) => ({ ...postJson(p, null, true), themaId: p.topicId, thema: p.topicTitle, anzahl: p.reports, gruende: p.reasons })),
    };
  });

  // Block or unblock an account: it can still read, sign in and delete itself, but write nothing.
  app.put<{ Params: { id: number }; Body: { gesperrt: boolean } }>(
    '/api/forum/konten/:id/gesperrt',
    { preHandler: requireAdmin, schema: { params: id, body: { type: 'object', required: ['gesperrt'], additionalProperties: false, properties: { gesperrt: { type: 'boolean' } } } } },
    async (req, reply) => {
      const target = await accounts.account(req.params.id);
      if (!target) return reply.code(404).send({ error: 'Dieses Konto gibt es nicht (mehr).' });
      if (target.role === 'admin') return reply.code(400).send({ error: 'Admins lassen sich nicht sperren.' });
      await accounts.setBlocked(target.id, req.body.gesperrt, now());
      return { gesperrt: req.body.gesperrt };
    },
  );
}
