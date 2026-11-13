# Spec: `spielerlevels` – Levels aus dem Editor veröffentlichen, freigeben, spielen, bewerten

Baustein aus `docs/SERVER.md` Abschnitt 6. Grundlagen: `docs/SPEC-editor.md` (Levelformat des Editors,
strenge Prüfung `sanitizeLevel`), `docs/SPEC-bestenliste.md` (Nachspielen in der Warteschlange,
`Checker`), `docs/SPEC-konten.md` (Konten, Anzeigename, Sperre). Stand 13.11.2026.

## Ziel

Wer im Editor ein Level gebaut und **selbst gelöst** hat, kann es mit Konto veröffentlichen. Der Server
prüft es und spielt die Lösung nach; erst wenn ein Admin es freigibt, sehen es alle in der Liste
„Spieler-Levels“. Dort lässt es sich suchen, spielen, bewerten (1–5, nur wer es gelöst hat) und melden.
Lizenz aller Spieler-Levels: **CC BY-SA 4.0** (Nutzerentscheidung 13.11.2026). Das Spiel bleibt ohne
Konto und offline voll spielbar.

## Entscheidungen (Nutzer, `docs/SERVER.md` Abschnitt 6 und 11)

- Hochladen nur, wenn der Autor das Level selbst gelöst hat – geprüft durch Nachspielen wie bei der
  Bestenliste. Ein Level ohne gültige Lösung wird abgelehnt.
- Neue Levels werden erst sichtbar, wenn ein Admin sie freigibt.
- Gemeldete Levels werden ausgeblendet, bis ein Admin entscheidet.
- Lizenz CC BY-SA 4.0; der Autor wird mit seinem **Anzeigenamen** genannt, nie mit der Mailadresse.

## Ablauf

```
Editor ── Probespielen ── Sieg ──► Spiel merkt sich die Aufzeichnung zum Link (localStorage)
   │
   └─ „Veröffentlichen“ (angemeldet, nicht gesperrt, Prüfregeln ohne Fehler, gelöste Aufzeichnung passt
      zum aktuellen Stand, Anzeigename, Lizenz bestätigt)
          ▼
POST /api/spielerlevels { level, loesung, titel, beschreibung, lizenz, ersetzt? } ──► 202 { id }
          │  sofort: Form, Größe, Lizenzfeld, Textlängen, Grenzen je Konto
          ▼
Warteschlange der Bestenliste (ein Prüfprozess, niedrige Priorität, Zeitlimit)
   Prüfprozess: sanitizeLevel (nur Editor-Inhalte, kein Lua) ──► Nachspielen der Lösung
          │ gelöst? ── nein ──► abgelehnt (Grund)
          ▼ ja
Level gespeichert: Status „wartet“ (nur Autor und Admins sehen es) ──► Admin-Mail (gebündelt, ≤ 1/h)
          ▼
Admin: probespielen ── „Freigeben“ ──► „frei“: in der Liste für alle
                   └── „Ablehnen“ (Grund) ──► „abgelehnt“: Autor sieht den Grund
```

## Prüfung beim Hochladen

**Sofort in der API (400/413/429):**

| Prüfung | Grenze |
|---|---|
| Anfragegröße | 2 MB (Level + Aufzeichnung) → 413 |
| Level als JSON | höchstens 256 KB; `map` 1–40 Zeilen, je 1–60 Zeichen |
| Lizenzfeld | `license` des Levels und `lizenz` der Anfrage = `CC-BY-SA-4.0`, sonst 400 |
| Kein Lua | Felder `lua`, `script`, `docs` u. Ä. → 400 (die strenge Prüfung kennt sie ohnehin nicht) |
| Titel | 3–60 Zeichen (ohne Steuerzeichen) |
| Beschreibung | höchstens 500 Zeichen |
| Lösung | Form wie `parseRun` der Bestenliste (Format 1, gewonnen, höchstens 1 h); Level-Kennung `link:…` oder `spieler:…` |
| Anzeigename | muss gesetzt sein (Lizenz verlangt Namensnennung) → 400 mit Hinweis |
| Uploads je Konto | 5 je 24 h (aus der Datenbank gezählt, Admins ausgenommen) → 429 |
| Wartende Levels je Konto | 5 → 429 |
| Gesperrte Konten | 403 (`requireAccount`) |
| Kein Spielcode | 503 „Hochladen ist gerade nicht verfügbar“ |

