import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { connect } from './db.ts';
import { bericht, HERKUNFT_PER_IP, HERKUNFT_WINDOW_MS, MAX_DOMAINS_PER_DAY, normalizeDomain, normalizeVon, oldestKept, VON_ERLAUBT } from './herkunft.ts';
import { herkunftStore } from './herkunft-db.ts';
import { memoryHerkunftStore } from './herkunft-memory.ts';
import { migrate } from './migrate.ts';

const fakeDb = { ping: async () => {}, recordEvent: async () => {}, statistics: async () => ({ days: [], levels: [] }) };

function setup(day = '2026-11-16T10:00:00Z') {
  const store = memoryHerkunftStore();
  let clock = new Date(day);
  const app = buildApp({ version: 't', db: fakeDb, herkunft: store, statsToken: 'geheim', now: () => clock });
  return { app, store, setNow: (d: string) => void (clock = new Date(d)) };
}

const post = (app: ReturnType<typeof buildApp>, payload: unknown, remoteAddress = '127.0.0.1') =>
  app.inject({ method: 'POST', url: '/api/herkunft', payload: payload as object, remoteAddress });
const read = (app: ReturnType<typeof buildApp>, tage = 30, auth = 'Bearer geheim') =>
  app.inject({ method: 'GET', url: `/api/statistik/herkunft?tage=${tage}`, headers: auth ? { authorization: auth } : {} });

test('normalizeDomain: Kleinbuchstaben, ohne www. und Schlusspunkt', () => {
  assert.equal(normalizeDomain('News.YCombinator.com'), 'news.ycombinator.com');
  assert.equal(normalizeDomain('www.reddit.com'), 'reddit.com');
  assert.equal(normalizeDomain('WWW.Heise.DE.'), 'heise.de');
  assert.equal(normalizeDomain('  google.de '), 'google.de');
  assert.equal(normalizeDomain('xn--mller-kva.de'), 'xn--mller-kva.de');
  assert.equal(normalizeDomain('a-b.c-d.example'), 'a-b.c-d.example');
  // only the leading www. goes, nothing inside
  assert.equal(normalizeDomain('www.www.example.org'), 'www.example.org');
});

test('normalizeDomain: ungültige Werte, eigene Domain und Adressen werden abgelehnt', () => {
  const bad = [
    '',
    '   ',
    'localhost',
    'com',
    'www.',
    'murmel.games',
    'www.murmel.games',
    'beta.murmel.games',
    'https://example.com',
    'example.com/pfad',
    'example.com?x=1',
    'example.com:8080',
    'user@example.com',
    'exa mple.com',
    'exa_mple.com',
    '-example.com',
    'example-.com',
    'example..com',
    '.example.com',
    'example.123',
    '192.168.1.10',
    '[::1]',
    'müller.de',
    '<script>.com',
    `${'a'.repeat(64)}.com`,
    `${'abcdefghi.'.repeat(26)}com`,
  ];
  for (const b of bad) assert.equal(normalizeDomain(b), null, JSON.stringify(b));
  // longest allowed: 63 characters per label
  assert.equal(normalizeDomain(`${'a'.repeat(63)}.com`), `${'a'.repeat(63)}.com`);
});

test('POST /api/herkunft zählt je Tag und Domain, nach Normalisierung', async () => {
  const { app, store } = setup();
  for (const d of ['news.ycombinator.com', 'News.Ycombinator.com', 'www.reddit.com', 'news.ycombinator.com']) {
    assert.equal((await post(app, { domain: d })).statusCode, 204, d);
  }
  assert.deepEqual(await store.rows('2000-01-01'), [
    { day: '2026-11-16', domain: 'news.ycombinator.com', von: '', anzahl: 3 },
    { day: '2026-11-16', domain: 'reddit.com', von: '', anzahl: 1 },
  ]);
});

test('ungültige Bündel werden abgewiesen und nicht gezählt', async () => {
  const { app, store } = setup();
  const bad = [{}, { domain: '' }, { domain: 42 }, { domain: 'murmel.games' }, { domain: 'localhost' }, { domain: 'a'.repeat(300) + '.com' }, { domain: 'https://example.com/x' }, { domain: { name: 'example.com' } }];
  for (const b of bad) assert.equal((await post(app, b)).statusCode, 400, JSON.stringify(b).slice(0, 60));
  assert.deepEqual(await store.rows('2000-01-01'), []);
});

