# Spec: `lokal` – Bestzeiten, Statistik, Fortschritt sichern

Baustein aus `docs/SERVER.md` (Phase A, ohne Server). Stand 13.11.2026.

## Ziel

Spieler sehen ihren Fortschritt und ihre Bestleistungen je Level und können ihn sichern und auf
ein anderes Gerät mitnehmen – ohne Konto und ohne Server. Später gleicht `sync` genau diese Daten
mit dem Server ab, `bestenliste` übernimmt die Aufzeichnung des besten Laufs.

## Ausgangslage

- `localStorage` (`store` in `main.ts`) hält heute: gelöste Level-IDs (`solved`, `solvedPacks`),
  letztes Paket/Level, Stil, Mausgeschwindigkeit.
- Beim Sieg zeigt das Spiel Zeit und Abstürze, speichert sie aber nicht.

## Umfang

1. **Ergebnis je Level** (Schlüssel: Level-ID), beim Sieg gespeichert:
   `{ best: { steps, falls, date, seed, rec? }, solves, attempts, lastPlayed }`
   - Bestzeit = **Physikschritte** (`steps × PHYSICS_DT`), nicht Uhrzeit – gleich auf jedem Gerät
     und später durch Nachspielen prüfbar.
   - Bei gleicher Zeit gewinnt der Lauf mit weniger Abstürzen.
   - `rec`: Aufzeichnung des besten Laufs (`src/game/recording.ts`), sobald A3/A4 eingebunden sind.
2. **Anzeige**
   - Siegmeldung: „Zeit 1:23,4 – neue Bestzeit!“ oder „Bestzeit 1:12,0“.
   - Levelliste: Haken plus Bestzeit je Level; je Paket „12/40 gelöst“ (gibt es schon).
   - Filter in der Levelliste: alle / ungelöst / gelöst.
3. **Statistik** (Seite im Menü): gelöste Levels gesamt und je Paket, Spielzeit gesamt, Abstürze
   gesamt, zuletzt gespielt.
4. **Sichern und Laden**: „Fortschritt sichern“ lädt `murmel-fortschritt-JJJJ-MM-TT.json` herunter;
   „Fortschritt laden“ liest eine solche Datei und **führt zusammen** (gelöst bleibt gelöst, die
   bessere Zeit gewinnt) – nie stilles Überschreiben.
5. **Datenschutz**: alles bleibt im Browser; die Datenschutzerklärung nennt die neuen Daten.

## Datenformat (Datei und Speicher, Version 1)

```json
{ "v": 1, "app": "murmel", "saved": "2026-11-13T12:00:00Z",
  "levels": { "enigma:ant03_3": { "best": { "steps": 16420, "falls": 0, "date": "…", "seed": 123 },
                                  "solves": 3, "attempts": 7, "lastPlayed": "…" } },
  "solved": ["…"] }
```

Beim Laden werden Felder geprüft (Zahlen, Längen, bekannte Schlüssel); unbekannte oder kaputte
Einträge werden übersprungen und gemeldet.

## Struktur

- `src/game/progress.ts` – reines Modul: Ergebnis eintragen, zusammenführen, Datei lesen/schreiben,
  Prüfung (Tests in `progress.test.ts`).
- `main.ts` – nur Anbindung: beim Sieg eintragen, Anzeige, Menüpunkte.

## Tests und Abnahme

- [ ] Bessere Zeit ersetzt, schlechtere nicht; Gleichstand → weniger Abstürze gewinnt.
- [ ] Zusammenführen ist kommutativ (A+B = B+A) und verliert keinen gelösten Level.
- [ ] Kaputte/fremde Datei wird abgelehnt oder teilweise übernommen, ohne den Bestand zu ändern.
- [ ] Browser: Level lösen → Bestzeit in Siegmeldung und Levelliste; sichern → Datei; in leerem
      Profil laden → Fortschritt da.

## Grenzen

- **Immer:** vorhandener Fortschritt (`solved`) bleibt erhalten (Übernahme beim ersten Start).
- **Erst fragen:** Änderungen an der Datenschutzerklärung (Text vor Veröffentlichung zeigen).
- **Nie:** Daten ohne Zutun des Spielers an einen Server schicken.

## Abhängigkeit

Teil 1–4 gehen ohne A3; `rec` (beste Aufzeichnung) und die Schrittzeit kommen mit A3.
`main.ts`-Anbindung erst nach dem Push der Integrationssitzung (wie A3).
