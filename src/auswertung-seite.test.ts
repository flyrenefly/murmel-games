import { describe, expect, it } from 'vitest';
import { type LevelCounts, paketQuoten, schwersteLevels } from './auswertung-seite';

const l = (pack: string, level: string, geloest: number, neustart: number, abbruch: number, over: Partial<LevelCounts> = {}): LevelCounts => ({
  pack,
  level,
  gestartet: geloest + neustart + abbruch,
  geloest,
  neustart,
  abbruch,
  abstuerze: 0,
  zeitGeloest: [0, 0, 0, 0, 0],
  zeitAbbruch: [0, 0, 0, 0, 0],
  ...over,
});

describe('Auswertung auf der Statistikseite', () => {
  it('sortiert die schwersten Levels nach Lösungsquote und lässt seltene weg', () => {
    const out = schwersteLevels([
      l('murmel', 'leicht', 9, 1, 0),
      l('murmel', 'schwer', 1, 6, 3, { abstuerze: 20, zeitGeloest: [0, 0, 0, 1, 0] }),
      l('enigma_i', 'selten', 0, 2, 2),
      l('enigma_i', 'mittel', 5, 3, 2),
    ]);
    expect(out.map((x) => x.level)).toEqual(['schwer', 'mittel', 'leicht']);
    expect(out[0]).toEqual({ pack: 'murmel', level: 'schwer', laeufe: 10, geloest: 0.1, neustartsJeLauf: 0.6, abbrueche: 3, abstuerzeJeLauf: 2, typischeZeit: '10–30 min' });
    expect(out[1].typischeZeit).toBeNull();
  });

  it('begrenzt auf n Levels', () => {
    const many = Array.from({ length: 30 }, (_, i) => l('p', `l${String(i).padStart(2, '0')}`, i % 5, 5, 0));
    expect(schwersteLevels(many, 5, 20)).toHaveLength(20);
  });

  it('rechnet Abbruchquoten je Paket, höchste zuerst', () => {
    expect(paketQuoten([l('a', '1', 8, 0, 2), l('a', '2', 0, 0, 0), l('b', '1', 1, 1, 2), l('c', '1', 0, 0, 0)])).toEqual([
      { pack: 'b', laeufe: 4, geloest: 0.25, abbruch: 0.5 },
      { pack: 'a', laeufe: 10, geloest: 0.8, abbruch: 0.2 },
    ]);
  });
});