test('fremde Felder (Pfad, Kennung, Zeit) werden verworfen, nie gespeichert', async () => {
  const { app, store } = setup();
  assert.equal((await post(app, { domain: 'example.com', pfad: '/geheim?x=1', id: 'abc', zeit: '2026-11-16T10:00:00Z' })).statusCode, 204);
  assert.deepEqual(await store.rows('2000-01-01'), [{ day: '2026-11-16', domain: 'example.com', von: '', anzahl: 1 }]);
});

test('Lesen nur mit STATS_TOKEN oder als Admin; ohne Store keine Routen', async () => {
  const { app } = setup();
  assert.equal((await read(app, 30, '')).statusCode, 401);
  assert.equal((await read(app, 30, 'Bearer falsch')).statusCode, 401);
  const res = await read(app);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  const ohne = buildApp({ version: 't', db: fakeDb });
  assert.equal((await post(ohne, { domain: 'example.com' })).statusCode, 404);
});

test('bericht: neueste Tage zuerst, Domains nach Anzahl, unter 3 als „andere“ zusammengefasst', () => {
  const rows = [
    { day: '2026-11-15', domain: 'news.ycombinator.com', von: '', anzahl: 37 },
    { day: '2026-11-15', domain: 'reddit.com', von: '', anzahl: 3 },
    { day: '2026-11-15', domain: 'blog.example.org', von: '', anzahl: 2 },
    { day: '2026-11-15', domain: 'mastodon.social', von: '', anzahl: 1 },
    { day: '2026-11-16', domain: 'google.com', von: '', anzahl: 4 },
    { day: '2026-11-16', domain: 'blog.example.org', von: '', anzahl: 1 },
  ];
  assert.deepEqual(bericht(rows), {
    tage: [
      { day: '2026-11-16', besucher: 5, domains: [{ domain: 'google.com', anzahl: 4 }], andere: { domains: 1, anzahl: 1 }, ohneDomain: 0, kampagnen: [] },
      {
        day: '2026-11-15',
        besucher: 43,
        domains: [
          { domain: 'news.ycombinator.com', anzahl: 37 },
          { domain: 'reddit.com', anzahl: 3 },
        ],
        andere: { domains: 2, anzahl: 3 },
      ohneDomain: 0,
      kampagnen: [],
      },
    ],
    // over the period blog.example.org reaches 3 and is shown by name
    gesamt: {
      besucher: 48,
      domains: [
        { domain: 'news.ycombinator.com', anzahl: 37 },
        { domain: 'google.com', anzahl: 4 },
        { domain: 'blog.example.org', anzahl: 3 },
        { domain: 'reddit.com', anzahl: 3 },
      ],
      andere: { domains: 1, anzahl: 1 },
    ohneDomain: 0,
    kampagnen: [],
    },
  });
  assert.deepEqual(bericht([]), { tage: [], gesamt: { besucher: 0, domains: [], andere: { domains: 0, anzahl: 0 }, ohneDomain: 0, kampagnen: [] } });
});

test('GET /api/statistik/herkunft liefert den Bericht für den Zeitraum (Berliner Tage)', async () => {
  const { app, setNow } = setup('2026-10-01T10:00:00Z');
  await post(app, { domain: 'alt.example.com' });
  setNow('2026-11-16T10:00:00Z');
  for (let i = 0; i < 3; i++) await post(app, { domain: 'news.ycombinator.com' });
  await post(app, { domain: 'selten.example.com' });
  const body = (await read(app, 30)).json();
  assert.deepEqual(body.tage, [{ day: '2026-11-16', besucher: 4, domains: [{ domain: 'news.ycombinator.com', anzahl: 3 }], andere: { domains: 1, anzahl: 1 }, ohneDomain: 0, kampagnen: [] }]);
  // a domain below 3 never leaves the server by name
  assert.ok(!JSON.stringify(body).includes('selten'));
  assert.equal((await read(app, 60)).json().gesamt.besucher, 5);
});

test('Aufbewahrung: 13 Monate, gelöscht beim ersten Eintrag eines neuen Tages', async () => {
  assert.equal(oldestKept('2026-11-16'), '2025-10-16');
  // the day is clamped to the month's end, like PostgreSQL's interval arithmetic
  assert.equal(oldestKept('2027-03-31'), '2026-02-28');
  assert.equal(oldestKept('2025-01-31'), '2023-12-31');

  const { app, store, setNow } = setup('2025-10-15T10:00:00Z');
  await post(app, { domain: 'a.example.com' });
  setNow('2025-10-16T10:00:00Z');
  await post(app, { domain: 'b.example.com' });
  // 23:30 UTC on 15.11.2026 is already the 16th in Berlin
  setNow('2026-11-15T23:30:00Z');
  await post(app, { domain: 'c.example.com' });
  assert.deepEqual((await store.rows('2000-01-01')).map((r) => r.day), ['2025-10-16', '2026-11-16']);
});

