import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { buildApp } from './app.ts';
import { RoomHub } from './raum.ts';
import { DT_MS, eintraegePruefen, type Platz, WettkampfHub, type WkNachricht, type WkPeer, WK } from './wettkampf.ts';
import { type Auftrag, type Eintrag, type LaufStand, type Rechner, wettkampfRechner } from './wettkampf-rechner.ts';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

/** A browser stand-in: collects what the server sends. */
function peer(ip = '203.0.113.1') {
  const got: WkNachricht[] = [];
  const p = {
    ip,
    got,
    closed: false,
    send: (m: WkNachricht) => void got.push(m),
    close: () => void (p.closed = true),
    last: <T extends WkNachricht['t']>(t: T) => got.filter((m): m is Extract<WkNachricht, { t: T }> => m.t === t).at(-1),
  };
  return p;
}
type TestPeer = ReturnType<typeof peer>;

/**
 * Stand-in for the referee: level "ziel:N" is won after N steps of one try (a restart begins anew), "kaputt"
 * fails to start. Position x = steps of the current try.
 */
function fakeRechner() {
  const runs = new Map<string, { ziel: number; schritte: number; versuch: number; won: number | null; fehler?: string }>();
  const r = {
    up: true,
    crash: false,
    calls: [] as { auf: Auftrag[]; weg: string[] }[],
    runs,
    verfuegbar: () => r.up,
    kennt: async (level: string) => level.startsWith('ziel:') || level === 'kaputt',
    async takt(auf: Auftrag[], weg: string[]) {
      r.calls.push({ auf, weg });
      if (r.crash) throw new Error('kaputt');
      for (const k of weg) runs.delete(k);
      const staende: LaufStand[] = [];
      for (const a of auf) {
        if (a.neu) runs.set(a.k, a.neu.level === 'kaputt' ? { ziel: 0, schritte: 0, versuch: 0, won: null, fehler: 'start' } : { ziel: Number(a.neu.level.slice(5)), schritte: 0, versuch: 0, won: null });
        const run = runs.get(a.k)!;
        for (const e of a.e) {
          if (run.won !== null || run.fehler) break;
          if (e[1] === 'restart') {
            run.versuch = 0;
            continue;
          }
          if (typeof e[1] === 'string') continue;
          for (let i = 0; i < e[0] && run.won === null; i++) {
            run.schritte++;
            run.versuch++;
            if (run.versuch >= run.ziel) run.won = run.schritte;
          }
        }
        staende.push({ k: a.k, schritte: run.schritte, x: run.versuch, y: 0, farbe: 0, ziel: run.won, ...(run.fehler ? { fehler: run.fehler } : {}) });
      }
      return { staende, ms: 1 };
    },
    close: () => {},
  };
  return r;
}

function setup(opts: { codes?: string[] } = {}) {
  let t = 1_000_000;
  const clock = { now: () => t, add: (ms: number) => (t += ms) };
  const rechner = fakeRechner();
  const codes = opts.codes ? [...opts.codes] : null;
  const hub = new WettkampfHub({ rechner, now: clock.now, code: codes ? () => codes.shift() ?? '99999' : undefined, seed: () => 4242 });
  const send = (p: WkPeer, m: object) => hub.message(p, JSON.stringify(m));
  return { hub, rechner, clock, send };
}

const LEVEL = { pack: 'murmel', index: 0, id: 'ziel:1000' };

/** A room with racers (the first opens it) and spectators; returns the code. */
async function raum(s: ReturnType<typeof setup>, fahrer: TestPeer[], zuschauer: TestPeer[] = [], level = LEVEL) {
  for (const p of [...fahrer, ...zuschauer]) s.hub.connect(p);
  await s.send(fahrer[0], { t: 'oeffnen', level });
  const code = fahrer[0].last('raum')!.code;
  for (const p of fahrer.slice(1)) await s.send(p, { t: 'beitreten', code, als: 'fahrer' });
  for (const p of zuschauer) await s.send(p, { t: 'beitreten', code, als: 'zuschauer' });
  return code;
}

/** Start, all ready, countdown over. */
async function rennen(s: ReturnType<typeof setup>, fahrer: TestPeer[]) {
  await s.send(fahrer[0], { t: 'start' });
  const runde = fahrer[0].last('runde')!.runde;
  for (const p of fahrer) await s.send(p, { t: 'bereit', runde });
  s.clock.add(WK.countdownMs);
  return runde;
}

/** n steps without input, as entries. */
const leer = (n: number): Eintrag[] => [[n, 0, 0]];

