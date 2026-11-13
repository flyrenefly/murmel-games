import { describe, expect, test, vi } from 'vitest';
import { emptyProgress, type Progress, recordAttempt, recordWin } from './game/progress';
import { Abgleich, abgleichen, type Antwort, type ServerStand, statusText, type SyncApi, syncApi } from './sync';

/** The server in memory, like server/src/sync.ts: versions, 409, keys reordered like jsonb. */
function fakeServer() {
  let version = 0;
  let data: unknown = { levels: {}, solved: [] };
  let netz = true;
  let gesperrt = false;
  const scramble = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(scramble);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).reverse().map((k) => [k, scramble((v as Record<string, unknown>)[k])]));
    return v;
  };
  const stand = (): ServerStand => ({ version, geaendert: version ? '2026-11-13T12:00:00.000Z' : null, fortschritt: scramble(JSON.parse(JSON.stringify(data))) });
  let uploads = 0;
  /** One device's view; `vorHochladen` runs between fetching and uploading (for races). */
  const geraet = (vorHochladen?: () => Promise<void>): SyncApi => ({
    async holen(): Promise<Antwort<ServerStand>> {
      if (!netz) return { ok: false, status: 0 };
      return { ok: true, daten: stand() };
    },
    async hochladen(basis, p) {
      if (vorHochladen) await vorHochladen();
      if (!netz) return { ok: false, status: 0 };
      if (gesperrt) return { ok: false, status: 403 };
      if (basis !== version) return { ok: false, status: 409, daten: stand() };
      uploads++;
      version++;
      data = JSON.parse(JSON.stringify({ levels: p.levels, solved: p.solved }));
      return { ok: true, daten: { version, geaendert: '2026-11-13T12:00:00.000Z' } };
    },
  });
  return {
    geraet,
    get data() {
      return data as Progress;
    },
    set data(d: Progress) {
      data = d;
      version++;
    },
    get uploads() {
      return uploads;
    },
    netz: (an: boolean) => void (netz = an),
    sperren: () => void (gesperrt = true),
  };
}

/** A device: its local progress (like main.ts) and its view of the server. */
function device(api: SyncApi, start: Progress = emptyProgress()) {
  const d = {
    progress: start,
    sync: () => abgleichen(() => d.progress, (p) => void (d.progress = p), api),
  };
  return d;
}

const win = (p: Progress, id: string, steps: number, date = '2026-11-13T10:00:00.000Z') => recordWin(p, id, { steps, falls: 0, seed: 1 }, date);

