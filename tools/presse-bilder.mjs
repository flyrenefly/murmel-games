// Screenshots der Pressemappe (presse.html) erzeugen, deutsch oder englisch:
//   npm run build
//   npm run presse:bilder -- --lang en                → public/presse/en/*.webp
//   node tools/presse-bilder.mjs --lang de            → public/presse/*.webp
// Startet `vite preview` (Port 4183) und Chrome ohne Fenster (CDP, Port 9334) mit frischem Profil,
// setzt Stil und Sprache im localStorage, öffnet die Levels über #start=<paket>/<level> bzw. den
// Editor über #level=… (src/levels/03.json) und speichert WebP (Qualität 82) direkt aus Chrome.
// CHROME=Pfad zu chrome/msedge, sonst Standardpfade. --base http://… nimmt einen laufenden Server.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { deflateRawSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { values: o } = parseArgs({ options: { lang: { type: 'string', default: 'en' }, out: { type: 'string' }, base: { type: 'string' } } });
if (o.lang !== 'de' && o.lang !== 'en') throw new Error('--lang de|en');
const OUT = resolve(ROOT, o.out ?? (o.lang === 'de' ? 'public/presse' : `public/presse/${o.lang}`));
const WEB_PORT = 4183;
const CDP_PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];

/** Level als Editor-Link wie src/editor/link.ts (encodeLevel): '1.' + base64url(deflate-raw(JSON)). */
function editorLink(file, lang) {
  const { titleEn, author, basedOn, map, legend, start, objects, actors, mainPearl } = file;
  const title = lang === 'en' && titleEn ? titleEn : file.title;
  const json = JSON.stringify({ title, author, basedOn, map, legend, start, objects, actors, mainPearl });
  return `#level=1.${deflateRawSync(Buffer.from(json, 'utf8')).toString('base64url')}`;
}

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
// gleiche Motive wie die deutschen Bilder (PR 47); Dateinamen wie in presse.html
const SHOTS = [
  { file: 'murmel-1-klassisch.webp', style: 'klassisch', view: DESKTOP, path: '#start=enigma_i/enigma%3Amartin12', play: true },
  { file: 'murmel-2-glas.webp', style: 'glas', view: DESKTOP, path: '#start=enigma_i/enigma%3Aduffy19', play: true },
  { file: 'murmel-3-levels.webp', style: 'klassisch', view: DESKTOP, path: '#start=enigma_i/enigma%3Anat7', play: true, levels: true },
  { file: 'murmel-4-editor.webp', style: 'klassisch', view: DESKTOP, path: `editor.html${editorLink(JSON.parse(readFileSync(join(ROOT, 'src/levels/03.json'), 'utf8')), o.lang)}`, editor: true },
  { file: 'murmel-5-handy.webp', style: 'klassisch', view: PHONE, path: '#start=enigma_i/enigma%3Anat7' },
];

function start(cmd, args) {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' && cmd === 'npx' });
  procs.push(p);
  return p;
}

async function waitHttp(url, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {}
    await sleep(250);
  }
  throw new Error(`${url} antwortet nicht`);
}

async function cdp(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  const send = (method, params = {}) => {
    const i = ++id;
    ws.send(JSON.stringify({ id: i, method, params }));
    return new Promise((res, rej) => pending.set(i, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result))));
  };
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value;
  };
  const waitFor = async (expression, what, ms = 20_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        if (await evaluate(expression)) return;
      } catch {}
      await sleep(150);
    }
    throw new Error(`wartet vergeblich auf ${what}`);
  };
  return { ws, send, evaluate, waitFor };
}

/** Neues Fenster (ein Hintergrund-Tab bekäme keine Animationsbilder). */
async function newPage() {
  const version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
  const browser = await cdp(version.webSocketDebuggerUrl);
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', newWindow: true });
  browser.ws.close();
  const info = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((x) => x.id === targetId);
  const page = await cdp(info.webSocketDebuggerUrl);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  return { ...page, targetId };
}

