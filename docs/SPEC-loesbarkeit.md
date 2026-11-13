# Spec: `loesbarkeit` – Ladeprobe, Lösungen nachspielen, Nachtlauf

Baustein aus `docs/SERVER.md` (Phase C, Abschnitt 10). Grundlage: `docs/SPEC-aufzeichnung.md` (A3–A5).
Stand 13.11.2026.

## Ziel

Eine Änderung am Spiel (Physik, Objekte, Lua-Schicht, Import) darf kein Level unbemerkt kaputt machen.
Dafür werden **alle Levels ohne Grafik in Node gestartet** (Ladeprobe) und **alle gespeicherten
Lösungen nachgespielt**. Das geschieht

- bei **jedem PR in der CI**, mit den Lösungen aus dem Repo – ein Bruch kommt gar nicht erst auf `main`;
- **jede Nacht auf dem Server**, mit allen Lösungen (Repo und Datenbank); das Ergebnis landet in der
  Datenbank, der Admin sieht es in einer eigenen Ansicht und bekommt **eine Mail nur bei neuen
  Fehlschlägen**.

## Ausgangslage (gemessen 13.11.2026)

- 1144 Levels: 3 eigene (`src/levels`), 1141 aus Enigma (`public/levels/enigma`, 19 Pakete).
- Der Spielcode läuft in Node direkt aus `src/` (Node 24 mit `--experimental-transform-types` und
  einem Ladehaken für Importe ohne Endung und `?raw`, `tools/lib/ts-hooks.mjs`). Kein Build-Schritt.
- **Ladeprobe**, 5 s Spielzeit je Level: 1141 ok, 3 mit Lua-Fehler (laufen weiter), 0 Fehler.
  Ein Kern: ~2 min für alle Levels; 30 Kerne: 16 s.
- **Nachspielen:** ~0,3 s Rechenzeit je Lösung (Läufe von 25–120 s Spielzeit, ein Kern). Selbst mit
  einer Lösung je Level wären es ~6 min auf einem Kern – deutlich unter der Schätzung in
  SERVER.md 8.1 (30–60 min).
- **Lösungen gibt es noch keine.** Ein einfacher Autopilot (unten) löst 29 Levels; alles andere
  braucht Läufe von Menschen.

## Bausteine

| Stufe | Inhalt | Prüfung |
|---|---|---|
| L1 | Prüfkern `src/game/check.ts`: `probeLevel` (starten, N s ohne Eingabe), `checkSolution` (Aufzeichnung nachspielen); Node-Laufzeit für Lua `src/lua/node.ts` | vitest `check.test.ts` |
| L2 | Werkzeuge `tools/check-load.mjs` und `tools/check-solutions.mjs`: Kindprozesse (einer je Kern oder `--jobs`), Zeitlimit je Level, Ausgabe als Text und `--json` | `node --test tools/` |
| L3 | Lösungen im Repo: `solutions/<präfix>/<name>.json` (Format v1 + `levelHash`, `source`); Autopilot `tools/autosolve.mjs` | CI spielt alle nach |
| L4 | CI: Ladeprobe und Nachspielen bei jedem PR und Push (Job `build`, also auch Voraussetzung für den Rollout) | Lauf in GitHub Actions |
| L5 | Nachtlauf: `server/src/loesbarkeit/` (Job), Migration `005_loesbarkeit.sql`, systemd-Timer, Mail bei neuen Fehlschlägen | `node --test`, DB-Test mit `TEST_DATABASE_URL` |
| L6 | Admin-Ansicht `loesbarkeit.html` + `GET /api/admin/loesbarkeit…` | `node --test` (Endpunkte), Browser |
| L7 | Weitere Herkunft der Lösungen – **Entscheidung des Nutzers**, siehe unten | – |

### Ergebnisse

| Prüfung | Werte |
|---|---|
| Ladeprobe | `ok` · `lua` (Lua-Fehler gemeldet, Level läuft weiter) · `fehler` (Start oder Spiel wirft, Zeitlimit, Absturz) |
| Lösung | `geloest` · `nicht-geloest` (Eingaben enden ohne Sieg) · `fehler` (nicht nachspielbar: Format, anderes Level, Absturz) |

