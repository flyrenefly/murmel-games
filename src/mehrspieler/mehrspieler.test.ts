import { describe, expect, it } from 'vitest';
import enigmaIII from '../../public/levels/enigma/enigma_iii.json';
import type { LevelFile } from '../game/level';
import { PHYSICS_DT } from '../game/physics';
import { GameSession, NO_CONTROL } from '../game/session';
import { createRng } from '../game/rng';
import { KoopGast, KoopGastgeber, PUFFER_SCHRITTE, SENDE_MS } from './koop';
import { encode, entpacken, type Nachricht, packen, parseNachricht, type Schritt } from './nachrichten';
import { Rennen } from './rennen';
import { istKoopLevel } from './index';

const levels = enigmaIII.levels as unknown as LevelFile[];
const bridge = levels.find((l) => l.id === 'enigma:wb4')!; // Bridge Builders: black and white marble, no Lua

describe('Nachrichtenformat', () => {
  it('liest gültige Nachrichten jeder Art zurück', () => {
    const all: Nachricht[] = [
      { t: 'hallo', version: 'abc1234' },
      { t: 'start', art: 'gemeinsam', pack: 'enigma_iii', index: 3, levelId: 'enigma:wb4', seed: 4_000_000_000 },
      { t: 'bereit', levelId: 'enigma:wb4' },
      { t: 'los' },
      { t: 'eingabe', fx: 1.5, fy: -2, ax: 0, ay: 10, aktionen: ['use', 'rotate'] },
      { t: 'schritte', ab: 16, l: [[3, [1, 2, 0, 0], [0, 0, 0, 0], 1, [[1, 'drop']]]], m: [[1.5, 2.5, 0.1, -0.2]], ende: true },
      { t: 'stand', x: 3.2, y: 4.1, farbe: 0, schritte: 900 },
      { t: 'ziel', schritte: 1200 },
      { t: 'neustart' },
      { t: 'tschuess' },
    ];
    for (const n of all) expect(parseNachricht(encode(n))).toEqual(n);
  });

  it('verwirft Kaputtes, Unbekanntes, andere Versionen und unsinnige Werte', () => {
    const bad = [
      'kein json',
      JSON.stringify({ t: 'los' }), // ohne Version
      JSON.stringify({ v: 2, t: 'los' }),
      JSON.stringify({ v: 1, t: 'unbekannt' }),
      JSON.stringify({ v: 1, t: 'eingabe', fx: 'x', fy: 0, ax: 0, ay: 0, aktionen: [] }),
      JSON.stringify({ v: 1, t: 'eingabe', fx: 0, fy: 0, ax: 0, ay: 0, aktionen: ['swap'] }),
      JSON.stringify({ v: 1, t: 'start', art: 'chaos', pack: 'p', index: 0, levelId: 'x', seed: 1 }),
      JSON.stringify({ v: 1, t: 'start', art: 'rennen', pack: 'p', index: -1, levelId: 'x', seed: 1 }),
      JSON.stringify({ v: 1, t: 'schritte', ab: 0, l: [[0, [0, 0, 0, 0], [0, 0, 0, 0], 0, []]], m: [] }),
      JSON.stringify({ v: 1, t: 'schritte', ab: 0, l: [], m: [[1, 2, 3]] }),
      JSON.stringify({ v: 1, t: 'stand', x: Infinity, y: 0, farbe: 0, schritte: 0 }),
      42,
    ];
    for (const b of bad) expect(parseNachricht(b)).toBeNull();
  });

  it('packt gleiche Schritte zu Läufen und wieder aus', () => {
    const s = (fx: number, akt: Schritt['aktionen'] = []): Schritt => ({ host: [fx, 0, 10, 0], gast: [0, 0, 0, -10], sperre: 0, aktionen: akt });
    const steps = [s(3), s(0), s(0), s(0), s(0, [[1, 'use']]), s(0), s(2)];
    const runs = packen(steps);
    expect(runs.map((r) => r[0])).toEqual([1, 3, 2, 1]);
    expect(entpacken(runs)).toEqual(steps);
  });
});

