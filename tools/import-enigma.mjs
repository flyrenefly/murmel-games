// Converts Enigma levels into Murmel level packs.
//
// Input: the JSON world export of the Enigma fork (flyrenefly/enigma-web,
// branch level-export: every level loaded by the real engine) plus Enigma's
// level XML files for metadata and licence.
// Output: public/levels/enigma/index.json, one JSON file per pack, the
// required graphics in public/enigma/<set>/ and tools/import-report.md.
//
// Usage: node tools/import-enigma.mjs <exportDir> <enigma>/data

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { allTileKinds, api1Kind, levelLibs, libFunctions, luaCode, luaFunctions, luaInit, luaProblems, RUNTIME_WORLD, runtimeKinds } from './lua-check.mjs';

const [exportDir, enigmaData] = process.argv.slice(2);
if (!exportDir || !enigmaData) {
  console.error('usage: import-enigma.mjs <exportDir> <enigma>/data');
  process.exit(1);
}
const levelsDir = join(enigmaData, 'levels');
const OUT = 'public/levels/enigma';
const GFX_SETS = ['gfx32', 'gfx32-retro'];

// Packs that recreate the original Dongleware levels, or are not meant for play.
const EXCLUDED_PACKS = /^(enigma_oxyd|enigma_oxydextra|enigma_oxydmagnum|enigma_peroxyd|enigma_esprit|enigma_experimental|enigma_demolevels|tutorial_old|lib)$/;

// What the Murmel engine can do so far.
const STONES = new Set([
  'st_granite', 'st_darkgray', 'st_purplemarble', 'st_tigris', 'st_purplegray', 'st_greengray',
  'st_concrete', 'st_ancient', 'st_brownmarble', 'st_redmarble', 'st_bluegray', 'st_pinkbumps',
  'st_camouflage', 'st_redbrown', 'st_metal', 'st_redrock', 'st_woven', 'st_yellow',
  'st_greenbrown', 'st_brownpyramid', 'st_bluesand', 'st_brick', 'st_rawglass', 'st_panel',
  'st_plaster', 'st_flat', 'st_beads',
  // GlassStone: block every actor (only invisible ones pass light/dark glass – Murmel has none)
  'st_redfiber', 'st_lightglass', 'st_darkglass',
]);
// Variants that only differ in edges/decoration: drawn with the base image.
const STONE_BASE = /^(st_(?:bluesand|brick|panel|rawglass))(_[nesw]+|_quad)?$/;
const FAKE_OXYD = /^st_fake_oxyd([abcde])$/;
const OXYD = /^st_oxyd(_([abcde]))?$/;
/** SlopeFloor.cc: shape → slope direction (xforce/yforce index; -1 = none). */
const SLOPE_DIR = { '': -1, pw: 0, ps: 1, pe: 2, pn: 3, inw: 4, isw: 5, ise: 6, ine: 7, onw: 4, osw: 5, ose: 6, one: 7, tw: 0, ts: 1, te: 2, tn: 3, twl: 4, tsl: 5, tel: 6, tnl: 7, twr: 5, tsr: 6, ter: 7, tnr: 4 };
const SLOPE_X = [-1, 0, 1, 0, -1, -1, 1, 1];
const SLOPE_Y = [0, 1, 0, -1, -1, 1, 1, -1];

/** Floor::add_force: force_x/force_y, or for slopes direction (normalised) × strength (SlopeForce 25). */
function floorForce(fl, slopeForce) {
  const fx = Number(fl.force_x) || 0;
  const fy = Number(fl.force_y) || 0;
  if (fx !== 0 || fy !== 0) return [fx, fy];
  const m = /^fl_slope(?:_(\w+))?$/.exec(fl.k);
  if (!m) return null;
  const dir = fl.slope !== undefined && fl.slope !== '' ? Number(fl.slope) : SLOPE_DIR[m[1] ?? ''];
  if (!(dir >= 0 && dir < 8)) return null;
  const s = fl.strength !== undefined && fl.strength !== '' ? Number(fl.strength) : slopeForce;
  const n = Math.hypot(SLOPE_X[dir], SLOPE_Y[dir]);
  const r = (v) => Math.round(v * 1000) / 1000;
  return [r((SLOPE_X[dir] / n) * s), r((SLOPE_Y[dir] / n) * s)];
}

const SPECIAL_FLOORS = /^fl_(ice_heating|swamp_heating)/;
/** ForwardFloor: base floor per flavor (models-2d.lua backgrounds) – the conveyor is an object fl_forward. */
const FORWARD_BASE = { darkgray: 'fl_darkgray', platinum: 'fl_platinum', rough: 'fl_rough', bright: 'fl_bright', bridgewood: 'fl_bridge_bw_closed' };
const FORWARD = /^fl_forward(?:_(darkgray|platinum|rough|bright|bridgewood))?(?:_([nesw]))?$/;
const DEADLY = new Set(['fl_abyss', 'fl_water']);

// Interactive objects (src/game/objects.ts): kind patterns and the images they need.
/** Fire: burnable items, extinguisher, transformed floors, heating animations. */
const FIRE_IMAGES = ['it_burnable_oil', 'it_burnable_ignite', 'it_burnable_burning', 'it_burnable_ash', 'it_burnable_fireproof', 'it_extinguisher', 'fl_abyss', 'fl_dunes', 'fl_swamp', 'fl_water', 'fl_ice_heating', 'fl_water_heating', 'fl_swamp_heating', 'it_crack_abyss', 'it_crack_water'];

