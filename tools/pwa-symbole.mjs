#!/usr/bin/env node
// Erzeugt die PNG-Symbole der Web-App aus public/favicon.svg (für Manifest, iOS und die Google-Play-Hülle):
//   public/icons/icon-192.png, icon-512.png            – Murmel auf transparentem Grund („any“)
//   public/icons/maskable-192.png, maskable-512.png    – Murmel in der sicheren Zone (80 %) auf dunklem Grund
//   public/icons/apple-touch-icon.png (180)            – iOS, dunkler Grund ohne Transparenz
// Aufruf: node tools/pwa-symbole.mjs  (nur nötig, wenn sich favicon.svg ändert; die PNGs liegen im Repo)
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HINTERGRUND = '#05050c'; // wie theme_color/background_color im Manifest
const svg = readFileSync(join(root, 'public/favicon.svg'));
const bild = await loadImage(svg);
const ziel = join(root, 'public/icons');
mkdirSync(ziel, { recursive: true });

function zeichne(groesse, { grund = null, anteil = 1 } = {}) {
  const c = createCanvas(groesse, groesse);
  const g = c.getContext('2d');
  if (grund) {
    g.fillStyle = grund;
    g.fillRect(0, 0, groesse, groesse);
  }
  const s = groesse * anteil;
  const o = (groesse - s) / 2;
  g.drawImage(bild, o, o, s, s);
  return c.toBuffer('image/png');
}

const dateien = {
  'icon-192.png': zeichne(192),
  'icon-512.png': zeichne(512),
  // maskable: Android schneidet bis zu einem Kreis mit 80 % Durchmesser zu – Murmel innerhalb davon
  'maskable-192.png': zeichne(192, { grund: HINTERGRUND, anteil: 0.72 }),
  'maskable-512.png': zeichne(512, { grund: HINTERGRUND, anteil: 0.72 }),
  'apple-touch-icon.png': zeichne(180, { grund: HINTERGRUND, anteil: 0.86 }),
};
for (const [name, buf] of Object.entries(dateien)) {
  writeFileSync(join(ziel, name), buf);
  console.log(`${name}: ${buf.length} Bytes`);
}
