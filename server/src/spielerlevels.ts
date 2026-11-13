import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CheckQueue, type Checker, type LevelJson, levelHashOf, OPEN_PER_ACCOUNT, parseRun, QUEUE_MAX, type QueueState, sameVersion } from './bestenliste.ts';
import { cleanText } from './forum.ts';
import { type Account, type Mailer, requireAccount, requireAdmin, requireSignedIn } from './konten.ts';
import { RateLimit } from './limit.ts';
import type { Recording } from './loesbarkeit.ts';

/**
 * Spieler-Levels (docs/SPEC-spielerlevels.md): levels from the editor, uploaded with the author's own
 * solution. The checker process keeps only editor content and replays the solution; an admin releases
 * the level before others see it. Ratings only from players who solved it (a checked leaderboard run).
 */

// ---------- data model ----------

export const LICENSE = 'CC-BY-SA-4.0';
export const STATUSES = ['wartet', 'frei', 'abgelehnt', 'zurueckgezogen', 'ersetzt'] as const;
export type LevelStatus = (typeof STATUSES)[number];

export interface PlayerLevel {
  id: number;
  accountId: number;
  /** Display name of the author (null: none chosen). */
  author: string | null;
  authorBlocked: boolean;
  title: string;
  description: string;
  /** The checked level (without id and author); only from level(). */
  file?: LevelJson;
  width: number;
  height: number;
  /** Steps of the author's solution (replayed). */
  steps: number;
  status: LevelStatus;
  reason: string | null;
  replaces: number | null;
  createdAt: Date;
  publishedAt: Date | null;
  /** Mean rating, null without votes. */
  stars: number | null;
  votes: number;
  /** Open reports (not dismissed). */
  reports: number;
}

export interface ReportedLevel extends PlayerLevel {
  reasons: string[];
}

export interface ListFilter {
  search: string;
  sort: 'neu' | 'beliebt';
  limit: number;
  offset: number;
}

/** Storage (PostgreSQL: src/spielerlevels-db.ts, memory: src/spielerlevels-memory.ts). */
export interface PlayerLevelStore {
  displayName(accountId: number): Promise<string | null>;
  /** Levels the account uploaded since a time (all statuses, deleted ones not). */
  countUploads(accountId: number, since: Date): Promise<number>;
  countWaiting(accountId: number): Promise<number>;
  /** Stores a checked level as 'wartet'. `replaces` only if it is one of the account's own levels. */
  create(l: { accountId: number; title: string; description: string; file: LevelJson; levelHash: string; recording: Recording; steps: number; replaces: number | null; now: Date }): Promise<number>;
  level(id: number): Promise<PlayerLevel | null>;
  /** Public list: released, not reported, author not blocked. */
  list(f: ListFilter): Promise<PlayerLevel[]>;
  mine(accountId: number): Promise<PlayerLevel[]>;
  /** Admins: waiting levels and levels with open reports (with their reasons). */
  pending(): Promise<ReportedLevel[]>;
  /**
   * Sets the status. 'frei' also sets published_at (first time) and the replaced level to 'ersetzt';
   * a decision by an admin (`review`) also dismisses the open reports. 'wartet' asks for a new mail.
   */
  setStatus(id: number, status: LevelStatus, reason: string | null, now: Date, review: boolean): Promise<void>;
  remove(id: number): Promise<boolean>;
  /** The account has a checked leaderboard run of the level ('spieler:<id>'). */
  solved(accountId: number, levelId: number): Promise<boolean>;
  rate(levelId: number, accountId: number, stars: number, now: Date): Promise<{ stars: number | null; votes: number }>;
  rating(levelId: number, accountId: number): Promise<number | null>;
  /** false: this account reported the level already. */
  report(levelId: number, accountId: number, reason: string, now: Date): Promise<boolean>;
  dismissReports(levelId: number, now: Date): Promise<void>;
  /** Waiting levels the admins got no mail about yet. */
  unnotified(): Promise<{ id: number; title: string; author: string | null }[]>;
  lastNotified(): Promise<Date | null>;
  markNotified(ids: number[], now: Date): Promise<void>;
}

export interface PlayerLevelOptions {
  store: PlayerLevelStore;
  checker: Checker;
  /** Shared with the leaderboard (one checker process). */
  queue?: CheckQueue;
  /** Version of the running game (MURMEL_VERSION). */
  version: string;
  /** Public address of the game (CSRF check, links in mails). */
  origin: string;
  mailer: Mailer | null;
  adminEmails: string[];
  now?: () => Date;
}