**Im Prüfprozess (Spielcode der aktiven Version):**

1. `sanitizeLevel` aus `src/editor/link.ts` – dieselbe strenge Prüfung wie bei Links und Datei-Import:
   nur bekannte Felder, nur Arten aus der Editor-Palette (erlaubte Objekte), nur bekannte Attribute,
   Größe ≤ 60×40, höchstens 2 400 Objekte und 40 Gegner, Textlängen begrenzt, **nie Lua**, danach
   `parseLevel`. Gespeichert wird **das Ergebnis dieser Prüfung**, nie das hochgeladene JSON.
2. `checkSolution` mit diesem Level und der Lösung. Die Level-Kennung der Aufzeichnung (`link:…` aus dem
   Probespiel) wird dafür als Kennung des Levels gesetzt; für Spieler-Levels gilt keine Enigma-Regel.
3. Zeitlimit wie bei der Bestenliste (60 s), danach „Die Prüfung dauerte zu lange.“

Das Ergebnis holt der Editor wie bei der Bestenliste ab (`GET /api/spielerlevels/pruefung/:id`).
Spieler-Levels und Bestenliste teilen sich **eine** Warteschlange (ein Prüfprozess); die Grenzen der
Warteschlange (offene Prüfungen je Konto 2, gesamt 50) gelten gemeinsam.

## Status eines Levels

| Status | Wer sieht es | Übergänge |
|---|---|---|
| `wartet` | Autor, Admins | Admin → `frei` oder `abgelehnt`; Autor → `zurueckgezogen` |
| `frei` | alle (außer gemeldet oder Autor gesperrt) | Autor → `zurueckgezogen`; neue Version freigegeben → `ersetzt` |
| `abgelehnt` | Autor (mit Grund), Admins | – (neu hochladen) |
| `zurueckgezogen` | Autor, Admins | Autor → `wartet` („Wieder einreichen“: neue Freigabe) |
| `ersetzt` | Autor, Admins | – |

- **Gemeldet:** Solange eine offene Meldung besteht, ist ein freies Level in Liste und Abruf für andere
  ausgeblendet. Der Admin **verwirft** die Meldungen (wieder sichtbar) oder **lehnt** das Level ab
  (Status `abgelehnt`, mit Grund). Ein Konto meldet ein Level einmal.
- **Gesperrte Autoren:** ihre Levels erscheinen nicht in der Liste (wie in der Bestenliste).
- **Neue Version:** Hochladen mit `ersetzt: <id>` (eigenes Level) legt ein neues Level an, das wieder
  geprüft und freigegeben wird. Erst die Freigabe der neuen Version setzt die alte auf `ersetzt`.
  Bewertungen und Bestenlisten-Einträge gehören zur jeweiligen Version (neue Kennung).
- **Löschen:** Autor und Admins löschen endgültig (samt Bewertungen, Meldungen und
  Bestenlisten-Einträgen des Levels). Wird das Konto gelöscht, verschwinden seine Levels mit
  (`on delete cascade`, Trigger für die Bestenliste).

## Spielen

- Kennung im Spiel: `spieler:<id>`. Das Spiel öffnet `./#spieler=<id>`, lädt das Level von
  `GET /api/spielerlevels/:id/datei` (Autor = Anzeigename, `license` = `CC-BY-SA-4.0`) und spielt es als
  Ein-Level-Paket „Spieler-Levels“. Zuletzt geladene Levels (bis 30) liegen im Browser, damit sie
  offline weiter spielbar sind.
- **Fortschritt, lokale Bestzeiten, Sync und Statistik** wie bei jedem anderen Level (Kennung
  `spieler:<id>`).
- **Bestenliste: ja.** Es geht sauber, weil jede Version eine eigene Kennung hat und sich nie ändert:
  Die Bestenliste holt das gespeicherte (geprüfte) Level aus der Spieler-Level-Tabelle und spielt den
  Lauf damit nach. Nur Levels, die für den Einreicher sichtbar sind, nehmen Läufe an. Ein gelöschtes
  Level nimmt seine Einträge mit. Der angenommene Bestenlisten-Lauf ist zugleich der **Nachweis „gelöst“**
  für die Bewertung.
- Startbildschirm: „von <Anzeigename> · CC BY-SA 4.0“, Knöpfe „Spieler-Levels“ (zur Liste) und
  „Im Editor öffnen“ (Bearbeiten unter derselben Lizenz).

