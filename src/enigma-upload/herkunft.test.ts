// Herkunftsangabe „nach einem Enigma-Level von …“ (docs/SPEC-enigma-upload.md, Lizenz und Urheber):
// prefilled from the file, kept by the editor model and sanitizeLevel, bounded in length.
import { describe, expect, it } from 'vitest';
import { decodeLevel, encodeLevel, LinkError, MAX_BASED_ON, sanitizeLevel } from '../editor/link';
import { fromLevelFile, newLevel, toLevelFile } from '../editor/model';
import { vorlageAus } from './dialog';

const level = () => {
  const l = newLevel(8, 6);
  l.title = 'Vorlage';
  return l;
};

describe('Herkunft eines umgewandelten Enigma-Levels', () => {
  it('belegt die Angabe aus Autor und Lizenz der Datei vor', () => {
    expect(vorlageAus({ autor: 'Ronald Lamprecht', lizenz: 'GPL v2.0 or above' })).toBe('Ronald Lamprecht (GPL v2.0 or above)');
    expect(vorlageAus({ autor: 'Ronald Lamprecht', lizenz: '' })).toBe('Ronald Lamprecht');
    // without an author there is nothing to credit
    expect(vorlageAus({ autor: '', lizenz: 'GPL' })).toBe('');
    expect([...vorlageAus({ autor: 'x'.repeat(200), lizenz: 'GPL' })].length).toBe(MAX_BASED_ON);
  });

  it('geht vom Editor-Level in die Leveldatei und zurück; ohne Angabe fehlt das Feld', () => {
    expect(toLevelFile(level())).not.toHaveProperty('basedOn');
    const l = { ...level(), basedOn: '  Ronald Lamprecht (GPL) ' };
    const f = toLevelFile(l);
    expect(f.basedOn).toBe('Ronald Lamprecht (GPL)');
    expect(fromLevelFile(f).level.basedOn).toBe('Ronald Lamprecht (GPL)');
    expect(fromLevelFile(toLevelFile(level())).level).not.toHaveProperty('basedOn');
  });

  it('sanitizeLevel behält eine Zeile mit höchstens 80 Zeichen und lehnt mehr ab', () => {
    const f = toLevelFile(level());
    expect(sanitizeLevel({ ...f, basedOn: '  Ronald\n Lamprecht\u0000 (GPL) ' }, 'x').basedOn).toBe('Ronald Lamprecht (GPL)');
    expect(sanitizeLevel({ ...f, basedOn: 'ä'.repeat(MAX_BASED_ON) }, 'x').basedOn).toHaveLength(MAX_BASED_ON);
    expect(sanitizeLevel({ ...f, basedOn: '   ' }, 'x')).not.toHaveProperty('basedOn');
    expect(sanitizeLevel(f, 'x')).not.toHaveProperty('basedOn');
    expect(() => sanitizeLevel({ ...f, basedOn: 'x'.repeat(MAX_BASED_ON + 1) }, 'x')).toThrow(LinkError);
    expect(() => sanitizeLevel({ ...f, basedOn: { name: 'x' } }, 'x')).toThrow(LinkError);
  });

  it('übersteht den Link zum Probespielen', async () => {
    const f = toLevelFile({ ...level(), basedOn: 'Ronald Lamprecht (GPL)' });
    const data = await encodeLevel(f);
    expect((await decodeLevel(data)).basedOn).toBe('Ronald Lamprecht (GPL)');
  });
});
