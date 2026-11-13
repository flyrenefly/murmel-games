/** The Lua runtime with Murmel's Enigma API shim, for the browser. */
import api1 from './api1.lua?raw';
import shim from './enigma.lua?raw';
import { type Fengari, type LuaHost, LuaLevel } from './runtime';

export type { LuaHost };
export { LuaLevel };

/**
 * fengari-web is fengari's browser build: the plain package decides by `typeof process`
 * whether it runs in Node, and Vite's dev bundles define a process object.
 */
/** oldApi: the level uses Enigma's Lua API 1 (compatibility below 1.10). */
export async function startLua(code: string, host: LuaHost, oldApi = false): Promise<LuaLevel> {
  const f = (await import('fengari-web')) as unknown as Fengari;
  return LuaLevel.create(code, host, shim, f, oldApi ? api1 : undefined);
}
