# Spec: `tipps` – den nächsten Schritt aus einer gespeicherten Lösung zeigen

Baustein aus `docs/SERVER.md` („Bei langem Hängen den nächsten Schritt aus einer gespeicherten Lösung
zeigen“). Grundlagen: `docs/SPEC-aufzeichnung.md` (Aufzeichnung, Nachspielen), `docs/SPEC-geister.md`
(Geist im Gleichschritt), `docs/SPEC-loesbarkeit.md` (gespeicherte Lösungen). Stand 13.11.2026.

**Stand 13.11.2026:** T1–T4 gebaut (Branch `tipps`). Geprüft: vitest (Fahrplan aller 29 Repo-Lösungen
bis zum Sieg, Fortschritt nach dem ersten Paar, Abschnitt, Fenster, Tipp-Geist im Gleichschritt, kein Tipp
ohne Lösung, Hängen-Erkennung), `node --test` (API mit Speicher-Store; PostgreSQL-Teil nur in der CI),
Browser Port 5187 an Level 01 (Satz, Weg ab Levelanfang und ab Schritt 3205 nach dem ersten Paar,
Neustart setzt zurück, Pausemenü, „kein Tipp“ in Enigma II/1, Siegmeldung ohne Bestenliste).
Nicht geprüft: Gegenstand-Stationen mit echten Lösungen (keine der 29 sammelt etwas ein; nur mit
künstlichen Fahrplänen getestet), das Erscheinen von „Tipp?“ nach echten 3 Minuten im Browser, der
Endpunkt gegen den echten Server.

## Ziel

Wer in einem Level lange nicht weiterkommt, kann sich den **nächsten Schritt** zeigen lassen: erst als
kurzen Satz („Als Nächstes: Schlüssel einsammeln“), auf Wunsch als **Geist-Murmel**, die den Weg aus
einer gespeicherten Lösung ab dem passenden Stand vorfährt. Das Spiel bleibt ohne Konto und offline
voll spielbar; Tipps sind nie aufdringlich.

## Lösungen als Quelle

1. **Im Build:** die Lösungen aus `solutions/` (heute 29). Jede Datei ist ein eigener kleiner Baustein
   des Builds, geladen erst beim ersten Tipp für ihr Level; der Service Worker hält sie offline vor.
   Zuordnung wie `tools/lib/solutions.mjs`: `solutions/murmel/01.json` → `01`,
   `solutions/enigma/m_tutor/m_tut1.json` → `enigma:m_tutor/m_tut1`.
2. **Online dazu:** Admin-Lösungen vom Server (Tabelle `solutions`), über einen **öffentlichen**
   Endpunkt, der nur Aufzeichnungen ausliefert (siehe API).
3. Eine Lösung gilt erst, wenn sie im Browser **nachgespielt bis zum Sieg** kommt (dieselbe Prüfung wie
   der Nachtlauf, nur für ein Level). Passt keine (Level geändert, anderes Level), gibt es keinen Tipp.
4. **Ohne Lösung** erscheint der Hinweis „Tipp?“ nie. Wer über Pausemenü oder Taste fragt, liest
   „Für dieses Level gibt es noch keinen Tipp.“ (Ob es eine Lösung gibt, steht erst nach dem Nachspielen
   fest; darum steht „Tipp“ im Pausemenü immer.)

## Stationen und Fortschritt

Beim ersten Tipp eines Levels wird die Lösung einmal ohne Grafik nachgespielt (in Häppchen, damit das
Bild nicht hängt). Dabei entsteht ein **Fahrplan**: die Schritte, an denen die Lösung eine **Station**
erreicht:

