import { describe, expect, it } from 'vitest';
import { ALL_FACES, NORTH, ObjectWorld, SOUTH, type ObjectDef } from './objects';

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
});
