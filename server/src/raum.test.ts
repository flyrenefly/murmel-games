import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from './app.ts';
import { LIMITS, type Peer, ROOM_IDLE_MS, RoomHub, type ServerMessage, turnCredentials, turnUrls, upgradeIp } from './raum.ts';

/** A browser stand-in: collects what the server sends. */
function peer(ip = '203.0.113.1'): Peer & { got: ServerMessage[]; closed: boolean; last: () => ServerMessage | undefined } {
  const got: ServerMessage[] = [];
  const p = {
    ip,
    got,
    closed: false,
    send: (m: ServerMessage) => void got.push(m),
    close: () => void (p.closed = true),
    last: () => got.at(-1),
  };
  return p;
}

function hub(opts: { now?: () => number; codes?: string[]; turn?: boolean } = {}) {
  const codes = opts.codes ? [...opts.codes] : null;
  return new RoomHub({
    now: opts.now,
    code: codes ? () => codes.shift() ?? '9999' : undefined,
    turn: opts.turn ? { secret: 'geheim', urls: ['turn:example.test:3478?transport=udp'] } : null,
  });
}

const send = (h: RoomHub, p: Peer, m: object) => h.message(p, JSON.stringify(m));

test('TURN-Zugangsdaten: HMAC-SHA1 über ablauf:kennung, base64 (fester Prüfwert)', () => {
  const c = turnCredentials({ secret: 'geheim', urls: ['turn:x'] }, 1_700_000_000_000, 'abc123');
  assert.equal(c.username, '1700003600:abc123');
  // printf '%s' '1700003600:abc123' | openssl dgst -sha1 -hmac geheim -binary | base64
  assert.equal(c.credential, 'Z0k6yFRM6rvPSTu6T2Nquc+f4cY=');
  assert.equal(c.ttl, 3600);
  assert.deepEqual(c.urls, ['turn:x']);
});

test('TURN-Adressen: aus TURN_URLS, sonst UDP und TCP am Port 3478 der Seite', () => {
  assert.deepEqual(turnUrls({ TURN_URLS: 'turn:a:1, turn:b:2' }), ['turn:a:1', 'turn:b:2']);
  assert.deepEqual(turnUrls({ SITE_ADDRESS: 'murmel.games' }), ['turn:murmel.games:3478?transport=udp', 'turn:murmel.games:3478?transport=tcp']);
});

test('Raum öffnen liefert einen 4-stelligen Code und TURN-Daten nur für den offenen Raum', () => {
  const h = hub({ turn: true });
  const a = peer();
  assert.ok(h.connect(a));
  send(h, a, { t: 'oeffnen' });
  const m = a.last();
  assert.equal(m?.t, 'raum');
  if (m?.t !== 'raum') return;
  assert.match(m.code, /^\d{4}$/);
  assert.equal(m.rolle, 'gastgeber');
  assert.ok(m.turn?.credential);
  // ohne Raum keine Zugangsdaten: ein Signal ohne Raum ist ungültig
  const b = peer('203.0.113.2');
  h.connect(b);
  send(h, b, { t: 'signal', data: 1 });
  assert.deepEqual(b.last(), { t: 'fehler', grund: 'ungueltig' });
});

test('Codes sind eindeutig unter den offenen Räumen', () => {
  const h = hub({ codes: ['0042', '0042', '0042', '0777'] });
  const a = peer('198.51.100.1');
  const b = peer('198.51.100.2');
  h.connect(a);
  h.connect(b);
  send(h, a, { t: 'oeffnen' });
  send(h, b, { t: 'oeffnen' });
  assert.equal((a.last() as { code: string }).code, '0042');
  assert.equal((b.last() as { code: string }).code, '0777');
});

