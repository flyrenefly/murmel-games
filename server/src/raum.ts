import { createHmac, randomBytes, randomInt } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import { RateLimit } from './limit.ts';

/**
 * Zu zweit spielen (docs/SPEC-mehrspieler.md): rooms with a 4-digit code and the relay of the
 * WebRTC handshake (SDP/ICE) between the two browsers. Everything lives in memory only.
 */

export const ROOM_IDLE_MS = 30 * 60_000;
export const TURN_TTL_S = 3600;
export const MAX_MESSAGE_BYTES = 16 * 1024;
export const LIMITS = {
  roomsPerIp: 3,
  opensPerIp: { max: 30, windowMs: 10 * 60_000 },
  joinsPerIp: { max: 20, windowMs: 10 * 60_000 },
  socketsPerIp: 6,
  totalRooms: 2000,
  messagesPerSocket: { max: 50, windowMs: 10_000 },
};

export interface TurnConfig {
  secret: string;
  urls: string[];
}

export interface TurnCredentials {
  urls: string[];
  username: string;
  credential: string;
  ttl: number;
}

/** TURN REST credentials (coturn use-auth-secret): username = expiry:id, credential = base64(HMAC-SHA1(secret, username)). */
export function turnCredentials(turn: TurnConfig, nowMs: number, id: string = randomBytes(6).toString('hex'), ttl = TURN_TTL_S): TurnCredentials {
  const username = `${Math.floor(nowMs / 1000) + ttl}:${id}`;
  const credential = createHmac('sha1', turn.secret).update(username).digest('base64');
  return { urls: turn.urls, username, credential, ttl };
}

/** TURN_URLS from the environment, else the two ports of our coturn at the site address. */
export function turnUrls(env: { TURN_URLS?: string; SITE_ADDRESS?: string; PUBLIC_ORIGIN?: string }): string[] {
  if (env.TURN_URLS) return env.TURN_URLS.split(',').map((s) => s.trim()).filter(Boolean);
  // SITE_ADDRESS may list several addresses for Caddy ("murmel.games, 054heee…"): the first one counts
  const host = env.SITE_ADDRESS?.split(/[\s,]+/).find(Boolean) || (env.PUBLIC_ORIGIN ? new URL(env.PUBLIC_ORIGIN).hostname : 'murmel.games');
  return [`turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`];
}

export type Role = 'gastgeber' | 'gast';
export type ServerMessage =
  | { t: 'raum'; code: string; rolle: Role; turn: TurnCredentials | null }
  | { t: 'partner'; da: boolean }
  | { t: 'signal'; data: unknown }
  | { t: 'fehler'; grund: 'code-unbekannt' | 'raum-voll' | 'zu-viele-raeume' | 'zu-viele-versuche' | 'ungueltig' | 'zu-gross' | 'verfallen' };

/** One connected browser (a WebSocket, or a stand-in in tests). */
export interface Peer {
  readonly ip: string;
  send(msg: ServerMessage): void;
  close(): void;
}

interface Room {
  code: string;
  host: Peer;
  guest: Peer | null;
  lastActive: number;
}

export interface HubOptions {
  turn?: TurnConfig | null;
  now?: () => number;
  /** Random code (tests). */
  code?: () => string;
}

export class RoomHub {
  private readonly rooms = new Map<string, Room>();
  private readonly roomOf = new Map<Peer, Room>();
  private readonly sockets = new Map<string, number>();
  private readonly opens = new RateLimit(LIMITS.opensPerIp.max, LIMITS.opensPerIp.windowMs);
  private readonly joins = new RateLimit(LIMITS.joinsPerIp.max, LIMITS.joinsPerIp.windowMs);
  private readonly messages = new WeakMap<Peer, { start: number; count: number }>();
  private readonly turn: TurnConfig | null;
  private readonly now: () => number;
  private readonly newCode: () => string;

