import { describe, expect, it, vi } from 'vitest';
import enigmaI from '../public/levels/enigma/enigma_i.json';
import shim from './lua/enigma.lua?raw';
import { LuaLevel } from './lua/runtime';
import { type CloudApi, cloudApi, CloudSpeicher, eingabeAus, entpacken, MAX_STEPS, nachspielen, packen, pruefcode, type Stand, standAus } from './cloudstand';
import type { LevelFile } from './game/level';
import { createRng } from './game/rng';
import { GameSession, type StartLua } from './game/session';

const levels = enigmaI.levels as unknown as LevelFile[];
const byId = (id: string): LevelFile => levels.find((l) => l.id === id)!;
const startLua: StartLua = async (code, host) => LuaLevel.create(code, host, shim, await import('fengari'));

/** Plays like a person (irregular mouse, keys, actions) from step `from` on. */
function play(s: GameSession, from: number, steps: number, seed = 9): void {
  const r = createRng(seed + from);
  for (let i = from; i < from + steps && !s.won; i++) {
    if (i % 400 === 50) s.act('use');
    if (i % 700 === 300) s.act('rotate');
    const mouse = i % 4 === 0;
    s.step({ fx: mouse ? (r() - 0.5) * 6 : 0, fy: mouse ? (r() - 0.5) * 6 : 0, ax: i % 900 < 100 ? 0.7 : 0, ay: 0 });
  }
}

const state = (s: GameSession) => ({
  steps: s.steps,
  falls: s.falls,
  won: s.won,
  marbles: s.physics.marbles.map((m) => [m.pos.x, m.pos.y, m.vel.x, m.vel.y]),
  inventories: s.objects.inventories.map((i) => [...i]),
  states: [...s.board.states],
  objects: s.objects.objects.map((o) => `${o.kind}@${o.col},${o.row}:${o.state}${o.gone ? 'x' : ''}`).join('|'),
});

/** Saves a run, "sends" it through JSON, and continues it in a fresh run with the same seed and lives. */
async function saveAndRestore(file: LevelFile, live: GameSession, leben: number | null = null) {
  const stand = JSON.parse(JSON.stringify(await standAus(live, 'enigma_i', leben, 'abc1234'))) as Stand;
  const restored = await GameSession.create(file, { seed: stand.seed, carryLives: stand.leben, startLua });
  await nachspielen(restored, await eingabeAus(stand), stand.pruef, undefined, 500);
  return { stand, restored };
}

describe('Spielstand packen', () => {
  it('gzip + base64 hin und zurück, auch mit Umlauten', async () => {
    const text = JSON.stringify({ a: 'Murmel – größer', n: Array.from({ length: 5000 }, (_, i) => i % 7) });
    const daten = await packen(text);
    expect(daten).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(daten.length).toBeLessThan(text.length / 3);
    expect(await entpacken(daten)).toBe(text);
  });

  it('lehnt kaputte und zu große Daten ab', async () => {
    await expect(entpacken('kein base64!')).rejects.toThrow();
    await expect(entpacken(btoa('kein gzip'))).rejects.toThrow();
    await expect(entpacken(await packen('x'.repeat(10_000)), 1000)).rejects.toThrow('zu groß');
  });
});

