import { describe, expect, it } from 'vitest';
import { ALL_FACES, NORTH, ObjectWorld, SOUTH, type ObjectDef, type ObjectEnv } from './objects';

const W = 10;

function world(defs: ObjectDef[], texts?: Record<string, string>) {
  const w = new ObjectWorld(defs, W, texts);
  w.marbleAt(0, 0);
  return w;
}

const door = (x: number, extra: Record<string, string> = {}): ObjectDef => ({ x, y: 0, k: 'st_door_a', a: { name: 'door1', ...extra } });

describe('ObjectWorld', () => {
  it('a trigger opens a door while pressed and closes it on release', () => {
    const w = world([door(5), { x: 2, y: 0, k: 'it_trigger', a: { target: 'door1', action: 'signal' } }]);
    expect(w.blockAt(5, 0)).toBe(ALL_FACES);
    w.marbleAt(2, 0);
    w.update(200);
    expect(w.blockAt(5, 0)).toBe(0);
    w.marbleAt(3, 0);
    expect(w.blockAt(5, 0)).toBe(ALL_FACES); // closing doors block at once
    w.update(200);
    expect(w.objects[0].state).toBe(0);
  });

  it('a door blocks until its opening animation is finished', () => {
    const w = world([door(5), { x: 2, y: 0, k: 'it_trigger', a: { target: 'door1', action: 'open' } }]);
    w.marbleAt(2, 0);
    w.update(60);
    expect(w.blockAt(5, 0)).toBe(ALL_FACES);
    w.update(60);
    expect(w.blockAt(5, 0)).toBe(0);
  });

  it('a switch toggles on a hit and acts after its animation', () => {
    const w = world([door(5), { x: 3, y: 0, k: 'st_switch', a: { target: 'door1' } }]);
    w.hit(3, 0);
    w.update(100);
    expect(w.objects[1].state).toBe(0); // still turning
    w.update(100);
    expect(w.objects[1].state).toBe(1);
    w.update(200);
    expect(w.blockAt(5, 0)).toBe(0); // default action toggle opened the door
    w.hit(3, 0);
    w.update(400);
    expect(w.blockAt(5, 0)).toBe(ALL_FACES);
  });

  it('a white switch ignores the black marble', () => {
    const w = world([{ x: 3, y: 0, k: 'st_switch_white', a: { color: '1' } }]);
    w.hit(3, 0, 0);
    w.update(500);
    expect(w.objects[0].state).toBe(0);
  });

  it('resolves targets by id, name pattern and state-specific target', () => {
    const w = world([
      { x: 5, y: 0, k: 'st_door_b', a: { $id: '17' } },
      { x: 6, y: 0, k: 'st_door_c', a: { name: 'gate#3' } },
      { x: 7, y: 0, k: 'st_door_c', a: { name: 'gate#4' } },
      { x: 2, y: 0, k: 'it_trigger', a: { target_1: '#17;gate#*', action_1: 'open;open', target_0: '', action_0: '' } },
    ]);
    w.marbleAt(2, 0);
    w.update(1000);
    expect(w.objects.slice(0, 3).map((o) => o.state)).toEqual([1, 1, 1]);
    w.marbleAt(3, 0); // release: target_0 is empty, doors stay open
    w.update(1000);
    expect(w.objects.slice(0, 3).map((o) => o.state)).toEqual([1, 1, 1]);
  });

  it('inverse turns the action value around', () => {
    const w = world([door(5, { $state: '1' }), { x: 2, y: 0, k: 'it_trigger', a: { target: 'door1', action: 'signal', inverse: 'true' } }]);
    w.marbleAt(2, 0);
    w.update(500);
    expect(w.objects[0].state).toBe(0);
  });

  it('door d blocks only the faces without connection', () => {
    const w = world([{ x: 5, y: 0, k: 'st_door_d', a: { $connections: '5' } }]);
    expect(w.blockAt(5, 0)).toBe(NORTH | SOUTH);
  });

  it('a door closing over the marble shatters it', () => {
    const w = world([door(5, { $state: '1' }), { x: 5, y: 1, k: 'it_trigger', a: { target: 'door1', action: 'close' } }]);
    w.marbleAt(5, 0);
    w.update(10);
    w.marbleAt(5, 1); // presses the trigger … but the marble left the door cell first
    expect(w.events.some((e) => e.type === 'shatter')).toBe(false);
    const w2 = world([door(5, { $state: '1', name: 'd2' }), { x: 4, y: 0, k: 'st_switch', a: { target: 'd2', instant: 'true' } }]);
    w2.marbleAt(5, 0);
    w2.hit(4, 0);
    expect(w2.events.some((e) => e.type === 'shatter')).toBe(true);
  });

  it('a document shows its text once', () => {
    const w = world([{ x: 2, y: 0, k: 'it_document', a: { text: 'text1' } }], { text1: 'Hallo' });
    w.marbleAt(2, 0);
    w.marbleAt(3, 0);
    w.marbleAt(2, 0);
    expect(w.events.filter((e) => e.type === 'text')).toEqual([{ type: 'text', text: 'Hallo' }]);
  });

  it('grates and triggers never block', () => {
    const w = world([{ x: 2, y: 0, k: 'st_grate_cross' }, { x: 3, y: 0, k: 'it_trigger' }]);
    expect(w.blockAt(2, 0)).toBe(0);
    expect(w.blockAt(3, 0)).toBe(0);
  });

  describe("boxes", () => {
    const floors = new Map<string, string>();
    const env: ObjectEnv = {
      stoneAt: (c, r) => c < 0 || r < 0 || c >= W || r >= 3 || (c === 9 && r === 1),
      floorAt: (c, r) => floors.get(c + "," + r) ?? "fl_gray",
      setFloor: (c, r, k) => void floors.set(c + "," + r, k),
    };
    const boxWorld = (defs: ObjectDef[]) => {
      floors.clear();
      const w = new ObjectWorld(defs, W, {}, env, () => 0.2);
      w.marbleAt(0, 1);
      return w;
    };

    it("a fast hit on a face pushes the box one cell away from the marble", () => {
      const w = boxWorld([{ x: 3, y: 1, k: "st_box_wood" }]);
      w.hit(3, 1, 0, -1, 0, -5); // marble west of the box, moving east
      expect([w.objects[0].col, w.objects[0].row]).toEqual([4, 1]);
      expect(w.blockAt(4, 1)).toBe(ALL_FACES);
      expect(w.blockAt(3, 1)).toBe(0);
    });

    it("a slow hit or a hit on a corner does not push", () => {
      const w = boxWorld([{ x: 3, y: 1, k: "st_box_rock" }]);
      w.hit(3, 1, 0, -1, 0, -3);
      w.hit(3, 1, 0, -Math.SQRT1_2, -Math.SQRT1_2, -8);
      expect(w.objects[0].col).toBe(3);
    });

    it("stones and other boxes stop a push", () => {
      const w = boxWorld([{ x: 8, y: 1, k: "st_box_hay" }, { x: 5, y: 1, k: "st_box_hay" }, { x: 6, y: 1, k: "st_box_hay" }]);
      w.hit(8, 1, 0, -1, 0, -6); // fixed stone at (9, 1)
      w.hit(5, 1, 0, -1, 0, -6); // box at (6, 1)
      expect(w.objects.map((o) => o.col)).toEqual([8, 5, 6]);
    });

    it("a box pushed into water or abyss becomes a bridge", () => {
      const w = boxWorld([{ x: 3, y: 1, k: "st_box_wood" }]);
      floors.set("4,1", "fl_water");
      w.hit(3, 1, 0, -1, 0, -5);
      expect(floors.get("4,1")).toBe("fl_wood_framed_h");
      expect(w.objects[0].gone).toBe(true);
      expect(w.blockAt(4, 1)).toBe(0);
      expect(w.events).toContainEqual({ type: "floor", col: 4, row: 1 });
    });

    it("a box on a trigger presses it, pushing it off releases it", () => {
      const w = boxWorld([door(7), { x: 4, y: 1, k: "it_trigger", a: { target: "door1", action: "signal" } }, { x: 3, y: 1, k: "st_box_wood" }]);
      w.hit(3, 1, 0, -1, 0, -5);
      w.update(200);
      expect(w.objects[0].state).toBe(1);
      w.hit(4, 1, 0, -1, 0, -5);
      w.update(200);
      expect(w.objects[0].state).toBe(0);
    });
  });

  it("a quake stone shakes on a hit or signal and announces the quake once", () => {
    const w = world([{ x: 3, y: 0, k: "st_quake", a: { name: "q" } }, { x: 1, y: 0, k: "it_trigger", a: { target: "q", action: "signal" } }]);
    expect(w.blockAt(3, 0)).toBe(ALL_FACES);
    w.hit(3, 0);
    w.hit(3, 0); // still shaking
    expect(w.events.filter((e) => e.type === "quake")).toHaveLength(1);
    w.update(900);
    w.marbleAt(1, 0);
    expect(w.events.filter((e) => e.type === "quake")).toHaveLength(2);
    w.update(900);
    w.marbleAt(2, 0); // release sends false: no quake
    expect(w.events.filter((e) => e.type === "quake")).toHaveLength(2);
  });

  it("a death stone shatters the marble on any touch and pulses", () => {
    const w = world([{ x: 3, y: 0, k: "st_death" }]);
    expect(w.blockAt(3, 0)).toBe(ALL_FACES);
    w.touch(3, 0);
    expect(w.events).toContainEqual({ type: "shatter" });
    expect(w.objects[0].moving).not.toBeNull();
    w.update(500);
    expect(w.objects[0].moving).toBeNull();
  });

  it("a one-way stone blocks only the arrow side, flips on signal; white blocks the black marble", () => {
    const w = world([
      { x: 3, y: 0, k: "st_oneway_e", a: { name: "ow" } },
      { x: 4, y: 0, k: "st_oneway_white_n", a: { color: "1" } },
      { x: 1, y: 0, k: "it_trigger", a: { target: "ow", action: "flip" } },
    ]);
    expect(w.blockAt(3, 0)).toBe(4); // EAST face
    expect(w.blockAt(4, 0)).toBe(ALL_FACES);
    w.marbleAt(1, 0);
    expect(w.blockAt(3, 0)).toBe(1); // now WEST
  });

  describe("puzzle stones", () => {
    const Y = (x: number, y: number, c: number): ObjectDef => ({ x, y, k: "st_puzzle_yellow", a: { color: "3", $connections: String(c) } });
    const B = (x: number, y: number, c: number): ObjectDef => ({ x, y, k: "st_puzzle", a: { color: "4", $connections: String(c) } });
    const pos = (w: ObjectWorld) => w.objects.filter((o) => !o.gone).map((o) => [o.col, o.row, Number(o.attrs.$connections)]);
    const floors = new Map<string, string>();
    const env: ObjectEnv = {
      stoneAt: (c, r) => c < 0 || r < 0 || c >= W || r >= 5,
      floorAt: (c, r) => floors.get(c + "," + r) ?? "fl_gray",
      setFloor: (c, r, k) => void floors.set(c + "," + r, k),
    };
    const pw = (defs: ObjectDef[]) => {
      floors.clear();
      const w = new ObjectWorld(defs, W, {}, env);
      w.marbleAt(0, 4);
      return w;
    };

    it("a hit on a yellow line rotates it away from the marble", () => {
      // three stones in a row, connections west/east open (incomplete)
      const w = pw([Y(2, 1, 4), Y(3, 1, 5), Y(4, 1, 1 | 4)]);
      w.hit(2, 1, 0, -1, 0, -2); // marble west of (2,1), soft hit
      expect(pos(w)).toEqual([[3, 1, 4], [4, 1, 5], [2, 1, 5]]);
    });

    it("a complete yellow puzzle with no other neighbours explodes stone by stone", () => {
      const w = pw([Y(2, 1, 4), Y(3, 1, 1)]); // east ↔ west: complete
      w.hit(2, 1, 0, -1, 0, -2);
      expect(w.blockAt(2, 1)).toBe(0); // exploding: passable
      expect(w.objects[1].puzzle).toBe("ignited");
      w.update(300);
      w.update(100);
      expect(w.objects.every((o) => o.gone)).toBe(true);
      expect(w.events.filter((e) => e.type === "sound" && e.name === "explode")).toHaveLength(2);
    });

    it("a single yellow stone is pushed like a box when hit hard", () => {
      const w = pw([Y(2, 1, 4)]);
      w.hit(2, 1, 0, -1, 0, -6);
      expect(pos(w)).toEqual([[3, 1, 4]]);
    });

    it("a blue fragment moves as a whole and sinks into water as a floor", () => {
      const w = pw([B(2, 1, 4), B(3, 1, 1 | 2), B(3, 2, 8)]); // L-shape, complete
      w.hit(2, 1, 0, 0, -1, -6); // marble above (2,1): push south
      expect(pos(w)).toEqual([[2, 2, 4], [3, 2, 3], [3, 3, 8]]);
      floors.set("2,3", "fl_water");
      floors.set("3,3", "fl_water");
      floors.set("3,4", "fl_water");
      w.hit(2, 2, 0, 0, -1, -6);
      expect(pos(w)).toEqual([]);
      expect(floors.get("3,4")).toBe("fl_gray");
    });

    it("a blue fragment does not move into another stone", () => {
      const w = pw([B(2, 1, 4), B(3, 1, 1), B(2, 2, 0)]);
      w.hit(2, 1, 0, 0, -1, -6);
      expect(pos(w)).toEqual([[2, 1, 4], [3, 1, 1], [2, 2, 0]]);
    });
  });

  describe("timers", () => {
    const timer = (a: Record<string, string>): ObjectDef => ({ x: 3, y: 0, k: "st_timer", a: { target: "door1", action: "signal", ...a } });

    it("a looping timer sends true and false in turn", () => {
      const w = world([door(5), timer({ interval: "2" })]);
      w.update(1900);
      expect(w.objects[0].moving).toBeNull();
      w.update(200); // 2 s: true → opens
      w.update(200);
      expect(w.objects[0].state).toBe(1);
      w.update(2000); // 4 s: false → closes
      w.update(500);
      expect(w.objects[0].state).toBe(0);
    });

    it("a non-looping timer fires once and stops", () => {
      const w = world([door(5), timer({ interval: "1", loop: "false", action: "toggle" })]);
      w.update(5000);
      w.update(200); // door animation
      expect(w.objects[0].state).toBe(1);
      expect(w.objects[1].state).toBe(0);
    });

    it("off stops a timer, on starts it again with true", () => {
      const w = world([
        door(5),
        timer({ name: "t" }),
        { x: 2, y: 0, k: "it_trigger", a: { target: "t", action: "off" } },
      ]);
      w.marbleAt(2, 0);
      w.update(3000);
      expect(w.objects[0].state).toBe(0);
      expect(w.blockAt(3, 0)).toBe(ALL_FACES);
    });

    it("API 1 levels rename openclose for doors to toggle", () => {
      const defs = [door(5), timer({ action: "openclose", loop: "false" })];
      const old = new ObjectWorld(defs, W, {}, undefined, Math.random, 1.0);
      old.update(1500);
      old.update(200);
      expect(old.objects[0].state).toBe(1);
      const now = new ObjectWorld(defs, W, {}, undefined, Math.random, 1.1);
      now.update(1500);
      now.update(200);
      expect(now.objects[0].state).toBe(0); // unknown message is ignored
    });
  });
});