describe('Wettkampf: Eingaben prüfen', () => {
  test('gültige Einträge zählen Schritte, Aktionen und Neustart zählen keine', () => {
    assert.equal(eintraegePruefen([[3, 0, 0], [2, 512, -64, 10, 0], [1, 'use'], [1, 'restart'], [4, 1, 1]]), 9);
    assert.equal(eintraegePruefen([]), 0);
  });
  test('kaputte Einträge werden abgelehnt', () => {
    for (const bad of [null, {}, [[0, 0, 0]], [[1.5, 0, 0]], [[1, 0]], [[1, 0, 0, 0]], [[1, 'fly']], [[2, 'restart']], [[1, 1e10, 0]], [[1, 0.5, 0]], [[17, 'use']], Array(WK.eintraegeJeNachricht + 1).fill([1, 0, 0])]) {
      assert.equal(eintraegePruefen(bad), null, JSON.stringify(bad).slice(0, 40));
    }
  });
});

describe('Wettkampf: Räume', () => {
  test('Öffnen gibt einen 5-stelligen Code, Fahrer und Zuschauer treten bei', async () => {
    const s = setup();
    const [a, b, z] = [peer(), peer('198.51.100.2'), peer('198.51.100.3')];
    const code = await raum(s, [a, b], [z]);
    assert.match(code, /^\d{5}$/);
    assert.deepEqual(a.got[0], { t: 'raum', code, du: 1, rolle: 'fahrer' });
    assert.deepEqual(b.last('raum'), { t: 'raum', code, du: 2, rolle: 'fahrer' });
    assert.deepEqual(z.last('raum'), { t: 'raum', code, du: 0, rolle: 'zuschauer' });
    assert.deepEqual(a.last('lobby'), { t: 'lobby', leiter: 1, fahrer: [1, 2], zuschauer: 1, level: LEVEL, phase: 'lobby' });
  });

  test('höchstens 4 Fahrer und 8 Zuschauer; falscher Code', async () => {
    const s = setup();
    const fahrer = Array.from({ length: 4 }, (_, i) => peer(`198.51.100.${i}`));
    const code = await raum(s, fahrer);
    const fuenfter = peer('192.0.2.5');
    s.hub.connect(fuenfter);
    await s.send(fuenfter, { t: 'beitreten', code, als: 'fahrer' });
    assert.deepEqual(fuenfter.last('fehler'), { t: 'fehler', grund: 'raum-voll' });
    for (let i = 0; i < WK.maxZuschauer; i++) {
      const z = peer(`192.0.2.${10 + i}`);
      s.hub.connect(z);
      await s.send(z, { t: 'beitreten', code, als: 'zuschauer' });
      assert.equal(z.last('raum')?.rolle, 'zuschauer');
    }
    const zuViel = peer('192.0.2.99');
    s.hub.connect(zuViel);
    await s.send(zuViel, { t: 'beitreten', code, als: 'zuschauer' });
    assert.deepEqual(zuViel.last('fehler'), { t: 'fehler', grund: 'zuschauer-voll' });
    await s.send(zuViel, { t: 'beitreten', code: code === '12345' ? '54321' : '12345', als: 'zuschauer' });
    assert.deepEqual(zuViel.last('fehler'), { t: 'fehler', grund: 'code-unbekannt' });
    await s.send(zuViel, { t: 'beitreten', code: '1234', als: 'zuschauer' });
    assert.deepEqual(zuViel.last('fehler'), { t: 'fehler', grund: 'code-unbekannt' });
  });

  test('unbekanntes Level und fehlender Spielcode', async () => {
    const s = setup();
    const a = peer();
    s.hub.connect(a);
    await s.send(a, { t: 'oeffnen', level: { ...LEVEL, id: 'gibt-es-nicht' } });
    assert.deepEqual(a.last('fehler'), { t: 'fehler', grund: 'level-unbekannt' });
    await s.send(a, { t: 'oeffnen', level: { pack: 'x' } });
    assert.deepEqual(a.last('fehler'), { t: 'fehler', grund: 'ungueltig' });
    s.rechner.up = false;
    await s.send(a, { t: 'oeffnen', level: LEVEL });
    assert.deepEqual(a.last('fehler'), { t: 'fehler', grund: 'aus' });
    assert.equal(s.hub.raumZahl, 0);
  });

  test('Begrenzungen je IP: Räume und Verbindungen', async () => {
    const s = setup();
    for (let i = 0; i < WK.raeumeJeIp; i++) {
      const p = peer();
      s.hub.connect(p);
      await s.send(p, { t: 'oeffnen', level: LEVEL });
      assert.equal(p.last('raum')?.t, 'raum');
    }
    const p = peer();
    s.hub.connect(p);
    await s.send(p, { t: 'oeffnen', level: LEVEL });
    assert.deepEqual(p.last('fehler'), { t: 'fehler', grund: 'zu-viele-raeume' });
    const ip = '192.0.2.200';
    for (let i = 0; i < WK.socketsJeIp; i++) assert.equal(s.hub.connect(peer(ip)), true);
    assert.equal(s.hub.connect(peer(ip)), false);
  });

  test('Spielleiter geht: der nächste Fahrer leitet; ohne Fahrer schließt der Raum', async () => {
    const s = setup();
    const [a, b, z] = [peer(), peer('198.51.100.2'), peer('198.51.100.3')];
    await raum(s, [a, b], [z]);
    s.hub.disconnect(a);
    assert.equal(b.last('lobby')?.leiter, 2);
    assert.deepEqual(b.last('lobby')?.fahrer, [2]);
    // only the leader may start or change the level
    s.hub.disconnect(b);
    assert.deepEqual(z.last('fehler'), { t: 'fehler', grund: 'verfallen' });
    assert.equal(z.closed, true);
    assert.equal(s.hub.raumZahl, 0);
  });

  test('Lobby ohne Start verfällt nach 15 min', async () => {
    const s = setup();
    const [a, b] = [peer(), peer('198.51.100.2')];
    await raum(s, [a, b]);
    s.clock.add(WK.lobbyIdleMs - 1);
    s.hub.sweep();
    assert.equal(s.hub.raumZahl, 1);
    s.clock.add(1);
    s.hub.sweep();
    assert.equal(s.hub.raumZahl, 0);
    assert.equal(a.closed && b.closed, true);
  });
});

