// Document texts in player levels (user decision 15.11.2026): plain text, at most 300 characters per
// document and 10 documents per level, cleaned the same way in the editor, sanitizeLevel and the converter.
import { describe, expect, it } from 'vitest';
import shim from '../lua/enigma.lua?raw';
import type { Fengari } from '../lua/runtime';
import { wandleUm } from '../enigma-upload/umwandeln';
import { decodeLevel, docText, encodeLevel, LinkError, MAX_DOC_TEXT, MAX_DOCS, sanitizeLevel } from './link';
import { cellOf, fromLevelFile, newLevel, paint, toLevelFile } from './model';
import { BY_KIND } from './palette';
import { check } from './rules';
import { setzeSpracheFuerTest } from '../i18n';

// German texts are checked here: the page language must not come from the machine (navigator.language)
setzeSpracheFuerTest('de');

const P = (k: string) => BY_KIND.get(k)!;

describe('docText', () => {
  it('macht reinen Text: Steuer-, unsichtbare und Richtungszeichen weg, Leerraum zusammen, höchstens 300 Zeichen', () => {
    expect(docText('  Hallo\n\tWelt\u0000!\u007f ')).toBe('Hallo Welt !');
    expect(docText('a‮b​c﻿d\u0085e')).toBe('a b c d e');
    expect(docText('<a href="https://x.example">klick</a>')).toBe('<a href="https://x.example">klick</a>'); // stays text, shown with textContent
    expect([...docText('ä'.repeat(400))]).toHaveLength(MAX_DOC_TEXT);
    expect(docText('😀'.repeat(301))).toBe('😀'.repeat(300)); // characters, not UTF-16 units
    expect(docText(42)).toBe('');
  });
});

describe('Dokumente in sanitizeLevel', () => {
  const base = () => {
    const l = newLevel();
    l.title = 'Texte';
    return toLevelFile(l, 'x');
  };

  it('behält den bereinigten Text nur bei it_document', () => {
    const f = base();
    f.objects = [
      { x: 3, y: 3, k: 'it_document', a: { text: '  Lies\nmich ‮' } },
      { x: 4, y: 3, k: 'it_hammer', a: { text: 'nein' } },
      { x: 5, y: 3, k: 'it_document', a: { text: '\u0000\u0001' } },
      { x: 6, y: 3, k: 'it_document', a: { text: 'x'.repeat(500) } },
    ];
    const out = sanitizeLevel(f, 'link:x').objects!;
    expect(out[0]).toEqual({ x: 3, y: 3, k: 'it_document', a: { text: 'Lies mich' } });
    expect(out[1]).toEqual({ x: 4, y: 3, k: 'it_hammer' });
    expect(out[2]).toEqual({ x: 5, y: 3, k: 'it_document' });
    expect(out[3].a!.text).toHaveLength(MAX_DOC_TEXT);
  });

  it(`lehnt mehr als ${MAX_DOCS} Dokumente ab`, () => {
    const f = base();
    f.objects = Array.from({ length: MAX_DOCS + 1 }, (_, i) => ({ x: 1 + i, y: 3, k: 'it_document', a: { text: `Nr. ${i}` } }));
    expect(() => sanitizeLevel(f, 'link:x')).toThrow(LinkError);
    f.objects.pop();
    expect(sanitizeLevel(f, 'link:x').objects).toHaveLength(MAX_DOCS);
  });

  it('Rundreise Editor → Link → Editor behält den Text', async () => {
    const l = newLevel();
    l.title = 'Brief';
    paint(l, 3, 3, P('it_document'));
    cellOf(l, 3, 3)!.ia = { text: 'Der Schlüssel liegt im Norden.' };
    const back = await decodeLevel(await encodeLevel(toLevelFile(l, 'b')));
    expect(back.objects).toEqual([{ x: 3, y: 3, k: 'it_document', a: { text: 'Der Schlüssel liegt im Norden.' } }]);
    expect(cellOf(fromLevelFile(back).level, 3, 3)!.ia).toEqual({ text: 'Der Schlüssel liegt im Norden.' });
  });
});

