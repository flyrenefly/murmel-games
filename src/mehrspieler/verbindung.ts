// The connection of two players (docs/SPEC-mehrspieler.md 5.1): a room on our server
// (WebSocket /api/raum) hands over the WebRTC handshake; the data channel then runs only through
// our TURN server (iceTransportPolicy 'relay'), so neither browser learns the other's IP address.
import { encode, type Nachricht, parseNachricht } from './nachrichten';

export type Rolle = 'gastgeber' | 'gast';
export type Status = 'getrennt' | 'raum' | 'verbinde' | 'verbunden' | 'abgebrochen';

interface TurnDaten {
  urls: string[];
  username: string;
  credential: string;
}
type ServerNachricht =
  | { t: 'raum'; code: string; rolle: Rolle; turn: TurnDaten | null }
  | { t: 'partner'; da: boolean }
  | { t: 'signal'; data: Signal }
  | { t: 'fehler'; grund: string };
type Signal = { typ: 'angebot' | 'antwort'; sdp: string } | { typ: 'ice'; c: RTCIceCandidateInit } | { typ: 'neu' };

export const FEHLERTEXT: Record<string, string> = {
  'code-unbekannt': 'Diesen Code gibt es nicht. Prüfe die vier Ziffern.',
  'raum-voll': 'In diesem Raum spielen schon zwei.',
  'zu-viele-raeume': 'Du hast schon mehrere Räume offen. Schließe einen und versuche es erneut.',
  'zu-viele-versuche': 'Zu viele Versuche. Warte ein paar Minuten.',
  verfallen: 'Der Raum ist nach 30 Minuten ohne Aktivität verfallen.',
  'kein-turn': 'Der Verbindungsserver ist gerade nicht erreichbar.',
  'kein-server': 'Keine Verbindung zum Server. Bist du online?',
};

export interface VerbindungOptionen {
  /** WebSocket address of the room service. */
  url?: string;
  /** Dev server only: without TURN data connect directly (two tabs on one computer). */
  ohneTurnErlaubt?: boolean;
}

export class Verbindung {
  status: Status = 'getrennt';
  rolle: Rolle | null = null;
  code = '';
  /** Partner is in the room (server side). */
  partnerDa = false;
  onStatus: (s: Status) => void = () => {};
  onNachricht: (n: Nachricht) => void = () => {};
  onFehler: (grund: string) => void = () => {};
  onPartner: (da: boolean) => void = () => {};

  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private turn: TurnDaten | null = null;
  private ice: RTCIceCandidateInit[] = [];
  private ping = 0;
  private wackel = 0;
  private readonly url: string;
  private readonly ohneTurn: boolean;