  constructor({ turn = null, now = Date.now, code = () => String(randomInt(10_000)).padStart(4, '0') }: HubOptions = {}) {
    this.turn = turn;
    this.now = now;
    this.newCode = code;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  /** A new connection; false = too many from this IP (the caller closes it). */
  connect(peer: Peer): boolean {
    const n = this.sockets.get(peer.ip) ?? 0;
    if (n >= LIMITS.socketsPerIp) return false;
    this.sockets.set(peer.ip, n + 1);
    return true;
  }

  disconnect(peer: Peer): void {
    const n = (this.sockets.get(peer.ip) ?? 1) - 1;
    if (n > 0) this.sockets.set(peer.ip, n);
    else this.sockets.delete(peer.ip);
    this.leave(peer);
  }

  /** One text message of a browser. */
  message(peer: Peer, raw: string): void {
    const now = this.now();
    if (raw.length > MAX_MESSAGE_BYTES) return peer.send({ t: 'fehler', grund: 'zu-gross' });
    const m = this.messages.get(peer);
    if (!m || now - m.start >= LIMITS.messagesPerSocket.windowMs) this.messages.set(peer, { start: now, count: 1 });
    else if (++m.count > LIMITS.messagesPerSocket.max) return peer.send({ t: 'fehler', grund: 'zu-viele-versuche' });
    let msg: { t?: unknown; code?: unknown; data?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return peer.send({ t: 'fehler', grund: 'ungueltig' });
    }
    if (!msg || typeof msg !== 'object') return peer.send({ t: 'fehler', grund: 'ungueltig' });
    const room = this.roomOf.get(peer);
    switch (msg.t) {
      case 'oeffnen':
        return room ? peer.send({ t: 'fehler', grund: 'ungueltig' }) : this.open(peer, now);
      case 'beitreten':
        return room ? peer.send({ t: 'fehler', grund: 'ungueltig' }) : this.join(peer, msg.code, now);
      case 'signal': {
        if (!room) return peer.send({ t: 'fehler', grund: 'ungueltig' });
        room.lastActive = now;
        const other = room.host === peer ? room.guest : room.host;
        other?.send({ t: 'signal', data: msg.data });
        return;
      }
      case 'ping':
        if (room) room.lastActive = now;
        return;
      default:
        return peer.send({ t: 'fehler', grund: 'ungueltig' });
    }
  }

  private credentials(now: number): TurnCredentials | null {
    return this.turn ? turnCredentials(this.turn, now) : null;
  }

  private open(peer: Peer, now: number): void {
    let mine = 0;
    for (const r of this.rooms.values()) if (r.host.ip === peer.ip) mine++;
    if (mine >= LIMITS.roomsPerIp || this.rooms.size >= LIMITS.totalRooms) return peer.send({ t: 'fehler', grund: 'zu-viele-raeume' });
    if (!this.opens.take(peer.ip, now)) return peer.send({ t: 'fehler', grund: 'zu-viele-versuche' });
    let code = this.newCode();
    for (let i = 0; this.rooms.has(code); i++) {
      if (i > 50) return peer.send({ t: 'fehler', grund: 'zu-viele-raeume' });
      code = this.newCode();
    }
    const room: Room = { code, host: peer, guest: null, lastActive: now };
    this.rooms.set(code, room);
    this.roomOf.set(peer, room);
    peer.send({ t: 'raum', code, rolle: 'gastgeber', turn: this.credentials(now) });
  }

  private join(peer: Peer, code: unknown, now: number): void {
    if (!this.joins.take(peer.ip, now)) return peer.send({ t: 'fehler', grund: 'zu-viele-versuche' });
    if (typeof code !== 'string' || !/^\d{4}$/.test(code)) return peer.send({ t: 'fehler', grund: 'code-unbekannt' });
    const room = this.rooms.get(code);
    if (!room) return peer.send({ t: 'fehler', grund: 'code-unbekannt' });
    if (room.guest) return peer.send({ t: 'fehler', grund: 'raum-voll' });
    room.guest = peer;
    room.lastActive = now;
    this.roomOf.set(peer, room);
    peer.send({ t: 'raum', code, rolle: 'gast', turn: this.credentials(now) });
    peer.send({ t: 'partner', da: true });
    room.host.send({ t: 'partner', da: true });
  }

  /** The host leaving closes the room; the guest leaving keeps it open for a rejoin. */
  private leave(peer: Peer): void {
    const room = this.roomOf.get(peer);
    if (!room) return;
    this.roomOf.delete(peer);
    if (room.host === peer) {
      this.rooms.delete(room.code);
      if (room.guest) {
        this.roomOf.delete(room.guest);
        room.guest.send({ t: 'partner', da: false });
        room.guest.close();
      }
    } else {
      room.guest = null;
      room.lastActive = this.now();
      room.host.send({ t: 'partner', da: false });
    }
  }

  /** Closes rooms idle for 30 min. */
  sweep(): void {
    const now = this.now();
    for (const room of [...this.rooms.values()]) {
      if (now - room.lastActive < ROOM_IDLE_MS) continue;
      this.rooms.delete(room.code);
      for (const p of [room.host, room.guest]) {
        if (!p) continue;
        this.roomOf.delete(p);
        p.send({ t: 'fehler', grund: 'verfallen' });
        p.close();
      }
    }
  }
}

/** Client address of an upgrade request: Caddy is the only hop and appends it to X-Forwarded-For. */
export function upgradeIp(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  const last = (Array.isArray(xff) ? xff.join(',') : (xff ?? '')).split(',').pop()?.trim();
  return last || req.socket.remoteAddress || 'unbekannt';
}

const wsPfade = new WeakMap<object, Set<string>>();

/**
 * Registers a WebSocket path of this app (/api/raum, /api/wettkampf); the returned test tells whether
 * some handler takes a path. Each upgrade handler drops only requests no handler takes.
 */
export function wsPfad(app: FastifyInstance, path: string): (p: string) => boolean {
  let set = wsPfade.get(app.server);
  if (!set) wsPfade.set(app.server, (set = new Set()));
  set.add(path);
  const s = set;
  return (p) => s.has(p);
}

/** GET /api/raum as a WebSocket on the API's HTTP server. */
export function raumRoutes(app: FastifyInstance, hub: RoomHub): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const bekannt = wsPfad(app, '/api/raum');
  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/api/raum') {
      if (!bekannt(path)) socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => attach(ws, upgradeIp(req)));
  };
  const attach = (ws: WebSocket, ip: string) => {
    let alive = true;
    const peer: Peer = {
      ip,
      send: (msg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      close: () => ws.close(1000),
    };
    if (!hub.connect(peer)) {
      ws.send(JSON.stringify({ t: 'fehler', grund: 'zu-viele-versuche' } satisfies ServerMessage));
      ws.close(1008);
      return;
    }
    ws.on('message', (data, binary) => {
      if (binary) return peer.send({ t: 'fehler', grund: 'ungueltig' });
      hub.message(peer, data.toString());
    });
    ws.on('pong', () => (alive = true));
    ws.on('close', () => hub.disconnect(peer));
    ws.on('error', () => ws.terminate());
    (ws as WebSocket & { murmelAlive?: () => boolean }).murmelAlive = () => {
      const was = alive;
      alive = false;
      return was;
    };
  };
  // Dead connections (no pong for 30 s) are dropped; idle rooms expire.
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      const check = (ws as WebSocket & { murmelAlive?: () => boolean }).murmelAlive;
      if (check && !check()) ws.terminate();
      else ws.ping();
    }
    hub.sweep();
  }, 30_000);
  timer.unref();
  app.server.on('upgrade', onUpgrade);
  app.addHook('onClose', async () => {
    clearInterval(timer);
    app.server.off('upgrade', onUpgrade);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  });
}
