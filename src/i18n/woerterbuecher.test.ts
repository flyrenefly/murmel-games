// Vollständigkeit der Wörterbücher (docs/SPEC-englisch.md, Abschnitt Tests): Jeder Schlüssel hat eine
// nicht leere englische Übersetzung mit denselben Platzhaltern, jeder Schlüssel wird verwendet, und
// jede übersetzbare Stelle in den HTML-Seiten steht im Wörterbuch der Seite (seite-<name>.ts).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { platzhalter, textSchluessel } from '../i18n';
import { htmlSchluessel } from './html';

const ROOT = resolve(__dirname, '../..');
const dicts = import.meta.glob<{ default: Record<string, string> }>('./en/*.ts', { eager: true });

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

/** Quelltext ohne Wörterbücher und Tests, Escapes aufgelöst, damit Schlüssel als Text gefunden werden. */
const quellen = files(join(ROOT, 'src'))
  .filter((f) => /\.(ts|js)$/.test(f) && !/\.test\.ts$/.test(f) && !/[\\/]i18n[\\/]en[\\/]/.test(f))
  .map((f) => readFileSync(f, 'utf8').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n'))
  .join('\n');
const seiten = readdirSync(ROOT).filter((f) => f.endsWith('.html'));
const htmlKeys = new Set(seiten.flatMap((f) => htmlSchluessel(readFileSync(join(ROOT, f), 'utf8')).map((k) => k.schluessel)));
/** Seitentitel (<title>) zählen als verwendet. */
const titel = new Set(seiten.map((f) => textSchluessel(/<title>([\s\S]*?)<\/title>/.exec(readFileSync(join(ROOT, f), 'utf8'))?.[1] ?? '')));

describe('Wörterbücher', () => {
  it('gibt es', () => {
    expect(Object.keys(dicts).length).toBeGreaterThan(0);
  });
  for (const [name, mod] of Object.entries(dicts)) {
    describe(name, () => {
      const d = mod.default;
      it('jeder Schlüssel hat eine englische Übersetzung mit denselben Platzhaltern', () => {
        for (const [de, en] of Object.entries(d)) {
          expect(de.trim(), name).not.toBe('');
          expect(typeof en === 'string' && en.trim() !== '', `${name}: „${de}“ ohne Übersetzung`).toBe(true);
          expect(platzhalter(en), `${name}: Platzhalter in „${de}“`).toEqual(platzhalter(de));
        }
      });
      it('kein Schlüssel ist verwaist', () => {
        const verwaist = Object.keys(d).filter((k) => !quellen.includes(k) && !htmlKeys.has(k) && !titel.has(k));
        expect(verwaist, `${name}: nicht verwendet`).toEqual([]);
      });
      it('kein „Oxyd online“ (Markenrecht)', () => {
        for (const en of Object.values(d)) expect(en).not.toMatch(/oxyd\s+online/i);
      });
    });
  }
});

describe('HTML-Seiten', () => {
  for (const f of seiten) {
    const html = readFileSync(join(ROOT, f), 'utf8');
    const funde = htmlSchluessel(html);
    if (!funde.length) continue;
    it(`${f}: jede Stelle ist übersetzt`, () => {
      const mod = dicts[`./en/seite-${f.replace(/\.html$/, '')}.ts`];
      expect(mod, `src/i18n/en/seite-${f.replace(/\.html$/, '')}.ts fehlt`).toBeDefined();
      const fehlt = funde.filter((k) => !(k.schluessel in mod.default)).map((k) => k.schluessel);
      expect(fehlt).toEqual([]);
    });
  }
});
