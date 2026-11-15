# Spec: `enigma-upload` – Enigma-Leveldatei hochladen, umwandeln, veröffentlichen

Baustein aus `docs/SERVER.md` Abschnitte 3 und 10 (Phase E, hängt ab von `spielerlevels`). Grundlagen:
`docs/SPEC-spielerlevels.md` (Prüfung, Freigabe, Lizenz), `docs/SPEC-editor.md` (Levelformat, strenge
Prüfung `sanitizeLevel`), `docs/SPEC.md` „Enigma-Levels übernehmen“ (Export und Importer). Stand 14.11.2026.

## Ziel

Wer eine Enigma-Leveldatei (`.xml`, oder `.lua` nur mit dem Lua-Teil) hat, kann sie in Murmel öffnen.
Murmel wandelt sie in ein Editor-Level um, zeigt Vorschau und Hinweise, man spielt es probe und
veröffentlicht es danach über den bestehenden Weg der Spieler-Levels: selbst gelöster Lauf, Prüfung
durch Nachspielen, Freigabe durch einen Admin, Lizenz CC BY-SA 4.0.

## Ausgangslage (Befund vom 14.11.2026)

- `tools/import-enigma.mjs` wandelt **keine rohe Enigma-Datei** um. Er braucht den **JSON-Weltexport der
  echten Enigma-Engine** (C++-Fork `flyrenefly/enigma-web`, Branch `level-export`, gebaut mit SDL2, Xerces
  und xvfb in GitHub Actions). Murmels Lua-Schicht (`src/lua/enigma.lua`) überspringt beim Levelstart den
  Weltaufbau („die Welt kommt aus dem Export“) und führt nur die Rückrufe aus.
- Spieler-Levels nehmen nur, was der Editor bauen kann: `sanitizeLevel` lässt nur Arten der Editor-Palette
  (`src/editor/palette.ts`) und wenige Attribute zu, **nie Lua** und keine Dokumenttexte. Lua oder Texte in
  Spieler-Levels sind laut `SPEC-spielerlevels.md` „Erst fragen“.

## Entscheidung: Umwandlung im Browser, der Server bekommt nur das Editor-Level

**Gewählt:** Die Datei verlässt den Browser nicht. Murmel baut die Welt im Browser mit der vorhandenen
fengari-Sandbox auf (ein „Aufbau-Modus“ über `enigma.lua`, Vorbild `createWorld` in Enigmas `lua.cc`),
übersetzt sie in ein Editor-Level und öffnet es im Editor. Ab dort gilt der bestehende Weg
(Probespielen → Veröffentlichen → Nachspielen im Prüfprozess → Admin-Freigabe).

| | Im Browser (gewählt) | Auf dem Server |
|---|---|---|
| Was der Server von außen bekommt | nur das Editor-Level wie bisher (`sanitizeLevel`, Nachspielen) | fremde XML-/Lua-Datei |
| Umwandlung | fengari-Sandbox (nur `base`, `table`, `string`, `math`; ohne `dofile`, `loadfile`, `require`) im **Web Worker** mit Zeitgrenze | entweder die echte C++-Engine (SDL, Xerces, xvfb) auf dem VPS, also ein großer nativer Angriffsfläche-Block mit Enigmas eigener Lua 5.1, oder dasselbe fengari im Kindprozess |
| Neue Serverteile | keine (keine Migration, keine API, kein Kindprozess) | Endpunkt, Warteschlange, Kindprozess mit Zeit- und Speichergrenze, Größenlimit, Ratenbegrenzung, Migration |
| Offline / ohne Konto | Umwandeln, Probespielen und Teilen per Link gehen ohne Konto und offline; nur das Veröffentlichen braucht ein Konto (wie bisher) | nur mit Konto und Netz |
| Datenschutz | nichts Neues wird übertragen | neue Verarbeitung (Datei, IP, Konto) |

Der Browserweg ist **einfacher und sicherer**: Fremder Code läuft nur im Browser der Person, die die
Datei selbst gewählt hat, in derselben Sandbox wie die mitgelieferten Enigma-Levels. Der Server prüft
das Ergebnis mit der strengen Editor-Prüfung und dem Nachspielen. Ein manipulierter Browser kann
dadurch nichts einschleusen, was er nicht auch heute im Editor bauen könnte.

Die echte Engine auf dem Server wurde verworfen. Sie bringt mehr Objekte, aber eine native Angriffsfläche,
schwere Abhängigkeiten im Container und Ergebnisse, die trotzdem an `sanitizeLevel` scheitern, solange
Spieler-Levels nur Editor-Inhalte erlauben.

## Ablauf