test('Beitreten mit Code: beide erfahren vom Partner, Signale gehen nur an den anderen', () => {
  const h = hub({ codes: ['1234'] });
  const a = peer('198.51.100.1');
  const b = peer('198.51.100.2');
  h.connect(a);
  h.connect(b);
  send(h, a, { t: 'oeffnen' });
  send(h, b, { t: 'beitreten', code: '1234' });
  assert.deepEqual(b.got[0], { t: 'raum', code: '1234', rolle: 'gast', turn: null });
  assert.deepEqual(b.last(), { t: 'partner', da: true });
  assert.deepEqual(a.last(), { t: 'partner', da: true });
  send(h, a, { t: 'signal', data: { sdp: 'angebot' } });
  assert.deepEqual(b.last(), { t: 'signal', data: { sdp: 'angebot' } });
  send(h, b, { t: 'signal', data: { ice: 'x' } });
  assert.deepEqual(a.last(), { t: 'signal', data: { ice: 'x' } });
});

test('Unbekannter Code, voller Raum und kaputte Nachrichten werden abgelehnt', () => {
  const h = hub({ codes: ['1234'] });
  const [a, b, c] = [peer('1.1.1.1'), peer('2.2.2.2'), peer('3.3.3.3')];
  for (const p of [a, b, c]) h.connect(p);
  send(h, a, { t: 'oeffnen' });
  send(h, b, { t: 'beitreten', code: '9999' });
  assert.deepEqual(b.last(), { t: 'fehler', grund: 'code-unbekannt' });
  send(h, b, { t: 'beitreten', code: '12345' });
  assert.deepEqual(b.last(), { t: 'fehler', grund: 'code-unbekannt' });
  send(h, b, { t: 'beitreten', code: '1234' });
  send(h, c, { t: 'beitreten', code: '1234' });
  assert.deepEqual(c.last(), { t: 'fehler', grund: 'raum-voll' });
  h.message(c, '{kaputt');
  assert.deepEqual(c.last(), { t: 'fehler', grund: 'ungueltig' });
  send(h, c, { t: 'was' });
  assert.deepEqual(c.last(), { t: 'fehler', grund: 'ungueltig' });
  h.message(c, 'x'.repeat(20_000));
  assert.deepEqual(c.last(), { t: 'fehler', grund: 'zu-gross' });
});

test('Gast geht: Raum bleibt für den Wiederbeitritt; Gastgeber geht: Raum schließt', () => {
  const h = hub({ codes: ['1234'] });
  const [a, b, b2] = [peer('1.1.1.1'), peer('2.2.2.2'), peer('2.2.2.2')];
  for (const p of [a, b, b2]) h.connect(p);
  send(h, a, { t: 'oeffnen' });
  send(h, b, { t: 'beitreten', code: '1234' });
  h.disconnect(b);
  assert.deepEqual(a.last(), { t: 'partner', da: false });
  send(h, b2, { t: 'beitreten', code: '1234' });
  assert.equal(b2.got[0].t, 'raum');
  h.disconnect(a);
  assert.deepEqual(b2.last(), { t: 'partner', da: false });
  assert.ok(b2.closed);
  assert.equal(h.roomCount, 0);
});

test('Räume verfallen nach 30 min ohne Aktivität, Signale und Pings halten sie offen', () => {
  let now = 0;
  const h = hub({ now: () => now, codes: ['1111', '2222'] });
  const [a, b] = [peer('1.1.1.1'), peer('2.2.2.2')];
  h.connect(a);
  h.connect(b);
  send(h, a, { t: 'oeffnen' });
  send(h, b, { t: 'oeffnen' });
  now = ROOM_IDLE_MS - 1000;
  send(h, b, { t: 'ping' });
  now = ROOM_IDLE_MS + 1;
  h.sweep();
  assert.deepEqual(a.last(), { t: 'fehler', grund: 'verfallen' });
  assert.ok(a.closed);
  assert.equal(h.roomCount, 1);
  assert.ok(!b.closed);
});

test('Begrenzung: höchstens 3 offene Räume je IP', () => {
  const h = hub();
  const ps = Array.from({ length: LIMITS.roomsPerIp + 1 }, () => peer('9.9.9.9'));
  for (const p of ps) {
    h.connect(p);
    send(h, p, { t: 'oeffnen' });
  }
  assert.equal(h.roomCount, LIMITS.roomsPerIp);
  assert.deepEqual(ps.at(-1)!.last(), { t: 'fehler', grund: 'zu-viele-raeume' });
  // eine andere IP darf weiter öffnen
  const other = peer('8.8.8.8');
  h.connect(other);
  send(h, other, { t: 'oeffnen' });
  assert.equal(other.last()?.t, 'raum');
});

