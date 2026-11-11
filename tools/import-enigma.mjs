// Converts Enigma levels into Murmel level packs.
//
// Input: the JSON world export of the Enigma fork (flyrenefly/enigma-web,
// branch level-export: every level loaded by the real engine) plus Enigma's
// level XML files for metadata and licence.
// Output: public/levels/enigma/index.json, one JSON file per pack, the
// required graphics in public/enigma/<set>/ and tools/import-report.md.
//
// Usage: node tools/import-enigma.mjs <exportDir> <enigma>/data

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [exportDir, enigmaData] = process.argv.slice(2);
if (!exportDir || !enigmaData) {
  console.error('usage: import-enigma.mjs <exportDir> <enigma>/data');
  process.exit(1);
}
const levelsDir = join(enigmaData, 'levels');
const OUT = 'public/levels/enigma';
const GFX_SETS = ['gfx32', 'gfx32-retro'];

// Packs that recreate the original Dongleware levels, or are not meant for play.
const EXCLUDED_PACKS = /^(enigma_oxyd|enigma_oxydextra|enigma_oxydmagnum|enigma_peroxyd|enigma_esprit|enigma_experimental|enigma_demolevels|tutorial_old|lib)$/;

// What the Murmel engine can do so far.
const STONES = new Set([
  'st_granite', 'st_darkgray', 'st_purplemarble', 'st_tigris', 'st_purplegray', 'st_greengray',
  'st_concrete', 'st_ancient', 'st_brownmarble', 'st_redmarble', 'st_bluegray', 'st_pinkbumps',
  'st_camouflage', 'st_redbrown', 'st_metal', 'st_redrock', 'st_woven', 'st_yellow',
  'st_greenbrown', 'st_brownpyramid',
]);
const OXYD = /^st_oxyd(_([abcd]))?$/;
const SPECIAL_FLOORS = /^fl_(slope|swamp|bridge|forward|scales|thief|yinyang|inverse|fake|adhesionless|ice_heating|hay|space)/;
const DEADLY = new Set(['fl_abyss', 'fl_water']);

const licenceOk = (l) => /GPL|GPJ|Donated to Enigma|public domain/i.test(l);

function attr(xml, re) {
  return re.exec(xml)?.[1] ?? '';
}

function readPacks() {
  const packs = [];
  for (const name of readdirSync(levelsDir)) {
    const idx = join(levelsDir, name, 'index.xml');
    if (!existsSync(idx) || EXCLUDED_PACKS.test(name)) continue;
    const xml = readFileSync(idx, 'utf8');
    const info = /<info\s([^>]*)\/>/.exec(xml)?.[1] ?? '';
    const levels = [...xml.matchAll(/<level\s([^>]*)\/>/g)].map((m) => ({
      seq: Number(attr(m[1], /_seq="(\d+)"/)),
      title: attr(m[1], /_title="([^"]*)"/),
      xpath: attr(m[1], /_xpath="([^"]*)"/),
      id: attr(m[1], /\sid="([^"]*)"/),
      author: attr(m[1], /author="([^"]*)"/),
    }));
    packs.push({
      name,
      title: attr(info, /title="([^"]*)"/) || name,
      location: Number(attr(info, /location="(\d+)"/)) || 99999,
      levels: levels.sort((a, b) => a.seq - b.seq),
    });
  }
  return packs.sort((a, b) => a.location - b.location);
}

const exportIndex = new Map();
for (const f of readdirSync(exportDir)) {
  if (!f.endsWith('.json')) continue;
  try {
    const e = JSON.parse(readFileSync(join(exportDir, f), 'utf8'));
    exportIndex.set(e.path, e);
  } catch {
    /* broken export: level is skipped */
  }
}

const reasons = new Map();
const reject = (why) => {
  reasons.set(why, (reasons.get(why) ?? 0) + 1);
  return null;
};

const usedImages = new Set(['st_oxyd_colordots', 'st_oxyd_questmark', 'st_oxyd_blink']);

function hasImage(kind) {
  return existsSync(join(enigmaData, 'gfx32', `${kind}.png`));
}

/** Image name for a floor/stone kind: the kind itself or its base kind. */
function imageFor(kind) {
  let k = kind;
  while (!hasImage(k) && k.lastIndexOf('_') > 2) k = k.slice(0, k.lastIndexOf('_'));
  return hasImage(k) ? k : null;
}

