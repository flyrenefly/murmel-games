/**
 * Lua callbacks of imported Enigma levels (Object::performAction → lua::CallFunc).
 * The level script runs in fengari (Lua 5.3 in JavaScript) on top of enigma.lua, a subset of
 * Enigma's API 2. Fengari is loaded only for levels that need it. Plain TypeScript (no Vite
 * imports, no parameter properties), so the importer can run it in Node as well.
 */
/**
 * Attribute values that are objects (Enigma: Value(Object), ObjectList) travel as strings with a leading
 * control character: OBJECT_REF + a ref (or "n:" + a name, as the importer writes exported ones),
 * OBJECT_LIST + comma separated refs.
 */
export const OBJECT_REF = '\u0001';
export const OBJECT_LIST = '\u0002';

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
  /** wo[pos] = {"ac_…"} during play: a new actor at an exact position (lua.cc AddActor). */
  addActor?(x: number, y: number, kind: string, attrs: Record<string, string>): void;
  /** World attribute (wo["GlobalForce"] …) as string, null = unknown. */
  world(key: string): string | null;
  setWorld(key: string, value: string | null): void;
  size(): [number, number];
  /** wo:add({kind, …}) in init mode (the importer records ot_timer); the game ignores it. */
  add?(kind: string, attrs: Record<string, string>): void;
  /** wo:add(YIN/YANG, {"it_…"}) during play. */
  addInventory?(player: number, kind: string, text?: string | null): void;
  /** wo:add({"ot_timer"/"ot_counter", …}) during play: a new object without a cell. */
  addObject?(kind: string, attrs: Record<string, string>): void;
  /** wo:add({"ot_rubberband", …}) during play: anchor refs and the band's attributes. */
  addRubber?(a1: string | null, a2: string | null, strength: string | null, length: string | null, threshold: string | null, min: string | null, max: string | null): void;
  /** wo:add({"ot_wire", name?, anchor1, anchor2}) during play: two stones become fellows. */
  addWire?(a1: string | null, a2: string | null, name: string | null): void;
  /** PuzzleStone "get_cluster": refs of the stones of the fragment; adjacent: "get_adjacents" (all touching stones of its colour). */
  cluster?(ref: string, adjacent?: boolean): string[];
  /** wo:shuffleOxyd() during play. */
  shuffleOxyd?(): void;
  /** obj:sound(name, volume) during play: an Enigma sound event. */
  sound?(name: string, volume: number): void;
  /**
   * Instruction budget of an init known to end in a loop that waits for what its own world building
   * would have made (LevelLua.initSteps); reaching it ends the init without an error.
   */
  readonly initSteps?: number;
  /**
   * Names the world building gave that the init itself overwrote (LevelLua.initNames): during the
   * init no[…] also finds these cells (c:<l>:<x>:<y>), as Enigma's init did before overwriting them.
   */
  readonly initNames?: readonly { n: string; l: string; x: number; y: number }[];
  /** Importer: each named tile the world building wo(ti, default, map) lays (heard in init mode). */
  mapTile?(x: number, y: number, kind: string, name: string): void;
  /** Ref (a:<n>) of the actor that is PhysicsWorld marble `marble`, or null. */
  actorRef?(marble: number): string | null;
}

export type Fengari = typeof import('fengari');

/**
 * Lua 5.0 code of API 1 levels: a vararg function sees its arguments as the table arg
 * (Lua 5.1 LUA_COMPAT_VARARG). Declared on the function's own line, so line numbers stay.
 * (A backslash before another character than an escape letter loses it, as in Lua 5.1.)
 */
