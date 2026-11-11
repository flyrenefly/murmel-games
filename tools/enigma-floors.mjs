// Reads friction and adhesion of all Enigma floors from data/schemas/objects.xml
// (following "super" inheritance) and writes src/game/floors.generated.json.
// Usage: node tools/enigma-floors.mjs <enigma>/data/schemas/objects.xml

import { readFileSync, writeFileSync } from 'node:fs';

const xml = readFileSync(process.argv[2], 'utf8');
const objects = new Map();
for (const m of xml.matchAll(/<object\s+name="([^"]+)"([^>]*?)(\/>|>([\s\S]*?)<\/object>)/g)) {
  const [, name, rest, , body = ''] = m;
  const sup = /super="([^"]+)"/.exec(rest)?.[1] ?? null;
  const attrs = {};
  for (const a of body.matchAll(/<attr\s+name="([^"]+)"(?:\s+default="([^"]*)")?/g)) {
    if (a[2] !== undefined) attrs[a[1]] = a[2];
  }
  objects.set(name, { sup, attrs });
}

function attr(name, key, seen = new Set()) {
  const o = objects.get(name);
  if (!o || seen.has(name)) return undefined;
  seen.add(name);
  if (key in o.attrs) return o.attrs[key];
  return o.sup ? attr(o.sup, key, seen) : undefined;
}

const table = {};
for (const name of [...objects.keys()].sort()) {
  if (!name.startsWith('fl_')) continue;
  const f = attr(name, 'friction');
  const a = attr(name, 'adhesion');
  if (f === undefined && a === undefined) continue;
  table[name] = [Number(f ?? 0), Number(a ?? 0)];
}
writeFileSync('src/game/floors.generated.json', JSON.stringify(table, null, 0).replace(/\],/g, '],\n') + '\n');
console.log(`${Object.keys(table).length} floors`);
