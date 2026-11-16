import { describe, expect, it } from 'vitest';
import { startLuaNode } from '../lua/node';
import type { LevelFile } from './level';
import { GameSession, type StartLua } from './session';

const startLua: StartLua = (code, host, libs, oldApi) => startLuaNode(code, host, libs, oldApi);

/**
 * The Inferno (enigma_ix/duffy181_2): its rooms are drawn during play, with passive marbles and pearls
 * (controllers = CTRL_NONE) and wo["SwampSinkTime"] set by a callback.
 */
const level = (code: string) =>
  ({
    id: 'test:inferno',
    title: 'Inferno',
    author: 'test',
    license: 'GPL',
    map: ['##########', '#a.......#', '#........#', '#........#', '#.......a#', '#.......@#', '##########'],
    legend: { a: { stone: 'st_oxyd', symbol: 'A' } },
    objects: [],
    actors: [{ k: 'ac_pearl', x: 1.5, y: 5.5 }],
    lua: { code, kinds: { ac_marble_white: 'actor', ac_pearl: 'actor' }, named: [] },
  }) as unknown as LevelFile;

const ROOM = [
  'function room()',
  '  wo[po(3, 2)] = {"#ac_marble_white", "lev1white", essential = DISPENSABLE, controllers = CTRL_NONE, owner = YANG}',
  '  wo[po(5, 2)] = {"#ac_pearl", "lev1pearl", essential = DISPENSABLE, controllers = CTRL_NONE, owner = YANG}',
  '  local p = no["lev1white"]',
  '  wo["_p"] = p.x .. "," .. p.y .. "/" .. no["lev1pearl"].x',
  'end',
  'function steered()',
  '  wo[po(3, 3)] = {"#ac_marble_white"}',
  'end',
  'function swamp()',
  '  wo["SwampSinkTime"] = 1.75',
  'end',
].join('\n');

describe('The Inferno: passive marbles and pearls made during play, SwampSinkTime', () => {
  it('adds them as passive, ownerless balls that Lua finds by name', async () => {
    const s = await GameSession.create(level(ROOM), { seed: 1, startLua });
    const before = s.physics.marbles.length;
    s.lua!.callback('room', true, '');
    expect(s.lua!.lastError).toBe('');
    const added = s.physics.marbles.slice(before);
    expect(added.map((m) => [m.pearl, m.passive, m.ownerless, m.color])).toEqual([[false, true, true, 1], [true, true, true, 1]]);
    expect(s.luaHost!.world('_p')).toBe('3.5,2.5/5.5');
    // the pearl of the level file keeps its index (actor ref a:1)
    expect(s.luaHost!.actorRef!(before - 1)).toBe('a:1');
  });

  it('they feel no mouse: only the player\'s marble and the steered pearl move', async () => {
    const s = await GameSession.create(level(ROOM), { seed: 1, startLua });
    s.lua!.callback('room', true, '');
    const n = s.physics.marbles.length;
    const start = s.physics.marbles.map((m) => ({ ...m.pos }));
    for (let i = 0; i < 200; i++) s.step({ fx: 3, fy: 0, ax: 0, ay: 0 });
    const moved = s.physics.marbles.map((m, i) => Math.hypot(m.pos.x - start[i].x, m.pos.y - start[i].y) > 0.05);
    expect(moved).toEqual([true, true, false, false].slice(0, n));
  });

  it('a dispensable one that dies stays dead without costing player 1 a life (owner YANG has none)', async () => {
    const s = await GameSession.create(level(ROOM), { seed: 1, startLua });
    s.lua!.callback('room', true, '');
    const lives = s.objects.inventories[0].filter((k) => k === 'it_extralife').length;
    const pearl = s.physics.marbles.length - 1;
    s.marbleDies(pearl, false);
    for (let i = 0; i < 2000; i++) s.step({ fx: 0, fy: 0, ax: 0, ay: 0 });
    expect(s.deadForever[pearl]).toBe(true);
    expect(s.physics.marbles[pearl].active).toBe(false);
    expect(s.objects.inventories[0].filter((k) => k === 'it_extralife').length).toBe(lives);
    expect((s as unknown as { pendingRestart?: string }).pendingRestart).toBeFalsy();
  });

  it('a marble made during play without controllers = CTRL_NONE is refused', async () => {
    const s = await GameSession.create(level(ROOM), { seed: 1, startLua });
    s.lua!.callback('steered', true, '');
    expect(s.lua!.lastError).toMatch(/nicht setzen/);
  });

  it('{"nil"} sets nothing; wo:add(player, tile of several items) adds each (lua.cc setObjectByTable, The Inferno)', async () => {
    const s = await GameSession.create(level('function f()\n  wo[po(4, 4)] = {"nil"}\n  wo:add(YIN, {"it_coin_s"} .. ti{"it_coffee"})\nend'), { seed: 1, startLua });
    const before = s.objects.inventories[0].length;
    s.lua!.callback('f', true, '');
    expect(s.lua!.lastError).toBe('');
    expect(s.objects.inventories[0].length).toBe(before + 2);
    expect(s.objects.inventories[0]).toEqual(expect.arrayContaining(['it_coin_s', 'it_coffee']));
  });

  it('wo["SwampSinkTime"] during play sets the sink speed (WorldProxy: 7 / t)', async () => {
    const s = await GameSession.create(level(ROOM), { seed: 1, startLua });
    expect(s.physics.swampSinkSpeed).toBe(4);
    s.lua!.callback('swamp', true, '');
    expect(s.physics.swampSinkSpeed).toBe(4);
    s.luaHost!.setWorld('SwampSinkTime', '3.5');
    expect(s.physics.swampSinkSpeed).toBe(2);
    s.luaHost!.setWorld('SwampSinkTime', '0');
    expect(s.physics.swampSinkSpeed).toBe(10000);
  });
});
