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

// ---------- Sprachen ----------

/** Sprache einer Seite (docs/SPEC-englisch.md, „Levelseiten und SEO“). */
export type Lang = 'de' | 'en';
export const LANGS: readonly Lang[] = ['de', 'en'];
const OG_LOCALE: Record<Lang, string> = { de: 'de_DE', en: 'en_US' };
const other = (lang: Lang): Lang => (lang === 'de' ? 'en' : 'de');

/** Pfad einer Seite in einer Sprache: Deutsch wie bisher, Englisch mit vorangestelltem "en/" (gleiche Slugs). */
export function langPath(path: string, lang: Lang): string {
  return lang === 'en' ? `en/${path}` : path;
}

/** Startseite des Spiels in einer Sprache, relativ zur Wurzel ("" bzw. "en/"). */
const home = (lang: Lang) => (lang === 'en' ? 'en/' : '');

/** Absolute Adressen der Sprachfassungen (hreflang): de, en und x-default (= deutsch). */
export function alternates(path: string): [string, string][] {
  return [
    ['de', `${SITE}/${langPath(path, 'de')}`],
    ['en', `${SITE}/${langPath(path, 'en')}`],
    ['x-default', `${SITE}/${langPath(path, 'de')}`],
  ];
}

const T = {
  de: {
    toGame: 'Zum Spiel',
    allLevels: 'Alle Levels',
    footNav: 'Fußzeile',
    about: 'Über Murmel',
    imprint: 'Impressum',
    privacy: 'Datenschutz',
    credits: 'Levels und Grafik aus <a href="https://www.nongnu.org/enigma/">Enigma</a> unter der GPL. Murmel ist freie Software.',
    crumbs: 'Pfad',
    switchLabel: 'English',
    switchTitle: 'This page in English',
    alt: (t: string) => `Spielfeld von „${t}“ im Stil Klassisch`,
    meta: (nr: number, n: number) => `Level ${nr} von ${n}`,
    by: (a: string) => `von ${a}`,
    play: 'Jetzt spielen',
    best: 'Bestzeiten',
    bestNote: 'Geprüfte Zeiten angemeldeter Spieler.',
    ranking: 'Ganze Rangliste',
    facts: 'Zum Level',
    pack: 'Paket',
    author: 'Autor',
    license: 'Lizenz',
    unknown: 'unbekannt',
    source: 'Quelle: Enigma',
    more: 'Weitere Levels',
    prev: 'Voriges Level',
    next: 'Nächstes Level',
    allOfPack: (n: number, pack: string) => `Alle ${n} Levels von ${pack}`,
    genre: 'Rätsel',
    generated: (title: string, nr: number, n: number, pack: string, author: string) =>
      `„${title}“ ist Level ${nr} von ${n} im Paket ${pack}${author ? ` von ${author}` : ''}. Kostenlos im Browser spielen – wie Oxyd und Enigma.`,
    levels: (n: number) => (n === 1 ? '1 Level' : `${n} Levels`),
    packDescription: (n: number, pack: string) => `Alle ${n} Levels des Pakets ${pack} mit Vorschau, Autor und Bestzeiten – kostenlos im Browser spielen, wie Oxyd und Enigma.`,
    packName: (pack: string) => `${pack} – alle Levels`,
    packTitle: (pack: string, n: number) => `${pack} – alle ${n} Levels | Murmel`,
    packAlt: (pack: string) => `Levels aus ${pack}`,
    packLead: (n: number) => `${n === 1 ? '1 Level' : `${n} Levels`}. Wähle eines aus, um Vorschau, Bestzeiten und den Start im Spiel zu sehen.`,
    indexTitle: (n: number) => `Alle ${n} Levels – Murmel, das Murmelspiel wie Oxyd und Enigma`,
    indexDescription: (n: number, packs: number) => `Alle ${n} Levels von Murmel in ${packs} Paketen: Vorschau, Autor, Lizenz und Bestzeiten. Kostenlos im Browser spielen, wie Oxyd und Enigma.`,
    indexAlt: 'Murmel im Stil Klassisch',
    indexLead: (n: number, packs: number) => `${n} Levels in ${packs} Paketen – Murmels eigene und die freien Levels von Enigma. Jedes Level hat eine Seite mit Vorschau, Bestzeiten und direktem Start im Spiel.`,
  },
  en: {
    toGame: 'Play',
    allLevels: 'All levels',
    footNav: 'Footer',
    about: 'About Murmel',
    imprint: 'Legal notice (German)',
    privacy: 'Privacy (German)',
    credits: 'Levels and graphics from <a href="https://www.nongnu.org/enigma/">Enigma</a> under the GPL. Murmel is free software.',
    crumbs: 'Breadcrumb',
    switchLabel: 'Deutsch',
    switchTitle: 'Diese Seite auf Deutsch',
    alt: (t: string) => `Playing field of “${t}” in the Classic style`,
    meta: (nr: number, n: number) => `Level ${nr} of ${n}`,
    by: (a: string) => `by ${a}`,
    play: 'Play now',
    best: 'Best times',
    bestNote: 'Verified times of signed-in players.',
    ranking: 'Full leaderboard',
    facts: 'About this level',
    pack: 'Pack',
    author: 'Author',
    license: 'License',
    unknown: 'unknown',
    source: 'Source: Enigma',
    more: 'More levels',
    prev: 'Previous level',
    next: 'Next level',
    allOfPack: (n: number, pack: string) => `All ${n} levels of ${pack}`,
    genre: 'Puzzle',
    generated: (title: string, nr: number, n: number, pack: string, author: string) =>
      `“${title}” is level ${nr} of ${n} in the ${pack} pack${author ? ` by ${author}` : ''}. Play it free in your browser – a marble game in the style of Oxyd and Enigma.`,
    levels: (n: number) => (n === 1 ? '1 level' : `${n} levels`),
    packDescription: (n: number, pack: string) => `All ${n} levels of the ${pack} pack with preview, author and best times – play free in your browser, in the style of Oxyd and Enigma.`,
    packName: (pack: string) => `${pack} – all levels`,
    packTitle: (pack: string, n: number) => `${pack} – all ${n} levels | Murmel`,
    packAlt: (pack: string) => `Levels from ${pack}`,
    packLead: (n: number) => `${n === 1 ? '1 level' : `${n} levels`}. Pick one to see its preview and best times, or start it right away in the game.`,
    indexTitle: (n: number) => `All ${n} levels – Murmel, the marble game in the style of Oxyd and Enigma`,
    indexDescription: (n: number, packs: number) => `All ${n} levels of Murmel in ${packs} packs: preview, author, license and best times. Play free in your browser, in the style of Oxyd and Enigma.`,
    indexAlt: 'Murmel in the Classic style',
    indexLead: (n: number, packs: number) => `${n} levels in ${packs} packs – Murmel's own and the free levels from Enigma. Every level has a page with a preview, best times and a direct start in the game.`,
  },
} satisfies Record<Lang, unknown>;

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
export function displayTitle(file: LevelFile, lang: Lang = 'de'): string {
  const title = (lang === 'en' && file.titleEn) || file.title;
  return title.replace(/^[\s-]+|[\s-]+$/g, '').trim() || title.trim() || file.id;
}