test('höchstens MAX_DOMAINS_PER_DAY Domains je Tag; bekannte zählen weiter', async () => {
  const store = memoryHerkunftStore();
  for (let i = 0; i < MAX_DOMAINS_PER_DAY; i++) await store.record('2026-11-16', `d${i}.example.com`, '');
  await store.record('2026-11-16', 'neu.example.com', '');
  await store.record('2026-11-16', 'd0.example.com', '');
  const rows = await store.rows('2026-11-16');
  assert.equal(rows.length, MAX_DOMAINS_PER_DAY);
  assert.equal(rows.find((r) => r.domain === 'd0.example.com')?.anzahl, 2);
  // a new day starts empty
  await store.record('2026-11-17', 'neu.example.com', '');
  assert.equal((await store.rows('2026-11-17')).length, 1);
});

test('Meldungen je IP-Adresse begrenzt, nur im Arbeitsspeicher; nach dem Zeitfenster wieder frei', async () => {
  const { app, store, setNow } = setup('2026-11-16T10:00:00Z');
  for (let i = 0; i < HERKUNFT_PER_IP; i++) assert.equal((await post(app, { domain: 'example.com' }, '203.0.113.7')).statusCode, 204);
  assert.equal((await post(app, { domain: 'example.com' }, '203.0.113.7')).statusCode, 429);
  assert.equal((await post(app, { domain: 'example.com' }, '203.0.113.8')).statusCode, 204);
  setNow(new Date(Date.parse('2026-11-16T10:00:00Z') + HERKUNFT_WINDOW_MS).toISOString());
  assert.equal((await post(app, { domain: 'example.com' }, '203.0.113.7')).statusCode, 204);
  assert.equal((await store.rows('2000-01-01'))[0].anzahl, HERKUNFT_PER_IP + 2);
});

test('ein Datenbankfehler stört die Seite nicht (204)', async () => {
  const app = buildApp({ version: 't', db: fakeDb, herkunft: { record: async () => Promise.reject(new Error('down')), rows: async () => [] } });
  assert.equal((await post(app, { domain: 'example.com' })).statusCode, 204);
});

test('normalizeVon: Freigabeliste, unbekannte gültige Werte als „sonstige“, ungültige abgelehnt', () => {
  for (const v of VON_ERLAUBT) assert.equal(normalizeVon(v), v);
  assert.deepEqual([...VON_ERLAUBT], ['google', 'reddit', 'mastodon', 'bluesky', 'hn', 'newsletter', 'presse']);
  assert.equal(normalizeVon('Google'), 'google');
  assert.equal(normalizeVon(' reddit '), 'reddit');
  assert.equal(normalizeVon('facebook'), 'sonstige');
  assert.equal(normalizeVon('a'.repeat(32)), 'sonstige');
  for (const b of ['', 'a'.repeat(33), 'google ads', 'max.mustermann', 'x_y', 'müll', '<b>', 'utm=1']) assert.equal(normalizeVon(b), null, JSON.stringify(b));
});

test('POST /api/herkunft mit Kampagne: mit und ohne Domain gezählt, fremde Werte als „sonstige“', async () => {
  const { app, store } = setup();
  assert.equal((await post(app, { domain: 'www.google.com', von: 'google' })).statusCode, 204);
  assert.equal((await post(app, { von: 'Google' })).statusCode, 204);
  assert.equal((await post(app, { von: 'reddit' })).statusCode, 204);
  assert.equal((await post(app, { von: 'irgendwas-langes' })).statusCode, 204);
  assert.deepEqual(await store.rows('2000-01-01'), [
    { day: '2026-11-16', domain: '', von: 'google', anzahl: 1 },
    { day: '2026-11-16', domain: '', von: 'reddit', anzahl: 1 },
    { day: '2026-11-16', domain: '', von: 'sonstige', anzahl: 1 },
    { day: '2026-11-16', domain: 'google.com', von: 'google', anzahl: 1 },
  ]);
  // invalid campaign or invalid domain: the whole report is refused
  for (const b of [{ von: '' }, { von: 'mit leerzeichen' }, { von: 'a'.repeat(33) }, { domain: 'localhost', von: 'google' }, { domain: 'example.com', von: 'x.y' }]) {
    assert.equal((await post(app, b)).statusCode, 400, JSON.stringify(b));
  }
  assert.equal((await store.rows('2000-01-01')).length, 4);
});

