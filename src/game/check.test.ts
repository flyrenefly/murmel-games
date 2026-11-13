import { describe, expect, it } from 'vitest';
import enigmaI from '../../public/levels/enigma/enigma_i.json';
import solution01 from '../../solutions/murmel/01.json';
import l01 from '../levels/01.json';
import l02 from '../levels/02.json';
import { startLuaNode } from '../lua/node';
import { LuaLevel } from '../lua/runtime';
import { checkSolution, probeLevel } from './check';
import type { LevelFile } from './level';

LuaLevel.quiet = true;
const snakes = (enigmaI.levels as unknown as LevelFile[])[4]; // Lua-Level

describe('Ladeprobe', () => {
  it('ein Level läuft 5 s ohne Eingabe', async () => {
    const r = await probeLevel(l01 as LevelFile, startLuaNode);

    expect(r).toEqual({ level: '01', status: 'ok', steps: 2000 });
  });

  it('auch ein Lua-Level mit der Node-Laufzeit', async () => {
    expect((await probeLevel(snakes, startLuaNode, 1)).status).toBe('ok');
  });

  it('ein Lua-Fehler wird gemeldet, das Level läuft weiter', async () => {
    const broken = { ...snakes, lua: { ...(snakes as unknown as { lua: object }).lua, code: 'error("kaputt")' } } as LevelFile;

    const r = await probeLevel(broken, startLuaNode, 1);

    expect(r.status).toBe('lua');
    expect(r.error).toContain('kaputt');
    expect(r.steps).toBe(400);
  });

  it('ein Level, das nicht startet, ist ein Fehler und wirft nicht', async () => {
    const r = await probeLevel({ ...(l01 as LevelFile), map: [] }, startLuaNode, 1);

    expect(r.status).toBe('fehler');
    expect(r.error).toBeTruthy();
  });
});

describe('Lösung nachspielen', () => {
  it('eine gespeicherte Lösung gewinnt mit der aufgezeichneten Schrittzahl', async () => {
    const r = await checkSolution(l01 as LevelFile, solution01, startLuaNode);

    expect(r.status).toBe('geloest');
    expect(r.steps).toBe(solution01.steps);
    expect(r.recordedSteps).toBe(solution01.steps);
  });

  it('eine abgeschnittene Lösung ist nicht gelöst', async () => {
    const short = { ...solution01, steps: 100, input: [[100, 0, 0]] };

    expect((await checkSolution(l01 as LevelFile, short, startLuaNode)).status).toBe('nicht-geloest');
  });

  it('eine Lösung für ein anderes Level oder in fremdem Format ist ein Fehler', async () => {
    expect((await checkSolution(l02 as LevelFile, solution01, startLuaNode)).status).toBe('fehler');
    expect((await checkSolution(l01 as LevelFile, { level: '01' }, startLuaNode)).status).toBe('fehler');
    expect((await checkSolution(l01 as LevelFile, null, startLuaNode)).status).toBe('fehler');
  });
});
