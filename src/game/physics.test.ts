import { describe, expect, it } from 'vitest';
import { parseLevel } from './level';
import { DEFAULT_MOUSE_SPEED, FLOOR_PROPS, MARBLE_RADIUS, PHYSICS_DT, PhysicsWorld, type Contact } from './physics';

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
    const expected = DEFAULT_MOUSE_SPEED * 10 * FLOOR_PROPS.stone.adhesion * 0.01;
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
    slow.respawn(6, 1);
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
});
