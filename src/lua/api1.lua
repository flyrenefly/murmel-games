-- Murmel: Enigma's old level Lua API 1 (levels with compatibility below 1.10), on top of the
-- API 2 layer in enigma.lua. Names, defaults and the renaming table follow Enigma's
-- data/api1init.lua and data/compat.lua (Copyright Daniel Heck, Ronald Lamprecht and the
-- Enigma authors, GPL 2 or later); see docs/SPEC.md, "Lua-Rückrufe".
--
-- As for API 2 the world comes from the engine export: in init mode set_stone & co. only look
-- up the exported object at that cell (so the level may keep it), during play they place tiles.

local A = __api
__api = nil
local M, obj, NULLOBJ, encode, decode, topos, isinit = A.M, A.obj, A.NULLOBJ, A.encode, A.decode, A.topos, A.isinit
local OBJ = getmetatable(NULLOBJ)
local type, pairs, ipairs, tostring, tonumber, error = type, pairs, ipairs, tostring, tonumber, error
local setmetatable, getmetatable, rawget, rawset = setmetatable, getmetatable, rawget, rawset
local math, string, table = math, string, table
local st, it, fl, no = st, it, fl, no

local function unsupported(what)
  error("Murmel kennt " .. what .. " noch nicht", 3)
end

-------------------------------------------------------------------------------
-- compat.lua: Lua 4 globals
-------------------------------------------------------------------------------

function foreach(t, f)
  for k, v in pairs(t) do
    local r = f(k, v)
    if r ~= nil then return r end
  end
end
function foreachi(t, f)
  for i = 1, #t do
    local r = f(i, t[i])
    if r ~= nil then return r end
  end
end
getn, tinsert, tremove, sort = table.getn, table.insert, table.remove, table.sort
abs, ceil, floor, max, min, sqrt = math.abs, math.ceil, math.floor, math.max, math.min, math.sqrt
exp, log, deg, rad = math.exp, math.log, math.deg, math.rad
log10 = function(x) return math.log(x, 10) end
mod = math.fmod
PI = math.pi
acos = function(x) return math.deg(math.acos(x)) end
asin = function(x) return math.deg(math.asin(x)) end
atan = function(x) return math.deg(math.atan(x)) end
atan2 = function(x, y) return math.deg(math.atan(x, y)) end
cos = function(x) return math.cos(math.rad(x)) end
sin = function(x) return math.sin(math.rad(x)) end
tan = function(x) return math.tan(math.rad(x)) end
random = math.random
randomseed = function() end
strbyte, strchar, strfind, format, gsub = string.byte, string.char, string.find, string.format, string.gsub
strlen, strlower, strrep, strsub, strupper = string.len, string.lower, string.rep, string.sub, string.upper
getglobal = function(n) return _G[n] end
setglobal = function(n, v) _G[n] = v end
-- Enigma prints to its terminal (lib/ant warnings): not into the browser console
print = function() end

-------------------------------------------------------------------------------
-- kind names: api1init.lua RenamingObjectsNew2Old (new kind = old kind)
-------------------------------------------------------------------------------