test('Begrenzung: Beitrittsversuche je IP gegen Code-Raten', () => {
  let now = 0;
  const h = hub({ now: () => now });
  const raten = peer('7.7.7.7');
  h.connect(raten);
  for (let i = 0; i < LIMITS.joinsPerIp.max; i++) {
    // ein frischer Socket je Versuch hilft nicht – gezählt wird je IP
    const p = peer('7.7.7.7');
    send(h, p, { t: 'beitreten', code: String(i).padStart(4, '0') });
    assert.deepEqual(p.last(), { t: 'fehler', grund: 'code-unbekannt' });
  }
  send(h, raten, { t: 'beitreten', code: '0000' });
  assert.deepEqual(raten.last(), { t: 'fehler', grund: 'zu-viele-versuche' });
  now = LIMITS.joinsPerIp.windowMs;
  send(h, raten, { t: 'beitreten', code: '0000' });
  assert.deepEqual(raten.last(), { t: 'fehler', grund: 'code-unbekannt' });
});

test('Begrenzung: gleichzeitige Verbindungen und Nachrichten je Verbindung', () => {
  const h = hub();
  const ps = Array.from({ length: LIMITS.socketsPerIp }, () => peer('6.6.6.6'));
  for (const p of ps) assert.ok(h.connect(p));
  assert.equal(h.connect(peer('6.6.6.6')), false);
  h.disconnect(ps[0]);
  assert.ok(h.connect(peer('6.6.6.6')));

  const p = ps[1];
  for (let i = 0; i < LIMITS.messagesPerSocket.max; i++) send(h, p, { t: 'ping' });
  send(h, p, { t: 'ping' });
  assert.deepEqual(p.last(), { t: 'fehler', grund: 'zu-viele-versuche' });
});

test('IP einer Upgrade-Anfrage: letzter Eintrag von X-Forwarded-For (Caddy)', () => {
  const req = (xff?: string) => ({ headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress: '172.18.0.3' } }) as never;
  assert.equal(upgradeIp(req('1.2.3.4, 5.6.7.8')), '5.6.7.8');
  assert.equal(upgradeIp(req()), '172.18.0.3');
});

test('WebSocket /api/raum: zwei Browser verbinden sich über die echte App', async () => {
  const fakeDb = { ping: async () => {}, recordEvent: async () => {}, statistics: async () => ({ days: [], levels: [] }) };
  const app = buildApp({ version: 't', db: fakeDb, raum: new RoomHub({ code: () => '4321', turn: { secret: 's', urls: ['turn:t'] } }) });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const port = (app.server.address() as { port: number }).port;
  const open = (path = '/api/raum') =>
    new Promise<{ ws: WebSocket; next: () => Promise<ServerMessage> }>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
      const queue: ServerMessage[] = [];
      const waiting: ((m: ServerMessage) => void)[] = [];
      ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data));
        const w = waiting.shift();
        if (w) w(m);
        else queue.push(m);
      };
      ws.onopen = () => resolve({ ws, next: () => (queue.length ? Promise.resolve(queue.shift()!) : new Promise((r) => waiting.push(r))) });
      ws.onerror = () => reject(new Error('keine Verbindung'));
    });
  try {
    const a = await open();
    a.ws.send(JSON.stringify({ t: 'oeffnen' }));
    const raum = await a.next();
    assert.equal(raum.t, 'raum');
    assert.equal((raum as { code: string }).code, '4321');
    const b = await open();
    b.ws.send(JSON.stringify({ t: 'beitreten', code: '4321' }));
    assert.equal((await b.next()).t, 'raum');
    assert.deepEqual(await b.next(), { t: 'partner', da: true });
    assert.deepEqual(await a.next(), { t: 'partner', da: true });
    a.ws.send(JSON.stringify({ t: 'signal', data: { typ: 'angebot' } }));
    assert.deepEqual(await b.next(), { t: 'signal', data: { typ: 'angebot' } });
    a.ws.close();
    b.ws.close();
    // ein anderer Pfad bekommt kein Upgrade
    await assert.rejects(open('/api/anders'));
  } finally {
    await app.close();
  }
});
