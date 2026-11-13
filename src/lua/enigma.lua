-- Murmel: a subset of Enigma's level Lua API 2 (Enigma 1.10+), on top of the bridge table __M.
-- Constants and semantics follow Enigma's data/api2init.lua and src/lua.cc
-- (Copyright Enigma authors, GPL 2 or later); see docs/SPEC.md, "Lua-Rückrufe".
--
-- The world itself comes from the engine export. The level script runs once in "init" mode
-- to define its functions and globals: world building (wo(...), wo[...] = ..., wo:add,
-- wo:shuffleOxyd, writes to objects) is skipped there, because the export already holds
-- its result. Callbacks later run with full access.

local M = __M
__M = nil

-- Level scripts may reuse global names (e.g. "type"): keep our own references.
local type, pairs, ipairs, tostring, tonumber = type, pairs, ipairs, tostring, tonumber
local setmetatable, getmetatable, rawget, rawset, error, select = setmetatable, getmetatable, rawget, rawset, error, select
local math, string, table = math, string, table

-- Lua 5.1 compatibility (Enigma uses 5.1, Murmel's interpreter is 5.3)
unpack = unpack or table.unpack
table.getn = table.getn or function(t) return #t end
math.mod = math.mod or math.fmod
math.pow = math.pow or function(a, b) return a ^ b end
loadstring = loadstring or load
string.gfind = string.gfind or string.gmatch

local INIT = true

local function unsupported(what)
  error("Murmel kennt " .. what .. " noch nicht", 3)
end

-------------------------------------------------------------------------------
-- positions and position lists
-------------------------------------------------------------------------------

local POS, POLIST, OBJ, GROUP, TILE = {}, {}, {}, {}, {}
POS.__name, POLIST.__name, OBJ.__name, GROUP.__name, TILE.__name = "position", "polist", "object", "group", "tile"

local function etype_of(v)
  local mt = getmetatable(v)
  return mt and mt.__name or type(v)
end

-- Lua 5.1 prints 8.0 as "8", Lua 5.3 as "8.0": keep whole coordinates integers, since
-- level scripts build names from them.
local function whole(v) return math.tointeger(v) or v end
local function newpos(x, y)
  return setmetatable({x = whole(x), y = whole(y)}, POS)
end

local function topos(v)
  local t = etype_of(v)
  if t == "position" then return v end
  if t == "object" then
    if not v._ref then return nil end
    return newpos(M.pos(v._ref))
  end
  if type(v) == "table" and type(v[1]) == "number" then return newpos(v[1], v[2]) end
  return nil
end

POS.__index = function(p, k)
  if k == 1 then return rawget(p, "x") end
  if k == 2 then return rawget(p, "y") end
  if k == "grid" then return newpos(math.floor(p.x), math.floor(p.y)) end
  return nil
end
local function haslist(a, b) return etype_of(a) == "polist" or etype_of(b) == "polist" end
POS.__add = function(a, b)
  if haslist(a, b) then return POLIST.__add(a, b) end
  local p, q = topos(a), topos(b)
  return newpos(p.x + q.x, p.y + q.y)
end
POS.__sub = function(a, b)
  if haslist(a, b) then return POLIST.__sub(a, b) end
  local p, q = topos(a), topos(b)
  return newpos(p.x - q.x, p.y - q.y)
end
POS.__unm = function(a) return newpos(-a.x, -a.y) end
POS.__mul = function(a, b)
  if type(a) == "number" then return newpos(a * b.x, a * b.y) end
  if type(b) == "number" then return newpos(b * a.x, b * a.y) end
  return a.x * b.x + a.y * b.y -- scalar product
end
POS.__div = function(a, b) return newpos(a.x / b, a.y / b) end
POS.__eq = function(a, b) return a.x == b.x and a.y == b.y end
POS.__len = function(a) return math.sqrt(a.x * a.x + a.y * a.y) end
POS.__tostring = function(a) return "po(" .. a.x .. ", " .. a.y .. ")" end

local function newpolist(list)
  return setmetatable(list, POLIST)
end
local function aspolist(v)
  local t = etype_of(v)
  if t == "polist" then return v end
  if t == "position" then return newpolist({v}) end
  if t == "group" then
    local l = {}
    for _, o in ipairs(v) do l[#l + 1] = topos(o) end
    return newpolist(l)
  end
  if t == "object" or (type(v) == "table" and type(v[1]) == "number") then return newpolist({topos(v)}) end
  error("keine Positionsliste: " .. t, 3)
end
POLIST.__concat = function(a, b)
  local l = {}
  for _, p in ipairs(aspolist(a)) do l[#l + 1] = p end
  for _, p in ipairs(aspolist(b)) do l[#l + 1] = p end
  return newpolist(l)
end
-- lua.cc addPositionsBase: a position list plus/minus one position (either side). As in
-- Enigma the result is offset + factor · p, so "list - pos" gives pos - p.
local function shiftlist(a, b, factor)
  local list, offset
  if etype_of(a) == "polist" then list, offset = a, topos(b) else list, offset = b, topos(a) end
  local l = {}
  for _, p in ipairs(list) do l[#l + 1] = newpos(offset.x + factor * p.x, offset.y + factor * p.y) end
  return newpolist(l)
end
POLIST.__add = function(a, b) return shiftlist(a, b, 1) end
POLIST.__sub = function(a, b) return shiftlist(a, b, -1) end
POLIST.__mul = function(a, b)
  if type(a) ~= "number" then a, b = b, a end
  local l = {}
  for _, p in ipairs(b) do l[#l + 1] = a * p end
  return newpolist(l)
end
POS.__concat = POLIST.__concat

function po(x, y)
  if type(x) == "number" then return newpos(x, y) end
  local t = etype_of(x)
  if t == "group" then return aspolist(x) end
  local p = topos(x)
  if p then return newpos(p.x, p.y) end
  if type(x) == "table" then
    local l = {}
    for _, v in ipairs(x) do l[#l + 1] = topos(v) end
    return newpolist(l)
  end
  error("po: unbekanntes Argument", 2)
end

-------------------------------------------------------------------------------
-- attribute values: the bridge transports strings
-------------------------------------------------------------------------------

DEFAULT = setmetatable({}, {__name = "default"})

local function decode(s)
  if s == nil then return nil end
  if s == "true" then return true end
  if s == "false" then return false end
  local n = tonumber(s)
  if n then return n end
  local x, y = string.match(s, "^(-?[%d.]+),(-?[%d.]+)$")
  if x then return newpos(tonumber(x), tonumber(y)) end
  return s
end

local function num(n)
  if n == math.floor(n) and math.abs(n) < 1e15 then return string.format("%d", n) end
  return tostring(n)
end

local function encode(v)
  if v == nil or v == DEFAULT then return nil end
  local t = etype_of(v)
  if t == "position" then return num(v.x) .. "," .. num(v.y) end
  if t == "object" then return v._ref and M.get(v._ref, "name") or nil end
  if t == "boolean" then return v and "true" or "false" end
  if t == "number" then return num(v) end
  if t == "string" then return v end
  error("Murmel kann den Wert " .. t .. " nicht speichern", 3)
end

-------------------------------------------------------------------------------
-- objects and groups
-------------------------------------------------------------------------------

local cache = setmetatable({}, {__mode = "v"})
local NULLOBJ = setmetatable({}, OBJ)

local function obj(ref)
  if ref == nil then return NULLOBJ end
  local o = cache[ref]
  if not o then
    o = setmetatable({_ref = ref}, OBJ)
    cache[ref] = o
  end
  return o
end

local function newgroup(list)
  return setmetatable(list, GROUP)
end

local function send(o, msg, value)
  if INIT or not o._ref then return nil end
  return decode(M.send(o._ref, msg, encode(value)))
end

local methods = {}
for _, m in ipairs({"open", "close", "toggle", "on", "off", "flip", "turn", "signal", "grow", "explode", "shovel"}) do
  methods[m] = function(self, value) return send(self, m, value) end
end
function methods.message(self, msg, value) return send(self, msg, value) end
-- OxydStone "peepall": in init mode a world flag the renderer reads (flavor e shows all colours)
function methods.peepall(self)
  if INIT then M.setworld("_PeepAll", "true") else return send(self, "peepall") end
end
function methods.exists(self) return self._ref ~= nil and M.exists(self._ref) end
-- Object:kind() and Object:is(kind) (KindDescriptor::isKind: the kind or a super kind, here by prefix)
function methods.kind(self)
  if not self._ref then return nil end
  return M.get(self._ref, "kind")
end
function methods.is(self, match)
  local k = methods.kind(self)
  if k == nil or type(match) ~= "string" then return false end
  return k == match or k:sub(1, #match + 1) == match .. "_"
end
function methods.kill(self)
  if INIT or not self._ref then return end
  M.kill(self._ref)
end
function methods.xy(self)
  local p = topos(self)
  return p.x, p.y
end

OBJ.__index = function(o, k)
  if methods[k] then return methods[k] end
  local ref = rawget(o, "_ref")
  if not ref then return nil end
  if k == "x" or k == "y" then return topos(o)[k] end
  return decode(M.get(ref, k))
end
OBJ.__newindex = function(o, k, v)
  if INIT or not o._ref then return end
  M.set(o._ref, k, encode(v))
end
OBJ.__eq = function(a, b) return a._ref == b._ref end
-- lua.cc addPositions: object + object/group joins groups, otherwise positions are added
local function objorgroup(v) return etype_of(v) == "object" or etype_of(v) == "group" end
OBJ.__add = function(a, b)
  if objorgroup(a) and objorgroup(b) then return GROUP.__add(a, b) end
  return POS.__add(a, b)
end
OBJ.__sub = function(a, b) return POS.__sub(a, b) end
OBJ.__concat = POLIST.__concat
OBJ.__tostring = function(o) return "object " .. tostring(o._ref) end

local function asgroup(v)
  if etype_of(v) == "group" then return v end
  if etype_of(v) == "object" then return newgroup(v._ref and {v} or {}) end
  return newgroup({})
end
GROUP.__add = function(a, b)
  local l, seen = {}, {}
  for _, g in ipairs({asgroup(a), asgroup(b)}) do
    for _, o in ipairs(g) do
      if not seen[o._ref] then
        seen[o._ref] = true
        l[#l + 1] = o
      end
    end
  end
  return newgroup(l)
end
GROUP.__sub = function(a, b)
  local drop, l = {}, {}
  for _, o in ipairs(asgroup(b)) do drop[o._ref] = true end
  for _, o in ipairs(asgroup(a)) do
    if not drop[o._ref] then l[#l + 1] = o end
  end
  return newgroup(l)
end
GROUP.__mul = function(a, b)
  local keep, l = {}, {}
  for _, o in ipairs(asgroup(b)) do keep[o._ref] = true end
  for _, o in ipairs(asgroup(a)) do
    if keep[o._ref] then l[#l + 1] = o end
  end
  return newgroup(l)
end
GROUP.__concat = POLIST.__concat
local gmethods = {}
for m in pairs(methods) do
  gmethods[m] = function(self, ...)
    for _, o in ipairs(self) do methods[m](o, ...) end
  end
end
function gmethods.exists(self) return #self > 0 end
function gmethods.sub(self, n)
  local l = {}
  if n >= 0 then
    for i = 1, math.min(n, #self) do l[#l + 1] = self[i] end
  else
    for i = math.max(1, #self + n + 1), #self do l[#l + 1] = self[i] end
  end
  return newgroup(l)
end
-- lua.cc nearestGroup: the member closest to the object; ties go to the one further south, then east
function gmethods.nearest(self, center)
  local c = topos(center)
  if not c then error("Error: reference object is no longer existing") end
  local best, bd
  for _, o in ipairs(self) do
    local p = topos(o)
    if p then
      local d = (p.x - c.x) ^ 2 + (p.y - c.y) ^ 2
      if not best or d < bd or (d == bd and (p.y > topos(best).y or (p.y == topos(best).y and p.x > topos(best).x))) then
        best, bd = o, d
      end
    end
  end
  return best
end
-- lua.cc shuffleGroup: Fisher-Yates
function gmethods.shuffle(self)
  local l = {table.unpack(self)}
  for i = #l, 2, -1 do
    local j = math.random(1, i)
    l[i], l[j] = l[j], l[i]
  end
  return newgroup(l)
end
-- lua.cc sortGroup: "circular" by angle around the centre, "linear" along a direction,
-- otherwise by name; equal keys keep only the last object (std::map), as in Enigma.
function gmethods.sort(self, mode, dir)
  local keyed, keys = {}, {}
  local function put(k, o)
    if keyed[k] == nil then keys[#keys + 1] = k end
    keyed[k] = o
  end
  if mode == "circular" then
    if #self == 0 then return newgroup({}) end
    local cx, cy = 0, 0
    for _, o in ipairs(self) do
      local p = topos(o)
      cx, cy = cx + p.x, cy + p.y
    end
    cx, cy = cx / #self, cy / #self
    for _, o in ipairs(self) do
      local p = topos(o)
      put(math.atan(p.y - cy, p.x - cx), o)
    end
  elseif mode == "linear" then
    local d = dir and topos(dir)
    if not d then
      if #self < 2 then return newgroup({table.unpack(self)}) end
      d = topos(self[2]) - topos(self[1])
    end
    local len = math.sqrt(d.x * d.x + d.y * d.y)
    local l = {}
    for i, o in ipairs(self) do
      local p = topos(o)
      l[i] = {(p.x * d.x + p.y * d.y) / len, i, o}
    end
    table.sort(l, function(a, b) return a[1] < b[1] or (a[1] == b[1] and a[2] < b[2]) end)
    local r = {}
    for i, e in ipairs(l) do r[i] = e[3] end
    return newgroup(r)
  else
    for _, o in ipairs(self) do put(tostring(o.name), o) end
  end
  table.sort(keys)
  local r = {}
  for i, k in ipairs(keys) do r[i] = keyed[k] end
  return newgroup(r)
end
-- lua.cc dispatchGroupReadAccess: g[-1] counts backwards, g[obj] is its index,
-- an unknown name sends that message to every member (groupDirectMessage).
GROUP.__index = function(g, k)
  if type(k) == "number" then
    -- (nil rather than a null object outside the group: ipairs in Lua 5.3 reads through __index)
    if k < 0 then return rawget(g, #g + 1 + k) end
    return nil
  end
  if type(k) == "string" then
    if gmethods[k] then return gmethods[k] end
    return function(self, value)
      for _, o in ipairs(self) do send(o, k, value) end
    end
  end
  if etype_of(k) == "object" then
    for i, o in ipairs(g) do
      if o._ref == k._ref then return i end
    end
  end
  return nil
end
-- for obj in group do … end (Lua 5.1 generic for calls the group as iterator)
GROUP.__call = function(g, _, prev)
  if prev == nil then return rawget(g, 1) end
  for i, o in ipairs(g) do
    if o == prev then return rawget(g, i + 1) end
  end
  return nil
end
GROUP.__newindex = function(g, k, v)
  if type(k) == "number" then return rawset(g, k, v) end
  for _, o in ipairs(g) do o[k] = v end
end

function grp(...)
  local args = {...}
  if #args == 1 and type(args[1]) == "table" and etype_of(args[1]) == "table" then args = args[1] end
  local l = {}
  for _, o in ipairs(args) do
    if etype_of(o) == "object" and o._ref then l[#l + 1] = o end
  end
  return newgroup(l) + newgroup({})
end

-- st/it/fl: the stone, item or floor at a position, of an object, or for each of a list
local function layer(name)
  return function(x, y)
    if type(x) == "number" then return obj(M.at(name, math.floor(x), math.floor(y))) end
    local t = etype_of(x)
    if t == "group" or t == "polist" or (t == "table" and type(x[1]) == "table") then
      local l = {}
      for _, v in ipairs(t == "group" and x or aspolist(t == "table" and po(x) or x)) do
        local p = topos(v)
        local o = obj(M.at(name, math.floor(p.x), math.floor(p.y)))
        if o._ref then l[#l + 1] = o end
      end
      return newgroup(l) + newgroup({})
    end
    local p = topos(x)
    if not p then return NULLOBJ end
    return obj(M.at(name, math.floor(p.x), math.floor(p.y)))
  end
end
st, it, fl = layer("st"), layer("it"), layer("fl")

-- no["name"]: named object; a pattern with * or ? gives a group
no = setmetatable({}, {
  __index = function(_, name)
    local refs = M.find(name)
    if string.find(name, "[%*%?]") then
      local l = {}
      for _, r in ipairs(refs) do l[#l + 1] = obj(r) end
      return newgroup(l)
    end
    return obj(refs[1])
  end,
  __newindex = function() unsupported("Zuweisungen an no[]") end,
})

-------------------------------------------------------------------------------
-- tiles and the world
-------------------------------------------------------------------------------

local function astile(v)
  local t = etype_of(v)
  if t == "tile" then return v end
  if t == "table" then return setmetatable({v}, TILE) end
  error("keine Kachel: " .. t, 3)
end
TILE.__concat = function(a, b)
  local l = {}
  for _, d in ipairs(astile(a)) do l[#l + 1] = d end
  for _, d in ipairs(astile(b)) do l[#l + 1] = d end
  return setmetatable(l, TILE)
end

ti = setmetatable({}, {
  __newindex = function(t, k, v) rawset(t, k, astile(v)) end,
  __call = function(_, v) return astile(v) end,
})

-- attributes of a declaration {kind, [name], key = value …} as key, value, key, value …
local function declargs(d)
  local args = {}
  local name = type(d[2]) == "string" and d[2] or d.name
  if name then
    args[#args + 1] = "name"
    args[#args + 1] = name
  end
  for k, v in pairs(d) do
    if type(k) == "string" and k ~= "name" then
      args[#args + 1] = k
      args[#args + 1] = encode(v)
    end
  end
  return args
end

local function settile(p, tile)
  local x, y = math.floor(p.x), math.floor(p.y)
  for _, d in ipairs(astile(tile)) do
    M.settile(x, y, d[1], table.unpack(declargs(d)))
  end
end

local wmethods = {}
-- wo:add({"ot_timer", …}): other objects are not in the export; in init mode the host records them
-- an object reference for the host: an object's ref or the first object of that name
local function refof(v)
  if type(v) == "table" then return v._ref end
  if type(v) == "string" then return (M.find(v) or {})[1] end
  return nil
end

function wmethods.add(_, a, b)
  if not INIT then
    -- during play: an item into a player's inventory, or a rubber band
    if type(a) == "number" and type(b) == "table" and type(b[1]) == "string" then
      local k = b[1]
      -- a pipe piece keeps its connections in the kind (it_pipe_ns …)
      if k == "it_pipe" and type(b.connections) == "string" and b.connections ~= "" then k = "it_pipe_" .. b.connections end
      M.addinventory(a, k)
      return
    end
    local d = b or a
    if type(d) == "table" and d[1] == "ot_rubberband" then
      M.addrubber(refof(d.anchor1), refof(d.anchor2), d.strength, d.length, d.threshold, d.min, d.max)
      return
    end
    unsupported("wo:add")
  end
  local d = b or a
  if type(d) == "table" and type(d[1]) == "string" then
    M.add(d[1], table.unpack(declargs(d)))
  end
end
for _, m in ipairs({"shuffleOxyd", "drawMap", "drawRect", "drawBorder", "world", "_register"}) do
  wmethods[m] = function()
    if not INIT then unsupported("wo:" .. m) end
  end
end

-- api2init.lua: random = math.random
random = math.random

wo = setmetatable({}, {
  __index = function(_, k)
    if wmethods[k] then return wmethods[k] end
    if k == "IsDifficult" then return true end
    return decode(M.world(k))
  end,
  __newindex = function(_, k, v)
    if type(k) == "string" then
      -- world attributes also count in init mode: the export does not hold them
      M.setworld(k, encode(v))
      return
    end
    if INIT then return end
    local t = etype_of(k)
    if t == "group" then
      for _, o in ipairs(k) do settile(topos(o), v) end
    elseif t == "polist" then
      for _, p in ipairs(k) do settile(p, v) end
    else
      local p = topos(k)
      if p then settile(p, v) end
    end
  end,
  __call = function(_, ...)
    if not INIT then unsupported("wo() während des Spiels") end
    return M.size()
  end,
})

-- resolvers only matter for world building, which the export already did
-- (res.maze, res.puzzle … as well: in init mode any resolver just passes its argument on)
res = setmetatable({}, {__index = function() return function(r) return r end end})

function cond(condition, iftrue, iffalse)
  if condition then return iftrue end
  return iffalse
end

function etype(v)
  if v == nil then return "nil" end
  local t = etype_of(v)
  if t == "object" then return v._ref and "object" or "nil" end
  return t
end

-------------------------------------------------------------------------------
-- constants (api2init.lua)
-------------------------------------------------------------------------------

OFF, ON, CLOSED, OPEN, IDLE, ACTIVE, INACTIVE, OXYDPAIR = 0, 1, 0, 1, 0, 1, 2, 2
LIGHT, MEDIUM, DARK, FLOODING, INVISIBLE, SMALL, LARGE = 0, 1, 2, 1, -1, 0, 2
YIN, YANG, EMPTY, FULL, BROKEN, BREAKING, CW, CCW = 0, 1, 0, 2, 1, 2, 0, 1
BLACK, WHITE, GLASS, BLUE, YELLOW, NOCOLOR = 0, 1, 2, 3, 4, nil
OXYD_BLUE, OXYD_RED, OXYD_GREEN, OXYD_YELLOW, OXYD_CYAN, OXYD_PURPLE = 0, 1, 2, 3, 4, 5
OXYD_WHITE, OXYD_BLACK, OXYD_GRAY, OXYD_ORANGE, OXYD_PINE, OXYD_BROWN = 6, 7, 8, 9, 10, 11
OXYD_AUTO, OXYD_FAKE, OXYD_QUAKE, OXYD_BOLD = -1, -2, -3, -4
RANDOMDIR, NODIR, WEST, SOUTH, EAST, NORTH = -2, -1, 0, 1, 2, 3
NORTHWEST, SOUTHWEST, SOUTHEAST, NORTHEAST = 4, 5, 6, 7
BACKSLASH, HORIZONTAL, SLASH, VERTICAL = 0, 1, 2, 3
ORIGIN, N, E, S, W = po(0, 0), po(0, -1), po(1, 0), po(0, 1), po(-1, 0)
NE, NW, SE, SW = N + E, N + W, S + E, S + W
NNE, ENE, ESE, SSE, SSW, WSW, WNW, NNW = N + NE, E + NE, E + SE, S + SE, S + SW, W + SW, W + NW, N + NW
NEIGHBORS_4 = W .. S .. E .. N
NEIGHBORS_8 = NEIGHBORS_4 .. NW .. SW .. SE .. NE
NEIGHBORS_CHESS = NNE .. ENE .. ESE .. SSE .. SSW .. WSW .. WNW .. NNW
ORI2DIR = {[WEST] = W, [SOUTH] = S, [EAST] = E, [NORTH] = N, [NODIR] = ORIGIN,
           [NORTHWEST] = NW, [SOUTHWEST] = SW, [SOUTHEAST] = SE, [NORTHEAST] = NE}
DISPENSABLE, INDISPENSABLE, PERKIND = 0, 1, 2
MEDITATION_CALDERA, MEDITATION_HOLLOW, MEDITATION_DENT = -3, -2, -1
MEDITATION_BUMP, MEDITATION_HILL, MEDITATION_VOLCANO = 1, 2, 3
AUTOLENGTH = -1
SUBSOIL_ABYSS, SUBSOIL_WATER, SUBSOIL_AUTO = 0, 1, 2
FOLLOW_NO, FOLLOW_SCROLL, FOLLOW_FLIP = 0, 1, 2
FOLLOW_FULLSCREEN, FOLLOW_HALFSCREEN = po(19, 12), po(9.5, 6)

-------------------------------------------------------------------------------
-- entry points for the host
-------------------------------------------------------------------------------

function __endinit()
  INIT = false
end

-- For the importer: the declarations of ti[key] (wo["FallenPuzzle"] = "=key" → enigma.settile)
function __describetile(key)
  local t = rawget(ti, key)
  if not t then return end
  for _, d in ipairs(t) do M.add("tile:" .. tostring(d[1]), table.unpack(declargs(d))) end
end

-- Object::performAction → lua::CallFunc(name, value, sender)
function __callback(name, value, ref)
  local f = _G[name]
  if type(f) ~= "function" then return end
  f(value, obj(ref))
end