/** Kürzere Texte („Welcome to Enigma II“) taugen nicht als Beschreibung. */
const TEXT_MIN = 40;

/** Dokumenttexte in einer Sprache: Englisch nimmt das Original (`textsEn`) vor der Übersetzung. */
function levelTexts(file: LevelFile, lang: Lang): string[] {
  return Object.entries(file.texts ?? {}).map(([k, v]) => (lang === 'en' ? (file.textsEn?.[k] ?? v) : v));
}

/** Der erste brauchbare Text des Levels (Dokumente), sonst eine erzeugte Zeile. */
export function describe(p: LevelPage, lang: Lang = 'de'): string {
  const text = levelTexts(p.file, lang).find((t) => t.replace(/\s+/g, ' ').trim().length >= TEXT_MIN);
  if (text) return shorten(text);
  return shorten(T[lang].generated(displayTitle(p.file, lang), p.nr, p.pack.levels.length, p.pack.title, p.file.author));
}

/** Lizenz-Adresse für bekannte Angaben (JSON-LD), sonst null. */
export function licenseUrl(license: string): string | null {
  const l = license.toLowerCase();
  if (/gp[lj].*(3\.0|v3|version 3)/.test(l)) return 'https://www.gnu.org/licenses/gpl-3.0.html';
  if (/gp[lj]/.test(l)) return 'https://www.gnu.org/licenses/old-licenses/gpl-2.0.html';
  return null;
}