local NEW2OLD = {
    ac_bug = "ac-bug",
    ac_horse = "ac-horse",
    ac_killer = "ac-killerball",
    ac_marble_black = "ac-blackball",
    ac_marble_white = "ac-whiteball",
    ac_pearl_white = "ac-whiteball-small",
    ac_rotor = "ac-rotor",
    ac_top = "ac-top",
    fl_abyss = "fl-abyss",
    fl_adhesionless = "fl-nomouse",
    fl_aquamarine = "fl-bluegreenx",
    fl_bast = "fl-floor_001",
    fl_bluegray = "fl-bluegray",
    fl_bluegreen = "fl-bluegreen",
    fl_blueslab = "fl-rough-blue",
    fl_brick = "fl-brick",
    fl_bridge = "fl-bridge",
    fl_bright = "fl-white",
    fl_concrete = "fl-concrete",
    fl_dark = "fl-black",
    fl_darkgray = "fl-darkgray",
    fl_dunes = "fl-dunes",
    fl_fake_abyss = "fl-abyss_fake",
    fl_fake_trigger = "fl-trigger",
    fl_gravel = "fl-gravel",
    fl_gray = "fl-gray",
    fl_hay = "fl-hay",
    fl_himalaya = "fl-himalaya",
    fl_ice = "fl-ice",
    fl_inverse_white = "fl-inverse",
    fl_inverse_gray = "fl-inverse2",
    fl_ivory = "fl-light",
    fl_lawn_a = "fl-leaves",
    fl_lawn_b = "fl-leavesb",
    fl_lawn_c1 = "fl-leavesc1",
    fl_lawn_c2 = "fl-leavesc2",
    fl_lawn_c3 = "fl-leavesc3",
    fl_lawn_c4 = "fl-leavesc4",
    fl_lawn_d1 = "fl-leavesd1",
    fl_lawn_d2 = "fl-leavesd2",
    fl_lawn_d3 = "fl-leavesd3",
    fl_lawn_d4 = "fl-leavesd4",
    fl_lawn_e1 = "fl-leavese1",
    fl_lawn_e2 = "fl-leavese2",
    fl_lawn_e3 = "fl-leavese3",
    fl_lawn_e4 = "fl-leavese4",
    fl_marble = "fl-marble",
    fl_metal = "fl-metal",
    fl_metal_1 = "fl-metal1",
    fl_metal_2 = "fl-metal2",
    fl_metal_3 = "fl-metal3",
    fl_metal_4 = "fl-metal4",
    fl_metal_5 = "fl-metal5",
    fl_metal_6 = "fl-metal6",
    fl_metal_7 = "fl-normal_x",
    fl_metal_7n = "fl-normal",
    fl_mortar = "fl-mortar",
    fl_pinkbumps = "fl-bumps",
    fl_plank = "fl-plank",
    fl_platinum = "fl-lightgray",
    fl_red = "fl-red",
    fl_redslab = "fl-rough-red",
    fl_rock = "fl-rock",
    fl_rough = "fl-rough",
    fl_sahara = "fl-sahara",
    fl_sand = "fl-sand",
    fl_samba = "fl-samba",
    fl_samba_h = "fl-samba1",
    fl_samba_v = "fl-samba2",
    fl_slope_ps = "fl-gradient1",
    fl_slope_pn = "fl-gradient2",
    fl_slope_pe = "fl-gradient3",
    fl_slope_pw = "fl-gradient4",
    fl_slope_ose = "fl-gradient5",
    fl_slope_osw = "fl-gradient6",
    fl_slope_one = "fl-gradient7",
    fl_slope_onw = "fl-gradient8",
    fl_slope_ise = "fl-gradient9",
    fl_slope_ine = "fl-gradient10",
    fl_slope_isw = "fl-gradient11",
    fl_slope_inw = "fl-gradient12",
    fl_slope_ts = "fl-gradient14",
    fl_slope_tn = "fl-gradient13",
    fl_slope_te = "fl-gradient16",
    fl_slope_tw = "fl-gradient15",
    fl_space = "fl-space",
    fl_stone = "fl-stone",
    fl_swamp = "fl-swamp",
    fl_thief = "fl-thief",
    fl_tigris = "fl-tigris",
    fl_water = "fl-water",
    fl_white = "fl-springboard",
    fl_wood = "fl-wood",
    fl_wood_h = "fl-wood1",
    fl_wood_v = "fl-wood2",
    fl_wood_framed = "fl-stwood",
    fl_wood_framed_h = "fl-stwood1",
    fl_wood_framed_v = "fl-stwood2",
    fl_woven = "fl-woven",
    fl_yinyang_yin_invisible = "fl-acblack",
    fl_yinyang_yang_invisible = "fl-acwhite",
    it_banana = "it-banana",
    it_bag = "it-bag",
    it_blocker = "it-blocker",
    it_blocker_new = "it-blocker-new",
    it_bomb_black = "it-blackbomb",
    it_bomb_white = "it-whitebomb",
    it_bottle_idle = "it-booze",
    it_bottle_broken = "it-booze-broken",
    it_brake = "it-brake",
    it_brush = "it-brush",
    it_burnable_invisible = "it-burnable",
    it_burnable_oil = "it-burnable_oil",
    it_burnable_ignited = "it-burnable_ignited",
    it_burnable_burning = "it-burnable_burning",
    it_burnable_ash = "it-burnable_ash",
    it_burnable_fireproof = "it-burnable_fireproof",
    it_cherry = "it-cherry",
    it_coffee = "it-coffee",
    it_coin_s = "it-coin1",
    it_coin_m = "it-coin2",
    it_coin_l = "it-coin4",
    it_crack_i = "it-crack0",
    it_crack_s = "it-crack1",
    it_crack_m = "it-crack2",
    it_crack_l = "it-crack3",
    it_cross = "it-cross",
    it_death = "it-death",
    it_document = "it-document",
    it_drop = "it-drop",
    it_dynamite = "it-dynamite",
    it_explosion_nil = "it-explosion1",
    it_explosion_hollow = "it-explosion2",
    it_explosion_debris = "it-explosion3",
    it_extinguisher_empty = "it-extinguisher_empty",
    it_extinguisher_medium = "it-extinguisher_medium",
    it_extinguisher_full = "it-extinguisher",
    it_extralife = "it-extralife",
    it_flag_black = "it-flagblack",
    it_flag_white = "it-flagwhite",
    it_floppy = "it-floppy",
    it_glasses = "it-glasses",
    it_glasses_broken = "it-glasses-broken",
    it_hammer = "it-hammer",
    it_landmine = "it-landmine",
    it_magicwand = "it-magicwand",
    it_magnet = "it-magnet",
    it_magnet_on = "it-magnet-on",
    it_magnet_off = "it-magnet-off",
    it_meditation_hollow = "it-hollow",
    it_meditation_dent = "it-tinyhollow",
    it_meditation_bump = "it-tinyhill",
    it_meditation_hill = "it-hill",
    it_odometer = "it-odometer",
    it_pencil = "it-pencil",
    it_pin = "it-pin",
    it_pipe_w = "it-pipe-w",
    it_pipe_s = "it-pipe-s",
    it_pipe_sw = "it-pipe-sw",
    it_pipe_e = "it-pipe-e",
    it_pipe_ew = "it-pipe-h",
    it_pipe_es = "it-pipe-es",
    it_pipe_n = "it-pipe-n",
    it_pipe_nw = "it-pipe-wn",
    it_pipe_ns = "it-pipe-v",
    it_pipe_ne = "it-pipe-ne",
    it_puller_w = "it-puller-w",
    it_puller_s = "it-puller-s",
    it_puller_e = "it-puller-e",
    it_puller_n = "it-puller-n",
    it_ring = "it-ring",
    it_rubberband = "it-rubberband",
    it_seed = "it-seed",
    it_seed_greenbrown = "it-seed_nowood",
    it_seed_volcano = "it-seed_volcano",
    it_spade = "it-spade",
    it_spoon = "it-spoon",
    it_spring_keep = "it-spring1",
    it_spring_drop = "it-spring2",
    it_springboard = "it-springboard",
    it_squashed = "it-squashed",
    it_shogun_s = "it-shogun-s",
    it_shogun_m = "it-shogun-m",
    it_shogun_l = "it-shogun-l",
    it_strip_ew = "it-hstrip",
    it_strip_ns = "it-vstrip",
    it_surprise = "it-surprise",
    it_sword = "it-sword",
    it_trap = "it-abyss",
    it_trigger = "it-trigger",
    it_umbrella = "it-umbrella",
    it_vortex = "it-vortex-open",
    it_vortex_open = "it-vortex-open",
    it_vortex_closed = "it-vortex-closed",
    it_weight = "it-weight",
    it_wormhole_on = "it-wormhole",
    it_wormhole_off = "it-wormhole-off",
    it_wrench = "it-wrench",
    it_yinyang = "it-yinyang",
    st_actorimpulse = "st-actorimpulse",
    st_actorimpulse_invisible = "st-actorimpulse_invisible",
    st_ancient = "st-rock9",
    st_beads = "st-beads",
    st_blocker = "st-blocker",
    st_blocker_new = "st-blocker-growing",
    st_bluegray = "st-bluegray",
    st_bluegray_hollow = "st-bluegray_hole",
    st_bluesand = "st-blue-sand",
    st_bluesand_w = "st-bigbluesand-w",
    st_bluesand_s = "st-bigbluesand-s",
    st_bluesand_sw = "st-bigbluesand-sw",
    st_bluesand_e = "st-bigbluesand-e",
    st_bluesand_ew = "st-bigbluesand-ew",
    st_bluesand_es = "st-bigbluesand-es",
    st_bluesand_esw = "st-bigbluesand-esw",
    st_bluesand_n = "st-bigbluesand-n",
    st_bluesand_nw = "st-bigbluesand-nw",
    st_bluesand_ns = "st-bigbluesand-ns",
    st_bluesand_nsw = "st-bigbluesand-nsw",
    st_bluesand_ne = "st-bigbluesand-ne",
    st_bluesand_new = "st-bigbluesand-new",
    st_bluesand_nes = "st-bigbluesand-nes",
    st_bluesand_nesw = "st-bigbluesand-nesw",
    st_blur_cross = "st-yinyang1",
    st_blur_magic = "st-yinyang3",
    st_blur_straight = "st-yinyang2",
    st_boulder = "st-bolder",
    st_boulder_n = "st-bolder-n",
    st_boulder_e = "st-bolder-e",
    st_boulder_s = "st-bolder-s",
    st_boulder_w = "st-bolder-w",
    st_box_hay = "st-flhay",
    st_box_rock = "st-flrock",
    st_box_wood = "st-wood",
    st_box_wood_growing = "st-wood-growing",
    st_box_wood_h = "st-wood1",
    st_box_wood_v = "st-wood2",
    st_brake = "st-brake",
    st_break_black = "st-break_acblack",
    st_break_boulder = "st-break_bolder",
    st_break_bug = "st-bug",
    st_break_laser = "st-laserbreak",
    st_break_oxydc = "st-stone_break",
    st_break_plain = "st-break_gray",
    st_break_white = "st-break_acwhite",
    st_brick = "st-brick",
    st_brick_w = "st-bigbrick-w",
    st_brick_s = "st-bigbrick-s",
    st_brick_sw = "st-bigbrick-sw",
    st_brick_e = "st-bigbrick-e",
    st_brick_ew = "st-bigbrick-ew",
    st_brick_es = "st-bigbrick-es",
    st_brick_esw = "st-bigbrick-esw",
    st_brick_n = "st-bigbrick-n",
    st_brick_nw = "st-bigbrick-nw",
    st_brick_ns = "st-bigbrick-ns",
    st_brick_nsw = "st-bigbrick-nsw",
    st_brick_ne = "st-bigbrick-ne",
    st_brick_new = "st-bigbrick-new",
    st_brick_nes = "st-bigbrick-nes",
    st_brick_nesw = "st-bigbrick-nesw",
    st_brownie = "st-brownie",
    st_brownmarble = "st-rock10",
    st_brownpyramid = "st-stone1",
    st_camouflage = "st-camouflage",
    st_camouflage_hollow = "st-camouflage_hole",
    st_camouflage_movable = "st-camouflage_move",
    st_chameleon = "st-chameleon",
    st_charge_minus = "st-chargeminus",
    st_charge_plus = "st-chargeplus",
    st_charge_zero = "st-chargezero",
    st_chess = "st-chess",
    st_chess_black = "st-chess_black",
    st_chess_white = "st-chess_white",
    st_coinslot = "st-coinslot",
    st_concrete = "st-rock8",
    st_dongle = "st-magic",
    st_darkglass = "st-glass2",
    st_darkglass_hollow = "st-glass2_hole",
    st_darkglass_movable = "st-glass2_move",
    st_darkgray = "st-rock2",
    st_darkgray_hollow = "st-rock2_hole",
    st_death = "st-death",
    st_death_invisible = "st-death_invisible",
    st_disco_light = "st-disco-light",
    st_disco_medium = "st-disco-medium",
    st_disco_dark = "st-disco-dark",
    st_dispenser_bombblack = "st-bombs",
    st_door_a = "st-door_a",
    st_door_b = "st-door_b",
    st_door_c = "st-door_c",
    st_fake_quake = "st-fakeoxyd",
    st_fake_oxyda = "st-likeoxyda",
    st_fake_oxydb = "st-likeoxydb",
    st_fake_oxydc = "st-likeoxydc",
    st_fake_oxydd = "st-likeoxydd",
    st_flash = "st-flash",
    st_flat = "st-plain",
    st_flat_breakable = "st-plain_break",
    st_flat_hollow = "st-plain_hole",
    st_flat_movable = "st-plain_move",
    st_flat_cracked = "st-plain_cracked",
    st_flat_burnable = "st-firebreak",
    st_flat_moveburnable = "st-firebreak_move",
    st_floppy = "st-floppy",
    st_fourswitch = "st-fourswitch",
    st_ghost_break = "st-break_invisible",
    st_ghost_greenbrown = "st-invisible_magic",
    st_ghost_purplemarble = "st-stonebrush",
    st_granite = "st-rock1",
    st_granite_hollow = "st-rock1_hole",
    st_granite_movable = "st-rock1_move",
    st_grate_cross = "st-grate1",
    st_grate_framed = "st-grate2",
    st_greenbrown = "st-greenbrown",
    st_greenbrown_hollow = "st-greenbrown_hole",
    st_greenbrown_movable = "st-greenbrown_move",
    st_greengray = "st-rock7",
    st_invisible = "st-invisible",
    st_invisible_hollow = "st-invisible_hole",
    st_invisible_movable = "st-invisible_move",
    st_jamb_black = "st-blackballs",
    st_jamb_white = "st-whiteballs",
    st_knight = "st-knight",
    st_laser_w = "st-laser-w",
    st_laser_s = "st-laser-s",
    st_laser_e = "st-laser-e",
    st_laser_n = "st-laser-n",
    st_laserswitch = "st-laserswitch",
    st_laserflop = "st-lasertimeswitch",
    st_lightglass = "st-glass1",
    st_lightglass_hollow = "st-glass1_hole",
    st_lightglass_movable = "st-glass1_move",
    st_lightpassenger = "st-lightpassenger",
    st_lightpassenger_off = "st-lightpassenger_off",
    st_magic_brick = "st-brick_magic",
    st_magic_oxyda = "st-fakeoxyda",
    st_magic_oxydc = "st-coffee",
    st_mail_w = "st-mail-w",
    st_mail_s = "st-mail-s",
    st_mail_e = "st-mail-e",
    st_mail_n = "st-mail-n",
    st_metal = "st-metal",
    st_metal_hollow = "st-metal_hole",

    st_mirror_slab_n = "st-mirror-p|",
    st_mirror_slab_e = "st-mirror-p/",
    st_mirror_slab_s = "st-mirror-p-",
    st_mirror_slab_w = "st-mirror-p\\",
    st_mirror_slab_nt = "st-mirror-p|t",
    st_mirror_slab_et = "st-mirror-p/t",
    st_mirror_slab_st = "st-mirror-p-t",
    st_mirror_slab_wt = "st-mirror-p\\t",
    st_mirror_slab_nm = "st-mirror-p|m",
    st_mirror_slab_em = "st-mirror-p/m",
    st_mirror_slab_sm = "st-mirror-p-m",
    st_mirror_slab_wm = "st-mirror-p\\m",
    st_mirror_slab_ntm = "st-mirror-p|tm",
    st_mirror_slab_etm = "st-mirror-p/tm",
    st_mirror_slab_stm = "st-mirror-p-tm",
    st_mirror_slab_wtm = "st-mirror-p\\tm",
    st_mirror_triangle_n = "st-mirror-3^",
    st_mirror_triangle_e = "st-mirror-3>",
    st_mirror_triangle_s = "st-mirror-3v",
    st_mirror_triangle_w = "st-mirror-3<",
    st_mirror_triangle_nt = "st-mirror-3^t",
    st_mirror_triangle_et = "st-mirror-3>t",
    st_mirror_triangle_st = "st-mirror-3vt",
    st_mirror_triangle_wt = "st-mirror-3<t",
    st_mirror_triangle_nm = "st-mirror-3^m",
    st_mirror_triangle_em = "st-mirror-3>m",
    st_mirror_triangle_sm = "st-mirror-3vm",
    st_mirror_triangle_wm = "st-mirror-3<m",
    st_mirror_triangle_ntm = "st-mirror-3^tm",
    st_mirror_triangle_etm = "st-mirror-3>tm",
    st_mirror_triangle_stm = "st-mirror-3vtm",
    st_mirror_triangle_wtm = "st-mirror-3<tm",

    st_monoflop = "st-timeswitch",
    st_oxyd = "st-oxyd",
    st_oneway = "st-oneway",
    st_oneway_n = "st-oneway-n",
    st_oneway_e = "st-oneway-e",
    st_oneway_s = "st-oneway-s",
    st_oneway_w = "st-oneway-w",
    st_oneway_black = "st-oneway_black",
    st_oneway_black_n = "st-oneway_black-n",
    st_oneway_black_e = "st-oneway_black-e",
    st_oneway_black_s = "st-oneway_black-s",
    st_oneway_black_w = "st-oneway_black-w",
    st_oneway_white = "st-oneway_white",
    st_oneway_white_n = "st-oneway_white-n",
    st_oneway_white_e = "st-oneway_white-e",
    st_oneway_white_s = "st-oneway_white-s",
    st_oneway_white_w = "st-oneway_white-w",
    st_panel = "st-wood_001",
    st_polarswitch = "st-polarswitch",
    st_passage_black_square = "st-black1",
    st_passage_black_slash = "st-black2",
    st_passage_black_cross = "st-black3",
    st_passage_black_frame = "st-black4",
    st_passage_white_square = "st-white1",
    st_passage_white_slash = "st-white2",
    st_passage_white_cross = "st-white3",
    st_passage_white_frame = "st-white4",
    st_pinkbumps = "st-bumps",
    st_plaster = "st-rock3",
    st_plaster_hollow = "st-rock3_hole",
    st_plaster_movable = "st-rock3_move",
    st_plaster_breakable = "st-rock3_break",
    st_plaster_movebreakable = "st-rock3_movebreak",
    st_plop = "st-block",
    st_portal_horse = "st-grate3",
    st_pull = "st-pull",
    st_purplegray = "st-rock6",
    st_purplemarble = "st-rock4",

    st_puzzle = "st-puzzle",
    st_puzzle_blue_w = "st-puzzle-w",
    st_puzzle_blue_s = "st-puzzle-s",
    st_puzzle_blue_sw = "st-puzzle-sw",
    st_puzzle_blue_e = "st-puzzle-e",
    st_puzzle_blue_ew = "st-puzzle-ew",
    st_puzzle_blue_es = "st-puzzle-es",
    st_puzzle_blue_esw = "st-puzzle-esw",
    st_puzzle_blue_n = "st-puzzle-n",
    st_puzzle_blue_nw = "st-puzzle-nw",
    st_puzzle_blue_ns = "st-puzzle-ns",
    st_puzzle_blue_nsw = "st-puzzle-nsw",
    st_puzzle_blue_ne = "st-puzzle-ne",
    st_puzzle_blue_new = "st-puzzle-new",
    st_puzzle_blue_nes = "st-puzzle-nes",
    st_puzzle_blue_nesw = "st-puzzle-nesw",
    st_puzzle_blue_nesw_hollow = "st-puzzle-hollow",
    st_puzzle_yellow_w = "st-puzzle2-w",
    st_puzzle_yellow_s = "st-puzzle2-s",
    st_puzzle_yellow_sw = "st-puzzle2-sw",
    st_puzzle_yellow_e = "st-puzzle2-e",
    st_puzzle_yellow_ew = "st-puzzle2-ew",
    st_puzzle_yellow_es = "st-puzzle2-es",
    st_puzzle_yellow_esw = "st-puzzle2-esw",
    st_puzzle_yellow_n = "st-puzzle2-n",
    st_puzzle_yellow_nw = "st-puzzle2-nw",
    st_puzzle_yellow_ns = "st-puzzle2-ns",
    st_puzzle_yellow_nsw = "st-puzzle2-nsw",
    st_puzzle_yellow_ne = "st-puzzle2-ne",
    st_puzzle_yellow_new = "st-puzzle2-new",
    st_puzzle_yellow_nes = "st-puzzle2-nes",
    st_puzzle_yellow_nesw = "st-puzzle2-nesw",
    st_puzzle_yellow_nesw_hollow = "st-puzzle2-hollow",
    st_quake = "st-fart",
    st_rawglass = "st-glass",
    st_rawglass_movable = "st-glass_move",
    st_redbrown = "st-marble",
    st_redbrown_hollow = "st-marble_hole",
    st_redbrown_movable = "st-marble_move",
    st_redfiber = "st-glass3",
    st_redmarble = "st-stone2",
    st_redrock = "st-redrock",
    st_rotator_cw = "st-rotator-right",
    st_rotator_ccw = "st-rotator-left",
    st_rotator_cw_movable = "st-rotator_move-right",
    st_rotator_ccw_movable = "st-rotator_move-left",
    st_rubberband = "st-rubberband",
    st_scissors = "st-scissors",
    st_shogun = "st-shogun",
    st_shogun_s = "st-shogun-s",
    st_shogun_m = "st-shogun-m",
    st_shogun_sm = "st-shogun-sm",
    st_shogun_l = "st-shogun-l",
    st_shogun_sl = "st-shogun-sl",
    st_shogun_ml = "st-shogun-ml",
    st_shogun_sml = "st-shogun-sml",
    st_spitter = "st-spitter",
    st_stoneimpulse = "st-stoneimpulse",
    st_stoneimpulse_hollow = "st-stoneimpulse-hollow",
    st_stoneimpulse_movable = "st-stoneimpulse_movable",
    st_surprise = "st-surprise",
    st_swap = "st-swap",
    st_switch = "st-switch",
    st_switch_black = "st-switch_black",
    st_switch_white = "st-switch_white",
    st_thief = "st-thief",
    st_tigris = "st-rock5",
    st_timer = "st-timer",
    st_turnstile_red = "st-turnstile",
    st_turnstile_green = "st-turnstile-green",
    st_turnstilearm_n = "st-turnstile-n",
    st_turnstilearm_e = "st-turnstile-e",
    st_turnstilearm_s = "st-turnstile-s",
    st_turnstilearm_w = "st-turnstile-w",
    st_volcano = "st-volcano",
    st_volcano_new = "st-volcano-growing",
    st_volcano_active = "st-volcano_active",
    st_volcano_idle = "st-volcano_inactive",
    st_window = "st-window",
    st_woven = "st-woven",
    st_yellow = "st-yellow"
}
local OLD2NEW = {}
for k, v in pairs(NEW2OLD) do OLD2NEW[v] = k end

