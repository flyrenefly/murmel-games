import { describe, expect, it } from 'vitest';
import { Enemy } from './actors';

describe('rotors (RotorBase::think)', () => {
  const marbles = [
    { x: 5, y: 2, current: true }, // 3 to the east
    { x: 0, y: 3, current: false }, // 2 to the west, 1 south
  ];

  it('chase the sum of the directions to all balls in range by default', () => {
    const e = new Enemy('rotor', { k: 'ac_rotor', x: 2, y: 2, a: { range: '20' } });
    const [fx, fy] = e.chaseForce(marbles, 0.01, () => 0.5);
    // east (1, 0) + west-south (-2, 1)/√5 → mostly east, a bit south
    expect(fx).toBeGreaterThan(0);
    expect(fy).toBeGreaterThan(0);
  });

  it('attacknearest: only the nearest ball', () => {
    const e = new Enemy('rotor', { k: 'ac_rotor', x: 2, y: 2, a: { range: '20', attacknearest: 'true' } });
    const [fx, fy] = e.chaseForce(marbles, 0.01, () => 0.5);
    expect(fx).toBeLessThan(0); // towards the western one (distance √5 < 3)
    expect(fy).toBeGreaterThan(0);
  });

  it('prefercurrent 1: only the steered marble, even when another one is nearer', () => {
    const e = new Enemy('rotor', { k: 'ac_rotor', x: 2, y: 2, a: { range: '20', attacknearest: 'true', prefercurrent: '1' } });
    const [fx, fy] = e.chaseForce(marbles, 0.01, () => 0.5);
    expect(fx).toBeGreaterThan(0);
    expect(fy).toBeCloseTo(0);
  });
});

describe('horse (Horse::think / updateTarget)', () => {
  const horse = (a: Record<string, string>) => new Enemy('horse', { k: 'ac_horse', x: 1.5, y: 1.5, a: { steady: 'true', ...a } });

  it('performs its action at a reached target before the next destination', () => {
    const h = horse({ dests: '1.5,1.5;4.5,1.5', loop: 'false' });
    const reached: number[] = [];
    h.onReached = () => reached.push(h.destIdx);
    h.horseForce(); // takes the first target (OBJBIT_NEWDEST)
    const [fx] = h.horseForce(); // there already: action, then towards the second
    expect(reached).toEqual([0]);
    expect(fx).toBeGreaterThan(0);
  });

  it('a callback setting new destinations: Enigma still counts on (destidx 1), loop starts anew', () => {
    const h = horse({ dests: '1.5,1.5', loop: 'true' });
    h.onReached = () => {
      h.dests = [[1.5, 4.5]];
      h.destIdx = 0;
      h.newDest = true;
    };
    h.horseForce();
    const [, fy] = h.horseForce();
    expect(fy).toBeGreaterThan(0); // towards (1.5, 4.5)
    expect(h.destIdx).toBe(0);
  });

  it('without loop it stops after the last destination until Lua sets new ones', () => {
    const h = horse({ dests: '1.5,1.5', loop: 'false' });
    h.horseForce();
    expect(h.horseForce()).toEqual([0, 0]);
    expect(h.horseForce()).toEqual([0, 0]);
    h.dests = [[3.5, 1.5]];
    h.destIdx = 0;
    h.newDest = true;
    expect(h.horseForce()[0]).toBeGreaterThan(0);
  });
});