/** Lesbare Lizenz: "GPL v2.0 or above" → "GPL 2.0 oder später" / "GPL 2.0 or later". */
export function licenseLabel(license: string, lang: Lang = 'de'): string {
  const l = license.trim();
  const en = lang === 'en';
  if (/^gp[lj] v?2\.0 or above$/i.test(l)) return en ? 'GPL 2.0 or later' : 'GPL 2.0 oder später';
  if (/^gpl version 2$|^gpl v2\.0$/i.test(l)) return 'GPL 2.0';
  if (l === 'GPL-3.0-or-later') return en ? 'GPL 3.0 or later' : 'GPL 3.0 oder später';
  if (/^donated to enigma under the project'?s license$/i.test(l)) return en ? "GPL (donated to Enigma under the project's license)" : 'GPL (an Enigma gespendet, Projektlizenz)';
  if (/^public domain/i.test(l)) return en ? 'public domain' : 'gemeinfrei (public domain)';
  return l || T[lang].unknown;
}

function jsonLd(data: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

const game = (lang: Lang) => ({ '@type': 'VideoGame', name: 'Murmel', url: `${SITE}/${home(lang)}`, gamePlatform: 'Web browser', isAccessibleForFree: true, inLanguage: lang });

// ---------- HTML ----------

interface Head {
  lang: Lang;
  title: string;
  description: string;
  /** Pfad der deutschen Fassung (ohne "en/"). */
  path: string;
  canonicalPath?: string;
  image: string;
  imageSize?: ImageSize;
  imageAlt: string;
  ld: unknown[];
}

function head(h: Head): string {
  const canonBase = h.canonicalPath ?? h.path;
  const canonical = `${SITE}/${langPath(canonBase, h.lang)}`;
  const size = h.imageSize ? `<meta property="og:image:width" content="${h.imageSize.width}"><meta property="og:image:height" content="${h.imageSize.height}">` : '';
  const alt = alternates(canonBase)
    .map(([l, href]) => `<link rel="alternate" hreflang="${l}" href="${esc(href)}">`)
    .join('\n');
  return `<!doctype html>
<html lang="${h.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f7f6f2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0b0b12" media="(prefers-color-scheme: dark)">
<title>${esc(h.title)}</title>
<meta name="description" content="${esc(h.description)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${esc(canonical)}">
${alt}
<link rel="icon" href="${up(langPath(h.path, h.lang))}favicon.svg" type="image/svg+xml">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Murmel">
<meta property="og:locale" content="${OG_LOCALE[h.lang]}">
<meta property="og:locale:alternate" content="${OG_LOCALE[other(h.lang)]}">
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

/** Kopf mit Marke, Link zur anderen Sprachfassung derselben Seite und „Zum Spiel“. */
function top(path: string, lang: Lang): string {
  const r = up(langPath(path, lang));
  const o = other(lang);
  const t = T[lang];
  return `<header class="top"><a class="brand" href="${r}${home(lang)}"><img src="${r}favicon.svg" width="28" height="28" alt="">Murmel</a><span class="side"><a class="lang" href="${r}${langPath(path, o)}" hreflang="${o}" lang="${o}" title="${esc(t.switchTitle)}">${t.switchLabel}</a><a class="btn small" href="${r}${home(lang)}">${t.toGame}</a></span></header>`;
}

function foot(path: string, lang: Lang): string {
  const r = up(langPath(path, lang));
  const t = T[lang];
  // Impressum und Datenschutz gibt es nur auf Deutsch.
  const de = lang === 'de' ? '' : ' hreflang="de"';
  return `<footer><nav aria-label="${t.footNav}"><a href="${r}${langPath(`${ROOT_DIR}/`, lang)}">${t.allLevels}</a><a href="${r}${home(lang)}ueber.html">${t.about}</a><a href="${r}impressum.html"${de}>${t.imprint}</a><a href="${r}datenschutz.html"${de}>${t.privacy}</a></nav><p>${t.credits}</p></footer>`;
}

function crumbs(items: [string, string][], lang: Lang): string {
  return `<nav class="crumbs" aria-label="${T[lang].crumbs}"><ol>${items.map(([href, label], i) => `<li>${i === items.length - 1 ? `<span aria-current="page">${esc(label)}</span>` : `<a href="${href}">${esc(label)}</a>`}</li>`).join('')}</ol></nav>`;
}

function breadcrumbLd(items: [string, string][], lang: Lang): unknown {
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([path, name], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${SITE}/${langPath(path, lang)}` })) };
}

