#!/usr/bin/env node
// Prüft unseren TURN-Server von außen (docs/SPEC-mehrspieler.md): STUN-Antwort auf 3478/udp,
// TCP-Verbindung auf 3478/tcp, und ein echtes Relay: Allocate mit Zugangsdaten, Permission für die
// eigene Adresse, dann ein UDP-Paket von außen an die Relay-Adresse (Port 49160–49200), das als
// Data-Indication zurückkommen muss.
//
// Zugangsdaten kommen über stdin (Zeile 1 Benutzername, Zeile 2 Passwort), damit sie nirgends
// angezeigt werden – z. B. direkt aus der API-Rechnung auf dem Server:
//   ssh murmel@HOST 'cd /opt/murmel && . ./.env && u="$(($(date +%s)+600)):probe" && \
//     printf "%s\n%s\n" "$u" "$(printf %s "$u" | openssl dgst -sha1 -hmac "$TURN_SECRET" -binary | base64)"' \
//   | node tools/turn-probe.mjs murmel.games
import { createHash, createHmac, randomBytes } from 'node:crypto';
import dgram from 'node:dgram';
import net from 'node:net';

const host = process.argv[2] ?? 'murmel.games';
const port = 3478;
const MAGIC = 0x2112a442;

const attr = (type, value) => {
  const pad = (4 - (value.length % 4)) % 4;
  const b = Buffer.alloc(4 + value.length + pad);
  b.writeUInt16BE(type, 0);
  b.writeUInt16BE(value.length, 2);
  value.copy(b, 4);
  return b;
};
function message(type, attrs, key) {
  const tid = randomBytes(12);
  let body = Buffer.concat(attrs);
  const head = (len) => {
    const h = Buffer.alloc(20);
    h.writeUInt16BE(type, 0);
    h.writeUInt16BE(len, 2);
    h.writeUInt32BE(MAGIC, 4);
    tid.copy(h, 8);
    return h;
  };
  if (key) {
    const mi = createHmac('sha1', key).update(Buffer.concat([head(body.length + 24), body])).digest();
    body = Buffer.concat([body, attr(0x0008, mi)]);
  }
  return { tid, buf: Buffer.concat([head(body.length), body]) };
}
function parse(buf) {
  const type = buf.readUInt16BE(0);
  const len = buf.readUInt16BE(2);
  const tid = buf.subarray(8, 20);
  const attrs = new Map();
  for (let o = 20; o < 20 + len; ) {
    const t = buf.readUInt16BE(o);
    const l = buf.readUInt16BE(o + 2);
    attrs.set(t, buf.subarray(o + 4, o + 4 + l));
    o += 4 + l + ((4 - (l % 4)) % 4);
  }
  return { type, tid, attrs };
}
function xorAddr(v) {
  const p = v.readUInt16BE(2) ^ (MAGIC >>> 16);
  const ip = [0, 1, 2, 3].map((i) => v[4 + i] ^ ((MAGIC >>> (24 - 8 * i)) & 0xff)).join('.');
  return { ip, port: p };
}
function xorAttr(ip, p) {
  const b = Buffer.alloc(8);
  b[1] = 1;
  b.writeUInt16BE(p ^ (MAGIC >>> 16), 2);
  ip.split('.').forEach((n, i) => (b[4 + i] = Number(n) ^ ((MAGIC >>> (24 - 8 * i)) & 0xff)));
  return b;
}

const sock = dgram.createSocket('udp4');
const inbox = [];
let waiter = null;
sock.on('message', (m) => {
  if (waiter) waiter(m);
  else inbox.push(m);
});
const next = (ms = 3000) =>
  inbox.length
    ? Promise.resolve(inbox.shift())
    : new Promise((resolve, reject) => {
        const t = setTimeout(() => ((waiter = null), reject(new Error('keine Antwort'))), ms);
        waiter = (m) => ((waiter = null), clearTimeout(t), resolve(m));
      });
const request = async (msg) => {
  sock.send(msg.buf, port, host);
  for (;;) {
    const r = parse(await next());
    if (r.tid.equals(msg.tid)) return r;
  }
};

