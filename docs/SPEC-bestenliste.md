# Spec: `bestenliste` – geprüfte Zeiten je Level, Ranglisten

Baustein aus `docs/SERVER.md` (Phase C, Abschnitt 5). Grundlagen: `docs/SPEC-aufzeichnung.md`
(Format, Nachspielen), `docs/SPEC-loesbarkeit.md` (Prüfkern, Prüfprozess), `docs/SPEC-konten.md`
(Konten, Anzeigename, Sperre). Stand 13.11.2026.

## Ziel

Angemeldete Spieler kommen mit ihrer Zeit in eine Rangliste je Level. Jede Zeit ist **durch
Nachspielen geprüft**: Der Browser schickt nach dem Sieg die Eingabeaufzeichnung, der Server spielt
sie mit derselben Spiellogik ohne Grafik nach und übernimmt die **nachgespielte** Zeit nur, wenn das
Level dabei gelöst wird. Ohne Konto und offline spielt jeder weiter wie bisher (lokale Bestzeiten).

## Ablauf

```
Sieg im Browser ──► angemeldet? ── nein ──► lokal wie bisher + Hinweis „Anmelden, um in die Bestenliste zu kommen“
                        │ ja (und lokal neue Bestzeit oder noch kein Eintrag)
                        ▼
POST /api/bestenliste  (Aufzeichnung)  ──► 202 { id }           Form, Größe, Grenzen sofort geprüft
                        │
              Warteschlange (1 Prüfprozess, niedrige Priorität, Zeitlimit)
                        ▼
              Nachspielen (src/game/check.ts → checkSolution) mit dem Level der aktiven Version
                        │
          gelöst? ── nein ──► abgelehnt (Grund)
                        │ ja
                        ▼
              besser als der eigene Eintrag? ── ja ──► Eintrag ersetzen (Zeit, Aufzeichnung, Zeitpunkt)
                        ▼
GET /api/bestenliste/pruefung/:id  ──► { status, zeit, platz, von, neu }   (Browser fragt alle 1–2 s)
```

## Bausteine

| Stufe | Inhalt | Prüfung |
|---|---|---|
| B1 | Migration `006_bestenliste.sql`: Tabelle `leaderboard` (ein Eintrag je Konto und Level) | DB-Test mit `TEST_DATABASE_URL` |
| B2 | Prüfer `server/src/bestenliste-pruefer.ts`: dauerhafter Prüfprozess (`tools/lib/check-worker.mjs` der aktiven Version unter `GAME_DIR`), Levels aus `tools/lib/levels.mjs`, Zeitlimit, Neustart nach Absturz | `node --test` mit dem echten Spielcode des Repos |
| B3 | Warteschlange und API `server/src/bestenliste.ts` (+ `bestenliste-db.ts`, `bestenliste-memory.ts`) | `node --test` (Endpunkte, Grenzen, Ende zu Ende) |
| B4 | Spiel: `src/bestenliste.ts` (Client), Siegmeldung, Levelliste; Seite `bestenliste.html` (`src/bestenliste-seite.ts`) | vitest `bestenliste.test.ts`, Browser |
| B5 | Betrieb: Spielcode je Version unter `/opt/murmel/game/<version>` (`release.sh`, aus Git wie `loesbarkeit.sh`), schreibgeschützt in den API-Container (`compose.yml`), aufgeräumt mit den Releases | Rollout auf dem Server |

**Stand 13.11.2026:** B1–B5 gebaut (Branch `bestenliste`). Geprüft: `node --test` (API mit Speicher-Store, Ende zu Ende mit
echtem Spielcode und `solutions/murmel/01.json`, PostgreSQL-Teil nur in der CI), vitest, Browser mit lokaler Test-API
(echter Lauf eingereicht und nachgespielt, Levelliste mit Platz, Ranglistenseite hell/dunkel/375 px, Admin-Knöpfe).
Nicht geprüft: Siegmeldung nach einem von Hand gespielten Sieg, Rollout auf dem Server (erster Rollout legt
`/opt/murmel/game/<version>` an). Datenschutzabschnitt „Bestenlisten“ vom Nutzer freigegeben und eingetragen (13.11.2026).

