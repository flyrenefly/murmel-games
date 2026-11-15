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

test('wo:add im Rückruf: Timer, Zähler und Drähte (ot_wire) ja, andere Objekte nein', () => {
  const timer = 'function f()\n    wo:add({"ot_timer", interval = 0.5, loop = false, target = "laser#*"})\nend';
  assert.deepEqual(problems(timer), []);
  assert.deepEqual(problems(timer.replace('ot_timer', 'ot_counter')), []);
  assert.deepEqual(problems('function f()\n    wo:add({"ot_wire", anchor1 = "a", anchor2 = "b"})\nend'), []);
  assert.deepEqual(problems('function f()\n    wo:add({"ot_cannon", anchor1 = "a"})\nend'), [':add']);
});

test('drawCalls: Zeichenketten in Indexausdrücken sind kein Ignorierschlüssel', () => {
  const [d] = drawCalls('wo:drawMap(ti, sender+sender["_pos"], " ", {"!!", " !"})');
  assert.deepEqual(d.keys, ['!']);
  assert.deepEqual(drawCalls('wo:drawMap(ti, no["anchor"]+ENE, " ", {"**", "*  *"})')[0].keys, ['*']);
});

test('libmap geladen: Karten aus Kartenoperationen dürfen im Rückruf gezeichnet werden, und jede Kachel zählt', async () => {
  const { libFunctions, levelLibs, runtimeKinds } = await import('./lua-check.mjs');
  const libs = levelLibs('<el:dependency el:path="lib/libmap"/>');
  assert.deepEqual(libs.map((l) => l.name), ['liblua', 'libmap']);
  const code = 'ti["r#"] = {"st_granite"}\nlocal part = {"#"}\nlocal m = wo:newMap(" ", part)\nlocal big = "r" * m\nfunction f()\n    wo:drawMap(ti, po(0, 0), lib.map.sub(big, po(0, 0), po(0, 0)))\nend';
  assert.deepEqual(luaProblems(code, luaFunctions(code)).includes(':drawMap'), true);
  assert.deepEqual(luaProblems(code, new Set([...luaFunctions(code), ...libFunctions(libs)])), []);
  // "r" * map makes keys the literal rows do not have
  assert.deepEqual(runtimeKinds(code, false, undefined, true), ['st_granite']);
});

test('libmap geladen: ohne schlüsselverändernde Operationen zählen nur die Schlüssel der Kartenzeilen', async () => {
  const { runtimeKinds } = await import('./lua-check.mjs');
  const code = 'ti["A"] = {"st_granite"}\nti["O"] = {"st_oxyd"}\nlocal m = wo:newMap(" ", {"A  ", " A "})\nlocal both = m .. (m ^ MAP_ROT_CW)\nfunction f()\n    wo:drawMap(ti, po(0, 0), both)\nend';
  assert.deepEqual(runtimeKinds(code, false, undefined, true), ['st_granite']);
  assert.deepEqual(runtimeKinds(code.replace('m .. (m ^ MAP_ROT_CW)', 'm:replace("A", "O")'), false, undefined, true).sort(), ['st_granite', 'st_oxyd']);
});

test('Laufzeit-Arten: Ersatzschlüssel von res.random und ti-Verweise zählen mit, auskommentierte nicht', async () => {
  const { runtimeKinds } = await import('./lua-check.mjs');
  const code = 'ti["h1"] = {"fl_sand"}\nti["hG"] = ti["h1"] .. {"it_trap"}\n--ti["hX"] = ti["h1"] .. {"st_chameleon"}\nlocal r = res.random(ti, "h#", {{"hG", 1}})\nfunction f()\n    wo:drawRect(po(1, 1), po(1, 1), "h#", r)\nend';
  assert.deepEqual(runtimeKinds(code).sort(), ['fl_sand', 'it_trap']);
});

test('Resolver im Rückruf: res.autotile direkt im Zeichenaufruf ja, res.composer nein', () => {
  const code = `ti["+"] = {"fl_red"}\nti["="] = {"st_greenbrown_hollow"}\nfunction drawLine()\n    wo:drawMap(res.autotile(ti), po(1, 1), " ", {"  +="})\nend`;
  assert.deepEqual(problems(code), []);
  assert.deepEqual(problems(code.replace('res.autotile', 'res.composer')).sort(), [':drawMap', 'res.composer']);
});

test('callbacksBuild: nur Funktionen, die die Welt ändern, zählen', async () => {
  const { callbacksBuild } = await import('./lua-check.mjs');
  assert.equal(callbacksBuild('ti["x"] = {"fl_bridge", name="bridge%%#"}\nwo(ti, " ", {"x"})'), false);
  assert.equal(callbacksBuild('function f()\n    no["a"]["adhesion"] = 0\nend'), false);
  assert.equal(callbacksBuild('function f()\n    wo[po(1, 1)] = ti["x"]\nend'), true);
  assert.equal(callbacksBuild('function f()\n    wo:drawMap(ti, po(1, 1), " ", {"x"})\nend'), true);
});

test('Laufzeit-Arten: eine Art im Zeichenaufruf ist kein Kartenschlüssel', async () => {
  const { runtimeKinds } = await import('./lua-check.mjs');
  const code = 'ti["~"] = {"fl_water"}\nti["o"] = {"st_oxyd_d"} .. ti["~"]\nfunction f()\n    wo:drawRect({2,0},{17,0},{"it_cross"} .. ti({"st_nil"}))\nend';
  assert.deepEqual(runtimeKinds(code).sort(), ['it_cross', 'st_nil']);
});