async function shoot(base, shot) {
  const page = await newPage();
  try {
    await page.send('Emulation.setDeviceMetricsOverride', { ...shot.view, screenWidth: shot.view.width, screenHeight: shot.view.height });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: shot.view.mobile, maxTouchPoints: shot.view.mobile ? 5 : 1 });
    if (shot.view.mobile) await page.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
    // Stil und Sprache vor dem Laden setzen (gleicher Ursprung)
    await page.send('Page.navigate', { url: `${base}/robots.txt` });
    await page.waitFor('document.readyState === "complete"', 'robots.txt');
    const style = JSON.stringify(JSON.stringify(shot.style));
    await page.evaluate(`localStorage.clear(); localStorage.setItem('murmel.sprache', ${JSON.stringify(o.lang)}); localStorage.setItem('murmel.style', ${style}); localStorage.setItem('murmel.editor.style', ${style}); true`);
    await page.send('Page.navigate', { url: `${base}/${shot.path}` });
    if (shot.editor) {
      await page.waitFor('document.querySelector("#ed-title")?.value && document.fonts.status === "loaded"', 'Editor mit Level', 30_000);
      // bis der Hinweis „Geteiltes Level geöffnet …“ (4 s) verschwunden ist
      await page.waitFor('document.querySelector("#ed-toast")?.hidden !== false', 'Hinweis weg', 10_000);
      await sleep(1000);
    } else {
      // die Startkarte des Levels; das Spielfeld dahinter braucht noch die Bilder
      await page.waitFor('document.querySelector("#ov-buttons button") && document.fonts.status === "loaded"', 'Startkarte', 30_000);
      await sleep(4000);
      if (shot.play) {
        // Spielfeld ohne Startkarte, Uhr bei 0:00 (wie die deutschen Bilder; im Spielmodus käme „Esc = Menü“ dazu)
        await page.evaluate('document.getElementById("overlay").hidden = true; true');
        await sleep(500);
      }
      if (shot.levels) {
        await page.evaluate('document.querySelector("#btn-levels").click(); true');
        await page.waitFor('document.querySelector("#level-list button")', 'Levelliste');
        await sleep(1000);
      }
    }
    const { data } = await page.send('Page.captureScreenshot', { format: 'webp', quality: 82 });
    writeFileSync(join(OUT, shot.file), Buffer.from(data, 'base64'));
    console.log(`${o.lang}/${shot.file}`);
  } finally {
    page.ws.close();
    const version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
    const browser = await cdp(version.webSocketDebuggerUrl);
    await browser.send('Target.closeTarget', { targetId: page.targetId }).catch(() => {});
    browser.ws.close();
  }
}

const chrome =
  process.env.CHROME ??
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!chrome) throw new Error('Chrome nicht gefunden (CHROME=…)');
if (!o.base && !existsSync(join(ROOT, 'dist/index.html'))) throw new Error('dist/ fehlt: erst npm run build');

const profile = mkdtempSync(join(tmpdir(), 'murmel-presse-'));
try {
  let base = o.base?.replace(/\/$/, '');
  if (!base) {
    start('npx', ['vite', 'preview', '--port', String(WEB_PORT), '--strictPort', '--host', '127.0.0.1']);
    base = `http://127.0.0.1:${WEB_PORT}`;
  }
  await waitHttp(`${base}/`);
  start(chrome, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', '--force-color-profile=srgb', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank']);
  await waitHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
  mkdirSync(OUT, { recursive: true });
  for (const shot of SHOTS) await shoot(base, shot);
} finally {
  for (const p of procs) {
    if (process.platform === 'win32' && p.pid) spawn('taskkill', ['/pid', String(p.pid), '/t', '/f'], { stdio: 'ignore' });
    else p.kill();
  }
  await sleep(2000);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch {
    console.warn(`Chrome-Profil nicht gelöscht (noch gesperrt): ${profile}`);
  }
}
