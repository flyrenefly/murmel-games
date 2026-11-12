/**
 * Lua callbacks of imported Enigma levels (Object::performAction → lua::CallFunc).
 * The level script runs in fengari (Lua 5.3 in JavaScript) on top of enigma.lua, a subset of
 * Enigma's API 2. Fengari is loaded only for levels that need it. Plain TypeScript (no Vite
 * imports, no parameter properties), so the importer can run it in Node as well.
 */
/** What the Lua API may see and change of the running level. Values travel as strings. */
export interface LuaHost {
  /** Refs of the objects whose name matches (with * and ?). */
  find(pattern: string): string[];
  /** Ref of the stone, item or floor in a cell, or null. */
  at(layer: 'st' | 'it' | 'fl', x: number, y: number): string | null;
  exists(ref: string): boolean;
  /** Grid position of a stone/item/floor, exact position of an actor. */
  pos(ref: string): [number, number];
  get(ref: string, key: string): string | null;
  set(ref: string, key: string, value: string | null): void;
  send(ref: string, msg: string, value: string | null): void;
  kill(ref: string): void;
  /** wo[pos] = tile: one declaration ({kind, attributes}) at a cell. */
  setTile(x: number, y: number, kind: string, attrs: Record<string, string>): void;
  /** World attribute (wo["GlobalForce"] …) as string, null = unknown. */
  world(key: string): string | null;
  setWorld(key: string, value: string | null): void;
  size(): [number, number];
  /** wo:add({kind, …}) in init mode (the importer records ot_timer); the game ignores it. */
  add?(kind: string, attrs: Record<string, string>): void;
}

export type Fengari = typeof import('fengari');

export class LuaLevel {
  /** Do not log Lua errors (the importer runs many levels). */
  static quiet = false;
  /** Last Lua error (also logged), for tests. */
  lastError = '';

  private readonly f: Fengari;
  private readonly L: object;

  private constructor(f: Fengari, L: object) {
    this.f = f;
    this.L = L;
  }

  /** Start the level script; init mode skips world building (the export already holds it). */
  /** f: the fengari module (fengari-web in the browser, fengari in Node). */
  static async create(code: string, host: LuaHost, shim: string, f: Fengari): Promise<LuaLevel> {
    const { lua, lauxlib, lualib, to_luastring } = f;
    const L = lauxlib.luaL_newstate();
    for (const [name, open] of [
      ['_G', lualib.luaopen_base],
      ['table', lualib.luaopen_table],
      ['string', lualib.luaopen_string],
      ['math', lualib.luaopen_math],
    ] as const) {
      lauxlib.luaL_requiref(L, to_luastring(name), open as (L: object) => number, 1);
      lua.lua_pop(L, 1);
    }
    const level = new LuaLevel(f, L);
    level.bridge(host);
    level.run(shim, '=enigma.lua');
    level.run(code, '=level');
    level.callGlobal('__endinit', []);
    return level;
  }

  /** Call the level function `name` like Enigma's callback (value, sender). */
  callback(name: string, value: boolean | number, senderRef: string): void {
    this.callGlobal('__callback', [name, value, senderRef]);
  }

  /** Importer: report the declarations of ti[key] through host.add("tile:<kind>", attrs). */
  describeTile(key: string): void {
    this.callGlobal('__describetile', [key]);
  }

  private str(s: string): Uint8Array {
    return this.f.to_luastring(s);
  }

  private run(code: string, chunk: string): void {
    const { lua, lauxlib } = this.f;
    if (lauxlib.luaL_loadbuffer(this.L, this.str(code), null, this.str(chunk)) !== lua.LUA_OK || lua.lua_pcall(this.L, 0, 0, 0) !== lua.LUA_OK) {
      this.fail();
    }
  }

  private callGlobal(name: string, args: (string | boolean | number)[]): void {
    const { lua } = this.f;
    lua.lua_getglobal(this.L, this.str(name));
    for (const a of args) {
      if (typeof a === 'boolean') lua.lua_pushboolean(this.L, a);
      else if (typeof a === 'number') lua.lua_pushinteger(this.L, a);
      else lua.lua_pushstring(this.L, this.str(a));
    }
    if (lua.lua_pcall(this.L, args.length, 0, 0) !== lua.LUA_OK) this.fail();
  }

