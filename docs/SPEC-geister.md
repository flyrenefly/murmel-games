# Spec: `geister` – gegen einen gespeicherten Lauf spielen

Baustein aus `docs/SERVER.md` (Phase D, Abschnitt 10). Grundlagen: `docs/SPEC-aufzeichnung.md`
(Aufzeichnung, Nachspielen), `docs/SPEC-bestenliste.md` (gespeicherte Läufe je Konto und Level).
Stand 13.11.2026.

**Stand 13.11.2026:** G1–G3 gebaut (Branch `geister`). Geprüft: vitest (Geist im Gleichschritt mit der
Lösung von Level 01, Client), `node --test` (API mit Speicher-Store; PostgreSQL-Teil nur in der CI),
Edge headless (eigener Lauf aus IndexedDB als Geist, Geist im Ziel bei genau 5808 Schritten wie die
Lösung, „Gegen diesen Lauf“ und Vergleichszeile nach einem Sieg, Kontoschalter mit nachgebildeter API).
Nicht geprüft: fremde Geister gegen den echten Server, Kontoschalter mit echtem Konto. G4: Absatz
„Geister“ in datenschutz.html vom Nutzer freigegeben und eingetragen.

## Ziel

Beim Spielen läuft ein gespeicherter Lauf als **durchscheinende Murmel** mit. Man sieht jederzeit,
ob man vor oder hinter dem Lauf liegt. Am Ende sagt die Siegmeldung, um wie viel man schneller oder
langsamer war.

## Wessen Läufe (Nutzerentscheidung 13.11.2026)

- **Der eigene beste Lauf immer.** Ohne Konto aus diesem Browser, mit Konto auch der eigene
  Bestenlisten-Eintrag vom Server.
- **Fremde Läufe nur mit Freigabe.** Spieler schalten in ihrem Konto „Meine Läufe als Geist zeigen“
  ein (Standard aus). Erst dann sind ihre Bestenlisten-Läufe für andere als Geist abrufbar. Wird der
  Schalter ausgeschaltet, sind sie sofort wieder privat. Gesperrte Konten erscheinen nie.

## Wie ein Geist läuft

- Ein Geist ist ein **zweiter Spiellauf** (`GameSession`) desselben Levels mit dem Startwert der
  Aufzeichnung, ohne Ton und ohne Oberfläche. Er bekommt Schritt für Schritt die aufgezeichneten
  Eingaben und läuft **im Gleichschritt** mit dem Spieler: Nach jedem Bild hat er genauso viele
  Physikschritte gerechnet wie der eigene Lauf (höchstens 400 Schritte Aufholen je Bild).
- Gezeichnet wird nur seine **gesteuerte Murmel**, halbtransparent wie der Partner im Wettrennen.
  Seine Welt (Steine, Gegner) bleibt unsichtbar.
- Ist der Geist im Ziel, verschwindet er; ein kurzer Hinweis zeigt seine Zeit.
- Neustart des Levels startet auch den Geist neu. Beim Wechsel des Levels ist der Geist aus.
- Passt die Aufzeichnung nicht (anderes Level, ungültig), gibt es keinen Geist und einen Hinweis;
  das Spiel läuft normal.

## Oberfläche (Skill `apple-design`, Stil der bestehenden Menüs)

- **Levelstart:** Knopf „Mit Geist“, sobald ein Geist für das Level denkbar ist. Er öffnet eine
  Auswahl: „Deine Bestzeit 0:45,2“ (lokal oder Server, der bessere), darunter freigegebene Läufe
  anderer aus der Rangliste („Platz 1 · Name · 0:38,9“, höchstens 10), „Ohne Geist“. Die Auswahl
  wird erst beim Öffnen vom Server geholt; offline steht nur der lokale Lauf da.
- **Siegmeldung:** eine Zeile „Geist: 0:45,2 – du warst 1,3 s schneller“ (bzw. „langsamer“,
  „gleich schnell“) und der Knopf „Gegen diesen Lauf“: startet das Level neu mit dem eben
  gewonnenen Lauf als Geist (geht ohne Konto und offline).
- **Konto:** Schalter „Meine Läufe als Geist zeigen“ mit einem Satz Erklärung.

## Speicherung

- **Lokal:** Der eigene beste Lauf je Level liegt in IndexedDB (`murmel-geister`, ein Eintrag je
  Level, nur bei neuer Bestzeit überschrieben). Gehört zur Spielspeicherung im Browser; der Absatz
  in der Datenschutzerklärung kommt mit G4.
- **Server:** keine neuen Aufzeichnungen. Migration `010_geister.sql` (`008` ist frei gelassen, `009` hat `spielerlevels`): Tabelle
  `ghost_consent (account_id primary key → accounts on delete cascade, created_at)`.

## API

| Methode | Pfad | Wer | Inhalt |
|---|---|---|---|
| GET | `/api/geister/freigabe` | Konto | `{ an: boolean }` |
| PUT | `/api/geister/freigabe` | Konto | `{ an: boolean }` → 204 |
| GET | `/api/geister/level?id=…` | alle | `{ geister: [{ id, name, zeit, platz, ich }] }`: der eigene Eintrag und freigegebene der Top 100, höchstens 10 fremde, nach Platz |
| GET | `/api/geister/lauf/:id` | alle | Aufzeichnung, wenn eigener Eintrag oder Eigentümer freigegeben und nicht gesperrt; sonst 404 |

Die Lauf-Antwort ist `Cache-Control: private, max-age=300`. Mailadressen kommen nie vor.

## Bausteine

| Stufe | Inhalt | Prüfung |
|---|---|---|
| G1 | `src/game/geist.ts`: Geist im Gleichschritt, Zeitvergleich | vitest mit echtem Level und Aufzeichnung |
| G2 | Server: `010_geister.sql`, `server/src/geister.ts`, Store-Methoden in DB und Speicher | `node --test`, DB-Teil in der CI |
| G3 | Spiel: lokaler Speicher, Auswahl beim Start, Siegmeldung, Kontoschalter | vitest, Browser (Edge headless) |
| G4 | Datenschutzerklärung: Absatz „Geister“ – **erst nach Freigabe durch den Nutzer** | – |

## Grenzen

- **Immer:** ohne Konto und offline voll spielbar; der Geist ändert nie den eigenen Lauf (eigene
  Sitzung, eigener Zufall); Tests zuerst.
- **Erst fragen:** Text der Datenschutzerklärung; fremde Läufe ohne Freigabe zeigen.
- **Nie:** Mailadressen zeigen; Läufe gesperrter Konten ausliefern.
