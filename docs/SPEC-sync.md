# Baustein `sync`: Fortschritt auf allen Geräten

Planung: `docs/SERVER.md` Abschnitt 5. Baut auf `lokal` (`docs/SPEC-lokal.md`, `src/game/progress.ts`)
und `konten` (`docs/SPEC-konten.md`) auf.

## Ziel

Wer angemeldet ist, hat auf jedem Gerät denselben Fortschritt: gelöste Levels, Bestzeiten, Abstürze,
Versuche und Zeitpunkte. Ohne Konto oder ohne Netz spielt alles lokal weiter wie bisher; was offline
entsteht, wird beim nächsten Abgleich nachgereicht.

## Was gespeichert wird

Genau der lokale Fortschritt aus `progress.ts` (Dateiformat Version 1, wie „Fortschritt sichern“):

- `solved`: gelöste Level-Kennungen
- `levels[id]`: `best` (Schritte, Abstürze, Startwert, Datum), `solves`, `attempts`, `lastPlayed`,
  `playSteps`, `falls`

Je Konto genau ein Datensatz in `progress_sync` (Migration `007_sync.sql`): Daten (jsonb),
Versionsnummer, Zeitpunkt der letzten Änderung. Löscht jemand sein Konto, verschwindet der Datensatz
mit (`on delete cascade`).

## Abgrenzung zur Bestenliste

Sync-Zeiten sind **ungeprüft**: Der Browser meldet sie, niemand spielt sie nach. Sie liegen nur in
`progress_sync`, werden nur dem eigenen Konto zurückgegeben und erscheinen **nie** in einer
Rangliste. Geprüfte Zeiten gehören allein dem Baustein `bestenliste` (Aufzeichnung einreichen,
Nachspielen auf dem Server, Migration 006). Keine gemeinsame Tabelle, keine gemeinsame Route.

## API (`server/src/sync.ts`)

Alle Routen hinter `requireSignedIn` bzw. `requireAccount`, Antworten `Cache-Control: no-store`.

| Route | Zweck |
| --- | --- |
| `GET /api/fortschritt` | `{ version, geaendert, fortschritt }`; ohne Datensatz `version: 0`, leerer Fortschritt |
| `PUT /api/fortschritt` | Body `{ basis, fortschritt }`. Passt `basis` zur gespeicherten Version: speichern, `{ version, geaendert }`. Sonst `409` mit dem aktuellen Stand `{ version, geaendert, fortschritt }` |

- **Optimistisches Sperren statt Zusammenführen auf dem Server:** Der Server kennt keine
  Spiellogik; er speichert nur, wenn niemand dazwischen geschrieben hat. Bei `409` führt der Browser
  den neuen Stand mit seinem zusammen und versucht es erneut. So geht bei zwei Geräten gleichzeitig
  nichts verloren.
- **Lesen** geht auch für gesperrte Konten (`requireSignedIn`), **Schreiben** nur ungesperrt
  (`requireAccount`, wie überall).
- **Grenzen:** Body höchstens 1 MiB; höchstens 5000 Levels und 5000 gelöste Kennungen; Kennungen
  bis 200 Zeichen ohne Steuerzeichen (wie `progress.ts`); Zahlen ganzzahlig und ≥ 0; unbekannte Felder
  werden verworfen (JSON-Schema).
- **Begrenzung je Konto:** 120 Anfragen je 15 Minuten (Lesen und Schreiben zusammen), darüber `429`.
- **CSRF:** Schreibende Anfragen nur ohne oder mit der eigenen `Origin` (wie Konto und Forum).

## Abgleich im Spiel (`src/sync.ts`)

Ein Abgleich (`abgleichen`):

1. `GET` den Serverstand.
2. `zusammen = mergeProgress(lokal, server)` — die vorhandene Zusammenführung: gelöst bleibt gelöst,
   die bessere Zeit gewinnt, Zähler das Maximum, letzter Zeitpunkt der spätere.
3. Unterscheidet sich `zusammen` vom Serverstand: `PUT` mit `basis = server.version`. Bei `409` mit
   dem mitgelieferten Stand zurück zu 2 (höchstens 3 Versuche).
4. Lokal speichern: `mergeProgress(aktuellerLokalerStand, zusammen)` — was während des Abgleichs
   gespielt wurde, bleibt erhalten.

Wann: beim Öffnen (sobald `/api/konto` „angemeldet“ meldet), direkt nach dem Anmelden, kurz nach jedem Sieg (gebündelt,
2 s Verzögerung), wenn der Browser wieder online ist, und beim Öffnen der Seite „Fortschritt“.
Nie mehr als ein Abgleich gleichzeitig; ein angefragter Abgleich während eines laufenden folgt danach.

Ohne Netz: Der Status steht auf „Wartet auf Netz“; der nächste Anlass (Sieg, wieder online, Öffnen)
gleicht alles ab, denn jeder Abgleich nimmt den ganzen lokalen Stand mit. Ohne Konto geht keine
Anfrage raus. Kein Dialog, keine Meldung beim Spielen.

**Grenze der Zähler:** Versuche, Spielzeit und Abstürze werden wie beim Laden einer Datei mit dem
Maximum zusammengeführt (wiederholtes Abgleichen zählt nichts doppelt). Spielt man auf zwei Geräten
offline dasselbe Level, zählt also das Gerät mit den höheren Zählern. Gelöste Levels und Bestzeiten
gehen nie verloren.

## Oberfläche

Auf der Seite „Fortschritt“ eine Statuszeile (klein, `role="status"`):

- „Auf allen Geräten abgeglichen um 14:32.“ (heute) bzw. „… am 12. Nov.“
- „Abgleich gerade nicht möglich – wird später nachgereicht.“ (Serverfehler)
- „Wird abgeglichen …“
- „Wartet auf Netz – wird später nachgereicht“
- „Nur auf diesem Gerät. Mit einem Konto auf allen Geräten.“ (nicht angemeldet)
- „Konto gesperrt – Abgleich pausiert“

Der Text unter der Statistik nennt den Abgleich, wenn angemeldet.

## Tests

- Server (`node --test`, `server/src/sync.test.ts`): Speicher- und PostgreSQL-Store
  (`TEST_DATABASE_URL`): holen/hochladen, Versionskonflikt `409`, Grenzen, Begrenzung je Konto,
  ohne Konto `401`, gesperrt `403` beim Schreiben, Löschen des Kontos löscht den Fortschritt.
- Spiel (vitest, `src/sync.test.ts`): zwei Geräte, offline gespielt und nachgereicht, gleichzeitiges
  Schreiben (409) ohne Verlust, Spielen während des Abgleichs.
- Browser auf eigenem Port (5180).

## Datenschutz

Neuer Abschnitt „Fortschritt auf allen Geräten“ in `datenschutz.html` – erst nach Freigabe durch den
Nutzer.
