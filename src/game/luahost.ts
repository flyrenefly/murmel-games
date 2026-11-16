/**
 * The running level as seen from Lua (src/lua): object references, attributes, messages and
 * tile changes. References are strings: "o:<id>" interactive objects, "c:<fl|st>:<x>:<y>"
 * plain floors and stones, "a:<n>" actors (0 = black marble, n = level.actors[n − 1]).
 */
import type { LuaHost } from '../lua/runtime';
import { Enemy, enemyKind } from './actors';
import { oxydSymbol, type Level } from './level';
import type { GameObject, ObjectWorld } from './objects';
import type { PhysicsWorld } from './physics';
import type { Rubberband } from './rubber';
import { OBJECT_LIST } from '../lua/runtime';

export interface LuaWorld {
  level: Level;
  objects: ObjectWorld;
  physics: PhysicsWorld;
  /** Floors or plain stones changed: redraw. */
  redraw(): void;
  random(): number;
  /** wo[pos] = {"st_oxyd", …} during play: a new closed Oxyd stone at a cell (its flavor, oxydcolor as symbol or '?'). */
  addOxyd?(x: number, y: number, flavor: string, symbol?: string): void;
  /** An Oxyd stone killed or replaced during play (kill(), wo[pos] = other stone): it leaves the game. */
  removeOxyd?(x: number, y: number): void;
  /** wo:shuffleOxyd() during play: colour new Oxyd stones, deal the closed ones' colours anew. */
  shuffleOxyd?(): void;
  /** OxydStone oxydcolor set during play (Ingrowing colours each new cross): the stone's symbol. */
  setOxydColor?(x: number, y: number, symbol: string): void;
  /** obj:sound(name, volume) during play. */
  sound?(name: string, volume: number): void;
}

/** The physics body of actor ref a:<n> (n ≥ 1) if it is an enemy, counted like PhysicsWorld (enemy kinds only). */
export function enemyOf(level: Level, physics: PhysicsWorld, n: number): Enemy | null {
  const a = level.actors[n - 1];
  if (!a || !enemyKind(a.k)) return null;
  return physics.enemies[level.actors.slice(0, n - 1).filter((x) => enemyKind(x.k)).length] ?? null;
}

/** SlopeFloor.cc: shape → direction index (xforce/yforce), as tools/import-enigma.mjs SLOPE_DIR. */
const SLOPE_DIR: Record<string, number> = { '': -1, pw: 0, ps: 1, pe: 2, pn: 3, inw: 4, isw: 5, ise: 6, ine: 7, onw: 4, osw: 5, ose: 6, one: 7, tw: 0, ts: 1, te: 2, tn: 3, twl: 4, tsl: 5, tel: 6, tnl: 7, twr: 5, tsr: 6, ter: 7, tnr: 4 };
const SLOPE_X = [-1, 0, 1, 0, -1, -1, 1, 1];
const SLOPE_Y = [0, 1, 0, -1, -1, 1, 1, -1];

/**
 * Floor::add_force of a floor Lua sets during play, like the importer stores it: force_x/force_y,
 * else for fl_slope_<shape> the direction (attribute `slope` or the shape) normalised × `strength`
 * or the world's SlopeStrength. Null: no force.
 */
export function floorForce(kind: string, a: Record<string, string>, slopeStrength: number): [number, number] | null {
  const fx = Number(a.force_x) || 0;
  const fy = Number(a.force_y) || 0;
  if (fx !== 0 || fy !== 0) return [fx, fy];
  const m = /^fl_slope(?:_(\w+))?$/.exec(kind);
  if (!m) return null;
  const dir = a.slope !== undefined && a.slope !== '' ? Number(a.slope) : SLOPE_DIR[m[1] ?? ''];
  if (!(dir >= 0 && dir < 8)) return null;
  const s = a.strength !== undefined && a.strength !== '' ? Number(a.strength) : slopeStrength;
  const n = Math.hypot(SLOPE_X[dir], SLOPE_Y[dir]);
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return [r((SLOPE_X[dir] / n) * s), r((SLOPE_Y[dir] / n) * s)];
}

const glob = (p: string): RegExp => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
const truthy = (v: string | null): boolean => v === null || (v !== 'false' && v !== '0' && v !== '');