describe('abgleichen', () => {
  test('zwei Geräte: gelöst bleibt gelöst, die bessere Zeit gewinnt', async () => {
    const server = fakeServer();
    const a = device(server.geraet(), win(win(emptyProgress(), 'enigma:a', 5000), 'enigma:b', 900));
    const b = device(server.geraet(), win(emptyProgress(), 'enigma:a', 4000));

    expect((await a.sync()).art).toBe('ok');
    expect((await b.sync()).art).toBe('ok');
    expect((await a.sync()).art).toBe('ok');

    for (const d of [a, b]) {
      expect(d.progress.solved).toEqual(['enigma:a', 'enigma:b']);
      expect(d.progress.levels['enigma:a'].best?.steps).toBe(4000);
      expect(d.progress.levels['enigma:b'].best?.steps).toBe(900);
    }
    expect(server.data.solved).toEqual(['enigma:a', 'enigma:b']);
  });

  test('nichts Neues: kein Hochladen (Schlüsselreihenfolge des Servers egal)', async () => {
    const server = fakeServer();
    const a = device(server.geraet(), recordAttempt(win(emptyProgress(), 'enigma:a', 5000), 'enigma:a', '2026-11-13T11:00:00.000Z'));
    await a.sync();
    expect(server.uploads).toBe(1);
    await a.sync();
    await a.sync();
    expect(server.uploads).toBe(1);
  });

  test('offline gespielt: wartet auf Netz, beim nächsten Abgleich nachgereicht', async () => {
    const server = fakeServer();
    const a = device(server.geraet());
    server.netz(false);
    a.progress = win(a.progress, 'enigma:offline', 3000);
    expect(await a.sync()).toEqual({ art: 'offline' });
    expect(a.progress.solved).toEqual(['enigma:offline']);
    expect(server.data.solved).toEqual([]);

    server.netz(true);
    expect((await a.sync()).art).toBe('ok');
    expect(server.data.solved).toEqual(['enigma:offline']);
  });

  test('Konflikt: zwei Geräte laden gleichzeitig hoch, nichts geht verloren', async () => {
    const server = fakeServer();
    // both fetch version 0, then both upload: the second gets 409, merges and uploads again
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let waiting = 0;
    const barrier = async () => {
      waiting++;
      if (waiting === 2) release();
      await gate;
    };
    const a = device(server.geraet(barrier), win(emptyProgress(), 'enigma:a', 5000));
    const b = device(server.geraet(barrier), win(win(emptyProgress(), 'enigma:a', 4500), 'enigma:b', 700));

    const [ra, rb] = await Promise.all([a.sync(), b.sync()]);
    expect(ra.art).toBe('ok');
    expect(rb.art).toBe('ok');
    expect(server.data.solved).toEqual(['enigma:a', 'enigma:b']);
    expect((server.data.levels['enigma:a'] as { best: { steps: number } }).best.steps).toBe(4500);
    // the first device gets the rest at its next sync
    await a.sync();
    expect(a.progress.solved).toEqual(['enigma:a', 'enigma:b']);
  });

  test('während des Abgleichs gespielt: der neue Sieg bleibt lokal und kommt beim nächsten Mal mit', async () => {
    const server = fakeServer();
    let d!: ReturnType<typeof device>;
    const api = server.geraet(async () => {
      d.progress = win(d.progress, 'enigma:mitten', 1234);
    });
    d = device(api, win(emptyProgress(), 'enigma:a', 5000));
    expect((await d.sync()).art).toBe('ok');
    expect(d.progress.solved).toEqual(['enigma:a', 'enigma:mitten']);
    expect(server.data.solved).toEqual(['enigma:a']);
    await d.sync();
    expect(server.data.solved).toEqual(['enigma:a', 'enigma:mitten']);
  });

  test('ein anderes Gerät war schneller: 409, zusammengeführt, beide Siege auf dem Server', async () => {
    const server = fakeServer();
    const api = server.geraet();
    let einmal = true;
    const a = device(
      {
        holen: api.holen,
        async hochladen(basis, p) {
          if (einmal) server.data = win(emptyProgress(), 'enigma:anderes', 800); // version 1 meanwhile
          einmal = false;
          return api.hochladen(basis, p);
        },
      },
      win(emptyProgress(), 'enigma:a', 5000),
    );
    expect((await a.sync()).art).toBe('ok');
    expect(server.data.solved).toEqual(['enigma:a', 'enigma:anderes']);
    expect(a.progress.solved).toEqual(['enigma:a', 'enigma:anderes']);
  });

  test('ohne Konto: nichts geändert; gesperrt: Serverstand kommt trotzdem aufs Gerät', async () => {
    const lokal = win(emptyProgress(), 'enigma:a', 5000);
    const ohne = device({ holen: async () => ({ ok: false, status: 401 }), hochladen: async () => ({ ok: false, status: 401 }) }, lokal);
    expect(await ohne.sync()).toEqual({ art: 'abgemeldet' });
    expect(ohne.progress).toBe(lokal);

    const server = fakeServer();
    server.data = win(emptyProgress(), 'enigma:server', 100);
    server.sperren();
    const g = device(server.geraet(), lokal);
    expect(await g.sync()).toEqual({ art: 'gesperrt' });
    expect(g.progress.solved).toEqual(['enigma:a', 'enigma:server']);
  });

  test('kaputte Serverdaten: Fehler, lokaler Fortschritt unverändert', async () => {
    const lokal = win(emptyProgress(), 'enigma:a', 5000);
    const d = device({ holen: async () => ({ ok: true, daten: { version: 1, geaendert: null, fortschritt: 'Unsinn' } }), hochladen: async () => ({ ok: false, status: 500 }) }, lokal);
    expect(await d.sync()).toEqual({ art: 'fehler' });
    expect(d.progress).toBe(lokal);
  });
});