test('pos:grid() im Rückruf ist erlaubt (Lissajous: Todesstein auf der Lissajous-Kurve)', () => {
  assert.deepEqual(problems('function cb()\n  local c = po(8.0 * math.cos(1) + 10.0, 6.5):grid()\n  wo[c] = {"st_death"}\nend'), []);
});

test('wo:add(YIN, {sender["_type"]}): erlaubt, wenn _type überall ein Gegenstand ist (Puzzle Shift)', async () => {
  const { runtimeKinds } = await import('./lua-check.mjs');
  const code = 'ti["H"] = {"st_switch", target = "f", _type = "it_puller_n"}\nti["I"] = {"st_switch", target = "f", _type = "it_puller_e"}\nfunction f(v, sender)\n  wo:add(YIN, {sender["_type"]})\nend';
  assert.deepEqual(problems(code), []);
  assert.deepEqual([...runtimeKinds(code)].filter((k) => k.startsWith('it_puller')).sort(), ['it_puller_e', 'it_puller_n']);
  assert.deepEqual(problems(code.replace('"it_puller_e"', '"st_box"')), [':add']);
});

test('Laufzeit-Arten: ti-Verweise in Rückrufen folgen verschachtelten Einträgen (Bizarro World)', async () => {
  const { runtimeKinds } = await import('./lua-check.mjs');
  const code = 'ti["l"] = {"fl_lawn"}\nti[";"] = {"st_invisible", "gate"} .. ti["l"]\nfunction cb()\n  wo[no["gate"]] = ti[";"]\nend';
  assert.deepEqual([...runtimeKinds(code)].sort(), ['fl_lawn', 'st_invisible']);
});

test('API 1: Spiegel mit Richtung im Namen ("st-mirror-3>") sind Laufzeit-Arten (Print 23)', async () => {
  const { runtimeKinds, api1Kind } = await import('./lua-check.mjs');
  assert.equal(api1Kind('st-mirror-3<t'), 'st_mirror_triangle_wt');
  assert.deepEqual(runtimeKinds('function add3()\n  set_stone("st-mirror-3>", 5, 1)\nend', true).filter((k) => k.includes('mirror')), ['st_mirror_triangle_e']);
});

test('Gummibänder/Drähte eines Objekts als Lua-Objekte (sender["rubbers"]) werden abgelehnt', () => {
  assert.deepEqual(problems('function cb(v, sender)\n  sender["rubbers"]:kill()\nend'), ['obj.rubbers']);
});

test('Laufzeit-Arten: Akteure als "#ac_…" und in ti-Einträgen (Road to Eden, Tutoxyd\'s Pyramid)', async () => {
  const { runtimeKinds } = await import('./lua-check.mjs');
  const code = 'ti["k"] = {"#ac_killer", "killer"}\nfunction addRotor()\n  wo[po(8.5, 11.5)] = {"#ac_rotor", range = 40}\n  wo[po(1, 1)] = ti["k"]\nend';
  assert.deepEqual([...runtimeKinds(code)].sort(), ['ac_killer', 'ac_rotor']);
});

test('Laufzeit-Arten: eingerückte Funktionen zählen (4 - 8 - 4)', async () => {
  const { runtimeKinds } = await import('./lua-check.mjs');
  const code = ' ti["E#"] = {"st_yellow"}\n function blockE()\n  if true then\n   wo[no["t#*"]] = ti["E#"]\n  end\n end\n';
  assert.deepEqual(runtimeKinds(code), ['st_yellow']);
});

test('API 1: fl-gradient mit type im Rückruf kann jede Gefällform setzen (Tilt Board)', async () => {
  const { runtimeKinds } = await import('./lua-check.mjs');
  const kinds = runtimeKinds('function tilt(on, sender)\n  draw_floor("fl-gradient", {5, 1}, {1, 0}, 11, {type = gdir})\nend', true, ['tilt']);
  assert.ok(['fl_slope_ps', 'fl_slope_ise', 'fl_slope_tw', 'fl_slope_tnr'].every((k) => kinds.includes(k)));
});

test('API 1 erkannt nur an echten API-1-Aufrufen: eigene draw_…-Funktion und enigma.random zählen nicht', () => {
  assert.deepEqual(problems('function draw_line()\n  wo:drawRect(po(1, 1), po(2, 2), ti["#"])\nend\nfunction cb()\n  draw_line()\nend\nti["#"] = {"st_granite"}'), []);
  assert.deepEqual(problems('function cb()\n  no["timer"]["interval"] = enigma.random(3, 12)\nend'), []);
  assert.deepEqual(problems('function cb()\n  set_stone("st-rock1", 1, 1)\nend').includes('API 1'), true);
});

test('Laufzeit-Arten: Vorschau-Zweig von cond(wo["CreatingPreview"], …) und der Ignorierschlüssel von drawMap zählen nicht (Sunrise Sunset)', async () => {
  const { runtimeKinds, playBranch } = await import('./lua-check.mjs');
  assert.equal(playBranch('ti["A"] = cond(wo["CreatingPreview"], {"#ac_marble_black"}, ti[" "])'), 'ti["A"] = ti[" "]');
  const code = 'ti[" "] = {"fl_sand"}\nti["A"] = cond(wo["CreatingPreview"], {"#ac_marble_black"}, ti[" "])\nti["@"] = ti[" "] .. {"#ac_marble_black"}\nfunction draw_line()\n  wo:drawMap(ti, po(1, 0), "@", {"A@A"})\nend';
  assert.deepEqual(runtimeKinds(code), ['fl_sand']);
});
