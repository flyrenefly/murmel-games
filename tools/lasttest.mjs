#!/usr/bin/env node
// Lasttest für murmel.games: bildet anonyme Besuche nach und steigert die Zahl gleichzeitiger
// Besucher stufenweise. Nur lesende Anfragen – keine Anmeldung, keine Mails, kein Forum, keine
// Uploads, kein Wettkampf, keine Zählungen (POST /api/auswertung landet ununterscheidbar in der
// echten Auswertung und bleibt deshalb weg). Ohne Abhängigkeiten (Node ≥ 20, eingebautes fetch).
//
// Ein Besuch: Startseite → alle Bundles aus der Startseite (parallel, wie der Browser) →
// Paketliste → ein zufälliges Levelpaket → /api/health → /api/tageslevel → Bestenliste eines
// zufälligen Levels. Danach Denkzeit (zufällig 1–5 s), dann der nächste Besuch – jeder Besuch
// ohne Browser-Cache, also eher strenger als echte Besucher, die Bundles nur einmal laden.
//
// Sicherheitsleinen:
// - Abbruch, sobald in einem 5-s-Fenster Fehlerquote > --max-fehler oder p95 > --max-p95.
// - Eigener Wächter fragt alle 2 s die Startseite direkt per IP ab (wie der Notbetrieb-Wächter);
//   zwei Fehlschläge hintereinander → sofortiger Abbruch aller Stufen.
//
// Aufruf:
//   node tools/lasttest.mjs [--url https://murmel.games] [--ip 85.215.139.111]
//        [--stufen 25,50,100,200] [--dauer 60] [--pause 45] [--max-fehler 0.02] [--max-p95 3000]
//        [--json ergebnis.json] [--leicht]

import https from 'node:https';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const { values: opt } = parseArgs({
  options: {
    url: { type: 'string', default: 'https://murmel.games' },
    ip: { type: 'string', default: '85.215.139.111' },
    stufen: { type: 'string', default: '25,50,100,200' },
    dauer: { type: 'string', default: '60' },
    pause: { type: 'string', default: '45' },
    'max-fehler': { type: 'string', default: '0.02' },
    'max-p95': { type: 'string', default: '3000' },
    json: { type: 'string' },
    leicht: { type: 'boolean', default: false },
  },
});

