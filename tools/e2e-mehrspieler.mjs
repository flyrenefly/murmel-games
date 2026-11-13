#!/usr/bin/env node
// Ende-zu-Ende-Test „Zu zweit“ (docs/SPEC-mehrspieler.md 6): Raumdienst ohne Datenbank (Port 3182),
// Vite-Dev-Server (Port 5182) und Chrome ohne Fenster mit zwei Tabs. Tab A öffnet einen Raum
// (gemeinsam, „Bridge Builders“), Tab B tritt mit dem Code bei; dann steuert B die weiße Murmel und
// A (der rechnet) muss sie rollen sehen, B muss dem Stand von A folgen.
//
// Lokal ohne coturn: Der Raumdienst gibt keine TURN-Daten aus, und das Dev-Build verbindet dann
// direkt (iceTransportPolicy „all“); das gebaute Spiel verweigert das. Über TURN wird nach dem
// Rollout live geprüft.
//
//   node tools/e2e-mehrspieler.mjs            (CHROME=Pfad zu chrome/msedge, sonst Standardpfade)
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url);
const API_PORT = 3182;
const WEB_PORT = 5182;
const CDP_PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
const log = (...a) => console.log('[e2e]', ...a);

function start(cmd, args, env = {}) {
  const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' && cmd === 'npx' });
  p.stdout.on('data', (d) => process.env.E2E_LOG && process.stdout.write(d));
  p.stderr.on('data', (d) => process.env.E2E_LOG && process.stderr.write(d));
  procs.push(p);
  return p;
}

async function waitHttp(url, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {}
    await sleep(250);
  }
  throw new Error(`${url} antwortet nicht`);
}