| Station | erkannt an | Satz |
|---|---|---|
| Oxyd-Paar | zwei Steine werden `solved` | „Als Nächstes: ein Oxyd-Paar – oben links und unten rechts.“ |
| Gegenstand | ein Name kommt zum ersten Mal ins Inventar | „Als Nächstes: Schlüssel einsammeln.“ |
| Perle | eine Perle mehr liegt in einer Mulde | „Als Nächstes: eine Perle in eine Mulde.“ |
| Ziel | Sieg (immer die letzte) | „Als Nächstes: der Weg ins Ziel.“ |

Die **Lage des Spielers** (eigene gelöste Steine, Paarzahl, Inventar, Perlen) bestimmt, welche Station
als nächste fehlt: die **erste nicht erreichte**.

- Ein **Paar** ist erreicht, wenn der Spieler genau diese beiden Steine gelöst hat. Sind die beiden für
  den Spieler kein Paar (zufällige Farben je Startwert, `?` oder Mischen), zählt die Paarzahl: das
  k-te Paar der Lösung ist erreicht, sobald der Spieler k Paare hat. Der Satz nennt dann keine Orte
  („ein weiteres Oxyd-Paar“).
- Ein **Gegenstand** ist erreicht, wenn er im Inventar liegt **oder** eine spätere Paar- oder
  Perlen-Station erreicht ist (er kann inzwischen verbraucht sein).
- **Perlen** zählen: die k-te Perlen-Station ist erreicht, sobald k Perlen in Mulden liegen.
- Ortsangabe eines Steins: Drittel der Levelbreite und -höhe („oben links“, „Mitte“, „unten rechts“).

Damit beginnt ein Tipp nicht immer am Levelanfang, sondern am **Abschnitt** von der zuletzt erreichten
Station bis zur nächsten.

## Gezeigter Weg

- Der Geist ist ein `Geist` (`src/game/geist.ts`) mit der Lösung, **vorgespult** bis zum Anfang des
  Abschnitts, danach **im Gleichschritt** mit dem eigenen Lauf: je eigenem Physikschritt ein Schritt
  der Lösung (er steht, wenn das Spiel pausiert).
- Gezeigt wird bis zur Station plus 1 s, **höchstens 15 s**. Ist der Abschnitt länger, zeigt der
  nächste Tipp die **nächsten 15 s** desselben Abschnitts; danach beginnt er wieder vorn.
- Der Geist ist nur Anzeige: eigene Sitzung, eigener Zufall, er ändert den eigenen Lauf nie.
- Ein gewählter Renn-Geist (`SPEC-geister.md`) läuft unabhängig weiter.

## Ablauf und Oberfläche (Skill `apple-design`, Stil der bestehenden Menüs)

- **Wann der Hinweis erscheint:** nach **3 Minuten Spielzeit ohne Fortschritt** (gleiche Lage) oder
  nach **5 Abstürzen ohne Fortschritt**, nur wenn eine Lösung bekannt ist (lokal sofort; vom Server
  erst nach erfolgreicher Prüfung). Neuer Fortschritt setzt die Uhr zurück.
- **Hinweis:** ein kleiner Knopf „Tipp?“ in der Kopfleiste neben „Neustart“, ruhig eingeblendet
  (Deckkraft, 200 ms, bei `prefers-reduced-motion` ohne Übergang). Kein Ton, kein Blinken, kein Dialog.
- **Jederzeit:** Pausemenü „Tipp“ (Esc), Taste **H**.
- **Stufe 1:** Der Tipp öffnet die Karte „Tipp“ mit dem Satz zur nächsten Station und den Knöpfen
  „Weg zeigen“, „Weiterspielen“.
- **Stufe 2:** „Weg zeigen“ schließt die Karte, das Spiel läuft weiter und der Geist fährt vor;
  ein Toast sagt „Der Geist zeigt den Weg.“. Der Knopf „Tipp?“ bleibt sichtbar; ein weiterer Druck
  holt die Karte wieder (dort heißt es dann „Weiter zeigen“).
- **Siegmeldung:** eine Zeile „Mit 2 Tipps gelöst.“ (nur Sätze) oder „Mit einem gezeigten Weg gelöst –
  dieser Lauf zählt nicht für die Bestenliste.“
