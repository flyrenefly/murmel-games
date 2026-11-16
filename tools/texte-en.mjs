// Englische Dokumenttexte (docs/SPEC-englisch.md, „Dokumenttexte aus Enigma“) in die bestehenden
// Paketdateien eintragen, ohne den ganzen Enigma-Import (~10 min) neu laufen zu lassen:
//   node tools/texte-en.mjs [<enigma>/data/levels]   (Standard: ../enigma-web/data/levels)
// Ändert in public/levels/enigma/<pack>.json nur `textsEn` (englisches Original, wo `texts` die deutsche
// Übersetzung ist und abweicht); alles andere bleibt byte-genau gleich. Zuordnung über level.source.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { withTextsEn } from './lib/enigma-texte.mjs';
import { ROOT } from './lib/levels.mjs';

const levelsDir = resolve(process.argv[2] ?? join(ROOT, '..', 'enigma-web', 'data', 'levels'));
if (!existsSync(levelsDir)) {
  console.error(`Enigma-Levels nicht gefunden: ${levelsDir}\nusage: node tools/texte-en.mjs <enigma>/data/levels`);
  process.exit(1);
}
const OUT = join(ROOT, 'public/levels/enigma');
const xmlFor = ({ pack, file }) => {
  const p = join(levelsDir, pack, file);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};

let files = 0;
let levels = 0;
let withEn = 0;
const missing = [];
const differs = [];
for (const name of readdirSync(OUT).filter((n) => n.endsWith('.json') && n !== 'index.json').sort()) {
  const path = join(OUT, name);
  const raw = readFileSync(path, 'utf8');
  const { text, changed, stats } = withTextsEn(raw, xmlFor);
  levels += stats.levels;
  withEn += stats.withTextsEn;
  missing.push(...stats.missingXml);
  differs.push(...stats.differs);
  if (changed) {
    writeFileSync(path, text);
    files++;
  }
}
if (missing.length) console.warn(`XML fehlt für ${missing.length} Levels: ${missing.slice(0, 10).join(', ')}`);
if (differs.length) console.warn(`texts weicht vom XML ab (${differs.length}): ${differs.slice(0, 10).join(', ')}`);
console.log(`textsEn: ${withEn} von ${levels} Levels mit Texten; ${files} Paketdateien geändert`);
