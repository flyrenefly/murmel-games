// Levelseiten (docs/SPEC-levelseiten.md): Adressen, Metadaten und HTML der statischen Seiten je Level,
// je Paket und „Alle Levels“, dazu die Sitemap. Reine Funktionen ohne Dateizugriff: der Generator
// tools/levelseiten/bauen.mjs liest die Levels, macht die Vorschaubilder und schreibt die Dateien.
import type { LevelFile } from '../game/level';

export const SITE = 'https://murmel.games';
/** Ordner der Levelseiten unter dist/ (und auf der Website). */
export const ROOT_DIR = 'level';
const DESCRIPTION_MAX = 155;

export interface PackSource {
  id: string;
  title: string;
  levels: LevelFile[];
}

export interface PackPage {
  id: string;
  title: string;
  slug: string;
  /** Pfad ohne führenden Schrägstrich, mit Schrägstrich am Ende: "level/enigma-ii/". */
  path: string;
  levels: LevelPage[];
}

export interface LevelPage {
  file: LevelFile;
  pack: PackPage;
  /** Position im Paket, ab 1. */
  nr: number;
  slug: string;
  path: string;
  /** Erste Fundstelle derselben Level-ID in Spielreihenfolge (Canonical). */
  canonicalPath: string;
}

export interface ImageSize {
  width: number;
  height: number;
}

// ---------- Adressen ----------

/** Klein, ASCII, Wörter mit "-": "Schwarz-Weiss-Gebäck" → "schwarz-weiss-gebaeck". */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

export function packSlug(id: string): string {
  return slugify(id.replace(/_/g, '-')) || 'paket';
}

/** Slug aus der Level-ID: "enigma:m_tutor/m_tut6" → "m-tutor-m-tut6". */
function idSlug(id: string): string {
  return slugify(id.replace(/^enigma:/, '').replace(/_/g, '-')) || 'level';
}

/**
 * Alle Seiten in Spielreihenfolge. Levelslug = Titel; gibt es ihn im Paket mehrmals, bekommen alle
 * diese Levels den Slug ihrer ID angehängt (unabhängig von der Reihenfolge, also stabil).
 */
export function buildPages(packs: PackSource[]): PackPage[] {
  const first = new Map<string, string>();
  const usedPacks = new Set<string>();
  return packs.map((src) => {
    const slug = packSlug(src.id);
    if (usedPacks.has(slug)) throw new Error(`Paket-Slug doppelt: ${slug}`);
    usedPacks.add(slug);
    const pack: PackPage = { id: src.id, title: src.title, slug, path: `${ROOT_DIR}/${slug}/`, levels: [] };
    const base = src.levels.map((f) => slugify(f.title) || idSlug(f.id));
    const count = new Map<string, number>();
    for (const b of base) count.set(b, (count.get(b) ?? 0) + 1);
    const used = new Set<string>();
    src.levels.forEach((file, i) => {
      let s = base[i];
      if (count.get(s)! > 1) s = `${s}-${idSlug(file.id)}`;
      // dieselbe ID zweimal im Paket: Position anhängen (kommt in den Daten nicht vor)
      if (used.has(s)) s = `${s}-${i + 1}`;
      used.add(s);
      const path = `${pack.path}${s}/`;
      if (!first.has(file.id)) first.set(file.id, path);
      pack.levels.push({ file, pack, nr: i + 1, slug: s, path, canonicalPath: first.get(file.id)! });
    });
    return pack;
  });
}

/** Hash, mit dem das Spiel genau dieses Level startet (src/startlink.ts). */
export function playHash(packId: string, levelId: string): string {
  return `#start=${encodeURIComponent(packId)}/${encodeURIComponent(levelId)}`;
}

/** Relativer Weg von einer Seite (Pfad mit "/" am Ende) zur Wurzel der Website. */
function up(path: string): string {
  return '../'.repeat(path.split('/').length - 1);
}

// ---------- Texte ----------

const escapeMap: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => escapeMap[c]);
}

