import { describe, expect, it } from 'vitest';
import { parseLevel } from './level';
import { NORTH, SOUTH } from "./objects";
import { DEFAULT_MOUSE_SPEED, floorProps, MARBLE_RADIUS, PHYSICS_DT, PhysicsWorld, type Contact } from './physics';

const level = parseLevel({
  id: 't',
  title: 'T',
  author: 'x',
  license: 'GPL',
  map: ['#########', '#@.....A#', '#.......#', '#A......#', '#########'],
});

function run(w: PhysicsWorld, seconds: number, contacts: Contact[] = []): Contact[] {
  const n = Math.round(seconds / PHYSICS_DT);
  for (let i = 0; i < n; i++) w.step((c) => contacts.push(c));
  return contacts;
}

describe('PhysicsWorld (Enigma model)', () => {
  it('starts at the centre of the start cell', () => {
    const w = new PhysicsWorld(level);
    expect(w.position).toEqual({ x: 1.5, y: 1.5 });
  });

  it('turns a mouse movement into a velocity like Enigma: speed × px × adhesion × 10 ms', () => {
    const w = new PhysicsWorld(level);
    w.addMouseForce(DEFAULT_MOUSE_SPEED * 10, 0); // 10 px to the right
    run(w, 0.01);
    const expected = DEFAULT_MOUSE_SPEED * 10 * floorProps('fl_gray').adhesion * 0.01;
    // minus a little friction during the tick
    expect(w.velocity.x).toBeGreaterThan(expected * 0.9);
    expect(w.velocity.x).toBeLessThanOrEqual(expected);
    // the force only lasts one tick
    const v = w.velocity.x;
    run(w, 0.05);
    expect(w.velocity.x).toBeLessThan(v);
  });

  it('friction slows the marble down to a stop', () => {
    const w = new PhysicsWorld(level);
    w.setVelocity(2, 0);
    run(w, 3);
    expect(Math.abs(w.velocity.x)).toBeLessThan(0.05);
  });

  it('bounces off a wall elastically and never enters it', () => {
    const w = new PhysicsWorld(level);
    w.setVelocity(0, -3);
    const contacts = run(w, 0.3);
    expect(w.velocity.y).toBeGreaterThan(0);
    expect(w.position.y).toBeGreaterThanOrEqual(1 + MARBLE_RADIUS - 1e-6);
    expect(contacts.some((c) => c.kind === 'wall')).toBe(true);
  });

  it('a fast hit on a signal stone is reported once, a slow touch is not', () => {
    const fast = new PhysicsWorld(level);
    fast.setVelocity(20, 0);
    const hits = run(fast, 1).filter((c) => c.kind === 'signal');
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatchObject({ kind: 'signal', index: 0 });

    // Gentle push: terminal speed (F / friction)^(1/0.8) ≈ 0.17 tiles/s, below the hit speed.
    const slow = new PhysicsWorld(level);
    slow.respawn(6.5, 1.5);
    slow.setAxisForce(0.4, 0);
    const slowContacts = run(slow, 4);
    expect(slow.position.x).toBeCloseTo(7 - MARBLE_RADIUS, 2); // it did reach the stone
    expect(slowContacts.filter((c) => c.kind === 'signal').length).toBe(0);
  });

  it('pressing into a wall does not make the marble jitter', () => {
    const w = new PhysicsWorld(level);
    w.setAxisForce(0, -10);
    run(w, 3);
    expect(Math.abs(w.velocity.y)).toBeLessThan(0.05);
    expect(w.position.y).toBeCloseTo(1 + MARBLE_RADIUS, 3);
  });

  it('does not tunnel through a wall at maximum speed', () => {
    const w = new PhysicsWorld(level);
    w.setVelocity(0, 70);
    run(w, 0.2);
    expect(w.position.y).toBeLessThanOrEqual(4 - MARBLE_RADIUS + 1e-6);
    expect(w.position.y).toBeGreaterThan(1);
  });

  it("door d blocks only its closed faces, and only from outside", () => {
    // closed door in cell (4, 2) with faces north and south
    const blockers = { blockAt: (c: number, r: number) => (c === 4 && r === 2 ? NORTH | SOUTH : 0) };
    const across = new PhysicsWorld(level, blockers);
    across.respawn(2.5, 2.5);
    across.setVelocity(12, 0);
    run(across, 0.6);
    expect(across.position.x).toBeGreaterThan(5); // rolled through west to east
    const down = new PhysicsWorld(level, blockers);
    down.respawn(4.5, 1.5);
    down.setVelocity(0, 4);
    const contacts = run(down, 0.3);
    expect(down.position.y).toBeLessThan(2); // bounced off the north face
    expect(contacts.some((c) => c.kind === "object" && c.col === 4 && c.row === 2)).toBe(true);
  });
});

describe('other actors (rotor, top, killer)', () => {
  const arena = (actors: { k: string; x: number; y: number; a?: Record<string, string> }[]) =>
    parseLevel({
      id: 'a',
      title: 'A',
      author: 'x',
      license: 'GPL',
      map: ['############', '#@........A#', '#..........#', '#..........#', '#A.........#', '############'],
      actors,
    });

  it('a rotor within range chases the marble and shatters it on contact', () => {
    const w = new PhysicsWorld(arena([{ k: 'ac_rotor', x: 6.5, y: 1.5, a: { range: '8', strength: '20' } }]));
    const contacts = run(w, 3);
    expect(contacts.some((c) => c.kind === 'actor' && c.actor === 'rotor')).toBe(true);
  });

  it('a rotor out of range goes home and stays there', () => {
    const w = new PhysicsWorld(arena([{ k: 'ac_rotor', x: 9.5, y: 3.5, a: { range: '2', strength: '20' } }]));
    const r = w.enemies[0];
    r.vel.x = -3;
    const contacts = run(w, 4);
    expect(contacts.some((c) => c.kind === 'actor')).toBe(false);
    expect(Math.hypot(r.pos.x - 9.5, r.pos.y - 3.5)).toBeLessThan(0.3);
  });

  it('the killer follows the mouse faster than the marble (twice the force, less mass)', () => {
    const w = new PhysicsWorld(arena([{ k: 'ac_killer_white', x: 1.5, y: 3.5 }]));
    w.addMouseForce(DEFAULT_MOUSE_SPEED * 10, 0);
    run(w, 0.01);
    const k = w.enemies[0];
    expect(k.vel.x).toBeGreaterThan(w.velocity.x * 2.5);
    expect(k.radius).toBeCloseTo(13 / 64);
  });

  it('actors bounce off stones and off each other without hitting the stones', () => {
    const w = new PhysicsWorld(arena([
      { k: 'ac_top', x: 5.2, y: 3.5, a: { gohome: 'false', range: '0' } },
      { k: 'ac_top', x: 5.9, y: 3.5, a: { gohome: 'false', range: '0' } },
    ]));
    const [a, b] = w.enemies;
    a.vel.x = 4;
    b.vel.x = -4;
    const contacts: Contact[] = [];
    for (let i = 0; i < 400 && a.vel.x > 0; i++) run(w, PHYSICS_DT, contacts);
    expect(a.vel.x).toBeLessThan(0); // exchanged velocities
    expect(b.vel.x).toBeGreaterThan(0);
    expect(b.pos.x - a.pos.x).toBeGreaterThan(0.45);
    expect(contacts.filter((c) => c.kind !== 'actor')).toEqual([]);
  });
});