const OBJECTS = [
  [/^st_door(_[abcd])?(_ew)?(_open)?$/, ['st_oxyda', 'st_grate_cross', 'sh_grate_cross', 'st_grate_framed', 'sh_grate_framed', 'st_flat', 'st_door_b', 'st_door_d_ns', 'st_door_d_ew', 'sh_doorh', 'sh_doorv', 'sh_round', 'sh_solid']],
  [/^st_switch(_black|_white)?(_instant)?$/, ['st_switch', 'st_switch_black', 'st_switch_white', 'sh_round']],
  [/^it_trigger$/, ['it_trigger']],
  [/^it_document$/, ['it_document']],
  [/^st_grate(_cross|_framed)?$/, ['st_grate_cross', 'sh_grate_cross', 'st_grate_framed', 'sh_grate_framed']],
  [/^st_timer$/, ['st_timer', 'sh_round']],
  [/^st_(fake_)?quake$/, ['st_quake', 'st_oxydb', 'sh_round']],
  [/^st_death(_invisible|_movable)?$/, ['st_death', 'sh_round']],
  [/^it_wormhole(_on|_off)?$/, ['it_wormhole']],
  [/^it_seed(_wood)?$/, ['it_seed', 'st_box_wood', 'st_box_wood_growing', 'sh_round', 'fl_wood_framed']],
  [/^it_seed_hay$/, ['it_seed', 'st_box_hay', 'sh_round', 'fl_hay']],
  [/^it_seed_greenbrown$/, ['it_seed', 'st_greenbrown', 'sh_round']],
  [/^(it_seed_volcano|st_volcano(_idle|_active|_new|_growing)?)$/, ['it_seed', 'st_volcano_growing', 'st_quake', 'st_quake_break', 'st_flat', 'sh_round', 'sh_solid']],
  [/^(it_meditation(_(caldera|hollow|dent|bump|hill|volcano))?|it_landmine)$/, [...['caldera', 'hollow', 'dent', 'bump', 'hill', 'volcano'].map((s) => `it_meditation_${s}`), 'it_landmine', 'it_explosion']],
  [/^st_stoneimpulse(_hollow|_movable|_steady)?$/, ['st_stoneimpulse', 'st_stoneimpulse_hollow', 'sh_stoneimpulse_hollow', 'sh_round']],
  [/^st_puzzle(_blue|_yellow)?$/, ['st_puzzle_blue', 'st_puzzle_yellow', 'st_puzzle_blue_hollow', 'st_puzzle_yellow_hollow', 'sh_solid', 'sh_puzzle_hollow', 'it_explosion']],
  [/^st_oneway(_black|_white)?(_[nesw])?$/, ['st_oneway']],
  // plain stones pushed like a box (src/game/objects.ts MOVABLE_STONE, movableLook)
  [/^it_magicwand$/, ['it_magicwand']],
  [/^it_extralife$/, ['it_extralife']],
  [/^it_yinyang$/, ['it_yinyang']],
  [/^it_ring$/, ['it_ring']],
  [/^it_spoon$/, ['it_spoon']],
  [/^it_wrench$/, ['it_wrench']],
  [/^it_hammer$/, ['it_hammer']],
  [/^it_floppy$/, ['it_floppy']],
  [/^it_sword$/, ['it_sword']],
  [/^st_polarswitch$/, ['st_lightglass', 'st_darkglass', 'sh_rawglass']],
  [/^st_(monoflop|laserflop|laserflop_on)$/, ['st_monoflop', 'sh_round']],
  [/^st_mail(_[nesw])?$/, ['st_mail', 'sh_solid']],
  [/^st_charge(_plus|_minus|_zero)?$/, ['st_charge_plus', 'st_charge_minus', 'st_charge_zero', 'sh_rounded']],
  [/^(st|it)_brake$/, ['st_brake', 'sh_brake', 'it_explosion']],
  [/^it_pipe(_[nesw]{1,2})?$/, ['it_pipe']],
  [/^it_bag$/, ['it_bag']],
  [/^it_surprise$/, ['it_surprise', 'it_umbrella', 'it_spring', 'it_dynamite', 'it_dynamite_burning', 'it_explosion', 'it_coffee', 'it_hammer']],
  [/^st_portal(_horse|_pearl)?$/, ['st_portal_horse', 'sh_portal_horse']],
  [/^st_scissors$/, ['st_scissors', 'sh_round', 'st_break_plain']],
  [/^st_(document|pebble)$/, ['st_document', 'st_pebble', 'sh_round', 'st_break_plain']],
  [/^st_rubberband$/, ['st_rubberband', 'sh_round']],
  [/^st_flash$/, ['st_flash', 'sh_solid']],
  [/^st_magic(_brick|_oxyda|_oxydc)?$/, ['st_brick', 'st_oxyda', 'st_oxydc', 'sh_solid', 'st_rawglass', 'st_lightglass', 'sh_rawglass']],
  [/^st_ghost(_purplemarble|_greenbrown|_break)?$/, ['st_purplemarble', 'st_greenbrown', 'st_break_oxydc', 'st_flat_break', 'sh_solid', 'sh_round']],
  [/^st_disco(_light|_medium|_dark)?$/, ['st_disco']],
  [/^st_barrier$/, ['st_barrier', 'sh_solid']],
  [/^it_(coffee|coffee_drop)$/, ['it_coffee']],
  [/^it_(spade|brush|cherry|banana|cross|squashed)$/, ['it_spade', 'it_brush', 'it_cherry', 'it_banana', 'it_cross', 'it_squashed']],
  [/^it_pin$/, ['it_pin']],
  [/^it_weight$/, ['it_weight']],
  [/^it_trap$/, ['it_trap']],
  [/^it_explosion(_nil|_hollow|_crack|_debris)?$/, ['it_explosion', 'it_meditation_hollow', 'it_crack_water', 'it_crack_abyss']],
  [/^fl_ref$/, []],
  [/^st_ref$/, []],
  [/^st_jamb(_black|_white)?$/, ['st_jamb_black', 'st_jamb_white', 'sh_jamb']],
  [/^st_yinyang(_instant|_active|_inactive)?$/, ['st_yinyang', 'st_yinyang_inactive', 'sh_round']],
  [/^st_spitter$/, ['st_spitter_idle', 'st_spitter_loading', 'st_spitter_spitting', 'st_spitter_breaking', 'sh_round', 'ac_marble_black_jump', 'sh_marble_jump', 'it_explosion', 'it_crack_abyss', 'it_crack_water', 'it_meditation_hollow']],
  [/^st_surprise$/, ['st_surprise', 'sh_solid', 'st_grate_cross', 'sh_grate_cross', 'st_death', 'sh_round', 'st_lightglass', 'sh_rawglass', 'st_knight', 'st_bluegray', 'thief_template', 'st_thief_capture', 'it_bag', 'st_flat', 'st_flat_break', 'st_puzzle_yellow', 'sh_puzzle_hollow']],
  [/^it_pencil$/, ['it_pencil', 'it_cross', 'it_crack_water']],
  [/^it_rubberband$/, ['it_rubberband']],
  [/^it_drop$/, ['it_drop', 'ac_rotor', 'sh_rotor']],
  [/^it_glasses(_broken)?$/, ['it_glasses', 'it_glasses_broken', 'st_death']],
  [/^it_bottle(_idle|_broken)?$/, ['it_bottle_idle', 'it_bottle_broken']],
  [/^it_burnable(_invisible|_oil|_ignited|_burning|_ash|_fireproof)?$/, FIRE_IMAGES],
  [/^it_extinguisher(_full|_medium|_empty)?$/, FIRE_IMAGES],
  [/^it_umbrella$/, ['it_umbrella']],
  [/^it_death$/, ['it_death']],
  [/^it_strip(_[nesw]+)?$/, ['it_strip']],
  [/^it_puller(_[nesw])?$/, ['it_puller', 'it_explosion']],
  [/^st_knight$/, ['st_knight', 'sh_round']],
  [/^st_dispenser(_bombblack|_bombwhite|_dynamite|_extralife)?$/, ['st_dispenser_bombblack', 'st_dispenser_bombwhite', 'st_dispenser_dynamite', 'st_dispenser_extralife', 'sh_round', 'it_bomb', 'it_dynamite', 'it_dynamite_burning', 'it_extralife', 'it_explosion', 'it_crack_abyss', 'it_crack_water', 'it_meditation_hollow']],
  [/^st_shogun(_s|_m|_sm|_l|_sl|_ml|_sml)?$/, ['st_shogun', 'sh_shogun_s', 'sh_shogun_m', 'sh_shogun_l']],
  [/^it_shogun(_s|_m|_l)?$/, ['it_shogun_s', 'it_shogun_m', 'it_shogun_l']],
  [/^st_ice$/, ['st_ice', 'st_ice_break', 'sh_rawglass', 'fl_ice']],
  [/^st_turnstile(_red|_green)?$/, ['st_turnstile', 'st_turnstile_green', 'sh_solid']],
  [/^st_turnstilearm(_[nesw])?$/, ['st_puzzle_blue', 'sh_solid']],
  [/^st_lightpassenger(_on|_off)?$/, ['st_lightpassenger', 'st_lightpassenger_off', 'st_lightpassenger_break', 'sh_rawglass']],
  [/^st_thief$/, ['st_bluegray', 'thief_template', 'st_thief_capture', 'sh_round', 'it_bag']],
  [/^st_floppy$/, ['st_floppy_on', 'st_floppy_off', 'sh_round']],
  [/^it_coin(_s|_m|_l)?$/, ['it_coin_s', 'it_coin_m', 'it_coin_l']],
  [/^st_coinslot(_instant)?$/, ['st_coinslot', 'st_coinslot_insert', 'sh_solid']],
  [/^it_dynamite(_burning)?$/, ['it_dynamite', 'it_dynamite_burning', 'it_explosion', 'it_meditation_hollow', 'it_crack_water', 'it_crack_abyss']],
  [/^it_bomb(_black|_white)?(_burning)?$/, ['it_bomb', 'it_explosion', 'it_crack_abyss', 'it_crack_water', 'it_meditation_hollow']],
  [/^st_break(_plain|_black|_white|_oxydc|_boulder|_bug|_laser)?$/, ['st_break_plain', 'st_break_black', 'st_break_white', 'st_break_oxydc', 'st_break_boulder', 'st_break_bug', 'st_flat', 'st_flat_break', 'sh_solid', 'sh_round']],
  [/^it_flag(_black|_white)?$/, ['it_flag_black', 'it_flag_white']],
  [/^it_springboard$/, ['it_springboard', 'ac_marble_black_jump', 'ac_marble_white_jump', 'sh_marble_jump']],
  [/^it_magnet(_on|_off)?$/, ['it_magnet_on', 'it_magnet_off']],
  [/^it_sensor(_inverse|_exit|_filter[01])?$/, ['it_sensor', 'it_sensor_exit']],
  [/^it_key$/, ['it_key']],
  [/^st_key$/, ['st_key_on', 'st_key_off', 'sh_round']],
  [/^st_laser(_[nesw])?$/, ['st_laser', 'sh_rounded', 'it_laser']],
  [/^it_crack(_[isml])?(_water)?$/, ['it_crack_abyss', 'it_crack_water']],
  [/^fl_scales$/, ['fl_scales']],
  [/^fl_forward$/, ['fl_forward']],
  [/^fl_bridge$/, ['fl_bridge_gc', 'fl_bridge_gc_open', 'fl_bridge_gc_closed', 'fl_bridge_bw', 'fl_bridge_bs', 'fl_bridge_be', 'fl_bridge_bn', 'fl_bridge_bw_open', 'fl_bridge_bw_closed']],
  [/^st_mirror(_(slab|triangle|sheets))?(_[nesw]t?m?c?)?$/, ['st_mirror_static', 'st_mirror_movable', 'sh_rounded', 'it_laser']],
  [/^it_vortex(_open|_closed)?$/, ['it_vortex']],
  [/^st_swap$/, ['st_swap', 'sh_round']],
  [/^st_pull$/, ['st_pull', 'sh_rawglass', 'sh_pull']],
  [/^st_rotator(_cw|_ccw)?(_movable)?$/, ['st_rotator_cw', 'st_rotator_ccw', 'sh_round']],
  [/^(st|it)_blocker(_new)?$/, ['st_blocker', 'sh_round']],
  [/^st_laserswitch$/, ['st_oxydb', 'st_quake', 'sh_round']],
  [/^st_window(_[nesw]+)?$/, ['st_window_blue', 'st_window_green', 'sh_window']],
  [/^st_fourswitch$/, ['st_fourswitch', 'sh_round']],
  [/^st_chess(_black|_white)?$/, ['st_chess_black', 'st_chess_white', 'sh_round']],
  [/^st_actorimpulse(_invisible)?$/, ['st_actorimpulse', 'sh_actorimpulse']],
  [/^st_blur(_straight|_cross|_magic)?$/, ['st_blur_straight', 'st_blur_cross', 'sh_round', 'st_passage_black_square', 'st_passage_white_square']],
  [/^st_chameleon$/, []], // drawn with the floor image of its cell
  [/^st_passage(_black|_white)?(_square|_slash|_cross|_frame|_backslash)?$/, [...['square', 'slash', 'cross', 'frame', 'backslash'].flatMap((f) => [`st_passage_black_${f}`, `st_passage_white_${f}`]), 'sh_round', ...['slash', 'cross', 'frame', 'backslash'].map((f) => `sh_passage_${f}`)]],
  [/^it_spring(_keep|_drop)?$/, ['it_spring', 'ac_marble_black_jump', 'ac_marble_white_jump', 'sh_marble_jump']],
  [/^st_boulder(_[nesw])?$/, ['st_boulder', 'st_boulder_fall', 'sh_round']],
  [/^st_brownie$/, ['st_brownie', 'sh_round']],
  [/^st_(granite|camouflage|redbrown|greenbrown|flat|plaster)_movable$/, ['st_granite', 'st_camouflage', 'st_redbrown', 'st_greenbrown', 'st_flat', 'st_plaster', 'sh_solid']],
  [/^st_(flat_(breakable|breaking|cracked|burnable)|plaster_breakable)$/, ['st_flat', 'st_flat_cracked', 'st_flat_fire', 'st_plaster', 'st_flat_break', 'sh_solid']],
  [/^st_plop$/, ['st_plop_slate', 'sh_solid']],
  [/^st_(rawglass|lightglass|darkglass)_movable$/, ['st_rawglass', 'st_lightglass', 'st_darkglass', 'sh_rawglass']],
  [/^st_invisible_movable$/, []],
  [/^st_box(_wood(_[hv])?|_hay|_rock|_wood_growing|_hay_growing)?$/, ['st_box_wood', 'st_box_hay', 'st_box_rock', 'st_box_wood_growing', 'sh_round', 'fl_wood_framed', 'fl_hay', 'fl_rock']],
];
const objectImages = (k) => OBJECTS.find(([re]) => re.test(k))?.[1] ?? null;
const ACTIONS = new Set(['', 'toggle', 'signal', 'open', 'on', 'close', 'off', 'nop', 'flip', 'shovel', 'grow', 'shuffle', 'closeall', 'orientate', 'turn', 'turnback', 'ignite', 'inner_pull', 'kill', 'forcefire', 'setfire', 'stopfire', 'heat', 'hit']);
// Attributes the Murmel objects use; everything else (Lua helpers like _foo) is dropped.
/** World attributes of Enigma's life rule (player.cc), read once at level start. */
const LIFE_WORLD = ['ConserveLevel', 'ProvideExtralifes', 'InfiniteReincarnation'];
const KEEP_ATTR = /^(\$id|\$state|\$connections|name|target(_\d+)?|action(_\d+)?|inverse|color|instant|flavor|text|invisible|faces|interval|loop|orientation|strength|range|dest|safeaction|\$hollow|\$flavor|scissor|autoopen|autoclose|dests|hit_strength|hit_distortion_\w+|essential|exit|code|secure|counterclock|movable|transparent|fragility|spreading|min|interval_[sml]|stock|fellows|mass|length|threshold|max|orientation|charge|selection|anchor2|_\w+)$/;
// API 1 message names Murmel translates (objects.ts API1_RENAMING): receiver kind → message.
// api1init.lua MessageRenaming: receiver kind → old message Murmel translates
const API1_ACTIONS = [
  [/^fl_bridge/, 'openclose'], [/^fl_bridge/, 'signal'], [/^(it|st)_blocker/, 'trigger'], [/^(it|st)_blocker/, 'openclose'],
  [/^it_burnable/, 'trigger'], [/^it_magnet/, 'onoff'], [/^it_meditation/, 'trigger'], [/^it_vortex/, 'openclose'], [/^it_vortex/, 'trigger'],
  [/^it_wormhole/, 'onoff'], [/^st_boulder/, 'direction'], [/^st_door/, 'openclose'], [/^st_fourswitch/, 'trigger'], [/^st_floppy/, 'onoff'],
  [/^st_key/, 'onoff'], [/^st_laser/, 'onoff'], [/^st_lightpassenger/, 'trigger'], [/^st_lightpassenger/, 'onoff'], [/^st_mirror/, 'trigger'],
  [/^st_oneway/, 'direction'], [/^st_oxyd/, 'trigger'], [/^st_passage/, 'trigger'], [/^st_polarswitch/, 'onoff'], [/^st_quake/, 'trigger'],
  [/^st_stoneimpulse/, 'trigger'], [/^st_switch/, 'onoff'], [/^st_volcano/, 'trigger'],
];
const tokens = (v) => (v ?? '').split(/[;,]/).map((t) => t.trim()).filter((t) => t !== '');


