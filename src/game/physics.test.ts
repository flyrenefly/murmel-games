import { describe, expect, it } from 'vitest';
import { parseLevel } from './level';
import { MARBLE_RADIUS, PHYSICS_DT, PhysicsWorld, type Contact } from './physics';

const level = parseLevel({
  id: 't',
  title: 'T',
  author: 'x',
  license: 'GPL',
  map: ['#######', '#@...A#', '#.....#', '#A....#', '#######'],
});

function run(w: PhysicsWorld, seconds: number, contacts: Contact[] = []): Contact[] {
  for (let t = 0; t < seconds; t += PHYSICS_DT) w.step((c) => contacts.push(c));
  return contacts;
}

describe('PhysicsWorld', () => {
  it('starts at the centre of the start cell', () => {
    const w = new PhysicsWorld(level);
    expect(w.position).toEqual({ x: 1.5, y: 1.5 });
  });

  it('slows down by rolling resistance', () => {
    const w = new PhysicsWorld(level);
    w.applyImpulse(2, 0);
    run(w, 0.5);
    expect(w.velocity.x).toBeGreaterThan(0);
    expect(w.velocity.x).toBeLessThan(2);
  });

  it('bounces off a wall and never enters it', () => {
    const w = new PhysicsWorld(level);
    w.applyImpulse(0, -6);
    const contacts = run(w, 0.3);
    expect(w.velocity.y).toBeGreaterThan(0);
    expect(w.position.y).toBeGreaterThanOrEqual(1 + MARBLE_RADIUS - 1e-6);
    expect(contacts.some((c) => c.kind === 'wall')).toBe(true);
  });

  it('reports a signal stone contact once per touch', () => {
    const w = new PhysicsWorld(level);
    w.applyImpulse(8, 0);
    const contacts = run(w, 1);
    const signal = contacts.filter((c) => c.kind === 'signal');
    expect(signal.length).toBeGreaterThanOrEqual(1);
    expect(signal[0]).toMatchObject({ kind: 'signal', index: 0 });
  });

  it('does not tunnel through a wall at maximum speed', () => {
    const w = new PhysicsWorld(level);
    for (let i = 0; i < 20; i++) {
      w.applyImpulse(0, 50);
      run(w, 0.05);
      expect(w.position.y).toBeLessThanOrEqual(4 - MARBLE_RADIUS + 1e-6);
    }
  });
});