/** Breite der kleinen Bilder (klein.webp, tools/levelseiten/vorschau.mjs THUMB_WIDTH). */
export const THUMB_WIDTH = 320;
function thumbAttrs(s: ImageSize | undefined): string {
  if (!s) return '';
  const w = Math.min(THUMB_WIDTH, s.width);
  return ` width="${w}" height="${Math.round((s.height * w) / s.width)}"`;
}

/** Vorschaubilder gibt es nur einmal, unter level/… (auch für die englischen Seiten). */
const imageUrl = (p: LevelPage) => `${SITE}/${p.path}vorschau.webp`;
/** Relativer Weg von einer Seite in `lang` zu einer Bilddatei der Levelseite `p` (unter level/…). */
const imageRel = (from: string, lang: Lang, p: LevelPage, name: string) =>
  lang === 'de' && p.path.startsWith(from) ? `${p.path.slice(from.length)}${name}` : `${up(langPath(from, lang))}${p.path}${name}`;

/** Seitentitel einer Levelseite. */
export function levelTitle(p: LevelPage, lang: Lang = 'de'): string {
  return `${displayTitle(p.file, lang)} – Level ${p.nr}, ${p.pack.title} | Murmel`;
}

export function levelHtml(p: LevelPage, size: ImageSize, lang: Lang = 'de'): string {
  const { file, pack } = p;
  const t = T[lang];
  const r = up(langPath(p.path, lang));
  const title = displayTitle(file, lang);
  const description = describe(p, lang);
  const prev = pack.levels[p.nr - 2];
  const next = pack.levels[p.nr];
  const lic = licenseUrl(file.license);
  const alt = t.alt(title);
  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'CreativeWork',
      name: title,
      description,
      url: `${SITE}/${langPath(p.canonicalPath, lang)}`,
      image: imageUrl(p),
      inLanguage: lang,
      position: p.nr,
      ...(file.author ? { author: { '@type': 'Person', name: file.author } } : {}),
      license: lic ?? file.license,
      genre: t.genre,
      isPartOf: { ...game(lang), '@type': ['VideoGame', 'CreativeWorkSeries'], name: `Murmel – ${pack.title}` },
    },
    breadcrumbLd([[`${ROOT_DIR}/`, t.allLevels], [pack.path, pack.title], [p.path, title]], lang),
  ];
  const ranking = `${r}bestenliste.html?${new URLSearchParams({ level: file.id, titel: file.title }).toString().replace(/&/g, '&amp;')}`;
  const source = file.source ? ` · ${t.source}, ${esc(file.source.file)}` : '';
  return `${head({ lang, title: levelTitle(p, lang), description, path: p.path, canonicalPath: p.canonicalPath, image: imageUrl(p), imageSize: size, imageAlt: alt, ld })}
<body>
<main>
${top(p.path, lang)}
${crumbs([[`${r}${langPath(`${ROOT_DIR}/`, lang)}`, t.allLevels], [`../`, pack.title], ['', title]], lang)}
<h1>${esc(title)}</h1>
<p class="meta">${t.meta(p.nr, pack.levels.length)} · ${esc(pack.title)}${file.author ? ` · ${esc(t.by(file.author))}` : ''}</p>
<figure class="field"><img src="${imageRel(p.path, lang, p, 'vorschau.webp')}" width="${size.width}" height="${size.height}" alt="${esc(alt)}"></figure>
<p class="lead">${esc(description)}</p>
<p class="cta"><a class="btn play" href="${r}${home(lang)}${playHash(pack.id, file.id)}">${t.play}</a></p>
<section class="best" aria-labelledby="bz-titel">
<h2 id="bz-titel">${t.best}</h2>
<div id="bestzeiten" data-level="${esc(file.id)}" aria-live="polite"></div>
<p class="muted">${t.bestNote} <a href="${ranking}">${t.ranking}</a></p>
</section>
<section class="facts" aria-labelledby="info-titel">
<h2 id="info-titel">${t.facts}</h2>
<dl>
<dt>${t.pack}</dt><dd><a href="../">${esc(pack.title)}</a>, ${t.meta(p.nr, pack.levels.length)}</dd>
<dt>${t.author}</dt><dd>${esc(file.author || t.unknown)}</dd>
<dt>${t.license}</dt><dd>${lic ? `<a href="${lic}" rel="license">${esc(licenseLabel(file.license, lang))}</a>` : esc(licenseLabel(file.license, lang))}${source}</dd>
</dl>
</section>
<nav class="pager" aria-label="${t.more}">
${prev ? `<a class="prev" href="../${prev.slug}/"><small>${t.prev}</small>${esc(displayTitle(prev.file, lang))}</a>` : '<span></span>'}
${next ? `<a class="next" href="../${next.slug}/"><small>${t.next}</small>${esc(displayTitle(next.file, lang))}</a>` : '<span></span>'}
</nav>
<p class="back"><a href="../">${esc(t.allOfPack(pack.levels.length, pack.title))}</a></p>
${foot(p.path, lang)}
</main>
<script type="module" src="${r}${ROOT_DIR}/bestzeiten.js"></script>
</body>
</html>
`;
}

