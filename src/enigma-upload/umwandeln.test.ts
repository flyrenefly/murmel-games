import { describe, expect, it } from 'vitest';
import { sanitizeLevel } from '../editor/link';
import { toLevelFile } from '../editor/model';
import shim from '../lua/enigma.lua?raw';
import type { Fengari } from '../lua/runtime';
import { leseDatei, MAX_FILE, UploadError } from './datei';
import { BY_KIND } from '../editor/palette';
import { editorKind } from './editorlevel';
import { wandleUm } from './umwandeln';

const xml = (lua: string, head = '') => `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<el:level xmlns:el="http://enigma-game.org/schema/level/1">
  <el:protected>
    <el:info el:type="level">
      <el:identity el:title="Kleiner &amp; feiner Test" el:subtitle="" el:id="test1"/>
      <el:author el:name="Erika Muster" el:email=""/>
      <el:license el:type="GPL v2.0 or above" el:open="true"/>
      <el:compatibility el:enigma="1.10">${head}</el:compatibility>
    </el:info>
    <el:luamain><![CDATA[${lua}]]></el:luamain>
  </el:protected>
</el:level>`;

const LEVEL = `
ti[" "] = {"fl_lawn_b"}
ti["#"] = {"st_brick_n"}
ti["a"] = {"st_oxyd", oxydcolor = OXYD_BLUE}
ti["?"] = {"st_oxyd_c"}
ti["s"] = {"st_switch", target = "tuer", state = ON}
ti["d"] = {"st_door_d", "tuer", faces = "ew"}
ti["h"] = {"it_hammer"}
ti["r"] = {"ac_rotor", range = 5}
ti["@"] = {"#ac_marble_black"}
wo(ti, " ", {
  "#######",
  "#a @ a#",
  "# s d #",
  "#? hr?#",
  "#######"})
`;

const fengari = async () => (await import('fengari')) as unknown as Fengari;
const um = async (name: string, text: string) => wandleUm(name, text, await fengari(), shim);

