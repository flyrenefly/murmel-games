import { describe, expect, it } from 'vitest';
import { decodeInput, encodeInput, quantize, Recorder, type StepInput } from './recording';

const still: StepInput = { fx: 0, fy: 0, actions: [] };

describe('quantize', () => {
  it('rundet auf 1/1024 und liefert ganze Zahlen', () => {
    expect(quantize(0.5)).toBe(512);
    expect(quantize(-0.25)).toBe(-256);
    expect(quantize(1 / 3)).toBe(341);
  });

  it('macht aus -0 eine 0', () => {
    expect(Object.is(quantize(-0.0001), 0)).toBe(true);
  });
});

describe('Recorder', () => {
  it('fasst gleiche Schritte zu Lauflängen zusammen', () => {
    const r = new Recorder();
    for (let i = 0; i < 120; i++) r.step(0, 0);
    for (let i = 0; i < 3; i++) r.step(0.5, -0.0625);

    expect(r.steps).toBe(123);
    expect(r.input()).toEqual([[120, 0, 0], [3, 512, -64]]);
  });

  it('hängt Aktionen an den Schritt, vor dem sie geschahen', () => {
    const r = new Recorder();
    r.step(0, 0);
    r.action('drop');
    r.step(0, 0);
    r.step(0, 0);

    expect(r.input()).toEqual([[1, 0, 0], [1, 'drop'], [2, 0, 0]]);
  });

  it('speichert die gerundete Kraft, damit das Nachspielen genau dieselbe Kraft nutzt', () => {
    const r = new Recorder();
    const used = r.step(0.123456, -0.98765);

    expect(used).toEqual([quantize(0.123456) / 1024, quantize(-0.98765) / 1024]);
  });
});

describe('encodeInput / decodeInput', () => {
  it('ergibt nach dem Einlesen dieselbe Eingabefolge Schritt für Schritt', () => {
    const steps: StepInput[] = [
      still,
      still,
      { fx: 0.5, fy: 0, actions: ['drop'] },
      { fx: 0.5, fy: 0, actions: [] },
      { fx: -1, fy: 0.25, actions: ['rotate', 'swap'] },
      still,
    ];
    const r = new Recorder();
    for (const s of steps) {
      for (const a of s.actions) r.action(a);
      r.step(s.fx, s.fy);
    }

    const back = decodeInput(JSON.parse(JSON.stringify(encodeInput(r))));

    expect(back.steps).toBe(6);
    expect([...back]).toEqual(steps);
  });

  it('lehnt unbekannte Aktionen und kaputte Einträge ab', () => {
    expect(() => decodeInput({ v: 1, steps: 1, input: [[1, 'hack']] })).toThrow();
    expect(() => decodeInput({ v: 1, steps: 1, input: [[1, 0]] })).toThrow();
    expect(() => decodeInput({ v: 2, steps: 0, input: [] })).toThrow();
  });

  it('lehnt eine Aufzeichnung ab, deren Schrittzahl nicht zur Eingabe passt', () => {
    expect(() => decodeInput({ v: 1, steps: 5, input: [[3, 0, 0]] })).toThrow();
  });
});