-- api1init.lua enigma.MakeObject: old kinds with their own new kind and attributes
local SPECIAL = {
  ["ac-whiteball-small"] = {"ac_pearl_white"},
  ["fl-gradient"] = {"fl_slope_ps"},
  ["fl-bridge-open"] = {"fl_bridge"},
  ["fl-bridge-closed"] = {"fl_bridge", state = 0},
  ["fl-rough_medium"] = {"fl_rough", friction = 5.0, adhesion = 1.2},
  ["fl-rough_slow"] = {"fl_rough", friction = 7.0, adhesion = 0.5},
  ["st-key"] = {"st_key", code = 0},
  ["st-key_a"] = {"st_key", code = 1},
  ["st-key_b"] = {"st_key", code = 2},
  ["st-key_c"] = {"st_key", code = 3},
  ["st-switch"] = {"st_switch", instant = true},
  ["st-switch_black"] = {"st_switch_black", instant = true},
  ["st-switch_white"] = {"st_switch_white", instant = true},
  ["it-key"] = {"it_key", code = 1},
  ["it-key_a"] = {"it_key", code = 1},
  ["it-key_b"] = {"it_key", code = 2},
  ["it-key_c"] = {"it_key", code = 3},
  ["it-sensor"] = {"it_sensor", invisible = true},
  ["it-inversesensor"] = {"it_sensor", invisible = true, inverse = true},
  ["it-wormhole"] = {"it_wormhole_on", scissor = false},
  ["it-wormhole-off"] = {"it_wormhole_off", scissor = false},
  ["it-vortex-open"] = {"it_vortex_open", scissor = false},
  ["it-vortex-closed"] = {"it_vortex_closed", scissor = false, autoclose = true},
  ["st-pmirror"] = {"st_mirror_slab_e"},
  ["st-3mirror"] = {"st_mirror_triangle_s"},
  ["st-scissors"] = {"st_scissors", inverse = true},
  ["st-door"] = {"st_door_d", faces = "ns"},
  ["st-door-h"] = {"st_door_d", faces = "ns"},
  ["st-door-h-open"] = {"st_door_d", faces = "ns", state = 1},
  ["st-door-v"] = {"st_door_d", faces = "ew"},
  ["st-door-v-open"] = {"st_door_d", faces = "ew", state = 1},
  ["st-likeoxyda-open"] = {"st_fake_oxyda", state = 1},
  ["st-likeoxydb-open"] = {"st_fake_oxydb", state = 1},
  ["st-likeoxydc-open"] = {"st_fake_oxydc", state = 1},
  ["st-likeoxydd-open"] = {"st_fake_oxydd", state = 1},
  ["st-spitter"] = {"st_spitter", secure = true},
  ["st-laser"] = {"st_laser_e"},
}