## Prüfen

- **Gleiche Prüfung wie die Lösbarkeit:** `checkSolution` aus `src/game/check.ts` im Kindprozess
  `tools/lib/check-worker.mjs`. Der Server hat keinen eigenen Spielcode im Image; er nutzt den
  Spielstand der **aktiven Version** (`GAME_DIR`, Standard `/game`). Ohne Spielcode antwortet
  `POST /api/bestenliste` mit 503 „Die Bestenliste ist gerade nicht verfügbar“; alles andere läuft.
- **Maßgeblich ist die nachgespielte Zeit** (`steps` des Nachspielens bis zum Sieg), nie die gemeldete.
  Weicht sie ab, zählt trotzdem die nachgespielte.
- **Level:** muss es in der aktiven Version geben; der Server speichert den `levelHash` des Levels,
  mit dem geprüft wurde. Ändert sich ein Level später, bleiben die Einträge stehen (sie waren zum
  Zeitpunkt der Prüfung gültig); eine Neubewertung ist Sache der Lösbarkeitsprüfung.
- **Veraltete Spielversion:** Schickt ein Browser mit älterem Spielstand (Service Worker) einen Lauf,
  der unter der aktiven Version nicht mehr gewinnt, lautet der Grund „Dein Spiel ist nicht auf dem
  neuesten Stand – bitte die Seite neu laden“, wenn die mitgeschickte `version` von der aktiven abweicht.

### Grenzen gegen Missbrauch

| Grenze | Wert | Antwort |
|---|---|---|
| Größe der Anfrage | 2 MB (eine Aufzeichnung hat typisch 5–30 KB) | 413 |
| Form der Aufzeichnung | wie `parseRecording` der Lösbarkeit (Format 1, Physiktakt, höchstens 300 000 Einträge) | 400 |
| Länge des Laufs | höchstens 1 h Spielzeit (1 440 000 Schritte) | 400 |
| Rechenzeit je Prüfung | 60 s; danach wird der Prüfprozess beendet und neu gestartet | abgelehnt „Prüfung dauerte zu lange“ |
| Einreichungen je Konto | 30 je Stunde (Admins ausgenommen) | 429 |
| Offene Prüfungen je Konto | 2 | 429 |
| Warteschlange gesamt | 50 offene Prüfungen | 503 „gerade viel los, bitte später“ |
| Gesperrte Konten (`blocked_at`) | reichen nichts ein (`requireAccount`); ihre Einträge erscheinen in keiner Rangliste | 403 |

- **Parallelität:** ein dauerhafter Prüfprozess mit gesenkter Priorität
  (`os.setPriority` 10). Die API-Anfragen selbst warten nie auf das Nachspielen: Einreichen antwortet
  sofort mit 202, das Ergebnis holt der Browser ab.
- **Prüfergebnisse** liegen nur im Speicher (10 min nach Abschluss gelöscht). Ein Neustart der API
  verliert offene Prüfungen; der Browser meldet dann „Prüfung abgebrochen“. Die Aufzeichnung bleibt
  als lokale Bestzeit erhalten.

## Ranglisten

- **Je Level die Top 100** und der **eigene Platz** (auch außerhalb der Top 100).
- **Reihenfolge:** Zeit (Schritte) aufsteigend; bei Gleichstand der frühere Zeitpunkt (der Zeitpunkt
  des Laufs, der den Eintrag gesetzt hat), dann die Eintrags-Id.
- **Name:** der Anzeigename des Kontos (`accounts.display_name`, wie im Forum), nie die Mailadresse.
  Ohne Anzeigenamen steht „Spieler ohne Namen“; den Namen setzt man auf der Forumseite.
- **Ein Eintrag je Konto und Level:** nur der beste Lauf zählt. Ein schlechterer Lauf ändert nichts.

## Oberfläche (Skill `apple-design`, Stil der bestehenden Seiten)

