// Node-Ladehaken, damit Werkzeuge den Spielcode aus src/ ohne Build nachspielen können:
// Importe ohne Endung finden die .ts-Datei, `?raw` liefert den Dateiinhalt als Text (wie Vite),
// .json wird als JSON geladen. Node 24 entfernt die Typen selbst (Type-Stripping).
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, next) {
  if (specifier.endsWith('?raw')) {
    const url = new URL(specifier.slice(0, -4), context.parentURL);
    return { url: `${url.href}?raw`, format: 'raw', shortCircuit: true };
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.endsWith('.ts')) {
    const url = new URL(specifier, context.parentURL);
    if (!/\.[a-z]+$/i.test(url.pathname)) {
      for (const ext of ['.ts', '/index.ts']) {
        const u = new URL(url.href + ext);
        if (existsSync(fileURLToPath(u))) return { url: u.href, shortCircuit: true };
      }
    }
    if (url.pathname.endsWith('.json')) return { url: url.href, format: 'json', importAttributes: { type: 'json' }, shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.endsWith('?raw')) {
    const text = await readFile(fileURLToPath(url.slice(0, -4)), 'utf8');
    return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
  }
  if (url.endsWith('.json')) {
    const text = await readFile(fileURLToPath(url), 'utf8');
    return { format: 'json', source: text, shortCircuit: true, importAttributes: { type: 'json' } };
  }
  return next(url, context);
}
