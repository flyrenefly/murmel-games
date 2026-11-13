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

local function newpo(x, y)
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
  error("po: unbekanntes Argument", 3)
end

-- lua.cc dispatchPositionsReadAccess / WriteAccess: po["name"] is a named position or the position
-- of a named object; a pattern with * or ? gives a position list. po["name"] = pos names a position.
local namedpos = {}
po = setmetatable({}, {
  __name = "positions",
  __call = function(_, x, y) return newpo(x, y) end,
  __index = function(_, name)
    if type(name) ~= "string" and type(name) ~= "number" then error("Positions: key is not a string", 2) end
    name = tostring(name)
    if string.find(name, "[%*%?]") then
      local l = {}
      local pat = "^" .. string.gsub(string.gsub(name, "[%^%$%(%)%%%.%[%]%+%-]", "%%%0"), "[%*%?]", {["*"] = ".*", ["?"] = "."}) .. "$"
      for k, p in pairs(namedpos) do
        if string.find(k, pat) then l[#l + 1] = newpos(p.x, p.y) end
      end
      for _, o in ipairs(no[name]) do l[#l + 1] = topos(o) end
      return newpolist(l)
    end
    local p = namedpos[name]
    if p then return newpos(p.x, p.y) end
    local o = no[name]
    if o._ref then return topos(o) end
    return nil
  end,
  __newindex = function(_, name, p)
    local q = topos(p)
    if not q then error("Position naming: value is not a position", 2) end
    namedpos[tostring(name)] = q
  end,
})

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
  -- a token list (target = {"door#*", "bridge#*"}, action = {"open", "close"}): comma separated
  if t == "table" and #v > 0 then
    local parts = {}
    for i = 1, #v do
      local e = encode(v[i])
      if type(e) ~= "string" or string.find(e, "[,;]") then error("Murmel kann den Wert table nicht speichern", 3) end
      parts[i] = e
    end
    return table.concat(parts, ",")
  end
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
for _, m in ipairs({"open", "close", "toggle", "on", "off", "flip", "turn", "turnback", "orientate", "signal", "grow", "explode", "shovel", "closeall", "shuffle"}) do
  methods[m] = function(self, value) return send(self, m, value) end
end
function methods.message(self, msg, value) return send(self, msg, value) end
-- OxydStone "peepall": in init mode a world flag the renderer reads (flavor e shows all colours)
function methods.peepall(self)
  if INIT then M.setworld("_PeepAll", "true") else return send(self, "peepall") end
end
function methods.exists(self) return self._ref ~= nil and M.exists(self._ref) end
-- Object:set({key = value, …}): several attributes at once
function methods.set(self, t)
  for k, v in pairs(t) do self[k] = v end
  return self
end
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
-- PuzzleStone "get_cluster": the stones of its fragment (joined by matching connections)
function methods.get_cluster(self)
  local l = {}
  if self._ref then
    for _, r in ipairs(M.cluster(self._ref)) do l[#l + 1] = obj(r) end
  end
  return newgroup(l)
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
-- lua.cc objectExistence: -obj is true when the object exists
OBJ.__unm = function(o) return o._ref ~= nil and M.exists(o._ref) end
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
-- lua.cc tileDeclaration: tile:_declaration() is a deep copy of its declarations
local function deepcopy(v)
  if type(v) ~= "table" then return v end
  local c = {}
  for k, x in pairs(v) do c[k] = deepcopy(x) end
  return c
end
TILE.__index = {
  _declaration = function(t)
    local l = {}
    for i, d in ipairs(t) do l[i] = deepcopy(d) end
    return l
  end,
}

ti = setmetatable({}, {
  __name = "tiles",
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
-- lua.cc evaluateKey: a resolver is the tile table (ti), a function (key, x, y) or a resolver
-- context {implementation, finalizer, subresolver, …} whose implementation gets this evaluator.
local function rawevaluate(resolver, key, x, y)
  if etype_of(resolver) == "tiles" then return rawget(resolver, key) end
  if type(resolver) == "function" then return resolver(key, x, y) end
  if type(resolver) == "table" and type(rawget(resolver, 1)) == "function" then
    return resolver[1](resolver, rawevaluate, key, x, y)
  end
  -- plain tables of tiles (some levels keep their own)
  if type(resolver) == "table" then return resolver[key] end
  error("Resolver mit falschem Typ", 3)
end
local function evaluate(resolver, key, x, y)
  local tile = rawevaluate(resolver, key, x or 0, y or 0)
  if tile == nil then error("Murmel kennt die Kachel '" .. tostring(key) .. "' nicht", 3) end
  return tile
end

-- api2init.lua drawMap: call the resolvers' finalizers from bottom to top
local function finalizeResolvers(context)
  if type(context) == "table" and etype_of(context) ~= "tiles" then
    finalizeResolvers(rawget(context, 3))
    local finalizer = rawget(context, 2)
    if type(finalizer) == "function" then finalizer(context) end
  end
end

-- api2init.lua drawMap during play (in init mode the export holds the world), with read directions
-- and maps from wo:newMap.
function wmethods.drawMap(_, resolver, anchor, arg3, arg4, arg5)
  if INIT then return end
  local origin = topos(anchor)
  local ignore, map, readdir
  if etype_of(arg3) == "map" then
    map, ignore, readdir = arg3, arg3.defaultkey, arg4 or MAP_IDENT
  else
    if type(arg3) ~= "string" or type(arg4) ~= "table" then unsupported("wo:drawMap mit dieser Karte") end
    ignore, map, readdir = arg3, arg4, arg5 or MAP_IDENT
  end
  if readdir == 0 then readdir = MAP_IDENT end
  local len = string.len(ignore)
  local w, h = 0, #map
  for y = 1, h do w = math.max(w, string.len(map[y]) // len) end
  local function rot(x, y)
    if readdir == MAP_IDENT then return x, y end
    if readdir == MAP_ROT_CW then return h + 1 - y, x end
    if readdir == MAP_ROT_180 then return w + 1 - x, h + 1 - y end
    if readdir == MAP_ROT_CCW then return y, w + 1 - x end
    if readdir == MAP_FLIP_HORIZONTAL then return w + 1 - x, y end
    if readdir == MAP_FLIP_VERTICAL then return x, h + 1 - y end
    if readdir == MAP_FLIP_SLASH then return y, x end
    if readdir == MAP_FLIP_BACKSLASH then return h + 1 - y, w + 1 - x end
    unsupported("diese Leserichtung")
  end
  for y = 1, h do
    local line = map[y]
    for x = 1, string.len(line) // len do
      local key = string.sub(line, len * (x - 1) + 1, len * x)
      if key ~= ignore then
        local rx, ry = rot(x, y)
        local px, py = origin.x - 1 + rx, origin.y - 1 + ry
        settile(newpos(px, py), evaluate(resolver, key, math.floor(px), math.floor(py)))
      end
    end
  end
  finalizeResolvers(resolver)
end

local function rectargs(arg1, arg2, arg3, arg4, arg5)
  local origin = topos(arg1)
  local dest, tile, resolver
  if type(arg2) == "number" then
    dest = newpos(origin.x + arg2 - 1, origin.y + arg3 - 1)
    tile, resolver = arg4, arg5
  else
    dest, tile, resolver = topos(arg2), arg3, arg4
  end
  if type(tile) == "string" then tile = evaluate(resolver, tile) end
  return origin, dest, tile
end

function wmethods.drawRect(_, ...)
  if INIT then return end
  local origin, dest, tile = rectargs(...)
  for y = origin.y, dest.y do
    for x = origin.x, dest.x do settile(newpos(x, y), tile) end
  end
end

function wmethods.drawBorder(_, ...)
  if INIT then return end
  local origin, dest, tile = rectargs(...)
  for x = origin.x, dest.x do
    settile(newpos(x, origin.y), tile)
    if origin.y ~= dest.y then settile(newpos(x, dest.y), tile) end
  end
  for y = origin.y + 1, dest.y - 1 do
    settile(newpos(origin.x, y), tile)
    if origin.x ~= dest.x then settile(newpos(dest.x, y), tile) end
  end
end

-- wo:fl(pos), wo:st(pos), wo:it(pos): the object of that layer at a position
function wmethods.fl(_, p) return fl(p) end
function wmethods.st(_, p) return st(p) end
function wmethods.it(_, p) return it(p) end

for _, m in ipairs({"world", "_register"}) do
  wmethods[m] = function()
    if not INIT then unsupported("wo:" .. m) end
  end
end
-- wo:shuffleOxyd() during play (Oxyd stones made by Lua get their colours here); in init mode
-- the export already holds the colours.
function wmethods.shuffleOxyd()
  if not INIT then M.shuffleoxyd() end
end

-------------------------------------------------------------------------------
-- maps (libmap subset: wo:newMap, map ^ transformation, transformation * transformation)
-------------------------------------------------------------------------------

local MAPTRANS = {__name = "maptransformation"}
MAP_IDENT = setmetatable({index = 1}, MAPTRANS)
MAP_ROT_CW = setmetatable({index = 2}, MAPTRANS)
MAP_ROT_180 = setmetatable({index = 3}, MAPTRANS)
MAP_ROT_CCW = setmetatable({index = 4}, MAPTRANS)
MAP_FLIP_BACKSLASH = setmetatable({index = 5}, MAPTRANS)
MAP_FLIP_HORIZONTAL = setmetatable({index = 6}, MAPTRANS)
MAP_FLIP_SLASH = setmetatable({index = 7}, MAPTRANS)
MAP_FLIP_VERTICAL = setmetatable({index = 8}, MAPTRANS)
MAP_COUNT = 8
MAP_ALL = {MAP_IDENT, MAP_ROT_CW, MAP_ROT_180, MAP_ROT_CCW, MAP_FLIP_BACKSLASH,
           MAP_FLIP_HORIZONTAL, MAP_FLIP_SLASH, MAP_FLIP_VERTICAL}
-- libmap transformation_compose / _power / _inverse
local COMPOSE = {{1, 2, 3, 4, 5, 6, 7, 8}, {2, 3, 4, 1, 6, 7, 8, 5}, {3, 4, 1, 2, 7, 8, 5, 6}, {4, 1, 2, 3, 8, 5, 6, 7},
                 {5, 8, 7, 6, 1, 4, 3, 2}, {6, 5, 8, 7, 2, 1, 4, 3}, {7, 6, 5, 8, 3, 2, 1, 4}, {8, 7, 6, 5, 4, 3, 2, 1}}
MAPTRANS.__mul = function(x, y) return MAP_ALL[COMPOSE[x.index][y.index]] end
MAPTRANS.__pow = function(x, y)
  if type(y) ~= "number" then return x * y end
  local r = MAP_IDENT
  for _ = 1, y % 4 do r = r * x end
  return r
end
MAPTRANS.__unm = function(x) return MAP_ALL[({1, 4, 3, 2, 5, 6, 7, 8})[x.index]] end

local MAP = {__name = "map"}
local function newmap(defaultkey, rows)
  local kl = string.len(defaultkey)
  local m, width, height = {}, 0, 0
  for k, line in pairs(rows) do
    if type(k) == "number" and k == math.floor(k) and k > 0 then
      height = math.max(height, k)
      if string.len(line) % kl ~= 0 then error("newMap: Line " .. k .. " doesn't fit to key length (" .. kl .. ").", 3) end
      width = math.max(width, string.len(line) // kl)
      m[k] = line
    end
  end
  for y = 1, height do
    m[y] = (m[y] or "")
    m[y] = m[y] .. string.rep(defaultkey, width - string.len(m[y]) // kl)
  end
  m.__width, m.__height, m.__defaultkey, m.__keylength = whole(width), whole(height), defaultkey, kl
  return setmetatable(m, MAP)
end
-- libmap get: map.width/height/defaultkey/keylength, map[y] the line, map[{x, y}] the key (0-based)
MAP.__index = function(m, k)
  if k == "width" or k == "height" or k == "defaultkey" or k == "keylength" then return rawget(m, "__" .. k) end
  local p = type(k) == "table" and topos(k)
  if p then
    local kl = rawget(m, "__keylength")
    local line = rawget(m, p.y + 1)
    if not line or p.x < 0 or p.x >= rawget(m, "__width") then return rawget(m, "__defaultkey") end
    return string.sub(line, p.x * kl + 1, (p.x + 1) * kl)
  end
  return nil
end
-- libmap transform: map ^ transformation
MAP.__pow = function(map, op)
  local w, h = map.width, map.height
  local function rot(x, y)
    if op == MAP_IDENT then return x, y end
    if op == MAP_ROT_CW then return y, h - 1 - x end
    if op == MAP_ROT_180 then return w - 1 - x, h - 1 - y end
    if op == MAP_ROT_CCW then return w - 1 - y, x end
    if op == MAP_FLIP_HORIZONTAL then return w - 1 - x, y end
    if op == MAP_FLIP_VERTICAL then return x, h - 1 - y end
    if op == MAP_FLIP_SLASH then return y, x end
    if op == MAP_FLIP_BACKSLASH then return w - 1 - y, h - 1 - x end
    error("keine Kartentransformation", 3)
  end
  local nw, nh = w, h
  if op == MAP_ROT_CW or op == MAP_ROT_CCW or op == MAP_FLIP_SLASH or op == MAP_FLIP_BACKSLASH then nw, nh = h, w end
  local result = {}
  for y = 1, nh do
    local line = ""
    for x = 1, nw do
      local rx, ry = rot(x - 1, y - 1)
      line = line .. map[{rx, ry}]
    end
    result[y] = line
  end
  return newmap(map.defaultkey, result)
end

function wmethods.newMap(_, defaultkey, arg1, arg2)
  if type(defaultkey) ~= "string" or defaultkey == "" then error("wo:newMap: default key", 2) end
  if type(arg1) == "table" and arg2 == nil then return newmap(defaultkey, arg1) end
  if type(arg1) == "number" and type(arg2) == "number" then
    local rows = {}
    for y = 1, arg2 do rows[y] = string.rep(defaultkey, arg1) end
    return newmap(defaultkey, rows)
  end
  if arg1 == nil and arg2 == nil then return newmap(defaultkey, {defaultkey}) end
  error("wo:newMap: Syntax error. Can't understand arguments.", 2)
end

-- libmath: lib.math.permutation(n) – the numbers 1..n in random order
lib = lib or {}
lib.math = lib.math or {}
function lib.math.permutation(n)
  local p = {}
  for i = 1, n do p[i] = i end
  for i = n, 2, -1 do
    local j = math.random(1, i)
    p[i], p[j] = p[j], p[i]
  end
  return p
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
  __call = function(_, resolver, ...)
    if not INIT then unsupported("wo() während des Spiels") end
    -- the export holds the world; the resolvers' finalizers still run (res.pento keeps its areas)
    finalizeResolvers(resolver)
    return M.size()
  end,
})

-- Resolvers only matter for world building, which the export already did: unknown ones
-- (res.maze, res.puzzle …) just pass their argument on. Real ones (api2init.lua): res.autotile,
-- and those of the libraries Murmel loads (libpento).
res = setmetatable({}, {__index = function() return function(r) return r end end})
res.metatable = {__name = "resolver", _type = "resolver", _resolver = true}

function is_resolver(resolver)
  local t = etype_of(resolver)
  return t == "tiles" or t == "function" or t == "resolver" or
    (type(resolver) == "table" and getmetatable(resolver) ~= nil and getmetatable(resolver)._resolver == true)
end

-- api2init.lua assert_bool / assert_type
function assert_bool(bool, message, level)
  if not bool then
    if type(message) == "string" and message ~= "" then error(message, (level or 1) + 1) end
    error("Anonymous assertion failed.", (level or 1) + 1)
  end
end

function assert_type(object, objname, level, ...)
  local conditions = {...}
  local t = etype(object)
  for _, c in ipairs(conditions) do
    if c == t
      or (c == "integer" and type(object) == "number" and math.ceil(object) == object)
      or (c == "positive" and type(object) == "number" and object > 0)
      or (c == "non-negative" and type(object) == "number" and object >= 0)
      or (c == "natural" and type(object) == "number" and math.ceil(object) == object and object >= 0)
      or (c == "positive integer" and type(object) == "number" and math.ceil(object) == object and object > 0)
      or (c == "non-empty string" and type(object) == "string" and object ~= "")
      or (c == "any table" and type(object) == "table")
      or (c == "valid object" and t == "object" and -object)
      or (c == "table" and t == "tile") then
      return
    end
  end
  error("Wrong type for " .. tostring(objname) .. ", is " .. t .. ".", (level or 1) + 1)
end

-- api2init.lua res.autotile: keys of a range or with a prefix get tiles made from a template,
-- "%%" in its strings replaced by the key's number or suffix.
function res.autotile_newtile(context, evaluator, key, x, y, template, substitution)
  local decl = template:_declaration()
  local result
  for _, tile in ipairs(decl) do
    local add
    if type(tile) == "string" then
      add = evaluator(context[3], (string.gsub(tile, "%%%%", substitution)), x, y)
    else
      local at = {}
      for k, val in pairs(tile) do
        if type(val) == "string" then
          at[k] = (string.gsub(val, "%%%%", "%%" .. substitution))
        elseif type(val) == "table" then
          local tt = {}
          for j, token in ipairs(val) do
            tt[j] = type(token) == "string" and (string.gsub(token, "%%%%", "%%" .. substitution)) or token
          end
          at[k] = tt
        else
          at[k] = val
        end
      end
      add = ti(at)
    end
    if result == nil then result = astile(add) else result = result .. add end
  end
  ti[key] = result
end

function res.autotile_implementation(context, evaluator, key, x, y)
  for _, rule in ipairs(context[4]) do
    if #rule >= 3 then
      local first = string.byte(rule[1], #rule[1])
      local last = string.byte(rule[2], #rule[2])
      local candidate = string.byte(key, #key)
      local offset = rule[4] or 1
      if #rule[1] == #key and string.sub(key, 1, -2) == string.sub(rule[1], 1, -2) and first <= candidate and candidate <= last then
        local tile = evaluator(context[3], key, x, y)
        if tile ~= nil then return tile end
        res.autotile_newtile(context, evaluator, key, x, y, ti[rule[3]], candidate - first + offset)
        return ti[key]
      end
    elseif string.find(key, rule[1], 1, true) == 1 then
      local tile = evaluator(context[3], key, x, y)
      if tile ~= nil then return tile end
      res.autotile_newtile(context, evaluator, key, x, y, ti[rule[2]], string.sub(key, #rule[1] + 1))
      return ti[key]
    end
  end
  return evaluator(context[3], key, x, y)
end

function res.autotile(subresolver, ...)
  assert_bool(is_resolver(subresolver), "res.autotile first argument (subresolver)", 2)
  local args = {...}
  for i, rule in ipairs(args) do
    assert_type(rule, "res.autotile argument " .. (i + 1), 2, "table")
    assert_bool(#rule >= 2 and #rule <= 4, "res.autotile rule " .. i .. " has wrong number of arguments (must be 2, 3, or 4).", 2)
    assert_bool(rawget(ti, rule[#rule >= 3 and 3 or 2]), "res.autotile: Missing template tile '" .. tostring(rule[#rule >= 3 and 3 or 2]) .. "'", 2)
  end
  return setmetatable({res.autotile_implementation, nil, subresolver, args}, res.metatable)
end

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
-- it_glasses spots (api2init.lua)
SPOT_NOTHING, SPOT_DEATH, SPOT_HOLLOW, SPOT_ACTORIMPULSE, SPOT_SENSOR, SPOT_LIGHTPASSENGER, SPOT_TRAP = 0, 1, 2, 4, 8, 16, 32
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
-- lua::CallFunc also resolves dotted names ("pento.next": a function in a table)
local function lookup(name)
  local v = _G
  for part in string.gmatch(name, "[^%.]+") do
    if type(v) ~= "table" then return nil end
    v = v[part]
  end
  return v
end

function __callback(name, value, ref)
  local f = lookup(name)
  if type(f) ~= "function" then return end
  f(value, obj(ref))
end

-- For the importer: whether a target names a Lua function after the init (also "pento.next")
function __isfunction(name)
  return type(lookup(name)) == "function"
end
