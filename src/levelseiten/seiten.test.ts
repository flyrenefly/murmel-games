import { describe, expect, it } from 'vitest';
import type { LevelFile } from '../game/level';
import { PHYSICS_DT } from '../game/physics';
import { LEVELS } from '../levels';
import { sprache, STEP_SECONDS, TEXTE, top3, zeit } from './bestzeiten';
import { buildPages, describe as describeLevel, indexHtml, langPath, levelHtml, licenseLabel, licenseUrl, packHtml, type PackSource, playHash, shorten, sitemapPaths, sitemapXml, slugify } from './seiten';
import { indexOfLevel, startFromHash } from '../startlink';
import STATIC_SITEMAP from '../../public/sitemap.xml?raw';
import ROBOTS from '../../public/robots.txt?raw';
import CLIENT_SRC from './bestzeiten.ts?raw';

/** public/levels/enigma/*.json als Text, Schlüssel = Dateiname. */
const PACK_FILES = Object.fromEntries(
  Object.entries(import.meta.glob('/public/levels/enigma/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>).map(([k, v]) => [k.replace(/^.*\//, ''), v]),
);

const lv = (id: string, title: string, extra: Partial<LevelFile> = {}): LevelFile => ({ id, title, author: 'Ada', license: 'GPL v2.0 or above', map: ['#'], ...extra });

/** Alle Levels wie im Spiel: eigene, dann die Enigma-Pakete in der Reihenfolge von index.json. */
function allPacks(): PackSource[] {
  const index = JSON.parse(PACK_FILES['index.json']) as { pack: string; title: string }[];
  return [
    { id: 'murmel', title: 'Murmel', levels: LEVELS },
    ...index.map((p) => ({ id: p.pack, title: p.title, levels: (JSON.parse(PACK_FILES[`${p.pack}.json`]) as { levels: LevelFile[] }).levels })),
  ];
}

const SIZE = { width: 640, height: 416 };

describe('slugs', () => {
  it('macht sprechende ASCII-Slugs', () => {
    expect(slugify('Schwarz-Weiss-Gebäck')).toBe('schwarz-weiss-gebaeck');
    expect(slugify('Brücken')).toBe('bruecken');
    expect(slugify('Straße')).toBe('strasse');
    expect(slugify('Café Noël!')).toBe('cafe-noel');
    expect(slugify(' - meditation - ')).toBe('meditation');
    expect(slugify('???')).toBe('');
  });

  it('hängt bei gleichem Titel im Paket bei allen den ID-Slug an', () => {
    const [p] = buildPages([{ id: 'enigma_i', title: 'Enigma I', levels: [lv('enigma:med1', '- meditation -'), lv('enigma:a', 'Welcome'), lv('enigma:med_2', ' - Meditation - ')] }]);
    expect(p.path).toBe('level/enigma-i/');
    expect(p.levels.map((l) => l.slug)).toEqual(['meditation-med1', 'welcome', 'meditation-med-2']);
    expect(p.levels[1].path).toBe('level/enigma-i/welcome/');
  });

  it('nimmt die ID, wenn der Titel keinen Slug ergibt', () => {
    const [p] = buildPages([{ id: 'x', title: 'X', levels: [lv('enigma:m_tutor/m_tut6', '???')] }]);
    expect(p.levels[0].slug).toBe('m-tutor-m-tut6');
  });

  it('gibt jeder echten Levelseite eine eindeutige Adresse; Dubletten zeigen per Canonical auf die erste', () => {
    const packs = buildPages(allPacks());
    const pages = packs.flatMap((p) => p.levels);
    expect(pages.length).toBeGreaterThan(1100);
    expect(new Set(pages.map((p) => p.path)).size).toBe(pages.length);
    for (const p of pages) expect(p.path).toMatch(/^level\/[a-z0-9-]+\/[a-z0-9-]+\/$/);
    const firstPath = new Map<string, string>();
    for (const p of pages) {
      if (!firstPath.has(p.file.id)) firstPath.set(p.file.id, p.path);
      expect(p.canonicalPath).toBe(firstPath.get(p.file.id));
    }
    expect(pages.some((p) => p.canonicalPath !== p.path)).toBe(true);
  });

  it('bleibt stabil, wenn ein Paket ein Level dazubekommt', () => {
    const a = [lv('enigma:a', 'Alpha'), lv('enigma:c', 'Gamma')];
    const before = buildPages([{ id: 'p', title: 'P', levels: a }])[0].levels.map((l) => l.path);
    const after = buildPages([{ id: 'p', title: 'P', levels: [a[0], lv('enigma:b', 'Beta'), a[1]] }])[0].levels.map((l) => l.path);
    expect(after).toEqual(expect.arrayContaining(before));
  });
});

describe('Metadaten', () => {
  const packs = buildPages([{ id: 'enigma_ii', title: 'Enigma II', levels: [lv('enigma:a', 'Erstes'), lv('enigma:nat1', 'Natur <1>', { texts: { t0: 'Hi there!', t1: '  Push   all the boxes into\nthe water to build a bridge. ' }, source: { pack: 'enigma_ii', file: 'nat1.xml' } }), lv('enigma:c', 'Drittes')] }]);
  const page = packs[0].levels[1];
  const html = levelHtml(page, SIZE);

  it('hat Titel, Description, Canonical, Open Graph, Twitter Card und lang="de"', () => {
    expect(html).toContain('<html lang="de">');
    expect(html).toContain('<title>Natur &lt;1&gt; – Level 2, Enigma II | Murmel</title>');
    expect(html).toContain('<meta name="description" content="Push all the boxes into the water to build a bridge.">');
    expect(html).toContain('<link rel="canonical" href="https://murmel.games/level/enigma-ii/natur-1/">');
    expect(html).toContain('<meta property="og:image" content="https://murmel.games/level/enigma-ii/natur-1/vorschau.webp">');
    expect(html).toContain('<meta property="og:image:width" content="640">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
  });

  it('startet genau dieses Level und verlinkt Nachbarn, Paket und Rangliste', () => {
    expect(html).toContain(`href="../../../${playHash('enigma_ii', 'enigma:nat1')}"`);
    expect(playHash('enigma_ii', 'enigma:nat1')).toBe('#start=enigma_ii/enigma%3Anat1');
    expect(html).toContain('href="../erstes/"');
    expect(html).toContain('href="../drittes/"');
    expect(html).toContain('href="../../../bestenliste.html?level=enigma%3Anat1&amp;titel=Natur+%3C1%3E"');
    expect(html).toContain('data-level="enigma:nat1"');
    expect(html).toContain('<script type="module" src="../../../level/bestzeiten.js"></script>');
  });

  it('beschreibt das Level im JSON-LD mit Autor, Lizenz und Spiel, ohne "<" im Skriptblock', () => {
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => m[1]);
    expect(blocks).toHaveLength(2);
    for (const b of blocks) expect(b).not.toContain('<');
    const work = JSON.parse(blocks[0]);
    expect(work['@type']).toBe('CreativeWork');
    expect(work.author).toEqual({ '@type': 'Person', name: 'Ada' });
    expect(work.license).toBe('https://www.gnu.org/licenses/old-licenses/gpl-2.0.html');
    expect(work.name).toBe('Natur <1>');
    expect(work.isPartOf['@type']).toContain('VideoGame');
    expect(JSON.parse(blocks[1]).itemListElement).toHaveLength(3);
  });

  it('erzeugt eine Beschreibung, wenn das Level keinen Text hat', () => {
    expect(describeLevel(packs[0].levels[0])).toBe('„Erstes“ ist Level 1 von 3 im Paket Enigma II von Ada. Kostenlos im Browser spielen – wie Oxyd und Enigma.');
  });

  it('kürzt lange Texte an einer Wortgrenze', () => {
    const s = shorten('wort '.repeat(60));
    expect(s.length).toBeLessThanOrEqual(155);
    expect(s.endsWith('wort…')).toBe(true);
  });

  it('kennt die Lizenzen der Levels', () => {
    expect(licenseUrl('GPL-3.0-or-later')).toBe('https://www.gnu.org/licenses/gpl-3.0.html');
    expect(licenseUrl('GPJ v2.0 or above')).toContain('gpl-2.0');
    expect(licenseUrl('public domain')).toBeNull();
    expect(licenseLabel('GPL v2.0 or above')).toBe('GPL 2.0 oder später');
    expect(licenseLabel('public domain Sokoban level')).toBe('gemeinfrei (public domain)');
  });

  it('Paket- und Übersichtsseite haben je einen h1 und Canonical und verlinken die Levels', () => {
    const sizes = new Map(packs[0].levels.map((l) => [l.path, SIZE]));
    const pack = packHtml(packs[0], sizes);
    expect(pack.match(/<h1>/g)).toHaveLength(1);
    expect(pack).toContain('<link rel="canonical" href="https://murmel.games/level/enigma-ii/">');
    expect(pack).toContain('<a href="natur-1/"><img src="natur-1/klein.webp" loading="lazy" decoding="async" alt="" width="320" height="208">');
    const index = indexHtml(packs, sizes);
    expect(index.match(/<h1>/g)).toHaveLength(1);
    expect(index).toContain('<a href="enigma-ii/">');
  });
});

describe('Englisch (docs/SPEC-englisch.md)', () => {
  const packs = buildPages([
    {
      id: 'enigma_ii',
      title: 'Enigma II',
      levels: [
        lv('enigma:a', 'Erstes'),
        lv('enigma:nat1', 'Natur <1>', { texts: { t0: 'Hallo!', t1: 'Schiebe alle Kisten ins Wasser, um eine Brücke zu bauen, dann rollst du hinüber.' }, textsEn: { t1: 'Push all the boxes into the water to build a bridge, then roll across.' }, source: { pack: 'enigma_ii', file: 'nat1.xml' } }),
        lv('enigma:c', 'Drittes'),
      ],
    },
    { id: 'enigma_iii', title: 'Enigma III', levels: [lv('enigma:nat1', 'Natur <1>')] },
  ]);
  const page = packs[0].levels[1];
  const de = levelHtml(page, SIZE);
  const en = levelHtml(page, SIZE, 'en');
  const hreflang = (html: string) => [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map((m) => `${m[1]} ${m[2]}`);

  it('liegt unter en/level/ mit lang="en", eigenem Canonical und og:locale en_US', () => {
    expect(langPath(page.path, 'en')).toBe('en/level/enigma-ii/natur-1/');
    expect(en).toContain('<html lang="en">');
    expect(en).toContain('<link rel="canonical" href="https://murmel.games/en/level/enigma-ii/natur-1/">');
    expect(en).toContain('<meta property="og:url" content="https://murmel.games/en/level/enigma-ii/natur-1/">');
    expect(en).toContain('<meta property="og:locale" content="en_US">');
    expect(en).toContain('<meta property="og:locale:alternate" content="de_DE">');
    expect(de).toContain('<meta property="og:locale" content="de_DE">');
    expect(de).toContain('<meta property="og:locale:alternate" content="en_US">');
    expect(en.match(/<h1>/g)).toHaveLength(1);
    expect(en.match(/rel="canonical"/g)).toHaveLength(1);
  });

  it('verweist per hreflang in beide Richtungen (x-default = deutsch)', () => {
    const want = ['de https://murmel.games/level/enigma-ii/natur-1/', 'en https://murmel.games/en/level/enigma-ii/natur-1/', 'x-default https://murmel.games/level/enigma-ii/natur-1/'];
    expect(hreflang(de)).toEqual(want);
    expect(hreflang(en)).toEqual(want);
    // Dublette: Alternativen wie der Canonical auf die erste Fundstelle
    const dup = packs[1].levels[0];
    expect(hreflang(levelHtml(dup, SIZE, 'en'))).toEqual(want);
    expect(levelHtml(dup, SIZE, 'en')).toContain('<link rel="canonical" href="https://murmel.games/en/level/enigma-ii/natur-1/">');
    for (const html of [packHtml(packs[0], new Map(), 'en'), indexHtml(packs, new Map(), 'en')]) {
      expect(hreflang(html)).toHaveLength(3);
      expect(html).toContain('<html lang="en">');
    }
    expect(hreflang(indexHtml(packs, new Map(), 'en'))).toEqual(['de https://murmel.games/level/', 'en https://murmel.games/en/level/', 'x-default https://murmel.games/level/']);
  });

  it('hat einen sichtbaren Link zur anderen Sprachfassung', () => {
    expect(de).toContain('<a class="lang" href="../../../en/level/enigma-ii/natur-1/" hreflang="en" lang="en"');
    expect(de).toMatch(/lang="en"[^>]*>English<\/a>/);
    expect(en).toContain('<a class="lang" href="../../../../level/enigma-ii/natur-1/" hreflang="de" lang="de"');
    expect(en).toMatch(/lang="de"[^>]*>Deutsch<\/a>/);
  });

  it('verdoppelt keine Bilder: alle Bilder zeigen auf level/…', () => {
    expect(en).toContain('<meta property="og:image" content="https://murmel.games/level/enigma-ii/natur-1/vorschau.webp">');
    expect(en).toContain('<img src="../../../../level/enigma-ii/natur-1/vorschau.webp"');
    const sizes = new Map(packs[0].levels.map((l) => [l.path, SIZE]));
    expect(packHtml(packs[0], sizes, 'en')).toContain('<a href="natur-1/"><img src="../../../level/enigma-ii/natur-1/klein.webp"');
    expect(indexHtml(packs, sizes, 'en')).toContain('<a href="enigma-ii/"><img src="../../level/enigma-ii/erstes/klein.webp"');
    for (const html of [en, packHtml(packs[0], sizes, 'en'), indexHtml(packs, sizes, 'en')]) {
      for (const m of html.matchAll(/(?:src|content)="([^"]*\.webp)"/g)) expect(m[1]).not.toMatch(/(^|\/)en\//);
    }
  });

  it('spielt über die englische Startseite und verlinkt die englischen Seiten, Rechtstexte auf Deutsch', () => {
    expect(en).toContain(`<a class="btn play" href="../../../../en/${playHash('enigma_ii', 'enigma:nat1')}">Play now</a>`);
    expect(en).toContain('<a class="brand" href="../../../../en/">');
    expect(en).toContain('href="../../../../en/ueber.html">About Murmel</a>');
    expect(en).toContain('href="../../../../impressum.html" hreflang="de">Legal notice (German)</a>');
    expect(en).toContain('href="../../../../datenschutz.html" hreflang="de">Privacy (German)</a>');
    expect(en).toContain('href="../../../../en/level/">All levels</a>');
    expect(en).toContain('<script type="module" src="../../../../level/bestzeiten.js"></script>');
    expect(en).toContain('<h2 id="bz-titel">Best times</h2>');
    expect(en).toContain('<p class="meta">Level 2 of 3 · Enigma II · by Ada</p>');
    expect(en).toContain('rel="license">GPL 2.0 or later</a>');
    expect(en).not.toMatch(/Jetzt spielen|Bestzeiten|Lizenz|Paket|Oxyd online/);
  });

  it('beschreibt auf Englisch mit dem Original-Text, sonst mit einer erzeugten Zeile', () => {
    expect(describeLevel(page, 'en')).toBe('Push all the boxes into the water to build a bridge, then roll across.');
    expect(describeLevel(page, 'de')).toBe('Schiebe alle Kisten ins Wasser, um eine Brücke zu bauen, dann rollst du hinüber.');
    expect(describeLevel(packs[0].levels[0], 'en')).toBe('“Erstes” is level 1 of 3 in the Enigma II pack by Ada. Play it free in your browser – a marble game in the style of Oxyd and Enigma.');
    const work = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(en)![1]);
    expect(work.inLanguage).toBe('en');
    expect(work.url).toBe('https://murmel.games/en/level/enigma-ii/natur-1/');
    expect(work.isPartOf.url).toBe('https://murmel.games/en/');
    expect(work.isPartOf.inLanguage).toBe('en');
    expect(JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(de)![1]).inLanguage).toBe('de');
  });

  it('übersetzt die Lizenzen', () => {
    expect(licenseLabel('GPL v2.0 or above', 'en')).toBe('GPL 2.0 or later');
    expect(licenseLabel('GPL-3.0-or-later', 'en')).toBe('GPL 3.0 or later');
    expect(licenseLabel('public domain Sokoban level', 'en')).toBe('public domain');
    expect(licenseLabel('', 'en')).toBe('unknown');
  });
});

describe('Sitemap', () => {
  const packs = buildPages(allPacks());
  const xml = sitemapXml(STATIC_SITEMAP, sitemapPaths(packs));
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  it('behält die festen Seiten und nennt alle kanonischen Levelseiten genau einmal', () => {
    expect(locs).toContain('https://murmel.games/');
    expect(locs).toContain('https://murmel.games/ueber.html');
    expect(locs).toContain('https://murmel.games/level/');
    expect(new Set(locs).size).toBe(locs.length);
    const pages = packs.flatMap((p) => p.levels);
    const canonical = new Set(pages.map((p) => `https://murmel.games/${p.canonicalPath}`));
    for (const c of canonical) expect(locs).toContain(c);
    for (const p of pages.filter((x) => x.canonicalPath !== x.path)) expect(locs).not.toContain(`https://murmel.games/${p.path}`);
    expect(locs.length).toBe(6 + 2 * (1 + packs.length + canonical.size));
    expect(xml.trim().endsWith('</urlset>')).toBe(true);
  });

  it('nennt jede Adresse auch auf Englisch, jede <url> mit hreflang de/en/x-default', () => {
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(locs).toContain('https://murmel.games/en/');
    expect(locs).toContain('https://murmel.games/en/ueber.html');
    expect(locs).toContain('https://murmel.games/en/level/');
    const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
    expect(urls).toHaveLength(locs.length);
    for (const u of urls) {
      const loc = /<loc>([^<]+)<\/loc>/.exec(u)![1];
      const alt = Object.fromEntries([...u.matchAll(/<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)"\/>/g)].map((m) => [m[1], m[2]]));
      expect(Object.keys(alt).sort()).toEqual(['de', 'en', 'x-default']);
      expect(alt['x-default']).toBe(alt.de);
      expect(alt.en).toBe(alt.de.replace('https://murmel.games/', 'https://murmel.games/en/'));
      expect([alt.de, alt.en]).toContain(loc);
      // die andere Sprachfassung steht ebenfalls in der Sitemap
      expect(locs).toContain(loc === alt.de ? alt.en : alt.de);
    }
  });

  it('public/sitemap.xml (Notbetrieb) nennt /en/, /en/ueber.html und die Pressemappe, aber keine Levelseiten', () => {
    const fixed = [...STATIC_SITEMAP.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(fixed.sort()).toEqual(['https://murmel.games/', 'https://murmel.games/en/', 'https://murmel.games/en/presse.html', 'https://murmel.games/en/ueber.html', 'https://murmel.games/presse.html', 'https://murmel.games/ueber.html']);
    expect(STATIC_SITEMAP).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(STATIC_SITEMAP.match(/hreflang="x-default"/g)).toHaveLength(6);
  });

  it('robots.txt erlaubt alles und nennt die Sitemap', () => {
    expect(ROBOTS).toMatch(/^Allow: \/$/m);
    expect(ROBOTS).toContain('Sitemap: https://murmel.games/sitemap.xml');
  });
});

describe('Bestzeiten (bestzeiten.ts)', () => {
  it('rechnet Schritte wie das Spiel in m:ss,t', () => {
    expect(STEP_SECONDS).toBe(PHYSICS_DT);
    expect(zeit(0)).toBe('0:00,0');
    expect(zeit(400 * 75.25)).toBe('1:15,3');
  });

  it('nimmt die ersten drei gültigen Einträge, auch ohne Namen', () => {
    const r = { eintraege: [{ platz: 1, name: 'Ada', zeit: 4000 }, { platz: 2, name: null, zeit: 5000 }, { platz: 3, name: 'X', zeit: 'kaputt' }, { platz: 3, name: 'Bo', zeit: 6000 }, { platz: 5, name: 'Cy', zeit: 7000 }] };
    expect(top3(r).map((e) => e.name)).toEqual(['Ada', null, 'Bo']);
    expect(top3(null)).toEqual([]);
    expect(top3({ eintraege: 'x' })).toEqual([]);
  });

  it('zeigt auf englischen Seiten englische Texte und m:ss.t', () => {
    expect(sprache('en')).toBe('en');
    expect(sprache('en-US')).toBe('en');
    expect(sprache('de')).toBe('de');
    expect(sprache('')).toBe('de');
    expect(zeit(400 * 75.25, 'en')).toBe('1:15.3');
    expect(TEXTE.en.bestzeit).toBe('Best time');
    expect(Object.keys(TEXTE.en)).toEqual(Object.keys(TEXTE.de));
  });

  it('enthält keine Importe (wird ohne Bundler ausgeliefert)', () => {
    expect(CLIENT_SRC).not.toMatch(/^import /m);
  });
});

describe('Spielstart per Adresse (startlink.ts)', () => {
  it('liest #start=<paket>/<level-id>', () => {
    expect(startFromHash('#start=enigma_ii/enigma%3Anat1')).toEqual({ pack: 'enigma_ii', id: 'enigma:nat1' });
    expect(startFromHash('#start=enigma_i/enigma%3Am_tutor%2Fm_tut6')).toEqual({ pack: 'enigma_i', id: 'enigma:m_tutor/m_tut6' });
    expect(startFromHash('#start=murmel/01')).toEqual({ pack: 'murmel', id: '01' });
  });

  it('lehnt anderes ab', () => {
    for (const h of ['', '#start=', '#start=enigma_ii', '#start=Enigma/x', '#start=a/%E0%A4%A', '#spieler=3', '#level=abc', '#start=a/b&c'])
      expect(startFromHash(h)).toBeNull();
  });

  it('findet das Level per ID, nicht per Nummer', () => {
    expect(indexOfLevel([{ id: 'a' }, { id: 'b' }], 'b')).toBe(1);
    expect(indexOfLevel([{ id: 'a' }], 'z')).toBe(-1);
  });

  it('jeder Startlink der Levelseiten trifft sein Level', () => {
    for (const p of buildPages(allPacks())) {
      for (const l of p.levels) {
        const link = startFromHash(playHash(p.id, l.file.id))!;
        expect(link.pack).toBe(p.id);
        expect(p.levels[indexOfLevel(p.levels.map((x) => x.file), link.id)].file.id).toBe(l.file.id);
      }
    }
  });
});

it('es gibt jedes Paket aus index.json als Datei', () => {
  for (const p of JSON.parse(PACK_FILES['index.json']) as { pack: string }[]) expect(PACK_FILES[`${p.pack}.json`]).toBeTypeOf('string');
});
