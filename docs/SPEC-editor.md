# Spec: `editor` – Leveleditor mit Teilen per Link

Baustein aus `docs/SERVER.md` Abschnitt 6, Phase A (ohne Server). Stand 13.11.2026.

## Ziel

Spieler bauen eigene Levels im Browser, spielen sie sofort probe und teilen sie als Link
(`murmel.games/#level=…`). Kein Konto, kein Server, offline voll nutzbar. Das spätere Hochladen,
Bewerten und Moderieren macht der Baustein `spielerlevels`.

## Ausgangslage

- Levelformat `LevelFile` und `parseLevel` (`src/game/level.ts`): Karte aus Zeichen plus Legende
  (Boden, Stein, Oxyd-Symbol/-Sorte), Objekte (`objects`, Türen, Schalter, Gegenstände …),
  Akteure (`actors`), Startpunkt (`start`). Beides bleibt **unverändert**.
- Objektklassen: `objectClass()` in `src/game/objects.ts`; Bilder des Stils „Klassisch“:
  `public/enigma/gfx32/<name>.png` (Enigma, GPL), Retro-Satz `gfx32-retro`.
- Verbindungen: eine Quelle (Schalter, Trigger, Zeitgeber) hat `target` = Name des Ziels und
  optional `action` (`toggle` Vorgabe, `open`, `close`); das Ziel (Tür) trägt `name`.

## Umfang

### 1. Editorseite `editor.html` (`src/editor/…`)

- Neues Level: 20×13, Rand aus Granit, Boden `fl_gray`, Murmel in der Mitte.
- Größe ändern: Breite 5–60, Höhe 5–40; Inhalt bleibt oben links verankert.
- Werkzeuge: **Malen** (Klick und Ziehen), **Rechteck** (Ziehen füllt; auch Umschalt+Ziehen),
  **Radierer** (entfernt Akteur, Gegenstand und Stein der Zelle; Boden bleibt),
  **Auswahl** (Objekt anklicken → Eigenschaften), **Pipette** per Rechtsklick/Alt+Klick.
- Ebenen je Zelle: Boden (immer), Stein (Wand, Objektstein oder Oxyd), Gegenstand; dazu
  Akteure (Zellmitte) und genau eine Murmel (Start).
- **Oxyd-Steine paarweise:** Farbwahl A–H oder „Zufall“ (`?`). Im Modus „Automatisch“ bekommt
  der nächste Stein die Farbe, der noch ein Partner fehlt, sonst eine neue Farbe. Jede Farbe ist
  in der Karte sichtbar (Farbpunkt mit Buchstabe). Sorte (Aussehen) a–d wählbar.
- Titel und Autor im Kopf; der Hinweis „Geteilte Levels sind öffentlich.“ steht beim Teilen.
- **Rückgängig/Wiederholen** (Strg+Z / Strg+Y bzw. Strg+Umschalt+Z, Knöpfe): ein Strich oder
  ein Rechteck ist ein Schritt; bis 200 Schritte.
- Bedienung mit Maus und Touch (Pointer Events). Auf dem Handy: ansehen, einfache Änderungen,
  probespielen, teilen; die Palette ist dort eine waagerechte Leiste.

### 2. Palette

- Nur Arten, die Murmel kann: kuratierte Liste (`src/editor/palette.ts`). Ein Test sichert,
  dass jeder Boden in `floors.generated.json` steht, jeder Objektstein/Gegenstand eine
  `objectClass` hat, jede Wand **keine** hat, und jedes Vorschaubild existiert.
- Gruppen: Spezial (Murmel, Oxyd), Böden, Wände, Bewegliche Steine, Schalter und Türen,
  Gefahren, Gegenstände, Gegner. Suche über deutschen Namen und Enigma-Art.
- Vorschau im gewählten Stil: „Klassisch“ und „Klassisch Retro“ mit den Enigma-Bildern;
  für die eigenen 3D-Stile (Glas, Neon, Retro16) eine flache Schema-Ansicht mit den
  Symbolfarben und -formen der Oxyd-Steine. Der Stil wird aus dem Spiel übernommen und ist
  umschaltbar.

### 3. Verbindungen (keine Texteingabe, kein Lua)

- Ziele (Türen) bekommen beim Setzen automatisch einen Namen (`tuer1`, `tuer2` …).
- Eine Quelle auswählen → Liste „Ziel“ mit allen Türen (Name und Position) oder „Ziel auf der
  Karte antippen“; Liste „Aktion“: umschalten / öffnen / schließen.
- Verbindungen sind als Linien in der Karte sichtbar. Lua wird nie erzeugt.

### 4. Probespielen