class Tab {
  constructor(name, ws) {
    this.name = name;
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        this.pending.get(m.id)(m);
        this.pending.delete(m.id);
      } else if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    };
  }
  static async open(name, url) {
    // each tab in its own window: a background tab gets no animation frames, the game would stand still
    const version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
    const browser = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((res, rej) => ((browser.onopen = res), (browser.onerror = rej)));
    const targetId = await new Promise((res) => {
      browser.onmessage = (e) => res(JSON.parse(e.data).result.targetId);
      browser.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url, newWindow: true } }));
    });
    browser.close();
    const info = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((x) => x.id === targetId);
    const ws = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
    const t = new Tab(name, ws);
    t.targetId = info.id;
    await t.send('Runtime.enable');
    return t;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res) => this.pending.set(id, res));
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`${this.name}: ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
  }
  async waitFor(expr, what, ms = 15_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        const v = await this.eval(expr);
        if (v) return v;
      } catch {}
      await sleep(150);
    }
    throw new Error(`${this.name}: wartet vergeblich auf ${what}`);
  }
  /** Clicks the first button whose text matches (overlay buttons, list, form). */
  async click(text, where = '#ov-buttons button, #level-list button, #ov-form button') {
    const sel = JSON.stringify(where);
    const t = JSON.stringify(text);
    await this.waitFor(`[...document.querySelectorAll(${sel})].some(b => b.textContent.includes(${t}) && !b.disabled)`, `Knopf „${text}“`);
    await this.eval(`[...document.querySelectorAll(${sel})].find(b => b.textContent.includes(${t}) && !b.disabled).click()`);
  }
}

const chrome =
  process.env.CHROME ??
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!chrome) throw new Error('Chrome nicht gefunden (CHROME=…)');

const profile = mkdtempSync(join(tmpdir(), 'murmel-e2e-'));
let ok = false;
try {
  start(process.execPath, ['server/src/raum-dev.ts'], { PORT: String(API_PORT) });
  start('npx', ['vite', '--port', String(WEB_PORT), '--strictPort', '--host', '127.0.0.1'], { MURMEL_API: `http://127.0.0.1:${API_PORT}` });
  await waitHttp(`http://127.0.0.1:${WEB_PORT}/`);
  log('Dev-Server läuft');
  start(chrome, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    // two tabs on one machine: plain host candidates instead of mDNS names
    '--disable-features=WebRtcHideLocalIpsWithMdns',
    '--use-gl=swiftshader',
    'about:blank',
  ]);
  await waitHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
  const url = `http://127.0.0.1:${WEB_PORT}/`;
  const a = await Tab.open('A', url);
  const b = await Tab.open('B', url);
  for (const t of [a, b]) await t.waitFor(`!!window.__zuZweit && [...document.querySelectorAll('#ov-buttons button')].some(b => b.textContent === 'Zu zweit')`, 'Startmenü', 60_000);
  log('beide Tabs im Startmenü');

  const packTitle = JSON.parse(readFileSync(new URL('public/levels/enigma/index.json', ROOT))).find((p) => p.pack === 'enigma_iii').title;
  await a.click('Zu zweit');
  await a.click('Raum öffnen');
  await a.click('Gemeinsam');
  await a.click(packTitle);
  await a.click('Bridge Builders');
  const code = await a.waitFor(`/^\\d{4}$/.test(window.__zuZweit.code()) && window.__zuZweit.code()`, 'Raumcode');
  const shown = await a.eval(`document.querySelector('.zz-code')?.textContent`);
  if (shown !== code) throw new Error(`Code im Dialog ${shown} ≠ ${code}`);
  log('Raum offen, Code', code);

  await b.click('Zu zweit');
  await b.click('Beitreten');
  await b.waitFor(`!!document.querySelector('#zz-code')`, 'Codefeld');
  await b.eval(`(() => { const i = document.querySelector('#zz-code'); i.value = ${JSON.stringify(code)}; i.dispatchEvent(new Event('input')); i.form.requestSubmit(); })()`);

  for (const t of [a, b]) await t.waitFor(`window.__zuZweit.status() === 'verbunden' && window.__zuZweit.phase() === 'spiel'`, 'Verbindung und Start', 30_000);
  log('verbunden, Level geladen bei beiden');
  for (const t of [a, b]) await t.click('Spielen');
  const levelA = await a.eval(`window.__zuZweit.session().level.id`);
  const levelB = await b.eval(`window.__zuZweit.session().level.id`);
  if (levelA !== 'enigma:wb4' || levelB !== levelA) throw new Error(`Level ${levelA} / ${levelB}`);
  const seeds = await Promise.all([a, b].map((t) => t.eval(`window.__zuZweit.session().seed`)));
  if (seeds[0] !== seeds[1]) throw new Error(`Startwerte ${seeds}`);
  const statusText = await b.eval(`document.querySelector('#zz-status').textContent`);
  if (!statusText.includes('verbunden')) throw new Error(`Statusmarke: ${statusText}`);

  const white = `(() => { const s = window.__zuZweit.session(); const m = s.physics.marbles[s.marbleOf(1)]; return [m.pos.x, m.pos.y]; })()`;
  const before = await a.eval(white);
  // Taste im Fenster des Gasts (ein Tab ohne Fenster bekommt keinen Tastaturfokus)
  const steps0 = await Promise.all([a, b].map((t) => t.eval(`window.__zuZweit.session().steps`)));
  await b.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown', key: 'ArrowDown' }))`);
  await sleep(1500);
  await b.eval(`window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowDown', key: 'ArrowDown' }))`);
  log('Schritte vor der Eingabe', steps0.join(' / '), '· Modus', await b.eval(`document.body.dataset.mode`));
  await sleep(800);
  const afterA = await a.eval(white);
  const afterB = await b.eval(white);
  log('weiße Murmel beim Gastgeber', before.map((v) => v.toFixed(2)).join(','), '→', afterA.map((v) => v.toFixed(2)).join(','), '· beim Gast', afterB.map((v) => v.toFixed(2)).join(','));
  if (Math.hypot(afterA[0] - before[0], afterA[1] - before[1]) < 0.1) throw new Error('Die Eingabe des Gasts bewegt die weiße Murmel beim Gastgeber nicht');
  if (Math.hypot(afterA[0] - afterB[0], afterA[1] - afterB[1]) > 0.5) throw new Error('Der Gast folgt dem Gastgeber nicht');
  const steps = await Promise.all([a, b].map((t) => t.eval(`window.__zuZweit.session().steps`)));
  log('Schritte Gastgeber/Gast', steps.join(' / '));

  // Abbruch: der Tab des Gastgebers wird geschlossen
  a.ws.close();
  await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${a.targetId}`);
  await b.waitFor(`/Verbindung verloren|verlassen/.test(document.body.innerText) || window.__zuZweit.status() === 'abgebrochen'`, 'Abbruchanzeige', 20_000);
  log('Abbruch erkannt');

  log('Gast zeigt:', (await b.eval(`document.querySelector('#ov-title')?.textContent`)) ?? '', '·', await b.eval(`window.__zuZweit.status()`));
  const errors = [...a.errors, ...b.errors].filter((e) => !/requestPointerLock|pointer lock/i.test(e));
  if (errors.length) throw new Error(`Fehler in der Seite:\n${errors.join('\n')}`);
  ok = true;
  log('OK');
} catch (e) {
  console.error('[e2e] FEHLGESCHLAGEN:', e.message);
} finally {
  for (const p of procs) {
    if (process.platform === 'win32' && p.pid) spawn('taskkill', ['/pid', String(p.pid), '/t', '/f'], { stdio: 'ignore' });
    else p.kill();
  }
  await sleep(1000);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
  process.exit(ok ? 0 : 1);
}