## Liste „Spieler-Levels“ (`spielerlevels.html`)

- Erreichbar aus dem Spiel (Levelpakete → „Spieler-Levels“) und aus dem Editor.
- Suche (Titel, Beschreibung, Autor; ohne Groß/Klein), Sortierung **neu** (Freigabezeitpunkt) und
  **beliebt** (gedämpfter Schnitt `(Summe + 3·3) / (Stimmen + 3)`, dann Stimmen, dann neu), Seiten zu 30.
- Je Level: Titel, Autor (Anzeigename), Datum, Sterne (Schnitt, Stimmen), Beschreibung, Lizenzhinweis
  „CC BY-SA 4.0“, Knöpfe „Spielen“, „Bewerten“, „Melden“.
- **Meine Levels** (angemeldet): alle eigenen mit Status und Ablehnungsgrund; „Zurückziehen“,
  „Wieder einreichen“, „Löschen“ (mit Rückfrage).
- **Freigabe** (nur Admins): wartende und gemeldete Levels mit Autor, Beschreibung, Lösungszeit,
  Meldungen (Grund); „Probespielen“ (öffnet das Spiel), „Freigeben“, „Ablehnen“ (Grund Pflicht),
  „Meldungen verwerfen“, „Löschen“.
- noindex, nicht im Offline-Speicher (wie Forum und Bestenliste). Gestaltung: Skill `apple-design`,
  Stil der bestehenden Seiten (Forum, Bestenliste), hell/dunkel, ab 320 px.

## Bewertung und Melden

- **Bewertung 1–5:** nur angemeldet und nicht gesperrt, nur wer das Level **gelöst** hat (geprüfter
  Bestenlisten-Eintrag), nicht der Autor; ein Konto eine Stimme (erneutes Bewerten ändert sie).
- **Melden:** angemeldet und nicht gesperrt, Grund Pflicht (3–300 Zeichen), einmal je Konto und Level,
  nicht das eigene Level. Das Level ist sofort ausgeblendet; die Admins sehen es in der Freigabe.

## Admin-Mail

Neue wartende Levels lösen eine Mail an alle Adressen aus `ADMIN_EMAILS` aus: **gebündelt, höchstens
einmal je Stunde.** Nach jedem angenommenen Upload und alle 10 Minuten prüft der Server: Gibt es
Levels ohne Mail und liegt die letzte Mail (aus der Datenbank, übersteht Neustarts) mindestens eine
Stunde zurück, geht eine Mail mit Anzahl und Titeln und einem Link zur Freigabe hinaus. Ohne SMTP
(`mailer` null) wird nichts verschickt. Die Mail nennt keine Mailadressen von Spielern.

## API

| Methode | Pfad | Wer | Inhalt |
|---|---|---|---|
| POST | `/api/spielerlevels` | Konto | `{ level, loesung, titel, beschreibung?, lizenz, ersetzt? }` → 202 `{ id }` |
| GET | `/api/spielerlevels/pruefung/:id` | Einreicher | `{ status: 'wartet'|'angenommen'|'abgelehnt', level?, grund? }` |
| GET | `/api/spielerlevels?suche=&sort=neu|beliebt&seite=` | alle | `{ levels: [Karte], mehr }` |
| GET | `/api/spielerlevels/meine` | angemeldet | `{ levels: [Karte + status, grund] }` |
| GET | `/api/spielerlevels/:id` | sichtbar | Karte + `{ meineSterne, darfBewerten, gemeldet, admin, eigen }` |
| GET | `/api/spielerlevels/:id/datei` | sichtbar | `LevelFile` (Kennung `spieler:<id>`) |
| PUT | `/api/spielerlevels/:id/bewertung` | Konto, gelöst | `{ sterne }` → `{ schnitt, stimmen }` |
| POST | `/api/spielerlevels/:id/meldung` | Konto | `{ grund }` → 204 |
| PUT | `/api/spielerlevels/:id/status` | Autor | `{ status: 'zurueckgezogen'|'wartet' }` → 204 |
| DELETE | `/api/spielerlevels/:id` | Autor, Admin | 204 |
| GET | `/api/admin/spielerlevels` | Admin | `{ wartend: [...], gemeldet: [...] }` |
| PUT | `/api/admin/spielerlevels/:id` | Admin | `{ entscheidung: 'frei'|'abgelehnt', grund? }` → 204 |
| DELETE | `/api/admin/spielerlevels/:id/meldungen` | Admin | 204 (Meldungen verworfen) |

