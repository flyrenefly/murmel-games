import { describe, expect, it } from 'vitest';
import enigmaIII from '../../public/levels/enigma/enigma_iii.json';
import type { LevelFile } from '../game/level';
import { PHYSICS_DT } from '../game/physics';
import { decodeInput, type Entry } from '../game/recording';
import { GameSession } from '../game/session';
import { AUFHOLEN_AB, AUFHOLEN_MAX, aufholen, Geister, parseWk, rangliste, SCHRITT_MS, type StandZeile, Strom, type WkNachricht } from './wettkampf';

const levels = enigmaIII.levels as unknown as LevelFile[];
const level = levels.find((l) => l.id === 'enigma:wb4')!; // no Lua

describe('Wettkampf: Nachrichten des Servers', () => {
  it('liest jede Art zurück', () => {
    const all: WkNachricht[] = [
      { t: 'raum', code: '04711', du: 2, rolle: 'fahrer' },
      { t: 'lobby', leiter: 1, fahrer: [1, 2], zuschauer: 3, level: { pack: 'murmel', index: 0, id: '01' }, phase: 'lobby' },
      { t: 'runde', runde: 3, level: { pack: 'murmel', index: 0, id: '01' }, seed: 4_000_000_000, fahrer: [1, 3] },
      { t: 'los', runde: 3, in: 3000 },
      { t: 'stand', runde: 3, f: [[1, 3.5, 4.5, 0, 800, 'faehrt', null], [3, 1, 1, 0, 700, 'ziel', 700]] },
      { t: 'verlauf', runde: 3, fahrer: 1, i: 0, e: [[3, 0, 0], [1, 'use'], [2, 512, -64, 10, 0], [1, 'restart']] },
      { t: 'ergebnis', runde: 3, plaetze: [{ nr: 3, platz: 1, zeit: 700, status: 'ziel' }, { nr: 1, platz: null, zeit: null, status: 'raus', grund: 'weg' }] },
      { t: 'fehler', grund: 'raum-voll' },
    ];
    for (const m of all) expect(parseWk(JSON.stringify(m))).toEqual(m);
  });

  it('verwirft Kaputtes', () => {
    for (const bad of ['nix', '{"t":"los","runde":1,"in":-5}', '{"t":"stand","runde":1,"f":[[9,0,0,0,0,"faehrt",null]]}', '{"t":"verlauf","runde":1,"fahrer":1,"i":0,"e":[[1,0.5,0]]}', '{"t":"wer"}']) {
      expect(parseWk(bad)).toBeNull();
    }
  });
});