describe('Abgleich (wann)', () => {
  test('nie zwei gleichzeitig; eine Anfrage währenddessen läuft danach', async () => {
    const server = fakeServer();
    const api = server.geraet();
    let holen = 0;
    const counted: SyncApi = { holen: () => (holen++, api.holen()), hochladen: api.hochladen };
    let p = win(emptyProgress(), 'enigma:a', 5000);
    const ab = new Abgleich(() => p, (x) => void (p = x), counted);
    const seen: string[] = [];
    ab.beobachten((s) => seen.push(s.art));
    const first = ab.jetzt();
    void ab.jetzt();
    void ab.jetzt();
    await first;
    await vi.waitFor(() => expect(ab.status.art).toBe('ok'));
    expect(holen).toBe(2);
    expect(seen[0]).toBe('abgemeldet');
    expect(seen).toContain('laeuft');
  });

  test('bald: gebündelt nach einem Sieg, aber nicht ohne Konto', async () => {
    vi.useFakeTimers();
    try {
      const server = fakeServer();
      const api = server.geraet();
      let holen = 0;
      const counted: SyncApi = { holen: () => (holen++, api.holen()), hochladen: api.hochladen };
      let p = emptyProgress();
      const ab = new Abgleich(() => p, (x) => void (p = x), counted);
      ab.bald();
      await vi.advanceTimersByTimeAsync(5000);
      expect(holen).toBe(0); // signed out: no requests

      await ab.jetzt();
      expect(holen).toBe(1);
      p = win(p, 'enigma:a', 100);
      ab.bald();
      ab.bald();
      await vi.advanceTimersByTimeAsync(5000);
      expect(holen).toBe(2);
      expect(server.data.solved).toEqual(['enigma:a']);

      ab.abgemeldet();
      ab.bald();
      await vi.advanceTimersByTimeAsync(5000);
      expect(holen).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test('wieder online: nur wenn etwas wartet', async () => {
    const server = fakeServer();
    let p = win(emptyProgress(), 'enigma:a', 100);
    const ab = new Abgleich(() => p, (x) => void (p = x), server.geraet());
    server.netz(false);
    await ab.jetzt();
    expect(ab.status.art).toBe('offline');
    server.netz(true);
    ab.online();
    await vi.waitFor(() => expect(ab.status.art).toBe('ok'));
    expect(server.data.solved).toEqual(['enigma:a']);
  });
});

describe('syncApi', () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  test('PUT mit basis und nur levels/solved; 409 bringt den neuen Stand mit', async () => {
    const calls: RequestInit[] = [];
    const neu = { version: 3, geaendert: 'x', fortschritt: { levels: {}, solved: ['b'] } };
    const api = syncApi('/api/fortschritt', (async (_u: string, init: RequestInit) => (calls.push(init), json(409, { error: 'x', ...neu }))) as unknown as typeof fetch);
    const r = await api.hochladen(2, { levels: {}, solved: ['a'] });
    expect(r).toEqual({ ok: false, status: 409, daten: { error: 'x', ...neu } });
    expect(calls[0].method).toBe('PUT');
    expect(JSON.parse(String(calls[0].body))).toEqual({ basis: 2, fortschritt: { levels: {}, solved: ['a'] } });
    expect(calls[0].credentials).toBe('same-origin');
  });
  test('kein Netz, keine API (404/HTML): Status 0', async () => {
    const weg = syncApi('/x', (async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch);
    expect(await weg.holen()).toEqual({ ok: false, status: 0 });
    const html = syncApi('/x', (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch);
    expect(await html.holen()).toEqual({ ok: false, status: 0 });
    const nf = syncApi('/x', (async () => json(404, { error: 'nicht gefunden' })) as unknown as typeof fetch);
    expect(await nf.holen()).toEqual({ ok: false, status: 0 });
    const auth = syncApi('/x', (async () => json(401, { error: 'nicht angemeldet' })) as unknown as typeof fetch);
    expect(await auth.holen()).toEqual({ ok: false, status: 401 });
  });
});

test('statusText', () => {
  const heute = new Date('2026-11-13T15:00:00');
  expect(statusText({ art: 'ok', zeit: new Date('2026-11-13T14:32:00').toISOString() }, heute)).toBe('Auf allen Geräten abgeglichen um 14:32.');
  expect(statusText({ art: 'ok', zeit: new Date('2026-11-12T09:00:00').toISOString() }, heute)).toMatch(/am 12\. Nov/);
  expect(statusText({ art: 'offline' })).toMatch(/Wartet auf Netz/);
});