- Knopf „Probespielen“: der Editor speichert seinen Stand (Entwurf in `localStorage`) und öffnet
  `./#level=…&edit` im Spiel. Das Spiel zeigt „Zurück zum Editor“; der Editor stellt den
  Entwurf samt Rückgängig-Verlauf (Sitzungsspeicher) wieder her.
- Probespielen braucht nur ein ladbares Level (`parseLevel` ohne Fehler); die übrigen Prüfungen
  gelten fürs Teilen.

### 5. Prüfung vor dem Teilen (`src/editor/rules.ts`)

Fehler (blockieren das Teilen):
- keine Murmel; Murmel auf Stein oder auf Abgrund/Wasser;
- weniger als zwei Oxyd-Steine; eine feste Farbe ungerade oft; ungerade Zahl von `?`-Steinen;
- ein Oxyd-Stein ist von der Murmel aus nicht erreichbar – Prüfung als Flutfüllung über
  4-Nachbarn, die **nur feste Wände** als Hindernis zählt (Türen, Kisten, Abgrund gelten als
  passierbar; die Prüfung meldet also nur sicher Unerreichbares);
- eine Verbindung zeigt auf ein Ziel, das es nicht gibt;
- `parseLevel` meldet einen Fehler;
- Titel fehlt.

Hinweise (blockieren nicht): Oxyd-Stein nur über Abgrund/Wasser erreichbar; Schalter ohne Ziel;
offener Rand (die Murmel kann hinausrollen).

### 6. Teilen per Link (`src/editor/link.ts`)

- Format: `#level=1.<daten>`; `<daten>` = base64url( deflate-raw( kompaktes JSON ) ) mit
  `CompressionStream` (Browser und Node ≥ 18). Das JSON ist ein `LevelFile` ohne `id`/`license`.
- Grenzen: über 2 000 Zeichen Hinweis „langer Link, manche Messenger kürzen ihn“; über 16 000
  Zeichen kein Link, stattdessen Datei-Export empfohlen.
- Dekodieren ist streng (Links sind fremde Eingaben): Länge ≤ 16 000, entpackt ≤ 512 KB, nur
  bekannte Felder (`title`, `author`, `map`, `legend`, `start`, `objects`, `actors`), nur Arten
  aus der Palette, nur bekannte Attribute, Größe ≤ 60×40, Textlängen begrenzt; **nie Lua**,
  keine Dokumenttexte. Danach `parseLevel`. Jeder Fehler ergibt eine verständliche Meldung,
  nie eine Ausnahme im Spiel.
- ID eines Link-Levels: `link:<FNV-1a-Hash der Daten>` – so kollidiert es nie mit Paketlevels.
- Im Spiel: Ein Link `#level=…` startet das Level (Paket „Geteiltes Level“) mit dem Knopf
  „Im Editor öffnen“. Link-Levels zählen nicht in Fortschritt, Statistik und Bestenlisten.

### 7. Lokal speichern

- „Meine Levels“ im Browser (`localStorage` `murmel.editor.levels`): speichern, öffnen, löschen
  (mit Rückfrage).
- Export als `<titel>.murmel.json` (das `LevelFile`), Import einer solchen Datei (gleiche strenge
  Prüfung wie beim Link).

## Nicht-Ziele

Server, Hochladen, Bewertung (Baustein `spielerlevels`); Lua; Dokumenttexte; Wurmlöcher und
andere Objekte mit Koordinaten-Attributen; mehrere Murmeln. Lizenz der Spieler-Levels bleibt
offene Frage in `SERVER.md`; das `license`-Feld lautet „Spieler-Level“.

## Berührung bestehender Dateien

- `src/main.ts`: wenige Zeilen (Link beim Start und bei `hashchange` laden, Knöpfe „Im Editor
  öffnen“/„Zurück zum Editor“, Link-Levels ohne Fortschritt). Die Logik liegt in
  `src/editor/game-link.ts`.
- `src/packs.ts`: Paket für das geteilte Level registrieren.
- `vite.config.ts`: Eingang `editor.html`. `LevelFile`/`parseLevel` unverändert.

## Tests (vitest)

- Link: Rundreise (Level → Link → Level gleich), Grenzen (Länge, Größe), kaputte Links
  (falsches Präfix, kein base64, kein deflate, kein JSON, fremde Arten, Lua wird verworfen).
- Prüfregeln: jede Regel einzeln.
- Rückgängig/Wiederholen: Verlauf, Grenze, Verzweigung verwirft Wiederholen.
- Modell: `LevelFile` ↔ Editor-Modell, ein erzeugtes Level läuft in `GameSession` (Ladeprobe).
- Browser (Port 5181): Level bauen, probespielen, zurück, per Link teilen und öffnen.

## Abnahme

Spezifikation, Editor, Link-Teilen und Tests stehen; `npm run build` und `npm test` grün;
PR offen.