export function packDescription(pack: PackPage, lang: Lang = 'de'): string {
  return shorten(T[lang].packDescription(pack.levels.length, pack.title));
}

export function packHtml(pack: PackPage, sizes: Map<string, ImageSize>, lang: Lang = 'de'): string {
  const t = T[lang];
  const r = up(langPath(pack.path, lang));
  const firstImg = pack.levels[0] ? imageUrl(pack.levels[0]) : `${SITE}/og-image.png`;
  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: t.packName(pack.title),
      url: `${SITE}/${langPath(pack.path, lang)}`,
      inLanguage: lang,
      isPartOf: game(lang),
      mainEntity: { '@type': 'ItemList', numberOfItems: pack.levels.length, itemListElement: pack.levels.map((p) => ({ '@type': 'ListItem', position: p.nr, url: `${SITE}/${langPath(p.path, lang)}`, name: displayTitle(p.file, lang) })) },
    },
    breadcrumbLd([[`${ROOT_DIR}/`, t.allLevels], [pack.path, pack.title]], lang),
  ];
  const cards = pack.levels
    .map((p) => {
      const s = sizes.get(p.path);
      return `<li><a href="${p.slug}/"><img src="${imageRel(pack.path, lang, p, 'klein.webp')}" loading="lazy" decoding="async" alt=""${thumbAttrs(s)}><span class="nr">${p.nr}</span><b>${esc(displayTitle(p.file, lang))}</b><small>${esc(p.file.author || '')}</small></a></li>`;
    })
    .join('\n');
  return `${head({ lang, title: t.packTitle(pack.title, pack.levels.length), description: packDescription(pack, lang), path: pack.path, image: firstImg, imageSize: pack.levels[0] ? sizes.get(pack.levels[0].path) : undefined, imageAlt: t.packAlt(pack.title), ld })}
<body>
<main class="wide">
${top(pack.path, lang)}
${crumbs([[`${r}${langPath(`${ROOT_DIR}/`, lang)}`, t.allLevels], ['', pack.title]], lang)}
<h1>${esc(pack.title)}</h1>
<p class="lead">${t.packLead(pack.levels.length)}</p>
<ol class="grid">
${cards}
</ol>
${foot(pack.path, lang)}
</main>
</body>
</html>
`;
}

