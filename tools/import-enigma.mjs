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
  'st_greenbrown', 'st_brownpyramid', 'st_bluesand', 'st_brick', 'st_rawglass', 'st_panel',
  'st_plaster', 'st_flat', 'st_beads',
]);
// Variants that only differ in edges/decoration: drawn with the base image.
const STONE_BASE = /^(st_(?:bluesand|brick|panel|rawglass))(_[nesw]+|_quad)?$/;
const FAKE_OXYD = /^st_fake_oxyd([abcd])$/;
const OXYD = /^st_oxyd(_([abcd]))?$/;
const SPECIAL_FLOORS = /^fl_(slope|swamp|bridge|forward|scales|thief|yinyang|inverse|fake|adhesionless|ice_heating|hay)/;
const DEADLY = new Set(['fl_abyss', 'fl_water']);

// Interactive objects (src/game/objects.ts): kind patterns and the images they need.
const OBJECTS = [
  [/^st_door(_[abcd])?(_ew)?(_open)?$/, ['st_oxyda', 'st_grate_cross', 'sh_grate_cross', 'st_grate_framed', 'sh_grate_framed', 'st_flat', 'st_door_b', 'st_door_d_ns', 'st_door_d_ew', 'sh_doorh', 'sh_doorv', 'sh_round', 'sh_solid']],
  [/^st_switch(_black|_white)?(_instant)?$/, ['st_switch', 'st_switch_black', 'st_switch_white', 'sh_round']],
  [/^it_trigger$/, ['it_trigger']],
  [/^it_document$/, ['it_document']],
  [/^st_grate(_cross|_framed)?$/, ['st_grate_cross', 'sh_grate_cross', 'st_grate_framed', 'sh_grate_framed']],
  [/^st_timer$/, ['st_timer', 'sh_round']],
  [/^st_quake$/, ['st_quake', 'st_oxydb', 'sh_round']],
  [/^st_death(_invisible)?$/, ['st_death', 'sh_round']],
  [/^st_oneway(_black|_white)?(_[nesw])?$/, ['st_oneway']],
  [/^st_box(_wood(_[hv])?|_hay|_rock)?$/, ['st_box_wood', 'st_box_hay', 'st_box_rock', 'sh_round', 'fl_wood_framed', 'fl_hay', 'fl_rock']],
];
const objectImages = (k) => OBJECTS.find(([re]) => re.test(k))?.[1] ?? null;
const ACTIONS = new Set(['', 'toggle', 'signal', 'open', 'on', 'close', 'off', 'nop', 'flip']);
// Attributes the Murmel objects use; everything else (Lua helpers like _foo) is dropped.
const KEEP_ATTR = /^(\$id|\$state|\$connections|name|target(_\d+)?|action(_\d+)?|inverse|color|instant|flavor|text|invisible|faces|interval|loop|orientation)$/;
// API 1 message names Murmel translates (objects.ts API1_RENAMING): receiver kind → message.
const API1_ACTIONS = [[/^st_door/, 'openclose'], [/^st_switch/, 'onoff']];
const tokens = (v) => (v ?? '').split(/[;,]/).map((t) => t.trim()).filter((t) => t !== '');

const unxml = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();

/** Level strings by key: German translation if present, else English. */
function levelTexts(xml) {
  const texts = {};
  for (const m of xml.matchAll(/<el:string el:key="([^"]*)">([\s\S]*?)<\/el:string>/g)) {
    const de = /<el:translation el:lang="de"[^>]*>([\s\S]*?)<\/el:translation>/.exec(m[2]);
    const en = /<el:english[^>]*>([\s\S]*?)<\/el:english>/.exec(m[2]);
    const t = de?.[1] ?? en?.[1];
    if (t && unxml(t)) texts[m[1]] = unxml(t);
  }
  return texts;
}