describe('Wettkampf: Rennen und Schiedsrichter', () => {
  test('Start nur durch den Spielleiter und ab zwei Fahrern', async () => {
    const s = setup();
    const [a, b] = [peer(), peer('198.51.100.2')];
    s.hub.connect(a);
    s.hub.connect(b);
    await s.send(a, { t: 'oeffnen', level: LEVEL });
    await s.send(a, { t: 'start' });
    assert.deepEqual(a.last('fehler'), { t: 'fehler', grund: 'ungueltig' });
    await s.send(b, { t: 'beitreten', code: a.last('raum')!.code, als: 'fahrer' });
    await s.send(b, { t: 'start' });
    assert.deepEqual(b.last('fehler'), { t: 'fehler', grund: 'ungueltig' });
    await s.send(a, { t: 'start' });
    assert.deepEqual(b.last('runde'), { t: 'runde', runde: 1, level: LEVEL, seed: 4242, fahrer: [1, 2] });
    assert.equal(a.last('lobby')?.phase, 'laden');
  });

  test('Ein Rennen: Countdown, Stand, Zielzeiten aus der Server-Rechnung, Plätze mit Gleichstand', async () => {
    const s = setup();
    const [a, b, c, z] = [peer(), peer('198.51.100.2'), peer('198.51.100.3'), peer('198.51.100.4')];
    await raum(s, [a, b, c], [z]);
    await s.send(a, { t: 'start' });
    await s.send(a, { t: 'bereit', runde: 1 });
    await s.send(b, { t: 'bereit', runde: 1 });
    assert.equal(a.last('los'), undefined);
    await s.send(c, { t: 'bereit', runde: 1 });
    assert.deepEqual(z.last('los'), { t: 'los', runde: 1, in: WK.countdownMs });
    s.clock.add(WK.countdownMs + 1000 * DT_MS);
    // a and b need 1000 steps, c gives up
    await s.send(a, { t: 'eingabe', runde: 1, ab: 0, e: [[400, 3, 0], [1, 'use'], [600, 0, 0]] });
    await s.send(b, { t: 'eingabe', runde: 1, ab: 0, e: leer(999) });
    await s.send(c, { t: 'aufgeben', runde: 1 });
    await s.hub.takt();
    assert.deepEqual(a.last('stand')?.f, [
      [1, 1000, 0, 0, 1000, 'ziel', 1000],
      [2, 999, 0, 0, 999, 'faehrt', null],
      [3, 0, 0, 0, 0, 'raus', null],
    ]);
    assert.equal(s.rechner.calls[0].auf[0].neu?.seed, 4242);
    await s.send(b, { t: 'eingabe', runde: 1, ab: 999, e: leer(1) });
    await s.hub.takt();
    const erg = a.last('ergebnis')!;
    assert.deepEqual(erg.plaetze, [
      { nr: 1, platz: 1, zeit: 1000, status: 'ziel' },
      { nr: 2, platz: 1, zeit: 1000, status: 'ziel' },
      { nr: 3, platz: null, zeit: null, status: 'raus', grund: 'aufgegeben' },
    ] satisfies Platz[]);
    assert.deepEqual(z.last('ergebnis'), erg);
    assert.equal(a.last('lobby')?.phase, 'lobby');
    // the referee forgets the runs
    await s.hub.takt();
    assert.equal(s.rechner.runs.size, 0);
  });

  test('Neustart: die Uhr läuft weiter, die Zielzeit zählt alle Versuche', async () => {
    const s = setup();
    const [a, b] = [peer(), peer('198.51.100.2')];
    await raum(s, [a, b], [], { ...LEVEL, id: 'ziel:300' });
    await rennen(s, [a, b]);
    s.clock.add(500 * DT_MS);
    await s.send(a, { t: 'eingabe', runde: 1, ab: 0, e: [[100, 0, 0], [1, 'restart'], [300, 0, 0]] });
    await s.send(b, { t: 'eingabe', runde: 1, ab: 0, e: leer(250) });
    await s.hub.takt();
    const f = a.last('stand')!.f;
    assert.deepEqual(f[0].slice(4), [400, 'ziel', 400]);
    assert.deepEqual(f[0].slice(1, 2), [300]); // the marble of the second try
  });

  test('Der Browser meldet ein Ziel, das der Server nicht erreicht: abweichung', async () => {
    const s = setup();
    const [a, b] = [peer(), peer('198.51.100.2')];
    await raum(s, [a, b]);
    await rennen(s, [a, b]);
    s.clock.add(600 * DT_MS);
    await s.send(a, { t: 'eingabe', runde: 1, ab: 0, e: leer(500) });
    await s.send(a, { t: 'ziel', runde: 1, schritte: 500 });
    await s.hub.takt();
    assert.deepEqual(a.last('stand')!.f[0].slice(5), ['raus', null]);
    // more input after that does not count
    await s.send(a, { t: 'eingabe', runde: 1, ab: 500, e: leer(500) });
    await s.hub.takt();
    assert.equal(s.rechner.runs.get(`${a.last('raum')!.code}/1/1`), undefined);
  });

  test('Schritt mit der Uhr: zu schnell und zu langsam ist raus; Lücken sind ungültig', async () => {
    const s = setup();
    const [a, b, c] = [peer(), peer('198.51.100.2'), peer('198.51.100.3')];
    await raum(s, [a, b, c], [], { ...LEVEL, id: 'ziel:100000' });
    await rennen(s, [a, b, c]);
    s.clock.add(1000 * DT_MS);
    // a: 1 s ahead is fine, more is not
    await s.send(a, { t: 'eingabe', runde: 1, ab: 0, e: leer(1000 + 400) });
    await s.send(a, { t: 'eingabe', runde: 1, ab: 1400, e: leer(1) });
    // b: a gap
    await s.send(b, { t: 'eingabe', runde: 1, ab: 5, e: leer(10) });
    await s.send(c, { t: 'eingabe', runde: 1, ab: 0, e: leer(1000) });
    await s.hub.takt();
    const f = a.last('stand')!.f;
    assert.deepEqual([f[0][5], f[1][5], f[2][5]], ['raus', 'raus', 'faehrt']);
    // c sends nothing more: 20 s behind the clock is out
    s.clock.add(WK.rueckstandMs);
    await s.hub.takt();
    assert.equal(a.last('stand')!.f[2][5], 'faehrt');
    s.clock.add(1000 * DT_MS);
    await s.hub.takt();
    const erg = a.last('ergebnis')!.plaetze.map((p) => p.grund);
    assert.deepEqual(erg, ['zu-schnell', 'ungueltig', 'zu-langsam']);
  });

  test('Nach dem ersten im Ziel bleiben den anderen 2 Minuten', async () => {
    const s = setup();
    const [a, b] = [peer(), peer('198.51.100.2')];
    await raum(s, [a, b], [], { ...LEVEL, id: 'ziel:400' });
    await rennen(s, [a, b]);
    s.clock.add(400 * DT_MS);
    await s.send(a, { t: 'eingabe', runde: 1, ab: 0, e: leer(400) });
    await s.send(b, { t: 'eingabe', runde: 1, ab: 0, e: leer(100) });
    await s.hub.takt();
    assert.equal(a.last('stand')!.f[0][5], 'ziel');
    let ab = 100;
    for (let t = 0; t < WK.nachZielMs; t += 10_000) {
      s.clock.add(10_000);
      // b keeps sending, but starts over before every win
      const e: Eintrag[] = [];
      for (let k = 0; k < 10; k++) e.push([1, 'restart'], [399, 0, 0]);
      await s.send(b, { t: 'eingabe', runde: 1, ab, e });
      ab += 3990;
      await s.hub.takt();
    }
    assert.equal(a.last('ergebnis'), undefined);
    s.clock.add(100);
    await s.hub.takt();
    assert.deepEqual(a.last('ergebnis')!.plaetze.map((p) => [p.nr, p.platz, p.grund]), [
      [1, 1, undefined],
      [2, null, 'zeit'],
    ]);
  });

  test('Wer beim Laden nicht bereit wird, setzt aus; wer geht, ist raus', async () => {
    const s = setup();
    const [a, b, c] = [peer(), peer('198.51.100.2'), peer('198.51.100.3')];
    await raum(s, [a, b, c]);
    await s.send(a, { t: 'start' });
    await s.send(a, { t: 'bereit', runde: 1 });
    await s.send(b, { t: 'bereit', runde: 1 });
    s.clock.add(WK.ladenMs);
    await s.hub.takt();
    assert.deepEqual(a.last('los'), { t: 'los', runde: 1, in: WK.countdownMs });
    s.clock.add(WK.countdownMs);
    s.hub.disconnect(b);
    await s.hub.takt();
    assert.deepEqual(a.last('stand')!.f.map((z) => [z[0], z[5]]), [
      [1, 'faehrt'],
      [2, 'raus'],
    ]);
  });

  test('Zuschauer bekommen den bisherigen Strom des verfolgten Fahrers und dann jeden neuen', async () => {
    const s = setup();
    const [a, b] = [peer(), peer('198.51.100.2')];
    await raum(s, [a, b]);
    await rennen(s, [a, b]);
    s.clock.add(5000);
    await s.send(b, { t: 'eingabe', runde: 1, ab: 0, e: [[10, 1, 2], [1, 'drop']] });
    await s.send(b, { t: 'eingabe', runde: 1, ab: 10, e: [[5, 0, 0]] });
    const z = peer('198.51.100.9');
    s.hub.connect(z);
    await s.send(z, { t: 'beitreten', code: a.last('raum')!.code, als: 'zuschauer' });
    assert.equal(z.last('runde')?.seed, 4242);
    assert.equal(z.last('los')?.t, 'los');
    await s.send(z, { t: 'folgen', fahrer: 2 });
    assert.deepEqual(z.last('verlauf'), { t: 'verlauf', runde: 1, fahrer: 2, i: 0, e: [[10, 1, 2], [1, 'drop'], [5, 0, 0]] });
    await s.send(b, { t: 'eingabe', runde: 1, ab: 15, e: [[3, 0, 0]] });
    await s.send(a, { t: 'eingabe', runde: 1, ab: 0, e: [[3, 0, 0]] });
    assert.deepEqual(z.last('verlauf'), { t: 'verlauf', runde: 1, fahrer: 2, i: 3, e: [[3, 0, 0]] });
    // a racer cannot follow, a spectator cannot race
    await s.send(a, { t: 'folgen', fahrer: 2 });
    assert.deepEqual(a.last('fehler'), { t: 'fehler', grund: 'ungueltig' });
  });

  test('Stürzt der Rechenprozess ab, endet das Rennen ohne Wertung', async () => {
    const s = setup();
    const [a, b] = [peer(), peer('198.51.100.2')];
    await raum(s, [a, b]);
    await rennen(s, [a, b]);
    s.rechner.crash = true;
    await s.hub.takt();
    const erg = a.last('ergebnis')!;
    assert.equal(erg.abbruch, true);
    assert.deepEqual(erg.plaetze.map((p) => p.platz), [null, null]);
  });

  test('Ein Level, das im Rechenprozess nicht startet, ist für alle ein Fehler', async () => {
    const s = setup();
    const [a, b] = [peer(), peer('198.51.100.2')];
    await raum(s, [a, b], [], { ...LEVEL, id: 'kaputt' });
    await rennen(s, [a, b]);
    await s.hub.takt();
    assert.deepEqual(a.last('ergebnis')!.plaetze.map((p) => p.grund), ['fehler', 'fehler']);
  });

  test('Höchstens 6 Rennen gleichzeitig', async () => {
    const s = setup();
    for (let i = 0; i < WK.maxRennen; i++) {
      const fahrer = [peer(`198.51.${i}.1`), peer(`198.51.${i}.2`)];
      await raum(s, fahrer);
      await s.send(fahrer[0], { t: 'start' });
      assert.equal(fahrer[0].last('runde')?.runde, 1);
    }
    const fahrer = [peer('192.0.2.1'), peer('192.0.2.2')];
    await raum(s, fahrer);
    await s.send(fahrer[0], { t: 'start' });
    assert.deepEqual(fahrer[0].last('fehler'), { t: 'fehler', grund: 'ausgelastet' });
  });
});