- **Siegmeldung:** eine Zeile unter Zeit und Abstürzen:
  - angemeldet: „Bestenliste: wird geprüft …“ → „Platz 3 von 57 · neue persönliche Bestzeit“ bzw.
    „Platz 3 von 57 (deine Bestzeit 1:02,5)“ bzw. Grund der Ablehnung; Knopf „Rangliste“.
  - nicht angemeldet: „Anmelden, um in die Bestenliste zu kommen.“
  - Eingereicht wird nur, wenn der Lauf besser ist als die bekannte Serverzeit (oder noch keine bekannt ist).
- **Levelliste:** rechts die Bestzeit (lokal oder Server, die bessere) und, falls vorhanden, der
  eigene Platz („Platz 3“).
- **Ranglistenseite** `bestenliste.html?level=<id>`: Levelname, Top 100 als Tabelle (Platz, Name,
  Zeit, Datum), eigene Zeile hervorgehoben, darunter der eigene Platz, falls außerhalb; „Eintrag
  löschen“ für den eigenen Eintrag; Admins können jeden Eintrag entfernen. noindex, nicht im
  Offline-Speicher (wie Forum und Statistik).

## API

| Methode | Pfad | Wer | Inhalt |
|---|---|---|---|
| POST | `/api/bestenliste` | Konto (nicht gesperrt) | Aufzeichnung (+ optional `version`) → 202 `{ id }` |
| GET | `/api/bestenliste/pruefung/:id` | Einreicher | `{ status: 'wartet'|'angenommen'|'abgelehnt', zeit?, platz?, von?, neu?, grund? }` |
| GET | `/api/bestenliste/level?id=…` | alle | `{ level, anzahl, eintraege: [{ id, platz, name, zeit, datum, ich }], ich: { platz, zeit } | null }` |
| GET | `/api/bestenliste/meine` | Konto | `{ levels: { <id>: { zeit, platz } } }` |
| DELETE | `/api/bestenliste/eintrag/:id` | Eigentümer oder Admin | 204 |

`zeit` ist immer in Physikschritten (`× 0,0025 s`), wie die lokalen Bestzeiten.

## Datenbank (`006_bestenliste.sql`)

```sql
leaderboard (id, account_id → accounts on delete cascade, level, steps, level_hash, version,
             recording jsonb, created_at, unique (account_id, level))
index (level, steps, created_at, id)
```

- Gespeichert wird **nur die Aufzeichnung des besten Laufs** je Konto und Level; ein besserer Lauf
  ersetzt sie, schlechtere Läufe werden nicht gespeichert. Sie wird gelöscht, wenn der Eintrag
  gelöscht wird (vom Spieler, vom Admin) oder mit dem Konto.
- Die Aufzeichnung ist **nicht öffentlich** (später: Geister-Läufe nur mit eigener Freigabe).

## Datenschutz

Abschnitt „Bestenlisten“ in `datenschutz.html` (vom Nutzer freigegeben 13.11.2026): Anzeigename, Zeit, Platz und
Datum sind öffentlich; gespeichert wird nur die Aufzeichnung des besten Laufs je Konto und Level, bis der Eintrag
oder das Konto gelöscht wird (Sicherungen höchstens 14 Tage länger).

## Läufe von Admins als Lösungen (Nutzerentscheidung 13.11.2026: ja)

Ein angenommener Lauf eines Admins wird zusätzlich in `solutions` gespeichert (wie „Als Lösung speichern“) und
nachts von der Lösbarkeitsprüfung mitgeprüft. Spielerläufe nie.

## Grenzen

- **Immer:** Spiel bleibt ohne Konto und offline voll spielbar; Nachspielen bremst die API nicht
  (Warteschlange, ein Prozess, niedrige Priorität); Tests zuerst.
- **Erst fragen:** Änderungen der Datenschutzerklärung; Spielerläufe für die Lösbarkeitsprüfung; Aufzeichnungen
  anderen zeigen (Geister).
- **Nie:** Mailadressen zeigen, gemeldete statt nachgespielter Zeiten übernehmen, Daten außerhalb der EU.

## Offene Fragen

1. Neubewertung bei geänderten Levels (alte Einträge ausblenden?) – vorerst nein.
