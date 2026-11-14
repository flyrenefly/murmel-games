// Reads an Enigma level file (.xml, or plain .lua) for the upload (docs/SPEC-enigma-upload.md U1).
// No XML parser: the header and the Lua part are read with fixed patterns, and a DOCTYPE or ENTITY
// declaration stops the reading, so external entities (XXE) can never be resolved.

/** Largest accepted file and Lua part (the biggest Enigma levels are below 100 KB). */
export const MAX_FILE = 256 * 1024;
export const MAX_LUA = 200 * 1024;

/** Libraries Murmel ships (src/lua/lib): Enigma dependency path → name, with their own dependencies. */
const LIBS: Record<string, { name: string; deps?: string[] }> = {
  'lib/libpento': { name: 'libpento' },
  'lib/liblua': { name: 'liblua' },
  'lib/libmath': { name: 'libmath', deps: ['lib/liblua'] },
  'lib/natmaze': { name: 'natmaze' },
  'lib/libmap': { name: 'libmap', deps: ['lib/liblua'] },
};

export class UploadError extends Error {}

export interface EnigmaDatei {
  title: string;
  author: string;
  /** Licence as the file names it ('' = none). */
  license: string;
  /** el:compatibility el:enigma (1.1 when missing; below 1.1 = Lua API 1). */
  compat: number;
  /** Murmel library names in load order. */
  libs: string[];
  code: string;
}

const unxml = (t: string): string =>
  t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const clean = (t: string, max = 80): string => unxml(t).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const attr = (xml: string, re: RegExp): string => re.exec(xml)?.[1] ?? '';

/** Name of the file without its extension, as a title for plain Lua files. */
const baseName = (name: string): string => name.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');

/** Reads the file text; `name` decides between XML and Lua. Throws UploadError with a readable reason. */
export function leseDatei(name: string, text: string, size = new TextEncoder().encode(text).length): EnigmaDatei {
  if (size > MAX_FILE) throw new UploadError(`Die Datei ist ${Math.ceil(size / 1024)} KB groß; erlaubt sind höchstens ${MAX_FILE / 1024} KB.`);
  const lower = name.toLowerCase();
  if (lower.endsWith('.lua')) return mitLua({ title: clean(baseName(name)), author: '', license: '', compat: luaCompat(text), libs: [], code: text });
  if (!lower.endsWith('.xml')) throw new UploadError('Bitte eine Enigma-Leveldatei (.xml oder .lua) wählen.');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new UploadError('Die Datei enthält eine DOCTYPE- oder ENTITY-Angabe. Aus Sicherheitsgründen liest Murmel solche Dateien nicht.');
  if (!/<el:level\b/.test(text)) throw new UploadError('Das ist keine Enigma-Leveldatei (el:level fehlt).');
  const main = /<el:luamain>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/el:luamain>/.exec(text) ?? /<el:luamain>([\s\S]*?)<\/el:luamain>/.exec(text);
  if (!main) throw new UploadError('Die Datei enthält keinen Lua-Teil (el:luamain).');
  const code = main[0].includes('<![CDATA[') ? main[1] : unxml(main[1]);
  const libs: string[] = [];
  const add = (path: string): void => {
    const lib = LIBS[path];
    if (!lib) throw new UploadError(`Die Bibliothek ${path} fehlt in Murmel.`);
    if (libs.includes(lib.name)) return;
    for (const d of lib.deps ?? []) add(d);
    libs.push(lib.name);
  };
  for (const m of text.matchAll(/<el:dependency\b[^>]*\bel:path="([^"]+)"/g)) add(unxml(m[1]));
  return mitLua({
    title: clean(attr(text, /<el:identity\b[^>]*\bel:title="([^"]*)"/)),
    author: clean(attr(text, /<el:author\b[^>]*\bel:name="([^"]*)"/)),
    license: clean(attr(text, /<el:license\b[^>]*\bel:type="([^"]*)"/)),
    compat: Number(attr(text, /<el:compatibility\b[^>]*\bel:enigma="([0-9.]+)"/)) || 1.1,
    libs,
    code,
  });
}

/** Plain Lua: API 1 levels call create_world or the enigma.* functions. */
function luaCompat(code: string): number {
  return /\bcreate_world\s*\(|\benigma\.\w+\s*\(/.test(code) ? 1.0 : 1.1;
}

function mitLua(d: EnigmaDatei): EnigmaDatei {
  if (new TextEncoder().encode(d.code).length > MAX_LUA) throw new UploadError(`Der Lua-Teil ist größer als ${MAX_LUA / 1024} KB.`);
  if (!d.code.trim()) throw new UploadError('Der Lua-Teil ist leer.');
  if (d.compat < 1.1)
    throw new UploadError('Dieses Level nutzt Enigmas alte Lua-API 1 (vor Enigma 1.10). Das Umwandeln kennt bisher nur API 2.');
  return d;
}
