// node --test "tools/**/*.test.mjs": Dokumenttexte aus Enigma (tools/lib/enigma-texte.mjs, tools/texte-en.mjs).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { levelTexts, withTextsEn } from './enigma-texte.mjs';
import { ROOT } from './levels.mjs';

const XML = `<el:i18n>
  <el:string el:key="title"><el:english el:translate="false"/></el:string>
  <el:string el:key="t1"><el:english el:comment="x">Read the &quot;right&quot; one</el:english><el:translation el:lang="de">Lies das &quot;rechte&quot;</el:translation></el:string>
  <el:string el:key="t2"><el:english>Only English</el:english></el:string>
  <el:string el:key="t3"><el:english>Same</el:english><el:translation el:lang="de">Same</el:translation></el:string>
  <el:string el:key="t4"><el:english>Old</el:english><el:translation el:lang="de">Alt</el:translation></el:string>
</el:i18n>
<el:public><el:i18n><el:string el:key="t4"><el:english>New only</el:english></el:string></el:i18n></el:public>`;

test('levelTexts: Deutsch vor Englisch, textsEn nur wo die Übersetzung abweicht', () => {
  const { texts, textsEn } = levelTexts(XML);
  assert.deepEqual(texts, { t1: 'Lies das "rechte"', t2: 'Only English', t3: 'Same', t4: 'New only' });
  assert.deepEqual(textsEn, { t1: 'Read the "right" one' });
});

const pack = (levels) => JSON.stringify({ pack: 'p', title: 'P', levels }) + '\n';

test('withTextsEn: trägt textsEn direkt nach texts ein und lässt alles andere gleich', () => {
  const raw = pack([
    { id: 'enigma:a', title: 'A', map: ['#'], source: { pack: 'p', file: 'a.xml' }, texts: { t1: 'Lies das "rechte"', t2: 'Only English' }, x: 1.5 },
    { id: 'enigma:b', title: 'B', map: ['#'], source: { pack: 'p', file: 'b.xml' } },
  ]);
  const { text, changed, stats } = withTextsEn(raw, (src) => (src.file === 'a.xml' ? XML : null));
  assert.equal(changed, true);
  const levels = JSON.parse(text).levels;
  assert.deepEqual(Object.keys(levels[0]), ['id', 'title', 'map', 'source', 'texts', 'textsEn', 'x']);
  assert.deepEqual(levels[0].textsEn, { t1: 'Read the "right" one' });
  assert.equal(text.replace(',"textsEn":{"t1":"Read the \\"right\\" one"}', ''), raw);
  assert.equal(stats.withTextsEn, 1);
  // zweiter Lauf ändert nichts
  assert.equal(withTextsEn(text, () => XML).changed, false);
});

test('withTextsEn: ohne Unterschied bleibt die Datei byte-genau gleich; fremde Serialisierung wird abgelehnt', () => {
  const raw = pack([{ id: 'enigma:a', title: 'A', map: ['#'], source: { pack: 'p', file: 'a.xml' }, texts: { t2: 'Only English' } }]);
  assert.deepEqual(withTextsEn(raw, () => XML), { text: raw, changed: false, stats: { levels: 1, withTextsEn: 0, missingXml: [], differs: [] } });
  assert.throws(() => withTextsEn(JSON.stringify(JSON.parse(raw), null, 1), () => XML));
});

test('die Paketdateien sind so serialisiert wie der Import (Voraussetzung für tools/texte-en.mjs)', () => {
  const dir = join(ROOT, 'public/levels/enigma');
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json') && n !== 'index.json')) {
    const raw = readFileSync(join(dir, name), 'utf8');
    assert.equal(JSON.stringify(JSON.parse(raw)) + '\n', raw, name);
    for (const l of JSON.parse(raw).levels) if (l.textsEn) assert.ok(l.texts && Object.keys(l.textsEn).length && Object.keys(l.textsEn).every((k) => k in l.texts), l.id);
  }
});
