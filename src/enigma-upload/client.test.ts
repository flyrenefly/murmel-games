import { describe, expect, it, vi } from 'vitest';
import { newLevel } from '../editor/model';
import { type WorkerLike, wandleImWorker } from './client';
import { MAX_FILE } from './datei';
import { isEnigmaFile } from './dialog';

/** A fake worker that answers (or not) like the real one. */
function fake(answer: ((post: (d: unknown) => void, fail: () => void) => void) | null) {
  const w: WorkerLike & { terminated: boolean; got: unknown } = {
    onmessage: null,
    onerror: null,
    terminated: false,
    got: null,
    postMessage(m) {
      w.got = m;
      answer?.(
        (d) => setTimeout(() => w.onmessage?.({ data: d } as MessageEvent)),
        () => setTimeout(() => w.onerror?.({ preventDefault() {} } as ErrorEvent)),
      );
    },
    terminate() {
      w.terminated = true;
    },
  };
  return w;
}
const file = (text = 'x', size = 1) => ({ name: 'a.xml', size, text: async () => text });

describe('Umwandeln im Worker', () => {
  it('gibt das Ergebnis weiter und beendet den Worker', async () => {
    const level = newLevel();
    const w = fake((post) => post({ ok: true, level, hinweise: ['h'], herkunft: { autor: 'A', lizenz: 'GPL' } }));
    await expect(wandleImWorker(file('<x/>'), () => w)).resolves.toEqual({ level, hinweise: ['h'], herkunft: { autor: 'A', lizenz: 'GPL' } });
    expect(w.got).toEqual({ name: 'a.xml', text: '<x/>' });
    expect(w.terminated).toBe(true);
  });

  it('meldet den Grund aus dem Worker, Abstürze und die Zeitgrenze', async () => {
    await expect(wandleImWorker(file(), () => fake((post) => post({ ok: false, error: 'fehlt st_laser' })))).rejects.toThrow('fehlt st_laser');
    await expect(wandleImWorker(file(), () => fake((_, fail) => fail()))).rejects.toThrow(/abgebrochen/);
    vi.useFakeTimers();
    const w = fake(null);
    const p = wandleImWorker(file(), () => w, 10_000);
    const r = expect(p).rejects.toThrow(/Zeitgrenze 10 s/);
    await vi.advanceTimersByTimeAsync(10_001);
    await r;
    expect(w.terminated).toBe(true);
    vi.useRealTimers();
  });

  it('liest zu große Dateien gar nicht erst', async () => {
    const make = vi.fn(() => fake(null));
    await expect(wandleImWorker(file('x', MAX_FILE + 1), make)).rejects.toThrow(/256 KB/);
    expect(make).not.toHaveBeenCalled();
  });

  it('erkennt Enigma-Dateien am Namen', () => {
    expect([isEnigmaFile('a.XML'), isEnigmaFile('b.lua'), isEnigmaFile('c.json')]).toEqual([true, true, false]);
  });
});