const unxml = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();

/** Level strings by key: German translation if present, else English. */
function levelTexts(xml) {
  const texts = {};
  for (const m of xml.matchAll(/<el:string el:key="([^"]*)">([\s\S]*?)<\/el:string>/g)) {
    const de = /<el:translation el:lang="de"[^>]*>([\s\S]*?)<\/el:translation>/.exec(m[2]);
    const en = /<el:english[^>]*>([\s\S]*?)<\/el:english>/.exec(m[2]);
    const t = de?.[1] ?? en?.[1];
    if (t && unxml(t)) texts[m[1]] = unxml(t);
  }
  return texts;
}

/** Objects named by a target token among the level's objects (as objects.ts resolves it). */
function resolveTarget(token, objs) {
  if (/^#\d+$/.test(token)) return objs.filter((o) => '#' + o.a.$id === token);
  if (token.startsWith('%')) return [];
  if (/[*?]/.test(token)) {
    const re = new RegExp('^' + token.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    return objs.filter((o) => o.a.name && re.test(o.a.name));
  }
  return objs.filter((o) => o.a.name === token);
}

const licenceOk = (l) => /GPL|GPJ|Donated to Enigma|public domain/i.test(l);

function attr(xml, re) {
  return re.exec(xml)?.[1] ?? '';
}

function readPacks() {
  const packs = [];
  for (const name of readdirSync(levelsDir)) {
    const idx = join(levelsDir, name, 'index.xml');
    if (!existsSync(idx) || EXCLUDED_PACKS.test(name)) continue;
    const xml = readFileSync(idx, 'utf8');
    const info = /<info\s([^>]*)\/>/.exec(xml)?.[1] ?? '';
    const levels = [...xml.matchAll(/<level\s([^>]*)\/>/g)].map((m) => ({
      seq: Number(attr(m[1], /_seq="(\d+)"/)),
      title: attr(m[1], /_title="([^"]*)"/),
      xpath: attr(m[1], /_xpath="([^"]*)"/),
      id: attr(m[1], /\sid="([^"]*)"/),
      author: attr(m[1], /author="([^"]*)"/),
    }));
    packs.push({
      name,
      title: attr(info, /title="([^"]*)"/) || name,
      location: Number(attr(info, /location="(\d+)"/)) || 99999,
      levels: levels.sort((a, b) => a.seq - b.seq),
    });
  }
  return packs.sort((a, b) => a.location - b.location);
}

const exportIndex = new Map();
for (const f of readdirSync(exportDir)) {
  if (!f.endsWith('.json')) continue;
  try {
    const e = JSON.parse(readFileSync(join(exportDir, f), 'utf8'));
    exportIndex.set(e.path, e);
  } catch {
    /* broken export: level is skipped */
  }
}

/** Actors Murmel can play. */
const ACTORS = new Set(['ac_marble_black', 'ac_marble_white', 'ac_pearl', 'ac_pearl_white', 'ac_pearl_black', 'ac_rotor', 'ac_top', 'ac_killer', 'ac_killer_white', 'ac_killer_black', 'ac_bug', 'ac_horse', 'ac_marble_glass']);
/** Images of the other actors (models-2d.lua: killers look like pearls). */
function actorImages(k, color) {
  if (k === 'ac_rotor') return ['ac_rotor', 'sh_rotor'];
  if (k === 'ac_bug') return ['ac_bug', 'sh_pearl'];
  if (k === 'ac_horse') return ['ac_horse', 'sh_horse'];
  if (k === 'ac_top') return ['ac_top', 'sh_top'];
  if (k.startsWith('ac_killer')) return [color === '0' || (color === undefined && k === 'ac_killer_black') ? 'ac_pearl_black' : 'ac_pearl_white', 'sh_pearl'];
  if (k === 'ac_marble_white') return ['ac_marble_white', 'ac_marble_white_fall'];
  if (k === 'ac_marble_glass') return ['ac_marble_glass', 'ac_marble_glass_fall', 'ac_marble_glass_jump'];
  if (/^ac_pearl(_white|_black)?$/.test(k)) {
    const c = k === 'ac_pearl_black' || color === '0' ? 'black' : 'white';
    return [`ac_pearl_${c}`, `ac_pearl_${c}_fall`, 'sh_pearl', 'sh_pearl_fall'];
  }
  return [];
}
const ACTOR_ATTR = /^(range|strength|gohome|color|velocity_x|velocity_y|attacknearest|prefercurrent|essential|dests|steady|loop|destidx)$/;