describe('Enigma-Datei lesen', () => {
  it('liest Kopf, Lizenz und Lua-Teil', () => {
    const d = leseDatei('test.xml', xml('wo(ti, " ", 5, 5)', '<el:dependency el:path="lib/libmap" el:id="lib/libmap" el:release="1" el:preload="true"/>'));
    expect(d).toMatchObject({ title: 'Kleiner & feiner Test', author: 'Erika Muster', license: 'GPL v2.0 or above', compat: 1.1, libs: ['liblua', 'libmap'] });
    expect(d.code).toBe('wo(ti, " ", 5, 5)');
  });

  it('weist DOCTYPE/ENTITY (XXE), zu große Dateien, API 1 und fremde Bibliotheken ab', () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>${xml('wo(ti, " ", 5, 5)')}`;
    expect(() => leseDatei('a.xml', xxe)).toThrow(/DOCTYPE/);
    expect(() => leseDatei('a.xml', 'x', MAX_FILE + 1)).toThrow(/höchstens 256 KB/);
    expect(() => leseDatei('a.xml', xml('x').replace('1.10', '1.00'))).toThrow(/API 1/);
    expect(() => leseDatei('a.lua', 'create_world(20, 13)')).toThrow(/API 1/);
    expect(() => leseDatei('a.xml', xml('x', '<el:dependency el:path="lib/ant" el:preload="true"/>'))).toThrow(/lib\/ant fehlt/);
    expect(() => leseDatei('a.txt', 'x')).toThrow(UploadError);
    expect(() => leseDatei('a.xml', '<html></html>')).toThrow(/el:level/);
    expect(() => leseDatei('a.xml', '<el:level></el:level>')).toThrow(/el:luamain/);
  });

  it('nimmt reine Lua-Dateien mit dem Dateinamen als Titel', () => {
    expect(leseDatei('C:\\x\\mein_level.lua', 'wo(ti, " ", 5, 5)')).toMatchObject({ title: 'mein_level', compat: 1.1, libs: [] });
  });
});

describe('Umwandeln ins Editor-Level', () => {
  it('übersetzt Palette-Arten, Oxyd-Farben, Türen, Start und Gegner', async () => {
    const r = await um('t.xml', xml(LEVEL));
    const { level } = r;
    expect(r.herkunft).toEqual({ autor: 'Erika Muster', lizenz: 'GPL v2.0 or above' });
    expect([level.title, level.author, level.width, level.height]).toEqual(['Kleiner & feiner Test', '', 7, 5]);
    const at = (x: number, y: number) => level.cells[y * 7 + x];
    expect(at(0, 0)).toEqual({ f: 'fl_lawn', s: 'st_brick' });
    expect(at(1, 1).sa).toEqual({ symbol: 'A', flavor: 'b' });
    expect(at(1, 3).sa).toEqual({ symbol: '?', flavor: 'c' });
    expect(at(2, 2)).toEqual({ f: 'fl_lawn', s: 'st_switch', sa: { target: 'tuer' } });
    expect(at(4, 2)).toEqual({ f: 'fl_lawn', s: 'st_door_d_ew', sa: { name: 'tuer' } });
    expect(at(3, 3).i).toBe('it_hammer');
    expect(level.start).toEqual({ x: 3, y: 1 });
    expect(level.actors).toEqual([{ k: 'ac_rotor', x: 4.5, y: 3.5 }]);
    expect(r.hinweise.join(' ')).toMatch(/state von st_switch.*range von ac_rotor/);
    // the result passes the strict check of player levels
    const file = sanitizeLevel(JSON.parse(JSON.stringify(toLevelFile(level, 'link:x'))), 'link:x');
    expect(file.objects?.map((o) => o.k).sort()).toEqual(['it_hammer', 'st_door_d_ew', 'st_switch']);
  });

  it('nennt fehlende Objekte mit Anzahl', async () => {
    const lua = LEVEL.replace('{"it_hammer"}', '{"it_document", text = "x"}').replace('"#######",\n  "#a', '"###m###",\n  "#a').replace('ti["@"]', 'ti["m"] = {"st_mirror_sheets"}\nti["x"] = {"it_document"}\nti["@"]');
    await expect(um('t.xml', xml(lua.replace('"#? hr?#"', '"#?xhr?#"')))).rejects.toThrow(/it_document \(2×\), st_mirror_sheets\./);
  });

  it('lehnt Lua-Rückrufe und falsche Murmelzahl ab', async () => {
    await expect(um('t.xml', xml(`function auf() end\n${LEVEL.replace('target = "tuer"', 'target = "auf"')}`))).rejects.toThrow(/st_switch über die Lua-Funktion „auf“/);
    await expect(um('t.xml', xml(LEVEL.replace('"#a @ a#"', '"#a @@a#"')))).rejects.toThrow(/genau eine schwarze Murmel oder, als Meditation, eine Perle \(gefunden: 2 Murmeln\)/);
    await expect(um('t.xml', xml('ti[" "] = {"fl_gray"}\nwo(ti, " ", 3, 3)'))).rejects.toThrow(/3×3/);
  });
});

describe('Arten aus Attributen', () => {
  it('setzt Tür, Gitter, Kiste und Einbahn nach Enigmas Vorgaben', () => {
    expect(editorKind({ k: 'st_door', a: {} })).toBe('st_door_d');
    expect(editorKind({ k: 'st_door', a: { faces: 'ew' } })).toBe('st_door_d_ew');
    expect(editorKind({ k: 'st_door', a: { flavor: 'b' } })).toBe('st_door_b');
    expect(editorKind({ k: 'st_grate', a: {} })).toBe('st_grate_cross');
    expect(editorKind({ k: 'st_box', a: { flavor: 'hay' } })).toBe('st_box_hay');
    expect(editorKind({ k: 'st_oneway', a: {} })).toBe('st_oneway_n');
    expect(editorKind({ k: 'st_oneway', a: { orientation: '0' } })).toBe('st_oneway_w');
  });

  it('macht aus schiebbaren oder zerbrechlichen Steinen keine Wand', async () => {
    const lua = LEVEL.replace('{"it_hammer"}', '{"st_flat_breakable"}').replace('{"st_brick_n"}', '{"st_granite_movable"}');
    const { level } = await um('t.xml', xml(lua));
    const kinds = new Set(level.cells.map((c) => c.s));
    expect(kinds.has('st_flat_breakable') && kinds.has('st_granite_movable')).toBe(true);
    expect(kinds.has('st_granite') || kinds.has('st_flat')).toBe(false);
    expect(BY_KIND.get('st_flat_breakable')?.wall).toBeUndefined();
  });
});

describe('Neue Arten der Palette (15.11.2026)', () => {
  it('übersetzt Laser, Spiegel, Durchlässe, Felsbrocken und Gefälle mit ihren Eigenschaften', async () => {
    const lua = `
ti[" "] = {"fl_gray"}
ti["#"] = {"st_granite"}
ti["a"] = {"st_oxyd", oxydcolor = OXYD_BLUE}
ti["L"] = {"st_laser", orientation = SOUTH, state = ON}
ti["M"] = {"st_mirror_slab_wtm"}
ti["T"] = {"st_mirror", flavor = "triangle", orientation = EAST, movable = true}
ti["P"] = {"st_passage_white_cross"}
ti["B"] = {"st_boulder", orientation = WEST}
ti["v"] = {"fl_slope", slope = 2, strength = 40}
ti["s"] = {"fl_slope_ps"}
ti["i"] = {"fl_inverse"}
ti["@"] = {"#ac_marble_black"}
wo(ti, " ", {
  "#########",
  "#a  @  a#",
  "#LMTPB  #",
  "#vsi    #",
  "#########"})`;
    const r = await um('neu.xml', xml(lua));
    const at = (x: number, y: number) => r.level.cells[y * r.level.width + x];
    expect(at(1, 2)).toEqual({ f: 'fl_gray', s: 'st_laser_s', sa: { state: '1' } });
    expect(at(2, 2)).toEqual({ f: 'fl_gray', s: 'st_mirror_slab', sa: { orientation: '0', transparent: 'true', movable: 'true' } });
    expect(at(3, 2)).toEqual({ f: 'fl_gray', s: 'st_mirror_triangle', sa: { orientation: '2', movable: 'true' } });
    expect(at(4, 2)).toEqual({ f: 'fl_gray', s: 'st_passage_white', sa: { flavor: 'cross' } });
    expect(at(5, 2).s).toBe('st_boulder_w');
    expect([at(1, 3).f, at(2, 3).f, at(3, 3).f]).toEqual(['fl_slope_pe', 'fl_slope_ps', 'fl_inverse_white']);
    expect(r.hinweise.join(' ')).toMatch(/strength von fl_slope/);
    expect(() => sanitizeLevel(toLevelFile({ ...r.level, title: 'Neu' }), 'link:neu')).not.toThrow();
  });

  it('macht ohne schwarze Murmel die erste Perle zur Hauptkugel (Meditation)', async () => {
    const lua = `
ti[" "] = {"fl_gray"}
ti["#"] = {"st_granite"}
ti["o"] = {"it_meditation"}
ti["p"] = {"ac_pearl", color = WHITE}
ti["q"] = {"ac_pearl", color = BLACK}
wo(ti, " ", {
  "#######",
  "#p o  #",
  "#     #",
  "#q o  #",
  "#######"})`;
    const r = await um('ruhe.xml', xml(lua));
    expect(r.level.mainPearl).toBe('ac_pearl_white');
    expect(r.level.start).toEqual({ x: 1, y: 1 });
    expect(r.level.actors).toEqual([{ k: 'ac_pearl_black', x: 1.5, y: 3.5 }]);
    expect(r.level.cells.filter((c) => c.i === 'it_meditation_hollow')).toHaveLength(2);
    const file = sanitizeLevel(toLevelFile({ ...r.level, title: 'Ruhe' }), 'link:ruhe');
    expect(file.mainPearl).toEqual({ k: 'ac_pearl_white' });
  });

  it('baut Kacheln mit res.composer zusammen (wie api2init.lua)', async () => {
    const lua = `
ti["  "] = {"fl_gray"}
ti[" #"] = {"st_granite"}
ti[" a"] = {"st_oxyd", oxydcolor = OXYD_BLUE}
ti["~ "] = {"fl_ice"}
ti[" h"] = {"it_hammer"}
ti[" @"] = {"#ac_marble_black"}
wo(res.composer(ti), "  ", {
  " # # # # #",
  " #   a @ #",
  " #~h  ~  #",
  " #     a #",
  " # # # # #"})`;
    const r = await um('comp.xml', xml(lua));
    expect(r.level.width).toBe(5);
    expect(r.level.cells[2 * 5 + 1]).toEqual({ f: 'fl_ice', i: 'it_hammer' });
    expect(r.level.cells[2 * 5 + 3]).toEqual({ f: 'fl_ice' });
  });
});