  constructor(opts: VerbindungOptionen = {}) {
    this.url = opts.url ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/raum`;
    this.ohneTurn = opts.ohneTurnErlaubt ?? false;
  }

  /** Opens a room; resolves with the 4-digit code. */
  oeffnen(): Promise<string> {
    return this.raum({ t: 'oeffnen' });
  }

  /** Joins the room with this code. */
  beitreten(code: string): Promise<string> {
    return this.raum({ t: 'beitreten', code });
  }

  senden(n: Nachricht): void {
    if (this.dc?.readyState === 'open') this.dc.send(encode(n));
  }

  /** After a break: same room if it still exists (new handshake), else rejoin or a new room. */
  async neuVerbinden(): Promise<void> {
    this.schliessePeer();
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (this.rolle === 'gastgeber') {
        if (this.partnerDa) void this.angebot();
      } else this.signal({ typ: 'neu' });
      this.setStatus(this.partnerDa ? 'verbinde' : 'raum');
      return;
    }
    if (this.rolle === 'gast' && this.code) await this.beitreten(this.code);
    else await this.oeffnen();
  }

  verlassen(): void {
    this.senden({ t: 'tschuess' });
    this.schliessePeer();
    clearInterval(this.ping);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.rolle = null;
    this.code = '';
    this.partnerDa = false;
    this.setStatus('getrennt');
  }

  private setStatus(s: Status): void {
    if (this.status === s) return;
    this.status = s;
    this.onStatus(s);
  }

  private raum(erste: object): Promise<string> {
    this.schliessePeer();
    this.ws?.close();
    return new Promise((resolve, reject) => {
      let fertig = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify(erste));
      ws.onmessage = (e) => {
        let m: ServerNachricht;
        try {
          m = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (m.t === 'raum') {
          if (!m.turn && !this.ohneTurn) {
            fertig = true;
            reject(new Error('kein-turn'));
            ws.close();
            return;
          }
          this.turn = m.turn;
          this.rolle = m.rolle;
          this.code = m.code;
          fertig = true;
          this.setStatus('raum');
          resolve(m.code);
        } else if (m.t === 'fehler') {
          if (!fertig) {
            fertig = true;
            reject(new Error(m.grund));
            ws.close();
          } else this.onFehler(m.grund);
        } else if (m.t === 'partner') {
          this.partnerDa = m.da;
          this.onPartner(m.da);
          if (m.da && this.rolle === 'gastgeber') void this.angebot();
          if (!m.da) {
            this.schliessePeer();
            this.setStatus(this.rolle === 'gastgeber' ? 'raum' : 'abgebrochen');
          }
        } else if (m.t === 'signal') void this.signalEmpfangen(m.data);
      };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        clearInterval(this.ping);
        if (!fertig) {
          fertig = true;
          reject(new Error('kein-server'));
          return;
        }
        // the data channel may still run; the room is needed only for a new handshake
        if (this.status !== 'verbunden') this.setStatus('abgebrochen');
      };
      // keeps the room alive while playing (rooms expire after 30 min without activity)
      clearInterval(this.ping);
      this.ping = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'ping' }));
      }, 4 * 60_000);
    });
  }

  private signal(data: Signal): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'signal', data }));
  }

  private peer(): RTCPeerConnection {
    this.schliessePeer();
    // Only our TURN server, only relayed candidates: the partner never sees this browser's address.
    const config: RTCConfiguration = this.turn
      ? { iceServers: [{ urls: this.turn.urls, username: this.turn.username, credential: this.turn.credential }], iceTransportPolicy: 'relay' }
      : { iceServers: [], iceTransportPolicy: 'all' };
    const pc = new RTCPeerConnection(config);
    this.pc = pc;
    this.ice = [];
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal({ typ: 'ice', c: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      clearTimeout(this.wackel);
      if (pc.connectionState === 'failed') this.abgebrochen();
      // 'disconnected' often recovers by itself; give it a few seconds
      else if (pc.connectionState === 'disconnected') this.wackel = window.setTimeout(() => this.pc === pc && this.abgebrochen(), 5000);
    };
    this.setStatus('verbinde');
    return pc;
  }

  private kanal(dc: RTCDataChannel): void {
    this.dc = dc;
    dc.onopen = () => this.setStatus('verbunden');
    dc.onclose = () => {
      if (this.dc === dc) this.abgebrochen();
    };
    dc.onmessage = (e) => {
      const n = parseNachricht(e.data);
      if (n) this.onNachricht(n);
    };
  }

  private abgebrochen(): void {
    this.schliessePeer();
    this.setStatus('abgebrochen');
  }

  private async angebot(): Promise<void> {
    const pc = this.peer();
    this.kanal(pc.createDataChannel('murmel', { ordered: true }));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.signal({ typ: 'angebot', sdp: offer.sdp ?? '' });
  }

  private async signalEmpfangen(s: Signal): Promise<void> {
    if (!s || typeof s !== 'object') return;
    if (s.typ === 'neu') {
      if (this.rolle === 'gastgeber') void this.angebot();
    } else if (s.typ === 'angebot' && this.rolle === 'gast') {
      const pc = this.peer();
      pc.ondatachannel = (e) => this.kanal(e.channel);
      await pc.setRemoteDescription({ type: 'offer', sdp: s.sdp });
      await this.iceNachholen(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.signal({ typ: 'antwort', sdp: answer.sdp ?? '' });
    } else if (s.typ === 'antwort' && this.rolle === 'gastgeber' && this.pc) {
      await this.pc.setRemoteDescription({ type: 'answer', sdp: s.sdp });
      await this.iceNachholen(this.pc);
    } else if (s.typ === 'ice') {
      if (this.pc?.remoteDescription) await this.pc.addIceCandidate(s.c).catch(() => {});
      else this.ice.push(s.c);
    }
  }

  private async iceNachholen(pc: RTCPeerConnection): Promise<void> {
    for (const c of this.ice.splice(0)) await pc.addIceCandidate(c).catch(() => {});
  }

  private schliessePeer(): void {
    clearTimeout(this.wackel);
    const { dc, pc } = this;
    this.dc = null;
    this.pc = null;
    dc?.close();
    pc?.close();
  }
}