  private fail(): void {
    const { lua } = this.f;
    this.lastError = lua.lua_tojsstring(this.L, -1);
    lua.lua_pop(this.L, 1);
    if (!LuaLevel.quiet) console.error(`Lua: ${this.lastError}`);
  }

  /** The table __M with the host functions (strings and numbers only). */
  private bridge(host: LuaHost): void {
    const { lua } = this.f;
    const L = this.L;
    const arg = (i: number): string | null => (lua.lua_type(L, i) <= lua.LUA_TNIL ? null : lua.lua_tojsstring(L, i));
    const num = (i: number): number => lua.lua_tonumber(L, i);
    const push = (v: string | number | boolean | null): void => {
      if (v === null) lua.lua_pushnil(L);
      else if (typeof v === 'number') {
        // whole numbers as Lua integers: Lua 5.1 (Enigma) prints 3.0 as "3"
        if (Number.isInteger(v)) lua.lua_pushinteger(L, v);
        else lua.lua_pushnumber(L, v);
      }
      else if (typeof v === 'boolean') lua.lua_pushboolean(L, v);
      else lua.lua_pushstring(L, this.str(v));
    };
    const fns: Record<string, (L: object) => number> = {
      find: () => {
        // a table: a group may hold more objects than the Lua stack has slots
        const refs = host.find(arg(1) ?? '');
        lua.lua_createtable(L, refs.length, 0);
        refs.forEach((r, i) => {
          push(r);
          lua.lua_rawseti(L, -2, i + 1);
        });
        return 1;
      },
      at: () => {
        push(host.at(arg(1) as 'st', num(2), num(3)));
        return 1;
      },
      exists: () => {
        push(host.exists(arg(1) ?? ''));
        return 1;
      },
      pos: () => {
        const [x, y] = host.pos(arg(1) ?? '');
        push(x);
        push(y);
        return 2;
      },
      get: () => {
        push(host.get(arg(1) ?? '', arg(2) ?? ''));
        return 1;
      },
      set: () => {
        host.set(arg(1) ?? '', arg(2) ?? '', arg(3));
        return 0;
      },
      send: () => {
        host.send(arg(1) ?? '', arg(2) ?? '', arg(3));
        return 0;
      },
      kill: () => {
        host.kill(arg(1) ?? '');
        return 0;
      },
      settile: () => {
        const attrs: Record<string, string> = {};
        for (let i = 4; i + 1 <= lua.lua_gettop(L); i += 2) {
          const v = arg(i + 1);
          if (v !== null) attrs[arg(i) ?? ''] = v;
        }
        host.setTile(num(1), num(2), arg(3) ?? '', attrs);
        return 0;
      },
      world: () => {
        push(host.world(arg(1) ?? ''));
        return 1;
      },
      setworld: () => {
        host.setWorld(arg(1) ?? '', arg(2));
        return 0;
      },
      add: () => {
        const attrs: Record<string, string> = {};
        for (let i = 2; i + 1 <= lua.lua_gettop(L); i += 2) {
          const v = arg(i + 1);
          if (v !== null) attrs[arg(i) ?? ''] = v;
        }
        host.add?.(arg(1) ?? '', attrs);
        return 0;
      },
      size: () => {
        const [w, h] = host.size();
        push(w);
        push(h);
        return 2;
      },
    };
    lua.lua_createtable(L, 0, Object.keys(fns).length);
    for (const [k, fn] of Object.entries(fns)) {
      lua.lua_pushjsfunction(L, (s) => {
        try {
          return fn(s);
        } catch (e) {
          return this.f.lauxlib.luaL_error(L, this.str(String(e)));
        }
      });
      lua.lua_setfield(L, -2, this.str(k));
    }
    lua.lua_setglobal(L, this.str('__M'));
  }
}
