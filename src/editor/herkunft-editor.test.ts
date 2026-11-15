// Vorlage/Herkunft in the editor and the publish dialog (docs/SPEC-enigma-upload.md): one line,
// at most 80 characters, empty removes it; old levels and links without it stay as they were.
import { describe, expect, it } from 'vitest';
import { basedOnText, decodeLevel, encodeLevel, MAX_BASED_ON, sanitizeLevel } from './link';
import { fromLevelFile, newLevel, toLevelFile } from './model';
import { basedOnFor } from './publish';

const level = () => {
  const l = newLevel(8, 6);
  l.title = 'Eigenbau';
  return l;
};

describe('Vorlage/Herkunft im Editor', () => {
  it('basedOnText macht eine Zeile mit höchstens 80 Zeichen; Leeres und Fremdes ergibt ""', () => {
    expect(basedOnText('  Ronald\n\tLamprecht\u0000 (GPL)  ')).toBe('Ronald Lamprecht (GPL)');
    expect(basedOnText('ä'.repeat(MAX_BASED_ON + 5))).toBe('ä'.repeat(MAX_BASED_ON));
    // characters, not UTF-16 units: 80 emoji stay 80
    expect([...basedOnText('🙂'.repeat(MAX_BASED_ON + 1))]).toHaveLength(MAX_BASED_ON);
    expect(basedOnText('   ')).toBe('');
    expect(basedOnText(undefined)).toBe('');
    expect(basedOnText(42)).toBe('');
  });

  it('ein selbst gebautes Level trägt die Angabe in Datei, Speicher und Link; leeren entfernt sie', async () => {
    const l = { ...level(), basedOn: 'nach Rätsel  von\nAnna ' };
    const f = toLevelFile(l);
    expect(f.basedOn).toBe('nach Rätsel von Anna');
    expect(fromLevelFile(f).level.basedOn).toBe('nach Rätsel von Anna');
    expect((await decodeLevel(await encodeLevel(f))).basedOn).toBe('nach Rätsel von Anna');
    // what the editor saves always passes the checker, even if typed too long
    expect(sanitizeLevel(toLevelFile({ ...level(), basedOn: 'x'.repeat(200) }), 'x').basedOn).toHaveLength(MAX_BASED_ON);
    const { basedOn: _entfernt, ...leer } = l;
    expect(toLevelFile(leer)).not.toHaveProperty('basedOn');
    expect(toLevelFile({ ...level(), basedOn: '  ' })).not.toHaveProperty('basedOn');
  });

  it('Levels und Links ohne Angabe bleiben unverändert', async () => {
    const f = toLevelFile(level());
    const data = await encodeLevel(f);
    expect(data).toBe(await encodeLevel(toLevelFile(fromLevelFile(f).level)));
    expect(await decodeLevel(data)).not.toHaveProperty('basedOn');
  });
});

describe('Vorlage/Herkunft im Veröffentlichen-Dialog', () => {
  const mine = [
    { id: 4, vorlage: 'Ronald Lamprecht (GPL)' },
    { id: 7, vorlage: null },
  ];

  it('bietet die eigene Angabe des Levels an', () => {
    expect(basedOnFor({ basedOn: 'Anna' }, mine, '')).toBe('Anna');
    expect(basedOnFor({ basedOn: 'Anna' }, mine, '4')).toBe('Anna');
  });

  it('übernimmt bei einer neuen Version die Angabe der ersetzten Version', () => {
    expect(basedOnFor({}, mine, '4')).toBe('Ronald Lamprecht (GPL)');
    expect(basedOnFor({}, mine, '7')).toBe('');
    expect(basedOnFor({}, mine, '')).toBe('');
    expect(basedOnFor({}, [], '9')).toBe('');
  });
});