// ---------- the real referee: game code of this repository ----------

describe('Wettkampf: echter Rechenprozess', () => {
  test('eine Lösung aus solutions/ gewinnt mit derselben Schrittzahl, auch nach einem Neustart', { timeout: 180_000 }, async () => {
    const rechner: Rechner = wettkampfRechner(REPO, { timeoutMs: 90_000, nice: 0 });
    after(() => rechner.close());
    assert.equal(rechner.verfuegbar(), true);
    const rec = JSON.parse(readFileSync(new URL('../../solutions/murmel/01.json', import.meta.url), 'utf8')) as { level: string; seed: number; steps: number; dt: number; input: Eintrag[] };
    assert.equal(rec.dt * 1000, DT_MS);
    assert.equal(await rechner.kennt(rec.level), true);
    assert.equal(await rechner.kennt('gibt-es-nicht'), false);
    const neu = { level: rec.level, seed: rec.seed };
    // in pieces, as the browser sends it
    const half = Math.floor(rec.input.length / 2);
    const first = await rechner.takt([{ k: 'a', neu, e: rec.input.slice(0, half) }, { k: 'b', neu, e: [[300, 0, 0], [1, 'restart']] }], []);
    assert.equal(first.staende.find((s) => s.k === 'a')?.ziel, null);
    const second = await rechner.takt([{ k: 'a', e: rec.input.slice(half) }, { k: 'b', e: rec.input }], []);
    const a = second.staende.find((s) => s.k === 'a')!;
    const b = second.staende.find((s) => s.k === 'b')!;
    assert.equal(a.ziel, rec.steps);
    assert.equal(b.ziel, 300 + rec.steps);
    assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y));
    // without pushes the marble never gets there
    const still = rec.input.map((e): Eintrag => (typeof e[1] === 'number' ? [e[0], 0, 0] : e));
    const c = (await rechner.takt([{ k: 'c', neu, e: still }], ['a', 'b'])).staende[0];
    assert.equal(c.ziel, null);
    assert.equal(c.schritte, rec.steps);
  });
});

