/**
 * Auswertung (docs/SPEC-auswertung.md): where players fail or give up. Counts runs per pack and level –
 * started, solved, restarted, abandoned, falls and a rough time class – only in the memory of the open
 * page, and sends them as one bundle without time or id to POST /api/auswertung. No storage on the
 * device; whatever was collected offline goes out once the browser is online again.
 */
import { browserEnv, statsAllowed } from './stats';

/** How a run ended: won, the same level loaded again, or another level / the page left. */
export type Ende = 'geloest' | 'neustart' | 'abbruch';

export interface Zaehler {
  pack: string;
  level: string;
  gestartet: number;
  geloest: number;
  neustart: number;
  abbruch: number;
  abstuerze: number;
  zeitGeloest: number[];
  zeitAbbruch: number[];
}

export interface AuswertungEnv {
  /** Statistics allowed: not in development, no Do Not Track / GPC, switch on. */
  erlaubt(): boolean;
  istOnline(): boolean;
  /** sendBeacon: true when the browser took the request. */
  senden(url: string, body: string): boolean;
}

/** Upper bounds of the time classes in seconds of play: < 1, 3, 10, 30 min, and above. */
const GRENZEN = [60, 180, 600, 1800];
/** The server's limits per bundle (server/src/auswertung.ts). */
const MAX_LEVELS = 50;
const MAX_ZAHL = 500;
const MAX_ABSTUERZE = 10_000;
/** Ended runs after which the buffer goes out by itself. */
const BUENDEL = 20;
/** Level and pack ids as the server takes them (server/src/stats.ts LEVEL_ID). */
const ID = /^[A-Za-z0-9 _:./'()!,&+-]{1,100}$/;

export function zeitklasse(sekunden: number): number {
  const i = GRENZEN.findIndex((g) => sekunden < g);
  return i < 0 ? GRENZEN.length : i;
}

const leer = (pack: string, level: string): Zaehler => ({ pack, level, gestartet: 0, geloest: 0, neustart: 0, abbruch: 0, abstuerze: 0, zeitGeloest: [0, 0, 0, 0, 0], zeitAbbruch: [0, 0, 0, 0, 0] });

function gekappt(z: Zaehler): Zaehler {
  const k = (n: number) => Math.min(n, MAX_ZAHL);
  return {
    ...z,
    gestartet: k(z.gestartet),
    geloest: k(z.geloest),
    neustart: k(z.neustart),
    abbruch: k(z.abbruch),
    abstuerze: Math.min(z.abstuerze, MAX_ABSTUERZE),
    zeitGeloest: z.zeitGeloest.map(k),
    zeitAbbruch: z.zeitAbbruch.map(k),
  };
}

export class Auswertung {
  private puffer = new Map<string, Zaehler>();
  private beendet = 0;
  private readonly env: AuswertungEnv;

  constructor(env: AuswertungEnv) {
    this.env = env;
  }

  private zaehler(pack: string, level: string): Zaehler | null {
    if (pack === 'link' || level.startsWith('link:') || !ID.test(pack) || !ID.test(level) || !this.env.erlaubt()) return null;
    const key = `${pack}\n${level}`;
    let z = this.puffer.get(key);
    if (!z) this.puffer.set(key, (z = leer(pack, level)));
    return z;
  }

  /** A run played its first step. */
  start(pack: string, level: string): void {
    const z = this.zaehler(pack, level);
    if (z) z.gestartet++;
  }

  /** A run ended; `sekunden`: play time without pauses. */
  ende(pack: string, level: string, art: Ende, sekunden: number, abstuerze: number): void {
    const z = this.zaehler(pack, level);
    if (!z) return;
    z[art]++;
    z.abstuerze += Math.max(0, Math.trunc(abstuerze));
    if (art === 'geloest') z.zeitGeloest[zeitklasse(sekunden)]++;
    if (art === 'abbruch') z.zeitAbbruch[zeitklasse(sekunden)]++;
    if (++this.beendet >= BUENDEL) this.senden();
  }

  /** Sends the buffer (nothing, and it is emptied, when statistics are off by now) in bundles of at most 50 levels; false when there was nothing or it stays for later. */
  senden(): boolean {
    // switched off meanwhile: what was collected is dropped, not sent
    if (this.puffer.size && !this.env.erlaubt()) this.puffer.clear();
    if (!this.puffer.size || !this.env.istOnline()) return false;
    const eintraege = [...this.puffer.entries()];
    let gesendet = false;
    for (let i = 0; i < eintraege.length; i += MAX_LEVELS) {
      const teil = eintraege.slice(i, i + MAX_LEVELS);
      let ok = false;
      try {
        ok = this.env.senden('/api/auswertung', JSON.stringify({ levels: teil.map(([, z]) => gekappt(z)) }));
      } catch {
        // statistics never disturb the game
      }
      if (!ok) break;
      for (const [k] of teil) this.puffer.delete(k);
      gesendet = true;
    }
    if (!this.puffer.size) this.beendet = 0;
    return gesendet;
  }
}

/** The browser's version: sendBeacon with JSON, the switch and the opt-outs of the statistics. */
export function browserAuswertung(): Auswertung {
  return new Auswertung({
    erlaubt: () => statsAllowed(browserEnv()),
    istOnline: () => navigator.onLine !== false,
    senden: (url, body) => navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' })) ?? false,
  });
}
