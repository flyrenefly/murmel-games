import { describe, expect, it } from 'vitest';
import shim from '../lua/enigma.lua?raw';
import { LIBS } from '../lua/index';
import type { Fengari } from '../lua/runtime';
import { UploadError } from './datei';
import { baueWelt, buildShim } from './welt';

const bau = async (code: string, libs: string[] = []) => baueWelt(code, (await import('fengari')) as unknown as Fengari, shim, libs.map((l) => LIBS[l]));
const kind = (w: Awaited<ReturnType<typeof bau>>, x: number, y: number, l: 'fl' | 'st' | 'it') => w.cells[y * w.w + x][l]?.k;

describe('Aufbau-Modus', () => {
  it('baut die Welt aus wo(ti, Standard, Karte) mit Standardboden', async () => {
    const w = await bau(`
ti[" "] = {"fl_lawn"}
ti["#"] = {"st_granite"}
ti["o"] = {"it_hammer"}
ti["x"] = {"st_oxyd", oxydcolor = OXYD_RED}
ti["@"] = {"#ac_marble_black"}
wo(ti, " ", {
  "#####",
  "#@ o#",
  "#x x",
  "#####"})`);
    expect([w.w, w.h]).toEqual([5, 4]);
    expect(kind(w, 0, 0, 'st')).toBe('st_granite');
    expect(kind(w, 0, 0, 'fl')).toBe('fl_lawn'); // default floor under a stone without floor
    expect(kind(w, 3, 1, 'it')).toBe('it_hammer');
    expect(w.cells[2 * 5 + 1].st).toEqual({ k: 'st_oxyd', a: { oxydcolor: '1' } });
    // a short line: the rest is the default tile
    expect(kind(w, 4, 2, 'fl')).toBe('fl_lawn');
    expect(w.actors).toEqual([{ k: 'ac_marble_black', a: {}, x: 1.5, y: 1.5 }]);
  });

  it('kennt wo[pos] =, drawRect, Kachelverkettung und Namen', async () => {
    const w = await bau(`
ti["."] = {"fl_sand"}
wo(ti, ".", 6, 5)
wo:drawBorder(po(0, 0), 6, 5, {"st_brick"})
wo[po(2, 2)] = ti({"st_switch", "s1", target = "tuer"}) .. {"it_coin_m"}
wo[{4, 2}] = {"st_door_d", name = "tuer", faces = "ew"}
wo["ConserveLevel"] = false`);
    expect(kind(w, 5, 4, 'st')).toBe('st_brick');
    expect(w.cells[2 * 6 + 2].st).toEqual({ k: 'st_switch', a: { name: 's1', target: 'tuer' } });
    expect(kind(w, 2, 2, 'it')).toBe('it_coin_m');
    expect(w.cells[2 * 6 + 4].st?.a).toEqual({ name: 'tuer', faces: 'ew' });
    expect(w.world.ConserveLevel).toBe('false');
  });

  it('nutzt Bibliotheken (libmap) und res.autotile', async () => {
    const w = await bau(
      `
ti[" "] = {"fl_gray"}
ti["#"] = {"st_granite"}
ti["a"] = {"st_oxyd", oxydcolor = OXYD_BLUE}
local m = wo:newMap(" ", {"###", "#a#", "###"})
wo(ti, m)`,
      ['liblua', 'libmap'],
    );
    expect([w.w, w.h]).toEqual([3, 3]);
    expect(kind(w, 1, 1, 'st')).toBe('st_oxyd');
  });

  it('meldet unbekannte Resolver, Lua-Fehler, Größe und Endlosschleifen mit Grund', async () => {
    await expect(bau(`ti[" "] = {"fl_gray"}\nwo(res.maze(ti), " ", 3, 3)`)).rejects.toThrow(/res.maze/);
    await expect(bau(`ti[" "] = {"fl_gray"}\nwo(ti, " ", 3, 3)\nlocal a = nil\na.b = 1`)).rejects.toThrow(/Zeile 4/);
    await expect(bau(`ti[" "] = {"fl_gray"}\nwo(ti, " ", 80, 50)`)).rejects.toThrow(/80×50.*60×40/);
    await expect(bau(`while true do end`)).rejects.toThrow(/zu lange/);
    await expect(bau(`ti[" "] = {"fl_gray"}`)).rejects.toThrow(/wo\(\.\.\.\) fehlt/);
    await expect(bau(`wo(ti, " ", {"ab"})`)).rejects.toThrow(UploadError);
  });

  it('hat keinen Dateizugriff', async () => {
    await expect(bau(`dofile("x.lua")`)).rejects.toThrow(/dofile/);
    await expect(bau(`require("os")`)).rejects.toThrow(/require/);
    await expect(bau(`io.open("x")`)).rejects.toThrow(/io/);
  });

  it('merkt Lua-Funktionen für Rückrufe und nicht übernehmbare Gadgets', async () => {
    const w = await bau(`
ti[" "] = {"fl_gray"}
function oeffne() end
wo(ti, " ", 3, 3)
wo:add({"ot_timer", interval = 2})`);
    expect(w.isFunction('oeffne')).toBe(true);
    expect(w.isFunction('nix')).toBe(false);
    expect(w.unsupported).toEqual(['ot_timer']);
  });

  it('findet die INIT-Marke im Shim', () => {
    expect(buildShim(shim)).toContain('local INIT = false');
  });
});
