import { describe, expect, it } from 'vitest';
import { emptyProgress, mergeProgress, parseProgress, recordAttempt, recordWin, serializeProgress, type Progress } from './progress';

const T1 = '2026-11-13T10:00:00.000Z';
const T2 = '2026-11-13T11:00:00.000Z';

describe('recordWin', () => {
  it('trägt den ersten Sieg als Bestleistung ein und zählt ihn', () => {
    const p = recordWin(emptyProgress(), 'enigma:a', { steps: 1000, falls: 2, seed: 7 }, T1);

    expect(p.levels['enigma:a'].best).toEqual({ steps: 1000, falls: 2, seed: 7, date: T1 });
    expect(p.levels['enigma:a'].solves).toBe(1);
    expect(p.solved).toEqual(['enigma:a']);
  });

  it('ersetzt die Bestleistung nur bei weniger Schritten', () => {
    let p = recordWin(emptyProgress(), 'x', { steps: 1000, falls: 0, seed: 1 }, T1);
    p = recordWin(p, 'x', { steps: 1200, falls: 0, seed: 2 }, T2);
    expect(p.levels.x.best?.steps).toBe(1000);

    p = recordWin(p, 'x', { steps: 900, falls: 5, seed: 3 }, T2);
    expect(p.levels.x.best?.steps).toBe(900);
    expect(p.levels.x.solves).toBe(3);
  });

  it('bei gleicher Schrittzahl gewinnt der Lauf mit weniger Abstürzen', () => {
    let p = recordWin(emptyProgress(), 'x', { steps: 1000, falls: 3, seed: 1 }, T1);
    p = recordWin(p, 'x', { steps: 1000, falls: 1, seed: 2 }, T2);

    expect(p.levels.x.best).toMatchObject({ falls: 1, seed: 2 });
  });

  it('meldet, ob der Sieg eine neue Bestleistung ist', () => {
    const first = recordWin(emptyProgress(), 'x', { steps: 1000, falls: 0, seed: 1 }, T1);
    expect(first.levels.x.best?.date).toBe(T1);
    const worse = recordWin(first, 'x', { steps: 2000, falls: 0, seed: 1 }, T2);
    expect(worse.levels.x.best?.date).toBe(T1);
  });

  it('verändert den alten Stand nicht', () => {
    const p0 = emptyProgress();
    recordWin(p0, 'x', { steps: 1, falls: 0, seed: 1 }, T1);
    expect(p0.levels).toEqual({});
  });
});

describe('recordAttempt', () => {
  it('zählt Versuche und merkt den Zeitpunkt', () => {
    let p = recordAttempt(emptyProgress(), 'x', T1);
    p = recordAttempt(p, 'x', T2);

    expect(p.levels.x.attempts).toBe(2);
    expect(p.levels.x.lastPlayed).toBe(T2);
    expect(p.solved).toEqual([]);
  });
});

describe('mergeProgress', () => {
  const a = recordWin(recordAttempt(emptyProgress(), 'x', T1), 'x', { steps: 1000, falls: 0, seed: 1 }, T1);
  const b = recordWin(recordWin(emptyProgress(), 'x', { steps: 800, falls: 1, seed: 2 }, T2), 'y', { steps: 50, falls: 0, seed: 3 }, T2);

  it('behält die bessere Zeit und jeden gelösten Level', () => {
    const m = mergeProgress(a, b);

    expect(m.levels.x.best?.steps).toBe(800);
    expect(m.solved.sort()).toEqual(['x', 'y']);
  });

  it('ist unabhängig von der Reihenfolge', () => {
    expect(mergeProgress(a, b)).toEqual(mergeProgress(b, a));
  });

  it('nimmt bei Zählern das Maximum, damit doppeltes Laden nichts verdoppelt', () => {
    const m = mergeProgress(a, a);
    expect(m.levels.x.solves).toBe(1);
    expect(m.levels.x.attempts).toBe(1);
  });
});

describe('serializeProgress / parseProgress', () => {
  it('ergibt nach Speichern und Laden denselben Stand', () => {
    const p = recordWin(recordAttempt(emptyProgress(), 'enigma:a', T1), 'enigma:a', { steps: 10, falls: 0, seed: 4 }, T1);

    const back = parseProgress(serializeProgress(p, T2));

    expect(back.progress).toEqual(p);
    expect(back.skipped).toBe(0);
  });

  it('lehnt fremde Dateien ab', () => {
    expect(() => parseProgress('{"v":1,"app":"anders","levels":{},"solved":[]}')).toThrow();
    expect(() => parseProgress('kein json')).toThrow();
  });

  it('überspringt kaputte Einträge und zählt sie', () => {
    const text = JSON.stringify({
      v: 1,
      app: 'murmel',
      saved: T1,
      levels: {
        gut: { best: { steps: 5, falls: 0, seed: 1, date: T1 }, solves: 1, attempts: 1, lastPlayed: T1 },
        schlecht: { best: { steps: -3, falls: 'viele' }, solves: 'x' },
      },
      solved: ['gut', 42, 'x'.repeat(500)],
    });

    const { progress, skipped } = parseProgress(text);

    expect(Object.keys(progress.levels)).toEqual(['gut']);
    expect(progress.solved).toEqual(['gut']);
    expect(skipped).toBe(3);
  });

  it('übernimmt alte gelöste Levels ohne Bestzeit', () => {
    const p: Progress = { levels: {}, solved: ['alt'] };
    expect(parseProgress(serializeProgress(p, T1)).progress.solved).toEqual(['alt']);
  });
});
