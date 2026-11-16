// Vollständigkeit der Wörterbücher (docs/SPEC-englisch.md, Abschnitt Tests): Jeder Schlüssel hat eine
// nicht leere englische Übersetzung mit denselben Platzhaltern, jeder Schlüssel wird verwendet, und
// jede übersetzbare Stelle in den HTML-Seiten steht im Wörterbuch der Seite (seite-<name>.ts).
import { describe, expect, it } from 'vitest';
import { platzhalter, textSchluessel } from '../i18n';
import { htmlSchluessel } from './html';

const dicts = import.meta.glob<{ default: Record<string, string> }>('./en/*.ts', { eager: true });
const code = import.meta.glob<string>(['/src/**/*.ts', '/src/**/*.js', '!/src/**/*.test.ts', '!/src/i18n/en/**'], { query: '?raw', import: 'default', eager: true });
const html = import.meta.glob<string>('/*.html', { query: '?raw', import: 'default', eager: true });

/** Quelltext ohne Wörterbücher und Tests, Escapes aufgelöst, damit Schlüssel als Text gefunden werden. */
const quellen = [...Object.values(code), ...Object.values(html)]
  .map((t) => t.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n'))
  .join('\n');
const seiten = Object.keys(html).map((p) => p.slice(1));
const htmlKeys = new Set(Object.values(html).flatMap((t) => htmlSchluessel(t).map((k) => k.schluessel)));
/** Seitentitel (<title>) zählen als verwendet. */
const titel = new Set(Object.values(html).map((t) => textSchluessel(/<title>([\s\S]*?)<\/title>/.exec(t)?.[1] ?? '')));

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
    const funde = htmlSchluessel(html[`/${f}`]);
    if (!funde.length) continue;
    it(`${f}: jede Stelle ist übersetzt`, () => {
      const mod = dicts[`./en/seite-${f.replace(/\.html$/, '')}.ts`];
      expect(mod, `src/i18n/en/seite-${f.replace(/\.html$/, '')}.ts fehlt`).toBeDefined();
      const fehlt = funde.filter((k) => !(k.schluessel in mod.default)).map((k) => k.schluessel);
      expect(fehlt).toEqual([]);
    });
  }
});