/** Leerzeichen zusammenfassen; zu lange Texte an einer Wortgrenze kürzen. */
export function shorten(text: string, max = DESCRIPTION_MAX): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.–-]+$/, '')}…`;
}

/** Titel ohne Zierstriche: "- meditation -" → "meditation". */
export function displayTitle(file: LevelFile): string {
  return file.title.replace(/^[\s-]+|[\s-]+$/g, '').trim() || file.title.trim() || file.id;
}

/** Kürzere Texte („Welcome to Enigma II“) taugen nicht als Beschreibung. */
const TEXT_MIN = 40;

/** Der erste brauchbare Text des Levels (Dokumente), sonst eine erzeugte Zeile. */
export function describe(p: LevelPage): string {
  const text = Object.values(p.file.texts ?? {}).find((t) => t.replace(/\s+/g, ' ').trim().length >= TEXT_MIN);
  if (text) return shorten(text);
  const author = p.file.author ? ` von ${p.file.author}` : '';
  return shorten(`„${displayTitle(p.file)}“ ist Level ${p.nr} von ${p.pack.levels.length} im Paket ${p.pack.title}${author}. Kostenlos im Browser spielen – wie Oxyd und Enigma.`);
}

/** Lizenz-Adresse für bekannte Angaben (JSON-LD), sonst null. */
export function licenseUrl(license: string): string | null {
  const l = license.toLowerCase();
  if (/gp[lj].*(3\.0|v3|version 3)/.test(l)) return 'https://www.gnu.org/licenses/gpl-3.0.html';
  if (/gp[lj]/.test(l)) return 'https://www.gnu.org/licenses/old-licenses/gpl-2.0.html';
  return null;
}

/** Lesbare Lizenz: "GPL v2.0 or above" → "GPL 2.0 oder später". */
export function licenseLabel(license: string): string {
  const l = license.trim();
  if (/^gp[lj] v?2\.0 or above$/i.test(l)) return 'GPL 2.0 oder später';
  if (/^gpl version 2$|^gpl v2\.0$/i.test(l)) return 'GPL 2.0';
  if (l === 'GPL-3.0-or-later') return 'GPL 3.0 oder später';
  if (/^donated to enigma under the project'?s license$/i.test(l)) return 'GPL (an Enigma gespendet, Projektlizenz)';
  if (/^public domain/i.test(l)) return 'gemeinfrei (public domain)';
  return l || 'unbekannt';
}

function jsonLd(data: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

const GAME = { '@type': 'VideoGame', name: 'Murmel', url: `${SITE}/`, gamePlatform: 'Web browser', isAccessibleForFree: true, inLanguage: 'de' };

// ---------- HTML ----------

interface Head {
  title: string;
  description: string;
  path: string;
  canonicalPath?: string;
  image: string;
  imageSize?: ImageSize;
  imageAlt: string;
  ld: unknown[];
}

function head(h: Head): string {
  const canonical = `${SITE}/${h.canonicalPath ?? h.path}`;
  const size = h.imageSize ? `<meta property="og:image:width" content="${h.imageSize.width}"><meta property="og:image:height" content="${h.imageSize.height}">` : '';
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f7f6f2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0b0b12" media="(prefers-color-scheme: dark)">
<title>${esc(h.title)}</title>
<meta name="description" content="${esc(h.description)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${esc(canonical)}">
<link rel="icon" href="${up(h.path)}favicon.svg" type="image/svg+xml">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Murmel">
<meta property="og:locale" content="de_DE">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:title" content="${esc(h.title)}">
<meta property="og:description" content="${esc(h.description)}">
<meta property="og:image" content="${esc(h.image)}">${size}
<meta property="og:image:alt" content="${esc(h.imageAlt)}">
<meta name="twitter:card" content="summary_large_image">
${h.ld.map(jsonLd).join('\n')}
<style>${CSS}</style>
</head>`;
}

function top(path: string): string {
  const r = up(path);
  return `<header class="top"><a class="brand" href="${r}"><img src="${r}favicon.svg" width="28" height="28" alt="">Murmel</a><a class="btn small" href="${r}">Zum Spiel</a></header>`;
}

function foot(path: string): string {
  const r = up(path);
  return `<footer><nav aria-label="Fußzeile"><a href="${r}${ROOT_DIR}/">Alle Levels</a><a href="${r}ueber.html">Über Murmel</a><a href="${r}impressum.html">Impressum</a><a href="${r}datenschutz.html">Datenschutz</a></nav><p>Levels und Grafik aus <a href="https://www.nongnu.org/enigma/">Enigma</a> unter der GPL. Murmel ist freie Software.</p></footer>`;
}

function crumbs(items: [string, string][]): string {
  return `<nav class="crumbs" aria-label="Pfad"><ol>${items.map(([href, label], i) => `<li>${i === items.length - 1 ? `<span aria-current="page">${esc(label)}</span>` : `<a href="${href}">${esc(label)}</a>`}</li>`).join('')}</ol></nav>`;
}