Zusätzlich je Lösung: Schritte beim Nachspielen und laut Aufzeichnung (Abweichung = Hinweis, kein
Fehler) und `levelChanged`, wenn sich der Levelinhalt seit der Aufnahme geändert hat (`levelHash`,
SHA-256 über das Level-JSON). Ein geändertes Level wird trotzdem nachgespielt: Gewinnt die Lösung
noch, ist alles gut; sonst ist es ein Fehlschlag mit dem Hinweis „Level geändert“.

**Neuer Fehlschlag** (löst die Mail aus): eine Lösung, die im letzten Lauf `geloest` war und jetzt
nicht mehr, oder ein Level, dessen Ladeprobe im letzten Lauf nicht `fehler` war und jetzt `fehler` ist.
Bleibt etwas kaputt, kommt keine weitere Mail; die Ansicht zeigt es weiter an.

## Woher kommen die Lösungen? (Entscheidung L7)

| Weg | Vorteile | Nachteile |
|---|---|---|
| **(c) Repo** `solutions/` | in der CI verfügbar – nur so blockiert ein Bruch den PR; versioniert, prüfbar, kein Datenschutzthema (enthält nur Eingaben) | jemand muss die Läufe ins Repo bringen; Repo wächst (~25 KB je Lösung, 1144 Lösungen ≈ 30 MB) |
| **(a) Admins** laden eigene Siege hoch (Knopf „Als Lösung speichern“ nach dem Sieg, angemeldet als Admin) | einfach, keine Fremddaten, deckt schnell viele Levels ab, wenn Admins spielen | nur auf dem Server, also nur im Nachtlauf, nicht in der CI – außer man übernimmt sie ins Repo |
| **(b) Spieler** steuern gelöste Läufe freiwillig bei | viele Lösungen ohne eigene Arbeit; fällt mit `bestenliste` ohnehin an | personenbezogen (Konto ↔ Lauf): Einwilligung, Datenschutzerklärung (Freigabe nötig), Löschen mit dem Konto, Missbrauch (Spam-Läufe; harmlos, weil nur gewinnende Läufe zählen) |
| Autopilot (Teil von c) | kostet nichts, sofort da | löst nur einfache Levels (29 von 1144) |

**Empfehlung: (c) + (a) jetzt, (b) später mit `bestenliste`.**
- Repo-Lösungen (inkl. Autopilot) sind die Grundlage für CI und Nachtlauf.
- Admins speichern Siege per Knopf in der Datenbank; der Nachtlauf prüft sie mit. Die Admin-Ansicht
  bietet je Lösung „als Datei herunterladen“, damit gute Läufe ins Repo (und damit in die CI) wandern.
- Spieler-Läufe erst mit `bestenliste`: Dort werden Siege ohnehin hochgeladen und geprüft; ein
  Häkchen „Mein Lauf darf zur Lösbarkeitsprüfung genutzt werden“ und ein Absatz in der
  Datenschutzerklärung kommen dann mit Freigabe des Nutzers dazu.

**Entscheidung des Nutzers (13.11.2026): Repo + Admins** wie empfohlen – (c) und (a) jetzt, (b) erst mit
`bestenliste` und eigener Freigabe der Datenschutzerklärung.

## Nachtlauf auf dem Server

```
murmel-loesbarkeit.timer (04:15, nach der Sicherung 03:30)
  └─ /opt/murmel/loesbarkeit.sh  (Benutzer murmel)
       1. unter update.lock: Kopie von /opt/murmel/repo (src, public/levels, solutions, tools,
          node_modules/fengari) nach /opt/murmel/loesbarkeit/<commit> – der Rollout wartet nur Sekunden
       2. docker compose run --rm --no-deps loesbarkeit   (Image murmel-api:<aktive Version>)
          --cpus 1, cpu_shares 128, nice 19, Speicher 1 GB
            → node src/loesbarkeit/job.ts
               a. Lösungen aus der Datenbank in ein Temp-Verzeichnis schreiben
               b. tools/check-load.mjs --jobs 1 --json …
               c. tools/check-solutions.mjs --jobs 1 --json … (Repo + Datenbank)
               d. Lauf und Ergebnisse speichern, mit dem letzten Lauf vergleichen
               e. neue Fehlschläge → Mail an ADMIN_EMAILS (über server/src/mail.ts)
       3. Kopie löschen
```

