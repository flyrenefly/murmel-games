import { describe, expect, it } from 'vitest';
import { startLuaNode } from '../lua/node';
import type { LevelFile } from './level';
import { GameSession, type StartLua } from './session';

const startLua: StartLua = (code, host, libs, oldApi) => startLuaNode(code, host, libs, oldApi);

/**
 * Tinker, Tailor (enigma_vii/andreas46_4): objects in own attributes (obj1["_fellow"] = obj2), the
 * "fellows" and "rubbers" of stones and actors (Object.cc), sender["rubbers"]:kill(), and rubber bands
 * from a horse to a stone made during play.
 */
const level = (code: string) =>
  ({
    id: 'test:fellows',
    title: 'Fellows',
    author: 'test',
    license: 'GPL',
    map: ['##########', '#a.......#', '#........#', '#.......a#', '#.......@#', '##########'],
    legend: { a: { stone: 'st_oxyd', symbol: 'A' } },
    objects: [
      { x: 3, y: 1, k: 'st_scissors', a: { name: 'sc1', fellows: 'marble,' } },
      { x: 5, y: 1, k: 'st_scissors', a: { name: 'sc2' } },
    ],
    actors: [{ k: 'ac_horse', x: 5.5, y: 3.5, a: { name: 'horse', _fellow: '\u0001n:sc2' } }],
    rubbers: [{ a: 0, b: [3.5, 1.5], strength: 0 }],
    lua: { code, kinds: {}, named: [], marble: { name: 'marble', _fellow: '\u0001n:sc1' } },
  }) as unknown as LevelFile;

async function run(code: string) {
  const s = await GameSession.create(level(`function f()\n${code}\nend`), { seed: 1, startLua });
  s.lua!.callback('f', true, '');
  expect(s.lua!.lastError).toBe('');
  return s;
}

describe('objects as attribute values, fellows and rubbers (Tinker, Tailor)', () => {
  it('an object in an own attribute stays that object; exported ones (by name) are objects too', async () => {
    const s = await run(
      'no["sc2"]["_fellow"] = no["horse"]\n' +
        'wo["_a"] = tostring(no["sc2"]["_fellow"] == no["horse"])\n' +
        'wo["_b"] = tostring(no["marble"]["_fellow"] == no["sc1"])\n' +
        'wo["_c"] = tostring(no["horse"]["_fellow"] == no["sc2"])',
    );
    expect([s.luaHost!.world('_a'), s.luaHost!.world('_b'), s.luaHost!.world('_c')]).toEqual(['true', 'true', 'true']);
  });

  it('fellows: the other anchors of the bands (not the export\'s stale actor names); rubbers: the bands', async () => {
    const s = await run(
      'wo["_a"] = tostring(no["sc1"]["fellows"][1] == no["marble"]) .. #no["sc1"]["fellows"]\n' +
        'wo["_b"] = tostring(no["marble"]["fellows"][1] == no["sc1"])\n' +
        'wo["_c"] = #no["sc2"]["fellows"] .. "," .. #no["sc1"]["rubbers"]\n' +
        'no["sc1"]["rubbers"]:kill()\n' +
        'wo["_d"] = #no["sc1"]["fellows"] .. "," .. #no["marble"]["rubbers"]',
    );
    expect(s.luaHost!.world('_a')).toBe('true1');
    expect(s.luaHost!.world('_b')).toBe('true');
    expect(s.luaHost!.world('_c')).toBe('0,1');
    expect(s.luaHost!.world('_d')).toBe('0,0');
    expect(s.physics.rubbers).toHaveLength(0);
  });

  it('oxydcolor set during play recolours the stone (OxydStone::setAttr; Ingrowing colours each new cross)', async () => {
    const s = await run('st(po(1, 1)).oxydcolor = OXYD_RED');
    const sig = s.level.signals.find((x) => x.col === 1 && x.row === 1)!;
    expect(sig.symbol).toBe('B');
    expect(s.board.symbolOf(sig.index)).toBe('B');
  });

  it('wo:add ties a horse to a stone during play; it becomes the stone\'s fellow', async () => {
    const s = await run(
      'wo:add({"ot_rubberband", anchor1 = no["horse"], anchor2 = no["sc2"], strength = 0})\n' +
        'wo["_a"] = tostring(no["sc2"]["fellows"][1] == no["horse"]) .. "," .. tostring(no["horse"]["fellows"][1] == no["sc2"])',
    );
    expect(s.luaHost!.world('_a')).toBe('true,true');
    expect(s.physics.rubbers).toHaveLength(2);
  });
});
