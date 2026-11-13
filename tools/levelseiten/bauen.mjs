// Levelseiten bauen (docs/SPEC-levelseiten.md), nach `vite build`:
//   node --experimental-transform-types --no-warnings tools/levelseiten/bauen.mjs [--dist dist] [--jobs N] [--max N]
// Schreibt dist/level/ (Startseite, Paketseiten, Levelseiten mit vorschau.webp, bestzeiten.js) und
// dist/sitemap.xml (public/sitemap.xml plus alle kanonischen Levelseiten). --max N: nur die ersten
// N Levels je Paket (zum Ausprobieren). Ein Level ohne Vorschaubild bricht den Build ab.
import { fork } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { register, stripTypeScriptTypes } from 'node:module';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadLevels, ROOT } from '../lib/levels.mjs';

register('../lib/ts-hooks.mjs', import.meta.url);
const S = await import('../../src/levelseiten/seiten.ts');

const { values: o } = parseArgs({
  options: {
    dist: { type: 'string', default: 'dist' },
    jobs: { type: 'string', default: String(Math.min(8, availableParallelism())) },
    max: { type: 'string' },
  },
});
const t0 = Date.now();
const DIST = resolve(ROOT, o.dist);
const OUT = join(DIST, S.ROOT_DIR);
const max = o.max ? Number(o.max) : Infinity;

// ---------- Pakete in Spielreihenfolge ----------
const titles = new Map(JSON.parse(readFileSync(join(ROOT, 'public/levels/enigma/index.json'), 'utf8')).map((p) => [p.pack, p.title]));
titles.set('murmel', 'Murmel');
const sources = [];
for (const { pack, file } of loadLevels()) {
  let src = sources.at(-1);
  if (src?.id !== pack) sources.push((src = { id: pack, title: titles.get(pack) ?? pack, levels: [] }));
  if (src.levels.length < max) src.levels.push(file);
}
const packs = S.buildPages(sources);
const pages = packs.flatMap((p) => p.levels);

// ---------- Vorschaubilder in Kindprozessen ----------
rmSync(OUT, { recursive: true, force: true });
const WORKER = fileURLToPath(new URL('./vorschau-worker.mjs', import.meta.url));
const sizes = new Map();
const errors = [];
let bytes = 0;
let next = 0;
async function lane() {
  if (next >= pages.length) return;
  const c = fork(WORKER, [], { execArgv: ['--experimental-transform-types', '--no-warnings'], serialization: 'advanced', stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  await new Promise((res, rej) => {
    c.once('message', res);
    c.once('exit', (code) => rej(new Error(`Vorschau-Prozess beendet (${code})`)));
  });
  c.removeAllListeners('exit');
  while (next < pages.length) {
    const i = next++;
    const p = pages[i];
    const r = await new Promise((res) => {
      const timer = setTimeout(() => res({ error: 'Zeitüberschreitung (60 s)' }), 60_000);
      const onExit = (code) => res({ error: `Vorschau-Prozess beendet (${code})` });
      c.once('exit', onExit);
      const onMsg = (m) => {
        if (m.i !== i) return;
        clearTimeout(timer);
        c.off('message', onMsg);
        c.off('exit', onExit);
        res(m);
      };
      c.on('message', onMsg);
      c.send({ i, file: p.file, dir: join(DIST, p.path) });
    });
    if (r.error) {
      errors.push(`${p.path}: ${r.error}`);
      if (/beendet|Zeitüberschreitung/.test(r.error)) break;
    } else {
      sizes.set(p.path, { width: r.width, height: r.height });
      bytes += r.bytes;
    }
  }
  c.kill();
}
await Promise.all(Array.from({ length: Math.max(1, Number(o.jobs)) }, lane));
if (sizes.size + errors.length < pages.length) errors.push(`${pages.length - sizes.size - errors.length} Vorschaubilder fehlen`);
if (errors.length) {
  console.error(`Levelseiten: ${errors.length} Vorschaubilder gescheitert:\n  ${errors.slice(0, 20).join('\n  ')}`);
  process.exit(1);
}
const tImages = Date.now();

// ---------- Seiten ----------
const write = (path, text) => {
  mkdirSync(join(DIST, path), { recursive: true });
  writeFileSync(join(DIST, path, 'index.html'), text);
};
for (const p of pages) write(p.path, S.levelHtml(p, sizes.get(p.path)));
for (const p of packs) write(p.path, S.packHtml(p, sizes));
write(`${S.ROOT_DIR}/`, S.indexHtml(packs, sizes));
const client = readFileSync(join(ROOT, 'src/levelseiten/bestzeiten.ts'), 'utf8');
writeFileSync(join(OUT, 'bestzeiten.js'), stripTypeScriptTypes(client, { mode: 'strip' }));
const staticXml = readFileSync(join(ROOT, 'public/sitemap.xml'), 'utf8');
const paths = S.sitemapPaths(packs);
writeFileSync(join(DIST, 'sitemap.xml'), S.sitemapXml(staticXml, paths));

const secs = (ms) => (ms / 1000).toFixed(1);
console.log(
  `Levelseiten: ${pages.length} Levelseiten, ${packs.length} Paketseiten, 1 Übersicht; Sitemap +${paths.length} Adressen; ` +
    `Vorschaubilder ${(bytes / 1048576).toFixed(1)} MB; ${secs(Date.now() - t0)} s (Bilder ${secs(tImages - t0)} s, ${o.jobs} Prozesse)`,
);
