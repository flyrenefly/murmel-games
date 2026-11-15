// Enigma file → editor level (docs/SPEC-enigma-upload.md): read, build in the Lua sandbox, translate.
// The fengari module comes from the caller: fengari-web in the browser worker, fengari in tests.

import { MAX_H, MAX_W, MIN_H, MIN_W } from '../editor/model';
import { LIBS } from '../lua/index';
import type { Fengari } from '../lua/runtime';
import { type EnigmaDatei, leseDatei, UploadError } from './datei';
import { type Umgewandelt, zuEditorLevel } from './editorlevel';
import { baueWelt } from './welt';
import { woerterbuch } from '../i18n';
import EN from '../i18n/en/enigma-upload';

const t = woerterbuch(EN);

export interface Ergebnis extends Umgewandelt {
  /** Author and licence as the file names them (for the rights confirmation). */
  herkunft: { autor: string; lizenz: string };
}

export async function wandleUm(name: string, text: string, f: Fengari, shim: string): Promise<Ergebnis> {
  const datei: EnigmaDatei = leseDatei(name, text);
  const welt = await baueWelt(datei.code, f, shim, datei.libs.map((l) => LIBS[l]));
  if (welt.w < MIN_W || welt.h < MIN_H || welt.w > MAX_W || welt.h > MAX_H)
    throw new UploadError(t('Das Level ist {w}×{h} groß; der Editor nimmt {minW}×{minH} bis {maxW}×{maxH}.', { w: welt.w, h: welt.h, minW: MIN_W, minH: MIN_H, maxW: MAX_W, maxH: MAX_H }));
  return { ...zuEditorLevel(datei, welt), herkunft: { autor: datei.author, lizenz: datei.license } };
}