test('bericht: Kampagnen je Tag und im Zeitraum; Besuche ohne Domain extra ausgewiesen', () => {
  const rows = [
    { day: '2026-11-16', domain: '', von: 'google', anzahl: 5 },
    { day: '2026-11-16', domain: 'google.com', von: 'google', anzahl: 3 },
    { day: '2026-11-16', domain: 'google.com', von: '', anzahl: 4 },
    { day: '2026-11-16', domain: '', von: 'reddit', anzahl: 1 },
  ];
  const b = bericht(rows);
  assert.deepEqual(b.tage[0], {
    day: '2026-11-16',
    besucher: 13,
    domains: [{ domain: 'google.com', anzahl: 7 }],
    andere: { domains: 0, anzahl: 0 },
    ohneDomain: 6,
    kampagnen: [
      { von: 'google', anzahl: 8 },
      { von: 'reddit', anzahl: 1 },
    ],
  });
  assert.deepEqual(b.gesamt.kampagnen, b.tage[0].kampagnen);
  assert.equal(b.gesamt.ohneDomain, 6);
});

// PostgreSQL (CI: service container); without TEST_DATABASE_URL skipped.
const url = process.env.TEST_DATABASE_URL;
const sql = url ? connect(url) : null;
after(async () => {
  await sql?.end({ timeout: 5 });
});

test('Herkunft in PostgreSQL: Migration 018, addiert, Obergrenze je Tag, löscht nach 13 Monaten', { skip: !sql }, async () => {
  await migrate(sql!, fileURLToPath(new URL('../migrations', import.meta.url)));
  // only day, domain, campaign and count: no column for an address, a browser or a path
  const cols = await sql!<{ column_name: string }[]>`select column_name from information_schema.columns where table_name = 'herkunft_tag' order by ordinal_position`;
  assert.deepEqual(cols.map((c) => c.column_name), ['day', 'domain', 'von', 'anzahl']);
  await sql!`delete from herkunft_tag`;
  const store = herkunftStore(sql!);
  await store.record('2025-10-15', 'alt.example.com', '');
  await store.record('2026-11-15', 'news.ycombinator.com', '');
  await store.record('2026-11-15', 'news.ycombinator.com', '');
  await store.record('2026-11-15', 'reddit.com', '');
  await store.record('2026-11-16', 'news.ycombinator.com', '');
  assert.deepEqual(await store.rows('2026-11-01'), [
    { day: '2026-11-15', domain: 'news.ycombinator.com', von: '', anzahl: 2 },
    { day: '2026-11-15', domain: 'reddit.com', von: '', anzahl: 1 },
    { day: '2026-11-16', domain: 'news.ycombinator.com', von: '', anzahl: 1 },
  ]);
  // the 16th removed the row of 15.10.2025 (older than 13 months)
  assert.deepEqual((await store.rows('2000-01-01')).map((r) => r.day), ['2026-11-15', '2026-11-15', '2026-11-16']);
  // the table refuses what the API never sends
  await assert.rejects(sql!`insert into herkunft_tag (day, domain, von, anzahl) values ('2026-11-16', 'Gross.Example.com', '', 1)`);
  await assert.rejects(sql!`insert into herkunft_tag (day, domain, von, anzahl) values ('2026-11-16', 'x.example.com', '', 0)`);

  await assert.rejects(sql!`insert into herkunft_tag (day, domain, von, anzahl) values ('2026-11-16', '', '', 1)`);
  await assert.rejects(sql!`insert into herkunft_tag (day, domain, von, anzahl) values ('2026-11-16', '', 'Freitext mit Leerzeichen', 1)`);
  // campaign without a referrer, and with one: separate rows
  await store.record('2026-11-16', '', 'google');
  await store.record('2026-11-16', 'google.com', 'google');
  await store.record('2026-11-16', '', 'google');
  assert.deepEqual((await store.rows('2026-11-16')).filter((r) => r.von), [
    { day: '2026-11-16', domain: '', von: 'google', anzahl: 2 },
    { day: '2026-11-16', domain: 'google.com', von: 'google', anzahl: 1 },
  ]);

  await sql!`delete from herkunft_tag`;
  for (let i = 0; i < MAX_DOMAINS_PER_DAY; i++) await store.record('2026-11-16', `d${i}.example.com`, '');
  await store.record('2026-11-16', 'neu.example.com', '');
  await store.record('2026-11-16', 'd0.example.com', '');
  const rows = await store.rows('2026-11-16');
  assert.equal(rows.length, MAX_DOMAINS_PER_DAY);
  assert.equal(rows.find((r) => r.domain === 'd0.example.com')?.anzahl, 2);
  await sql!`delete from herkunft_tag`;
});