-- the old name of a new kind (api1init.lua enigma.GetKind)
local function oldkind(kind, ref)
  if kind == nil then return nil end
  local function attr(k) return decode(M.get(ref, k)) end
  if kind == "st_key" then
    return ({[1] = "st-key_a", [2] = "st-key_b", [3] = "st-key_c"})[attr("code")] or "st-key"
  end
  if kind == "it_key" then
    return ({[2] = "it-key_b", [3] = "it-key_c"})[attr("code")] or "it-key_a"
  end
  if kind == "it_sensor" then return attr("inverse") and "it-inversesensor" or "it-sensor" end
  if string.sub(kind, 1, 7) == "st_door" then
    local f = string.match(kind, "^st_door_(%a)$")
    if f == nil or f == "d" then return "st-door" end
    return "st-door_" .. f
  end
  if string.sub(kind, 1, 9) == "st_puzzle" then return "st-puzzle" end
  if string.sub(kind, 1, 8) == "st_laser" then return "st-laser" end
  if string.sub(kind, 1, 9) == "st_mirror" then return "st-mirror" end
  if string.sub(kind, 1, 8) == "fl_slope" then return "fl-gradient" end
  local k = kind
  while k do
    if NEW2OLD[k] then return NEW2OLD[k] end
    k = string.match(k, "^(.+)_[^_]*$")
  end
  return kind