export function indexHtml(packs: PackPage[], sizes: Map<string, ImageSize>, lang: Lang = 'de'): string {
  const t = T[lang];
  const path = `${ROOT_DIR}/`;
  const total = packs.reduce((n, p) => n + p.levels.length, 0);
  const description = shorten(t.indexDescription(total, packs.length));
  const ld = [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: t.allLevels, url: `${SITE}/${langPath(path, lang)}`, inLanguage: lang, isPartOf: game(lang), mainEntity: { '@type': 'ItemList', numberOfItems: packs.length, itemListElement: packs.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/${langPath(p.path, lang)}`, name: p.title })) } }];
  const cards = packs
    .map((p) => {
      const l = p.levels[0];
      const s = l ? sizes.get(l.path) : undefined;
      const src = l ? imageRel(path, lang, l, 'klein.webp') : '';
      const img = l ? `<img src="${src}" loading="lazy" decoding="async" alt=""${thumbAttrs(s)}>` : '';
      return `<li><a href="${p.slug}/">${img}<b>${esc(p.title)}</b><small>${t.levels(p.levels.length)}</small></a></li>`;
    })
    .join('\n');
  return `${head({ lang, title: t.indexTitle(total), description, path, image: `${SITE}/og-image.png`, imageSize: { width: 1200, height: 630 }, imageAlt: t.indexAlt, ld })}
<body>
<main class="wide">
${top(path, lang)}
<h1>${t.allLevels}</h1>
<p class="lead">${esc(t.indexLead(total, packs.length))}</p>
<ol class="grid packs">
${cards}
</ol>
${foot(path, lang)}
</main>
</body>
</html>
`;
}

const XHTML_NS = 'xmlns:xhtml="http://www.w3.org/1999/xhtml"';

/** Ein <url>-Eintrag der Sitemap mit den Sprachfassungen (hreflang de, en, x-default). */
function sitemapUrl(loc: string, alt: [string, string][]): string {
  return `  <url>\n    <loc>${esc(loc)}</loc>\n${alt.map(([l, href]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${esc(href)}"/>`).join('\n')}\n  </url>`;
}

/**
 * Sitemap: die festen Seiten aus public/sitemap.xml (dort schon zweisprachig) plus die angegebenen
 * (deutschen) Pfade, je Pfad die deutsche und die englische Adresse mit ihren Sprachfassungen (ohne Dubletten).
 */
export function sitemapXml(staticXml: string, paths: string[]): string {
  if (!staticXml.includes('</urlset>')) throw new Error('public/sitemap.xml: </urlset> fehlt');
  const known = new Set([...staticXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  const extra = [...new Set(paths)]
    .flatMap((p) => LANGS.map((lang) => [`${SITE}/${langPath(p, lang)}`, alternates(p)] as const))
    .filter(([u]) => !known.has(u))
    .map(([u, alt]) => sitemapUrl(u, alt))
    .join('\n');
  const xml = staticXml.includes(XHTML_NS) ? staticXml : staticXml.replace(/<urlset\b/, `<urlset ${XHTML_NS}`);
  return xml.replace('</urlset>', `${extra}\n</urlset>`);
}

/** Alle kanonischen (deutschen) Pfade: Startseite, Pakete, Levels (Dubletten nur an ihrer ersten Stelle). */
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
header.top .side{display:flex;align-items:center;gap:12px}
header.top a.lang{display:inline-flex;align-items:center;min-height:44px;padding:0 4px}
@media (max-width:480px){.pager{grid-template-columns:1fr}.pager .next{text-align:left}dl{grid-template-columns:1fr}dd{margin-bottom:8px}}`;