const reasons = new Map(); // blocker -> levels it blocks (among others)
const only = new Map(); // blocker -> levels it alone blocks
let blockers = null; // Set while converting one level
let current = ''; // pack/level being converted (ONLY=<reason> lists levels blocked by it alone)
const reject = (why) => {
  if (blockers) {
    blockers.add(why);
    return undefined;
  }
  reasons.set(why, (reasons.get(why) ?? 0) + 1);
  only.set(why, (only.get(why) ?? 0) + 1);
  return null;
};
function finish(level) {
  if (!blockers) return level;
  const b = [...blockers];
  blockers = null;
  if (b.length === 0) return level;
  for (const why of b) reasons.set(why, (reasons.get(why) ?? 0) + 1);
  // BLOCKERS=<file>: one line per rejected level with all its blockers (to plan the next objects)
  if (process.env.BLOCKERS) appendFileSync(process.env.BLOCKERS, `${current}\t${b.join('\t')}\n`);
  if (b.length === 1) only.set(b[0], (only.get(b[0]) ?? 0) + 1);
  if (b.length === 1 && process.env.ONLY && b[0].includes(process.env.ONLY)) console.log(`nur ${b[0]}: ${current}`);
  return null;
}

const usedImages = new Set(['st_oxyd_colordots', 'st_oxyd_questmark', 'st_oxyd_blink', 'halo', 'halo-blink', 'halo-small', 'halo-small-blink']);

function hasImage(kind) {
  return existsSync(join(enigmaData, 'gfx32', `${kind}.png`));
}

/** Image name for a floor/stone kind: the kind itself or its base kind. */
function imageFor(kind) {
  let k = kind;
  while (!hasImage(k) && k.lastIndexOf('_') > 2) k = k.slice(0, k.lastIndexOf('_'));
  return hasImage(k) ? k : null;
}

/** Every object of the exported world with its cell. */
function* allCells(w) {
  for (let i = 0; i < w.cells.length; i++) for (const o of w.cells[i]) if (o) yield { x: i % w.w, y: Math.floor(i / w.w), o };
}

function objectDef(x, y, o) {
  const a = {};
  for (const [k, v] of Object.entries(o)) if (k !== 'k' && KEEP_ATTR.test(k) && v !== '') a[k] = v;
  return { x, y, k: o.k, a };
}

/** Lua of a level: code, its functions and the result of running its init on the export. */
async function analyzeLua(xml, exp) {
  let code = luaCode(xml);
  if (!code) return null;
  // Enigma's Lua API 1 (api1init.lua) for levels with compatibility below 1.10
  const api1 = (Number(attr(xml, /el:compatibility el:enigma="([0-9.]+)"/)) || 1.1) < 1.1;
  // libraries Murmel ships (libpento, API 2) run before the level, as Enigma preloads them
  const libs = api1 ? [] : levelLibs(xml);
  // API 1: libraries the level preloads (el:dependency … el:preload="true", lib/ant …) run first
  if (api1) {
    // depth first: a library's own preloads come before it (lib/ralf needs lib/ant)
    const pre = [];
    const seen = new Set();
    let missing = null;
    const load = (src) => {
      for (const m of src.matchAll(/<el:dependency\b[^>]*>/g)) {
        const path = /el:path="([^"]+)"/.exec(m[0])?.[1];
        if (!path || !/el:preload="true"/.test(m[0]) || seen.has(path)) continue;
        seen.add(path);
        const file = join(levelsDir, `${path}.xml`);
        const lib = existsSync(file) ? readFileSync(file, 'utf8') : '';
        if (!lib || !licenceOk(attr(lib, /<el:license el:type="([^"]*)"/))) missing ??= path;
        else {
          load(lib);
          pre.push(luaCode(lib));
        }
      }
    };
    load(xml);
    if (missing) return { code, libs, api1, fns: new Set([...luaFunctions(code), ...libFunctions(libs)]), world: {}, error: `Bibliothek ${missing}` };
    if (pre.length) code = `${pre.join('\n')}\n${code}`;
  }
  let init;
  try {
    init = await luaInit(code, exp.world, libs, api1);
  } catch (e) {
    init = { world: {}, error: String(e) };
  }
  return { code, libs, api1, fns: new Set([...luaFunctions(code), ...libFunctions(libs)]), ...init };
}

/** Cell value of a kind Lua callbacks may set (floor/stone image name), 'object', or null. */
function runtimeKind(kind) {
  if (/^(st|it|fl)_nil$/.test(kind)) return 'nil';
  if (kind.startsWith('fl_')) {
    if (kind === 'fl_fake_abyss' || kind === 'fl_fake') return 'fl_fake_abyss'; // FakeFloor: looks like abyss
    if (SPECIAL_FLOORS.test(kind) || FORWARD.test(kind)) return null;
    return DEADLY.has(kind) ? kind : imageFor(kind);
  }
  if (objectImages(kind)) return 'object';
  if (kind.startsWith('st_')) {
    // OxydStone made during play (wo[…] = {"st_oxyd"}, Pentomino): a new closed stone, flavor a
    if (kind === 'st_oxyd') return 'oxyd';
    if (OXYD.test(kind)) return null;
    if (FAKE_OXYD.test(kind)) return `st_oxyd${FAKE_OXYD.exec(kind)[1]}`;
    if (kind === 'st_invisible') return 'st_invisible';
    if (STONES.has(kind) || STONE_BASE.test(kind)) return STONE_BASE.exec(kind)?.[1] ?? kind;
  }
  return null;
}

function convert(pack, meta, xml, exp, lua) {
  blockers = new Set();
  return finish(convertLevel(pack, meta, xml, exp, lua));
}