/** Applies wo["GlobalForce"] / wo["FrictionStrength"] / wo["ElectricStrength"] to the physics; returns the force. */
export function applyWorld(physics: PhysicsWorld, world: Record<string, string>, force: { x: number; y: number }): void {
  const g = /^(-?[\d.e-]+),(-?[\d.e-]+)$/.exec(world.GlobalForce ?? '');
  force.x = g ? Number(g[1]) : 0;
  force.y = g ? Number(g[2]) : 0;
  const f = Number(world.FrictionStrength);
  physics.frictionFactor = world.FrictionStrength !== undefined && Number.isFinite(f) ? f : 1;
  const e = Number(world.ElectricStrength);
  physics.electricForce = world.ElectricStrength !== undefined && Number.isFinite(e) ? e : 15;
}

export function makeLuaHost(w: LuaWorld, world: Record<string, string>, force: { x: number; y: number }): LuaHost {
  const { level, objects, physics } = w;
  const lua = level.lua!;
  /** Names and custom attributes of plain floors/stones and actors. */
  const attrs = new Map<string, Record<string, string>>();
  for (const n of lua.named) attrs.set(`c:${n.l}:${n.x}:${n.y}`, { ...n.a });
  attrs.set('a:0', { ...(lua.marble ?? {}) });
  level.actors.forEach((a, i) => attrs.set(`a:${i + 1}`, { ...(a.a ?? {}) }));

  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < level.width && y < level.height;
  const cell = (x: number, y: number) => level.cells[y * level.width + x];
  const byId = (ref: string): GameObject | null => {
    const id = ref.slice(2);
    // a picked-up item lives on in the inventory (Enigma: GetNamedObject still finds it, at its last cell)
    return objects.objects.find((o) => o.id === id && (!o.gone || o.picked)) ?? null;
  };
  const parse = (ref: string) => {
    const [, l, x, y] = ref.split(':');
    return { l, x: Number(x), y: Number(y) };
  };
  /**
   * The marble of actor ref a:<i> as PhysicsWorld orders them (0 = main ball, then the black and
   * white marbles of level.actors, then its pearls, each in actor order), or -1 for other actors.
   */
  const marbleIndex = (i: number): number => {
    if (i === 0) return 0;
    const a = level.actors[i - 1];
    const before = level.actors.slice(0, i - 1);
    const ball = (k: string) => k === 'ac_marble_white' || k === 'ac_marble_black';
    const pearl = (k: string) => /^ac_pearl(_white|_black)?$/.test(k);
    let m = -1;
    if (a && ball(a.k)) m = 1 + before.filter((x) => ball(x.k)).length;
    else if (a && pearl(a.k)) m = 1 + level.actors.filter((x) => ball(x.k)).length + before.filter((x) => pearl(x.k)).length;
    return m > 0 && physics.marbles[m] ? m : -1;
  };
  const actorPos = (i: number): [number, number] => {
    const m = marbleIndex(i);
    if (m >= 0) return [physics.marbles[m].pos.x, physics.marbles[m].pos.y];
    const a = level.actors[i - 1];
    const e = enemyOf(level, physics, i);
    return e ? [e.pos.x, e.pos.y] : [a?.x ?? 0, a?.y ?? 0];
  };
  const uniqueName = (name: string): string => {
    if (!name.endsWith('#')) return name;
    for (;;) {
      const n = `${name}${1 + Math.floor(w.random() * 999999)}`;
      if (host.find(n).length === 0) return n;
    }
  };
  /** Wires made during play (ot_wire), by name: "w:<name>" refs; the stones carry them as fellows. */
  const wires = new Map<string, [GameObject, GameObject]>();
  const wireAlive = (n: string) => {
    const w2 = wires.get(n);
    return !!w2 && !w2[0].gone && !w2[1].gone;
  };
  const tokens = (o: GameObject) => (o.attrs.fellows ?? '').split(/[;,]/).map((t) => t.trim()).filter((t) => t !== '');
  const unwire = (a: GameObject, b: GameObject) => {
    a.attrs.fellows = tokens(a).filter((t) => t !== `#${b.id}`).join(',');
    b.attrs.fellows = tokens(b).filter((t) => t !== `#${a.id}`).join(',');
  };
  const removeStone = (x: number, y: number) => {
    const o = objects.stoneObjectAt(x, y);
    if (o) objects.remove(o);
    if (cell(x, y).stone === 'st_oxyd' && w.removeOxyd) w.removeOxyd(x, y);
    if (cell(x, y).stone !== null && cell(x, y).stone !== 'st_oxyd') {
      cell(x, y).stone = null;
      delete cell(x, y).hollow;
      physics.setSolid(x, y, false);
    }
    attrs.delete(`c:st:${x}:${y}`);
  };

  /** Slope floors scale their force (direction × SlopeForce) from the old to the new strength. */
  const scaleSlopes = (from: number, to: number) => {
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0 || from === to) return;
    for (const c of level.cells) {
      if (!c.floor.startsWith('fl_slope') || !c.force) continue;
      c.force = [c.force[0] * (to / from), c.force[1] * (to / from)];
    }
  };

  /**
   * Horse::setAttr / Object::getDestinationByIndex: every destination at its cell centre
   * (centeredPos) – a position "x,y", or the objects a name finds; a name that finds nothing adds none.
   */
  const setHorse = (e: Enemy, key: string, value: string | null) => {
    if (key === 'destination') {
      const pts: [number, number][] = [];
      const centre = (x: number, y: number): [number, number] => [Math.floor(x) + 0.5, Math.floor(y) + 0.5];
      const pos = /^(-?[\d.]+),(-?[\d.]+)$/.exec(value ?? '');
      if (pos) pts.push(centre(Number(pos[1]), Number(pos[2])));
      else for (const t of (value ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
        for (const r of host.find(t)) pts.push(centre(...host.pos(r)));
      }
      e.dests = pts; // nil: no destination, the horse stops (AUTOMOVE off)
      e.destIdx = 0;
      e.newDest = true;
    } else if (key === 'destidx') {
      e.destIdx = Math.trunc(Number(value) || 0);
      e.newDest = e.destIdx >= 0;
    } else if (key === 'strength') e.horseStrength = Number(value ?? 10);
    else if (key === 'steady') e.steady = truthy(value) && value !== '0';
    else e.loop = truthy(value) && value !== '0';
  };

  /** A band from the marble (index) or another actor's body to the stone a2 (following it when it moves). */
  const stoneBand = (from: number | Enemy, a2: string, def: Parameters<PhysicsWorld['addRubber']>[3]) => {
    const [x, y] = host.pos(a2);
    const follow = a2.startsWith('o:') ? () => { const o = byId(a2); return o ? { x: o.col + 0.5, y: o.row + 0.5 } : null; } : undefined;
    physics.addRubber(from, x + 0.5, y + 0.5, def, follow);
  };
  /** Rubber bands as Lua objects ("r:<n>", numbered as Lua first meets them): fellows, rubbers, kill. */
  const bandIds = new Map<Rubberband, number>();
  const bandRef = (r: Rubberband): string => {
    let n = bandIds.get(r);
    if (n === undefined) bandIds.set(r, (n = bandIds.size + 1));
    return `r:${n}`;
  };
  const bandOf = (ref: string): Rubberband | null => physics.rubbers.find((r) => bandIds.get(r) === Number(ref.slice(2))) ?? null;
  /** The actor ref of a band's body. */
  const bodyRef = (b: unknown): string | null => {
    for (let i = 0; i <= level.actors.length; i++) {
      const m = marbleIndex(i);
      if ((m >= 0 ? physics.marbles[m] : enemyOf(level, physics, i)) === b) return `a:${i}`;
    }
    return null;
  };
  /** Both anchors of a band: actors, or the stone at the fixed end. */
  const anchors = (r: Rubberband): (string | null)[] => [bodyRef(r.a1), r.a2 ? bodyRef(r.a2) : host.at('st', Math.floor(r.end.x), Math.floor(r.end.y))];
  /** Object.cc "fellows" / "rubbers": the other anchors of an object's bands (and its wire fellows) / the bands. */
  const fellows = (ref: string): string[] => {
    const out: string[] = [];
    for (const r of physics.rubbers) {
      const [a, b] = anchors(r);
      if (a === ref && b) out.push(b);
      else if (b === ref && a) out.push(a);
    }
    const o = ref.startsWith('o:') ? byId(ref) : null;
    // wire fellows: "#<id>" of wires made during play, names from the export (whose actors are the band
    // partners at the start – those come from the bands above, as they are now)
    if (o) for (const t of tokens(o)) out.push(...(/^#\d+$/.test(t) ? [`o:${t.slice(1)}`] : host.find(t).filter((r) => !r.startsWith('a:'))));
    return [...new Set(out)];
  };
  const rubbers = (ref: string): string[] => physics.rubbers.filter((r) => anchors(r).includes(ref)).map(bandRef);

  const host: LuaHost = {
    initSteps: lua.initSteps,
    initNames: lua.initNames,
    actorRef(marble) {
      for (let i = 0; i <= level.actors.length; i++) if (marbleIndex(i) === marble) return `a:${i}`;
      return null;
    },
    find(pattern) {
      const re = glob(pattern);
      const refs: string[] = [];
      // fl_ref objects stand for named floors, which Lua addresses as cells (c:fl:x:y)
      for (const o of objects.objects) if ((!o.gone || o.picked) && o.name && re.test(o.name)) refs.push(o.cls === 'floorref' ? `c:fl:${o.col}:${o.row}` : `o:${o.id}`);
      for (const [ref, a] of attrs) if (a.name && re.test(a.name) && host.exists(ref) && !refs.includes(ref)) refs.push(ref);
      for (const n of wires.keys()) if (re.test(n) && wireAlive(n)) refs.push(`w:${n}`);
      return refs;
    },
    at(l, x, y) {
      if (!inside(x, y)) return null;
      if (l === 'fl') return `c:fl:${x}:${y}`;
      if (l === 'st') {
        const o = objects.stoneObjectAt(x, y);
        if (o) return `o:${o.id}`;
        return cell(x, y).stone !== null ? `c:st:${x}:${y}` : null;
      }
      const it = objects.itemAt(x, y);
      return it ? `o:${it.id}` : null;
    },
    exists(ref) {
      if (ref.startsWith('o:')) return byId(ref) !== null;
      if (ref.startsWith('r:')) return bandOf(ref) !== null;
      if (ref.startsWith('w:')) return wireAlive(ref.slice(2));
      if (ref.startsWith('a:')) return true;
      const { l, x, y } = parse(ref);
      return inside(x, y) && (l === 'fl' || cell(x, y).stone !== null);
    },
    pos(ref) {
      if (ref.startsWith('o:')) {
        const o = byId(ref);
        return o ? [o.col, o.row] : [0, 0];
      }
      if (ref.startsWith('a:')) return actorPos(Number(ref.slice(2)));
      if (ref.startsWith('w:')) {
        const a = wires.get(ref.slice(2))?.[0];
        return a ? [a.col, a.row] : [0, 0];
      }
      const { x, y } = parse(ref);
      return [x, y];
    },
    get(ref, key) {
      if (ref.startsWith('w:')) return key === 'name' ? ref.slice(2) : key === 'kind' ? 'ot_wire' : null;
      if (ref.startsWith('r:')) return key === 'kind' ? 'ot_rubberband' : null;
      if (key === 'fellows') return OBJECT_LIST + fellows(ref).join(',');
      if (key === 'rubbers') return OBJECT_LIST + rubbers(ref).join(',');
      if (ref.startsWith('o:')) {
        const o = byId(ref);
        if (!o) return null;
        if (key === 'name') return o.name || null;
        if (key === 'kind') return o.kind;
        if (key === 'state') return String(o.state);
        // PuzzleStone: hollow is an object flag; intensity (libpuzzle's shuffle) defaults to 3 (objects.xml)
        if (o.cls === 'puzzle' && key === 'hollow') return o.attrs.$hollow === 'true' ? 'true' : 'false';
        if (o.cls === 'puzzle' && key === 'intensity') return o.attrs.intensity ?? '3';
        // connections: the open sides as Enigma names them (n, e, s, w in this order)
        if (o.cls === 'puzzle' && key === 'connections') {
          const c = Number(o.attrs.$connections) || 0;
          return ([[8, 'n'], [4, 'e'], [2, 's'], [1, 'w']] as const).filter(([b]) => c & b).map(([, d]) => d).join('');
        }
        return o.attrs[key] ?? null;
      }
      if (key === 'kind' && ref.startsWith('c:')) {
        const { l, x, y } = parse(ref);
        return l === 'fl' ? cell(x, y).floor : cell(x, y).stone;
      }
      // Actor::getAttr("adhesion"): factor on the mouse force (marbles 1.0, killers 2.0)
      if (key === 'adhesion' && ref.startsWith('a:')) {
        const n = Number(ref.slice(2));
        const m = marbleIndex(n);
        if (m >= 0) return String(physics.marbles[m].adhesion ?? 1);
        const e = enemyOf(level, physics, n);
        if (e?.kind === 'killer') return String(e.mouseFactor);
      }
      return attrs.get(ref)?.[key] ?? null;
    },
    set(ref, key, value) {
      // Horse::setAttr: destinations and movement of a horse change during play (Ariadne, Pairs II)
      if (ref.startsWith('a:') && /^(destination|destidx|strength|steady|loop)$/.test(key)) {
        const e = enemyOf(level, physics, Number(ref.slice(2)));
        if (e?.kind === 'horse') setHorse(e, key, value);
      }
      // Actor::setAttr("adhesion") of a marble or killer (Tutoxyd's Pyramid curses the legs)
      if (key === 'adhesion' && ref.startsWith('a:')) {
        const n = Number(ref.slice(2));
        const v = Number(value ?? '');
        const m = marbleIndex(n);
        if (m >= 0) physics.marbles[m].adhesion = Number.isFinite(v) ? v : 1;
        const e = enemyOf(level, physics, n);
        if (e?.kind === 'killer') e.mouseFactor = Number.isFinite(v) ? v : 2;
      }
      // OxydStone::setAttr("oxydcolor"): a named stone (its st_oxyd_ref) or a plain one of the map
      if (key === 'oxydcolor' && (ref.startsWith('c:st:') || byId(ref)?.kind === 'st_oxyd_ref')) {
        const [x, y] = host.pos(ref);
        const symbol = oxydSymbol(value);
        if (symbol) w.setOxydColor?.(x, y, symbol);
      }
      if (ref.startsWith('o:')) {
        const o = byId(ref);
        if (!o) return;
        if (key === 'name') o.name = value ?? '';
        // TimerGadget::setState: sender.state = OFF stops the timer (ON starts it)
        if (key === 'state' && o.cls === 'timer') {
          objects.sendMessage(o, truthy(value) ? 'on' : 'off', truthy(value));
          return;
        }
        if (value === null) delete o.attrs[key];
        else o.attrs[key] = value;
        return;
      }
      const a = attrs.get(ref) ?? {};
      if (value === null) delete a[key];
      else a[key] = value;
      attrs.set(ref, a);
      // Floor::add_force: force_x / force_y of a floor change its constant force
      if (ref.startsWith('c:fl:') && (key === 'force_x' || key === 'force_y')) {
        const { x, y } = parse(ref);
        const c = cell(x, y);
        const f = c.force ?? [0, 0];
        const v = Number(value) || 0;
        c.force = key === 'force_x' ? [v, f[1]] : [f[0], v];
      }
    },
    send(ref, msg, value) {
      if (ref.startsWith('c:fl:')) {
        // plain floors: fire and flood messages
        const { x, y } = parse(ref);
        objects.floorMessage(x, y, msg, truthy(value) && value !== '0');
        return;
      }
      if (!ref.startsWith('o:')) return; // plain stones ignore messages
      const o = byId(ref);
      // a number travels along (orientate EAST, signal 0/1)
      const n = value === null || value === '' ? NaN : Number(value);
      if (o) objects.sendMessage(o, msg, truthy(value) && n !== 0, Number.isFinite(n) ? n : undefined);
    },
    kill(ref) {
      if (ref.startsWith('r:')) {
        const r = bandOf(ref);
        if (r) physics.removeRubber(r);
        return;
      }
      if (ref.startsWith('w:')) {
        const pair = wires.get(ref.slice(2));
        if (pair) unwire(...pair);
        wires.delete(ref.slice(2));
        w.redraw();
        return;
      }
      if (ref.startsWith('o:')) {
        const o = byId(ref);
        if (o) objects.remove(o);
        return;
      }
      const { l, x, y } = parse(ref);
      if (l === 'st') {
        removeStone(x, y);
        w.redraw();
      }
    },
    setTile(x, y, kind, a) {
      if (!inside(x, y)) return;
      const look = lua.kinds[kind];
      if (look === undefined) throw new Error(`Murmel kann ${kind} nicht setzen`);
      const decl = { ...a };
      if (decl.name) decl.name = uniqueName(decl.name);
      if (kind.startsWith('fl_')) {
        if (look === 'nil') return;
        // the floor's state object (BridgeFloor) goes with the old floor
        for (const o of objects.objects) if (!o.gone && o.cls === 'bridge' && o.col === x && o.row === y) objects.remove(o);
        attrs.delete(`c:fl:${x}:${y}`);
        delete cell(x, y).force;
        const bridge = /^fl_bridge(?:_(gc|bw|bs|be|bn))?$/.exec(kind);
        if (bridge && look === 'object') {
          // BridgeFloor: floor image fl_bridge_<gc|bw>_<open|closed> plus the object fl_bridge, as the import makes them
          const flavor = decl.flavor || bridge[1] || 'gc';
          const open = decl.state === undefined || decl.state === '' || Number(decl.state) !== 0;
          cell(x, y).floor = `${flavor === 'gc' ? 'fl_bridge_gc' : 'fl_bridge_bw'}_${open ? 'open' : 'closed'}`;
          objects.create('fl_bridge', x, y, { ...decl, flavor, $state: open ? '1' : '0' });
          objects.floorChanged(x, y);
          w.redraw();
          return;
        }
        cell(x, y).floor = look;
        // slopes and floors with force_x/force_y pull like those of the map
        const f = floorForce(kind, decl, Number(world.SlopeStrength ?? 25));
        if (f) cell(x, y).force = f;
        attrs.set(`c:fl:${x}:${y}`, decl);
        // BoxStone::on_floor_change: a box on new abyss, water or swamp sinks
        objects.floorChanged(x, y);
      } else if (kind.startsWith('st_')) {
        removeStone(x, y);
        if (look === 'oxyd') {
          // OxydStone: a closed stone of the flavor (st_oxyd_d: d, default "a"); named ones receive messages
          // oxydcolor: a fixed colour (OXYD_BLUE = 0 → symbol A, as the importer maps it), else '?'
          w.addOxyd?.(x, y, decl.flavor ?? /^st_oxyd_([a-e])$/.exec(kind)?.[1] ?? 'a', oxydSymbol(decl.oxydcolor) ?? '?');
          if (decl.name) objects.create('st_oxyd_ref', x, y, { name: decl.name });
        } else if (look === 'object') objects.create(kind, x, y, decl);
        else if (look !== 'nil') {
          // st_<stone>_hollow (OBJBIT_HOLLOW): the stone's look, actors pass (as cell.hollow from the map)
          const hollow = /_hollow$/.test(kind);
          cell(x, y).stone = look;
          if (hollow) cell(x, y).hollow = true;
          physics.setSolid(x, y, !hollow);
          attrs.set(`c:st:${x}:${y}`, decl);
        }
      } else if (kind.startsWith('it_')) {
        const it = objects.itemAt(x, y);
        if (it) objects.remove(it);
        if (look === 'object') objects.create(kind, x, y, decl);
      } else throw new Error(`Murmel kann ${kind} nicht setzen`);
      w.redraw();
    },
    addActor(x, y, kind, a) {
      // lua.cc setObjectByTable → AddActor: rotors, tops, killers and bugs (lua.kinds 'actor'); outside the level nothing
      const ek = enemyKind(kind);
      if (lua.kinds[kind] !== 'actor' || !ek) throw new Error(`Murmel kann ${kind} nicht setzen`);
      if (!inside(Math.floor(x), Math.floor(y))) return;
      const decl = { ...a };
      if (decl.name) decl.name = uniqueName(decl.name);
      const def = { k: kind, x, y, ...(Object.keys(decl).length ? { a: decl } : {}) };
      // appended to both lists, so a:<n> keeps pointing at the same body (enemyOf, actorPos)
      level.actors.push(def);
      physics.enemies.push(new Enemy(ek, def));
      attrs.set(`a:${level.actors.length}`, decl);
    },
    world(key) {
      if (key === 'GlobalForce') return `${force.x},${force.y}`;
      if (key === 'FrictionStrength') return String(physics.frictionFactor);
      return world[key] ?? null;
    },
    setWorld(key, value) {
      // wo["SlopeStrength"] (server::SlopeForce): slopes without their own strength pull with the new force
      if (key === 'SlopeStrength') scaleSlopes(Number(world.SlopeStrength ?? 25), Number(value ?? 25));
      if (value === null) delete world[key];
      else world[key] = value;
      if (key === 'GlobalForce' || key === 'FrictionStrength' || key === 'ElectricStrength') applyWorld(physics, world, force);
    },
    size: () => [level.width, level.height],
    /** PuzzleStone "get_cluster" / "get_adjacents": the stones of the fragment / of the huddle (none for other objects). */
    cluster(ref, adjacent) {
      const o = ref.startsWith('o:') ? byId(ref) : null;
      if (!o || o.cls !== 'puzzle') return [];
      return (adjacent ? objects.puzzleAdjacents(o) : objects.puzzleFragment(o).cluster).map((p) => `o:${p.id}`);
    },
    shuffleOxyd() {
      w.shuffleOxyd?.();
    },
    sound(name, volume) {
      w.sound?.(name, volume);
    },
    /** wo:add(YIN/YANG, {"it_…"}) during play: the item into that player's inventory. */
    addInventory(player, kind, text) {
      // DocumentItem: Murmel reads documents when they are picked up instead of carrying them
      if (kind === 'it_document') {
        objects.showText(text ?? '');
        return;
      }
      const inv = objects.inventories[Number(player)] ?? objects.inventory;
      if (inv.length < 13) inv.unshift(String(kind));
      w.redraw();
    },
    /**
     * wo:add({"ot_timer"/"ot_counter", …}) during play: a gadget without a cell, as the importer
     * makes them from the init (TimerGadget ON unless state is OFF; CounterGadget state 0).
     */
    addObject(kind, attrs) {
      if (kind !== 'ot_timer' && kind !== 'ot_counter') throw new Error(`Murmel kann ${kind} nicht hinzufügen`);
      const decl = { ...attrs };
      if (decl.name) decl.name = uniqueName(decl.name);
      decl.$state = kind === 'ot_counter' ? String(Math.trunc(Number(attrs.state)) || 0) : attrs.state === '0' || attrs.state === 'false' ? '0' : '1';
      objects.create(kind, -1, -1, decl);
    },
    /**
     * wo:add({"ot_wire", name?, anchor1, anchor2}) during play: both stones become fellows
     * (Stone::propagateImpulse moves them together; the classic renderer draws the line).
     */
    addWire(a1, a2, name) {
      const a = a1?.startsWith('o:') ? byId(a1) : null;
      const b = a2?.startsWith('o:') ? byId(a2) : null;
      if (!a || !b) throw new Error('Murmel kann diesen Draht nicht spannen');
      if (a === b) return;
      if (!tokens(a).includes(`#${b.id}`)) a.attrs.fellows = [...tokens(a), `#${b.id}`].join(',');
      if (!tokens(b).includes(`#${a.id}`)) b.attrs.fellows = [...tokens(b), `#${a.id}`].join(',');
      if (name) wires.set(uniqueName(name), [a, b]);
      w.redraw();
    },
    /** wo:add({"ot_rubberband", anchor1 = a marble, anchor2 = a stone or marble}) during play. */
    addRubber(a1, a2, strength, length, threshold, min, max) {
      const marbleOf = (ref: string | null): number => {
        if (!ref?.startsWith('a:')) return -1;
        return marbleIndex(Number(ref.slice(2)));
      };
      const num = (v: string | null) => (v === null || v === '' ? undefined : Number(v));
      const def = { strength: num(strength), length: num(length), threshold: num(threshold), min: num(min), max: num(max) };
      // between two other actors (rotors, bugs …: 4 - 8 - 4 ties bugI to bugK)
      const enemy = (ref: string | null) => (ref?.startsWith('a:') ? enemyOf(level, physics, Number(ref.slice(2))) : null);
      const m = marbleOf(a1);
      const e1 = m < 0 ? enemy(a1) : null;
      if (e1 && a2) {
        const m2 = marbleOf(a2);
        const b = m2 >= 0 ? physics.marbles[m2] : enemy(a2);
        if (b) physics.addRubberBodies(e1, b, def);
        else if (a2.startsWith('a:')) throw new Error('Murmel kann dieses Gummiband nicht spannen');
        else stoneBand(e1, a2, def);
        return;
      }
      if (m < 0 || !a2) throw new Error('Murmel kann dieses Gummiband nicht spannen');
      const m2 = marbleOf(a2);
      if (m2 >= 0) {
        physics.addRubberBetween(m, m2, def);
        return;
      }
      const e2 = enemy(a2);
      if (e2) {
        physics.addRubberBodies(physics.marbles[m], e2, def, m);
        return;
      }
      stoneBand(m, a2, def);
    },
  };
  return host;
}
