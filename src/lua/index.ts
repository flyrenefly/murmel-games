/** The Lua runtime with Murmel's Enigma API shim, for the browser. */
import shim from './enigma.lua?raw';
import libpento from './lib/libpento.lua?raw';
import { type Fengari, type LuaHost, LuaLevel } from './runtime';

export type { LuaHost };
export { LuaLevel };

/** Enigma libraries a level may name in lua.libs (src/lua/lib). */
const LIBS: Record<string, string> = { libpento };

/**
 * fengari-web is fengari's browser build: the plain package decides by `typeof process`
 * whether it runs in Node, and Vite's dev bundles define a process object.
 */
export async function startLua(code: string, host: LuaHost, libs: readonly string[] = []): Promise<LuaLevel> {
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
  );
}
