import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { buildApp } from './app.ts';
import { FEHLER_EN } from './fehler-en.ts';
import { fehlerAufEnglisch, fehlerUebersetzen, spracheAus } from './sprache.ts';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const SOURCES = readdirSync(DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => ({ file: f, src: readFileSync(DIR + f, 'utf8') }));

const LIT = /'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

/**
 * Every error text in the sources: literals after `error:` in a send(…), constants sent as error
 * (LAST_WAY), [status, text] pairs (webpush guard), reasons of rejected checks (`grund:` next to
 * 'abgelehnt'), and the texts returned by checking helpers (`function …(): X | string`).
 */
function errorTexts(): Map<string, string> {
  const texts = new Map<string, string>();
  const add = (lit: string, where: string) => {
    const s = lit.slice(1, -1);
    if (!/^[a-z_]*$/.test(s) && !texts.has(s)) texts.set(s, where);
  };
  const consts = new Map<string, string>();
  for (const { src } of SOURCES) for (const m of src.matchAll(/const ([A-Z_]+) = ('(?:[^'\\\n]|\\.)*')/g)) consts.set(m[1], m[2]);
  for (const { file, src } of SOURCES) {
    src.split('\n').forEach((line, i) => {
      const where = `${file}:${i + 1}`;
      const e = line.indexOf('error:');
      if (e >= 0 && line.includes('send(')) {
        const rest = line.slice(e + 6);
        for (const m of rest.matchAll(LIT)) add(m[0], where);
        const id = /^\s*([A-Z_]+)\b/.exec(rest);
        if (id && consts.has(id[1])) add(consts.get(id[1])!, where);
      }
      const g = line.indexOf('grund:');
      if (g >= 0 && line.includes("'abgelehnt'")) for (const m of line.slice(g + 6).matchAll(LIT)) add(m[0], where);
      for (const m of line.matchAll(/\[\d{3}, ('(?:[^'\\\n]|\\.)*')\]/g)) add(m[1], where);
    });
    for (const m of src.matchAll(/function \w+\([^)]*\): [\w<>]+ \| string \{\n([\s\S]*?)\n\}\n/g)) {
      for (const line of m[1].split('\n')) {
        const r = line.indexOf('return ');
        if (r >= 0) for (const l of line.slice(r).matchAll(LIT)) add(l[0], `${file} (Prüffunktion)`);
      }
    }
  }
  return texts;
}

/** A template literal with sample values (digits fit both number and name patterns). */
const sample = (text: string) => text.replace(/\$\{[^}]*\}/g, '7');
const GERMAN = /[äöüßÄÖÜ„]|\b(der|die|das|und|nicht|bitte|ist|zu|gibt|schon|noch)\b/i;

test('Fehlertexte: die Suche findet die bekannten Arten (Literal, Vorlage, Konstante, Paar, Prüffunktion, grund)', () => {
  const t = errorTexts();
  for (const s of [
    'nicht gefunden',
    'Höchstens ${SUBMISSIONS_PER_HOUR} Läufe pro Stunde. Bitte versuch es später noch einmal.',
    'Das ist dein letzter Anmeldeweg. Richte zuerst einen anderen ein (zum Beispiel einen Passkey), dann kannst du diesen entfernen.',
    'fremde Herkunft',
    'Schlüssel ungültig',
    'Die Prüfung dauerte zu lange.',
    'Dieses Level lässt sich nicht zurückziehen.',
    'Nur zurückgezogene Levels lassen sich wieder einreichen.',
  ]) {
    assert.ok(t.has(s), s);
  }
  assert.ok(t.size > 100, String(t.size));
});

test('Fehlertexte: jeder Text aus den Quellen hat eine englische Fassung', () => {
  const missing: string[] = [];
  for (const [text, where] of errorTexts()) {
    const de = sample(text);
    const en = fehlerAufEnglisch(de);
    if (en === de || GERMAN.test(en)) missing.push(`${where}: ${text} → ${en}`);
  }
  assert.deepEqual(missing, []);
});

test('Fehlertexte: Muster setzen die Werte ein, auch verschachtelt', () => {
  assert.equal(fehlerAufEnglisch('Höchstens 20 Läufe pro Stunde. Bitte versuch es später noch einmal.'), 'At most 20 runs per hour. Please try again later.');
  assert.equal(fehlerAufEnglisch('Dieses GitHub-Konto gehört schon zu einem anderen Murmel-Konto. Trenne es dort, dann kannst du es hier verbinden.'), 'This GitHub account already belongs to another Murmel account. Disconnect it there, then you can connect it here.');
  assert.equal(fehlerAufEnglisch('Die Karte fehlt oder ist größer als 40×30.'), 'The map is missing or larger than 40×30.');
  assert.equal(fehlerAufEnglisch('Lösung: nur ein gewonnener Lauf ist eine Lösung'), 'Solution: only a won run is a solution');
  assert.equal(fehlerAufEnglisch('Lösung: Eingaben ungültig'), 'Solution: invalid input');
  assert.equal(fehlerAufEnglisch('Unbekannte Angabe „lua“: Spieler-Levels enthalten nur, was der Editor baut (kein Lua).'), 'Unknown field “lua”: player levels only contain what the editor builds (no Lua).');
  // unknown texts (Fastify's own, checker messages) stay as they are
  assert.equal(fehlerAufEnglisch('Bad Request'), 'Bad Request');
});

test('Fehlertexte: das Wörterbuch enthält keine verwaisten Einträge', () => {
  const all = SOURCES.map((s) => s.src).join('\n');
  assert.deepEqual(Object.keys(FEHLER_EN).filter((k) => !all.includes(k)), []);
  for (const en of Object.values(FEHLER_EN)) assert.doesNotMatch(en, /Oxyd online/i);
});

test('Sprache aus Accept-Language: erste Sprache de* → de, sonst en; ohne Kopf de', () => {
  assert.equal(spracheAus(undefined), 'de');
  assert.equal(spracheAus(''), 'de');
  assert.equal(spracheAus('*'), 'de');
  assert.equal(spracheAus('de'), 'de');
  assert.equal(spracheAus('de-AT,en;q=0.8'), 'de');
  assert.equal(spracheAus('DE-ch'), 'de');
  assert.equal(spracheAus('en'), 'en');
  assert.equal(spracheAus('en-US,de;q=0.9'), 'en');
  assert.equal(spracheAus('fr-FR'), 'en');
  assert.equal(spracheAus('dev'), 'en');
  assert.equal(spracheAus(['en', 'de']), 'en');
});

const fakeDb = { ping: async () => {}, recordEvent: async () => {}, statistics: async () => ({ days: [], levels: [] }) };

test('Hook: error englisch nur für englische Anfragen; Form bleibt, Vary: Accept-Language', async () => {
  const app = buildApp({ version: 'abc', db: fakeDb });
  const get = (url: string, lang?: string) => app.inject({ method: 'GET', url, headers: lang ? { 'accept-language': lang } : {} });

  const de = await get('/api/statistik', 'de-DE,de;q=0.9');
  assert.equal(de.statusCode, 401);
  assert.deepEqual(de.json(), { error: 'nicht berechtigt' });
  assert.match(String(de.headers.vary), /Accept-Language/);

  const none = await get('/api/statistik');
  assert.deepEqual(none.json(), { error: 'nicht berechtigt' });

  const en = await get('/api/statistik', 'en-US,en;q=0.9');
  assert.equal(en.statusCode, 401);
  assert.deepEqual(en.json(), { error: 'Not authorized' });
  assert.match(String(en.headers['content-type']), /application\/json/);
  assert.equal(Number(en.headers['content-length']), Buffer.byteLength(en.body));

  assert.deepEqual((await get('/api/gibtsnicht', 'en')).json(), { error: 'Not found' });
  assert.deepEqual((await get('/api/gibtsnicht', 'de')).json(), { error: 'nicht gefunden' });

  // answers without an error stay untouched
  const ok = await get('/api/health', 'en');
  assert.deepEqual(ok.json(), { ok: true, version: 'abc', db: 'ok' });
  assert.equal(ok.headers.vary, undefined);
  await app.close();
});

test('Hook: grund einer abgelehnten Prüfung, Fastify-Fehler und andere Felder', async () => {
  const app = Fastify();
  fehlerUebersetzen(app);
  app.get('/abgelehnt', async () => ({ status: 'abgelehnt', grund: 'Die Prüfung dauerte zu lange.' }));
  app.get('/frei', async () => ({ status: 'frei', grund: 'Die Prüfung dauerte zu lange.', titel: 'Brücken' }));
  app.get('/text', async (_req, reply) => reply.type('text/plain').send('{"error":"nicht gefunden"}'));
  app.post('/schema', { schema: { body: { type: 'object', required: ['x'] } } }, async () => ({}));
  app.get('/vary', async (_req, reply) => reply.header('Vary', 'Origin').code(400).send({ error: 'Eingaben ungültig', mehr: 'nicht gefunden' }));
  const en = { 'accept-language': 'en' };

  assert.deepEqual((await app.inject({ url: '/abgelehnt', headers: en })).json(), { status: 'abgelehnt', grund: 'The check took too long.' });
  assert.deepEqual((await app.inject({ url: '/abgelehnt' })).json(), { status: 'abgelehnt', grund: 'Die Prüfung dauerte zu lange.' });
  assert.deepEqual((await app.inject({ url: '/frei', headers: en })).json(), { status: 'frei', grund: 'Die Prüfung dauerte zu lange.', titel: 'Brücken' });
  assert.equal((await app.inject({ url: '/text', headers: en })).body, '{"error":"nicht gefunden"}');
  const schema = await app.inject({ method: 'POST', url: '/schema', payload: {}, headers: en });
  assert.equal(schema.statusCode, 400);
  assert.equal(schema.json().error, 'Bad Request');
  const vary = await app.inject({ url: '/vary', headers: en });
  assert.deepEqual(vary.json(), { error: 'invalid input', mehr: 'nicht gefunden' });
  assert.equal(vary.headers.vary, 'Origin, Accept-Language');
  await app.close();
});

test('Ablehnungsgründe des Level-Prüfers: jeder LinkError und jeder Ladefehler hat dieselbe englische Fassung wie im Spiel', async () => {
  const ROOT = new URL('../../src/', import.meta.url);
  const editor = (await import(new URL('i18n/en/editor.ts', ROOT).href)).default as Record<string, string>;
  const lade = (await import(new URL('i18n/en/ladefehler.ts', ROOT).href)).default as Record<string, string>;
  const link = readFileSync(new URL('editor/link.ts', ROOT), 'utf8');
  const vorlagen = [...new Set([...link.matchAll(/new LinkError\('([^']*)'/g)].map((m) => m[1]))];
  assert.ok(vorlagen.length > 20, String(vorlagen.length));
  const sample = (s: string) => s.replace(/\{\w+\}/g, 'it_x');
  for (const de of vorlagen) assert.equal(fehlerAufEnglisch(sample(de)), sample(editor[de]), de);
  for (const [de, en] of Object.entries(lade)) assert.equal(fehlerAufEnglisch(sample(de)), sample(en), de);
  assert.equal(fehlerAufEnglisch('Das ist kein gültiges Level.'), 'This is not a valid level.');
});

test('Ablehnungsgründe des Level-Prüfers: Werte bleiben, verschachtelte Ladefehler werden übersetzt', () => {
  assert.equal(fehlerAufEnglisch('Das Objekt „st_lua“ ist im Editor nicht erlaubt.'), 'The object “st_lua” is not allowed in the editor.');
  assert.equal(fehlerAufEnglisch('Das Level lässt sich nicht laden: Symbol B kommt 3× vor, erwartet paarweise'), 'The level cannot be loaded: symbol B occurs 3×, expected in pairs');
  assert.equal(fehlerAufEnglisch("Das Level lässt sich nicht laden: unbekanntes Zeichen '%' in Zeile 2"), "The level cannot be loaded: unknown character '%' in row 2");
  // Lua's own (English) messages stay
  assert.equal(fehlerAufEnglisch('Das Level lässt sich nicht laden: attempt to index a nil value'), 'The level cannot be loaded: attempt to index a nil value');
});