describe('Wettkampf: Eingabestrom', () => {
  it('schickt in Stücken Schritt für Schritt genau die Eingaben der Aufzeichnung', async () => {
    const s = await GameSession.create(level, { seed: 5 });
    const strom = new Strom();
    const gesendet: Entry[] = [];
    let ab = 0;
    for (let i = 0; i < 900; i++) {
      if (i % 37 === 0) s.act('use');
      s.step({ fx: i % 60 === 0 ? 1.25 : 0, fy: i % 90 === 0 ? -0.5 : 0, ax: i > 400 && i < 500 ? 3 : 0, ay: 0 });
      if (i % 40 === 39) {
        const teil = strom.nehmen(s);
        expect(teil.ab).toBe(ab);
        ab += teil.e.reduce((n, e) => n + (typeof e[1] === 'number' ? e[0] : 0), 0);
        gesendet.push(...teil.e);
      }
    }
    gesendet.push(...strom.nehmen(s, true).e);
    const rec = s.recording();
    expect(strom.ab).toBe(900);
    expect([...decodeInput({ v: 1, steps: 900, input: gesendet })]).toEqual([...decodeInput(rec)]);
  });

  it('ohne Mausbewegung wächst nur ein Eintrag – seine Schritte gehen trotzdem laufend raus', async () => {
    const s = await GameSession.create(level, { seed: 5 });
    const strom = new Strom();
    const gesendet: Entry[] = [];
    for (let i = 0; i < 3; i++) {
      for (let k = 0; k < 40; k++) s.step({ fx: 0, fy: 0, ax: 0, ay: 0 });
      const teil = strom.nehmen(s);
      expect(teil).toEqual({ ab: i * 40, e: [[40, 0, 0]] });
      gesendet.push(...teil.e);
    }
    s.act('use'); // an action may still repeat: it waits
    expect(strom.nehmen(s).e).toEqual([]);
    s.step({ fx: 1, fy: 0, ax: 0, ay: 0 });
    gesendet.push(...strom.nehmen(s).e, ...strom.nehmen(s, true).e);
    expect(gesendet).toEqual([[40, 0, 0], [40, 0, 0], [40, 0, 0], [1, 'use'], [1, 1024, 0]]);
    expect(strom.ab).toBe(121);
  });

  it('ein Neustart schickt den Rest des alten Laufs und dann [1, "restart"]; die Schritte zählen weiter', async () => {
    const alt = await GameSession.create(level, { seed: 5 });
    const strom = new Strom();
    for (let i = 0; i < 50; i++) alt.step({ fx: 0, fy: 0, ax: 1, ay: 0 });
    const n = strom.neustart(alt);
    expect(n).toEqual({ ab: 0, e: [[50, 0, 0, 1024, 0], [1, 'restart']] });
    const neu = await GameSession.create(level, { seed: 5 });
    for (let i = 0; i < 10; i++) neu.step({ fx: 0, fy: 0, ax: 0, ay: 0 });
    expect(strom.nehmen(neu, true)).toEqual({ ab: 50, e: [[10, 0, 0]] });
  });
});

describe('Wettkampf: Uhr, Geister, Rangliste', () => {
  it('holt erst ab einer Sekunde Rückstand auf, höchstens 4000 Schritte je Bild', () => {
    expect(SCHRITT_MS).toBe(PHYSICS_DT * 1000);
    expect(aufholen(1000, 0)).toBe(0); // 400 steps behind: fine
    expect(aufholen(1000 + SCHRITT_MS, 0)).toBe(AUFHOLEN_AB + 1);
    expect(aufholen(60_000, 0)).toBe(AUFHOLEN_MAX);
    expect(aufholen(-3000, 0)).toBe(0); // countdown
  });

  it('Geister: nur andere, nur wer fährt und schon losgerollt ist; Sprünge sofort', () => {
    const g = new Geister();
    g.stand([[1, 5, 5, 0, 10, 'faehrt', null], [2, 7, 7, 0, 10, 'faehrt', null], [3, 1, 1, 0, 10, 'ziel', 10], [4, 1, 1, 0, 0, 'faehrt', null]], 1);
    const a = g.sprites(0.016);
    expect(a.map((s) => [s.x, s.y, s.ghost])).toEqual([[7, 7, true]]);
    g.stand([[2, 7.5, 7, 0, 20, 'faehrt', null]], 1);
    const b = g.sprites(0.1)[0];
    expect(b.x).toBeGreaterThan(7.4);
    expect(b.x).toBeLessThan(7.5);
    g.stand([[2, 20, 20, 0, 30, 'faehrt', null]], 1);
    expect(g.sprites(0.016)[0].x).toBe(20);
  });

  it('Rangliste: Ziel nach Zeit (Gleichstand = gleicher Platz), dann wer fährt, dann wer raus ist', () => {
    const f: StandZeile[] = [
      [1, 0, 0, 0, 500, 'raus', null],
      [2, 0, 0, 0, 900, 'faehrt', null],
      [3, 0, 0, 0, 800, 'ziel', 800],
      [4, 0, 0, 0, 800, 'ziel', 800],
    ];
    expect(rangliste(f, 2).map((z) => [z.nr, z.platz, z.status, z.schritte, z.du])).toEqual([
      [3, 1, 'ziel', 800, false],
      [4, 1, 'ziel', 800, false],
      [2, null, 'faehrt', 900, true],
      [1, null, 'raus', 500, false],
    ]);
  });
});