const results = [];
const ok = (name, pass, info = '') => (results.push(pass), console.log(`${pass ? 'OK  ' : 'FEHL'} ${name}${info ? ` – ${info}` : ''}`));

// 1. STUN binding (ohne Zugang)
try {
  const r = await request(message(0x0001, []));
  const mapped = r.attrs.get(0x0020);
  ok('3478/udp antwortet (STUN)', r.type === 0x0101, mapped ? `eigene Adresse ${xorAddr(mapped).ip}` : '');
} catch (e) {
  ok('3478/udp antwortet (STUN)', false, e.message);
}

// 2. TCP
await new Promise((resolve) => {
  const s = net.connect({ host, port, timeout: 3000 });
  s.on('connect', () => (ok('3478/tcp erreichbar', true), s.destroy(), resolve()));
  s.on('timeout', () => (ok('3478/tcp erreichbar', false, 'Zeitüberschreitung'), s.destroy(), resolve()));
  s.on('error', (e) => (ok('3478/tcp erreichbar', false, e.message), resolve()));
});

// 3. Relay mit Zugangsdaten von stdin
const stdin = process.stdin.isTTY ? '' : await new Promise((r) => {
  let d = '';
  process.stdin.on('data', (c) => (d += c)).on('end', () => r(d));
});
const [username, password] = stdin.split(/\r?\n/);
if (!username || !password) {
  console.log('(keine Zugangsdaten auf stdin: Relay-Prüfung übersprungen)');
} else {
  try {
    const transport = attr(0x0019, Buffer.from([17, 0, 0, 0]));
    const first = await request(message(0x0003, [transport]));
    const realm = first.attrs.get(0x0014);
    const nonce = first.attrs.get(0x0015);
    if (first.type !== 0x0113 || !realm || !nonce) throw new Error(`unerwartete Antwort ${first.type.toString(16)}`);
    const key = createHash('md5').update(`${username}:${realm.toString()}:${password}`).digest();
    const auth = [attr(0x0006, Buffer.from(username)), attr(0x0014, realm), attr(0x0015, nonce)];
    const alloc = await request(message(0x0003, [transport, ...auth], key));
    if (alloc.type !== 0x0103) {
      const err = alloc.attrs.get(0x0009);
      throw new Error(`Allocate abgelehnt ${err ? err[2] * 100 + err[3] : ''} ${err ? err.subarray(4).toString() : ''}`);
    }
    const relay = xorAddr(alloc.attrs.get(0x0016));
    const mine = xorAddr(alloc.attrs.get(0x0020));
    ok('Allocate mit Zugangsdaten', true, `Relay-Port ${relay.port}`);
    ok('Relay-Port im Bereich 49160–49200', relay.port >= 49160 && relay.port <= 49200, String(relay.port));
    const perm = await request(message(0x0008, [attr(0x0012, xorAttr(mine.ip, 0)), ...auth], key));
    ok('CreatePermission', perm.type === 0x0108);
    // Ein zweiter Socket schickt von außen an die Relay-Adresse; der TURN-Server reicht es als Data-Indication durch.
    const other = dgram.createSocket('udp4');
    const payload = Buffer.from(`murmel-${randomBytes(4).toString('hex')}`);
    other.send(payload, relay.port, relay.ip === '0.0.0.0' ? host : relay.ip);
    let got = false;
    const end = Date.now() + 3000;
    while (!got && Date.now() < end) {
      try {
        const m = parse(await next(end - Date.now()));
        got = m.type === 0x0017 && !!m.attrs.get(0x0013)?.equals(payload);
      } catch {
        break;
      }
    }
    other.close();
    ok(`UDP von außen an Relay ${relay.ip}:${relay.port} kommt durch`, got);
    await request(message(0x0004, [attr(0x000d, Buffer.from([0, 0, 0, 0])), ...auth], key)).catch(() => {});
  } catch (e) {
    ok('Relay', false, e.message);
  }
}
sock.close();
process.exit(results.every(Boolean) ? 0 : 1);
