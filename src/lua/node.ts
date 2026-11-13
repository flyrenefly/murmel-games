/**
 * The Lua runtime for Node (checks and replays without the browser): the same shim, API 1 layer and
 * libraries as src/lua/index.ts, with the plain fengari package instead of fengari-web.
 */
import api1 from './api1.lua?raw';
import shim from './enigma.lua?raw';
import { LIBS } from './index';
import { type Fengari, type LuaHost, LuaLevel } from './runtime';

export async function startLuaNode(code: string, host: LuaHost, libs: readonly string[] = [], oldApi = false): Promise<LuaLevel> {
  const f = (await import('fengari')) as unknown as Fengari;
  return LuaLevel.create(
    code,
    host,
    shim,
    f,
    libs.map((l) => {
      const lib = LIBS[l];
      if (lib === undefined) throw new Error(`Murmel kennt die Bibliothek ${l} nicht`);
      return lib;
    }),
    oldApi ? api1 : undefined,
  );
}
