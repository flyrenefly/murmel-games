/**
 * The running level as seen from Lua (src/lua): object references, attributes, messages and
 * tile changes. References are strings: "o:<id>" interactive objects, "c:<fl|st>:<x>:<y>"
 * plain floors and stones, "a:<n>" actors (0 = black marble, n = level.actors[n − 1]).
 */
import type { LuaHost } from '../lua/runtime';
import type { Level } from './level';
import type { GameObject, ObjectWorld } from './objects';
import type { PhysicsWorld } from './physics';

export interface LuaWorld {
  level: Level;
  objects: ObjectWorld;
  physics: PhysicsWorld;
  /** Floors or plain stones changed: redraw. */
  redraw(): void;
  random(): number;
  /** wo[pos] = {"st_oxyd", …} during play: a new closed Oxyd stone at a cell (its flavor). */
  addOxyd?(x: number, y: number, flavor: string): void;
  /** wo:shuffleOxyd() during play: colour new Oxyd stones, deal the closed ones' colours anew. */
  shuffleOxyd?(): void;
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
  const actorPos = (i: number): [number, number] => {
    if (i === 0) return [physics.marbles[0].pos.x, physics.marbles[0].pos.y];
    const a = level.actors[i - 1];
    if (a?.k === 'ac_marble_white' && physics.marbles[1]) return [physics.marbles[1].pos.x, physics.marbles[1].pos.y];
    const e = physics.enemies[level.actors.slice(0, i - 1).filter((x) => x.k !== 'ac_marble_white').length];
    return e ? [e.pos.x, e.pos.y] : [a?.x ?? 0, a?.y ?? 0];
  };
  const uniqueName = (name: string): string => {
    if (!name.endsWith('#')) return name;
    for (;;) {
      const n = `${name}${1 + Math.floor(w.random() * 999999)}`;
      if (host.find(n).length === 0) return n;
    }
  };
  const removeStone = (x: number, y: number) => {
    const o = objects.stoneObjectAt(x, y);
    if (o) objects.remove(o);
    if (cell(x, y).stone !== null && cell(x, y).stone !== 'st_oxyd') {
      cell(x, y).stone = null;
      physics.setSolid(x, y, false);
    }
    attrs.delete(`c:st:${x}:${y}`);
  };

  const host: LuaHost = {
    find(pattern) {
      const re = glob(pattern);
      const refs: string[] = [];
      // fl_ref objects stand for named floors, which Lua addresses as cells (c:fl:x:y)
      for (const o of objects.objects) if ((!o.gone || o.picked) && o.name && re.test(o.name)) refs.push(o.cls === 'floorref' ? `c:fl:${o.col}:${o.row}` : `o:${o.id}`);
      for (const [ref, a] of attrs) if (a.name && re.test(a.name) && host.exists(ref) && !refs.includes(ref)) refs.push(ref);
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
      const { x, y } = parse(ref);
      return [x, y];
    },
    get(ref, key) {
      if (ref.startsWith('o:')) {
        const o = byId(ref);
        if (!o) return null;
        if (key === 'name') return o.name || null;
        if (key === 'kind') return o.kind;
        if (key === 'state') return String(o.state);
        return o.attrs[key] ?? null;
      }
      if (key === 'kind' && ref.startsWith('c:')) {
        const { l, x, y } = parse(ref);
        return l === 'fl' ? cell(x, y).floor : cell(x, y).stone;
      }
      return attrs.get(ref)?.[key] ?? null;
    },
    set(ref, key, value) {
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
        cell(x, y).floor = look;
        delete cell(x, y).force;
        attrs.set(`c:fl:${x}:${y}`, decl);
        // BoxStone::on_floor_change: a box on new abyss, water or swamp sinks
        objects.floorChanged(x, y);
      } else if (kind.startsWith('st_')) {
        removeStone(x, y);
        if (look === 'oxyd') {
          // OxydStone: a closed stone of the flavor (default "a"); named ones receive messages
          w.addOxyd?.(x, y, decl.flavor ?? 'a');
          if (decl.name) objects.create('st_oxyd_ref', x, y, { name: decl.name });
        } else if (look === 'object') objects.create(kind, x, y, decl);
        else if (look !== 'nil') {
          cell(x, y).stone = look;
          physics.setSolid(x, y, true);
          attrs.set(`c:st:${x}:${y}`, decl);
        }
      } else if (kind.startsWith('it_')) {
        const it = objects.itemAt(x, y);
        if (it) objects.remove(it);
        if (look === 'object') objects.create(kind, x, y, decl);
      } else throw new Error(`Murmel kann ${kind} nicht setzen`);
      w.redraw();
    },
    world(key) {
      if (key === 'GlobalForce') return `${force.x},${force.y}`;
      if (key === 'FrictionStrength') return String(physics.frictionFactor);
      return world[key] ?? null;
    },
    setWorld(key, value) {
      if (value === null) delete world[key];
      else world[key] = value;
      if (key === 'GlobalForce' || key === 'FrictionStrength' || key === 'ElectricStrength') applyWorld(physics, world, force);
    },
    size: () => [level.width, level.height],
    /** PuzzleStone "get_cluster": the stones of the fragment (none for other objects). */
    cluster(ref) {
      const o = ref.startsWith('o:') ? byId(ref) : null;
      if (!o || o.cls !== 'puzzle') return [];
      return objects.puzzleFragment(o).cluster.map((p) => `o:${p.id}`);
    },
    shuffleOxyd() {
      w.shuffleOxyd?.();
    },
    /** wo:add(YIN/YANG, {"it_…"}) during play: the item into that player's inventory. */
    addInventory(player, kind) {
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
    /** wo:add({"ot_rubberband", anchor1 = a marble, anchor2 = a stone or marble}) during play. */
    addRubber(a1, a2, strength, length, threshold, min, max) {
      const marbleOf = (ref: string | null): number => {
        if (!ref?.startsWith('a:')) return -1;
        const i = Number(ref.slice(2));
        if (i === 0) return 0;
        return level.actors[i - 1]?.k === 'ac_marble_white' && physics.marbles[1] ? 1 : -1;
      };
      const m = marbleOf(a1);
      if (m < 0 || !a2) throw new Error('Murmel kann dieses Gummiband nicht spannen');
      const num = (v: string | null) => (v === null || v === '' ? undefined : Number(v));
      const def = { strength: num(strength), length: num(length), threshold: num(threshold), min: num(min), max: num(max) };
      const m2 = marbleOf(a2);
      if (m2 >= 0) {
        physics.addRubberBetween(m, m2, def);
        return;
      }
      const [x, y] = host.pos(a2);
      const follow = a2.startsWith('o:') ? () => { const o = byId(a2); return o ? { x: o.col + 0.5, y: o.row + 0.5 } : null; } : undefined;
      physics.addRubber(m, x + 0.5, y + 0.5, def, follow);
    },
  };
  return host;
}