function convertLevel(pack, meta, xml, exp, lua) {
  const imgs = new Set();
  const licence = attr(xml, /<el:license el:type="([^"]*)"/);
  if (!licenceOk(licence)) {
    blockers = null;
    return reject(`Lizenz: ${licence || 'keine Angabe'}`);
  }
  // Not built yet: other floors for fallen puzzles.
  // Hollow stones come as $hollow since the export of 12.11. (enigma-web 0d6063b4). A level that names
  // hollow=true without a hollow stone in its world creates them at runtime (ti entries for callbacks).
  // wo["FallenPuzzle"]: the floor under a sunk puzzle stone (see below, after the Lua init)
  if (/el:single="false"/.test(xml)) {
    blockers = null;
    return reject('nur Netzwerkspiel');
  }
  const w = exp.world;
  // wo["SlopeForce"] (server::SlopeForce, default 25) from the level's init
  const slopeForce = lua?.world?.SlopeForce !== undefined ? Number(lua.world.SlopeForce) : 25;
  if (lua?.error && lua.code.includes('SlopeForce')) reject('Lua-Init (Weltwert)');
  const compat = Number(attr(xml, /el:compatibility el:enigma="([0-9.]+)"/)) || 1.1;
  const actors = w.actors.map((a) => a.o.k);
  for (const k of new Set(actors)) if (!ACTORS.has(k)) reject(`Akteur ${k}`);
  // Horse: only the passive one is built – destinations (not in the export), actions and owners are not
  for (const h of w.actors.filter((x) => x.o.k === 'ac_horse')) {
    if (h.o.target || h.o.owner || h.o.controllers) reject('Pferd mit Aktion oder Steuerung');
    // the export (enigma-web ef0a1ce6) carries the horse's $destination, $strength, $steady, $loop, $destidx
    for (const k of ['strength', 'steady', 'loop', 'destidx']) if (h.o['$' + k] !== undefined && h.o['$' + k] !== '') h.o[k] = h.o['$' + k];
    if (h.o.$destination) {
      const pts = [];
      for (const t of tokens(h.o.$destination)) {
        const pos = /^(-?[\d.]+)\s+(-?[\d.]+)$|^(-?[\d.]+),(-?[\d.]+)$/.exec(t);
        const c = pos ? null : [...allCells(w)].find((x) => x.o.name === t || '#' + x.o.$id === t);
        if (pos) pts.push([Number(pos[1] ?? pos[3]), Number(pos[2] ?? pos[4])]);
        else if (c) pts.push([c.x + 0.5, c.y + 0.5]);
        else reject('Pferd mit Zielen');
      }
      h.o.dests = pts.map((p) => p.join(',')).join(';');
    }
  }
  if (actors.includes('ac_horse') && !w.actors.some((x) => x.o.$destination !== undefined || x.o.$strength !== undefined) && /destination/.test(xml)) reject('Pferd mit Zielen');
  // No black marble but pearls: the first pearl is the main ball (mainPearl)
  const blacks = actors.filter((k) => k === 'ac_marble_black').length;
  // further black marbles are steered together with the first (all of player 1)
  // a single white marble (no black one, no pearls) is the main ball as well
  // the glass marble (owner YIN, controllers 1) is built only as the single main ball
  const glasses = actors.filter((k) => k === 'ac_marble_glass').length;
  if (glasses > 1 || (glasses && (blacks || actors.some((k) => /^ac_pearl/.test(k))))) reject('Akteur ac_marble_glass');
  const soloWhite = blacks === 0 && !glasses && !actors.some((k) => /^ac_pearl/.test(k)) && actors.filter((k) => k === 'ac_marble_white').length === 1;
  if (blacks === 0 && !glasses && !actors.some((k) => /^ac_pearl/.test(k)) && !soloWhite) reject('Akteure: nicht genau eine schwarze Murmel');
  // A white marble is steered with the yin-yang, which Enigma hands out in single play only
  // for levels that also allow network play (player::LevelLoaded with TwoPlayerGame).
  const whites = actors.filter((k) => k === 'ac_marble_white').length;
  // Without network play there is no yin-yang: white marbles (controllers 2) are passive balls.
  const passiveWhite = whites >= 1 && !/el:network="true"/.test(xml);
  // With network play several white marbles are steered together (like further black ones); a marble
  // without owner (owner=DEFAULT, controllers=CTRL_NONE) belongs to no player and is never steered.
  // Rubber bands need the export with their values (enigma-web level-export since 11.11. evening).
  const banded = w.actors.some((a) => a.o.rubbers) || w.cells.some((c) => c.some((o) => o && o.rubbers));
  if (banded && !Array.isArray(w.rubberbands)) reject('Gummiband (alter Export)');

  const legend = {};
  const keyOf = new Map();
  const pool = [...'.#o~,;:-_=+*%&$§!|/<>()[]{}^`\'"0123456789abcdefghijklmnpqrstuvwxyzÄÖÜäöüßéèêàâçñ']; // '@' and A–Z have own meanings
  let oxyds = 0;
  const rows = [];
  const objs = [];
  const allObjects = new Map(); // $id → kind, to name unsupported targets
  for (const c of w.cells) for (const o of c) if (o) allObjects.set(o.$id, o);
  for (let y = 0; y < w.h; y++) {
    let row = '';
    for (let x = 0; x < w.w; x++) {
      const [fl, st, it] = w.cells[y * w.w + x];
      // it_laserbeam: Enigma's beams of the initial world – Murmel calculates them itself
      // Bottle with a message ("text": shown as a document when used) is not built
      if (it && /^it_bottle/.test(it.k) && it.text) reject('Flasche mit Text');
      // it_surprise: its selection must be items Murmel has. "=key" is the tile ti[key] of the level
      // script (keys may end in a space, so the raw tokens are used); a plain item tile becomes its kind,
      // a surprise tile with the same selection stays a surprise ("keep dice").
      if (it && it.k === 'it_surprise' && it.selection) {
        const sel = it.selection
          .split(/[;,]/)
          .filter((t) => t.trim() !== '')
          .map((t) => {
            if (!t.trim().startsWith('=')) return t.trim();
            const key = t.trim() === t ? t.slice(1) : t.replace(/^\s*=/, '');
            const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const m = new RegExp(`ti\\[\\s*"${esc}"\\s*\\]\\s*=\\s*\\{\\s*"(it_\\w+)"\\s*(?:,([^}]*))?\\}`).exec(lua?.code ?? luaCode(xml));
            if (!m) return t;
            const rest = (m[2] ?? '').replace(/--.*$/, '').trim();
            if (rest === '') return m[1];
            if (m[1] === 'it_surprise' && /^selection\s*=\s*"=([^"]*)"$/.exec(rest)?.[1] === key) return 'it_surprise';
            return t;
          });
        for (const t of sel) {
          if (t.startsWith('=') || !objectImages(t)) reject(`Überraschung mit ${t.trim()}`);
          else objectImages(t).forEach((i) => imgs.add(i));
        }
        it.selection = sel.join(',');
      }
      if (it && it.k !== 'it_laserbeam') {
        const im = objectImages(it.k);
        if (im) {
          objs.push(objectDef(x, y, it));
          im.forEach((i) => imgs.add(i));
        } else reject(`Gegenstand ${it.k}`);
      }
      if (!fl) {
        reject('Feld ohne Boden');
        continue;
      }
      if (SPECIAL_FLOORS.test(fl.k)) reject(`Boden ${fl.k.replace(/_[nesw]+$/, '')}`);
      // FloodStream: fl_water_source is flooding water; water and framed wood/hay/rock in state FLOODING spread
      let flooding = fl.$state === '1' && /^fl_(water|wood|hay|rock)/.test(fl.k);
      if (fl.k === 'fl_water_source') {
        fl.k = 'fl_water';
        flooding = true;
      }
      // Sinking marbles (models-2d.lua) for the renderer.
      if (fl.k === 'fl_swamp') for (const i of ['ac_marble_black_sink', 'ac_marble_white_sink', 'sh_marble_sink']) imgs.add(i);
      // BridgeFloor: floor fl_bridge_<gc|bw>_<open|closed> plus an object fl_bridge for its state
      const bridge = /^fl_bridge(?:_(gc|bw|bs|be|bn))?$/.exec(fl.k);
      if (bridge) {
        const flavor = fl.flavor || bridge[1] || 'gc';
        const def = objectDef(x, y, fl);
        objs.push({ ...def, k: 'fl_bridge', a: { ...def.a, flavor } });
        const img = flavor === 'gc' ? 'fl_bridge_gc' : 'fl_bridge_bw';
        for (const i of [`${img}_open`, `${img}_closed`, `fl_bridge_${flavor}`]) imgs.add(i);
        if (flavor !== 'gc') imgs.add('fl_bridge_bw_open'), imgs.add('fl_bridge_bw_closed');
        fl.k = `${img}_${fl.$state === '0' ? 'closed' : 'open'}`;
      }
      // ScalesFloor: the base floor of its flavor, plus an object fl_scales that acts like a trigger
      // Named floors can receive messages (fire, flood): an object fl_ref for them
      if (fl.name && !/^fl_(bridge|scales|thief|forward)/.test(fl.k)) objs.push({ x, y, k: 'fl_ref', a: { $id: fl.$id, name: fl.name } });
      // ThiefFloor: fl_bluegray with an object fl_thief for the thief
      if (fl.k === 'fl_thief') {
        objs.push({ ...objectDef(x, y, fl), k: 'fl_thief' });
        for (const i of ['thief_template', 'thief_capture_template', 'it_bag']) imgs.add(i);
        fl.k = 'fl_bluegray';
      }
      const scales = /^fl_scales(?:_(\w+))?$/.exec(fl.k);
      if (scales) {
        const flavor = fl.flavor || scales[1] || 'darkgray';
        const base = { brick: 'fl_brick', bridgewood: 'fl_bridge_bw_closed', concrete: 'fl_concrete', darkgray: 'fl_darkgray', gray: 'fl_gray', platinum: 'fl_platinum' }[flavor];
        if (!base || !imageFor(base)) reject(`Boden ${fl.k}`);
        else {
          const def = objectDef(x, y, fl);
          objs.push({ ...def, k: 'fl_scales' });
          imgs.add('fl_scales');
          fl.k = base;
        }
      }
      // ForwardFloor: the base floor of its flavor plus an object fl_forward (state = direction W 0 S 1 E 2 N 3)
      const forward = FORWARD.exec(fl.k);
      if (forward) {
        const flavor = fl.flavor || forward[1] || 'darkgray';
        const def = objectDef(x, y, fl);
        const dir = forward[2] ? { w: 0, s: 1, e: 2, n: 3 }[forward[2]] : 0;
        objs.push({ ...def, k: 'fl_forward', a: { $state: String(dir), ...def.a, flavor } });
        imgs.add('fl_forward');
        fl.k = FORWARD_BASE[flavor] ?? 'fl_darkgray';
      }
      // FakeFloor: looks like abyss (DefAlias fl_fake_abyss = fl_abyss) but carries the marble
      if (fl.k === 'fl_fake' || fl.k === 'fl_fake_abyss') {
        fl.k = 'fl_fake_abyss';
        imgs.add('fl_abyss');
      }
      // YinyangFloor: the kind is kept (the renderer picks yin/yang and the invisible subimage)
      if (/^fl_yinyang/.test(fl.k)) imgs.add(/yang/.test(fl.k) ? 'fl_yinyang_yang' : 'fl_yinyang_yin');
      const flImg = DEADLY.has(fl.k) ? fl.k : fl.k === 'fl_fake_abyss' || /^fl_yinyang/.test(fl.k) ? fl.k : imageFor(fl.k);
      if (!flImg) {
        reject(`Boden ohne Bild ${fl.k}`);
        continue;
      }
      if (!/^fl_yinyang/.test(fl.k)) imgs.add(flImg);
      const def = { floor: DEADLY.has(fl.k) ? fl.k : fl.k.startsWith('fl_slope') || fl.k.startsWith('fl_yinyang') ? fl.k : flImg };
      // Floor fire attributes; initfire: the floor starts burning (Floor "_init" → force_fire)
      const fire = {};
      for (const a of ['burnable', 'ignitable', 'secure', 'eternal', 'noash', 'fastfire', 'floodable', 'interval']) if (fl[a] !== undefined && fl[a] !== '') fire[a] = String(fl[a]);
      if (flooding) fire.flooding = 'true';
      if (Object.keys(fire).length) def.fire = fire;
      if (fl.initfire === true || fl.initfire === 'true') {
        objs.push({ x, y, k: 'it_burnable_ignited', a: {} });
        FIRE_IMAGES.forEach((i) => imgs.add(i));
      }
      const force = floorForce(fl, slopeForce);
      if (force && (force[0] !== 0 || force[1] !== 0)) def.force = force;
      // OBJBIT_MOVABLE (export $movable since enigma-web 420a9755): mirrors, rotators, death stones read
      // `movable`; a plain stone made movable is pushed like its _movable kind
      if (st && st.$movable === 'true') {
        if (st.movable === undefined || st.movable === '') st.movable = 'true';
        const base = STONE_BASE.exec(st.k)?.[1] ?? st.k;
        if (!objectImages(st.k) && objectImages(`${base}_movable`)) st.k = `${base}_movable`;
      }
      if (st) {
        const ox = OXYD.exec(st.k);
        if (ox) {
          const flavor = st.flavor || ox[2] || 'a';
          // Value::toInt skips a leading % ("%3" → 3, from autotile templates)
          const color = Number(String(st.oxydcolor ?? '').replace(/^%/, ''));
          def.stone = 'st_oxyd';
          def.flavor = flavor;
          def.symbol = Number.isInteger(color) && color >= 0 && color < 26 ? String.fromCharCode(65 + color) : '?';
          oxyds++;
          // named Oxyd stones can receive messages (open, close, shuffle …)
          // ($id: Lua's named list skips it, so no group holds the stone twice)
          // (with the level's own attributes "_kind" …, which Lua reads, and oxydcolor: Lua reads it,
          // Firefox shuffles in its init until three colours differ)
          const own = Object.fromEntries(Object.entries(st).filter(([k, v]) => /^_\w+$/.test(k) && v !== ''));
          if (st.name) objs.push({ x, y, k: 'st_oxyd_ref', a: { $id: st.$id, name: st.name, ...own, ...(st.oxydcolor !== undefined && st.oxydcolor !== '' ? { oxydcolor: st.oxydcolor } : {}) } });
          // flavor e: b's images plus the peephole mask st_oxyde (models-2d.lua)
          for (const s of ['', '_open', '_opening']) imgs.add(`st_oxyd${flavor === 'e' ? 'b' : flavor}${s}`);
          if (flavor === 'e') imgs.add('st_oxyde');
        } else if (objectImages(st.k)) {
          // Boxes moved together by wires, or breaking into items, are not built yet.
          // stones moved together by wires (fellows) are built; "selection" (surprise) is not
          if ((/^st_(box|stoneimpulse|brownie)/.test(st.k) || st.k.endsWith("_movable")) && st.selection) reject(`Stein ${st.k} (verbunden)`);
          objs.push(objectDef(x, y, st));
          objectImages(st.k).forEach((i) => imgs.add(i));
          // st_surprise: a custom selection must be stones Murmel has
          if (st.k === 'st_surprise' && st.selection) for (const t of tokens(st.selection)) {
            const im = objectImages(t) ?? (STONES.has(t) ? [t] : null);
            if (t.startsWith('=') || !im) reject(`Überraschungsstein mit ${t}`);
            else im.forEach((i) => imgs.add(i));
          }
          // st_barrier_<item>: the item's images, if Murmel has the item
          if (st.k === 'st_barrier' && st.flavor && st.flavor !== 'all') {
            const im = objectImages(st.flavor);
            if (im) im.forEach((i) => imgs.add(i));
            else reject(`Stein st_barrier (${st.flavor})`);
          }
        } else if (FAKE_OXYD.test(st.k)) {
          def.stone = `st_oxyd${FAKE_OXYD.exec(st.k)[1].replace('e', 'b')}`;
          imgs.add(def.stone);
        } else if (st.k === 'st_invisible') {
          def.stone = 'st_invisible'; // solid, not drawn
        } else if (/^st_\w+_hollow$/.test(st.k) && (STONES.has(st.k.replace(/_hollow$/, '')) || st.k === 'st_invisible_hollow')) {
          // StandardStone/GreenBrownStone/… with OBJBIT_HOLLOW: same look, actors pass (STONE_PASS)
          def.stone = st.k.replace(/_hollow$/, '');
          def.hollow = true;
          if (def.stone !== 'st_invisible') imgs.add(def.stone);
        } else if (STONES.has(st.k) || STONE_BASE.test(st.k)) {
          def.stone = STONE_BASE.exec(st.k)?.[1] ?? st.k;
          imgs.add(def.stone);
        } else reject(`Stein ${st.k.replace(/_[nesw]+$/, '')}`);
      }
      const key = JSON.stringify(def);
      let ch = keyOf.get(key);
      if (!ch) {
        ch = pool[keyOf.size];
        if (!ch) {
          reject('zu viele Feldarten');
          continue;
        }
        keyOf.set(key, ch);
        legend[ch] = def;
      }
      row += ch;
    }
    rows.push(row);
  }
  // Wormholes: resolve the destination (object name, #id or position) to a point.
  for (const o of objs) {
    if (!o.k.startsWith('it_wormhole')) continue;
    const src = [...allCells(w)].find((c) => c.o.$id === o.a.$id)?.o ?? {};
    // Object::getDestinationByIndex(0): the first destination. A position "x,y" (Value::POSITION,
    // taken as is) contains the token separator itself, so test the whole value first.
    const whole = /^(-?[\d.]+),(-?[\d.]+)/.exec(src.destination ?? '');
    const tok = whole ? whole[0] : (tokens(src.destination)[0] ?? '');
    let dest = null;
    const pos = /^(-?[\d.]+),(-?[\d.]+)$/.exec(tok);
    if (pos) dest = [Number(pos[1]), Number(pos[2])];
    else {
      const t = [...allCells(w)].find((c) => c.o.name === tok || '#' + c.o.$id === tok);
      if (t) dest = [t.x + 0.5, t.y + 0.5];
    }
    // WormHole::actor_hit without a destination: it only attracts (unless a script sets one later)
    if (!dest && (src.destination || /it_wormhole[^}\n]*destination|\.destination\s*=|\[\s*"destination"\s*\]\s*=/.test(lua?.code ?? ''))) reject('Wurmloch ohne Ziel');
    else if (dest) o.a.dest = `${dest[0]},${dest[1]}`;
  }
  // Cracks: wo["Fragility"]/["CrackSpreading"] of the level script as their defaults
  for (const o of objs) {
    if (!o.k.startsWith('it_crack')) continue;
    if (o.a.fragility === undefined && lua?.world?.Fragility !== undefined) o.a.fragility = String(lua.world.Fragility);
    if (o.a.spreading === undefined && lua?.world?.CrackSpreading !== undefined) o.a.spreading = String(lua.world.CrackSpreading);
  }
  if (lua?.error && /Fragility|CrackSpreading/.test(lua.code)) reject('Lua-Init (Weltwert)');
  // Magnets: wo["MagnetForce"]/["MagnetRange"] of the level script as their defaults (_updateglobals)
  for (const o of objs) {
    if (!o.k.startsWith('it_magnet')) continue;
    if (o.a.strength === undefined && lua?.world?.MagnetForce !== undefined) o.a.strength = String(lua.world.MagnetForce);
    if (o.a.range === undefined && lua?.world?.MagnetRange !== undefined) o.a.range = String(lua.world.MagnetRange);
  }
  if (lua?.error && /MagnetForce|MagnetRange/.test(lua.code)) reject('Lua-Init (Weltwert)');
  // Vortices: all destinations (Object::getDestinationByIndex) as points; objects by their centre.
  for (const o of objs) {
    if (!o.k.startsWith('it_vortex')) continue;
    const src = [...allCells(w)].find((c) => c.o.$id === o.a.$id)?.o ?? {};
    const raw = src.destination ?? '';
    const pts = [];
    const posRe = /(-?[\d.]+),(-?[\d.]+)/g;
    if (/^\s*-?[\d.]+,-?[\d.]+/.test(raw)) for (const m of raw.matchAll(posRe)) pts.push([Number(m[1]), Number(m[2])]);
    else {
      for (const tok of tokens(raw)) {
        const re = new RegExp('^' + tok.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
        for (const c of allCells(w)) if (c.o.name && re.test(c.o.name)) pts.push([c.x + 0.5, c.y + 0.5]);
        const t = [...allCells(w)].find((c) => '#' + c.o.$id === tok);
        if (t) pts.push([t.x + 0.5, t.y + 0.5]);
      }
    }
    if (pts.length) o.a.dests = pts.map((p) => p.join(',')).join(';');
  }
  if (lua && /"ot_(timer|counter)"/.test(lua.code)) {
    if (lua.error) reject('Objekt ot_timer (Lua-Init)');
    for (const { kind, attrs } of lua.adds ?? []) {
      if (kind !== 'ot_timer' && kind !== 'ot_counter') continue;
      const a = {};
      for (const [k, v] of Object.entries(attrs)) if (KEEP_ATTR.test(k) && v !== '') a[k] = v;
      // TimerGadget: ON by default; CounterGadget: state 0
      a.$state = kind === 'ot_counter' ? String(Math.trunc(Number(attrs.state)) || 0) : attrs.state === '0' || attrs.state === 'false' ? '0' : '1';
      objs.push({ x: -1, y: -1, k: kind, a });
    }
  }
  // "@pattern" in a target is the nearest matching object (Value::finalizeNearestObjectReference,
  // World::get_group: ties go to the one further south, then east); "@@pattern" and "@name" drop the @.
  const named = [...allCells(w)].filter((c) => c.o.name);
  for (const o of objs) {
    for (const key of Object.keys(o.a).filter((k) => /^target(_\d+)?$/.test(k))) {
      if (!o.a[key].includes('@')) continue;
      o.a[key] = tokens(o.a[key])
        .map((t) => {
          if (!t.startsWith('@')) return t;
          if (t.startsWith('@@') || !/[*?]/.test(t)) return t.replace(/^@@?/, '');
          const re = new RegExp('^' + t.slice(1).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
          let best = null;
          let bestD = Infinity;
          for (const c of named) {
            if (!re.test(c.o.name)) continue;
            const d = (c.x - o.x) ** 2 + (c.y - o.y) ** 2;
            if (d < bestD || (d === bestD && (c.y > best.y || (c.y === best.y && c.x > best.x)))) {
              best = c;
              bestD = d;
            }
          }
          return best ? best.o.name : t;
        })
        .join(',');
    }
  }
  // Every action must be a supported message to a supported object, or a Lua function of the
  // level (Object::performAction: no target object and action "callback" or empty).
  let needsLua = false;
  /** Level functions the objects call (API 1: only what they reach must run during play). */
  const callbacks = new Set();
  for (const o of objs) {
    for (const key of Object.keys(o.a).filter((k) => /^target(_\d+)?$/.test(k))) {
      const acts = tokens(o.a[key.replace('target', 'action')] ?? o.a.action);
      tokens(o.a[key]).forEach((t, i) => {
        const act = acts[i] ?? '';
        if ((act === 'callback' || act === '') && resolveTarget(t, objs).length === 0 && (lua?.fns.has(t) || lua?.isFunction?.(t))) {
          needsLua = true;
          callbacks.add(t);
        } else if (act === 'callback' || resolveTarget(t, objs).length === 0) {
          const named = [...allObjects.values()].find((x) => x.name === t || '#' + x.$id === t);
          const actor = w.actors.some((x) => x.o.name === t || '#' + x.o.$id === t);
          // Object::performAction ignores a target that names nothing ("no longer valid target"),
          // unless it is a Lua function (maybe from a library) or an ot_ object we do not have.
          const unknown = act !== 'callback' && !/<el:dependency/.test(xml) && !(lua?.code ?? '').includes(`"${t}"`) && !/[*?]/.test(t);
          // a plain (map) stone killed by an action: an object st_ref for it
          const cell = named && act === 'kill' && !objectImages(named.k) && !OXYD.test(named.k) && (STONES.has(named.k) || STONE_BASE.test(named.k)) ? [...allCells(w)].find((c) => c.o === named) : null;
          if (cell) objs.push({ x: cell.x, y: cell.y, k: 'st_ref', a: { $id: named.$id, name: named.name } });
          else if (named) reject(`Stein ${named.k.replace(/_[nesw]+$/, '')}`);
          else if (actor) reject('Akteur als Ziel');
          else if (!unknown) reject('Lua-Rückruf');
        } else if (!ACTIONS.has(act)) {
          const ok = compat < 1.1 && resolveTarget(t, objs).every((x) => API1_ACTIONS.some(([re, a]) => a === act && re.test(x.k)));
          if (!ok) reject(`Aktion ${act}`);
        }
      });
    }
  }
  // PuzzleStone: a cluster sinking into water/abyss leaves server::FallenPuzzle (default fl_gray):
  // a floor kind, or "=key" = the tile ti[key]; items there (it_strip, it_pipe) are not built.
  let fallenFloor = null;
  if (/FallenPuzzle/.test(xml)) {
    const v = lua?.world?.FallenPuzzle;
    const kinds = v === undefined ? null : v.startsWith('=') ? lua.fallenTile : [v];
    const floor = kinds && kinds.length === 1 && kinds[0].startsWith('fl_') ? kinds[0] : null;
    const img = floor && !SPECIAL_FLOORS.test(floor) ? (DEADLY.has(floor) ? floor : imageFor(floor)) : null;
    if (!img) reject('FallenPuzzle');
    else {
      fallenFloor = img;
      imgs.add(img);
    }
  }
  // Other objects (ot_timer, ot_counter …) are not in the export; rubber bands and wires are.
  // The level script's init recorded its wo:add calls: timers become objects without a cell.
  for (const m of (lua?.code ?? '').matchAll(/"(ot_\w+)"/g)) if (!/^ot_(rubberband|wire|timer|counter)$/.test(m[1])) reject(`Objekt ${m[1]}`);
  // World attributes set by the level script (wo["GlobalForce"] …), also without callbacks.
  const world = {};
  if (lua) {
    for (const k of [...RUNTIME_WORLD, ...LIFE_WORLD, '_PeepAll']) if (lua.world[k] !== undefined) world[k] = lua.world[k];
    if (lua.error && [...RUNTIME_WORLD].some((k) => lua.code.includes(k))) reject('Lua-Init (Weltwert)');
    // Life rules of levels whose init the shim cannot run (API 1: enigma.ConserveLevel = FALSE)
    if (lua.error) {
      for (const k of LIFE_WORLD) {
        const m = new RegExp(`(?:enigma\\.${k}|wo\\[\\s*"${k}"\\s*\\])\\s*=\\s*(TRUE|FALSE|true|false|[01])\\b`).exec(lua.code);
        if (m) world[k] = /^(TRUE|true|1)$/.test(m[1]) ? 'true' : 'false';
      }
    }
  }
  const kinds = {};
  if (needsLua) {
    if (lua.error) reject('Lua-Init');
    if (lua.error && process.env.LUAERR) console.log(`LUAERR ${current}: ${String(lua.error).slice(0, 200)}`);
    for (const p of luaProblems(lua.code, lua.fns, lua.api1, callbacks)) reject(`Lua: ${p}`);
    // Oxyd stones made during play: only plain {"st_oxyd"} (flavor a; API 1 oxyd(): b), colour by shuffle, in a level
    // that starts without any (Pentomino). Replacing existing Oxyd stones, fixed colours or other
    // flavors are not built.
    const plainOxyds = oxyds === 0 && !/\{[^}\n]*"st_oxyd"[^}\n]*\b(flavor|oxydcolor|noshuffle)\b/.test(lua.code);
    const runtimeOk = (v) => v !== null && (v !== 'oxyd' || plainOxyds);
    // kinds a library sets itself (libpento: the puzzle stones of its shapes)
    for (const k of [...runtimeKinds(lua.code, lua.api1, callbacks), ...lua.libs.flatMap((l) => l.kinds)]) {
      const v = runtimeKind(k);
      if (!runtimeOk(v)) {
        reject(`Lua: ${k}`);
        continue;
      }
      kinds[k] = v;
      if (v === 'object') objectImages(k).forEach((i) => imgs.add(i));
      else if (v === 'oxyd') for (const i of ['st_oxyda', 'st_oxyda_open', 'st_oxyda_opening', 'st_oxydb', 'st_oxydb_open', 'st_oxydb_opening']) imgs.add(i); // flavor a (API 2), b (API 1 oxyd())
      else if (v !== 'nil' && v !== 'st_invisible') imgs.add(v === 'fl_fake_abyss' ? 'fl_abyss' : v);
    }
    // tiles a callback may set through its own tables: the supported ones (others would fail at runtime)
    // API 1: functions handed on as values (rails of lib/ant: construct → set_floor("fl-metal"))
    // escape the call analysis; floors named in the code are harmless, the supported ones may be set
    const api1Floors = lua.api1 ? [...new Set([...lua.code.matchAll(/"(fl-[\w-]+)"/g)].map((m) => api1Kind(m[1]) ?? m[1].replace(/-/g, '_')))] : [];
    for (const k of [...allTileKinds(lua.code), ...api1Floors]) {
      const v = kinds[k] === undefined ? runtimeKind(k) : null;
      if (!v || !runtimeOk(v)) continue;
      kinds[k] = v;
      if (v === 'object') objectImages(k).forEach((i) => imgs.add(i));
      else if (v === 'oxyd') for (const i of ['st_oxyda', 'st_oxyda_open', 'st_oxyda_opening', 'st_oxydb', 'st_oxydb_open', 'st_oxydb_opening']) imgs.add(i); // flavor a (API 2), b (API 1 oxyd())
      else if (v !== 'nil' && v !== 'st_invisible') imgs.add(v === 'fl_fake_abyss' ? 'fl_abyss' : v);
    }
  }
  // Meditation levels: pearls into hollows finish the level (ChangeMeditation)
  const meditation = w.actors.some((a) => /^ac_pearl/.test(a.o.k)) && objs.some((o) => o.k.startsWith('it_meditation'));
  // Oxyd stones may come during play (Pentomino: once the puzzle is done)
  if (oxyds === 0 && !meditation && kinds.st_oxyd !== 'oxyd') reject('keine Oxyd-Steine');
  else {
    // OxydStone::initColors: random ('?') stones complete odd fixed colours; an odd one left becomes a fake
    const fixed = new Map();
    let auto = 0;
    for (const row of rows) for (const ch of row) {
      const d = legend[ch];
      if (d?.stone !== 'st_oxyd') continue;
      if (d.symbol === '?') auto++;
      else fixed.set(d.symbol, (fixed.get(d.symbol) ?? 0) + 1);
    }
    const unpaired = [...fixed.values()].filter((n) => n % 2).length;
    // initColors leaves unpaired colours alone: a meditation level is won by its pearls anyway
    if (unpaired > auto && !meditation) reject('ungerade Zahl Oxyd-Steine');
  }
  if (blockers.size) return null;
  for (const i of imgs) usedImages.add(i);
  const a = w.actors.find((x) => x.o.k === 'ac_marble_black') ?? w.actors.find((x) => /^ac_pearl/.test(x.o.k)) ?? w.actors.find((x) => x.o.k === 'ac_marble_glass') ?? w.actors.find((x) => x.o.k === 'ac_marble_white');
  const mainPearl = a.o.k === 'ac_marble_black' ? null : { k: a.o.k, a: Object.fromEntries(Object.entries(a.o).filter(([k, v]) => ACTOR_ATTR.test(k) && v !== '')) };
  if (mainPearl) actorImages(a.o.k, mainPearl.a.color).forEach((i) => usedImages.add(i));
  const others = w.actors.filter((x) => x !== a).map((x) => {
    const attrs = Object.fromEntries(Object.entries(x.o).filter(([k, v]) => (ACTOR_ATTR.test(k) || (needsLua && /^(name|_\w+)$/.test(k))) && v !== ''));
    if (passiveWhite && x.o.k === 'ac_marble_white') attrs.passive = 'true';
    if (/^ac_marble_(white|black)$/.test(x.o.k) && x.o.owner === undefined) {
      attrs.passive = 'true';
      attrs.ownerless = 'true';
    }
    actorImages(x.o.k, attrs.color).forEach((i) => usedImages.add(i));
    return { k: x.o.k, x: Math.round(x.x * 1000) / 1000, y: Math.round(x.y * 1000) / 1000, ...(Object.keys(attrs).length ? { a: attrs } : {}) };
  });
  // Rubber bands: anchors as actor index (0 = black marble, n = actors[n - 1]) or stone centre.
  const actorIndex = new Map();
  [a, ...w.actors.filter((x) => x !== a)].forEach((x, i) => {
    actorIndex.set('#' + x.o.$id, i);
    if (x.o.name) actorIndex.set(x.o.name, i);
  });
  // it_rubberband: an actor anchor becomes "a:<index>"; other anchors stay names (objects, "@@pattern")
  for (const o of objs) {
    if (o.k !== 'it_rubberband') continue;
    if (!o.a.anchor2) continue;
    if (actorIndex.has(o.a.anchor2)) o.a.anchor2 = `a:${actorIndex.get(o.a.anchor2)}`;
  }
  const rubbers = [];
  for (const rb of w.rubberbands ?? []) {
    const i1 = actorIndex.get(rb.anchor1);
    let b = actorIndex.get(rb.anchor2);
    let anchorStone = null;
    if (b === undefined) {
      const st = [...allCells(w)].find((c) => c.o.k.startsWith('st_') && ('#' + c.o.$id === rb.anchor2 || c.o.name === rb.anchor2));
      // Bands to stones that move (boxes, boulders …) follow the stone object (its $id) each step.
      if (st) b = [st.x + 0.5, st.y + 0.5];
      if (st && /^st_(box|puzzle|stoneimpulse|brownie|boulder|rotator|swap|pull|turnstile)/.test(st.o.k)) anchorStone = st.o.$id;
    }
    if (i1 === undefined || b === undefined) {
      reject('Gummiband an bewegtem oder unbekanntem Anker');
      continue;
    }
    const def = { a: i1, b };
    if (anchorStone) def.stone = anchorStone;
    for (const key of ['strength', 'length', 'threshold', 'min', 'max']) {
      const v = Number(rb[key]);
      if (rb[key] !== '' && Number.isFinite(v)) def[key] = Math.round(v * 10000) / 10000;
    }
    rubbers.push(def);
  }
  if (blockers.size) return null;
  // Lua: names and custom attributes of floors and plain stones (objects carry their own).
  let luaPart = null;
  if (needsLua) {
    // fl_ref only stands in for a named floor (messages): the floor keeps its own attributes here
    const inObjs = new Set(objs.filter((o) => o.k !== 'fl_ref').map((o) => o.a.$id));
    const named = [];
    for (const c of allCells(w)) {
      if (inObjs.has(c.o.$id)) continue;
      const a = Object.fromEntries(Object.entries(c.o).filter(([k, v]) => /^(name|_\w+)$/.test(k) && v !== ''));
      if (Object.keys(a).length) named.push({ l: c.o.k.slice(0, 2), x: c.x, y: c.y, a });
    }
    const black = Object.fromEntries(Object.entries(a.o).filter(([k, v]) => /^(name|_\w+)$/.test(k) && v !== ''));
    luaPart = { code: lua.code, kinds, named, ...(Object.keys(black).length ? { marble: black } : {}), ...(lua.libs.length ? { libs: lua.libs.map((l) => l.name) } : {}) };
  }
  return {
    id: `enigma:${exp.id}`,
    title: meta.title,
    author: meta.author,
    license: licence,
    map: rows,
    legend,
    start: { x: Math.round(a.x * 1000) / 1000, y: Math.round(a.y * 1000) / 1000 },
    source: { pack, file: `${meta.xpath.replace(/^\.\//, '')}.xml` },
    ...(objs.length ? { objects: objs } : {}),
    ...(others.length ? { actors: others } : {}),
    ...(rubbers.length ? { rubbers } : {}),
    ...(mainPearl ? { mainPearl: Object.keys(mainPearl.a).length ? mainPearl : { k: mainPearl.k } } : {}),
    ...(compat < 1.1 ? { compat } : {}),
    ...(fallenFloor ? { world: { ...world, FallenPuzzle: fallenFloor } } : Object.keys(world).length ? { world } : {}),
    ...(luaPart ? { lua: luaPart } : {}),
    ...(objs.some((o) => o.k === 'it_document') ? { texts: levelTexts(xml) } : {}),
  };
}

