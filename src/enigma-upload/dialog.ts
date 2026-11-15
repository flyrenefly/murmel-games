// The editor's dialogs for Enigma files (docs/SPEC-enigma-upload.md, Oberfläche): convert in the worker,
// show what came over, ask for the rights, open the result in the editor (preview, playtest, publish).

import type { EditorLevel } from '../editor/model';
import { wandleImWorker } from './client';
import { UploadError } from './datei';
import type { Ergebnis } from './umwandeln';

type Buttons = [string, () => void, string?][];

export interface EnigmaHost {
  showDialog(title: string, body: (HTMLElement | string)[], buttons: Buttons): void;
  close(): void;
  note(text: string): HTMLElement;
  /** Opens the converted level as a new editor level. */
  open(level: EditorLevel): void;
  toast(text: string, ms?: number): void;
}

export const ENIGMA_ACCEPT = '.xml,.lua,text/xml,application/xml';
export const RIGHTS_TEXT = 'Ich habe dieses Level selbst gebaut oder die Erlaubnis des Urhebers, es unter CC BY-SA 4.0 zu veröffentlichen.';

/** Whether a picked file is an Enigma level (by its name). */
export const isEnigmaFile = (name: string): boolean => /\.(xml|lua)$/i.test(name);

/** Start dialog (spielerlevels.html → editor.html#enigma): a file pick needs a click. */
export function enigmaStart(h: EnigmaHost): void {
  h.showDialog(
    'Enigma-Level umwandeln',
    [
      h.note('Wähle eine Enigma-Leveldatei (.xml oder .lua, höchstens 256 KB). Murmel wandelt sie in deinem Browser um; die Datei wird nicht hochgeladen.'),
      h.note('Danach öffnet sich das Level im Editor. Dort spielst du es probe und kannst es nach dem Lösen veröffentlichen.'),
    ],
    [
      ['Datei wählen', () => pickEnigma(h), 'primary'],
      ['Abbrechen', h.close],
    ],
  );
}

export function pickEnigma(h: EnigmaHost): void {
  const pick = Object.assign(document.createElement('input'), { type: 'file', accept: ENIGMA_ACCEPT });
  pick.addEventListener('change', () => {
    const f = pick.files?.[0];
    if (f) void importEnigma(h, f);
  });
  pick.click();
}

export async function importEnigma(h: EnigmaHost, file: File): Promise<void> {
  const busy = h.note(`„${file.name}“ wird umgewandelt …`);
  busy.classList.add('ed-busy');
  h.showDialog('Enigma-Level umwandeln', [busy], [['Abbrechen', h.close]]);
  let r: Ergebnis;
  try {
    r = await wandleImWorker(file);
  } catch (e) {
    h.showDialog('Umwandeln nicht möglich', [h.note(e instanceof UploadError ? e.message : 'Die Datei lässt sich nicht lesen.')], [
      ['Andere Datei …', () => pickEnigma(h), 'primary'],
      ['Schließen', h.close],
    ]);
    return;
  }
  showResult(h, r);
}

/** Summary of a conversion and the rights confirmation. */
export function showResult(h: EnigmaHost, r: Ergebnis): void {
  const f = document.createElement('form');
  f.className = 'ed-form';
  f.noValidate = true;
  const facts = document.createElement('dl');
  facts.className = 'ed-facts';
  const fact = (k: string, v: string) => {
    facts.append(Object.assign(document.createElement('dt'), { textContent: k }), Object.assign(document.createElement('dd'), { textContent: v }));
  };
  fact('Titel', r.level.title);
  fact('Größe', `${r.level.width} × ${r.level.height}`);
  fact('Autor laut Datei', r.herkunft.autor || 'keine Angabe');
  fact('Lizenz laut Datei', r.herkunft.lizenz || 'keine Angabe');
  f.append(facts);
  if (r.hinweise.length) {
    const ul = document.createElement('ul');
    ul.className = 'ed-hints';
    for (const t of r.hinweise) ul.append(Object.assign(document.createElement('li'), { textContent: t }));
    f.append(h.note('Hinweise – prüfe beim Probespielen, ob das Level so lösbar bleibt:'), ul);
  }
  const rights = Object.assign(document.createElement('input'), { type: 'checkbox' });
  const label = document.createElement('label');
  label.className = 'ed-check';
  label.append(rights, RIGHTS_TEXT);
  const err = Object.assign(document.createElement('p'), { className: 'ed-error' });
  err.setAttribute('role', 'alert');
  f.append(label, h.note('Spieler-Levels stehen unter CC BY-SA 4.0. Ein fremdes Level (etwa unter GPL) darfst du nur mit Erlaubnis des Urhebers so veröffentlichen.'), err);
  const go = () => {
    if (!rights.checked) {
      err.textContent = 'Bitte bestätige, dass du die Rechte an dem Level hast.';
      rights.focus();
      return;
    }
    h.close();
    h.open(r.level);
    h.toast(`„${r.level.title}“ umgewandelt. Spiel es probe; nach dem Lösen kannst du es veröffentlichen.`, 5000);
  };
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    go();
  });
  h.showDialog('Enigma-Level umgewandelt', [f], [
    ['Im Editor öffnen', go, 'primary'],
    ['Abbrechen', h.close],
  ]);
}