end

-------------------------------------------------------------------------------
-- objects: made (MakeObject) but not yet placed, or placed (an API 2 object)
-------------------------------------------------------------------------------

local NEW = {__name = "object"}

local function makeobject(name)
  local s = SPECIAL[name]
  local kind = s and s[1] or OLD2NEW[name]
  if kind == nil then error("Unknown object kind '" .. tostring(name) .. "' in api 1.", 3) end
  local attrs = {}
  if s then
    for k, v in pairs(s) do
      if type(k) == "string" then attrs[k] = v end
    end
  end
  return setmetatable({_kind = kind, _old = name, _attrs = attrs}, NEW)
end

local function kindof(o)
  if type(o) ~= "table" then return nil end
  if getmetatable(o) == NEW then return o._old end
  local ref = rawget(o, "_ref")
  if not ref then return nil end
  return oldkind(M.get(ref, "kind"), ref)
end

-- api1init.lua enigma.SetAttrib: old attribute names and values
local CONNECTIONS = {"", "w", "s", "sw", "e", "ew", "es", "esw", "n", "nw", "ns", "nsw", "ne", "new", "nes", "nesw"}
local RENAMED = {keycode = "code", delay = "interval", dir = "orientation", direction = "orientation", on = "state",
  value = "coin_value", load = "state", force = "strength", friction_factor = "friction", gradient_factor = "gradient",
  minlength = "threshold", hit_factor = "hit_strength", mousefactor = "adhesion", mouseforce = "adhesion",
  blinking = "state", player = "owner"}