mkdirSync(OUT, { recursive: true });
const index = [];
let total = 0;
let ok = 0;
for (const pack of readPacks()) {
  const levels = [];
  for (const meta of pack.levels) {
    total++;
    const file = join(levelsDir, pack.name, `${meta.xpath.replace(/^\.\//, '')}.xml`);
    if (!existsSync(file)) {
      reject('XML fehlt');
      continue;
    }
    const xml = readFileSync(file, 'utf8');
    const exp = exportIndex.get(`${pack.name}/${meta.xpath.replace(/^\.\//, '')}`);
    if (!exp) {
      reject('nicht exportiert');
      continue;
    }
    current = `${pack.name}/${meta.xpath.replace(/^\.\//, '')} (${meta.title})`;
    if (process.env.PROGRESS) console.log('>>', current);
    const lvl = convert(pack.name, meta, xml, exp, await analyzeLua(xml, exp));
    if (lvl) levels.push(lvl);
  }
  ok += levels.length;
  if (levels.length === 0) continue;
  writeFileSync(join(OUT, `${pack.name}.json`), JSON.stringify({ pack: pack.name, title: pack.title, levels }) + '\n');
  index.push({ pack: pack.name, title: pack.title, count: levels.length, of: pack.levels.length });
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');

for (const set of GFX_SETS) {
  mkdirSync(join('public/enigma', set), { recursive: true });
  for (const img of usedImages) {
    const src = join(enigmaData, set, `${img}.png`);
    const fallback = join(enigmaData, 'gfx32', `${img}.png`);
    if (existsSync(src)) copyFileSync(src, join('public/enigma', set, `${img}.png`));
    else if (set === 'gfx32' || !existsSync(fallback)) console.warn(`Bild fehlt: ${set}/${img}`);
  }
}

const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]);
const report = [
  '# Enigma-Import',
  '',
  `${ok} von ${total} Levels übernommen (${index.length} Pakete).`,
  '',
  '| Fehlt | blockiert Levels | davon nur daran |',
  '|---|---|---|',
  ...top.map(([r, n]) => `| ${r} | ${n} | ${only.get(r) ?? 0} |`),
  '',
];
writeFileSync('tools/import-report.md', report.join('\n'));
console.log(`${ok}/${total} Levels, ${index.length} Pakete, ${usedImages.size} Bilder`);
console.log(top.slice(0, 25).map(([r, n]) => `${String(n).padStart(4)}  ${r}`).join('\n'));