function breadcrumbLd(items: [string, string][]): unknown {
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([path, name], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${SITE}/${path}` })) };
}

/** Breite der kleinen Bilder (klein.webp, tools/levelseiten/vorschau.mjs THUMB_WIDTH). */
export const THUMB_WIDTH = 320;
function thumbAttrs(s: ImageSize | undefined): string {
  if (!s) return '';
  const w = Math.min(THUMB_WIDTH, s.width);
  return ` width="${w}" height="${Math.round((s.height * w) / s.width)}"`;
}

const imageUrl = (p: LevelPage) => `${SITE}/${p.path}vorschau.webp`;
const altText = (p: LevelPage) => `Spielfeld von „${displayTitle(p.file)}“ im Stil Klassisch`;

/** Seitentitel einer Levelseite. */
export function levelTitle(p: LevelPage): string {
  return `${displayTitle(p.file)} – Level ${p.nr}, ${p.pack.title} | Murmel`;
}

export function levelHtml(p: LevelPage, size: ImageSize): string {
  const { file, pack } = p;
  const r = up(p.path);
  const title = displayTitle(file);
  const description = describe(p);
  const prev = pack.levels[p.nr - 2];
  const next = pack.levels[p.nr];
  const lic = licenseUrl(file.license);
  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'CreativeWork',
      name: title,
      description,
      url: `${SITE}/${p.canonicalPath}`,
      image: imageUrl(p),
      inLanguage: 'de',
      position: p.nr,
      ...(file.author ? { author: { '@type': 'Person', name: file.author } } : {}),
      license: lic ?? file.license,
      genre: 'Rätsel',
      isPartOf: { ...GAME, '@type': ['VideoGame', 'CreativeWorkSeries'], name: `Murmel – ${pack.title}` },
    },
    breadcrumbLd([[`${ROOT_DIR}/`, 'Alle Levels'], [pack.path, pack.title], [p.path, title]]),
  ];
  const ranking = `${r}bestenliste.html?${new URLSearchParams({ level: file.id, titel: file.title }).toString().replace(/&/g, '&amp;')}`;
  const source = file.source ? ` · Quelle: Enigma, ${esc(file.source.file)}` : '';
  return `${head({ title: levelTitle(p), description, path: p.path, canonicalPath: p.canonicalPath, image: imageUrl(p), imageSize: size, imageAlt: altText(p), ld })}
<body>
<main>
${top(p.path)}
${crumbs([[`${r}${ROOT_DIR}/`, 'Alle Levels'], [`../`, pack.title], ['', title]])}
<h1>${esc(title)}</h1>
<p class="meta">Level ${p.nr} von ${pack.levels.length} · ${esc(pack.title)}${file.author ? ` · von ${esc(file.author)}` : ''}</p>
<figure class="field"><img src="vorschau.webp" width="${size.width}" height="${size.height}" alt="${esc(altText(p))}"></figure>
<p class="lead">${esc(description)}</p>
<p class="cta"><a class="btn play" href="${r}${playHash(pack.id, file.id)}">Jetzt spielen</a></p>
<section class="best" aria-labelledby="bz-titel">
<h2 id="bz-titel">Bestzeiten</h2>
<div id="bestzeiten" data-level="${esc(file.id)}" aria-live="polite"></div>
<p class="muted">Geprüfte Zeiten angemeldeter Spieler. <a href="${ranking}">Ganze Rangliste</a></p>
</section>
<section class="facts" aria-labelledby="info-titel">
<h2 id="info-titel">Zum Level</h2>
<dl>
<dt>Paket</dt><dd><a href="../">${esc(pack.title)}</a>, Level ${p.nr} von ${pack.levels.length}</dd>
<dt>Autor</dt><dd>${esc(file.author || 'unbekannt')}</dd>
<dt>Lizenz</dt><dd>${lic ? `<a href="${lic}" rel="license">${esc(licenseLabel(file.license))}</a>` : esc(licenseLabel(file.license))}${source}</dd>
</dl>
</section>
<nav class="pager" aria-label="Weitere Levels">
${prev ? `<a class="prev" href="../${prev.slug}/"><small>Voriges Level</small>${esc(displayTitle(prev.file))}</a>` : '<span></span>'}
${next ? `<a class="next" href="../${next.slug}/"><small>Nächstes Level</small>${esc(displayTitle(next.file))}</a>` : '<span></span>'}
</nav>
<p class="back"><a href="../">Alle ${pack.levels.length} Levels von ${esc(pack.title)}</a></p>
${foot(p.path)}
</main>
<script type="module" src="${r}${ROOT_DIR}/bestzeiten.js"></script>
</body>
</html>
`;
}

export function packDescription(pack: PackPage): string {
  return shorten(`Alle ${pack.levels.length} Levels des Pakets ${pack.title} mit Vorschau, Autor und Bestzeiten – kostenlos im Browser spielen, wie Oxyd und Enigma.`);
}

export function packHtml(pack: PackPage, sizes: Map<string, ImageSize>): string {
  const r = up(pack.path);
  const firstImg = pack.levels[0] ? imageUrl(pack.levels[0]) : `${SITE}/og-image.png`;
  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: `${pack.title} – alle Levels`,
      url: `${SITE}/${pack.path}`,
      isPartOf: GAME,
      mainEntity: { '@type': 'ItemList', numberOfItems: pack.levels.length, itemListElement: pack.levels.map((p) => ({ '@type': 'ListItem', position: p.nr, url: `${SITE}/${p.path}`, name: displayTitle(p.file) })) },
    },
    breadcrumbLd([[`${ROOT_DIR}/`, 'Alle Levels'], [pack.path, pack.title]]),
  ];
  const cards = pack.levels
    .map((p) => {
      const s = sizes.get(p.path);
      return `<li><a href="${p.slug}/"><img src="${p.slug}/klein.webp" loading="lazy" decoding="async" alt=""${thumbAttrs(s)}><span class="nr">${p.nr}</span><b>${esc(displayTitle(p.file))}</b><small>${esc(p.file.author || '')}</small></a></li>`;
    })
    .join('\n');
  return `${head({ title: `${pack.title} – alle ${pack.levels.length} Levels | Murmel`, description: packDescription(pack), path: pack.path, image: firstImg, imageSize: pack.levels[0] ? sizes.get(pack.levels[0].path) : undefined, imageAlt: `Levels aus ${pack.title}`, ld })}
<body>
<main class="wide">
${top(pack.path)}
${crumbs([[`${r}${ROOT_DIR}/`, 'Alle Levels'], ['', pack.title]])}
<h1>${esc(pack.title)}</h1>
<p class="lead">${pack.levels.length === 1 ? '1 Level' : `${pack.levels.length} Levels`}. Wähle eines aus, um Vorschau, Bestzeiten und den Start im Spiel zu sehen.</p>
<ol class="grid">
${cards}
</ol>
${foot(pack.path)}
</main>
</body>
</html>
`;
}

export function indexHtml(packs: PackPage[], sizes: Map<string, ImageSize>): string {
  const path = `${ROOT_DIR}/`;
  const total = packs.reduce((n, p) => n + p.levels.length, 0);
  const description = shorten(`Alle ${total} Levels von Murmel in ${packs.length} Paketen: Vorschau, Autor, Lizenz und Bestzeiten. Kostenlos im Browser spielen, wie Oxyd und Enigma.`);
  const ld = [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Alle Levels', url: `${SITE}/${path}`, isPartOf: GAME, mainEntity: { '@type': 'ItemList', numberOfItems: packs.length, itemListElement: packs.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/${p.path}`, name: p.title })) } }];
  const cards = packs
    .map((p) => {
      const l = p.levels[0];
      const s = l ? sizes.get(l.path) : undefined;
      const img = l ? `<img src="${p.slug}/${l.slug}/klein.webp" loading="lazy" decoding="async" alt=""${thumbAttrs(s)}>` : '';
      return `<li><a href="${p.slug}/">${img}<b>${esc(p.title)}</b><small>${p.levels.length === 1 ? '1 Level' : `${p.levels.length} Levels`}</small></a></li>`;
    })
    .join('\n');
  return `${head({ title: `Alle ${total} Levels – Murmel, das Murmelspiel wie Oxyd und Enigma`, description, path, image: `${SITE}/og-image.png`, imageSize: { width: 1200, height: 630 }, imageAlt: 'Murmel im Stil Klassisch', ld })}
<body>
<main class="wide">
${top(path)}
<h1>Alle Levels</h1>
<p class="lead">${total} Levels in ${packs.length} Paketen – Murmels eigene und die freien Levels von Enigma. Jedes Level hat eine Seite mit Vorschau, Bestzeiten und direktem Start im Spiel.</p>
<ol class="grid packs">
${cards}
</ol>
${foot(path)}
</main>
</body>
</html>
`;
}

