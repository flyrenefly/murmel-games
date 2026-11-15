// Statisches HTML ohne DOM übersetzen (Build: dist/en/…, Tests). Gleiche Regeln wie uebersetzeDom in
// src/i18n.ts: data-i18n (Text), data-i18n-html (Markup), data-i18n-attr="a,b" (Attribute); Schlüssel ist
// der auf Leerzeichen normierte Textinhalt. Elemente mit data-i18n dürfen kein gleichnamiges Element
// enthalten (z. B. kein <p> in <p>), sonst stimmt die Grenze nicht – der Test findet das.
import { textSchluessel, type Woerterbuch } from '../i18n';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** HTML-Entitäten auflösen (die in den Seiten vorkommen; Zahlen allgemein). */
export function entitaeten(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

/** Textinhalt eines HTML-Schnipsels, wie textContent im Browser (ohne Tags, Entitäten aufgelöst). */
export function htmlText(html: string): string {
  return entitaeten(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ''));
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ELEMENT = /<([a-z][\w-]*)(\s[^>]*?\bdata-i18n(-html)?(?=[\s>=/])[^>]*)>([\s\S]*?)<\/\1>/gi;
const ATTR_EL = /<([a-z][\w-]*)(\s[^>]*?\bdata-i18n-attr="([^"]*)"[^>]*)>/gi;

export interface HtmlFund {
  schluessel: string;
  art: 'text' | 'html' | 'attr';
}

/** Alle übersetzbaren Stellen einer Seite (für den Vollständigkeitstest). */
export function htmlSchluessel(html: string): HtmlFund[] {
  const out: HtmlFund[] = [];
  for (const m of html.matchAll(ELEMENT)) out.push({ schluessel: textSchluessel(htmlText(m[4])), art: m[3] ? 'html' : 'text' });
  for (const m of html.matchAll(ATTR_EL)) {
    for (const a of m[3].split(',').map((x) => x.trim()).filter(Boolean)) {
      const v = new RegExp(`\\s${a}="([^"]*)"`).exec(m[2]);
      if (v) out.push({ schluessel: textSchluessel(entitaeten(v[1])), art: 'attr' });
    }
  }
  return out;
}

/** Seite ins Englische übersetzen; fehlende Einträge bleiben deutsch (der Test verhindert das). */
export function uebersetzeHtml(html: string, en: Woerterbuch): string {
  let out = html.replace(ELEMENT, (all, tag: string, attrs: string, isHtml: string | undefined, inner: string) => {
    const v = en[textSchluessel(htmlText(inner))];
    if (v === undefined) return all;
    return `<${tag}${attrs}>${isHtml ? v : escText(v)}</${tag}>`;
  });
  out = out.replace(ATTR_EL, (all, _tag: string, attrs: string, list: string) => {
    let neu = all;
    for (const a of list.split(',').map((x) => x.trim()).filter(Boolean)) {
      neu = neu.replace(new RegExp(`(\\s${a}=")([^"]*)(")`), (m, pre: string, val: string, post: string) => {
        const v = en[textSchluessel(entitaeten(val))];
        return v === undefined ? m : `${pre}${escAttr(v)}${post}`;
      });
    }
    return neu;
  });
  return out;
}