describe('Sichern und Weiterspielen', () => {
  it('nachgespielt ist der Lauf im selben Zustand und läuft gleich weiter', async () => {
    const file = byId('enigma:rb01');
    const live = await GameSession.create(file, { seed: 77, startLua });
    play(live, 0, 3000);
    const { stand, restored } = await saveAndRestore(file, live);

    expect(stand).toMatchObject({ pack: 'enigma_i', seed: 77, leben: null, steps: 3000, version: 'abc1234' });
    expect(state(restored)).toEqual(state(live));
    expect(pruefcode(restored)).toBe(pruefcode(live));

    play(live, 3000, 2000);
    play(restored, 3000, 2000);
    expect(state(restored)).toEqual(state(live));
    // the recording continues seamlessly: the continued run is one valid run from the start
    expect(restored.recording()).toEqual(live.recording());
  });

  it('gilt auch für ein Lua-Level und mitgebrachte Extraleben', async () => {
    const file = byId('enigma:duffy19');
    const live = await GameSession.create(file, { seed: 5, carryLives: 4, startLua });
    play(live, 0, 2500, 3);
    const { stand, restored } = await saveAndRestore(file, live, 4);

    expect(stand.leben).toBe(4);
    expect(restored.livesLeft()).toBe(live.livesLeft());
    play(live, 2500, 1500, 3);
    play(restored, 2500, 1500, 3);
    expect(state(restored)).toEqual(state(live));
  });

  it('erkennt einen Stand, der nicht mehr passt (andere Eingaben, falscher Prüfcode)', async () => {
    const file = byId('enigma:rb01');
    const live = await GameSession.create(file, { seed: 77, startLua });
    play(live, 0, 2000);
    const stand = (await standAus(live, 'enigma_i', null, 'v'))!;

    // what another game version does to the same run: a different course with the same number of steps
    const anders = await GameSession.create(file, { seed: 77, startLua });
    play(anders, 0, 2000, 4);
    const fremd = (await standAus(anders, 'enigma_i', null, 'v'))!;
    const neu = await GameSession.create(file, { seed: 77, startLua });
    await expect(nachspielen(neu, await eingabeAus(fremd), stand.pruef)).rejects.toThrow('passt nicht');
    const falsch = await GameSession.create(file, { seed: 77, startLua });
    await expect(nachspielen(falsch, await eingabeAus(stand), '2000-0')).rejects.toThrow('passt nicht');
  });

  it('lehnt beschädigte Stände ab; nichts zu sichern ohne Schritte oder nach dem Sieg', async () => {
    const file = byId('enigma:rb01');
    const live = await GameSession.create(file, { seed: 1, startLua });
    expect(await standAus(live, 'p', null, 'v')).toBeNull();
    play(live, 0, 100);
    const stand = (await standAus(live, 'p', null, 'v'))!;
    expect(stand.version).toBe('v');
    expect((await standAus(live, 'p', null, 'kein gültiger name'))!.version).toBe('dev');

    await expect(eingabeAus({ ...stand, steps: 99 })).rejects.toThrow();
    await expect(eingabeAus({ ...stand, steps: MAX_STEPS + 1 })).rejects.toThrow();
    await expect(eingabeAus({ ...stand, daten: await packen('{"v":2}') })).rejects.toThrow();
    await expect(eingabeAus({ ...stand, daten: 'AAAA' })).rejects.toThrow();
  });

  it('meldet den Fortschritt beim Nachspielen in Häppchen', async () => {
    const file = byId('enigma:rb01');
    const live = await GameSession.create(file, { seed: 2, startLua });
    play(live, 0, 1000);
    const stand = (await standAus(live, 'p', null, 'v'))!;
    const seen: number[] = [];
    await nachspielen(await GameSession.create(file, { seed: 2, startLua }), await eingabeAus(stand), stand.pruef, (a) => seen.push(a), 300);
    expect(seen).toEqual([0.3, 0.6, 0.9, 1]);
  });
});

describe('API', () => {
  const answer = (status: number, body?: unknown) =>
    vi.fn(async (..._a: unknown[]) => new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), { status }));

  it('ruft die Routen mit kodierter Level-Kennung, Cookie und keepalive auf', async () => {
    const f = answer(200, { gespeichert: 'x' });
    const api = cloudApi('/api/spielstand', f as unknown as typeof fetch);
    const stand = { pack: 'p', seed: 1, leben: null, steps: 1, version: 'v', pruef: '1-a', daten: 'AA==' };
    expect(await api.sichern('enigma_iv/a:1', stand, true)).toEqual({ ok: true, daten: { gespeichert: 'x' } });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/spielstand?level=enigma_iv%2Fa%3A1');
    expect(init).toMatchObject({ method: 'PUT', credentials: 'same-origin', keepalive: true });
    expect(JSON.parse(init.body as string)).toEqual(stand);
  });

  it('404 mit Antwort der API = kein Stand; ohne API oder Netz Status 0; 204 = gelöscht', async () => {
    expect(await cloudApi('/a', answer(404, { error: 'kein Spielstand' }) as unknown as typeof fetch).holen('x')).toEqual({ ok: false, status: 404 });
    expect(await cloudApi('/a', answer(404, '<html>') as unknown as typeof fetch).holen('x')).toEqual({ ok: false, status: 0 });
    expect(await cloudApi('/a', (async () => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch).liste()).toEqual({ ok: false, status: 0 });
    expect(await cloudApi('/a', answer(204) as unknown as typeof fetch).loeschen('x')).toEqual({ ok: true, daten: null });
  });
});

