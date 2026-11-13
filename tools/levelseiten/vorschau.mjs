// Vorschaubilder der Levelseiten (docs/SPEC-levelseiten.md) ohne Browser: das Level startet mit der
// Spiellogik aus src/ (wie die Ladeprobe, mit Lua), der Renderer „Klassisch“ (src/render/classic.ts)
// zeichnet das ganze Feld auf eine Canvas von @napi-rs/canvas. Nur ein paar Browser-Teile werden
// nachgebildet: Image (liest aus public/), document.createElement('canvas'), window für resize().
// Braucht Node mit --experimental-transform-types (wie tools/lib/pool.mjs).
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { join } from 'node:path';
import { createCanvas, Image as NapiImage } from '@napi-rs/canvas';
import { ROOT } from '../lib/levels.mjs';

register('../lib/ts-hooks.mjs', import.meta.url);
register('./env-hooks.mjs', import.meta.url);

const PUBLIC = join(ROOT, 'public');

class FileImage extends NapiImage {
  set src(url) {
    // "/enigma/gfx32/st_oxyd.png" → public/enigma/gfx32/st_oxyd.png; fehlt die Datei, meldet onerror
    let data;
    try {
      data = readFileSync(join(PUBLIC, decodeURI(String(url)).replace(/^\/+/, '')));
    } catch {
      queueMicrotask(() => this.onerror?.(new Error(`Bild fehlt: ${url}`)));
      return;
    }
    super.src = data;
  }
  get src() {
    return super.src;
  }
}

function canvas(w = 300, h = 150) {
  const c = createCanvas(w, h);
  c.style = {};
  return c;
}

globalThis.Image = FileImage;
globalThis.window ??= { innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1 };
globalThis.document ??= { createElement: (tag) => (tag === 'canvas' ? canvas() : {}), getElementById: () => null };

const { GameSession } = await import('../../src/game/session.ts');
const { ClassicView } = await import('../../src/render/classic.ts');
const { startLuaNode } = await import('../../src/lua/node.ts');
const { LuaLevel } = await import('../../src/lua/runtime.ts');
LuaLevel.quiet = true;

/** Breite des Vorschaubilds höchstens (große Levels werden verkleinert, kleine bleiben 1:1). */
export const MAX_WIDTH = 800;
/** Breite der kleinen Bilder für die Übersichten. */
export const THUMB_WIDTH = 320;

function scaled(src, width) {
  if (src.width <= width) return src;
  const out = createCanvas(width, Math.round((src.height * width) / src.width));
  const g = out.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

/**
 * Das Spielfeld von `file` zu Beginn, als ganzes Level: { webp, width, height, thumb } (thumb: kleines
 * Bild für die Übersichten). Wirft, wenn das Level nicht startet.
 */
export async function vorschau(file, { quality = 70, thumbQuality = 60 } = {}) {
  const s = await GameSession.create(file, { seed: 1, startLua: startLuaNode });
  const view = new ClassicView(canvas());
  await view.build(s.level, 'gfx32', s.board.states, s.objects);
  const ph = s.physics;
  const me = ph.marbles[ph.current] ?? ph.marbles[0];
  if (me) view.updateMarble(me.pos.x, me.pos.y, -1, me.color, 0, -1, !!me.pearl);
  view.updateActors([
    ...ph.enemies.map((e) => ({ kind: e.kind, color: e.color, x: e.pos.x, y: e.pos.y })),
    ...ph.marbles.filter((m) => m !== me).map((m) => ({ kind: 'marble', color: m.color, x: m.pos.x, y: m.pos.y, fall: -1, sink: 0, jump: -1, pearl: !!m.pearl })),
  ]);
  view.updateRubbers(ph.rubbers.flatMap((r) => [r.a1.pos.x, r.a1.pos.y, ...(r.a2 ? [r.a2.pos.x, r.a2.pos.y] : [r.end.x, r.end.y])]));
  view.setGlasses(s.objects.glassesBits());
  view.renderWhole();
  const out = scaled(view.canvas, MAX_WIDTH);
  const webp = await out.encode('webp', quality);
  const thumb = await scaled(view.canvas, THUMB_WIDTH).encode('webp', thumbQuality);
  return { webp, width: out.width, height: out.height, thumb };
}
