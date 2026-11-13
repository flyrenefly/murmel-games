import { describe, expect, it } from 'vitest';
import { ALL_FACES, BOX_GROW_MS, NORTH, ObjectWorld, passageLook, SEED_GROW_MS, SOUTH, type ObjectDef, type ObjectEnv } from './objects';

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

  it("a fake quake stone shakes on a hit but closes nothing and ignores signals", () => {
    const w = world([{ x: 3, y: 0, k: "st_fake_quake", a: { name: "q" } }, { x: 1, y: 0, k: "it_trigger", a: { target: "q", action: "signal" } }]);
    w.hit(3, 0);
    expect(w.objects[0].moving).not.toBeNull();
    expect(w.events).toContainEqual({ type: "sound", name: "fakeoxyd" });
    expect(w.events.some((e) => e.type === "quake")).toBe(false);
    w.update(1000);
    w.events.length = 0;
    w.marbleAt(1, 0);
    expect(w.objects[0].moving).toBeNull();
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
    expect(w.events).toContainEqual({ type: "shatter", marble: 0 });
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

    it("wo[\"FallenPuzzle\"] chooses the floor a sunk fragment leaves", () => {
      const w = pw([B(2, 1, 0)]);
      w.fallenPuzzle = "fl_ice";
      floors.set("2,2", "fl_water");
      w.hit(2, 1, 0, 0, -1, -6);
      expect(floors.get("2,2")).toBe("fl_ice");
    });

    it("a blue fragment does not move into another stone", () => {
      const w = pw([B(2, 1, 4), B(3, 1, 1), B(2, 2, 0)]);
      w.hit(2, 1, 0, 0, -1, -6);
      expect(pos(w)).toEqual([[2, 1, 4], [3, 1, 1], [2, 2, 0]]);
    });
  });

  it("a wormhole pulls the marble and teleports it from near its centre", () => {
    const w = world([{ x: 5, y: 0, k: "it_wormhole_on", a: { dest: "8.5,2.5" } }]);
    const [fx, fy] = w.fieldForce(3.5, 0.5);
    expect(fx).toBeCloseTo((0.6 * 30) / 4 * 2, 5); // strength/d² · d, towards the hole
    expect(fy).toBe(0);
    expect(w.warpTarget(5.3, 0.5)).toBeNull(); // 0.2 from the centre: outside 0.125
    expect(w.warpTarget(5.55, 0.45)).toEqual({ x: 8.5, y: 2.5, cut: false });
  });

  describe("vortex (Vortex.cc)", () => {
    it("an open vortex swallows a marble near its centre and gives it out at the next open vortex", () => {
      const w = world([
        { x: 3, y: 0, k: "it_vortex_open", a: { dests: "7.5,0.5" } },
        { x: 7, y: 0, k: "it_vortex_open", a: {} },
      ]);
      w.actorStep(3.2, 0.5, 0); // 0.3 from the centre: nothing
      expect(w.events.some((e) => e.type === "vortexGrab")).toBe(false);
      w.actorStep(3.4, 0.5, 0);
      expect(w.events).toContainEqual({ type: "vortexGrab", marble: 0 });
      w.update(450); // perform_warp after 0.4 s
      expect(w.events).toContainEqual({ type: "vortexWarp", marble: 0, x: 7.5, y: 0.5, cut: true, rise: true });
    });

    it("a closed destination vortex opens first; without destinations the marble comes back out", () => {
      const w = world([
        { x: 3, y: 0, k: "it_vortex_open", a: { dests: "7.5,0.5" } },
        { x: 7, y: 0, k: "it_vortex_closed", a: {} },
        { x: 1, y: 1, k: "it_vortex_open", a: {} },
      ]);
      w.actorStep(3.5, 0.5, 0);
      w.update(450);
      expect(w.events.some((e) => e.type === "vortexWarp")).toBe(false);
      const target = w.objects.find((o) => o.col === 7)!;
      expect(w.vortexFrame(target)).toBe(3); // opening starts at the closed frame
      w.update(450);
      expect(w.events).toContainEqual({ type: "vortexWarp", marble: 0, x: 7.5, y: 0.5, cut: true, rise: true });
      w.actorStep(1.5, 1.5, 1);
      w.update(450);
      expect(w.events).toContainEqual({ type: "vortexWarp", marble: 1, x: 1.5, y: 1.5, cut: false, rise: true });
    });

    it("a closed vortex does not swallow; autoopen opens it when a marble comes near", () => {
      const w = world([{ x: 3, y: 0, k: "it_vortex_closed", a: { autoopen: "true" } }]);
      w.actorStep(3.5, 0.5, 0);
      expect(w.events.some((e) => e.type === "vortexGrab")).toBe(false);
      w.actorStep(3.1, 0.5, 0);
      w.update(450);
      w.actorStep(3.5, 0.5, 0);
      expect(w.events).toContainEqual({ type: "vortexGrab", marble: 0 });
    });
  });

  it("a magnet pulls like a wormhole while on (from 0.2 on), toggles with messages and is not picked up", () => {
    const w = world([{ x: 5, y: 0, k: "it_magnet_on", a: { name: "m" } }]);
    const [fx] = w.fieldForce(3.5, 0.5);
    expect(fx).toBeCloseTo(((0.6 * 30) / 4) * 2, 5);
    expect(w.fieldForce(5.6, 0.5)).toEqual([0, 0]); // 0.1 from the centre: no force
    w.actorStep(5.5, 0.5, 0);
    expect(w.inventory).toEqual([]);
    w.sendMessage(w.objects[0], "toggle", true);
    expect(w.fieldForce(3.5, 0.5)).toEqual([0, 0]);
  });

  it("sensors act when a marble enters their cell, exit sensors when it leaves; not when jumping in place", () => {
    const w = world([
      door(8),
      { x: 3, y: 0, k: "it_sensor", a: { target: "door1", action: "toggle" } },
      { x: 5, y: 0, k: "it_sensor_exit", a: { target: "door1", action: "toggle" } },
    ]);
    const open = () => w.blockAt(8, 0) === 0;
    w.marbleAt(2, 0);
    w.marbleAt(3, 0); // enter the sensor
    w.update(500);
    expect(open()).toBe(true);
    w.marbleGone(0); // jumps …
    w.marbleAt(3, 0); // … and lands in the same cell: nothing
    w.update(500);
    expect(open()).toBe(true);
    w.marbleAt(4, 0);
    w.marbleAt(5, 0); // entering the exit sensor: nothing
    w.update(500);
    expect(open()).toBe(true);
    w.marbleAt(6, 0); // leaving it
    w.update(500);
    expect(open()).toBe(false);
    expect(w.sensorLook(w.objects[1])?.image).toBe("it_sensor");
    expect(w.sensorLook(w.objects[2])).toEqual({ image: "it_sensor_exit", frame: 1 }); // 500 ms into the 3 × 600 ms animation
  });

  it("a key switch takes the matching key and switches on; hit again it gives the key back", () => {
    const w = world([
      door(8),
      { x: 2, y: 1, k: "it_key", a: { code: "3" } },
      { x: 4, y: 1, k: "it_key" },
      { x: 5, y: 0, k: "st_key", a: { code: "3", target: "door1", action: "toggle" } },
    ]);
    w.actorStep(4.5, 1.5, 0); // plain key first
    w.actorStep(2.5, 1.5, 0);
    expect(w.inventory).toEqual(["it_key_3", "it_key"]);
    w.rotateInventory();
    w.hit(5, 0, 0, 0, 1, -3, 0, 0, 0); // wrong key in hand: nothing
    expect(w.objects[3].state).toBe(0);
    w.rotateInventory();
    w.hit(5, 0, 0, 0, 1, -3, 0, 0, 0);
    expect(w.objects[3].state).toBe(1);
    expect(w.inventory).toEqual(["it_key"]);
    expect(w.keySwitchFrame(w.objects[3])).toBe(3);
    w.update(500);
    expect(w.blockAt(8, 0)).toBe(0);
    w.hit(5, 0, 0, 0, 1, -3, 0, 0, 0);
    expect(w.inventory).toEqual(["it_key_3", "it_key"]);
    expect(w.objects[3].state).toBe(0);
  });

  describe("lasers and mirrors (laser.cc, MirrorStone.cc)", () => {
    // a 10 × 6 room: walls only at the border rows/columns given here
    const lworld = (defs: ObjectDef[], statics: Record<string, string> = {}) => {
      const env: ObjectEnv = {
        stoneAt: (c, r) => r < 0 || r > 5 || `${c},${r}` in statics,
        floorAt: () => "fl_gray",
        setFloor: () => {},
        staticStone: (c, r) => statics[`${c},${r}`] ?? null,
        transparentAt: (c, r) => statics[`${c},${r}`] === "st_rawglass",
      };
      const w = new ObjectWorld(defs, W, {}, env);
      w.marbleAt(0, 5);
      w.update(10);
      return w;
    };
    const beam = (w: ObjectWorld, c: number, r: number) => w.beams.get(r * W + c) ?? 0;

    it("a laser that is on shoots east until a stone; glass lets it through", () => {
      const w = lworld([{ x: 1, y: 1, k: "st_laser", a: { $state: "1" } }], { "4,1": "st_rawglass", "7,1": "st_granite" });
      expect(beam(w, 2, 1)).toBe(4); // EAST bit
      expect(beam(w, 4, 1)).toBe(4); // under the glass
      expect(beam(w, 6, 1)).toBe(4);
      expect(beam(w, 7, 1)).toBe(0);
      expect(beam(w, 8, 1)).toBe(0);
    });

    it("a planar mirror turns the beam; a hit turns the mirror", () => {
      // st_mirror_slab_n is '|'?  Enigma: state NORTH → table entry 3 ('|'): east → west back
      const w = lworld([
        { x: 1, y: 2, k: "st_laser_e", a: { $state: "1" } },
        { x: 4, y: 2, k: "st_mirror_slab", a: { orientation: "0" } }, // WEST = '\': east → south
      ]);
      expect(beam(w, 3, 2)).toBe(4);
      expect(beam(w, 4, 3)).toBe(2); // SOUTH bit below the mirror
      expect(beam(w, 4, 4)).toBe(2);
      w.hit(4, 2, 0, -1, 0, -5); // rotate clockwise: WEST → NORTH ('|'): the beam goes back west
      w.update(10);
      expect(beam(w, 4, 3)).toBe(0);
      expect(beam(w, 2, 2)).toBe(4 | 1);
    });

    it("an item stops the beam, a marble in it is hit, light opens an Oxyd stone", () => {
      const w = lworld([
        { x: 1, y: 1, k: "st_laser", a: { $state: "0", name: "l" } },
        { x: 5, y: 1, k: "it_magicwand" },
        { x: 1, y: 3, k: "st_laser", a: { $state: "0", name: "l2" } },
      ], { "8,3": "st_oxyd" });
      w.sendMessage(w.objects[0], "on", true);
      w.sendMessage(w.objects[2], "on", true);
      w.update(10);
      expect(beam(w, 4, 1)).toBe(4);
      expect(beam(w, 5, 1)).toBe(0);
      expect(w.events).toContainEqual({ type: "oxyd", col: 8, row: 3 });
      w.actorStep(3.5, 1.6, 0);
      expect(w.events).toContainEqual({ type: "laserhit", marble: 0 });
      expect(w.canDropAt(3.5, 1.5)).toBe(false);
    });

    it("a light passenger skates along the beam until a stone stops it", () => {
      const w = lworld([{ x: 1, y: 2, k: "st_laser", a: { $state: "1" } }, { x: 3, y: 2, k: "st_lightpassenger" }], { "7,2": "st_granite" });
      for (let i = 0; i < 40; i++) w.update(10);
      expect([w.objects[1].col, w.objects[1].row]).toEqual([6, 2]);
    });

    it("a laser switch turns on with light and off without it", () => {
      const w = lworld([
        door(8),
        { x: 1, y: 2, k: "st_laser", a: { $state: "0" } },
        { x: 5, y: 2, k: "st_laserswitch", a: { target: "door1", action: "toggle" } },
      ]);
      expect(w.objects[2].state).toBe(0);
      w.sendMessage(w.objects[1], "on", true);
      w.update(10);
      expect(w.objects[2].state).toBe(1);
      w.update(400);
      expect(w.blockAt(8, 0)).toBe(0);
      w.sendMessage(w.objects[1], "off", true);
      w.update(10);
      expect(w.objects[2].state).toBe(0);
    });
  });

  it("a crack grows when a marble enters, seeds its neighbours and finally dissolves into abyss", () => {
    const floors: Record<string, string> = {};
    const env: ObjectEnv = { stoneAt: () => false, floorAt: (c, r) => floors[`${c},${r}`] ?? "fl_gray", setFloor: (c, r, k) => (floors[`${c},${r}`] = k) };
    const w = new ObjectWorld([{ x: 3, y: 1, k: "it_crack_m" }], W, {}, env, () => 0); // random 0: always
    w.marbleAt(2, 1);
    w.marbleAt(3, 1); // enter: MEDIUM → LARGE, neighbours get invisible cracks
    expect(w.objects[0].state).toBe(2);
    expect(w.objects.filter((o) => o.kind === "it_crack_i").map((o) => [o.col, o.row, o.state])).toEqual([[3, 0, -1], [4, 1, -1], [3, 2, -1], [2, 1, -1]]);
    expect(w.crackLook(w.objects[1])).toBeNull();
    w.marbleAt(4, 1); // the invisible one becomes SMALL
    expect(w.objects.find((o) => o.col === 4 && o.row === 1)!.state).toBe(0);
    w.marbleAt(3, 1); // LARGE → DISSOLVING
    expect(w.crackLook(w.objects[0])).toEqual({ image: "it_crack_abyss", frame: 3 });
    w.update(650);
    expect(floors["3,1"]).toBe("fl_abyss");
    expect(w.objects[0].gone).toBe(true);
  });

  it("scales are pressed by a stone or by 1.8 mass of actors, not by one marble", () => {
    const w = world([
      door(8),
      { x: 3, y: 1, k: "fl_scales", a: { target: "door1", action: "toggle" } },
      { x: 4, y: 1, k: "st_box" },
    ]);
    w.isPearl = (i) => i === 2;
    w.update(10); // initial state: no action
    w.marbleAt(3, 1, 0);
    w.update(10);
    expect(w.objects[1].state).toBe(0);
    w.marbleAt(3, 1, 2); // + a pearl: 1.7 < 1.8
    w.update(10);
    expect(w.objects[1].state).toBe(0);
    w.marbleAt(3, 1, 1); // two marbles and a pearl
    w.update(10);
    expect(w.objects[1].state).toBe(1);
    w.marbleAt(5, 1, 1);
    w.marbleAt(5, 1, 2);
    w.update(10);
    expect(w.objects[1].state).toBe(0);
    w.hit(4, 1, 0, 1, 0, -6); // push the box west onto the scales
    w.update(10);
    expect(w.objects[1].state).toBe(1);
    w.update(500);
    expect(w.blockAt(8, 0)).toBe(0); // toggled open twice and closed once → open
  });

  it("a bridge closes under a stone, opens again without it, and obeys open/close", () => {
    const floors: Record<string, string> = { "3,1": "fl_bridge_gc_open" };
    const env: ObjectEnv = { stoneAt: () => false, floorAt: (c, r) => floors[`${c},${r}`] ?? "fl_gray", setFloor: (c, r, k) => (floors[`${c},${r}`] = k) };
    const w = new ObjectWorld([{ x: 3, y: 1, k: "fl_bridge", a: { flavor: "gc", name: "b" } }, { x: 4, y: 1, k: "st_box" }], W, {}, env);
    w.marbleAt(0, 0);
    w.update(10);
    expect(floors["3,1"]).toBe("fl_bridge_gc_open");
    w.hit(4, 1, 0, 1, 0, -6); // box onto the bridge
    w.update(10);
    expect(w.bridgeLook(w.objects[0])).not.toBeNull(); // closing
    w.update(700);
    expect(floors["3,1"]).toBe("fl_bridge_gc_closed");
    w.hit(3, 1, 0, -1, 0, -6); // box away to the east again
    w.update(10);
    w.update(700);
    expect(floors["3,1"]).toBe("fl_bridge_gc_open");
    w.sendMessage(w.objects[0], "close", true);
    w.update(710);
    expect(floors["3,1"]).toBe("fl_bridge_gc_closed");
  });

  it("a counter counts signals and acts with target_<n>/action_<n> of the new count", () => {
    const w = world([door(8), { x: -1, y: -1, k: "ot_counter", a: { name: "c", $state: "0", target_2: "door1", action_2: "open", target_1: "door1", action_1: "close" } }]);
    const c = w.objects[1];
    w.sendMessage(c, "signal", true);
    w.update(300);
    expect(w.blockAt(8, 0)).toBe(ALL_FACES); // count 1: close (already closed)
    w.sendMessage(c, "signal", true);
    w.update(300);
    expect(c.state).toBe(2);
    expect(w.blockAt(8, 0)).toBe(0); // count 2: open
    w.sendMessage(c, "signal", false);
    w.update(300);
    expect(w.blockAt(8, 0)).toBe(ALL_FACES); // back to 1: close
  });

  it("a pull stone moves towards the marble that hits it, also onto free floor, and warps it back", () => {
    const w = world([{ x: 5, y: 1, k: "st_pull" }, { x: 2, y: 1, k: "st_box" }]);
    w.hit(5, 1, 0, -1, 0, -6); // marble west of it: the stone comes west
    expect([w.objects[0].col, w.objects[0].row]).toEqual([4, 1]);
    expect(w.events).toContainEqual({ type: "pullWarp", fromCol: 4, fromRow: 1, toCol: 5, toRow: 1 });
    expect(w.swapFrame(w.objects[0])).toBe(4); // st_pull_w
    w.update(150);
    w.hit(4, 1, 0, -1, 0, -6);
    w.update(150);
    w.hit(3, 1, 0, -1, 0, -6); // the box west of it: they swap
    expect([w.objects[0].col, w.objects[1].col]).toEqual([2, 3]);
  });

  it("a rotator pushes its neighbour stones round it after each turn (clockwise: west → north)", () => {
    const w = world([{ x: 4, y: 2, k: "st_rotator_cw" }, { x: 3, y: 2, k: "st_box" }]);
    w.update(10);
    w.update(600); // one turn done: neighbours noted
    expect([w.objects[1].col, w.objects[1].row]).toEqual([3, 2]);
    w.update(110); // 0.1 s later the impulse
    expect([w.objects[1].col, w.objects[1].row]).toEqual([3, 1]);
    expect(w.rotatorLook(w.objects[0]).image).toBe("st_rotator_cw");
  });

  it("a blocker shrinks into an item on open, grows back on close and blocks only as a stone", () => {
    const w = world([door(8), { x: 4, y: 1, k: "st_blocker", a: { name: "b", target: "door1", action: "toggle" } }]);
    const b = w.objects[1];
    expect(w.blockAt(4, 1)).toBe(ALL_FACES);
    w.sendMessage(b, "open", true);
    expect(w.blockAt(4, 1)).toBe(0); // shrinking: passable
    w.update(200);
    expect(b.kind).toBe("it_blocker");
    expect(w.blockerLook(b)).toEqual({ frame: 3, stone: false });
    w.update(400);
    expect(w.blockAt(8, 0)).toBe(0); // performAction(true) opened the door
    w.sendMessage(b, "close", true);
    expect(w.blockAt(4, 1)).toBe(ALL_FACES); // growing
    w.update(200);
    expect(b.kind).toBe("st_blocker");
    w.update(400);
    expect(w.blockAt(8, 0)).toBe(ALL_FACES);
  });

  it("a turnstile arm pushed sideways rotates the pivot; a stone in the way blocks it", () => {
    const w = world([
      { x: 4, y: 2, k: "st_turnstile_green" },
      { x: 4, y: 1, k: "st_turnstilearm_n" },
      { x: 4, y: 3, k: "st_turnstilearm_s" },
    ]);
    // push the north arm east (marble west of it): clockwise → north arm goes east, south arm west
    w.hit(4, 1, 0, -1, 0, -6, 0, 0, 0);
    expect(w.objects.slice(1).map((o) => [o.col, o.row, o.state])).toEqual([[5, 2, 2], [3, 2, 0]]);
    expect(w.events.some((e) => e.type === "turnstile" && e.cw)).toBe(true);
    w.update(100);
    // a box at the north-east corner now blocks turning the east arm back north (counterclockwise)
    const box = { x: 5, y: 1, k: "st_box" };
    const w2 = world([{ x: 4, y: 2, k: "st_turnstile" }, { x: 5, y: 2, k: "st_turnstilearm_e" }, box]);
    w2.hit(5, 2, 0, 0, 1, -6, 0, 0, 0); // push the east arm north
    expect([w2.objects[1].col, w2.objects[1].row]).toEqual([5, 2]);
  });

  it("an ice block freezes water it is pushed onto and stays; an explosion turns the area to ice", () => {
    const floors: Record<string, string> = { "3,1": "fl_water" };
    const env: ObjectEnv = { stoneAt: () => false, floorAt: (c, r) => floors[`${c},${r}`] ?? "fl_gray", setFloor: (c, r, k) => (floors[`${c},${r}`] = k) };
    const w = new ObjectWorld([{ x: 4, y: 1, k: "st_ice" }, { x: 6, y: 1, k: "it_bomb_black" }], W, {}, env);
    w.marbleAt(0, 0);
    w.hit(4, 1, 0, 1, 0, -6);
    expect([w.objects[0].col, floors["3,1"]]).toEqual([3, "fl_ice"]);
    w.sendMessage(w.objects[0], "ignite", true);
    expect(w.blockAt(3, 1)).toBe(15);
  });

  it("shogun pieces move innermost first and nest into bigger ones; the dot wants its exact stack", () => {
    const w = world([
      door(8),
      { x: 3, y: 1, k: "st_shogun_sm" },
      { x: 5, y: 1, k: "st_shogun_l" },
      { x: 5, y: 1, k: "it_shogun_l", a: { target: "door1", action: "open" } },
    ]);
    w.update(10);
    w.hit(3, 1, 0, -1, 0, -6); // the small one moves east
    expect(w.objects.filter((o) => o.cls === "shogun" && !o.gone).map((o) => [o.col, o.state])).toEqual([[3, 8], [5, 16], [4, 4]]);
    w.hit(3, 1, 0, -1, 0, -6); // the medium one: into the large stack? no – (4,1) holds the small one (smaller) → blocked
    expect(w.objects[1].col).toBe(3);
    w.hit(4, 1, 0, -1, 0, -6); // small into the large
    w.hit(3, 1, 0, -1, 0, -6); // medium to (4,1)
    w.hit(4, 1, 0, -1, 0, -6); // medium into the l+s stack? s is smaller → blocked
    expect(w.objects.find((o) => o.col === 5 && o.cls === "shogun")!.state).toBe(20);
    w.update(10);
    expect(w.objects[3].state).toBe(0);
  });

  it("wired boxes move together; the pushed one moves first, then its fellows", () => {
    const w = world([
      { x: 3, y: 1, k: "st_box_hay", a: { name: "a", fellows: "b" } },
      { x: 3, y: 3, k: "st_box_hay", a: { name: "b", fellows: "a" } },
    ]);
    w.hit(3, 1, 0, -1, 0, -6); // push a east
    expect(w.objects.map((o) => [o.col, o.row])).toEqual([[4, 1], [4, 3]]);
    expect(w.wireLines()).toEqual([4.5, 1.5, 4.5, 3.5]);
  });

  it("a dispenser hands out its items; an explosion breaks it", () => {
    const w = world([{ x: 4, y: 1, k: "st_dispenser_bombblack", a: { stock: "1" } }, { x: 5, y: 2, k: "it_bomb_white" }]);
    w.hit(4, 1, 0, -1, 0, -3, 0, 0, 0);
    w.hit(4, 1, 0, -1, 0, -3, 0, 0, 0); // stock used up
    expect(w.inventory).toEqual(["it_bomb_black"]);
    w.sendMessage(w.objects[1], "explode", true); // white bomb: all eight neighbours
    w.update(400);
    expect(w.objects[0].gone).toBe(true);
  });

  it("a thief steals an item on touch; a knight capturing it leaves the bag with the loot", () => {
    const w = new ObjectWorld([
      { x: 2, y: 1, k: "it_hammer" },
      { x: 5, y: 1, k: "st_thief" },
      { x: 4, y: 3, k: "st_chess_black" },
    ], W, {}, undefined, () => 0);
    w.marbleAt(0, 0);
    w.actorStep(2.5, 1.5, 0);
    w.touch(5, 1, 0);
    expect(w.thiefLook(w.objects[1]).overlay).toBe(true);
    w.update(600);
    expect(w.inventory).toEqual([]); // stolen
    w.update(600);
    expect(w.objects[1].thief?.phase).toBeUndefined();
    // knight from (4,3): two north, one east → (5,1)
    (w as unknown as { chessMove: (o: unknown, a: number[], b: number[]) => void }).chessMove(w.objects[2], [0, -1], [1, 0]);
    w.update(2000);
    expect(w.objects[1].gone).toBe(true);
    const bag = w.objects.find((o) => o.kind === "it_bag")!;
    expect(bag.loot).toEqual(["it_hammer"]);
    w.actorStep(5.5, 1.5, 0);
    expect(w.inventory).toEqual(["it_hammer"]);
  });

  it("a coin slot takes a coin, switches on after the insert and off when the time is over", () => {
    const w = world([door(8), { x: 2, y: 1, k: "it_coin_m" }, { x: 5, y: 1, k: "st_coinslot", a: { target: "door1", action: "toggle" } }]);
    w.actorStep(2.5, 1.5, 0);
    expect(w.inventory).toEqual(["it_coin_m"]);
    w.hit(5, 1, 0, -1, 0, -3, 0, 0, 0);
    expect(w.inventory).toEqual([]);
    expect(w.coinslotLook(w.objects[2]).image).toBe("st_coinslot_insert");
    w.update(400); // insert done: on for 6 s
    expect(w.objects[2].state).toBe(1);
    w.update(400);
    expect(w.blockAt(8, 0)).toBe(0);
    w.update(5300);
    expect(w.objects[2].state).toBe(1); // 0.36 s insert + 6 s
    w.update(300);
    expect(w.objects[2].state).toBe(0);
  });

  it("dropped dynamite burns 1.5 s, then explodes: neighbours ignite, a hollow remains", () => {
    const floors: Record<string, string> = {};
    const env: ObjectEnv = { stoneAt: () => false, floorAt: (c, r) => floors[`${c},${r}`] ?? "fl_gray", setFloor: (c, r, k) => (floors[`${c},${r}`] = k) };
    const w = new ObjectWorld([{ x: 2, y: 2, k: "it_dynamite" }, { x: 5, y: 2, k: "st_break_plain" }, { x: 6, y: 2, k: "it_bomb_black" }], W, {}, env);
    w.marbleAt(0, 0);
    w.actorStep(2.5, 2.5, 0);
    expect(w.inventory).toEqual(["it_dynamite"]);
    w.dropItem(4.5, 2.5);
    w.update(1000);
    expect(w.blastLook(w.objects.find((o) => o.cls === "dynamite" && !o.gone)!).image).toBe("it_dynamite_burning");
    w.update(600); // explodes: the break stone next to it breaks, the explosion stays 50 ms
    expect(w.objects[1].breaking).toBeDefined();
    expect(w.objects.some((o) => o.cls === "explosion" && !o.gone && o.col === 4)).toBe(true);
    w.actorStep(4.5, 2.5, 0);
    expect(w.events).toContainEqual({ type: "shatter", marble: 0 });
    w.update(60);
    expect(w.objects.some((o) => o.cls === "meditation" && !o.gone && o.col === 4)).toBe(true);
  });

  it("a black bomb hit by a moving stone explodes into its four neighbours, leaving debris", () => {
    const floors: Record<string, string> = {};
    const env: ObjectEnv = { stoneAt: () => false, floorAt: (c, r) => floors[`${c},${r}`] ?? "fl_gray", setFloor: (c, r, k) => (floors[`${c},${r}`] = k) };
    const w = new ObjectWorld([{ x: 4, y: 2, k: "it_bomb_black" }, { x: 5, y: 2, k: "st_box" }, { x: 4, y: 1, k: "it_magicwand" }], W, {}, env);
    w.marbleAt(0, 0);
    w.hit(5, 2, 0, 1, 0, -6); // box west onto the bomb
    w.update(20);
    expect(w.objects[2].gone).toBe(true); // the wand north of it was destroyed
    expect(w.objects.filter((o) => o.cls === "explosion" && !o.gone).map((o) => [o.col, o.row]).sort()).toEqual([[3, 2], [4, 1], [4, 2], [4, 3], [5, 2]].sort());
    w.update(60); // debris in the centre, the others leave nothing (black: nil)
    w.update(450);
    expect(floors["4,2"]).toBe("fl_abyss");
    expect(floors["4,1"]).toBeUndefined();
  });

  it("the hammer breaks st_break stones; black/white ones only for a marble of their colour", () => {
    const w = world([
      { x: 2, y: 1, k: "it_hammer" },
      { x: 4, y: 1, k: "st_break_plain" },
      { x: 6, y: 1, k: "st_break_white" },
    ]);
    w.hit(4, 1, 0, -1, 0, -3); // without hammer: nothing
    w.update(600);
    expect(w.objects[1].gone).toBeFalsy();
    w.actorStep(2.5, 1.5, 0);
    w.hit(4, 1, 0, -1, 0, -3);
    expect(w.breakLook(w.objects[1]).frame).toBe(0);
    w.update(250);
    expect(w.breakLook(w.objects[1]).frame).toBe(5);
    w.hit(6, 1, 0, -1, 0, -3); // black marble at a white one: nothing
    w.update(300);
    expect(w.objects[1].gone).toBe(true);
    expect(w.objects[2].gone).toBeFalsy();
    w.hit(6, 1, 1, -1, 0, -3);
    w.update(600);
    expect(w.objects[2].gone).toBe(true);
  });

  it("a window has panes on its faces; a hard hit breaks one, a very hard one shatters the marble", () => {
    const w = world([{ x: 4, y: 1, k: "st_window_ns", a: { $connections: "5" } }]); // faces N + S
    expect(w.blockAt(4, 1)).toBe(8 | 2 | 16);
    w.marbleAt(4, 0, 0); // above the window
    w.hit(4, 1, 0, 0, -1, -10, 0, 0, 0); // slow: nothing
    expect(w.blockAt(4, 1) & 15).toBe(10);
    w.hit(4, 1, 0, 0, -1, -25, 0, 0, 0); // breaks the north pane
    expect(w.blockAt(4, 1) & 15).toBe(2);
    w.marbleAt(4, 1, 0); // inside, hitting the south pane from within
    w.hit(4, 1, 0, 0, -1, -40, 0, 0, 0);
    expect(w.events).toContainEqual({ type: "shatter", marble: 0 });
    w.hit(4, 1, 0, 0, -1, -30, 0, 0, 0); // breaks the last pane: the stone is gone
    expect(w.blockAt(4, 1)).toBe(0);
  });

  it("a springboard makes a marble near its centre jump and animates", () => {
    const w = world([{ x: 3, y: 0, k: "it_springboard" }]);
    w.actorStep(3.1, 0.5, 0); // 0.4 off in x: nothing
    expect(w.events.some((e) => e.type === "jump")).toBe(false);
    w.actorStep(3.75, 0.75, 0); // 0.25 off in each axis
    expect(w.events).toContainEqual({ type: "jump", marble: 0 });
    expect(w.springboardFrame(w.objects[0])).toBe(1);
    w.update(130);
    expect(w.springboardFrame(w.objects[0])).toBe(0);
  });

  it("a switched-off wormhole does not pull but still teleports", () => {
    const w = world([{ x: 5, y: 0, k: "it_wormhole_off", a: { dest: "1.5,1.5", $state: "0" } }]);
    expect(w.fieldForce(3.5, 0.5)).toEqual([0, 0]);
    expect(w.warpTarget(5.5, 0.5)).toEqual({ x: 1.5, y: 1.5, cut: false });
  });

  it("st_brownie and *_movable stones are pushed like boxes but do not sink (StandardStone)", () => {
    const floors: Record<string, string> = { "3,0": "fl_water", "3,1": "fl_water" };
    const env: ObjectEnv = { stoneAt: () => false, floorAt: (c, r) => floors[`${c},${r}`] ?? "fl_gray", setFloor: (c, r, k) => (floors[`${c},${r}`] = k) };
    const w = new ObjectWorld([{ x: 2, y: 0, k: "st_brownie" }, { x: 2, y: 1, k: "st_box_wood" }, { x: 5, y: 2, k: "st_rawglass_movable" }], W, {}, env);
    expect(w.blockAt(2, 0)).toBe(ALL_FACES);
    expect(w.push(w.objects[0], 1, 0)).toBe(true);
    expect(w.objects[0]).toMatchObject({ col: 3, row: 0, gone: false });
    expect(floors["3,0"]).toBe("fl_water");
    expect(w.blockAt(3, 0)).toBe(ALL_FACES);
    w.push(w.objects[1], 1, 0); // the wood box sinks and becomes a bridge
    expect(w.objects[1].gone).toBe(true);
    expect(floors["3,1"]).toMatch(/^fl_wood_framed/);
    expect(w.push(w.objects[2], 0, 1)).toBe(true);
    expect(w.blockAt(5, 3)).toBe(ALL_FACES);
  });

  describe("boulders (BoulderStone)", () => {
    const floors: Record<string, string> = {};
    const walls = new Set<string>();
    const env: ObjectEnv = {
      stoneAt: (c, r) => c < 0 || r < 0 || c >= W || r >= 5 || walls.has(`${c},${r}`),
      floorAt: (c, r) => floors[`${c},${r}`] ?? "fl_gray",
      setFloor: () => {},
    };
    const BMS = 360;

    it("rolls one cell per animation cycle, waits at an obstacle and triggers it", () => {
      walls.clear();
      walls.add("6,2"); // e.g. an Oxyd stone
      const w = new ObjectWorld([{ x: 2, y: 2, k: "st_boulder_e", a: { orientation: "2" } }], W, {}, env);
      const b = w.objects[0];
      w.update(BMS - 10);
      expect(b.col).toBe(2);
      w.update(20); // init cycle ends: first move
      expect(b.col).toBe(3);
      w.update(BMS);
      expect(b.col).toBe(4);
      w.update(BMS); // reaches 5,2: the wall ahead gets a raising trigger
      expect(b.col).toBe(5);
      expect(w.events).toContainEqual({ type: "oxyd", col: 6, row: 2 });
      w.update(BMS * 3);
      expect(b.col).toBe(5); // blocked: idle
      walls.delete("6,2");
      w.update(BMS * 2);
      expect(b.col).toBeGreaterThan(5);
    });

    it("falls into an abyss and is gone after the fall animation; turn changes the direction", () => {
      walls.clear();
      floors["3,1"] = "fl_abyss";
      const w = new ObjectWorld(
        [
          { x: 2, y: 1, k: "st_boulder_e" },
          { x: 2, y: 3, k: "st_boulder", a: { name: "b" } },
          { x: 0, y: 4, k: "it_trigger", a: { target: "b", action: "turn" } },
        ],
        W, {}, env,
      );
      w.update(BMS + 5);
      expect(w.objects[0]).toMatchObject({ col: 3, gone: false });
      expect(w.boulderFrame(w.objects[0]).falling).toBe(true);
      // the default boulder points north and moved to 2,2; turn → east
      expect(w.objects[1]).toMatchObject({ col: 2, row: 2, state: 3 });
      w.marbleAt(1, 4); // first position: no trigger action (level start)
      w.marbleAt(0, 4);
      expect(w.objects[1].state).toBe(2);
      w.update(BMS);
      expect(w.objects[0].gone).toBe(true);
      expect(w.objects[1]).toMatchObject({ col: 3, row: 2 });
      delete floors["3,1"];
    });
  });

  describe("impulse stones", () => {
    const env: ObjectEnv = { stoneAt: (c, r) => c < 0 || r < 0 || c >= W || r >= 5, floorAt: () => "fl_gray", setFloor: () => {} };
    it("a hit starts a chain: neighbours pulse in turn, boxes next to it are pushed away", () => {
      const w = new ObjectWorld(
        [
          { x: 3, y: 2, k: "st_stoneimpulse" },
          { x: 4, y: 2, k: "st_stoneimpulse" },
          { x: 3, y: 1, k: "st_box_rock" },
        ],
        W, {}, env,
      );
      w.marbleAt(0, 4);
      w.hit(3, 2, 0, -1, 0, -1);
      expect(w.objects[0].impulse?.phase).toBe("expanding");
      w.update(230); // expanding done → impulses out
      expect(w.objects[1].impulse?.phase).toBe("expanding");
      expect([w.objects[2].col, w.objects[2].row]).toEqual([3, 0]); // box pushed north
      w.update(230); // second stone sends back, first one is still shrinking: no ping-pong
      w.update(400);
      expect(w.objects[0].impulse).toBeUndefined();
      expect(w.objects[1].impulse).toBeUndefined();
    });

    it("a hollow impulse stone lets the marble pass until it is active", () => {
      const w = world([{ x: 3, y: 0, k: "st_stoneimpulse_hollow", a: { name: "h" } }, { x: 1, y: 0, k: "it_trigger", a: { target: "h", action: "signal" } }]);
      expect(w.blockAt(3, 0)).toBe(0);
      w.marbleAt(1, 0);
      expect(w.blockAt(3, 0)).toBe(ALL_FACES);
    });
  });

  describe("meditation and landmine", () => {
    it("a hollow pulls the marble towards its centre, a hill pushes; flip turns one into the other", () => {
      const w = world([{ x: 3, y: 0, k: "it_meditation_hollow", a: { name: "m" } }, { x: 1, y: 0, k: "it_trigger", a: { target: "m", action: "flip" } }]);
      const [fx] = w.fieldForce(3.8, 0.5);
      expect(fx).toBeCloseTo(-90 * 0.3);
      expect(w.fieldForce(3.5 + 0.55, 0.5)).toEqual([0, 0]); // outside the radius 0.5
      w.marbleAt(1, 0);
      expect(w.objects[0].state).toBe(2);
      expect(w.fieldForce(3.8, 0.5)[0]).toBeCloseTo(90 * 0.3);
    });

    it("a landmine explodes near its centre, shatters the marble and leaves a hollow", () => {
      const w = world([{ x: 3, y: 0, k: "it_landmine" }]);
      w.actorStep(3.1, 0.5, 0); // 0.4 from the centre: nothing
      expect(w.events).toEqual([]);
      w.actorStep(3.3, 0.5, 0);
      expect(w.events).toContainEqual({ type: "sound", name: "landmine" });
      expect(w.events).toContainEqual({ type: "shatter", marble: 0 });
      w.update(60);
      expect(w.objects[0]).toMatchObject({ kind: "it_meditation_hollow", cls: "meditation", state: -2 });
      expect(w.fieldForce(3.8, 0.5)[0]).toBeLessThan(0);
    });

    it("a box pushed onto a landmine sets it off, onto a hollow it shovels it flatter", () => {
      const w = world([{ x: 2, y: 0, k: "st_box_wood" }, { x: 3, y: 0, k: "it_landmine" }, { x: 2, y: 1, k: "st_box_wood" }, { x: 3, y: 1, k: "it_meditation_dent" }]);
      w.push(w.objects[0], 1, 0);
      expect(w.objects[1].exploding).toBeDefined();
      w.push(w.objects[2], 1, 0);
      expect(w.objects[3].gone).toBe(true); // dent (-1) shovelled to 0 = gone
    });
  });

  it("hollow puzzle stones let the marble through, ignore hits and move with their cluster without shattering", () => {
    const w = world([
      { x: 3, y: 2, k: "st_puzzle_blue", a: { $connections: "4", color: "4" } }, // east
      { x: 4, y: 2, k: "st_puzzle_blue", a: { $connections: "1", color: "4", $hollow: "true" } }, // west, hollow
    ]);
    expect(w.blockAt(4, 2)).toBe(0);
    expect(w.blockAt(3, 2)).toBe(ALL_FACES);
    w.hit(4, 2, 0, 0, -1, -10); // a hit on the hollow one: nothing
    expect(w.objects[1].row).toBe(2);
    w.marbleAt(4, 3); // marble below the hollow stone
    w.hit(3, 2, 0, 0, -1, -10); // push the solid one from above → cluster moves south
    expect(w.objects.map((o) => [o.col, o.row])).toEqual([[3, 3], [4, 3]]);
    expect(w.events.filter((e) => e.type === "shatter")).toEqual([]);
  });

  it("a trigger sends its action to a named Oxyd stone as an event; the reference blocks nothing", () => {
    const w = world([
      { x: 5, y: 0, k: "st_oxyd_ref", a: { name: "oxydl%0" } },
      { x: 2, y: 0, k: "it_trigger", a: { target: "oxydl%0", action: "open" } },
    ]);
    expect(w.blockAt(5, 0)).toBe(0);
    w.marbleAt(2, 0);
    expect(w.events).toContainEqual({ type: "oxydMsg", col: 5, row: 0, msg: "open", value: true });
  });

  it("st_chameleon lets the marble pass but stops boxes (ChameleonStone)", () => {
    const w = world([{ x: 4, y: 0, k: "st_chameleon" }, { x: 3, y: 0, k: "st_box_wood" }]);
    expect(w.blockAt(4, 0)).toBe(0);
    expect(w.push(w.objects[1], 1, 0)).toBe(false);
  });

  it("st_passage lets only actors of its colour pass; signal toggles the colour (PassageStone)", () => {
    const w = world([
      { x: 4, y: 0, k: "st_passage_black", a: { $state: "0", $flavor: "frame", name: "p" } },
      { x: 2, y: 0, k: "it_trigger", a: { target: "p", action: "signal" } },
    ]);
    expect(w.blockAt(4, 0, 0)).toBe(0); // black marble
    expect(w.blockAt(4, 0, 1)).toBe(ALL_FACES); // white marble or pearl
    expect(w.blockAt(4, 0, 2)).toBe(ALL_FACES); // rotor (no colour)
    w.marbleAt(2, 0);
    expect(w.objects[0].state).toBe(1);
    expect(w.blockAt(4, 0, 1)).toBe(0);
    expect(passageLook(w.objects[0])).toEqual({ image: "st_passage_white_frame", shadow: "sh_passage_frame" });
  });

  it("each player has an inventory: items go to the owner of the marble that picks them up", () => {
    const w = world([{ x: 3, y: 0, k: "it_yinyang" }, { x: 6, y: 0, k: "it_magicwand" }]);
    w.ownerOf = (marble) => (marble === 1 ? 1 : 0);
    w.actorStep(3.5, 0.5, 1); // the white marble (player 2) picks up the yin-yang
    w.actorStep(6.5, 0.5, 0); // the black one the wand
    expect(w.inventories).toEqual([["it_magicwand"], ["it_yinyang"]]);
    expect(w.inventory).toEqual(["it_magicwand"]);
    w.player = 1;
    expect(w.inventory).toEqual(["it_yinyang"]);
  });

  it("an actor impulse stone blocks, pushes the marble away from its centre and then pulses for 180 ms", () => {
    const w = world([{ x: 3, y: 1, k: "st_actorimpulse" }, { x: 6, y: 1, k: "st_actorimpulse_invisible", a: { strength: "50" } }]);
    expect(w.blockAt(3, 1)).toBe(ALL_FACES);
    const f = w.bump(3, 1, 3.5, 0.5)!;
    expect(f[0]).toBeCloseTo(0, 6);
    expect(f[1]).toBeCloseTo(-200, 6); // away from the centre (north)
    expect(w.bump(3, 1, 3.5, 0.5)).toBeNull(); // pulsing
    expect(w.actorimpulseFrame(w.objects[0])).toBe(0);
    w.update(70);
    expect(w.actorimpulseFrame(w.objects[0])).toBe(2);
    w.update(120);
    expect(w.bump(3, 1, 2.5, 1.5)![0]).toBeCloseTo(-200, 6);
    expect(w.actorimpulseVisible(w.objects[1])).toBe(false);
    expect(w.bump(6, 1, 7.5, 1.5)![0]).toBeCloseTo(50, 6);
    expect(w.actorimpulseVisible(w.objects[1])).toBe(true);
  });

  it("meditation: every pearl resting 1 s in its own hollow finishes the level; essential hollows must be engaged", () => {
    const w = world([
      { x: 2, y: 1, k: "it_meditation_hollow" },
      { x: 5, y: 1, k: "it_meditation_hollow" },
      { x: 8, y: 1, k: "it_meditation_hollow", a: { essential: "1" } },
    ]);
    w.isPearl = (i) => i >= 1;
    w.actorStep(2.5, 1.5, 0); // the marble is no meditatist
    w.actorStep(2.6, 1.5, 1);
    w.actorStep(5.5, 1.5, 2);
    w.update(500);
    w.actorStep(2.6, 1.5, 1);
    w.actorStep(5.5, 1.5, 2);
    expect(w.meditationCount().engaged).toBe(0); // not yet 1 s
    w.update(600);
    w.actorStep(2.6, 1.5, 1);
    w.actorStep(5.5, 1.5, 2);
    expect(w.meditationCount()).toEqual({ engaged: 2, essential: 1, essentialEngaged: 0 });
    expect(w.meditationDone(2)).toBe(false); // the essential hollow is empty
    w.actorStep(5.95, 1.5, 2); // 0.45 from the centre: left the hollow
    w.actorStep(8.5, 1.5, 2);
    w.update(1100);
    w.actorStep(8.5, 1.5, 2);
    expect(w.meditationDone(2)).toBe(true);
    w.marbleGone(1); // pearl 1 jumps away
    expect(w.meditationDone(2)).toBe(false);
  });

  it("a dropped flag sets the respawn position of its colour, picking it up clears it", () => {
    const w = world([{ x: 3, y: 0, k: "it_flag_white" }, { x: 5, y: 0, k: "it_flag" }]);
    expect(w.flagRespawn).toEqual([undefined, undefined]); // placed flags do nothing (no on_drop)
    w.actorStep(5.5, 0.5, 0);
    expect(w.dropItem(7.2, 1.9)).toBe(true);
    expect(w.flagRespawn).toEqual([{ x: 7.5, y: 1.5 }, undefined]);
    w.actorStep(7.5, 1.5, 0);
    expect(w.flagRespawn).toEqual([undefined, undefined]);
    w.actorStep(3.5, 0.5, 0);
    w.rotateInventory();
    w.rotateInventory();
    expect(w.inventory[0]).toBe("it_flag_white");
    w.dropItem(1.5, 1.5);
    expect(w.flagRespawn).toEqual([undefined, { x: 1.5, y: 1.5 }]);
  });

  it("ring and spoon are picked up and dropped again like plain items", () => {
    const w = world([{ x: 3, y: 0, k: "it_ring" }, { x: 5, y: 0, k: "it_spoon" }]);
    w.actorStep(3.5, 0.5, 0);
    w.actorStep(5.5, 0.5, 0);
    expect(w.inventory).toEqual(["it_spoon", "it_ring"]);
    expect(w.dropItem(7.5, 0.5)).toBe(true);
    expect(w.objects.find((o) => o.col === 7)?.cls).toBe("tool");
  });

  it("st_swap exchanges places with the stone behind it: an object or a wall, not an Oxyd stone", () => {
    const walls: Record<string, string | null> = { "5,0": "st_greenbrown", "3,2": "st_oxyd" };
    const env: ObjectEnv = {
      stoneAt: (c, r) => c < 0 || r < 0 || c >= W || r >= 5 || !!walls[`${c},${r}`],
      floorAt: () => "fl_gray",
      setFloor: () => {},
      staticStone: (c, r) => walls[`${c},${r}`] ?? null,
      setStaticStone: (c, r, k) => void (walls[`${c},${r}`] = k),
    };
    const w = new ObjectWorld([{ x: 4, y: 0, k: "st_swap" }, { x: 2, y: 1, k: "st_swap" }, { x: 3, y: 1, k: "st_box_wood" }, { x: 3, y: 3, k: "st_swap" }], W, {}, env);
    w.hit(4, 0, 0, -1, 0, -6); // from the west: east is the wall
    expect(w.objects[0]).toMatchObject({ col: 5, row: 0 });
    expect(walls["4,0"]).toBe("st_greenbrown");
    expect(walls["5,0"]).toBe(null);
    expect(w.swapFrame(w.objects[0])).toBe(3); // st_swap_e
    w.update(150);
    expect(w.swapFrame(w.objects[0])).toBe(0);
    w.hit(2, 1, 0, -1, 0, -6); // the box changes places with it
    expect(w.objects[1]).toMatchObject({ col: 3, row: 1 });
    expect(w.objects[2]).toMatchObject({ col: 2, row: 1 });
    w.hit(3, 3, 0, 0, 1, -6); // from below: north is an Oxyd stone – no swap
    expect(w.objects[3]).toMatchObject({ col: 3, row: 3 });
    w.hit(4, 1, 0, -1, 0, -6); // nothing at all
  });

  describe("four switch (FourSwitch)", () => {
    it("state targets: the old direction gets false (not on the first turn), the new one true", () => {
      const w = world([
        { x: 5, y: 0, k: "st_door_a", a: { name: "d1" } },
        { x: 6, y: 0, k: "st_door_a", a: { name: "d2" } },
        { x: 3, y: 2, k: "st_fourswitch", a: { $state: "3", target_2: "d1", action_2: "open", target_1: "d2", action_1: "open", target_3: "d1", action_3: "close" } },
      ]);
      w.hit(3, 2, 0, -1, 0, -1); // north → east: opens d1
      w.update(300);
      expect(w.objects[2].state).toBe(2);
      expect(w.objects[0].state).toBe(1);
      w.hit(3, 2, 0, -1, 0, -1); // east → south: east gets "open" false (doors open anyway), south opens d2
      w.update(300);
      expect(w.objects[2].state).toBe(1);
      expect(w.objects[1].state).toBe(1);
      expect(w.fourswitchFrame(w.objects[2])).toBe(2); // st_fourswitch-s
    });

    it("a plain target gets the new direction: boulders orientate, Lua callbacks get the number", () => {
      const w = world([
        { x: 3, y: 2, k: "st_fourswitch", a: { $state: "3", target: "b", action: "orientate" } },
        { x: 7, y: 3, k: "st_boulder_n", a: { name: "b" } },
        { x: 3, y: 4, k: "st_fourswitch", a: { $state: "3", target: "lua_fn" } },
      ]);
      const calls: unknown[] = [];
      w.onCallback = (fn, value) => calls.push([fn, value]);
      w.hit(3, 2, 0, -1, 0, -1); // north → east
      expect(w.objects[1].state).toBe(2);
      w.hit(3, 4, 0, -1, 0, -1);
      w.hit(3, 4, 0, -1, 0, -1);
      expect(calls).toEqual([["lua_fn", 2], ["lua_fn", 1]]);
    });
  });

  it("st_flat_movable is pushed like a box but vanishes in water or abyss without a bridge (FlatStone)", () => {
    const floors: Record<string, string> = { "3,0": "fl_water" };
    const env: ObjectEnv = { stoneAt: () => false, floorAt: (c, r) => floors[`${c},${r}`] ?? "fl_gray", setFloor: (c, r, k) => (floors[`${c},${r}`] = k) };
    const w = new ObjectWorld([{ x: 2, y: 0, k: "st_flat_movable" }], W, {}, env);
    expect(w.push(w.objects[0], 1, 0)).toBe(true);
    expect(w.objects[0].gone).toBe(true);
    expect(floors["3,0"]).toBe("fl_water");
  });

  it("st_chess jumps like a knight when its colour hits it rolling sideways, and captures (ChessStone)", () => {
    const floors: Record<string, string> = { "6,2": "fl_abyss" };
    const env: ObjectEnv = { stoneAt: (c, r) => c < 0 || r < 0 || c >= W || r >= 5, floorAt: (c, r) => floors[`${c},${r}`] ?? "fl_gray", setFloor: () => {} };
    const w = new ObjectWorld([{ x: 2, y: 1, k: "st_chess_black" }, { x: 4, y: 2, k: "st_chess_white" }], W, {}, env);
    w.hit(2, 1, 1, -1, 0, -6, 0, 3); // white marble: wrong colour, nothing
    expect(w.objects[0].chess).toBeUndefined();
    w.hit(2, 1, 0, -1, 0, -6, 0, 0); // no sideways speed: nothing
    expect(w.objects[0].chess).toBeUndefined();
    w.hit(2, 1, 0, -1, 0, -6, 0, 3); // east and south: two east, one south → (4, 2) is the white one
    expect(w.objects[1].chess?.phase).toBe("captured");
    const run = (ms: number) => {
      for (let t = 0; t < ms; t += 50) w.update(50);
    };
    run(650); // the captured stone is gone
    expect(w.objects[1].gone).toBe(true);
    run(800); // the black one disappears and moves
    expect(w.objects[0]).toMatchObject({ col: 4, row: 2 });
    run(700);
    expect(w.objects[0].chess?.phase).toBe("idle");
    w.hit(4, 2, 0, -1, 0, -6, 0, -3); // east and north: (6, 1)
    run(1400);
    expect(w.objects[0]).toMatchObject({ col: 6, row: 1 });
  });

  it("st_blur turns into a passage stone when a marble hits it (BlurStone)", () => {
    const w = world([{ x: 3, y: 0, k: "st_blur_straight" }, { x: 5, y: 0, k: "st_blur_cross" }, { x: 7, y: 0, k: "st_blur_magic" }]);
    w.hit(3, 0, 1); // white marble: straight → white passage
    expect(w.objects[0]).toMatchObject({ cls: "passage", state: 1, kind: "st_passage_white_square" });
    w.hit(5, 0, 1); // cross → the other colour
    expect(w.objects[1]).toMatchObject({ cls: "passage", state: 0 });
    w.hit(7, 0, 0); // magic: only with the wand
    expect(w.objects[2].cls).toBe("blur");
    w.inventory.push("it_magicwand");
    w.hit(7, 0, 0);
    expect(w.objects[2]).toMatchObject({ cls: "passage", state: 1 });
    expect(w.blockAt(3, 0, 1)).toBe(0);
  });

  describe("magic wand", () => {
    it("is picked up within 0.3, rotates in the inventory and turns boulders and plain one-way stones", () => {
      const w = world([
        { x: 3, y: 0, k: "it_magicwand" },
        { x: 5, y: 2, k: "st_boulder_e" },
        { x: 7, y: 2, k: "st_oneway_e" },
        { x: 8, y: 2, k: "st_oneway_black_e" },
      ]);
      w.inventory.push("it_seed_wood");
      w.actorStep(3.75, 0.5, 0); // 0.25 from the centre
      expect(w.inventory).toEqual(["it_magicwand", "it_seed_wood"]);
      w.rotateInventory();
      expect(w.inventory).toEqual(["it_seed_wood", "it_magicwand"]);
      w.hit(5, 2, 0, -1, 0, -1); // seed in hand: nothing happens
      expect(w.objects[1].state).toBe(2);
      w.rotateInventory();
      w.hit(5, 2, 0, -1, 0, -1);
      expect(w.objects[1].state).toBe(0); // east → west
      w.hit(7, 2, 0, -1, 0, -1);
      expect(w.objects[2].state).toBe(0);
      w.hit(8, 2, 0, -1, 0, -1);
      expect(w.objects[3].state).toBe(2); // black one-way stones ignore the wand
    });

    it("can be dropped again; a dropped wand is an item that can be picked up", () => {
      const w = world([]);
      w.inventory.push("it_magicwand");
      expect(w.dropItem(4.5, 1.5)).toBe(true);
      expect(w.objects[0]).toMatchObject({ kind: "it_magicwand", cls: "wand", col: 4, row: 1 });
      w.actorStep(4.5, 1.5, 0);
      expect(w.inventory).toEqual(["it_magicwand"]);
    });
  });

  describe("wood seeds", () => {
    it("the marble picks a seed up near its centre and drops it; it grows into a wood box", () => {
      const w = world([{ x: 3, y: 0, k: "it_seed_wood" }]);
      w.actorStep(3.3, 0.5, 0); // 0.3 from the centre: radius is 0.2
      expect(w.inventory).toEqual([]);
      w.actorStep(3.6, 0.5, 0);
      expect(w.inventory).toEqual(["it_seed_wood"]);
      expect(w.events).toContainEqual({ type: "sound", name: "pickup" });
      w.events.length = 0;
      expect(w.dropItem(6.5, 0.5)).toBe(true);
      expect(w.inventory).toEqual([]);
      w.actorStep(6.5, 0.5, 0); // a growing seed is not picked up again
      expect(w.inventory).toEqual([]);
      w.update(SEED_GROW_MS - 10);
      expect(w.blockAt(6, 0)).toBe(0);
      w.update(20);
      expect(w.blockAt(6, 0)).toBe(ALL_FACES);
      const box = w.objects.find((o) => o.cls === "box")!;
      expect(box.growing).toBeDefined();
      w.actorStep(5.7, 0.5, 0, 0.375); // touching the growing box
      expect(w.events).toContainEqual({ type: "shatter", marble: 0 });
      w.update(BOX_GROW_MS);
      expect(box.growing).toBeUndefined();
      w.events.length = 0;
      w.actorStep(5.7, 0.5, 0, 0.375); // a grown box is harmless
      expect(w.events).toEqual([]);
    });

    it("cannot drop where an item lies; a box pushed onto a seed or a signal makes it grow", () => {
      const w = world([{ x: 2, y: 0, k: "it_trigger" }, { x: 3, y: 1, k: "st_box_wood" }, { x: 4, y: 1, k: "it_seed_wood" }, { x: 5, y: 2, k: "it_seed", a: { name: "s" } }, { x: 1, y: 2, k: "it_trigger", a: { target: "s", action: "grow" } }]);
      w.inventory.push("it_seed_wood");
      expect(w.dropItem(2.5, 0.5)).toBe(false);
      w.push(w.objects[1], 1, 0);
      expect(w.objects[2].growing).toBeDefined();
      w.marbleAt(1, 2);
      expect(w.objects[3].growing).toBeDefined();
      w.update(SEED_GROW_MS);
      expect(w.objects[1].gone).toBe(true); // replaced by the grown box
      expect(w.blockAt(4, 1)).toBe(ALL_FACES);
    });

    it("a box grown on water becomes a bridge", () => {
      const floors: Record<string, string> = { "4,0": "fl_water" };
      const env: ObjectEnv = { stoneAt: () => false, floorAt: (c, r) => floors[`${c},${r}`] ?? "fl_gray", setFloor: (c, r, k) => (floors[`${c},${r}`] = k) };
      const w = new ObjectWorld([], W, {}, env, () => 0);
      w.inventory.push("it_seed_wood");
      w.dropItem(4.5, 0.5);
      w.update(SEED_GROW_MS);
      w.update(BOX_GROW_MS);
      expect(floors["4,0"]).toBe("fl_wood_framed_h");
      expect(w.blockAt(4, 0)).toBe(0);
    });
  });

  describe("timers", () => {
    const timer = (a: Record<string, string>): ObjectDef => ({ x: 3, y: 0, k: "st_timer", a: { target: "door1", action: "signal", ...a } });

    it("ot_timer (no cell) runs like a timer stone and calls a Lua function without target object", () => {
      const w = world([door(5), { x: -1, y: -1, k: "ot_timer", a: { target: "door1;spin", action: "signal", interval: "0.5", $state: "1" } }]);
      const calls: string[] = [];
      w.onCallback = (fn, value) => calls.push(`${fn} ${value}`);
      expect(w.blockAt(-1, -1)).toBe(0);
      w.update(600);
      w.update(200);
      expect(w.objects[0].state).toBe(1);
      expect(calls).toEqual(["spin true"]);
    });

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

describe('fire', () => {
  function fireWorld(defs: ObjectDef[], floors: Record<string, string>, rnd: number) {
    const fl = { ...floors };
    const env: ObjectEnv = { stoneAt: () => false, floorAt: (c, r) => fl[c + ',' + r] ?? 'fl_metal', setFloor: (c, r, k) => (fl[c + ',' + r] = k) };
    const w = new ObjectWorld(defs, W, {}, env, () => rnd);
    w.marbleAt(9, 9);
    return { w, fl };
  }
  const fire = (w: ObjectWorld) => w.objects.filter((o) => !o.gone && o.cls === 'burnable').map((o) => [o.col, o.kind]);

  it('fire spreads over burnable floor after the countdown', () => {
    const { w } = fireWorld([{ x: 1, y: 0, k: 'it_burnable_ignited' }], { '1,0': 'fl_wood', '2,0': 'fl_wood' }, 0.5);
    w.update(800);
    expect(fire(w)).toEqual([[1, 'it_burnable_burning']]); // neighbour: countdown 1 → 0
    w.update(800);
    expect(fire(w)).toEqual([[2, 'it_burnable_ignited'], [1, 'it_burnable_burning']]);
  });

  it('burnt-out wood becomes abyss; burnable oil catches at once; ash on other floors', () => {
    const { w, fl } = fireWorld([{ x: 1, y: 0, k: 'it_burnable_burning' }, { x: 2, y: 0, k: 'it_burnable_oil' }], { '1,0': 'fl_wood' }, 0.9);
    w.update(800);
    expect(fl['1,0']).toBe('fl_abyss');
    expect(fire(w)).toEqual([[2, 'it_burnable_ignited']]);
    w.update(800); // ignited always burns on
    w.update(800); // stops: fl_metal keeps ash
    expect(fire(w)).toEqual([[2, 'it_burnable_ash']]);
  });

  it('fire heats neighbouring ice into water and ignites dynamite', () => {
    const { w, fl } = fireWorld([{ x: 1, y: 0, k: 'it_burnable_ignited' }, { x: 1, y: 1, k: 'it_dynamite' }], { '0,0': 'fl_ice' }, 0.5);
    w.update(800);
    expect(w.objects[1].blast).toBeDefined();
    w.update(2000);
    expect(fl['0,0']).toBe('fl_water');
  });

  it('a full extinguisher puts out fire and leaves foam, then it is medium', () => {
    const { w } = fireWorld([{ x: 3, y: 3, k: 'it_burnable_burning' }], {}, 0.5);
    w.inventory.push('it_extinguisher_full');
    expect(w.useExtinguisher(3.5, 4.5)).toBe(true);
    expect(w.inventory).toEqual(['it_extinguisher_medium']);
    const kinds = w.objects.filter((o) => !o.gone).map((o) => o.kind);
    expect(kinds.filter((k) => k === 'it_burnable_fireproof').length).toBe(13);
  });
});

describe('flat and plaster stones', () => {
  it('the hammer breaks breakable and cracked ones, not burnable ones; dynamite breaks breakable ones', () => {
    const w = world([
      { x: 1, y: 1, k: 'st_flat_breakable' },
      { x: 3, y: 1, k: 'st_flat_cracked' },
      { x: 5, y: 1, k: 'st_flat_burnable' },
      { x: 7, y: 1, k: 'st_plaster_breakable' },
    ]);
    w.inventory.push('it_hammer');
    for (const x of [1, 3, 5, 7]) w.hit(x, 1, 0, -1, 0, -5);
    w.update(300);
    expect(w.objects.map((o) => o.gone)).toEqual([true, true, false, true]);
  });

  it('a burnable flat stone breaks when fire heats it', () => {
    const fl: Record<string, string> = {};
    const env: ObjectEnv = { stoneAt: () => false, floorAt: (c, r) => fl[c + ',' + r] ?? 'fl_metal', setFloor: (c, r, k) => (fl[c + ',' + r] = k) };
    const w = new ObjectWorld([{ x: 2, y: 2, k: 'st_flat_burnable' }, { x: 2, y: 3, k: 'it_burnable_ignited' }], W, {}, env, () => 0.5);
    w.marbleAt(9, 9);
    w.update(800);
    w.update(300);
    expect(w.objects[0].gone).toBe(true);
  });
});

describe('simple items', () => {
  it('it_cross performs its action after the marble stayed for the interval; leaving cancels', () => {
    const w = world([door(5), { x: 2, y: 0, k: 'it_cross', a: { target: 'door1', action: 'open', interval: '2' } }]);
    w.actorStep(2.5, 0.5, 0);
    w.update(1000);
    w.update(100); // left the cross: alarm cancelled
    w.update(2000);
    expect(w.objects[0].state).toBe(0);
    for (let t = 0; t < 21; t++) {
      w.actorStep(2.5, 0.5, 0);
      w.update(100);
    }
    w.update(600);
    expect(w.objects[0].state).toBe(1);
  });

  it('the brush cleans ash and squashed cherries; a dropped cherry is squashed', () => {
    const w = world([{ x: 2, y: 0, k: 'it_burnable_ash' }, { x: 4, y: 0, k: 'it_squashed' }]);
    w.brushAt(2.5, 0.5);
    w.brushAt(4.5, 0.5);
    expect(w.objects.map((o) => o.gone)).toEqual([true, true]);
    w.inventory.push('it_cherry');
    w.dropItem(6.5, 0.5);
    expect(w.objects[2].kind).toBe('it_squashed');
  });

  it('invisible marbles pass blue windows, visible ones are blocked', () => {
    const w = world([{ x: 3, y: 0, k: 'st_window_w' }]);
    expect(w.blockAt(3, 0, 0)).not.toBe(0);
    expect(w.blockAt(3, 0, 0, true)).toBe(0);
  });
});

describe('polar switch and barrier', () => {
  it('a polar switch toggles on hit, performs its action and lets invisible marbles pass', () => {
    const w = world([door(5), { x: 3, y: 0, k: 'st_polarswitch', a: { target: 'door1', action: 'open' } }]);
    expect(w.blockAt(3, 0, 0)).toBe(ALL_FACES);
    expect(w.blockAt(3, 0, 0, true)).toBe(0);
    w.hit(3, 0, 0, -1, 0, -3);
    expect(w.objects[1].state).toBe(1);
    w.update(500);
    expect(w.objects[0].state).toBe(1);
  });

  it('a barrier rebounds marbles carrying its item and lets others pass', () => {
    const w = world([{ x: 3, y: 0, k: 'st_barrier', a: { flavor: 'it_hammer' } }, { x: 5, y: 0, k: 'st_barrier', a: {} }]);
    expect(w.blockAt(3, 0, 0, false, 0)).toBe(0);
    expect(w.blockAt(5, 0, 0, false, 0)).toBe(0);
    w.inventory.push('it_spade');
    expect(w.blockAt(3, 0, 0, false, 0)).toBe(0);
    expect(w.blockAt(5, 0, 0, false, 0)).toBe(ALL_FACES); // "all": any item
    w.inventory.push('it_hammer');
    expect(w.blockAt(3, 0, 0, false, 0)).toBe(ALL_FACES);
  });
});

describe('magic, ghost and disco stones', () => {
  it('magic stones transform on hit; ghost stones need the right tool', () => {
    const set: string[] = [];
    const env: ObjectEnv = { stoneAt: () => false, floorAt: () => 'fl_gray', setFloor: () => {}, setStaticStone: (c, r, k) => set.push(`${c},${r},${k}`) };
    const w = new ObjectWorld([{ x: 1, y: 1, k: 'st_magic_oxyda' }, { x: 3, y: 1, k: 'st_ghost_greenbrown' }, { x: 5, y: 1, k: 'st_magic_brick' }], W, {}, env);
    w.marbleAt(0, 0);
    w.hit(1, 1, 0, -1, 0, -3);
    expect(w.objects.filter((o) => !o.gone).map((o) => o.kind)).toContain('st_lightglass_movable');
    w.hit(3, 1, 0, -1, 0, -3);
    expect(set).toEqual([]);
    w.inventory.push('it_magicwand');
    w.hit(3, 1, 0, -1, 0, -3);
    w.hit(5, 1, 0, -1, 0, -3);
    expect(set).toEqual(['3,1,st_greenbrown', '5,1,st_rawglass']);
  });

  it('disco stones let actors pass and change their darkness by messages', () => {
    const w = world([{ x: 2, y: 0, k: 'st_disco_dark', a: { name: 'd' } }]);
    expect(w.blockAt(2, 0, 0)).toBe(0);
    w.sendMessage(w.objects[0], 'lighten', true);
    expect(w.objects[0].state).toBe(1);
    w.sendMessage(w.objects[0], 'signal', true);
    expect(w.objects[0].state).toBe(0);
  });
});

describe('monoflop and flash', () => {
  it('a monoflop switches on when hit, the timer restarts on a new hit, then it switches off', () => {
    const w = world([door(5), { x: 3, y: 0, k: 'st_monoflop', a: { target: 'door1', action: 'signal', interval: '1' } }]);
    w.hit(3, 0, 0, -1, 0, -3);
    expect(w.objects[1].state).toBe(1);
    w.update(800);
    w.hit(3, 0, 0, -1, 0, -3); // renew
    w.update(800);
    expect(w.objects[1].state).toBe(1);
    w.update(300);
    expect(w.objects[1].state).toBe(0);
  });

  it('a flash stone pushes the other marble with 20 × the hitting velocity', () => {
    const w = world([{ x: 3, y: 0, k: 'st_flash' }]);
    w.hit(3, 0, 0, -1, 0, -3, 2, 1, 0);
    expect(w.events.find((e) => e.type === 'flash')).toEqual({ type: 'flash', marble: 0, fx: 40, fy: 20 });
  });
});

describe('bottle', () => {
  it('a bottle is picked up; a broken one shatters the marble, cannot be taken and the brush cleans it', () => {
    const w = world([{ x: 2, y: 0, k: 'it_bottle_idle' }, { x: 4, y: 0, k: 'it_bottle_broken' }]);
    w.actorStep(2.5, 0.5, 0);
    expect(w.inventory).toEqual(['it_bottle_idle']);
    w.actorStep(4.5, 0.5, 0);
    expect(w.objects[1].gone).toBe(false);
    expect(w.events.some((e) => e.type === 'shatter')).toBe(true);
    w.brushAt(4.5, 0.5);
    expect(w.objects[1].gone).toBe(true);
  });
});