// ---------- end to end over a WebSocket ----------

describe('Wettkampf: WebSocket', () => {
  test('/api/wettkampf und /api/raum laufen nebeneinander, andere Pfade nicht', { timeout: 20_000 }, async () => {
    const hub = new WettkampfHub({ rechner: fakeRechner() });
    const app = buildApp({ version: 't', db: { ping: async () => {}, recordEvent: async () => {}, statistics: async () => ({ days: [], levels: [] }) }, raum: new RoomHub(), wettkampf: hub });
    await app.listen({ host: '127.0.0.1', port: 0 });
    after(() => app.close());
    const port = (app.server.address() as { port: number }).port;
    const open = (path: string) =>
      new Promise<WebSocket>((ok, fail) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
        ws.once('open', () => ok(ws));
        ws.once('error', fail);
      });
    const next = (ws: WebSocket) => new Promise<Record<string, unknown>>((ok) => ws.once('message', (d) => ok(JSON.parse(d.toString()))));

    const a = await open('/api/wettkampf');
    const got = next(a);
    a.send(JSON.stringify({ t: 'oeffnen', level: LEVEL }));
    const m = await got;
    assert.equal(m.t, 'raum');
    assert.match(String(m.code), /^\d{5}$/);
    assert.equal(hub.raumZahl, 1);

    const r = await open('/api/raum');
    const got2 = next(r);
    r.send(JSON.stringify({ t: 'oeffnen' }));
    assert.equal((await got2).t, 'raum');

    await assert.rejects(open('/api/anders'));
    a.close();
    r.close();
  });
});
