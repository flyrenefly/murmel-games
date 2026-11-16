// level/herkunft.js (tools/levelseiten/herkunft-skript.mjs): eine Datei ohne Importe, die im Browser
// dieselben Regeln wie das Spiel anwendet (src/herkunft.ts, docs/SPEC-herkunft.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { herkunftSkript } from './herkunft-skript.mjs';

const code = await herkunftSkript();

/** Führt das Skript in einem nachgebauten Browser aus; gibt die gesendeten Anfragen und die Adresse zurück. */
function lauf({ href = 'https://murmel.games/level/', referrer = '', session = new Map(), local = new Map(), dnt = null, gpc = undefined } = {}) {
  const url = new URL(href);
  const gesendet = [];
  let adresse = href;
  const speicher = (m) => ({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) });
  runInNewContext(code, {
    URL,
    JSON,
    Blob,
    document: { referrer },
    location: { href, hostname: url.hostname },
    history: { state: null, replaceState: (_s, _t, u) => (adresse = new URL(u, href).href) },
    sessionStorage: speicher(session),
    localStorage: speicher(local),
    navigator: { doNotTrack: dnt, globalPrivacyControl: gpc, sendBeacon: (u, b) => (gesendet.push([u, b]), true) },
  });
  return { gesendet, adresse, session };
}

const text = async (b) => JSON.parse(await b.text());

test('herkunft.js: keine Importe/Exporte, klein, gleicher Merker und Schalter wie das Spiel', () => {
  assert.doesNotMatch(code, /^\s*(import|export)\b|\bimport\(|\bexport\s*\{/m);
  assert.ok(code.length < 4096, `${code.length} Bytes`);
  for (const s of ['/api/herkunft', 'murmel.herkunft', 'murmel.statistikAus']) assert.ok(code.includes(s), s);
});

test('herkunft.js: fremde Domain und Kampagne einmal je Tab-Sitzung, von verschwindet aus der Adresse', async () => {
  const r = lauf({ href: 'https://murmel.games/level/enigma-ii/?von=Google#x', referrer: 'https://www.google.com/search?q=murmel' });
  assert.equal(r.gesendet.length, 1);
  assert.equal(r.gesendet[0][0], '/api/herkunft');
  assert.deepEqual(await text(r.gesendet[0][1]), { domain: 'www.google.com', von: 'google' });
  assert.equal(r.adresse, 'https://murmel.games/level/enigma-ii/#x');
  assert.equal(r.session.get('murmel.herkunft'), '1');
  // derselbe Tab danach (Klick ins Spiel oder auf die nächste Levelseite): nichts mehr
  assert.equal(lauf({ referrer: 'https://www.google.com/', session: r.session }).gesendet.length, 0);
});

test('herkunft.js: nichts ohne fremde Herkunft, mit Statistik aus, DNT, GPC oder auf localhost', () => {
  const g = 'https://www.google.com/';
  assert.equal(lauf({ referrer: 'https://murmel.games/' }).gesendet.length, 0);
  assert.equal(lauf({ referrer: '' }).gesendet.length, 0);
  assert.equal(lauf({ referrer: g, local: new Map([['murmel.statistikAus', 'true']]) }).gesendet.length, 0);
  assert.equal(lauf({ referrer: g, dnt: '1' }).gesendet.length, 0);
  assert.equal(lauf({ referrer: g, gpc: true }).gesendet.length, 0);
  assert.equal(lauf({ href: 'http://localhost:4173/level/', referrer: g }).gesendet.length, 0);
  // ungültige Kampagne: nicht gezählt, aber aus der Adresse entfernt
  const r = lauf({ href: 'https://murmel.games/level/?von=%3Cx%3E&a=1' });
  assert.equal(r.gesendet.length, 0);
  assert.equal(r.adresse, 'https://murmel.games/level/?a=1');
});
