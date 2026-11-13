/** The Lua runtime with Murmel's Enigma API shim, for the browser. */
import api1 from './api1.lua?raw';
import shim from './enigma.lua?raw';
import liblua from './lib/liblua.lua?raw';
import libmath from './lib/libmath.lua?raw';
import libpento from './lib/libpento.lua?raw';
import natmaze from './lib/natmaze.lua?raw';
import { type Fengari, type LuaHost, LuaLevel } from './runtime';

export type { LuaHost };
export { LuaLevel };

/** Enigma libraries a level may name in lua.libs (src/lua/lib). */
export const LIBS: Record<string, string> = { libpento, liblua, libmath, natmaze };

/**
 * fengari-web is fengari's browser build: the plain package decides by `typeof process`
 * whether it runs in Node, and Vite's dev bundles define a process object.
 */
/** libs: Murmel's copies of Enigma libraries (lua.libs); oldApi: the level uses Enigma's Lua API 1 (compatibility below 1.10). */
export async function startLua(code: string, host: LuaHost, libs: readonly string[] = [], oldApi = false): Promise<LuaLevel> {
  const f = (await import('fengari-web')) as unknown as Fengari;
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