```
Editor „Importieren“ (oder spielerlevels.html → „Enigma-Level umwandeln“ → Editor)
   └─ Datei wählen (.xml/.lua, ≤ 256 KB)
        ▼
Web Worker (Zeitgrenze 10 s, danach terminate)
   1. Datei lesen: DOCTYPE/ENTITY → Abbruch (kein XML-Parser, nur feste Muster: kein XXE möglich)
   2. Kopfdaten: Titel, Autor, Lizenz, Enigma-Kompatibilität, Bibliotheken, Lua-Teil (el:luamain)
   3. Lua im Aufbau-Modus: wo(ti, " ", karte), wo[pos] = …, wo:drawMap/drawRect/drawBorder, res.autotile;
      Grenzen: Weltgröße ≤ 60×40, ≤ 20 000 gesetzte Kacheln, Lua-Schrittgrenze
   4. Welt → Editor-Level: Arten der Palette, Oxyd-Farben, Start der schwarzen Murmel, Gegner
        ▼
Dialog: Vorschau (Titel, Größe, Autor und Lizenz laut Datei, Hinweise),
        Pflicht-Häkchen „Ich habe die Rechte …“ → „Im Editor öffnen“
        ▼
Editor: Probespielen (bestehend) → Veröffentlichen (bestehend, Konto, CC BY-SA 4.0)
```

## Sicherheit

| Punkt | Umsetzung |
|---|---|
| Größenlimit | Datei ≤ 256 KB (größte Enigma-Levels liegen unter 100 KB); Lua-Teil ≤ 200 KB; Welt ≤ 60×40; ≤ 20 000 Kachelaufrufe |
| XML ohne externe Entitäten (XXE) | Kein XML-Parser. Kopf und Lua werden mit festen Mustern gelesen; `<!DOCTYPE` oder `<!ENTITY` führt zum Abbruch. Nur die fünf Standard-Entitäten werden ersetzt. |
| Lua nur in der fengari-Sandbox | `LuaLevel.create` öffnet nur `base`, `table`, `string`, `math`. Der Aufbau-Modus löscht zusätzlich `dofile`, `loadfile`, `require`, `collectgarbage`. Keine Brücke zu Netz, DOM oder Speicher; die CSP (`connect-src 'self'`) gilt auch im Worker. |
| Zeit- und Speichergrenze | Web Worker (Muster Wettkampf-Worker): Lua-Schrittgrenze (20 Mio. Anweisungen, geprüft in 1000er-Schritten; im Browser rund 1 s), Abbruch des Workers nach 10 s. Ein Speicherüberlauf trifft nur den Worker; das Spiel meldet „Die Umwandlung wurde abgebrochen“. |
| Ratenbegrenzung, nur mit Konto | Umwandeln kostet den Server nichts. Veröffentlichen läuft über `POST /api/spielerlevels` mit Konto, 5 je 24 h, 5 wartende, gemeinsame Prüf-Warteschlange (bestehend). |
| Ergebnis | Der Server speichert nur, was `sanitizeLevel` durchlässt und dessen Lösung nachgespielt ist (bestehend). |

## Lizenz und Urheber

- Spieler-Levels stehen unter **CC BY-SA 4.0**. Enigma-Levels stehen meist unter GPL. Wer eine Datei
  umwandelt und veröffentlicht, muss die Rechte haben (eigenes Level oder Erlaubnis des Urhebers).
- Der Dialog zeigt **Autor und Lizenz laut Datei** und verlangt das Häkchen: „Ich habe dieses Level selbst
  gebaut oder die Erlaubnis des Urhebers, es unter CC BY-SA 4.0 zu veröffentlichen.“ Ohne Häkchen kein
  „Im Editor öffnen“.
- Der Titel kommt aus der Datei, der Autor des Editor-Levels bleibt leer. Beim Veröffentlichen nennt der
  Server wie bisher den Anzeigenamen; die Lizenzbestätigung im Veröffentlichen-Dialog bleibt.

## Was umgewandelt wird (Stufe 1)

- **Enigma-Lua-API 2** (Kompatibilität ≥ 1.10, der heutige Standard). API 1 (ältere Levels) meldet:
  „Dieses Level nutzt Enigmas alte Lua-API 1 (vor Enigma 1.10). Das Umwandeln kennt bisher nur API 2.“
- Bibliotheken, die Murmel mitbringt: `libmap`, `libmath`, `liblua`, `libpento`, `natmaze`. Andere →
  „Die Bibliothek lib/… fehlt in Murmel.“
- Böden, Wände, Objekte, Gegenstände und Gegner der **Editor-Palette**. Abbildungen:
  `st_oxyd`/`st_oxyd_a…e` mit `oxydcolor` → Farbe A…, ohne Farbe → `?` (Paar per Zufall wie in Enigma);
  `st_door_d` mit `faces="ew"` → `st_door_d_ew`; `ac_marble`/`ac_marble_black` → Start; Akteure sitzen in
  der Zellmitte (wie im Editor).
- Attribute: `name`, `target`, `action`, `interval`, `flavor` bleiben; andere werden als Hinweis genannt
  („nicht übernommen: state von st_switch …“). Das Probespielen zeigt, ob das Level so lösbar bleibt.

