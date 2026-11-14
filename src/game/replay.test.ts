import { describe, expect, it } from 'vitest';
import enigmaI from '../../public/levels/enigma/enigma_i.json';
import browserRun from './fixtures/browser-hostile-world.json';
import shim from '../lua/enigma.lua?raw';
import { LuaLevel } from '../lua/runtime';
import type { LevelFile } from './level';
import { replay } from './replay';
import { createRng } from './rng';
import { GameSession, NO_CONTROL, type StartLua } from './session';

const levels = enigmaI.levels as unknown as LevelFile[];
/** By id: positions in the pack shift when the import adds levels. */
const byId = (id: string): LevelFile => levels.find((l) => l.id === id)!;
const startLua: StartLua = async (code, host) => LuaLevel.create(code, host, shim, await import('fengari'));

/** Plays like a person: irregular mouse moves, sometimes keys, sometimes an action. */
async function play(file: LevelFile, seed: number, steps: number) {
  const s = await GameSession.create(file, { seed, startLua });
  const r = createRng(seed + 1);
  for (let i = 0; i < steps && !s.won; i++) {
    if (i % 400 === 50) s.act('use');
    if (i % 700 === 300) s.act('rotate');
    const mouse = i % 4 === 0;
    s.step({ fx: mouse ? (r() - 0.5) * 6 : 0, fy: mouse ? (r() - 0.5) * 6 : 0, ax: i % 900 < 100 ? 0.7 : 0, ay: 0 });
  }
  return s;
}

const state = (s: GameSession) => ({
  steps: s.steps,
  falls: s.falls,
  won: s.won,
  marbles: s.physics.marbles.map((m) => [m.pos.x, m.pos.y, m.vel.x, m.vel.y]),
  inventory: [...s.objects.inventory],
  states: [...s.board.states],
});

describe('Aufzeichnung und Nachspielen', () => {
  it('ein aufgezeichneter Lauf ergibt nachgespielt genau denselben Zustand', async () => {
    const live = await play(byId('enigma:rb01'), 77, 4000);
    const rec = JSON.parse(JSON.stringify(live.recording()));

    const again = await replay(byId('enigma:rb01'), rec, { startLua });

    expect(rec.steps).toBe(live.steps);
    expect(state(again)).toEqual(state(live));
  });

  it('gilt auch für ein Lua-Level', async () => {
    const live = await play(byId('enigma:duffy19'), 5, 3000);
    const again = await replay(byId('enigma:duffy19'), JSON.parse(JSON.stringify(live.recording())), { startLua });

    expect(state(again)).toEqual(state(live));
  });

  it('nimmt nur Aktionen des Spielers auf, die Aufzeichnung enthält Startwert und Level', async () => {
    const live = await play(byId('enigma:rb01'), 3, 1000);
    const rec = live.recording();

    expect(rec.seed).toBe(3);
    expect(rec.level).toBe(byId('enigma:rb01').id);
    expect(rec.input.filter((e) => typeof e[1] === 'string').map((e) => e[1])).toEqual(['use', 'rotate', 'use', 'use']); // Schritte 50, 300, 450, 850
  });

  it('ein im Browser (Edge) aufgezeichneter Lauf ergibt in Node genau den Endzustand aus dem Browser', async () => {
    // aufgenommen im Browser mit window.murmel (load, mouse, drop, recording): 3 s Mausbewegung und eine Ablege-Aktion
    const { rec, state: browser } = browserRun as unknown as { rec: unknown; state: { steps: number; falls: number; marbles: number[][] } };

    const s = await replay(byId('enigma:rb01'), rec, { startLua });

    expect(s.steps).toBe(browser.steps);
    expect(s.falls).toBe(browser.falls);
    expect(s.physics.marbles.map((m) => [m.pos.x, m.pos.y])).toEqual(browser.marbles);
  });

  it('lehnt eine Aufzeichnung für ein anderes Level ab', async () => {
    const rec = (await play(byId('enigma:rb01'), 3, 100)).recording();

    await expect(replay(byId('enigma:level7a'), rec, { startLua })).rejects.toThrow();
  });

  it('ohne Eingabe bleibt die Aufzeichnung klein (Lauflängen)', async () => {
    const s = await GameSession.create(byId('enigma:rb01'), { seed: 1 });
    for (let i = 0; i < 5000; i++) s.step(NO_CONTROL);

    expect(s.recording().input).toEqual([[5000, 0, 0]]);
  });
});