- Zu zweit gibt es keine Tipps.

## Zählen und Bestenliste (Entscheidung)

- Gezählt wird **je Lauf** die Zahl der Tipps, die den Weg gezeigt haben (Stufe 2) und die der Sätze
  (Stufe 1); beides beginnt bei jedem Neustart von vorn. Gespeichert wird nichts davon.
- **Entscheidung:** Ein Lauf mit gezeigtem Weg (Stufe 2) wird **nicht** in die Bestenliste und nicht
  in die Tages- oder Wochenaufgabe eingereicht; die Siegmeldung sagt das. Er zählt sonst wie jeder
  Lauf (gelöst, eigene Bestzeit im Browser, eigener Geist). Ein reiner Satz (Stufe 1) ändert nichts.
- **Begründung** (statt „zählen, aber markieren“): Die Bestenliste misst die Zeit des eigenen Wegs.
  Wer den Weg einer gespeicherten Lösung nachfährt, fährt genau das, worum es dort geht; eine Marke
  würde trotzdem Plätze verschieben und bräuchte eine neue Spalte, Migration, Prüfung im Server und
  Anzeige auf der Rangliste, also Änderungen im Bereich, den gerade die Kontensitzung anfasst. Ohne
  Einreichen bleibt die Rangliste ehrlich, und für den Spieler ändert sich nichts außer dem Platz.
  Der Satz der Stufe 1 verrät keinen Weg, darum bleibt er ohne Folgen.

## API

| Methode | Pfad | Wer | Inhalt |
|---|---|---|---|
| GET | `/api/tipps/loesungen?level=…` | alle | `{ loesungen: [Aufzeichnung, …] }`: höchstens 3 Admin-Lösungen des Levels, kürzeste zuerst |

- Ausgeliefert werden nur die bekannten Felder einer Aufzeichnung (`v, level, seed, dt, steps,
  result, input`, wie `parseRecording`); **kein Konto, keine ID, kein Datum**.
- `Cache-Control: public, max-age=3600`; Anfragen je Adresse begrenzt (60 je Minute), Antwort 429.
- Ohne Lösung `{ loesungen: [] }`. Keine Migration nötig (Tabelle `solutions` aus `005`).

## Datenschutz

Ausgeliefert werden nur Eingabeaufzeichnungen, die Admins als Lösung gespeichert haben, ohne Konto-
bezug. Die Anfrage enthält nur die Level-Kennung; der Server protokolliert wie immer nur Methode und
Pfad. Es kommen **keine neuen Personendaten** hinzu, die Datenschutzerklärung bleibt unverändert.
Tipps und ihr Zähler bleiben im Arbeitsspeicher des Browsers.

## Bausteine

| Stufe | Inhalt | Prüfung |
|---|---|---|
| T1 | `src/game/tipp.ts`: Fahrplan, Lage, Abschnitt, Fenster, Satz, Tipp-Geist | vitest mit echten Levels und Lösungen |
| T2 | `src/tipps.ts`: Lösungen aus dem Build und vom Server, Prüfung, Hängen-Erkennung | vitest |
| T3 | Server: `server/src/tipps.ts`, Store-Methode `levelSolutions` (DB und Speicher) | `node --test`, DB-Teil in der CI |
| T4 | Spiel: Kopfleisten-Knopf, Pausemenü, Karte, Geist, Siegmeldung, Einreichen aus | Browser (Port 5187) |

## Grenzen

- **Immer:** ohne Konto und offline voll spielbar; Tipp nur auf Wunsch; Tests zuerst.
- **Erst fragen:** Text der Datenschutzerklärung, falls doch Daten hinzukommen.
- **Nie:** Kontodaten oder Lösungen fremder Spieler ausliefern; Läufe mit gezeigtem Weg einreichen.