- **Last:** ein Kern, niedrigste Priorität (`nice 19`, `cpu_shares` 128 gegenüber 1024 der API) – die
  API behält den zweiten Kern und hat bei Bedarf Vorrang. Erwartet: 3–10 min je Nacht.
- **Zeitlimit** je Level 120 s (hängt ein Level, kostet das nur sein Ergebnis); der ganze Lauf
  höchstens 2 h (`TimeoutStartSec`).
- **Welcher Stand?** Der Code der aktiven Version (Commit aus `MURMEL_VERSION`), damit das Ergebnis
  zum laufenden Spiel passt. Der Commit wird mit dem Lauf gespeichert.
- **Aufbewahrung:** Läufe 90 Tage, danach gelöscht (Ergebnisse hängen am Lauf).

### Datenbank (`005_loesbarkeit.sql`; 004 ist für das Forum reserviert)

```sql
solvability_runs    (id, started_at, finished_at, version, levels, probe_ok, probe_lua, probe_failed,
                     solutions, solved, unsolved, failed, new_failures, error)
solvability_results (run_id → runs on delete cascade, level, kind 'probe'|'solution',
                     source 'repo'|'admin'|'', ref (Datei oder Lösungs-Id), status, steps,
                     recorded_steps, level_changed, error)
solutions           (id, level, level_hash, recording jsonb, steps, account_id → accounts on delete
                     set null, created_at)   -- nur bei Weg (a)/(b)
```

### Admin-Ansicht

`/loesbarkeit.html` (noindex, nicht im Offline-Speicher, nur für angemeldete Admins):
- **Kopf:** letzter Lauf – Zeitpunkt, Commit, Dauer; Zahlen: Levels, Ladeprobe ok/Lua/Fehler,
  Lösungen gelöst/nicht gelöst/Fehler, geprüfte Levels.
- **Verlauf:** die letzten 30 Läufe als schmale Balken (rot, wenn es Fehlschläge gab).
- **Probleme zuerst:** Tabelle aller Levels mit Fehler oder ungelöster Lösung, neue oben markiert;
  Filter „alle Levels“, Suche nach Level-Kennung.
- **Level-Verlauf:** Klick auf ein Level zeigt dessen Ergebnisse der letzten Läufe.
- API: `GET /api/admin/loesbarkeit` (letzter Lauf + Probleme + Verlauf),
  `GET /api/admin/loesbarkeit/level?id=…` (Verlauf eines Levels).

## Grenzen

- **Immer:** Spiel bleibt ohne Konto und offline voll spielbar; die Prüfung ändert kein Spielverhalten;
  Tests zuerst; Nachtlauf mit niedrigster Priorität; Rückweg = Timer abschalten.
- **Erst fragen:** Spieler-Läufe (b) und jede Änderung der
  Datenschutzerklärung, Schema-Änderungen nach Migration 005.
- **Nie:** Spielerläufe ohne Einwilligung speichern, Daten außerhalb der EU, Geheimnisse im Repo,
  Mails an andere als `ADMIN_EMAILS`.

## Abhängigkeiten zu laufender Arbeit

- **Forum** (Worktree `murmel-forum`) ändert `server/src/app.ts`, Migration 004 und das Spielmenü.
  `loesbarkeit` hängt seine Endpunkte über eine eigene Funktion in `app.ts` ein (eine Zeile) und nutzt
  Migration 005 – Konflikte nur an dieser Stelle zu erwarten.
- **Level-Sitzungen** ändern `objects.ts`, `luahost.ts`, `enigma.lua`, Leveldateien: genau dafür ist
  die Prüfung da. Ändert ein Import Levelinhalte, kann eine Repo-Lösung „Level geändert“ melden.
  `src/lua/index.ts` exportiert nur `LIBS` zusätzlich.

## Offene Fragen

1. Sollen Lua-Fehler der Ladeprobe (heute 3 Levels) in der CI als Fehler zählen? Vorschlag: nein, nur
   anzeigen; neue Lua-Fehler erscheinen in der Admin-Ansicht.
