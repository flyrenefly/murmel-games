import { describe, expect, it } from 'vitest';
import { Auswertung, type AuswertungEnv, zeitklasse } from './auswertung';
import { statsAllowed } from './stats';

function env(over: Partial<AuswertungEnv> = {}) {
  const sent: unknown[] = [];
  const e: AuswertungEnv & { sent: unknown[]; online: boolean } = {
    sent,
    online: true,
    erlaubt: () => true,
    istOnline() {
      return this.online;
    },
    senden: (url, body) => {
      expect(url).toBe('/api/auswertung');
      sent.push(JSON.parse(body));
      return true;
    },
    ...over,
  };
  return e;
}

describe('Auswertung (docs/SPEC-auswertung.md)', () => {
  it('ordnet Spielzeiten den fünf Zeitklassen zu', () => {
    expect([0, 59.9, 60, 179, 180, 599, 600, 1799, 1800, 99999].map(zeitklasse)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('zählt Läufe je Paket und Level und sendet sie gebündelt', () => {
    const e = env();
    const a = new Auswertung(e);
    a.start('murmel', '01');
    a.ende('murmel', '01', 'neustart', 30, 2);
    a.start('murmel', '01');
    a.ende('murmel', '01', 'geloest', 200, 1);
    a.start('enigma_i', 'enigma:a');
    a.ende('enigma_i', 'enigma:a', 'abbruch', 700, 0);
    expect(e.sent).toEqual([]);
    expect(a.senden()).toBe(true);
    expect(e.sent).toEqual([
      {
        levels: [
          { pack: 'murmel', level: '01', gestartet: 2, geloest: 1, neustart: 1, abbruch: 0, abstuerze: 3, zeitGeloest: [0, 0, 1, 0, 0], zeitAbbruch: [0, 0, 0, 0, 0] },
          { pack: 'enigma_i', level: 'enigma:a', gestartet: 1, geloest: 0, neustart: 0, abbruch: 1, abstuerze: 0, zeitGeloest: [0, 0, 0, 0, 0], zeitAbbruch: [0, 0, 0, 1, 0] },
        ],
      },
    ]);
    // the buffer is empty afterwards: nothing is sent twice
    expect(a.senden()).toBe(false);
    expect(e.sent).toHaveLength(1);
  });

  it('enthält im Bündel weder Zeit noch Kennung', () => {
    const e = env();
    const a = new Auswertung(e);
    a.start('murmel', '01');
    a.senden();
    expect(Object.keys(e.sent[0] as object)).toEqual(['levels']);
  });

  it('puffert offline und sendet beim Wiederverbinden', () => {
    const e = env();
    e.online = false;
    const a = new Auswertung(e);
    a.start('murmel', '01');
    expect(a.senden()).toBe(false);
    a.start('murmel', '01');
    e.online = true;
    expect(a.senden()).toBe(true);
    expect((e.sent[0] as { levels: { gestartet: number }[] }).levels[0].gestartet).toBe(2);
  });

  it('behält den Puffer, wenn der Browser das Senden ablehnt oder wirft', () => {
    let ok: boolean | 'wirft' = false;
    const sent: unknown[] = [];
    const a = new Auswertung(
      env({
        senden: (_u, b) => {
          if (ok === 'wirft') throw new Error('blocked');
          if (ok) sent.push(JSON.parse(b));
          return ok;
        },
      }),
    );
    a.start('murmel', '01');
    expect(a.senden()).toBe(false);
    ok = 'wirft';
    expect(() => a.senden()).not.toThrow();
    ok = true;
    expect(a.senden()).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('sendet von selbst nach 20 beendeten Läufen', () => {
    const e = env();
    const a = new Auswertung(e);
    for (let i = 0; i < 19; i++) a.ende('murmel', '01', 'neustart', 5, 0);
    expect(e.sent).toHaveLength(0);
    a.ende('murmel', '01', 'neustart', 5, 0);
    expect(e.sent).toHaveLength(1);
  });

  it('teilt mehr als 50 Levels auf mehrere Sendungen', () => {
    const e = env();
    const a = new Auswertung(e);
    for (let i = 0; i < 120; i++) a.start('p', `l${i}`);
    a.senden();
    expect(e.sent.map((s) => (s as { levels: unknown[] }).levels.length)).toEqual([50, 50, 20]);
  });

  it('zählt nichts, wenn die Statistik aus ist, und keine Levels aus Links oder mit fremden Zeichen', () => {
    const e = env({ erlaubt: () => false });
    const a = new Auswertung(e);
    a.start('murmel', '01');
    expect(a.senden()).toBe(false);
    const f = env();
    const b = new Auswertung(f);
    b.start('link', 'link:0a1b');
    b.start('murmel', 'böse<script>');
    expect(b.senden()).toBe(false);
    expect(f.sent).toEqual([]);
  });

  it('verwirft den Puffer, wenn die Statistik inzwischen abgeschaltet wurde', () => {
    let an = true;
    const e = env({ erlaubt: () => an });
    const a = new Auswertung(e);
    a.start('murmel', '01');
    an = false;
    expect(a.senden()).toBe(false);
    an = true;
    expect(a.senden()).toBe(false);
    expect(e.sent).toEqual([]);
  });

  it('kappt Zähler auf die Obergrenzen des Servers', () => {
    const e = env();
    const a = new Auswertung(e);
    for (let i = 0; i < 19; i++) a.ende('murmel', '01', 'neustart', 5, 5000);
    a.senden();
    const l = (e.sent[0] as { levels: { abstuerze: number }[] }).levels[0];
    expect(l.abstuerze).toBe(10_000);
  });
});

describe('Schalter „Anonyme Statistik senden“', () => {
  it('schaltet die ganze Spielstatistik ab', () => {
    expect(statsAllowed({ hostname: 'murmel.games', statistikAus: true })).toBe(false);
    expect(statsAllowed({ hostname: 'murmel.games', statistikAus: false })).toBe(true);
  });
});
