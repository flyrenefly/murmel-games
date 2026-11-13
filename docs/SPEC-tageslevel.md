# Spec: `tageslevel` – Tageslevel und Wochenaufgabe

Baustein aus `docs/SERVER.md` (Phase D, Abschnitt 10). Grundlagen: `docs/SPEC-bestenliste.md`
(Einreichen, Nachspielen, Warteschlange), `docs/SPEC-loesbarkeit.md` (Nachtlauf). Stand 13.11.2026.

**Stand 13.11.2026:** T1–T2 gebaut (Branch `tageslevel`). Geprüft: `node --test` (Zeiträume mit
Zeitumstellung und Jahreswechsel, Auswahl, API mit Speicher-Store, Levelkatalog aus dem echten Spielcode;
PostgreSQL-Teil in der CI), vitest, Edge headless mit nachgebildeter API (Zeilen in der Levelliste,
Startkarte, Startwert über Neustarts, Einreichen nach Sieg mit Platz, anderes Level beendet die Aufgabe).
Nicht geprüft: echte Tagesrangliste auf dem Server. T3 wartet auf Freigabe des Textes.

## Ziel

Jeden Tag spielen alle dasselbe Level mit demselben Zufall, dazu jede Woche eine Wochenaufgabe. Jede
Aufgabe hat eine eigene Rangliste mit nachgespielten Zeiten. Ohne Konto und offline spielt man das
Level wie jedes andere, nur ohne Tagesrangliste.

## Auswahl (Nutzerentscheidung 13.11.2026: gelöste zuerst)

- **Zeiträume:** Tag = Kalendertag in Berlin (`2026-11-13`), Woche = ISO-Woche in Berlin (`2026-W46`,
  Montag 0 Uhr bis Sonntag 24 Uhr).
- **Wer wählt:** der Server, beim ersten Abruf eines Zeitraums; die Wahl wird gespeichert und bleibt.
- **Pool, in dieser Reihenfolge:**
  1. *Nachweislich lösbar:* Level mit gewinnender Lösung im neuesten Nachtlauf oder mit mindestens
     einem Bestenlisten-Eintrag, das in den letzten 60 Tagen weder Tages- noch Wochenlevel war;
  2. sonst jedes Level mit bestandener Ladeprobe (`ok`) im neuesten Nachtlauf, ebenfalls 60 Tage frei;
  3. sonst jedes Level mit bestandener Ladeprobe.
  Ohne Nachtlauf zählt jedes Level des Spiels als „Ladeprobe bestanden“. Spieler-Levels sind nie dabei.
- **Zufall:** aus SHA-256 von Art und Zeitraum (`tag:2026-11-13`), daraus auch der Startwert des Laufs.
  Dieselbe Eingabe ergibt dieselbe Wahl; die gespeicherte Wahl hat Vorrang.

## Rangliste

- Ein Eintrag je Konto und Aufgabe, nur der beste Lauf zählt; Reihenfolge wie bei der Bestenliste
  (Schritte, dann Zeitpunkt, dann Id). Gesperrte Konten erscheinen nicht.
- **Einreichen:** wie bei der Bestenliste über die gemeinsame Warteschlange; der Server prüft vorher:
  Aufgabe ist aktuell (oder seit höchstens 15 Minuten vorbei), Level und Startwert passen zur Aufgabe.
  Maßgeblich ist die nachgespielte Zeit. Das Ergebnis holt das Spiel über
  `/api/bestenliste/pruefung/:id`.
- Grenzen wie bei der Bestenliste (Größe, Länge, offene Prüfungen je Konto, Warteschlange gesamt);
  30 Einreichungen je Konto und Stunde für Tages- und Wochenaufgabe zusammen.
- Die Aufzeichnung wird gespeichert wie bei der Bestenliste (nur der beste Lauf, nicht öffentlich,
  gelöscht mit dem Konto). Einträge älter als 400 Tage löscht der Server.

## API

| Methode | Pfad | Wer | Inhalt |
|---|---|---|---|
| GET | `/api/tageslevel` | alle | `{ tag, woche }`, je `{ art, zeitraum, level, pack, index, titel, seed, bis, anzahl, top: [{ platz, name, zeit }], ich: { platz, zeit } | null }`, Top 10 |
| POST | `/api/tageslevel/lauf` | Konto (nicht gesperrt) | `{ art, zeitraum, ...Aufzeichnung }` → 202 `{ id }` |

Ohne Spielcode (`GAME_DIR`) antwortet `GET` mit 503; das Spiel zeigt dann keine Aufgaben.

## Oberfläche (Skill `apple-design`, Stil der Levelliste)

- **Levelpakete:** über den Paketen zwei Zeilen „Heute · *Titel*“ und „Diese Woche · *Titel*“, darunter
  klein Paket und, falls vorhanden, der eigene Platz („Platz 3 von 12“) oder „gelöst“. Sie erscheinen, sobald
  die Antwort da ist; offline fehlen sie.
- **Spielen:** öffnet das Level mit dem Startwert der Aufgabe; „Nochmal“ und Neustarts behalten ihn.
  Die Startkarte zeigt „Tageslevel 13.11.“ bzw. „Wochenaufgabe KW 46“.
- **Sieg:** zusätzlich eine Zeile „Tageslevel: wird geprüft …“ → „Tageslevel: Platz 2 von 9“
  (bzw. Grund). Ohne Konto: „Anmelden, um in die Tagesrangliste zu kommen.“

## Bausteine

| Stufe | Inhalt | Prüfung |
|---|---|---|
| T1 | `server/src/tageslevel.ts`: Zeiträume, Auswahl (rein, getestet), Routen; Migration `011_tageslevel.sql`; Stores DB und Speicher; Levelkatalog aus dem Prüfprozess | `node --test`, DB-Teil in der CI |
| T2 | Spiel: `src/tageslevel.ts`, Zeilen in der Levelliste, Startwert, Siegzeile | vitest, Edge headless mit nachgebildeter API |
| T3 | Datenschutz: Satz im Abschnitt „Bestenlisten“ – **erst nach Freigabe** | – |
| T4 (später) | Erinnerung per Web Push – eigene Entscheidung und Datenschutz | – |

## Grenzen

- **Immer:** Spiel ohne Konto und offline voll spielbar; nachgespielte statt gemeldeter Zeiten; Tests zuerst.
- **Erst fragen:** Datenschutztext; Web Push.
- **Nie:** Mailadressen zeigen; Spieler-Levels als Tageslevel.