describe('Koop-Physik', () => {
  it('ohne coop wirkt nur die gesteuerte Murmel, mit coop jede Murmel mit ihrer eigenen Kraft', async () => {
    const solo = await GameSession.create(bridge, { seed: 1 });
    const coop = await GameSession.create(bridge, { seed: 1 });
    coop.enableCoop();
    const w = coop.marbleOf(1);
    expect(w).toBeGreaterThan(0);
    const start = coop.physics.marbles.map((m) => ({ ...m.pos }));
    for (let i = 0; i < 200; i++) {
      solo.step({ fx: 0, fy: 0, ax: 10, ay: 0 });
      coop.coopStep({ fx: 0, fy: 0, ax: 10, ay: 0 }, { fx: 0, fy: 0, ax: 0, ay: 10 });
    }
    // allein: die weiße Murmel bleibt liegen
    expect(solo.physics.marbles[w].pos).toEqual(start[w]);
    // zu zweit: schwarz rollt nach rechts, weiß nach unten
    expect(coop.physics.marbles[0].pos.x).toBeGreaterThan(start[0].x + 0.05);
    expect(coop.physics.marbles[w].pos.y).toBeGreaterThan(start[w].y + 0.05);
    expect(Math.abs(coop.physics.marbles[w].pos.x - start[w].x)).toBeLessThan(0.01);
  });

  it('der Yin-Yang wechselt im gemeinsamen Spiel nicht', async () => {
    const s = await GameSession.create(bridge, { seed: 1 });
    s.enableCoop();
    expect(s.swapMarble()).toBe(false);
    expect(s.coopAct(1, 'use')).toBeTypeOf('boolean');
    expect(s.physics.current).toBe(0);
  });
});

describe('Zustandsübertragung (gemeinsam)', () => {
  it('der Gast folgt dem Gastgeber Schritt für Schritt, ohne nennenswerte Korrektur', async () => {
    let t = 0;
    const jetzt = () => t;
    const zumGast: Nachricht[] = [];
    const zumHost: Nachricht[] = [];
    const hs = await GameSession.create(bridge, { seed: 77 });
    const gs = await GameSession.create(bridge, { seed: 77 });
    hs.enableCoop();
    gs.enableCoop();
    const host = new KoopGastgeber((n) => zumGast.push(JSON.parse(encode(n))), jetzt);
    const gast = new KoopGast((n) => zumHost.push(JSON.parse(encode(n))), jetzt);
    const r = createRng(5);
    const frame = 1 / 60;
    let accH = 0;
    let accG = 0;
    for (let f = 0; f < 240; f++) {
      t += frame * 1000;
      const mouse = () => ({ fx: (r() - 0.5) * 6, fy: (r() - 0.5) * 6, ax: 0, ay: 0 });
      if (f === 100) gast.aktion('rotate');
      accG = gast.rechnen(gs, accG + frame, mouse());
      // Netz: Nachrichten kommen im nächsten Bild an (über JSON wie auf dem Datenkanal)
      for (const n of zumHost.splice(0)) if (n.t === 'eingabe') host.eingabe(parseNachricht(encode(n)) as Extract<Nachricht, { t: 'eingabe' }>);
      accH = host.rechnen(hs, accH + frame, mouse());
      for (const n of zumGast.splice(0)) if (n.t === 'schritte') gast.schritte(parseNachricht(encode(n)) as Extract<Nachricht, { t: 'schritte' }>);
    }
    host.abschicken(hs);
    for (const n of zumGast.splice(0)) if (n.t === 'schritte') gast.schritte(n);
    // den Rest des Puffers abspielen
    for (let i = 0; i < 100 && gast.gepuffert; i++) accG = gast.rechnen(gs, accG + frame, NO_CONTROL);
    expect(hs.steps).toBeGreaterThan(1000);
    expect(gs.steps).toBe(hs.steps);
    gs.physics.marbles.forEach((m, i) => {
      expect(m.pos.x).toBeCloseTo(hs.physics.marbles[i].pos.x, 9);
      expect(m.pos.y).toBeCloseTo(hs.physics.marbles[i].pos.y, 9);
    });
    // gleiche Browser-Mathematik: der Gast rechnet von selbst richtig
    expect(gast.abweichung).toBeLessThan(1e-9);
    expect(gs.objects.inventories).toEqual(hs.objects.inventories);
  });

  it('25 Pakete pro Sekunde, und der Gast wartet auf einen Puffer, bevor er abspielt', async () => {
    let t = 0;
    const sent: Nachricht[] = [];
    const hs = await GameSession.create(bridge, { seed: 1 });
    hs.enableCoop();
    const host = new KoopGastgeber((n) => sent.push(n), () => t);
    let acc = 0;
    for (let f = 0; f < 60; f++) {
      t += 1000 / 60;
      acc = host.rechnen(hs, acc + 1 / 60, NO_CONTROL);
    }
    const batches = sent.filter((n) => n.t === 'schritte').length;
    expect(batches).toBeGreaterThanOrEqual(1000 / SENDE_MS - 2);
    expect(batches).toBeLessThanOrEqual(1000 / SENDE_MS + 1);

    const gs = await GameSession.create(bridge, { seed: 1 });
    gs.enableCoop();
    const gast = new KoopGast(() => {}, () => t);
    const first = sent.find((n) => n.t === 'schritte') as Extract<Nachricht, { t: 'schritte' }>;
    const n = first.l.reduce((a, l) => a + l[0], 0);
    if (n < PUFFER_SCHRITTE) {
      gast.schritte(first);
      gast.rechnen(gs, 0.1, NO_CONTROL);
      expect(gs.steps).toBe(0);
    }
    expect(PUFFER_SCHRITTE).toBe(Math.round(SENDE_MS / 1000 / PHYSICS_DT));
  });

  it('ein Paket aus einer alten Runde wird nicht abgespielt', async () => {
    const gs = await GameSession.create(bridge, { seed: 1 });
    const gast = new KoopGast(() => {}, () => 0);
    gast.schritte({ t: 'schritte', ab: 500, l: [[20, [0, 0, 0, 0], [0, 0, 0, 0], 0, []]], m: [] });
    expect(gast.gepuffert).toBe(0);
    gast.rechnen(gs, 1, NO_CONTROL);
    expect(gs.steps).toBe(0);
  });
});