describe('Prüfregeln für Dokumente', () => {
  it('meldet leere Dokumente als Hinweis und zu viele als Fehler', () => {
    const l = newLevel();
    l.title = 'Viele';
    for (let i = 0; i <= MAX_DOCS; i++) paint(l, 1 + i, 2, P('it_document'));
    cellOf(l, 1, 2)!.ia = { text: 'eins' };
    const p = check(l);
    expect(p.find((x) => x.level === 'fehler' && /Höchstens 10 Dokumente/.test(x.text))).toBeTruthy();
    expect(p.find((x) => x.level === 'hinweis' && /10 Dokumente haben noch keinen Text/.test(x.text))).toBeTruthy();
  });
});

describe('Dokumente im Enigma-Umwandler', () => {
  const xml = (lua: string, i18n: string) => `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<el:level xmlns:el="http://enigma-game.org/schema/level/1">
  <el:protected>
    <el:info el:type="level">
      <el:identity el:title="Briefe" el:subtitle="" el:id="t"/>
      <el:author el:name="A" el:email=""/>
      <el:license el:type="GPL" el:open="true"/>
      <el:compatibility el:enigma="1.10"/>
    </el:info>
    <el:luamain><![CDATA[${lua}]]></el:luamain>
    <el:i18n>${i18n}</el:i18n>
  </el:protected>
</el:level>`;
  const um = async (lua: string, i18n = '') => wandleUm('t.xml', xml(lua, i18n), (await import('fengari')) as unknown as Fengari, shim);
  const level = (docs: string, row = '#1         #') => `
ti[" "] = {"fl_gray"}
ti["#"] = {"st_granite"}
ti["a"] = {"st_oxyd", oxydcolor = OXYD_BLUE}
ti["@"] = {"#ac_marble_black"}
${docs}
wo(ti, " ", {
  "############",
  "#a  @     a#",
  "${row}",
  "#          #",
  "############"})`;

  it('nimmt die deutsche Übersetzung, sonst Englisch, sonst den Schlüssel als Text', async () => {
    const r = await um(
      level(`ti["1"] = {"it_document", text = "t1"}\nti["2"] = {"it_document", text = "t2"}\nti["3"] = {"it_document", text = "Direkt und klar"}`, '#123       #'),
      `<el:string el:key="t1"><el:english el:translate="true">Look &lt;here&gt;</el:english><el:translation el:lang="de">Schau &lt;hier&gt;</el:translation></el:string>
       <el:string el:key="t2"><el:english el:translate="true">Only
         English</el:english></el:string>`,
    );
    const at = (x: number) => r.level.cells[2 * r.level.width + x];
    expect([at(1).ia?.text, at(2).ia?.text, at(3).ia?.text]).toEqual(['Schau <hier>', 'Only English', 'Direkt und klar']);
    expect(() => sanitizeLevel(toLevelFile({ ...r.level, title: 'Briefe' }), 'link:t')).not.toThrow();
  });

  it('kürzt lange Texte mit Hinweis und lehnt mehr als 10 Dokumente ab', async () => {
    const lang = await um(level(`ti["1"] = {"it_document", text = "${'w'.repeat(400)}"}`));
    expect([...lang.level.cells[2 * lang.level.width + 1].ia!.text]).toHaveLength(MAX_DOC_TEXT);
    expect(lang.hinweise.join(' ')).toMatch(/Ein Dokumenttext wurde auf 300 Zeichen gekürzt/);
    const viele = level(`for i = 0, 9 do ti[tostring(i)] = {"it_document", text = "x"} end\nti["9"] = {"it_document", text = "y"}`, '#1234567890#').replace('"#          #"', '"#0         #"');
    await expect(um(viele)).rejects.toThrow(/11 Dokumente; ein Spieler-Level darf höchstens 10/);
  });
});