// ---------- limits ----------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const BODY_LIMIT = 2 * 1024 * 1024;
export const MAX_LEVEL_BYTES = 256 * 1024;
export const UPLOADS_PER_DAY = 5;
/** Checks per account and day, rejected ones included (they leave no row behind). */
export const CHECKS_PER_DAY = 20;
export const WAITING_PER_ACCOUNT = 5;
export const ACTIONS_PER_15_MIN = 30;
export const MAIL_EVERY_MS = HOUR;
const MAIL_POLL_MS = 10 * MINUTE;
const PAGE = 30;
const NO_NAME = 'Spieler ohne Namen';
/** Fields of a LevelFile the editor makes; anything else (lua, docs …) is refused. */
const LEVEL_KEYS = new Set(['id', 'title', 'author', 'license', 'map', 'legend', 'start', 'objects', 'actors']);
const RECORDED_ID = /^(link|spieler):[A-Za-z0-9]{1,40}$/;

const chars = (s: string) => [...s].length;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** One line of text: control characters dropped, spaces collapsed, trimmed. */
// eslint-disable-next-line no-control-regex
const line = (v: string) => v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s{2,}/g, ' ').trim();

export interface Upload {
  level: LevelJson;
  recording: Recording;
  title: string;
  description: string;
  replaces: number | null;
  version: string | null;
}

/** Checks the upload request (form, size, licence, texts); the level itself is checked by the checker. */
export function parseUpload(body: unknown): Upload | string {
  if (!isObj(body)) return 'Anfrage ungültig';
  const level = body.level;
  if (!isObj(level)) return 'Das Level fehlt.';
  if (Buffer.byteLength(JSON.stringify(level)) > MAX_LEVEL_BYTES) return 'Das Level ist zu groß (höchstens 256 KB).';
  for (const k of Object.keys(level)) if (!LEVEL_KEYS.has(k)) return `Unbekannte Angabe „${line(k).slice(0, 20)}“: Spieler-Levels enthalten nur, was der Editor baut (kein Lua).`;
  const map = level.map;
  if (!Array.isArray(map) || map.length < 1 || map.length > 40 || !map.every((r) => typeof r === 'string' && r.length >= 1 && r.length <= 60)) return 'Die Karte fehlt oder ist größer als 60×40.';
  if (level.license !== LICENSE || body.lizenz !== LICENSE) return 'Spieler-Levels stehen unter CC BY-SA 4.0 – bitte die Lizenz bestätigen.';
  const title = typeof body.titel === 'string' ? line(body.titel) : '';
  if (chars(title) < 3 || chars(title) > 60) return 'Der Titel braucht 3 bis 60 Zeichen.';
  const description = typeof body.beschreibung === 'string' ? cleanText(body.beschreibung) : body.beschreibung === undefined ? '' : null;
  if (description === null || chars(description) > 500) return 'Die Beschreibung darf höchstens 500 Zeichen haben.';
  const rec = parseRun(body.loesung);
  if (typeof rec === 'string') return `Lösung: ${rec === 'nur gewonnene Läufe kommen in die Bestenliste' ? 'nur ein gewonnener Lauf ist eine Lösung' : rec}`;
  if (!RECORDED_ID.test(rec.level)) return 'Die Lösung gehört nicht zu einem Level aus dem Editor.';
  const r = body.ersetzt;
  if (r !== undefined && r !== null && !(Number.isInteger(r) && (r as number) > 0)) return 'Ungültige Angabe „ersetzt“.';
  const version = typeof body.version === 'string' ? body.version.slice(0, 40) : null;
  return { level, recording: rec, title, description, replaces: (r as number | undefined) ?? null, version };
}

/** May this account see (and play) the level? Others see released, unreported levels of unblocked authors. */
export function visibleTo(l: PlayerLevel, a: Pick<Account, 'id' | 'role'> | null | undefined): boolean {
  if (a && (a.role === 'admin' || a.id === l.accountId)) return true;
  return l.status === 'frei' && l.reports === 0 && !l.authorBlocked;
}

/** The level as the game loads it: id 'spieler:<n>', title, author (display name) and licence. */
export function playableFile(l: PlayerLevel): LevelJson {
  return { ...l.file, id: `spieler:${l.id}`, title: l.title, author: l.author ?? NO_NAME, license: LICENSE };
}