export function api1Source(code: string): string {
  return code
    // Lua 5.1 keeps an unknown escape's character ("\(" is "("), Lua 5.3 refuses it
    .replace(/\\([\s\S])/g, (m, c: string) => (/[abfnrtvxz0-9\\"'\r\n]/.test(c) ? m : c))
    .replace(/\bfunction\b[\w\s.:]*\(([^()]*\.\.\.)\s*\)/g, (m) => `${m} local arg = {n = select("#", ...), ...};`);
}

const ENDLESS = 'Murmel: Level-Init läuft endlos';
/** A name pattern with * and ? (Enigma's object names). */
const globRe = (p: string): RegExp => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);

export class LuaLevel {
  /** Do not log Lua errors (the importer runs many levels). */
  static quiet = false;
  /** Lua instructions the level script may run in its init. */
  static INIT_STEPS = 50_000_000;
  /** Last Lua error (also logged), for tests. */
  lastError = '';
  /** The level script's init has run (host.initNames no longer count). */
  private initDone = false;

  private readonly f: Fengari;
  private readonly L: object;

  private constructor(f: Fengari, L: object) {
    this.f = f;
    this.L = L;
  }

  /** Start the level script; init mode skips world building (the export already holds it). */
  /** f: the fengari module (fengari-web in the browser, fengari in Node); libs: library code (libpento) run before the level. */
  /** api1: Murmel's API 1 layer (api1.lua) for old levels (compatibility below 1.10), run after the shim. */
  static async create(code: string, host: LuaHost, shim: string, f: Fengari, libs: readonly string[] = [], api1?: string): Promise<LuaLevel> {
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
    // The init runs on the finished (exported) world: a level that loops until it finds something
    // its own world building would have changed never ends there. Stop it after INIT_STEPS instructions.
    // host.initSteps: the importer knows the level ends its init that way (its last call); stopping it is fine.
    let steps = 0;
    const budget = host.initSteps ?? LuaLevel.INIT_STEPS;
    lua.lua_sethook(L, (s) => {
      steps += 1000;
      if (steps > budget) lauxlib.luaL_error(s, to_luastring(ENDLESS));
    }, lua.LUA_MASKCOUNT, 1000);
    level.run(shim, '=enigma.lua');
    if (api1) level.run(api1, '=api1.lua');
    libs.forEach((lib, i) => level.run(lib, `=lib${i + 1}`));
    level.run(api1 ? api1Source(code) : code, '=level', host.initSteps !== undefined);
    lua.lua_sethook(L, null, 0, 0);
    level.initDone = true;
    level.callGlobal('__endinit', []);
    return level;
  }

  /** Call the level function `name` like Enigma's callback (value, sender). */
  callback(name: string, value: boolean | number, senderRef: string, valueRef?: string): void {
    this.callGlobal('__callback', valueRef ? [name, value, senderRef, valueRef] : [name, value, senderRef]);
  }

  /** Importer: whether a callback target names a Lua function ("check", "pento.next"). */
  isFunction(name: string): boolean {
    const { lua } = this.f;
    lua.lua_getglobal(this.L, this.str('__isfunction'));
    lua.lua_pushstring(this.L, this.str(name));
    if (lua.lua_pcall(this.L, 1, 1, 0) !== lua.LUA_OK) {
      this.fail();
      return false;
    }
    const r = lua.lua_toboolean(this.L, -1);
    lua.lua_pop(this.L, 1);
    return r;
  }

  /** Importer: report the declarations of ti[key] through host.add("tile:<kind>", attrs). */
  describeTile(key: string): void {
    this.callGlobal('__describetile', [key]);
  }

  private str(s: string): Uint8Array {
    return this.f.to_luastring(s);
  }

  /** endlessOk: the init stopped by the step budget is not an error. */
  private run(code: string, chunk: string, endlessOk = false): void {
    const { lua, lauxlib } = this.f;
    if (lauxlib.luaL_loadbuffer(this.L, this.str(code), null, this.str(chunk)) !== lua.LUA_OK || lua.lua_pcall(this.L, 0, 0, 0) !== lua.LUA_OK) {
      if (endlessOk && lua.lua_tojsstring(this.L, -1).endsWith(ENDLESS)) lua.lua_pop(this.L, 1);
      else this.fail();
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
        if (!this.initDone && host.initNames?.length) {
          const re = globRe(arg(1) ?? '');
          for (const c of host.initNames) if (re.test(c.n)) refs.push(`c:${c.l}:${c.x}:${c.y}`);
        }
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
      mapwanted: () => {
        push(host.mapTile !== undefined);
        return 1;
      },
      maptile: () => {
        host.mapTile?.(num(1), num(2), arg(3) ?? '', arg(4) ?? '');
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
      canaddactor: () => {
        push(!!host.addActor);
        return 1;
      },
      addactor: () => {
        const attrs: Record<string, string> = {};
        for (let i = 4; i + 1 <= lua.lua_gettop(L); i += 2) {
          const v = arg(i + 1);
          if (v !== null) attrs[arg(i) ?? ''] = v;
        }
        if (!host.addActor) throw new Error(`Murmel kann ${arg(3)} nicht setzen`);
        host.addActor(num(1), num(2), arg(3) ?? '', attrs);
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
      addobject: () => {
        const attrs: Record<string, string> = {};
        for (let i = 2; i + 1 <= lua.lua_gettop(L); i += 2) {
          const v = arg(i + 1);
          if (v !== null) attrs[arg(i) ?? ''] = v;
        }
        host.addObject?.(arg(1) ?? '', attrs);
        return 0;
      },
      addinventory: () => {
        host.addInventory?.(num(1), arg(2) ?? '', arg(3));
        return 0;
      },
      addwire: () => {
        host.addWire?.(arg(1), arg(2), arg(3));
        return 0;
      },
      addrubber: () => {
        host.addRubber?.(arg(1), arg(2), arg(3), arg(4), arg(5), arg(6), arg(7));
        return 0;
      },
      cluster: () => {
        const refs = host.cluster?.(arg(1) ?? '', lua.lua_toboolean(L, 2)) ?? [];
        lua.lua_createtable(L, refs.length, 0);
        refs.forEach((r, i) => {
          push(r);
          lua.lua_rawseti(L, -2, i + 1);
        });
        return 1;
      },
      shuffleoxyd: () => {
        host.shuffleOxyd?.();
        return 0;
      },
      sound: () => {
        host.sound?.(arg(1) ?? '', num(2));
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
