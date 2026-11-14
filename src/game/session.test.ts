import { describe, expect, it } from 'vitest';
import shim from '../lua/enigma.lua?raw';
import { LuaLevel } from '../lua/runtime';
import l01 from '../levels/01.json';
import enigmaI from '../../public/levels/enigma/enigma_i.json';
import type { LevelFile } from './level';
import { createRng } from './rng';
import { GameSession, NO_CONTROL, NO_UI, type StartLua, type StepControl } from './session';

const PACKS: Record<string, LevelFile[]> = { enigma_i: enigmaI.levels as unknown as LevelFile[] };
const pack = (name: string): LevelFile[] => PACKS[name];
/** A level by its id: positions in a pack shift when the import adds levels. */
const byId = (name: string, id: string): LevelFile => pack(name).find((l) => l.id === id)!;
const startLua: StartLua = async (code, host) => LuaLevel.create(code, host, shim, await import('fengari'));

/** A fixed but irregular control sequence (like a player moving the mouse). */
function controls(seed: number, n: number): StepControl[] {
  const r = createRng(seed);
  return Array.from({ length: n }, (_, i) => (i % 3 === 0 ? { fx: (r() - 0.5) * 8, fy: (r() - 0.5) * 8, ax: 0, ay: 0 } : NO_CONTROL));
}

/** Everything the run's outcome depends on, rounded so the comparison reads well. */
function snapshot(s: GameSession) {
  const p = (v: number) => Math.round(v * 1e9) / 1e9;
  return {
    marbles: s.physics.marbles.map((m) => [p(m.pos.x), p(m.pos.y), p(m.vel.x), p(m.vel.y), m.active]),
    enemies: s.physics.enemies.map((e) => [p(e.pos.x), p(e.pos.y)]),
    falls: s.falls,
    steps: s.steps,
    states: [...s.board.states],
    objects: s.objects.objects.map((o) => `${o.kind}@${o.col},${o.row}:${o.state}${o.gone ? 'x' : ''}`).join('|'),
  };
}

async function run(file: LevelFile, seed: number, input: StepControl[]) {
  const s = await GameSession.create(file, { seed, startLua });
  for (const c of input) s.step(c);
  return snapshot(s);
}

describe('GameSession', () => {
  it('lädt ein eingebautes Level und läuft ohne Browser', async () => {
    const s = await GameSession.create(l01 as LevelFile, { seed: 1 });

    for (let i = 0; i < 500; i++) s.step(NO_CONTROL);

    expect(s.steps).toBe(500);
    expect(s.physics.marbles.length).toBeGreaterThan(0);
  });

  it('ist deterministisch: gleicher Startwert und gleiche Eingaben ergeben denselben Zustand', async () => {
    const level = byId('enigma_i', 'enigma:rb01'); // Hostile World: Gegner, Abgründe, Objekte
    const input = controls(9, 3000);

    const a = await run(level, 42, input);
    const b = await run(level, 42, input);

    expect(a.enemies.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
    // der Lauf hat wirklich etwas erlebt (sonst wäre die Gleichheit wertlos)
    expect(a.marbles[0]).not.toEqual((await run(level, 42, [])).marbles[0]);
  });

  it('ist auch mit Lua deterministisch', async () => {
    const level = byId('enigma_i', 'enigma:duffy19'); // Snakes: Lua-Level
    const input = controls(3, 2000);

    expect(await run(level, 7, input)).toEqual(await run(level, 7, input));
  });

  it('die Eingabe bewegt die Murmel', async () => {
    const level = byId('enigma_i', 'enigma:rb01');
    const still = await run(level, 42, Array(600).fill(NO_CONTROL));
    const moved = await run(level, 42, controls(9, 600));

    expect(moved.marbles[0]).not.toEqual(still.marbles[0]);
  });

  it('sind alle Oxyd-Paare offen, ist das Level gelöst: Eingabe und Zeit stoppen, die Oberfläche erfährt es einmal', async () => {
    let wonCalls = 0;
    const ui = { ...NO_UI, won: () => wonCalls++ };
    const s = await GameSession.create(byId('enigma_i', 'enigma:rb01'), { seed: 5, ui });
    const hit = (x: number, y: number) => {
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const n = s.level.cells[(y + dy) * s.level.width + (x + dx)];
        if (!n || n.stone || /abyss|water|swamp/.test(n.floor)) continue;
        s.physics.respawn(x + dx + 0.5, y + dy + 0.5, 0);
        s.physics.setVelocity(-dx * 6, -dy * 6);
        for (let k = 0; k < 120; k++) s.step(NO_CONTROL);
        return;
      }
    };
    const sig = s.level.signals;
    for (let a = 0; a < sig.length && !s.won; a++) for (let b = a + 1; b < sig.length && !s.won; b++) {
      hit(sig[a].col, sig[a].row);
      hit(sig[b].col, sig[b].row);
    }
    const stepsAtWin = s.steps;
    for (let k = 0; k < 200; k++) s.step({ fx: 5, fy: 5, ax: 0, ay: 0 });

    expect(s.won).toBe(true);
    expect(wonCalls).toBe(1);
    expect(s.steps).toBe(stepsAtWin);
    expect(s.board.solvedPairs).toBe(s.board.totalPairs);
  });

  it('eine Murmel im Abgrund fällt, zählt als Sturz und kommt nach der Fallzeit wieder', async () => {
    const s = await GameSession.create(byId('enigma_i', 'enigma:rb01'), { seed: 1 }); // Abgrund bei (4, 3)
    const start = { ...s.physics.marbles[0].pos };

    s.physics.respawn(4.5, 3.5, 0);
    s.step(NO_CONTROL);
    expect(s.falling[0]).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 400; i++) s.step(NO_CONTROL);

    expect(s.falls).toBe(1);
    expect(s.falling[0]).toBe(-1);
    expect(s.physics.marbles[0].pos.x).toBeCloseTo(start.x, 5);
    expect(s.physics.marbles[0].pos.y).toBeCloseTo(start.y, 5);
  });
});
