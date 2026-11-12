// Minimal typing for the parts of fengari (Lua 5.3 in JavaScript, MIT) that Murmel uses.
declare module 'fengari' {
  export type LuaState = object;
  export const lua: {
    LUA_OK: number;
    LUA_TNIL: number;
    LUA_TBOOLEAN: number;
    LUA_TNUMBER: number;
    LUA_TSTRING: number;
    LUA_TFUNCTION: number;
    lua_gettop(L: LuaState): number;
    lua_settop(L: LuaState, n: number): void;
    lua_type(L: LuaState, i: number): number;
    lua_tojsstring(L: LuaState, i: number): string;
    lua_tonumber(L: LuaState, i: number): number;
    lua_toboolean(L: LuaState, i: number): boolean;
    lua_pushnil(L: LuaState): void;
    lua_pushnumber(L: LuaState, n: number): void;
    lua_pushinteger(L: LuaState, n: number): void;
    lua_pushboolean(L: LuaState, b: boolean): void;
    lua_pushstring(L: LuaState, s: Uint8Array): void;
    lua_pushjsfunction(L: LuaState, f: (L: LuaState) => number): void;
    lua_createtable(L: LuaState, narr: number, nrec: number): void;
    lua_setfield(L: LuaState, i: number, k: Uint8Array): void;
    lua_rawseti(L: LuaState, i: number, n: number): void;
    lua_setglobal(L: LuaState, k: Uint8Array): void;
    lua_getglobal(L: LuaState, k: Uint8Array): number;
    lua_pcall(L: LuaState, nargs: number, nresults: number, errfunc: number): number;
    lua_pop(L: LuaState, n: number): void;
  };
  export const lauxlib: {
    luaL_newstate(): LuaState;
    luaL_loadbuffer(L: LuaState, code: Uint8Array, size: number | null, name: Uint8Array): number;
    luaL_requiref(L: LuaState, name: Uint8Array, open: (L: LuaState) => number, glb: number): void;
    luaL_error(L: LuaState, msg: Uint8Array): number;
  };
  export const lualib: Record<string, ((L: LuaState) => number) | string>;
  export function to_luastring(s: string): Uint8Array;
  export function to_jsstring(s: Uint8Array): string;
}

declare module 'fengari-web' {
  export * from 'fengari';
}