function convert(pack, meta, xml, exp) {
  const licence = attr(xml, /<el:license el:type="([^"]*)"/);
  if (!licenceOk(licence)) return reject(`Lizenz: ${licence || 'keine Angabe'}`);
  if (/el:single="false"/.test(xml)) return reject('nur Netzwerkspiel');
  const w = exp.world;
  const actors = w.actors.map((a) => a.o.k);
  if (actors.length !== 1 || actors[0] !== 'ac_marble_black') return reject(`Akteure: ${[...new Set(actors)].sort().join('+') || 'keine'}`);

  const legend = {};
  const keyOf = new Map();
  const pool = [...'.#o~,;:-_=+*%&$§!|/<>()[]{}^`\'"0123456789abcdefghijklmnpqrstuvwxyzÄÖÜäöüßéèêàâçñ']; // '@' and A–Z have own meanings
  let oxyds = 0;
  const rows = [];
  for (let y = 0; y < w.h; y++) {
    let row = '';
    for (let x = 0; x < w.w; x++) {
      const [fl, st, it] = w.cells[y * w.w + x];
      if (it) return reject(`Gegenstand ${it.k}`);
      if (!fl) return reject('Feld ohne Boden');
      if (SPECIAL_FLOORS.test(fl.k)) return reject(`Boden ${fl.k}`);
      const flImg = DEADLY.has(fl.k) ? fl.k : imageFor(fl.k);
      if (!flImg) return reject(`Boden ohne Bild ${fl.k}`);
      usedImages.add(flImg);
      const def = { floor: DEADLY.has(fl.k) ? fl.k : flImg };
      if (st) {
        const ox = OXYD.exec(st.k);
        if (ox) {
          const flavor = st.flavor || ox[2] || 'a';
          const color = Number(st.oxydcolor);
          def.stone = 'st_oxyd';
          def.flavor = flavor;
          def.symbol = Number.isInteger(color) && color >= 0 && color < 26 ? String.fromCharCode(65 + color) : '?';
          oxyds++;
          for (const s of ['', '_open', '_opening']) usedImages.add(`st_oxyd${flavor}${s}`);
        } else if (STONES.has(st.k)) {
          def.stone = st.k;
          usedImages.add(st.k);
        } else return reject(`Stein ${st.k}`);
      }
      const key = JSON.stringify(def);
      let ch = keyOf.get(key);
      if (!ch) {
        ch = pool[keyOf.size];
        if (!ch) return reject('zu viele Feldarten');
        keyOf.set(key, ch);
        legend[ch] = def;
      }
      row += ch;
    }
    rows.push(row);
  }
  if (oxyds === 0) return reject('keine Oxyd-Steine');
  if (oxyds % 2) return reject('ungerade Zahl Oxyd-Steine');
  const a = w.actors[0];
  return {
    id: `enigma:${exp.id}`,
    title: meta.title,
    author: meta.author,
    license: licence,
    map: rows,
    legend,
    start: { x: Math.round(a.x * 1000) / 1000, y: Math.round(a.y * 1000) / 1000 },
    source: { pack, file: `${meta.xpath.replace(/^\.\//, '')}.xml` },
  };
}

mkdirSync(OUT, { recursive: true });
const index = [];
let total = 0;
let ok = 0;
for (const pack of readPacks()) {
  const levels = [];
  for (const meta of pack.levels) {
    total++;
    const file = join(levelsDir, pack.name, `${meta.xpath.replace(/^\.\//, '')}.xml`);
    if (!existsSync(file)) {
      reject('XML fehlt');
      continue;
    }
    const xml = readFileSync(file, 'utf8');
    const exp = exportIndex.get(`${pack.name}/${meta.xpath.replace(/^\.\//, '')}`);
    if (!exp) {
      reject('nicht exportiert');
      continue;
    }
    const lvl = convert(pack.name, meta, xml, exp);
    if (lvl) levels.push(lvl);
  }
  ok += levels.length;
  if (levels.length === 0) continue;
  writeFileSync(join(OUT, `${pack.name}.json`), JSON.stringify({ pack: pack.name, title: pack.title, levels }) + '\n');
  index.push({ pack: pack.name, title: pack.title, count: levels.length, of: pack.levels.length });
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');

for (const set of GFX_SETS) {
  mkdirSync(join('public/enigma', set), { recursive: true });
  for (const img of usedImages) {
    const src = join(enigmaData, set, `${img}.png`);
    const fallback = join(enigmaData, 'gfx32', `${img}.png`);
    if (existsSync(src)) copyFileSync(src, join('public/enigma', set, `${img}.png`));
    else if (set === 'gfx32' || !existsSync(fallback)) console.warn(`Bild fehlt: ${set}/${img}`);
  }
}

const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]);
const report = [
  '# Enigma-Import',
  '',
  `${ok} von ${total} Levels übernommen (${index.length} Pakete).`,
  '',
  '| Grund für Nichtübernahme | Levels |',
  '|---|---|',
  ...top.map(([r, n]) => `| ${r} | ${n} |`),
  '',
];
writeFileSync('tools/import-report.md', report.join('\n'));
console.log(`${ok}/${total} Levels, ${index.length} Pakete, ${usedImages.size} Bilder`);
console.log(top.slice(0, 25).map(([r, n]) => `${String(n).padStart(4)}  ${r}`).join('\n'));