/** For the leaderboard: the checked level of 'spieler:<n>' if the account may play it. */
export function playerFileFor(store: PlayerLevelStore) {
  return async (level: string, account: { id: number; role: string }): Promise<LevelJson | null> => {
    const m = /^spieler:([1-9][0-9]{0,15})$/.exec(level);
    if (!m) return null;
    const l = await store.level(Number(m[1]));
    return l && visibleTo(l, account as Account) ? playableFile(l) : null;
  };
}

function card(l: PlayerLevel) {
  return {
    id: l.id,
    titel: l.title,
    beschreibung: l.description,
    autor: l.author ?? NO_NAME,
    datum: (l.publishedAt ?? l.createdAt).toISOString(),
    sterne: l.stars === null ? null : Math.round(l.stars * 10) / 10,
    stimmen: l.votes,
    breite: l.width,
    hoehe: l.height,
    lizenz: LICENSE,
  };
}

/** Own levels and the admin view: status, reason, the author's time and the open reports too. */
function fullCard(l: PlayerLevel) {
  return { ...card(l), status: l.status, grund: l.reason, zeit: l.steps, ersetzt: l.replaces, meldungen: l.reports, erstellt: l.createdAt.toISOString(), gesperrt: l.authorBlocked };
}

/** Mail to the admins about new waiting levels: at most one per MAIL_EVERY_MS, all new ones in it. */
export async function notifyAdmins(o: Pick<PlayerLevelOptions, 'store' | 'mailer' | 'adminEmails' | 'origin'> & { now: Date }): Promise<number> {
  if (!o.mailer || o.adminEmails.length === 0) return 0;
  const last = await o.store.lastNotified();
  if (last && o.now.getTime() - last.getTime() < MAIL_EVERY_MS) return 0;
  const fresh = await o.store.unnotified();
  if (!fresh.length) return 0;
  const n = fresh.length;
  const subject = n === 1 ? 'Murmel: ein neues Spieler-Level wartet auf Freigabe' : `Murmel: ${n} neue Spieler-Levels warten auf Freigabe`;
  const text = [
    `${n === 1 ? 'Ein neues Spieler-Level wartet' : `${n} neue Spieler-Levels warten`} auf Freigabe:`,
    '',
    ...fresh.slice(0, 20).map((l) => `- ${l.title} (von ${l.author ?? NO_NAME})`),
    ...(n > 20 ? [`- und ${n - 20} weitere`] : []),
    '',
    `Probespielen und freigeben: ${o.origin}/spielerlevels.html#freigabe`,
  ].join('\n');
  // mark first: a slow or failing SMTP server must not send the same mail twice
  await o.store.markNotified(fresh.map((l) => l.id), o.now);
  for (const to of o.adminEmails) await o.mailer.send(to, subject, text).catch(() => {});
  return n;
}

// ---------- routes ----------

