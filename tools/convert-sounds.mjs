// Converts Enigma's WAV sound effects (PCM 8/16 bit, MS ADPCM, µ-law) into
// 16-bit PCM WAV, which every browser can decode.
// Usage: node tools/convert-sounds.mjs <enigma>/data/soundsets/enigma public/sounds name1 name2 …

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [srcDir, outDir, ...names] = process.argv.slice(2);
if (!srcDir || !outDir || names.length === 0) {
  console.error('usage: convert-sounds.mjs <srcDir> <outDir> <name>…');
  process.exit(1);
}

function chunks(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('no WAV');
  const out = {};
  for (let p = 12; p + 8 <= buf.length; ) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    out[id] = buf.subarray(p + 8, Math.min(buf.length, p + 8 + size));
    p += 8 + size + (size & 1);
  }
  return out;
}

const ADAPT = [230, 230, 230, 230, 307, 409, 512, 614, 768, 614, 512, 409, 307, 230, 230, 230];
const clamp16 = (v) => Math.max(-32768, Math.min(32767, v));

function decodeMsAdpcm(fmt, data) {
  const channels = fmt.readUInt16LE(2);
  if (channels !== 1) throw new Error('only mono MS ADPCM supported');
  const blockAlign = fmt.readUInt16LE(12);
  const numCoef = fmt.readUInt16LE(20);
  const coef = [];
  for (let i = 0; i < numCoef; i++) coef.push([fmt.readInt16LE(22 + i * 4), fmt.readInt16LE(24 + i * 4)]);
  const out = [];
  for (let b = 0; b + 7 <= data.length; b += blockAlign) {
    const block = data.subarray(b, Math.min(data.length, b + blockAlign));
    const [c1, c2] = coef[block[0]];
    let delta = block.readInt16LE(1);
    let s1 = block.readInt16LE(3);
    let s2 = block.readInt16LE(5);
    out.push(s2, s1);
    for (let i = 7; i < block.length; i++) {
      for (const nib of [block[i] >> 4, block[i] & 15]) {
        const signed = nib >= 8 ? nib - 16 : nib;
        const pred = clamp16(((s1 * c1 + s2 * c2) >> 8) + signed * delta);
        s2 = s1;
        s1 = pred;
        out.push(pred);
        delta = Math.max(16, (ADAPT[nib] * delta) >> 8);
      }
    }
  }
  return out;
}

function decodeMuLaw(data) {
  const out = [];
  for (const u8 of data) {
    const u = ~u8 & 0xff;
    const sign = u & 0x80;
    const exp = (u >> 4) & 7;
    const mant = u & 0x0f;
    let s = (((mant << 3) + 0x84) << exp) - 0x84;
    out.push(sign ? -s : s);
  }
  return out;
}

function decodePcm(fmt, data) {
  const bits = fmt.readUInt16LE(14);
  const out = [];
  if (bits === 8) for (const v of data) out.push((v - 128) << 8);
  else if (bits === 16) for (let i = 0; i + 1 < data.length; i += 2) out.push(data.readInt16LE(i));
  else throw new Error(`unsupported PCM bits ${bits}`);
  return out;
}

function writeWav(path, rate, samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}

mkdirSync(outDir, { recursive: true });
for (const name of names) {
  const buf = readFileSync(join(srcDir, `${name}.wav`));
  const c = chunks(buf);
  const fmt = c['fmt '];
  const tag = fmt.readUInt16LE(0);
  if (fmt.readUInt16LE(2) !== 1) throw new Error(`${name}: only mono supported`);
  const rate = fmt.readUInt32LE(4);
  const samples = tag === 1 ? decodePcm(fmt, c.data) : tag === 2 ? decodeMsAdpcm(fmt, c.data) : tag === 7 ? decodeMuLaw(c.data) : null;
  if (!samples) throw new Error(`${name}: unsupported format ${tag}`);
  writeWav(join(outDir, `${name}.wav`), rate, samples);
  console.log(`${name}: format ${tag} → PCM16, ${samples.length} samples @ ${rate} Hz`);
}
