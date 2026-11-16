// Enigma upload in English (docs/SPEC-englisch.md): document texts from el:i18n in the page's language,
// messages of the conversion (also from the Lua addon) in English, the worker gets the language.
import { afterEach, describe, expect, it } from 'vitest';
import shim from '../lua/enigma.lua?raw';
import type { Fengari } from '../lua/runtime';
import { setzeSpracheFuerTest } from '../i18n';
import { leseDatei } from './datei';
import { vorlageAus } from './dialog';
import { wandleUm } from './umwandeln';
import { baueWelt, luaText } from './welt';

afterEach(() => setzeSpracheFuerTest(null));

const xml = (lua: string, i18n: string) => `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<el:level xmlns:el="http://enigma-game.org/schema/level/1">
  <el:protected>
    <el:info el:type="level">
      <el:identity el:title="Letters" el:subtitle="" el:id="t"/>
      <el:author el:name="A" el:email=""/>
      <el:license el:type="GPL" el:open="true"/>
      <el:compatibility el:enigma="1.10"/>
    </el:info>
    <el:luamain><![CDATA[${lua}]]></el:luamain>
    <el:i18n>${i18n}</el:i18n>
  </el:protected>
</el:level>`;

const I18N = `<el:string el:key="t1"><el:english el:translate="true">Look &lt;here&gt;</el:english><el:translation el:lang="de">Schau &lt;hier&gt;</el:translation></el:string>
  <el:string el:key="t2"><el:english el:translate="true">Only English</el:english></el:string>
  <el:string el:key="t3"><el:english el:translate="true"></el:english><el:translation el:lang="de">Nur Deutsch</el:translation></el:string>`;

const fengari = async () => (await import('fengari')) as unknown as Fengari;

describe('el:i18n nach Sprache', () => {
  it('nimmt in Englisch das englische Original, sonst die deutsche Übersetzung', () => {
    setzeSpracheFuerTest('en');
    expect(leseDatei('a.xml', xml('x', I18N)).texts).toEqual({ t1: 'Look <here>', t2: 'Only English', t3: 'Nur Deutsch' });
  });

  it('nimmt in Deutsch die deutsche Übersetzung, sonst das englische Original', () => {
    setzeSpracheFuerTest('de');
    expect(leseDatei('a.xml', xml('x', I18N)).texts).toEqual({ t1: 'Schau <hier>', t2: 'Only English', t3: 'Nur Deutsch' });
  });

  it('übernimmt den englischen Text ins Dokument', async () => {
    setzeSpracheFuerTest('en');
    const lua = `ti[" "] = {"fl_gray"}\nti["#"] = {"st_granite"}\nti["a"] = {"st_oxyd", oxydcolor = OXYD_BLUE}\nti["@"] = {"#ac_marble_black"}\nti["1"] = {"it_document", text = "t1"}
wo(ti, " ", {"#######", "#     #", "#a @1a#", "#     #", "#######"})`;
    const r = await wandleUm('t.xml', xml(lua, I18N), await fengari(), shim);
    expect(r.level.cells.find((c) => c.i === 'it_document')?.ia?.text).toBe('Look <here>');
  });
});

describe('Meldungen auf Englisch', () => {
  it('Datei, Lua-Zusatz und Vorlage', async () => {
    setzeSpracheFuerTest('en');
    expect(() => leseDatei('a.txt', 'x')).toThrow('Please choose an Enigma level file (.xml or .lua).');
    await expect(baueWelt(`ti[" "] = {"fl_gray"}\nwo(res.maze(ti), " ", 3, 3)`, await fengari(), shim)).rejects.toThrow(/Murmel does not know res\.maze yet/);
    await expect(baueWelt(`ti[" "] = {"fl_gray"}\nwo(ti, "x", 3, 3)`, await fengari(), shim)).rejects.toThrow(/The tile “x” at 0, 0 is not defined/);
    await expect(baueWelt(`ti[" "] = {"fl_gray"}`, await fengari(), shim)).rejects.toThrow('The level creates no world (wo(...) is missing).');
    expect(vorlageAus({ autor: 'Ronald Lamprecht', lizenz: 'GPL' })).toBe('Enigma level by Ronald Lamprecht (GPL)');
  });

  it('luaText macht aus Platzhaltern Lua-Ausdrücke', () => {
    expect(luaText('Die Kachel „{key}“ bei {x}')).toBe('"Die Kachel „" .. tostring(key) .. "“ bei " .. tostring(x)');
    expect(luaText('Sag "hallo"')).toBe('"Sag \\"hallo\\""');
  });
});