## Fehlermeldungen (immer mit dem Namen des fehlenden Teils)

| Fall | Meldung |
|---|---|
| Objekt nicht in der Palette | „Diese Objekte kann ein Spieler-Level noch nicht enthalten: it_document (2×), st_mirror …“ |
| Unbekannter Resolver | „Murmel kennt res.random noch nicht“ |
| Lua-Rückruf | „Das Level steuert st_switch über die Lua-Funktion ‚oeffne‘. Lua ist in Spieler-Levels nicht erlaubt.“ |
| Laufzeitfehler | „Fehler im Lua-Teil: <Meldung mit Zeile>“ |
| Weltgröße | „Das Level ist 80×50 groß; erlaubt sind höchstens 60×40.“ |
| Murmel | „Das Level braucht genau eine schwarze Murmel (gefunden: 0).“ |
| Endlosschleife / Zeit | „Der Lua-Teil läuft zu lange.“ / „Die Umwandlung wurde abgebrochen (Zeitgrenze).“ |

## Oberfläche

- **Editor:** „Importieren“ nimmt `.json`, `.xml`, `.lua`. Enigma-Dateien gehen in den Umwandlungsdialog.
- **`spielerlevels.html`:** Knopf „Enigma-Level umwandeln“ führt zu `editor.html#enigma`; der Editor zeigt
  dort einen Dialog mit „Datei wählen“ (Dateiwahl braucht einen Klick).
- Gestaltung: Dialoge und Stil des Editors (Skill `apple-design`), hell/dunkel, ab 320 px.

## Bausteine

| Stufe | Inhalt | Prüfung |
|---|---|---|
| U1 | `src/enigma-upload/datei.ts`: Datei lesen (Größe, XXE, Kopf, Lua, Bibliotheken) | vitest |
| U2 | `src/enigma-upload/welt.ts`: Aufbau-Modus (Lua → Welt) | vitest mit echtem fengari |
| U3 | `src/enigma-upload/editorlevel.ts`: Welt → Editor-Level, Fehler, Hinweise | vitest, `sanitizeLevel` des Ergebnisses |
| U4 | `client.ts` (Worker mit Zeitgrenze), `worker.ts`, `dialog.ts`, Einbindung in `src/editor/app.ts`, Link auf `spielerlevels.html` | vitest (Worker-Attrappe), Browser |

**Stand 14.11.2026:** U1–U4 gebaut (Branch `enigma-upload`). Geprüft: vitest (19 neue Tests: Dateilesen mit XXE/Größe/API 1/Bibliotheken, Aufbau-Modus mit echtem fengari, Übersetzung und `sanitizeLevel` des Ergebnisses, Worker-Zeitgrenze), Browser auf Port 5191 (Startdialog über `editor.html#enigma`, Umwandeln im echten Worker mit fengari-web in rund 0,9 s, Endlosschleife abgefangen, Rechte-Häkchen Pflicht, Level im Editor mit Verbindung Schalter → Tür, Probespielen startet, 375 px), Produktionsbuild (Worker als eigenes Bündel ohne `Function()`, also CSP-tauglich). Lokaler Probelauf über alle 1 566 Level-Dateien von Enigma (nicht eingecheckt): **49 lassen sich vollständig umwandeln**. Häufigste Gründe sonst: `res.composer` (160), keine schwarze Murmel (Meditation, 138), `ac_marble_white` (131), `it_document` (116), API 1 (115), libpento-Rückrufe (99), `lib/libpuzzle` (93), Größe über 60×40 (79), Gefälleböden `fl_slope_*`, `st_laser`, `st_stoneimpulse`. Nicht geprüft: ein echtes Veröffentlichen gegen den Server (der Weg ist der bestehende und unverändert) und ein von Hand gespielter Sieg.

**Nächste Schritte (wenn gewünscht):** `res.composer` im Aufbau-Modus nachbauen; die Editor-Palette um vorhandene Spielobjekte erweitern (betrifft auch Editor und `sanitizeLevel`, Server-Rollout nötig); API 1.

## Datenschutz

Keine neue Verarbeitung: Die Datei bleibt im Browser, veröffentlicht wird nur das Editor-Level über den
bestehenden Weg. Ein Satz zur Klarstellung wird dem Nutzer vorgeschlagen (Notiz der Sitzung); die
Datenschutzerklärung ändert sich nur nach seiner Freigabe.

## Grenzen

- **Immer:** Datei nur im Browser umwandeln; nur Editor-Inhalte veröffentlichen; Rechte-Häkchen.
- **Erst fragen:** Lua, Dokumenttexte oder Objekte außerhalb der Palette in Spieler-Levels; Umwandlung
  auf dem Server; Änderungen der Datenschutzerklärung.
- **Nie:** fremde Dateien auf dem Server ausführen; Lua mit Zugriff auf Netz, DOM oder Speicher.
