// node --test "tools/**/*.test.mjs": what the importer lets level callbacks do during play.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawCalls, luaFunctions, luaProblems } from './lua-check.mjs';

const problems = (code) => luaProblems(code, luaFunctions(code));

test('drawCalls: Schlüssel einer Karte nach der Länge des Ignorierschlüssels, bei drawRect nur eigene Zeichenketten', () => {
  const [map, rect] = drawCalls(`wo:drawMap(ti, po(6, 6), "  ", {"u y   "})\nwo:drawRect(po(1,1), po(2,2), ti({"st_oneway", state=NORTH}))`);
  assert.deepEqual(map.keys, ['u ', 'y ']);
  assert.deepEqual(rect.keys, []);
  assert.deepEqual(drawCalls('wo:drawRect(obj, obj, "-", resolver)')[0].keys, ['-']);
});

test('Zeichnen im Rückruf: mit ti und bekannten Schlüsseln erlaubt, auch wenn das Level sonst res.composer nutzt', () => {
  const ok = `ti["u "] = {"st_death"}\nti["y "] = {"it_drop"}\nwo(res.composer(ti), "  ", {"u "})\nfunction speed()\n    wo:drawMap(ti, po(6, 6), "  ", {"u y "})\nend`;
  assert.deepEqual(problems(ok), []);
  // a key ti does not know would fail during play
  assert.deepEqual(problems(ok.replace('{"u y "}', '{"u z "}')), [':drawMap']);
});

test('Zeichnen im Rückruf: res.random ja, res.composer und libmap nein', () => {
  const random = `ti["1"] = {"fl_red"}\nlocal resolver = res.random(ti, "-", {{"1", 1}})\nfunction refloor()\n    wo:drawRect(po(1,1), po(1,1), "-", resolver)\nend`;
  assert.deepEqual(problems(random), []);
  assert.deepEqual(problems(random.replace('res.random(ti, "-", {{"1", 1}})', 'res.composer(ti)')), [':drawRect']);
  assert.deepEqual(problems(`function f()\n    wo:drawMap(lib.map.new(ti), po(1,1), " ", {"#"})\nend`).includes(':drawMap'), true);
});

test('Bibliotheken: libmath bringt liblua davor mit, ihre Funktionen und Methoden gelten in Rückrufen', async () => {
  const { levelLibs, libFunctions } = await import('./lua-check.mjs');
  const libs = levelLibs('<el:dependency el:path="lib/libmath" el:id="lib/libmath" el:release="1" el:preload="true"/><el:dependency el:path="lib/natmaze"/>');
  assert.deepEqual(libs.map((l) => l.name), ['liblua', 'libmath', 'natmaze']);
  const code = 'maze = new_kruskal_maze(5, 5)\nfunction f()\n    if maze:can_go_east(1, 1) then lib.math.digits(3, 2) end\nend';
  assert.deepEqual(luaProblems(code, luaFunctions(code)).sort(), [':can_go_east', 'lib.math']);
  assert.deepEqual(luaProblems(code, new Set([...luaFunctions(code), ...libFunctions(libs)])), []);
});

test('Karten aus wo:newMap: nur die Schlüssel ihrer Zeilen, sonst jede Kachel', async () => {
  const { newMapKeys, runtimeKinds } = await import('./lua-check.mjs');
  const code = `ti["A"] = {"st_granite"}\nti["1"] = {"st_oxyd", flavor="a"}\nlocal part1 = {"  A ", " A. "}\nlocal parts = {wo:newMap(" ", part1)}\nfunction rotate()\n    wo:drawMap(ti, po(3, 3), parts[1]^MAP_ROT_CW)\nend`;
  assert.deepEqual([...newMapKeys(code)].sort(), [' ', '.', 'A']);
  assert.deepEqual(runtimeKinds(code), ['st_granite']);
  assert.equal(newMapKeys(code.replace('wo:newMap(" ", part1)', 'wo:newMap(" ", build())')), null);
  assert.deepEqual(runtimeKinds(code.replace('wo:newMap(" ", part1)', 'wo:newMap(" ", build())')).sort(), ['st_granite', 'st_oxyd']);
});

test('wo:add im Rückruf: Timer und Zähler ja, Drähte nein', () => {
  const timer = 'function f()\n    wo:add({"ot_timer", interval = 0.5, loop = false, target = "laser#*"})\nend';
  assert.deepEqual(problems(timer), []);
  assert.deepEqual(problems(timer.replace('ot_timer', 'ot_counter')), []);
  assert.deepEqual(problems('function f()\n    wo:add({"ot_wire", anchor1 = "a", anchor2 = "b"})\nend'), [':add']);
});

test('drawCalls: Zeichenketten in Indexausdrücken sind kein Ignorierschlüssel', () => {
  const [d] = drawCalls('wo:drawMap(ti, sender+sender["_pos"], " ", {"!!", " !"})');
  assert.deepEqual(d.keys, ['!']);
  assert.deepEqual(drawCalls('wo:drawMap(ti, no["anchor"]+ENE, " ", {"**", "*  *"})')[0].keys, ['*']);
});