/** /api/spielerlevels (players) and /api/admin/spielerlevels (admins). Returns the queue (tests). */
export function playerLevelRoutes(app: FastifyInstance, opts: PlayerLevelOptions): CheckQueue {
  const { store, checker, version, origin, now = () => new Date() } = opts;
  const queue = opts.queue ?? new CheckQueue(1, () => now().getTime());
  const checksPerDay = new RateLimit(CHECKS_PER_DAY, DAY);
  const actionLimit = new RateLimit(ACTIONS_PER_15_MIN, 15 * MINUTE);
  const notify = () => notifyAdmins({ ...opts, now: now() }).catch((err) => app.log.error({ err }, 'player level mail failed'));
  const timer = setInterval(notify, MAIL_POLL_MS);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));

  app.addHook('onRequest', async (req, reply) => {
    if (!(req.url.startsWith('/api/spielerlevels') || req.url.startsWith('/api/admin/spielerlevels')) || req.method === 'GET' || req.method === 'HEAD') return;
    // CSRF: writes only from the game's own page (the cookie is SameSite=Strict as well).
    if (req.headers.origin !== undefined && req.headers.origin !== origin) return reply.code(403).send({ error: 'fremde Herkunft' });
  });

  const idParam = { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1, maximum: 2 ** 53 - 1 } } } as const;
  const isAdmin = (req: FastifyRequest) => req.account?.role === 'admin';

  async function accountActions(req: FastifyRequest, reply: FastifyReply) {
    if (req.account && !isAdmin(req) && !actionLimit.take(String(req.account.id), now().getTime())) return reply.code(429).send({ error: 'Zu viele Klicks. Bitte warte ein paar Minuten.' });
  }

  /** The level if this request may see it, else 404. */
  async function visible(req: FastifyRequest, reply: FastifyReply, id: number): Promise<PlayerLevel | null> {
    const l = await store.level(id);
    if (!l || !visibleTo(l, req.account)) {
      reply.code(404).send({ error: 'Dieses Level gibt es nicht (mehr).' });
      return null;
    }
    return l;
  }

  /** Replays the upload; a win stores the checked level as 'wartet'. */
  async function judge(accountId: number, u: Upload): Promise<QueueState> {
    const r = await checker.checkLevel!(u.level, u.recording);
    if (r.status === 'ungueltig') return { status: 'abgelehnt', grund: r.error ?? 'Das Level ist ungültig.' };
    if (r.status !== 'geloest' || !r.file) {
      if (u.version && !sameVersion(u.version, version)) return { status: 'abgelehnt', grund: 'Dein Spiel ist nicht auf dem neuesten Stand – bitte die Seite neu laden.' };
      if (r.status === 'fehler' && /Zeitüberschreitung/.test(r.error ?? '')) return { status: 'abgelehnt', grund: 'Die Prüfung dauerte zu lange.' };
      if (r.status === 'fehler') return { status: 'abgelehnt', grund: 'Die Lösung ließ sich nicht nachspielen.' };
      return { status: 'abgelehnt', grund: 'Beim Nachspielen löst deine Aufzeichnung dieses Level nicht. Spiel es im Editor noch einmal probe und veröffentliche es danach.' };
    }
    // the stored level: checked content, the upload's title; id and author are set on delivery
    const { id: _id, author: _author, ...rest } = r.file;
    const file: LevelJson = { ...rest, title: u.title, license: LICENSE };
    const id = await store.create({ accountId, title: u.title, description: u.description, file, levelHash: levelHashOf(file), recording: u.recording, steps: r.steps, replaces: u.replaces, now: now() });
    void notify();
    return { status: 'angenommen', level: id };
  }

  app.post<{ Body: Record<string, unknown> }>('/api/spielerlevels', { preHandler: requireAccount, bodyLimit: BODY_LIMIT }, async (req, reply) => {
    if (!checker.available() || !checker.checkLevel) return reply.code(503).send({ error: 'Hochladen ist gerade nicht verfügbar. Bitte versuch es später noch einmal.' });
    const u = parseUpload(req.body);
    if (typeof u === 'string') return reply.code(400).send({ error: u });
    const a = req.account!;
    // CC BY-SA asks for the author's name: the display name, never the mail address
    if (!(await store.displayName(a.id))) return reply.code(409).send({ error: 'Bitte wähle zuerst einen Anzeigenamen – er steht als Autor beim Level.', name: true });
    if (u.replaces !== null) {
      const old = await store.level(u.replaces);
      if (!old || old.accountId !== a.id) return reply.code(400).send({ error: 'Eine neue Version geht nur für eigene Levels.' });
    }
    if (a.role !== 'admin') {
      if ((await store.countUploads(a.id, new Date(now().getTime() - DAY))) >= UPLOADS_PER_DAY) return reply.code(429).send({ error: `Höchstens ${UPLOADS_PER_DAY} Levels pro Tag. Bitte versuch es morgen noch einmal.` });
      if ((await store.countWaiting(a.id)) >= WAITING_PER_ACCOUNT) return reply.code(429).send({ error: `Es warten schon ${WAITING_PER_ACCOUNT} Levels von dir auf Freigabe. Bitte warte, bis ein Admin sie angesehen hat.` });
    }
    if (queue.open(a.id) >= OPEN_PER_ACCOUNT) return reply.code(429).send({ error: 'Es wird schon etwas von dir geprüft. Bitte einen Moment warten.' });
    if (queue.open() >= QUEUE_MAX) return reply.code(503).send({ error: 'Gerade ist viel los. Bitte versuch es später noch einmal.' });
    if (a.role !== 'admin' && !checksPerDay.take(String(a.id), now().getTime())) return reply.code(429).send({ error: 'Heute wurden schon viele Prüfungen von dir gestartet. Bitte versuch es morgen noch einmal.' });
    const id = queue.add(a.id, () => judge(a.id, u));
    return reply.code(202).send({ id });
  });

  app.get<{ Params: { id: string } }>(
    '/api/spielerlevels/pruefung/:id',
    { preHandler: requireAccount, schema: { params: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-z0-9]{1,40}$' } } } } },
    async (req, reply) => {
      const job = queue.get(req.params.id);
      if (!job || job.accountId !== req.account!.id) return reply.code(404).send({ error: 'Prüfung nicht gefunden – vielleicht wurde der Server neu gestartet.' });
      reply.header('Cache-Control', 'no-store');
      return job.state;
    },
  );

  app.get<{ Querystring: { suche?: string; sort?: string; seite?: string } }>(
    '/api/spielerlevels',
    { schema: { querystring: { type: 'object', properties: { suche: { type: 'string', maxLength: 60 }, sort: { enum: ['neu', 'beliebt'] }, seite: { type: 'string', pattern: '^[1-9][0-9]{0,4}$' } } } } },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      const page = Number(req.query.seite ?? 1);
      const rows = await store.list({ search: line(req.query.suche ?? ''), sort: req.query.sort === 'beliebt' ? 'beliebt' : 'neu', limit: PAGE + 1, offset: (page - 1) * PAGE });
      return { levels: rows.slice(0, PAGE).map(card), mehr: rows.length > PAGE };
    },
  );

  app.get('/api/spielerlevels/meine', { preHandler: requireSignedIn }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { levels: (await store.mine(req.account!.id)).map(fullCard) };
  });

  app.get<{ Params: { id: number } }>('/api/spielerlevels/:id', { schema: { params: idParam } }, async (req, reply) => {
    const l = await visible(req, reply, req.params.id);
    if (!l) return reply;
    reply.header('Cache-Control', 'no-store');
    const a = req.account;
    const own = !!a && a.id === l.accountId;
    const solved = !!a && !own && !a.blocked && (await store.solved(a.id, l.id));
    return {
      ...(own || isAdmin(req) ? fullCard(l) : card(l)),
      eigen: own,
      admin: isAdmin(req),
      meineSterne: a ? await store.rating(l.id, a.id) : null,
      darfBewerten: solved && l.status === 'frei',
    };
  });

  app.get<{ Params: { id: number } }>('/api/spielerlevels/:id/datei', { schema: { params: idParam } }, async (req, reply) => {
    const l = await visible(req, reply, req.params.id);
    if (!l) return reply;
    reply.header('Cache-Control', 'no-store');
    return playableFile(l);
  });

  app.put<{ Params: { id: number }; Body: { sterne: number } }>(
    '/api/spielerlevels/:id/bewertung',
    { preHandler: [requireAccount, accountActions], schema: { params: idParam, body: { type: 'object', required: ['sterne'], additionalProperties: false, properties: { sterne: { type: 'integer', minimum: 1, maximum: 5 } } } } },
    async (req, reply) => {
      const l = await visible(req, reply, req.params.id);
      if (!l) return reply;
      const a = req.account!;
      if (l.accountId === a.id) return reply.code(403).send({ error: 'Eigene Levels kannst du nicht bewerten.' });
      if (l.status !== 'frei') return reply.code(409).send({ error: 'Bewerten geht erst nach der Freigabe.' });
      if (!(await store.solved(a.id, l.id))) return reply.code(403).send({ error: 'Bewerten kann, wer das Level gelöst hat – angemeldet, mit einem geprüften Lauf in der Bestenliste.' });
      const r = await store.rate(l.id, a.id, req.body.sterne, now());
      return { sterne: r.stars === null ? null : Math.round(r.stars * 10) / 10, stimmen: r.votes, meineSterne: req.body.sterne };
    },
  );

  app.post<{ Params: { id: number }; Body: { grund: string } }>(
    '/api/spielerlevels/:id/meldung',
    { preHandler: [requireAccount, accountActions], schema: { params: idParam, body: { type: 'object', required: ['grund'], additionalProperties: false, properties: { grund: { type: 'string', maxLength: 400 } } } } },
    async (req, reply) => {
      const l = await visible(req, reply, req.params.id);
      if (!l) return reply;
      if (l.accountId === req.account!.id) return reply.code(400).send({ error: 'Eigene Levels kannst du zurückziehen oder löschen.' });
      const reason = [...cleanText(req.body.grund)].slice(0, 300).join('');
      if (chars(reason) < 3) return reply.code(400).send({ error: 'Bitte nenne kurz den Grund (mindestens 3 Zeichen).' });
      if (!(await store.report(l.id, req.account!.id, reason, now()))) return reply.code(409).send({ error: 'Du hast dieses Level schon gemeldet.' });
      return reply.code(204).send();
    },
  );

  // The author withdraws a level (others no longer see it) or submits it again (new release needed).
  app.put<{ Params: { id: number }; Body: { status: 'zurueckgezogen' | 'wartet' } }>(
    '/api/spielerlevels/:id/status',
    { preHandler: requireAccount, schema: { params: idParam, body: { type: 'object', required: ['status'], additionalProperties: false, properties: { status: { enum: ['zurueckgezogen', 'wartet'] } } } } },
    async (req, reply) => {
      const l = await store.level(req.params.id);
      if (!l || l.accountId !== req.account!.id) return reply.code(404).send({ error: 'Dieses Level gibt es nicht (mehr).' });
      const want = req.body.status;
      const ok = want === 'zurueckgezogen' ? l.status === 'wartet' || l.status === 'frei' : l.status === 'zurueckgezogen';
      if (!ok) return reply.code(409).send({ error: want === 'zurueckgezogen' ? 'Dieses Level lässt sich nicht zurückziehen.' : 'Nur zurückgezogene Levels lassen sich wieder einreichen.' });
      if (want === 'wartet' && req.account!.role !== 'admin' && (await store.countWaiting(l.accountId)) >= WAITING_PER_ACCOUNT) {
        return reply.code(429).send({ error: `Es warten schon ${WAITING_PER_ACCOUNT} Levels von dir auf Freigabe.` });
      }
      await store.setStatus(l.id, want, null, now(), false);
      if (want === 'wartet') void notify();
      return reply.code(204).send();
    },
  );

  // Delete for good: the author (blocked ones too) or an admin.
  app.delete<{ Params: { id: number } }>('/api/spielerlevels/:id', { preHandler: requireSignedIn, schema: { params: idParam } }, async (req, reply) => {
    const l = await store.level(req.params.id);
    if (!l || (l.accountId !== req.account!.id && !isAdmin(req))) return reply.code(404).send({ error: 'Dieses Level gibt es nicht (mehr).' });
    await store.remove(l.id);
    return reply.code(204).send();
  });

  // ---------- admins ----------

  app.get('/api/admin/spielerlevels', { preHandler: requireAdmin }, async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const all = await store.pending();
    const row = (l: ReportedLevel) => ({ ...fullCard(l), gruende: l.reasons });
    return { wartend: all.filter((l) => l.status === 'wartet').map(row), gemeldet: all.filter((l) => l.reports > 0).map(row) };
  });

  app.put<{ Params: { id: number }; Body: { entscheidung: 'frei' | 'abgelehnt'; grund?: string } }>(
    '/api/admin/spielerlevels/:id',
    {
      preHandler: requireAdmin,
      schema: { params: idParam, body: { type: 'object', required: ['entscheidung'], additionalProperties: false, properties: { entscheidung: { enum: ['frei', 'abgelehnt'] }, grund: { type: 'string', maxLength: 400 } } } },
    },
    async (req, reply) => {
      const l = await store.level(req.params.id);
      if (!l) return reply.code(404).send({ error: 'Dieses Level gibt es nicht (mehr).' });
      if (l.status === 'ersetzt' || l.status === 'zurueckgezogen') return reply.code(409).send({ error: 'Der Autor hat dieses Level zurückgezogen oder ersetzt.' });
      const reason = req.body.entscheidung === 'abgelehnt' ? [...cleanText(req.body.grund ?? '')].slice(0, 300).join('') : null;
      if (reason !== null && chars(reason) < 3) return reply.code(400).send({ error: 'Bitte nenne dem Autor einen Grund.' });
      await store.setStatus(l.id, req.body.entscheidung, reason, now(), true);
      return reply.code(204).send();
    },
  );

  // Reports checked, the level stays as it is (visible again).
  app.delete<{ Params: { id: number } }>('/api/admin/spielerlevels/:id/meldungen', { preHandler: requireAdmin, schema: { params: idParam } }, async (req, reply) => {
    await store.dismissReports(req.params.id, now());
    return reply.code(204).send();
  });

  return queue;
}