const BASE = opt.url.replace(/\/$/, '');
const HOST = new URL(BASE).hostname;
const STUFEN = opt.stufen.split(',').map(Number);
const DAUER_MS = Number(opt.dauer) * 1000;
const PAUSE_MS = Number(opt.pause) * 1000;
const MAX_FEHLER = Number(opt['max-fehler']);
const MAX_P95 = Number(opt['max-p95']);
const TIMEOUT_MS = 10_000;
const HEADERS = { 'user-agent': 'murmel-lasttest/1 (eigener Lasttest)', 'accept-encoding': 'gzip, br' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const zufall = (a) => a[Math.floor(Math.random() * a.length)];

/** Perzentil (0–100) einer sortierten Liste. */
export function perzentil(sortiert, p) {
  if (!sortiert.length) return NaN;
  const i = Math.min(sortiert.length - 1, Math.max(0, Math.ceil((p / 100) * sortiert.length) - 1));
  return sortiert[i];
}

// ---------- Messung ----------

/** Eine Messung: { t: Endzeit, ms, ok, art, bytes, status } */
let messungen = [];
let abbruch = null;

async function hole(pfad, art) {
  const start = performance.now();
  let ok = false;
  let status = 0;
  let bytes = 0;
  try {
    const res = await fetch(BASE + pfad, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
    status = res.status;
    const body = await res.arrayBuffer();
    bytes = body.byteLength;
    ok = res.status < 400;
    if (ok && art === 'json') JSON.parse(new TextDecoder().decode(body));
    if (ok && pfad === '/') ok = /murmel/i.test(new TextDecoder().decode(body));
    return { ok, body };
  } catch {
    ok = false;
    return { ok: false, body: null };
  } finally {
    messungen.push({ t: performance.now(), ms: performance.now() - start, ok, art: art === 'json' ? pfadArt(pfad) : art, bytes, status });
  }
}

function pfadArt(pfad) {
  if (pfad.startsWith('/api/')) return pfad.split('?')[0].replace(/^\/api\//, 'api:');
  return 'json-statisch';
}

// ---------- Vorbereitung: was lädt die Startseite? ----------

async function vorbereiten() {
  const html = await (await fetch(BASE + '/', { headers: HEADERS })).text();
  const bundles = [...new Set([...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+\.(?:js|css))"/g)].map((m) => '/' + m[1]))];
  const pakete = (await (await fetch(BASE + '/levels/enigma/index.json', { headers: HEADERS })).json()).map((p) => p.pack);
  const erstes = await (await fetch(`${BASE}/levels/enigma/${pakete[0]}.json`, { headers: HEADERS })).json();
  const levelIds = erstes.levels.map((l) => l.id).filter(Boolean);
  if (!bundles.length || !pakete.length || !levelIds.length) throw new Error('Startseite/Pakete nicht wie erwartet');
  return { bundles, pakete, levelIds };
}

async function besuch(z) {
  await hole('/', 'html');
  // --leicht: wiederkehrender Besucher, Bundles und Pakete liegen im Browser-Cache. Prüft den
  // dynamischen Teil (API, Datenbank), ohne dass die Leitung des Testrechners zum Engpass wird.
  if (!opt.leicht) {
    await Promise.all(z.bundles.map((b) => hole(b, 'bundle')));
    await hole('/levels/enigma/index.json', 'json');
    await hole(`/levels/enigma/${zufall(z.pakete)}.json`, 'json');
  }
  await Promise.all([
    hole('/api/health', 'json'),
    hole('/api/tageslevel', 'json'),
    hole(`/api/bestenliste/level?${new URLSearchParams({ id: zufall(z.levelIds) })}`, 'json'),
  ]);
}

async function besucher(z, bis) {
  // Besucher kommen über 5 s verteilt an, nicht alle in derselben Millisekunde.
  await sleep(Math.random() * 5000);
  while (performance.now() < bis && !abbruch) {
    await besuch(z);
    await sleep(1000 + Math.random() * 4000);
  }
}

// ---------- Wächter: wie der Notbetrieb, direkt per IP ----------

function liefertAus() {
  return new Promise((resolve) => {
    const req = https.request(
      { host: opt.ip, servername: HOST, path: '/', method: 'GET', headers: { host: HOST, 'user-agent': 'murmel-lasttest-waechter' }, timeout: 5000 },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { if (body.length < 200000) body += d; });
        res.on('end', () => resolve(res.statusCode === 200 && /murmel/i.test(body)));
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.end();
  });
}

function waechter() {
  let fehlschlaege = 0;
  let laeuft = true;
  (async () => {
    while (laeuft) {
      fehlschlaege = (await liefertAus()) ? 0 : fehlschlaege + 1;
      if (fehlschlaege >= 2 && !abbruch) abbruch = 'Wächter: Startseite per IP zweimal nicht ausgeliefert';
      await sleep(2000);
    }
  })();
  return () => { laeuft = false; };
}

// ---------- Auswertung ----------

export function kennzahlen(liste, dauerMs) {
  const ms = liste.map((m) => m.ms).sort((a, b) => a - b);
  const fehler = liste.filter((m) => !m.ok).length;
  return {
    anfragen: liste.length,
    rps: +(liste.length / (dauerMs / 1000)).toFixed(1),
    p50: Math.round(perzentil(ms, 50)),
    p95: Math.round(perzentil(ms, 95)),
    p99: Math.round(perzentil(ms, 99)),
    max: Math.round(ms[ms.length - 1] ?? NaN),
    fehler,
    fehlerquote: liste.length ? +(fehler / liste.length).toFixed(4) : 0,
    mbitS: +((liste.reduce((s, m) => s + m.bytes, 0) * 8) / 1e6 / (dauerMs / 1000)).toFixed(1),
    status: liste.reduce((o, m) => ((o[m.status] = (o[m.status] ?? 0) + 1), o), {}),
  };
}

function jeArt(liste, dauerMs) {
  const arten = {};
  for (const m of liste) (arten[m.art] ??= []).push(m);
  return Object.fromEntries(Object.entries(arten).map(([a, l]) => {
    const k = kennzahlen(l, dauerMs);
    return [a, { anfragen: k.anfragen, p50: k.p50, p95: k.p95, fehler: k.fehler }];
  }));
}

async function stufe(z, n) {
  messungen = [];
  const start = performance.now();
  const bis = start + DAUER_MS;
  const laeufer = Array.from({ length: n }, () => besucher(z, bis));
  // Rollende Prüfung alle 5 s über die letzten 5 s
  const pruefer = setInterval(() => {
    const jetzt = performance.now();
    const fenster = messungen.filter((m) => m.t > jetzt - 5000);
    if (fenster.length < 20) return;
    const k = kennzahlen(fenster, 5000);
    process.stdout.write(`  ${((jetzt - start) / 1000).toFixed(0).padStart(3)} s: ${k.rps} Anfr./s, p95 ${k.p95} ms, Fehler ${(k.fehlerquote * 100).toFixed(1)} %\n`);
    if (!abbruch && k.fehlerquote > MAX_FEHLER) abbruch = `Fehlerquote ${(k.fehlerquote * 100).toFixed(1)} % > ${MAX_FEHLER * 100} %`;
    if (!abbruch && k.p95 > MAX_P95) abbruch = `p95 ${k.p95} ms > ${MAX_P95} ms`;
  }, 5000);
  await Promise.all(laeufer);
  clearInterval(pruefer);
  const dauer = performance.now() - start;
  return { besucher: n, startZeit: new Date(Date.now() - dauer).toISOString(), dauerS: +(dauer / 1000).toFixed(1), ...kennzahlen(messungen, dauer), jeArt: jeArt(messungen, dauer), abbruch };
}

async function main() {
  console.log(`Lasttest gegen ${BASE} (Wächter per IP ${opt.ip}), Stufen ${STUFEN.join(' → ')}, je ${DAUER_MS / 1000} s`);
  const z = await vorbereiten();
  console.log(opt.leicht ? 'Besuch (leicht): / + 3 API-Lesungen' : `Besuch: / + ${z.bundles.length} Bundles + Paketliste + 1 von ${z.pakete.length} Paketen + 3 API-Lesungen`);
  const stopWaechter = waechter();
  const ergebnisse = [];
  for (let i = 0; i < STUFEN.length; i++) {
    const n = STUFEN[i];
    console.log(`\nStufe ${n} Besucher – Start ${new Date().toLocaleTimeString('de-DE')}`);
    const e = await stufe(z, n);
    ergebnisse.push(e);
    console.log(`  → ${e.anfragen} Anfragen, ${e.rps}/s, p50 ${e.p50} / p95 ${e.p95} / p99 ${e.p99} ms, Fehler ${e.fehler} (${(e.fehlerquote * 100).toFixed(2)} %), ${e.mbitS} Mbit/s`);
    if (abbruch) { console.log(`ABBRUCH: ${abbruch}`); break; }
    if (i < STUFEN.length - 1) { console.log(`  Pause ${PAUSE_MS / 1000} s`); await sleep(PAUSE_MS); }
  }
  stopWaechter();
  if (opt.json) writeFileSync(opt.json, JSON.stringify({ base: BASE, ergebnisse }, null, 2));
  console.log('\n| Besucher | Anfragen/s | p50 ms | p95 ms | p99 ms | Fehler | Mbit/s |');
  console.log('|---:|---:|---:|---:|---:|---:|---:|');
  for (const e of ergebnisse) console.log(`| ${e.besucher} | ${e.rps} | ${e.p50} | ${e.p95} | ${e.p99} | ${e.fehler} (${(e.fehlerquote * 100).toFixed(2)} %) | ${e.mbitS} |`);
  process.exit(abbruch ? 2 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((err) => { console.error(err); process.exit(1); });
