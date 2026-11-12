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