„Sichtbar“: frei, nicht gemeldet, Autor nicht gesperrt – oder eigenes Level – oder Admin. Sonst 404.
Karte: `{ id, titel, beschreibung, autor, datum, sterne, stimmen, groesse }`. Schreibende Anfragen nur
von der eigenen Herkunft (CSRF-Prüfung wie Bestenliste und Forum).

## Datenbank (`009_spielerlevels.sql`; 008 ist für Mehrspieler reserviert)

```sql
player_levels (id, account_id → accounts on delete cascade, title, description, file jsonb,
               level_hash, recording jsonb, steps, status, reason, replaces → player_levels on delete set null,
               created_at, published_at, reviewed_at, notified_at)
player_level_ratings (level_id → player_levels cascade, account_id → accounts cascade, stars 1–5, primary key (level_id, account_id))
player_level_reports (level_id → cascade, account_id → cascade, reason, created_at, dismissed_at, primary key (level_id, account_id))
trigger: delete from player_levels → delete from leaderboard where level = 'spieler:' || id
```

- Die **Aufzeichnung der Lösung** des Autors ist nicht öffentlich (nur Admins könnten sie abrufen; sie
  dient als Nachweis und für eine spätere Neuprüfung). Sie geht mit dem Level.

## Bausteine

| Stufe | Inhalt | Prüfung |
|---|---|---|
| S1 | Migration 009, `server/src/spielerlevels-db.ts`, `-memory.ts` | DB-Test mit `TEST_DATABASE_URL` (CI) |
| S2 | Prüfprozess: `check-worker.mjs` Art `player`, `Checker.checkLevel` (Upload) und `checkFile` (Bestenliste) | `node --test` mit echtem Spielcode |
| S3 | API `server/src/spielerlevels.ts`, Admin-Mail, Bestenliste für `spieler:` | `node --test` (Endpunkte, Grenzen, Ende zu Ende) |
| S4 | Editor: „Veröffentlichen“; Spiel: `#spieler=`, Paket, gelöste Aufzeichnung merken | vitest, Browser |
| S5 | Seite `spielerlevels.html` mit Liste, Meine Levels, Freigabe | vitest (reine Teile), Browser (Port 5184) |

**Stand 13.11.2026:** S1–S5 gebaut (Branch `spielerlevels`). Geprüft: `node --test` (API mit Speicher-Store, Ende zu
Ende mit echtem Spielcode und `server/src/spielerlevel-beispiel.json`: lösbares Level angenommen, Level ohne gültige
Lösung und mit fremdem Objekt abgelehnt, Freigabe macht es sichtbar, Bestenlisten-Lauf von `spieler:1` nachgespielt),
vitest, Datenbank-Store gegen PGlite (lokal; der volle DB-Test läuft in der CI mit PostgreSQL), Browser auf Port 5184
mit lokaler Test-API (Veröffentlichen aus dem Editor mit echtem Nachspielen, Admin-Mail, Freigabe, Spielen per
`#spieler=1`, Bewerten nach geprüftem Lauf, Melden und Verwerfen, hell/dunkel, 375 px). Nicht geprüft: ein von Hand
gespielter Sieg im Probespiel (das Merken der Lösung ist per Code und vitest abgedeckt), Rollout auf dem Server.

## Datenschutz

Abschnitt „Spieler-Levels“ für `datenschutz.html` wird dem Nutzer vorgelegt; die Datei ändert sich erst
nach seiner Freigabe (Inhalt: öffentlicher Anzeigename als Autor, Lizenz, gespeicherte Aufzeichnung der
Lösung, Bewertungen und Meldungen, Löschen).

## Grenzen

- **Immer:** nur geprüfte Editor-Inhalte speichern und ausliefern; Nachspielen bremst die API nicht;
  Tests zuerst; Spiel ohne Konto und offline spielbar.
- **Erst fragen:** Änderungen der Datenschutzerklärung; Lua oder Dokumenttexte in Spieler-Levels;
  automatische Freigabe.
- **Nie:** Mailadressen zeigen, ungeprüftes JSON ausliefern, Levels ohne gültige Lösung annehmen.