local FLAGS = {invisible = true, loop = true, scissor = true, static = true, transparent = true, movable = true,
  burnable = true, eternal = true, fastfire = true, ignitable = true, initfire = true, noash = true, secure = true,
  attacknearest = true, gohome = true}
local SLOPES = {"ps", "pn", "pe", "pw", "ose", "osw", "one", "onw", "ise", "ine", "isw", "inw", "twr", "twl", "tel", "ter",
  "tnl", "tnr", "tsr", "tsl", "ts", "tn", "te", "tw"}

-- the new key and value (key nil: nothing to set); a new fl-gradient changes its kind
local function translate(o, kind, key, val)
  if kind == "st-oxyd" and key == "color" then return "oxydcolor", tonumber(val) end
  if key == "connections" and type(val) == "number" then
    if val == 1 and kind == "st-puzzle" then
      if getmetatable(o) == NEW then o._attrs.connections = "nesw" end
      return "hollow", true
    end
    return key, CONNECTIONS[val]
  end
  if key == "oxyd" then return "color", val == 0 and 2 or 3 end
  if key == "target" and kind == "it-rubberband" then return "anchor2", val end
  if FLAGS[key] then return key, val == 1 or val == true end
  if key == "orientation" and kind == "st-mirror" then return key, (6 - val) % 4 end
  if key == "type" and kind == "st-door" then return "faces", val == "h" and "ns" or "ew" end
  if key == "type" and kind == "fl-bridge" then return "flavor", val == "x" and "bw" or val == "y" and "bn" or "gc" end
  if key == "type" and kind and string.sub(kind, 1, 11) == "fl-gradient" then
    local shape = SLOPES[val]
    if shape and getmetatable(o) == NEW then
      o._kind = "fl_slope_" .. shape
      return nil
    end
    unsupported("fl-gradient type " .. tostring(val))
  end
  if key == "fixed" then
    if val == 1 then return "fragility", 0.0 end
    return nil
  end
  if key == "essential" then
    if val == -1 then return key, 1 elseif val == 1 then return key, 2 end
    return key, val
  end
  if key == "targetx" or key == "targety" or string.match(key, "^target[1-4]$") then
    if isinit() then return nil end
    -- an object made during play (set_item("it-wormhole", x, y, {targetx=…, targety=…})):
    -- place() joins both into its destination "x,y"
    if getmetatable(o) == NEW and (key == "targetx" or key == "targety") then return "_" .. key, tonumber(val) or 0 end
    unsupported("das Attribut " .. key)
  end
  return RENAMED[key] or key, val
end

local function setattrib(o, key, val)
  if type(o) ~= "table" then return end
  local k, v = translate(o, kindof(o), key, val)
  if k == nil then return end
  if getmetatable(o) == NEW then
    o._attrs[k] = v
  else
    o[k] = v
  end
end

local function getattrib(o, key)
  if type(o) ~= "table" then return nil end
  local kind = kindof(o)
  local k = RENAMED[key] or key
  if key == "blackball" or key == "whiteball" then k = "color" end
  if kind == "st-oxyd" and key == "color" then k = "oxydcolor" end
  if key == "target" and kind == "it-rubberband" then k = "anchor2" end
  if getmetatable(o) == NEW then return o._attrs[k] end
  return o[k]
end