describe('CloudSpeicher', () => {
  function fakeApi() {
    const saved = new Map<string, Stand>();
    const calls: string[] = [];
    const api: CloudApi = {
      liste: async () => (calls.push('liste'), { ok: true, daten: { staende: [...saved].map(([level, s]) => ({ level, pack: s.pack, steps: s.steps, gespeichert: 't' })) } }),
      holen: async (level) => {
        calls.push(`holen ${level}`);
        const s = saved.get(level);
        return s ? { ok: true, daten: { ...s, level, gespeichert: 't' } } : { ok: false, status: 404 };
      },
      sichern: async (level, s, keepalive) => (calls.push(`sichern ${level} ${s.steps}${keepalive ? ' keepalive' : ''}`), saved.set(level, s), { ok: true, daten: { gespeichert: 't' } }),
      loeschen: async (level) => (calls.push(`loeschen ${level}`), saved.delete(level), { ok: true, daten: null }),
    };
    return { api, saved, calls };
  }

  it('sichert nur Neues, lädt, löscht nach dem Sieg und vergisst beim Abmelden', async () => {
    const { api, calls } = fakeApi();
    let t = 0;
    const cloud = new CloudSpeicher(api, () => t);
    const file = byId('enigma:rb01');
    const s = await GameSession.create(file, { seed: 3, startLua });

    play(s, 0, 500);
    expect(await cloud.sichern(s, 'enigma_i', null, 'v', true)).toBe('ok');
    expect(await cloud.sichern(s, 'enigma_i', null, 'v')).toBe('ok');
    play(s, 500, 10);
    expect(await cloud.sichern(s, 'enigma_i', null, 'v')).toBe('ok');
    expect(calls).toEqual([`sichern ${file.id} 500 keepalive`, `sichern ${file.id} 510`]);
    expect(cloud.staende.get(file.id)?.steps).toBe(510);

    const r = await cloud.laden(file.id);
    expect(r.ok && r.eingabe.steps).toBe(510);
    expect(await cloud.laden('anderes')).toEqual({ ok: false, grund: 'Kein Spielstand mehr in der Cloud.' });

    await cloud.loeschen(file.id);
    expect(calls.at(-1)).toBe(`loeschen ${file.id}`);
    expect(cloud.staende.size).toBe(0);

    expect(await cloud.liste()).toBe(false);
    expect(calls.at(-1)).not.toBe('liste');
    t = 31_000;
    await cloud.sichern(s, 'enigma_i', null, 'v');
    cloud.vergessen();
    expect(await cloud.liste()).toBe(true);
    expect([...cloud.staende.keys()]).toEqual([file.id]);
  });

  it('meldet offline und Fehler, ohne den Stand als gesichert zu merken', async () => {
    const file = byId('enigma:rb01');
    const s = await GameSession.create(file, { seed: 3, startLua });
    play(s, 0, 100);
    let status = 0;
    const calls: number[] = [];
    const api = { sichern: async () => (calls.push(status), { ok: false as const, status }) } as unknown as CloudApi;
    const cloud = new CloudSpeicher(api);
    expect(await cloud.sichern(s, 'p', null, 'v')).toBe('offline');
    status = 500;
    expect(await cloud.sichern(s, 'p', null, 'v')).toBe('fehler');
    status = 413;
    expect(await cloud.sichern(s, 'p', null, 'v')).toBe('zu-lang');
    expect(calls).toEqual([0, 500, 413]);
  });

  it('ein unpassender Stand wird nicht wieder angeboten, bis ein neuerer gesichert ist', async () => {
    let gespeichert = 't1';
    const api = { liste: async () => ({ ok: true, daten: { staende: [{ level: 'a', pack: 'p', steps: 5, gespeichert }] } }) } as unknown as CloudApi;
    const cloud = new CloudSpeicher(api);
    await cloud.liste(true);
    cloud.passtNicht('a');
    expect(cloud.staende.has('a')).toBe(false);
    await cloud.liste(true);
    expect(cloud.staende.has('a')).toBe(false);
    gespeichert = 't2';
    await cloud.liste(true);
    expect(cloud.staende.has('a')).toBe(true);
  });

  it('zweimal gleichzeitig derselbe Stand: eine Anfrage', async () => {
    const { api, calls } = fakeApi();
    const cloud = new CloudSpeicher(api);
    const s = await GameSession.create(byId('enigma:rb01'), { seed: 3, startLua });
    play(s, 0, 200);
    expect(await Promise.all([cloud.sichern(s, 'p', null, 'v'), cloud.sichern(s, 'p', null, 'v', true)])).toEqual(['ok', 'ok']);
    expect(calls).toHaveLength(1);
  });
});