/** Sitemap: die festen Seiten aus public/sitemap.xml plus die angegebenen Pfade (ohne Dubletten). */
export function sitemapXml(staticXml: string, paths: string[]): string {
  const known = new Set([...staticXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  const extra = [...new Set(paths)]
    .map((p) => `${SITE}/${p}`)
    .filter((u) => !known.has(u))
    .map((u) => `  <url>\n    <loc>${esc(u)}</loc>\n  </url>`)
    .join('\n');
  if (!staticXml.includes('</urlset>')) throw new Error('public/sitemap.xml: </urlset> fehlt');
  return staticXml.replace('</urlset>', `${extra}\n</urlset>`);
}

/** Alle kanonischen Pfade: Startseite, Pakete, Levels (Dubletten nur an ihrer ersten Stelle). */
export function sitemapPaths(packs: PackPage[]): string[] {
  return [`${ROOT_DIR}/`, ...packs.flatMap((p) => [p.path, ...p.levels.filter((l) => l.canonicalPath === l.path).map((l) => l.path)])];
}

// ---------- Gestaltung (wie ueber.html) ----------

const CSS = `:root{--bg:#f7f6f2;--fg:#1d1c1a;--muted:#5d5a54;--accent:#1f5fa8;--on-accent:#fff;--card:#fff;--line:#e3e0d8;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b12;--fg:#e9e7e1;--muted:#a6a29a;--accent:#7fb2ff;--on-accent:#0b0b12;--card:#15151f;--line:#2a2a38}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.6 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;-webkit-text-size-adjust:100%}
main{max-width:760px;margin:0 auto;padding:24px 16px 56px}
main.wide{max-width:1040px}
a{color:var(--accent)}
a:focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:6px}
header.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
header.top a.brand{display:flex;align-items:center;gap:10px;color:var(--fg);text-decoration:none;font-weight:700;font-size:20px;min-height:44px}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 18px;border-radius:12px;background:var(--accent);color:var(--on-accent);text-decoration:none;font-weight:600}
.btn.small{background:transparent;color:var(--accent);border:1px solid var(--line)}
.btn.play{font-size:20px;min-height:56px;padding:14px 32px;width:100%;max-width:360px}
.crumbs ol{list-style:none;display:flex;flex-wrap:wrap;gap:4px;margin:0 0 8px;padding:0;font-size:15px;color:var(--muted)}
.crumbs li+li::before{content:"›";margin:0 6px 0 2px}
.crumbs a{color:var(--muted)}
h1{font-size:clamp(28px,6vw,40px);line-height:1.15;margin:0 0 6px;overflow-wrap:anywhere}
h2{font-size:22px;margin:32px 0 8px}
.meta,.muted{color:var(--muted)}
.meta{margin:0 0 16px}
.lead{font-size:19px;color:var(--muted)}
figure.field{margin:0;background:#000;border-radius:12px;overflow:hidden;border:1px solid var(--line)}
figure.field img{display:block;width:100%;height:auto;image-rendering:pixelated}
.cta{margin:20px 0 8px}
#bestzeiten:empty{display:none}
#bestzeiten p{margin:0 0 8px}
#bestzeiten ol{margin:0 0 8px;padding:0;list-style:none;background:var(--card);border:1px solid var(--line);border-radius:12px}
#bestzeiten li{display:flex;gap:12px;align-items:baseline;padding:10px 14px}
#bestzeiten li+li{border-top:1px solid var(--line)}
#bestzeiten .platz{font-weight:700;min-width:2ch}
#bestzeiten .name{flex:1;overflow-wrap:anywhere}
#bestzeiten .noname{flex:1;color:var(--muted);font-style:italic}
#bestzeiten .zeit{font-variant-numeric:tabular-nums}
dl{margin:0;display:grid;grid-template-columns:max-content 1fr;gap:6px 16px}
dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}
.pager{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:32px 0 8px}
.pager a{display:block;padding:12px 14px;min-height:44px;border:1px solid var(--line);border-radius:12px;background:var(--card);text-decoration:none;overflow-wrap:anywhere}
.pager a small{display:block;color:var(--muted)}
.pager .next{text-align:right}
.grid{list-style:none;padding:0;margin:24px 0 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}
.grid a{display:flex;flex-direction:column;height:100%;padding:8px 8px 12px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--fg);text-decoration:none}
.grid a:hover{border-color:var(--accent)}
.grid img{width:100%;height:auto;aspect-ratio:640/416;object-fit:cover;background:#000;border-radius:8px;image-rendering:pixelated;margin-bottom:8px}
.grid .nr{color:var(--muted);font-size:15px}
.grid b{overflow-wrap:anywhere}
.grid small{color:var(--muted)}
footer{margin-top:48px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:15px}
footer nav{display:flex;flex-wrap:wrap;gap:4px 16px}
footer nav a{display:inline-block;padding:8px 0}
@media (max-width:480px){.pager{grid-template-columns:1fr}.pager .next{text-align:left}dl{grid-template-columns:1fr}dd{margin-bottom:8px}}`;