-- enigma.SetFloor/SetItem/SetStone: the new object becomes the object at that cell
-- (in init mode the one the export holds)
local function place(layer, x, y, o)
  if type(o) ~= "table" or getmetatable(o) ~= NEW then error("Murmel: kein neues Objekt zum Setzen", 3) end
  -- lua.cc en_set_floor: lua_tonumber, so a missing coordinate is 0
  x, y = math.floor(tonumber(x) or 0), math.floor(tonumber(y) or 0)
  if not isinit() then
    -- API 1 targetx/targety (wormholes): the destination as "x,y", like the export writes it
    local tx, ty = o._attrs._targetx, o._attrs._targety
    if tx ~= nil or ty ~= nil then
      o._attrs._targetx, o._attrs._targety = nil, nil
      o._attrs.dest = encode(tx or 0) .. "," .. encode(ty or 0)
    end
    local args = {}
    if o._attrs.name ~= nil then args[1], args[2] = "name", tostring(o._attrs.name) end
    for k, v in pairs(o._attrs) do
      if k ~= "name" then
        args[#args + 1] = k
        args[#args + 1] = encode(v)
      end
    end
    M.settile(x, y, o._kind, table.unpack(args))
  end
  local ref = M.at(layer, x, y)
  o._kind, o._old, o._attrs = nil, nil, nil
  setmetatable(o, OBJ)
  rawset(o, "_ref", ref)
  return o
end

local function orNil(o)
  if o == nil or rawget(o, "_ref") == nil then return nil end
  return o
end

-------------------------------------------------------------------------------
-- the enigma table (lua.cc levelfuncs)
-------------------------------------------------------------------------------

-- enigma.ConserveLevel = FALSE …: the life rules Murmel reads from the world
local WORLDKEYS = {ConserveLevel = true, ProvideExtralifes = true, InfiniteReincarnation = true}
local E = {}
enigma = setmetatable(E, {
  __newindex = function(t, k, v)
    if WORLDKEYS[k] then M.setworld(k, (v == true or v == 1) and "true" or "false") end
    rawset(t, k, v)
  end,
})
E.NODIR, E.WEST, E.SOUTH, E.EAST, E.NORTH = -1, 0, 1, 2, 3
E.random = math.random
E.MakeObject = makeobject
E.GetKind = kindof
E.GetClass = function(o)
  local ref = type(o) == "table" and rawget(o, "_ref")
  return ref and M.get(ref, "kind") or nil
end
E.SetAttrib = setattrib
E.GetAttrib = getattrib
E.NameObject = function(o, name) setattrib(o, "name", name) end
E.GetNamedObject = function(name) return orNil(no[name]) end
E.GetFloor = function(x, y) return orNil(fl(x, y)) end
E.GetItem = function(x, y) return orNil(it(x, y)) end
E.GetStone = function(x, y) return orNil(st(x, y)) end
E.GetPos = function(o)
  local p = topos(o)
  if not p then return nil end
  return p.x, p.y
end
E.IsSameObject = function(a, b) return a == b end
E.SetFloor = function(x, y, o) return place("fl", x, y, o) end
E.SetItem = function(x, y, o) return place("it", x, y, o) end
E.SetStone = function(x, y, o) return place("st", x, y, o) end
E.KillStone = function(x, y) st(x, y):kill() end
E.KillItem = function(x, y) it(x, y):kill() end
E.SetActor = function()
  if not isinit() then unsupported("enigma.SetActor während des Spiels") end
  return NULLOBJ
end
E.AddRubberBand = function(a, b, strength, length, minlen)
  if isinit() then return end
  local function ref(v) return type(v) == "table" and rawget(v, "_ref") or nil end
  M.addrubber(ref(a), ref(b), encode(strength), encode(length), encode(minlen), nil, nil)
end
E.AddConstantForce = function(x, y) M.setworld("GlobalForce", encode(x) .. "," .. encode(y)) end
E.GetTicks = function() return 0 end
E.IsSolved = function() return false end
E.EmitSound = function() end
E.LoadLib = function() unsupported("enigma.LoadLib") end
-- world building only: the export holds the result (signals, scrambles, the oxyd shuffle)
for _, f in ipairs({"AddSignal", "AddScramble", "SetScrambleIntensity", "SetCompatibility"}) do
  E[f] = function()
    if not isinit() then unsupported("enigma." .. f .. " während des Spiels") end
  end
end
-- GetObjectTemplate("st-oxyd") only receives "shuffle" and "closeall" (oxyd_shuffle)
local TEMPLATE = setmetatable({}, {__name = "object"})
E.GetObjectTemplate = function() return TEMPLATE end
E.SendMessage = function(o, msg, arg)
  if o == TEMPLATE then
    if not isinit() then unsupported("SendMessage " .. tostring(msg) .. " an alle Oxyd-Steine") end
    return
  end
  if type(o) ~= "table" or rawget(o, "_ref") == nil then return end
  return o:message(msg, arg)
end

world = {Resize = function() end}
display = setmetatable({}, {__index = function() return function() end end})

-------------------------------------------------------------------------------
-- api1init.lua: the level functions
-------------------------------------------------------------------------------

TRUE, FALSE = 1, 0
difficult = true
-- lua.cc InitLevel: options.Difficulty (DIFFICULTY_HARD = 2, as difficult above)
options = {Difficulty = 2}
level_width, level_height = 0, 0
oxyd_default_flavor = "b"
oxyd_count, oxyd_current_color, oxyd_max_color = 0, 0, 8
DefaultAttribs = {}

function CreateWorld(w, h)
  if not isinit() then unsupported("create_world während des Spiels") end
  oxyd_default_flavor = "b"
  oxyd_count, oxyd_current_color = 0, 0
  DefaultAttribs = {}
  level_width, level_height = w, h
end
function SetDefaultAttribs(name, attribs)
  local list = DefaultAttribs[name]
  if list then
    for k, v in pairs(attribs) do list[k] = v end
  else
    DefaultAttribs[name] = attribs
  end
end
function SetAttrib(o, key, val) setattrib(o, key, val) end
GetAttrib = getattrib
GetKind = kindof
function set_attribs(o, attrs)
  if not attrs then return end
  if type(attrs) ~= "table" then error("Can't assign attributes, expected table but got " .. type(attrs) .. ".", 2) end
  for k, v in pairs(attrs) do setattrib(o, k, v) end
end
function MakeObject(name, attrs)
  local o = makeobject(name)
  local a = DefaultAttribs[name]
  if a then set_attribs(o, a) end
  set_attribs(o, attrs)
  return o
end
function set_floor(name, x, y, attrs) return place("fl", x, y, MakeObject(name, attrs)) end
function set_item(name, x, y, attrs) return place("it", x, y, MakeObject(name, attrs)) end
function set_stone(name, x, y, attrs) return place("st", x, y, MakeObject(name, attrs)) end
kill_stone = E.KillStone
kill_item = E.KillItem
function SendMessage(target, msg, arg)
  if type(target) == "string" then target = E.GetNamedObject(target) end
  return E.SendMessage(target, msg, arg)
end
function SetAttribs(target, attribs)
  if type(target) == "string" then target = E.GetNamedObject(target) end
  set_attribs(target, attribs)
end
function AddRubberBand(a, b, strength, length, minlen)
  E.AddRubberBand(a, b, strength or 10, length or 2, minlen or 0)
end
function fill_floor(name, x0, y0, w, h)
  x0, y0, w, h = x0 or 0, y0 or 0, w or level_width, h or level_height
  for y = y0, y0 + h - 1 do
    for x = x0, x0 + w - 1 do set_floor(name, x, y) end
  end
end
function fill_items(name, x0, y0, w, h)
  for y = y0, y0 + h - 1 do
    for x = x0, x0 + w - 1 do set_item(name, x, y) end
  end
end
function fill_stones(name, x0, y0, w, h)
  for y = y0, y0 + h - 1 do
    for x = x0, x0 + w - 1 do set_stone(name, x, y) end
  end
end
local function drawline(set)
  return function(name, xy0, xystep, n, attrs)
    local x, y = xy0[1], xy0[2]
    for _ = 1, n do
      set(name, x, y, attrs)
      x, y = x + xystep[1], y + xystep[2]
    end
  end
end
draw_floor, draw_items, draw_stones = drawline(set_floor), drawline(set_item), drawline(set_stone)
function draw_checkerboard_floor(name1, name2, x, y, w, h, attrs)
  x, y, w, h = x or 0, y or 0, w or level_width, h or level_height
  for i = 1, h do
    for j = 1, w do
      set_floor(math.fmod(i, 2) == math.fmod(j, 2) and name1 or name2, x + j - 1, y + i - 1, attrs)
    end
  end
end
function draw_border(name, x0, y0, w, h)
  x0, y0, w, h = x0 or 0, y0 or 0, w or level_width, h or level_height
  draw_stones(name, {x0, y0}, {1, 0}, w)
  draw_stones(name, {x0, y0 + h - 1}, {1, 0}, w)
  draw_stones(name, {x0, y0}, {0, 1}, h)
  draw_stones(name, {x0 + w - 1, y0}, {0, 1}, h)
end
function set_stones(name, poslist, attrs)
  for _, xy in pairs(poslist) do set_stone(name, xy[1], xy[2], attrs) end
end
function SetActor(name, x, y, attrs) return E.SetActor(x, y, MakeObject(name, attrs)) end
function fakeoxyd(x, y) return set_stone("st-fakeoxyd", x, y) end
function oxyd(x, y, flavor, color)
  local o = set_stone("st-oxyd", x, y, {flavor = flavor or oxyd_default_flavor, color = "" .. (color or oxyd_current_color)})
  if not color then
    oxyd_current_color = (oxyd_current_color + oxyd_count) % oxyd_max_color
    oxyd_count = (oxyd_count + 1) % 2
  end
  return o
end
-- during play (Pentomino I: Oxyd stones made by the script) like wo:shuffleOxyd()
function oxyd_shuffle()
  if isinit() then return E.SendMessage(TEMPLATE, "shuffle") end
  wo:shuffleOxyd()
end
function oxyd_closeall() E.SendMessage(TEMPLATE, "closeall") end
function oneway(x, y, orient) return set_stone("st-oneway", x, y, {orientation = orient}) end
function laser(x, y, is_on, dir) return set_stone("st-laser", x, y, {on = is_on, dir = dir}) end
function mirrorp(x, y, movable, transp, orient)
  return set_stone("st-pmirror", x, y, {movable = movable, transparent = transp, orientation = orient})
end
function mirror3(x, y, movable, transp, orient)
  return set_stone("st-3mirror", x, y, {movable = movable, transparent = transp, orientation = orient})
end
-- PUZ_0000 = 1 (hollow) … PUZ_1111 = 16 (nesw): the bits are n, e, s, w
for i = 0, 15 do
  local bits = ""
  for b = 3, 0, -1 do bits = bits .. ((i >> b) & 1) end
  _G["PUZ_" .. bits] = i + 1
end
function puzzle(x, y, conn) return set_stone("st-puzzle", x, y, {connections = conn}) end
function puzzle2(x, y, conn) return set_stone("st-puzzle", x, y, {connections = conn, oxyd = 1}) end
function bigbrick(x, y, conn) return set_stone("st-bigbrick-n", x, y, {connections = conn}) end
function switch(x, y, target, action) return set_stone("st-switch", x, y, {target = target, action = action}) end
function abyss(x, y) set_floor("fl-abyss", x, y) end
function hollow(x, y) set_item("it-hollow", x, y) end
function Document(x, y, t) set_item("it-document", x, y, {text = t}) end
function hammer(x, y) set_item("it-hammer", x, y) end
function dynamite(x, y) set_item("it-dynamite", x, y) end
function bomb(x, y) set_item("it-blackbomb", x, y) end
function keya(x, y) set_item("it-key", x, y, {keycode = 1.0}) end
function keyb(x, y) set_item("it-key", x, y, {keycode = 2.0}) end
function keyc(x, y) set_item("it-key", x, y, {keycode = 3.0}) end
function shogundot1(x, y, attrs) set_item("it-shogun-s", x, y, attrs) end
function shogundot2(x, y, attrs) set_item("it-shogun-m", x, y, attrs) end
function shogundot3(x, y, attrs) set_item("it-shogun-l", x, y, attrs) end
function Wormhole(x, y, targetx, targety, attribs)
  local attrs = attribs or {}
  attrs.targetx, attrs.targety = targetx, targety
  set_item("it-wormhole", x, y, attrs)
end
function Doorh(x, y, attrs)
  attrs = attrs or {}
  attrs.type = "h"
  return set_stone("st-door", x, y, attrs)
end
function Doorv(x, y, attrs)
  attrs = attrs or {}
  attrs.type = "v"
  return set_stone("st-door", x, y, attrs)
end
SLOPE_S, SLOPE_N, SLOPE_E, SLOPE_W = 1, 2, 3, 4
SLOPE_LARGE_SE, SLOPE_LARGE_SW, SLOPE_LARGE_NE, SLOPE_LARGE_NW = 5, 6, 7, 8
SLOPE_SMALL_SE, SLOPE_SMALL_NE, SLOPE_SMALL_SW, SLOPE_SMALL_NW = 9, 10, 11, 12
SLOPE_S_FORCE_W, SLOPE_N_FORCE_W, SLOPE_S_FORCE_E, SLOPE_N_FORCE_E = 13, 14, 15, 16
SLOPE_E_FORCE_N, SLOPE_W_FORCE_N, SLOPE_E_FORCE_S, SLOPE_W_FORCE_S = 17, 18, 19, 20
FLAT_FORCE_S, FLAT_FORCE_N, FLAT_FORCE_E, FLAT_FORCE_W = 21, 22, 23, 24
function Gradient(x, y, t)
  if t == nil then error("Illegal gradient type", 2) end
  if t >= 1 and t <= 24 then return set_floor("fl-gradient", x, y, {type = t}) end
  error("Unknown gradient type '" .. t .. "'", 2)
end
Signal = function(...) return E.AddSignal(...) end
SetItem = set_item
create_world = CreateWorld
get_attrib = GetAttrib
get_kind = GetKind
set_attrib = SetAttrib
make_object = MakeObject
set_actor = SetActor
document = Document
doorh, doorv = Doorh, Doorv
gradient = Gradient
wormhole = Wormhole
