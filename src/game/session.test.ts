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

describe('Oxyd stones Lua kills or replaces during play', () => {
  /** Four Oxyd stones (A A B B) in a closed room; Lua functions move them around. */
  const file = (code: string): LevelFile => ({
    id: 'test:oxydwechsel',
    title: 'Oxyd-Wechsel',
    author: 'test',
    license: 'GPL',
    map: ['##########', '#a.b....@#', '#........#', '#a.b.....#', '##########'],
    legend: { a: { stone: 'st_oxyd', symbol: 'A' }, b: { stone: 'st_oxyd', symbol: 'B' } },
    lua: { code, kinds: { st_granite: 'st_granite', st_oxyd: 'oxyd', st_nil: 'nil' }, named: [] },
  }) as unknown as LevelFile;

  it('a replaced stone leaves the game; the new one is a closed stone of its own', async () => {
    const s = await GameSession.create(file(`function move()
  wo[po(3, 1)] = {"st_granite"}
  wo[po(5, 1)] = {"st_oxyd", flavor = "d", oxydcolor = 1}
end`), { seed: 1, startLua });
    s.lua!.callback('move', true, '');
    await Promise.resolve();
    expect(s.lua!.lastError).toBe('');
    const lv = s.level;
    expect(lv.signals.map((g) => [g.col, g.row, g.symbol, g.flavor, !!g.gone])).toEqual([
      [1, 1, 'A', 'a', false],
      [3, 1, 'B', 'a', true],
      [1, 3, 'A', 'a', false],
      [3, 3, 'B', 'a', false],
      [5, 1, 'B', 'd', false],
    ]);
    expect(lv.cells[1 * lv.width + 3].stone).toBe('st_granite');
    expect(s.board.totalPairs).toBe(2);
    expect(s.board.isRemoved(1)).toBe(true);
  });

  it('killing the unpaired stones lets the remaining pairs finish the level', async () => {
    const s = await GameSession.create(file(`function clear()
  wo[po(3, 1)] = {"st_nil"}
  wo[po(3, 3)] = {"st_nil"}
end`), { seed: 1, startLua });
    s.lua!.callback('clear', true, '');
    expect(s.lua!.lastError).toBe('');
    expect(s.level.cells[1 * s.level.width + 3].stone).toBeNull();
    expect(s.board.totalPairs).toBe(1);
    s.board.hit(0);
    expect(s.board.hit(2)).toContainEqual({ type: 'complete' });
  });
});

describe('horse with a Lua callback (Ariadne, Pairs II)', () => {
  it('calls its target at a reached destination; Lua sets the next one', async () => {
    const file = {
      id: 'test:pferd',
      title: 'Pferd',
      author: 'test',
      license: 'GPL',
      map: ['##########', '#a......@#', '#........#', '#a.......#', '##########'],
      legend: { a: { stone: 'st_oxyd', symbol: 'A' } },
      actors: [{ k: 'ac_horse', x: 3.5, y: 2.5, a: { name: 'horse', dests: '3.5,2.5', loop: 'true', target: 'reached' } }],
      lua: { code: `calls = 0
function reached(value, sender)
  calls = calls + 1
  sender.destination = po(6.2, 2.9)
  wo["_calls"] = calls
end`, kinds: {}, named: [] },
    } as unknown as LevelFile;
    const s = await GameSession.create(file, { seed: 1, startLua });
    s.step(NO_CONTROL);
    s.step(NO_CONTROL);
    expect(s.lua!.lastError).toBe('');
    const horse = s.physics.enemies[0];
    expect(horse.dests).toEqual([[6.5, 2.5]]); // centeredPos
    expect(s.luaHost!.world('_calls')).toBe('1');
  });
});

describe('obj:sound (Acoustic Reminiscence)', () => {
  it('reaches the UI as an Enigma sound event', async () => {
    const file = {
      id: 'test:klang',
      title: 'Klang',
      author: 'test',
      license: 'GPL',
      map: ['##########', '#a......@#', '#a.......#', '##########'],
      legend: { a: { stone: 'st_oxyd', symbol: 'A' } },
      objects: [{ x: 3, y: 1, k: 'st_switch', a: { name: 'sw', target: 'play' } }],
      lua: { code: 'function play() no["sw"]:sound("cloth", 0.5) end', kinds: {}, named: [] },
    } as unknown as LevelFile;
    const heard: string[] = [];
    const s = await GameSession.create(file, { seed: 1, startLua, ui: { ...NO_UI, enigmaSound: (n, v) => heard.push(`${n} ${v}`) } });
    s.lua!.callback('play', true, '');
    expect(s.lua!.lastError).toBe('');
    expect(heard).toEqual(['cloth 0.5']);
  });
});

