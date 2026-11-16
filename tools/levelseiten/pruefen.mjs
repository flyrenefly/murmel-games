// HTML-/Metadaten-Check der gebauten Levelseiten (docs/SPEC-levelseiten.md), nach `npm run build`:
//   node tools/levelseiten/pruefen.mjs [dist]
// Je Seite unter dist/level/ (lang="de") und dist/en/level/ (lang="en", docs/SPEC-englisch.md): genau
// ein <title>, eine Description, genau ein <h1>, genau ein Canonical (absolut, murmel.games, in der
// Sprache der Seite), hreflang de/en/x-default (x-default = de; paarweise: jede Sprachfassung gibt es
// und sie nennt dieselben Alternativen), og:locale, og:image als Datei unter level/, gültiges JSON-LD;
// jeder relative Link und jedes Bild zeigt auf eine vorhandene Datei. Die Sitemap nennt jede kanonische
// Levelseite. Exit 1 bei Fehlern.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';

const DIST = resolve(process.argv[2] ?? 'dist');
const SITE = 'https://murmel.games/';
const LOCALE = { de: 'de_DE', en: 'en_US' };
const errors = [];
const fail = (page, msg) => errors.push(`${page}: ${msg}`);

function htmlFiles(dir, rel = '') {
  return readdirSync(join(dir, rel)).flatMap((n) => {
    const r = rel ? `${rel}/${n}` : n;
    return statSync(join(dir, r)).isDirectory() ? htmlFiles(dir, r) : n === 'index.html' ? [r] : [];
  });
}

const count = (html, re) => (html.match(re) ?? []).length;
const canonicals = new Set();
/** Seite → ihre hreflang-Alternativen als sortierter Text (für den paarweisen Vergleich). */
const pageAlternates = new Map();
const files = [...htmlFiles(DIST, 'level'), ...(existsSync(join(DIST, 'en', 'level')) ? htmlFiles(DIST, 'en/level') : [])];
if (!files.some((f) => f.startsWith('en/'))) fail('en/level/', 'englische Levelseiten fehlen');
for (const f of files) {
  const html = readFileSync(join(DIST, f), 'utf8');
  const dir = posix.dirname(f) + '/';
  const lang = f.startsWith('en/') ? 'en' : 'de';
  if (!html.startsWith(`<!doctype html>\n<html lang="${lang}">`)) fail(f, `kein <!doctype html> mit lang="${lang}"`);
  if (!html.includes(`<meta property="og:locale" content="${LOCALE[lang]}">`)) fail(f, `og:locale ${LOCALE[lang]} fehlt`);
  if (count(html, /<title>[^<]+<\/title>/g) !== 1) fail(f, 'nicht genau ein <title>');
  if (count(html, /<meta name="description" content="[^"]{30,}">/g) !== 1) fail(f, 'keine Description (≥ 30 Zeichen)');
  if (count(html, /<h1[ >]/g) !== 1) fail(f, `${count(html, /<h1[ >]/g)} × <h1>`);
  const can = [...html.matchAll(/<link rel="canonical" href="([^"]+)">/g)].map((m) => m[1]);
  if (can.length !== 1 || !can[0].startsWith(SITE) || !can[0].endsWith('/')) fail(f, `Canonical: ${can.join(', ') || 'fehlt'}`);
  else if (can[0].startsWith(`${SITE}en/`) !== (lang === 'en')) fail(f, `Canonical in der falschen Sprache: ${can[0]}`);
  else {
    canonicals.add(can[0]);
    if (!existsSync(join(DIST, can[0].slice(SITE.length), 'index.html'))) fail(f, `Canonical zeigt ins Leere: ${can[0]}`);
  }
  // hreflang: de, en, x-default (= de); die eigene Sprache ist der Canonical
  const altList = [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map((m) => [m[1], m[2]]);
  const alt = Object.fromEntries(altList);
  if (altList.map(([l]) => l).sort().join() !== 'de,en,x-default') fail(f, `hreflang: ${altList.map(([l]) => l).join(', ') || 'fehlt'}`);
  else {
    if (alt['x-default'] !== alt.de) fail(f, 'x-default ist nicht die deutsche Fassung');
    if (!alt.de.startsWith(SITE) || alt.en !== alt.de.replace(SITE, `${SITE}en/`)) fail(f, `hreflang de/en passen nicht zusammen: ${alt.de} / ${alt.en}`);
    if (can.length === 1 && alt[lang] !== can[0]) fail(f, `hreflang ${lang} ist nicht der Canonical: ${alt[lang]}`);
    pageAlternates.set(f, altList.map((a) => a.join(' ')).sort().join('\n'));
  }
  const og = /<meta property="og:image" content="([^"]+)">/.exec(html)?.[1];
  if (!og) fail(f, 'og:image fehlt');
  else if (og.startsWith(`${SITE}en/`)) fail(f, `og:image unter en/ (Bilder gibt es nur unter level/): ${og}`);
  else if (og.startsWith(`${SITE}level/`) && !existsSync(join(DIST, og.slice(SITE.length)))) fail(f, `og:image fehlt als Datei: ${og}`);
  for (const t of ['og:title', 'og:description', 'og:url', 'og:locale:alternate', 'twitter:card']) if (!html.includes(`"${t}"`)) fail(f, `${t} fehlt`);
  for (const m of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) {
    try {
      JSON.parse(m[1]);
    } catch {
      fail(f, 'JSON-LD ungültig');
    }
  }
  if (!html.includes('application/ld+json')) fail(f, 'JSON-LD fehlt');
  // relative Verweise (href/src), ohne Hash und Query
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const ref = m[1].replace(/&amp;/g, '&');
    if (/^(https?:|mailto:|#)/.test(ref)) continue;
    const path = posix.normalize(posix.join(dir, ref.split(/[?#]/)[0]));
    if (path.startsWith('..')) fail(f, `Verweis über die Wurzel hinaus: ${ref}`);
    else if (!existsSync(join(DIST, path)) || (path.endsWith('/') && !existsSync(join(DIST, path, 'index.html')))) fail(f, `Verweis ins Leere: ${ref}`);
  }
}
// paarweise: jede genannte Sprachfassung gibt es, und sie nennt dieselben Alternativen
for (const [f, alts] of pageAlternates) {
  for (const line of alts.split('\n')) {
    const target = `${line.split(' ')[1].slice(SITE.length)}index.html`;
    if (!existsSync(join(DIST, target))) fail(f, `Sprachfassung fehlt: ${target}`);
    else if (pageAlternates.has(target) && pageAlternates.get(target) !== alts) fail(f, `Sprachfassung ${target} nennt andere Alternativen`);
  }
}
const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
for (const c of canonicals) if (!sitemap.includes(`<loc>${c}</loc>`)) fail('sitemap.xml', `fehlt: ${c}`);
if (!sitemap.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"')) fail('sitemap.xml', 'Namensraum xmlns:xhtml fehlt');
const sw = existsSync(join(DIST, 'sw.js')) ? readFileSync(join(DIST, 'sw.js'), 'utf8') : '';
if (sw.includes('"level/') || sw.includes('"en/level/')) fail('sw.js', 'Levelseiten im Offline-Speicher');

if (errors.length) {
  console.error(`Levelseiten-Check: ${errors.length} Fehler\n  ${errors.slice(0, 30).join('\n  ')}`);
  process.exit(1);
}
console.log(`Levelseiten-Check: ${files.length} Seiten ok (de und en; je ein h1 und Canonical, hreflang paarweise, Metadaten, Links, Bilder), Sitemap mit ${canonicals.size} kanonischen Seiten`);