/** Objects named by a target token among the level's objects (as objects.ts resolves it). */
function resolveTarget(token, objs) {
  if (/^#\d+$/.test(token)) return objs.filter((o) => '#' + o.a.$id === token);
  if (token.startsWith('%')) return [];
  if (/[*?]/.test(token)) {
    const re = new RegExp('^' + token.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    return objs.filter((o) => o.a.name && re.test(o.a.name));
  }
  return objs.filter((o) => o.a.name === token);
}

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

const reasons = new Map(); // blocker -> levels it blocks (among others)
const only = new Map(); // blocker -> levels it alone blocks
let blockers = null; // Set while converting one level
const reject = (why) => {
  if (blockers) {
    blockers.add(why);
    return undefined;
  }
  reasons.set(why, (reasons.get(why) ?? 0) + 1);
  only.set(why, (only.get(why) ?? 0) + 1);
  return null;
};
function finish(level) {
  if (!blockers) return level;
  const b = [...blockers];
  blockers = null;
  if (b.length === 0) return level;
  for (const why of b) reasons.set(why, (reasons.get(why) ?? 0) + 1);
  if (b.length === 1) only.set(b[0], (only.get(b[0]) ?? 0) + 1);
  return null;
}

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

function objectDef(x, y, o) {
  const a = {};
  for (const [k, v] of Object.entries(o)) if (k !== 'k' && KEEP_ATTR.test(k) && v !== '') a[k] = v;
  return { x, y, k: o.k, a };
}

function convert(pack, meta, xml, exp) {
  blockers = new Set();
  return finish(convertLevel(pack, meta, xml, exp));
}

function convertLevel(pack, meta, xml, exp) {
  const imgs = new Set();
  const licence = attr(xml, /<el:license el:type="([^"]*)"/);
  if (!licenceOk(licence)) {
    blockers = null;
    return reject(`Lizenz: ${licence || 'keine Angabe'}`);
  }
  if (/el:single="false"/.test(xml)) {
    blockers = null;
    return reject('nur Netzwerkspiel');
  }
  const w = exp.world;
  const compat = Number(attr(xml, /el:compatibility el:enigma="([0-9.]+)"/)) || 1.1;
  const actors = w.actors.map((a) => a.o.k);
  if (actors.length !== 1 || actors[0] !== 'ac_marble_black') reject(`Akteure: ${[...new Set(actors)].sort().join('+') || 'keine'}`);

  const legend = {};
  const keyOf = new Map();
  const pool = [...'.#o~,;:-_=+*%&$§!|/<>()[]{}^`\'"0123456789abcdefghijklmnpqrstuvwxyzÄÖÜäöüßéèêàâçñ']; // '@' and A–Z have own meanings
  let oxyds = 0;
  const rows = [];
  const objs = [];
  const allObjects = new Map(); // $id → kind, to name unsupported targets
  for (const c of w.cells) for (const o of c) if (o) allObjects.set(o.$id, o);
  for (let y = 0; y < w.h; y++) {
    let row = '';
    for (let x = 0; x < w.w; x++) {
      const [fl, st, it] = w.cells[y * w.w + x];
      if (it) {
        const im = objectImages(it.k);
        if (im) {
          objs.push(objectDef(x, y, it));
          im.forEach((i) => imgs.add(i));
        } else reject(`Gegenstand ${it.k}`);
      }
      if (!fl) {
        reject('Feld ohne Boden');
        continue;
      }
      if (SPECIAL_FLOORS.test(fl.k)) reject(`Boden ${fl.k.replace(/_[nesw]+$/, '')}`);
      // Floor forces (force_x/force_y) are not modelled yet.
      if ((Number(fl.force_x) || 0) !== 0 || (Number(fl.force_y) || 0) !== 0) reject(`Boden mit Kraft (${fl.k})`);
      const flImg = DEADLY.has(fl.k) ? fl.k : imageFor(fl.k);
      if (!flImg) {
        reject(`Boden ohne Bild ${fl.k}`);
        continue;
      }
      imgs.add(flImg);
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
          for (const s of ['', '_open', '_opening']) imgs.add(`st_oxyd${flavor}${s}`);
        } else if (objectImages(st.k)) {
          // Boxes moved together by wires, or breaking into items, are not built yet.
          if (/^st_box/.test(st.k) && (st.wires || st.fellows || st.selection)) reject(`Stein ${st.k} (verbunden)`);
          objs.push(objectDef(x, y, st));
          objectImages(st.k).forEach((i) => imgs.add(i));
        } else if (FAKE_OXYD.test(st.k)) {
          def.stone = `st_oxyd${FAKE_OXYD.exec(st.k)[1]}`;
          imgs.add(def.stone);
        } else if (STONES.has(st.k) || STONE_BASE.test(st.k)) {
          def.stone = STONE_BASE.exec(st.k)?.[1] ?? st.k;
          imgs.add(def.stone);
        } else reject(`Stein ${st.k.replace(/_[nesw]+$/, '')}`);
      }
      const key = JSON.stringify(def);
      let ch = keyOf.get(key);
      if (!ch) {
        ch = pool[keyOf.size];
        if (!ch) {
          reject('zu viele Feldarten');
          continue;
        }
        keyOf.set(key, ch);
        legend[ch] = def;
      }
      row += ch;
    }
    rows.push(row);
  }
  // Every action must be a supported message to a supported object (no Lua callbacks).
  for (const o of objs) {
    for (const key of Object.keys(o.a).filter((k) => /^target(_\d+)?$/.test(k))) {
      const acts = tokens(o.a[key.replace('target', 'action')] ?? o.a.action);
      tokens(o.a[key]).forEach((t, i) => {
        const act = acts[i] ?? '';
        if (act === 'callback' || resolveTarget(t, objs).length === 0) {
          const named = [...allObjects.values()].find((x) => x.name === t || '#' + x.$id === t);
          reject(named ? `Stein ${named.k.replace(/_[nesw]+$/, '')}` : 'Lua-Rückruf');
        } else if (!ACTIONS.has(act)) {
          const ok = compat < 1.1 && resolveTarget(t, objs).every((x) => API1_ACTIONS.some(([re, a]) => a === act && re.test(x.k)));
          if (!ok) reject(`Aktion ${act}`);
        }
      });
    }
  }
  if (oxyds === 0) reject('keine Oxyd-Steine');
  else if (oxyds % 2) reject('ungerade Zahl Oxyd-Steine');
  if (blockers.size) return null;
  for (const i of imgs) usedImages.add(i);
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
    ...(objs.length ? { objects: objs } : {}),
    ...(compat < 1.1 ? { compat } : {}),
    ...(objs.some((o) => o.k === 'it_document') ? { texts: levelTexts(xml) } : {}),
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
  '| Fehlt | blockiert Levels | davon nur daran |',
  '|---|---|---|',
  ...top.map(([r, n]) => `| ${r} | ${n} | ${only.get(r) ?? 0} |`),
  '',
];
writeFileSync('tools/import-report.md', report.join('\n'));
console.log(`${ok}/${total} Levels, ${index.length} Pakete, ${usedImages.size} Bilder`);
console.log(top.slice(0, 25).map(([r, n]) => `${String(n).padStart(4)}  ${r}`).join('\n'));