describe('it_sensor passes the actor to its Lua callback (Enibricks: Sensor::actor_enter → performAction(a))', () => {
  const file = (inverse: boolean) => ({
    id: 'test:sensor-akteur',
    title: 'Sensor',
    author: 'test',
    license: 'GPL',
    map: ['##########', '#a......@#', '#a.......#', '##########'],
    legend: { a: { stone: 'st_oxyd', symbol: 'A' } },
    objects: [{ x: 3, y: 2, k: 'it_sensor', a: { target: 'next', invisible: 'true', ...(inverse ? { inverse: 'true' } : {}) } }],
    actors: [{ k: 'ac_pearl_black', x: 2.5, y: 2.5, a: { _vortex: 'vortex2' } }],
    lua: { code: 'function next(value, sender)\n  wo["_v"] = type(value) == "boolean" and tostring(value) or value["_vortex"]\nend', kinds: {}, named: [] },
  }) as unknown as LevelFile;

  it('the pearl that rolls onto the sensor is the value', async () => {
    const s = await GameSession.create(file(false), { seed: 1, startLua });
    const pearl = s.physics.marbles.length - 1;
    s.objects.marbleAt(2, 2, pearl);
    s.objects.marbleAt(3, 2, pearl);
    expect(s.lua!.lastError).toBe('');
    expect(s.luaHost!.world('_v')).toBe('vortex2');
  });

  it('an inverse sensor sends false (invertActionValue = !toBool)', async () => {
    const s = await GameSession.create(file(true), { seed: 1, startLua });
    const pearl = s.physics.marbles.length - 1;
    s.objects.marbleAt(2, 2, pearl);
    s.objects.marbleAt(3, 2, pearl);
    expect(s.lua!.lastError).toBe('');
    expect(s.luaHost!.world('_v')).toBe('false');
  });
});

describe('timers without $id (made by the Lua init)', () => {
  it('each calls its callback with itself as sender (Happy New Year: three fireworks, one function)', async () => {
    const timer = (name: string) => ({ x: -1, y: -1, k: 'ot_timer', a: { name, action: 'callback', target: 'tick', interval: '0.1', $state: '1' } });
    const file = {
      id: 'test:zeitgeber',
      title: 'Zeitgeber',
      author: 'test',
      license: 'GPL',
      map: ['##########', '#a......@#', '#a.......#', '##########'],
      legend: { a: { stone: 'st_oxyd', symbol: 'A' } },
      objects: [timer('t1'), timer('t2')],
      lua: { code: `function tick(value, sender)\n  wo["_" .. sender.name] = (wo["_" .. sender.name] or 0) + 1\nend`, kinds: {}, named: [] },
    } as unknown as LevelFile;
    const s = await GameSession.create(file, { seed: 1, startLua });
    for (let i = 0; i < 200; i++) s.step(NO_CONTROL);
    expect(s.lua!.lastError).toBe('');
    expect(Number(s.luaHost!.world('_t1'))).toBeGreaterThan(0);
    expect(s.luaHost!.world('_t2')).toBe(s.luaHost!.world('_t1'));
  });
});

describe('horse with an owner (Enignimm, Rotor Guards: player::MayPickup)', () => {
  it('picks up the items it rolls over into its owner\'s inventory', async () => {
    const file = {
      id: 'test:pferd-besitzer',
      title: 'Pferd',
      author: 'test',
      license: 'GPL',
      map: ['##########', '#a......@#', '#........#', '#a.......#', '##########'],
      legend: { a: { stone: 'st_oxyd', symbol: 'A' } },
      objects: [{ x: 3, y: 2, k: 'it_hammer', a: {} }, { x: 5, y: 2, k: 'it_umbrella', a: {} }],
      actors: [
        { k: 'ac_horse', x: 3.5, y: 2.5, a: { owner: '1' } },
        { k: 'ac_horse', x: 5.5, y: 2.5 },
      ],
    } as unknown as LevelFile;
    const s = await GameSession.create(file, { seed: 1 });
    s.step(NO_CONTROL);
    expect(s.objects.inventories[1]).toEqual(['it_hammer']);
    expect(s.objects.inventories[0]).not.toContain('it_hammer');
    // a horse without owner picks up nothing
    expect(s.objects.objects.find((o) => o.kind === 'it_umbrella')!.gone).toBeFalsy();
  });
});
