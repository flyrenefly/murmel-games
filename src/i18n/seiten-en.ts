// Englische Fassungen statischer Seiten (docs/SPEC-englisch.md, „Levelseiten und SEO“): Der Build legt
// aus dist/index.html und dist/ueber.html die Seiten dist/en/index.html und dist/en/ueber.html an.
// <base href="../"> lässt alle relativen Wege (Skripte, Levels, Links) auf die Wurzel zeigen.
import { textSchluessel, type Woerterbuch } from '../i18n';
import { entitaeten, uebersetzeHtml } from './html';

export const SITE = 'https://murmel.games';

/** JSON-LD: jeden Text, der im Wörterbuch steht, übersetzen; inLanguage → en. */
export function uebersetzeJsonLd(json: string, en: Woerterbuch): string {
  const walk = (v: unknown, key = ''): unknown => {
    if (typeof v === 'string') return key === 'inLanguage' ? 'en' : (en[v] ?? v);
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return JSON.stringify(walk(JSON.parse(json)), null, 2).replace(/</g, '\\u003c');
}

/** Pfad der deutschen Seite ("" für die Startseite, "ueber.html") → englische Seite. */
export function englischeSeite(html: string, en: Woerterbuch, pfad: string): string {
  const de = `${SITE}/${pfad}`;
  const enUrl = `${SITE}/en/${pfad}`;
  let out = uebersetzeHtml(html, en);
  out = out.replace(/<html lang="de"/, '<html lang="en"');
  out = out.replace(/<title>([^<]*)<\/title>/, (_m, t: string) => {
    const v = en[textSchluessel(entitaeten(t))];
    if (v === undefined) throw new Error(`englischeSeite ${pfad || 'index'}: Titel fehlt im Wörterbuch`);
    return `<title>${v.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title>`;
  });
  if (!/<head>\s*\n?/.test(out)) throw new Error('englischeSeite: <head> fehlt');
  out = out.replace(/<head>(\s*)/, (_m, ws: string) => `<head>${ws}<base href="../" />${ws}`);
  const ersetzen = (re: RegExp, neu: string, was: string) => {
    if (!re.test(out)) throw new Error(`englischeSeite ${pfad || 'index'}: ${was} fehlt`);
    out = out.replace(re, neu);
  };
  ersetzen(/<link rel="canonical" href="[^"]*"/, `<link rel="canonical" href="${enUrl}"`, 'canonical');
  ersetzen(/<meta property="og:url" content="[^"]*"/, `<meta property="og:url" content="${enUrl}"`, 'og:url');
  ersetzen(
    /<meta property="og:locale" content="de_DE" \/>(\s*)<meta property="og:locale:alternate" content="en_US" \/>/,
    '<meta property="og:locale" content="en_US" />$1<meta property="og:locale:alternate" content="de_DE" />',
    'og:locale',
  );
  // die deutsche Seite nennt ihre Alternativen schon; hier bleiben sie gleich
  if (!out.includes(`hreflang="en" href="${enUrl}"`) || !out.includes(`hreflang="de" href="${de}"`)) throw new Error(`englischeSeite ${pfad || 'index'}: hreflang fehlt in der deutschen Seite`);
  out = out.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g, (_m, json: string) => `<script type="application/ld+json">\n${uebersetzeJsonLd(json, en)}\n    </script>`);
  return out;
}
