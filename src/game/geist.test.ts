import { describe, expect, it } from 'vitest';
import solution01 from '../../solutions/murmel/01.json';
import l01 from '../levels/01.json';
import l02 from '../levels/02.json';
import { startLuaNode } from '../lua/node';
import { Geist, vergleich } from './geist';
import type { LevelFile } from './level';
import { replay } from './replay';

const level = l01 as LevelFile;

describe('Geist', () => {
  it('läuft im Gleichschritt und steht dort, wo der Lauf nach gleich vielen Schritten stand', async () => {
    const g = await Geist.create(level, solution01, startLuaNode);
    const input = solution01.input.slice(0, 40);
    const steps = input.reduce((n, e) => n + (e.length === 2 ? 0 : (e[0] as number)), 0);
    const ref = await replay(level, { ...solution01, input, steps }, { startLua: startLuaNode });

    while (g.schritte < ref.steps) g.folgen(ref.steps);

    expect(g.schritte).toBe(ref.steps);
    const m = ref.physics.marbles[ref.physics.current];
    expect(g.sprite(1)).toMatchObject({ kind: 'marble', ghost: true, x: m.pos.x, y: m.pos.y });
  });

  it('holt je Aufruf höchstens 400 Schritte auf', async () => {
    const g = await Geist.create(level, solution01, startLuaNode);

    g.folgen(5000);

    expect(g.schritte).toBe(400);
  });

  it('verschwindet im Ziel und kennt seine Zeit', async () => {
    const g = await Geist.create(level, solution01, startLuaNode);

    for (let i = 0; i < 20 && !g.imZiel; i++) g.folgen(solution01.steps + 10);

    expect(g.imZiel).toBe(true);
    expect(g.zeit).toBe(solution01.steps);
    expect(g.sprite(0)).toBeNull();
  });

  it('lehnt eine Aufzeichnung eines anderen Levels ab', async () => {
    await expect(Geist.create(l02 as LevelFile, solution01, startLuaNode)).rejects.toThrow(/anderen Level/);
  });

  it('vergleicht die eigene Zeit mit dem Geist', () => {
    const z = (s: number) => `${(s / 400).toFixed(1)} s`;
    expect(vergleich(1000, 1520, z)).toBe('Geist: 3.8 s – du warst 1,3 s schneller');
    expect(vergleich(1520, 1000, z)).toBe('Geist: 2.5 s – du warst 1,3 s langsamer');
    expect(vergleich(1000, 1000, z)).toBe('Geist: 2.5 s – gleich schnell');
  });
});