describe('Wettrennen', () => {
  it('Sieger ist, wer in weniger Spielzeit löst – auf beiden Seiten gleich', () => {
    const a = new Rennen(() => {}, () => 0);
    const b = new Rennen(() => {}, () => 0);
    a.imZiel(4000);
    expect(a.ergebnis()).toBeNull(); // b könnte noch schneller sein
    b.empfangen({ t: 'ziel', schritte: 4000 });
    b.imZiel(5200);
    a.empfangen({ t: 'ziel', schritte: 5200 });
    expect(a.ergebnis()).toBe('gewonnen');
    expect(b.ergebnis()).toBe('verloren');
  });

  it('gewonnen, sobald der andere länger braucht als die eigene Zeit', () => {
    const a = new Rennen(() => {}, () => 0);
    a.imZiel(4000);
    a.empfangen({ t: 'stand', x: 1, y: 1, farbe: 0, schritte: 4001 });
    expect(a.ergebnis()).toBe('gewonnen');
  });

  it('schickt die Position etwa 15-mal pro Sekunde und zeigt den Geist geglättet', () => {
    let t = 0;
    const sent: Nachricht[] = [];
    const r = new Rennen((n) => sent.push(n), () => t);
    for (let f = 0; f < 60; f++, t += 1000 / 60) r.tick(f, 0, 0, f * 7);
    expect(sent.length).toBeGreaterThanOrEqual(13);
    expect(sent.length).toBeLessThanOrEqual(16);
    expect(r.geistSprite(0.016)).toBeNull();
    r.empfangen({ t: 'stand', x: 2, y: 2, farbe: 0, schritte: 10 });
    expect(r.geistSprite(0.016)).toMatchObject({ x: 2, y: 2, ghost: true });
    r.empfangen({ t: 'stand', x: 3, y: 2, farbe: 0, schritte: 20 });
    const g = r.geistSprite(0.016)!;
    expect(g.x).toBeGreaterThan(2);
    expect(g.x).toBeLessThan(3);
  });
});

describe('Levelauswahl', () => {
  it('Zwei-Murmel-Levels haben eine steuerbare weiße Murmel', () => {
    expect(istKoopLevel(bridge)).toBe(true);
    expect(istKoopLevel({ ...bridge, actors: [{ k: 'ac_marble_white', x: 1, y: 1, a: { passive: 'true' } }] } as LevelFile)).toBe(false);
    expect(istKoopLevel({ ...bridge, actors: [] } as LevelFile)).toBe(false);
  });
});
