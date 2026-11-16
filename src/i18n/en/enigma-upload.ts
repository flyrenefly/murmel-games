// Englische Texte: Enigma-Level umwandeln im Editor (src/enigma-upload/*.ts).
// Schlüssel = deutscher Text im Code. Der Worker bekommt die Sprache der Seite mit (client.ts).
export default {
  // Datei und Worker
  'Die Datei ist {kb} KB groß; erlaubt sind höchstens {max} KB.': 'The file is {kb} KB; at most {max} KB are allowed.',
  'Die Umwandlung wurde abgebrochen (Zeitgrenze {s} s).': 'The conversion was stopped (time limit {s} s).',
  'Die Umwandlung wurde abgebrochen (zu viel Speicher oder ein Fehler im Browser).': 'The conversion was stopped (too much memory or an error in the browser).',
  'Die Umwandlung ist fehlgeschlagen: {grund}': 'The conversion failed: {grund}',
  'Bitte eine Enigma-Leveldatei (.xml oder .lua) wählen.': 'Please choose an Enigma level file (.xml or .lua).',
  'Die Datei enthält eine DOCTYPE- oder ENTITY-Angabe. Aus Sicherheitsgründen liest Murmel solche Dateien nicht.':
    'The file contains a DOCTYPE or ENTITY declaration. For security reasons Murmel does not read such files.',
  'Das ist keine Enigma-Leveldatei (el:level fehlt).': 'This is not an Enigma level file (el:level is missing).',
  'Die Datei enthält keinen Lua-Teil (el:luamain).': 'The file contains no Lua part (el:luamain).',
  'Die Bibliothek {pfad} fehlt in Murmel.': 'Murmel does not have the library {pfad}.',
  'Der Lua-Teil ist größer als {max} KB.': 'The Lua part is larger than {max} KB.',
  'Der Lua-Teil ist leer.': 'The Lua part is empty.',
  'Dieses Level nutzt Enigmas alte Lua-API 1 (vor Enigma 1.10). Das Umwandeln kennt bisher nur API 2.':
    'This level uses Enigma’s old Lua API 1 (before Enigma 1.10). The conversion only supports API 2 so far.',

  // Aufbau der Welt (welt.ts, auch Lua-Fehler des Zusatzes)
  'Resolver mit falschem Typ': 'Resolver of the wrong type',
  'Die Kachel „{key}“ bei {x}, {y} ist nicht definiert': 'The tile “{key}” at {x}, {y} is not defined',
  'Die Welt wurde schon erstellt': 'The world has already been created',
  'wo(...) ohne gültigen Standardschlüssel': 'wo(...) without a valid default key',
  'Die Karte enthält Zeilen, die keine Zeichenketten sind': 'The map contains rows that are not strings',
  'Eine Kartenzeile hat eine unpassende Länge': 'A map row has an unsuitable length',
  'wo(...) mit ungültiger Größe': 'wo(...) with an invalid size',
  'Murmel kennt res.{name} noch nicht': 'Murmel does not know res.{name} yet',
  'Die Nachricht „{nachricht}“ beim Aufbau wurde nicht ausgeführt.': 'The message “{nachricht}” during setup was not carried out.',
  'Das Level setzt Kacheln, bevor es mit wo(...) die Welt erstellt': 'The level sets tiles before creating the world with wo(...)',
  'Das Level setzt mehr als {max} Kacheln': 'The level sets more than {max} tiles',
  'Das Level ist {w}×{h} groß; erlaubt sind höchstens {maxW}×{maxH}': 'The level is {w}×{h}; at most {maxW}×{maxH} is allowed',
  '{art} (im Inventar)': '{art} (in the inventory)',
  'Das Level erstellt keine Welt (wo(...) fehlt).': 'The level creates no world (wo(...) is missing).',
  'Der Lua-Teil läuft zu lange (Endlosschleife?).': 'The Lua part runs too long (endless loop?).',
  'Fehler im Lua-Teil (Zeile {zeile}): {text}': 'Error in the Lua part (line {zeile}): {text}',
  'Fehler im Lua-Teil: {text}': 'Error in the Lua part: {text}',

  // Übersetzen in ein Editor-Level (editorlevel.ts, umwandeln.ts)
  '{eigenschaft} von {art}': '{eigenschaft} of {art}',
  '{art} über die Lua-Funktion „{funktion}“': '{art} via the Lua function “{funktion}”',
  'Bei {x}, {y} fehlt ein Boden; dort liegt jetzt {boden}.': 'There is no floor at {x}, {y}; it is now {boden}.',
  'Das Level steuert {liste}. Lua ist in Spieler-Levels nicht erlaubt.': 'The level controls {liste}. Lua is not allowed in player levels.',
  'Diese Objekte kann ein Spieler-Level noch nicht enthalten: {liste}.': 'A player level cannot contain these objects yet: {liste}.',
  'Das Level braucht genau eine schwarze Murmel oder, als Meditation, eine Perle (gefunden: {n} Murmeln).':
    'The level needs exactly one black marble or, as a meditation, a pearl (found: {n} marbles).',
  'Das Level enthält {n} Dokumente; ein Spieler-Level darf höchstens {max} enthalten.': 'The level contains {n} documents; a player level may contain at most {max}.',
  'Ein Dokumenttext wurde auf {max} Zeichen gekürzt.': 'One document text was shortened to {max} characters.',
  '{n} Dokumenttexte wurden auf {max} Zeichen gekürzt.': '{n} document texts were shortened to {max} characters.',
  'Nicht übernommene Welteinstellungen: {liste}.': 'World settings not taken over: {liste}.',
  'Nicht übernommene Eigenschaften: {liste}.': 'Properties not taken over: {liste}.',
  'Enigma-Level': 'Enigma level',
  'Das Level ist {w}×{h} groß; der Editor nimmt {minW}×{minH} bis {maxW}×{maxH}.': 'The level is {w}×{h}; the editor takes {minW}×{minH} to {maxW}×{maxH}.',

  // Dialoge (dialog.ts)
  'Enigma-Level von {autor} ({lizenz})': 'Enigma level by {autor} ({lizenz})',
  'Enigma-Level von {autor}': 'Enigma level by {autor}',
  'Enigma-Level umwandeln': 'Convert an Enigma level',
  'Wähle eine Enigma-Leveldatei (.xml oder .lua, höchstens 256 KB). Murmel wandelt sie in deinem Browser um; die Datei wird nicht hochgeladen.':
    'Choose an Enigma level file (.xml or .lua, at most 256 KB). Murmel converts it in your browser; the file is not uploaded.',
  'Danach öffnet sich das Level im Editor. Dort spielst du es probe und kannst es nach dem Lösen veröffentlichen.':
    'Then the level opens in the editor. There you playtest it and, once solved, can publish it.',
  'Datei wählen': 'Choose file',
  Abbrechen: 'Cancel',
  '„{datei}“ wird umgewandelt …': 'Converting “{datei}” …',
  'Umwandeln nicht möglich': 'Cannot convert',
  'Die Datei lässt sich nicht lesen.': 'The file cannot be read.',
  'Andere Datei …': 'Other file …',
  Schließen: 'Close',
  Titel: 'Title',
  Größe: 'Size',
  'Autor laut Datei': 'Author (from file)',
  'keine Angabe': 'not given',
  'Lizenz laut Datei': 'License (from file)',
  'Hinweise – prüfe beim Probespielen, ob das Level so lösbar bleibt:': 'Notes – check while playtesting that the level is still solvable:',
  'freiwillig, etwa der Name des Urhebers': 'optional, e.g. the original author’s name',
  'Vorlage (erscheint beim Level als „Vorlage: …“)': 'Based on (shown with the level as “Based on: …”)',
  'Ich habe dieses Level selbst gebaut oder die Erlaubnis des Urhebers, es unter CC BY-SA 4.0 zu veröffentlichen.':
    'I built this level myself or have the original author’s permission to publish it under CC BY-SA 4.0.',
  'Spieler-Levels stehen unter CC BY-SA 4.0. Ein fremdes Level (etwa unter GPL) darfst du nur mit Erlaubnis des Urhebers so veröffentlichen.':
    'Player levels are licensed under CC BY-SA 4.0. You may only publish someone else’s level (e.g. under GPL) this way with the original author’s permission.',
  'Bitte bestätige, dass du die Rechte an dem Level hast.': 'Please confirm that you hold the rights to the level.',
  '„{titel}“ umgewandelt. Spiel es probe; nach dem Lösen kannst du es veröffentlichen.': '“{titel}” converted. Playtest it; once solved, you can publish it.',
  'Enigma-Level umgewandelt': 'Enigma level converted',
  'Im Editor öffnen': 'Open in the editor',
} as const;
