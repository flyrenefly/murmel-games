# Spec: `api-basis` – Server-Grundausstattung

Baustein aus `docs/SERVER.md` (Phase B). Stand 13.11.2026.

## Ziel

Auf dem IONOS-VPS (`murmel-vps`, 85.215.139.111) läuft ein betriebsfertiger Rahmen, auf dem die
späteren Bausteine (`konten`, `sync`, `bestenliste` …) nur noch Endpunkte und Tabellen ergänzen:

- Reverse-Proxy mit automatischem HTTPS, liefert das Spiel aus und leitet `/api/*` an die API.
- API-Dienst (Node.js 24, TypeScript ohne Build-Schritt) mit Gesundheitsprüfung.
- PostgreSQL mit versionierten Migrationen.
- Rollout aus einem Commit mit Rückweg, nächtliche Datenbanksicherung.

Die öffentliche Adresse `murmel.games` ändert sich in diesem Baustein **nicht**; getestet wird über
den IONOS-Hostnamen `054heee.cserverhost.cloud`. Die Umstellung ist Baustein `umzug`.

## Aufbau

```
Internet ─► Caddy :80/:443 ─┬─ /api/*  ─► api:3000 (nur im Docker-Netz) ─► db:5432 (nur im Docker-Netz)
                            └─ sonst   ─► /srv/www/current (statisches Spiel, dist/)
```

| Teil | Wahl | Grund |
|---|---|---|
| Proxy | Caddy 2 | HTTPS automatisch, einfache Konfiguration |
| API | Node.js 24 + Fastify, `node src/index.ts` (Type-Stripping) | gleiche Sprache wie das Spiel, kein Build-Schritt |
| Datenbank | PostgreSQL 18, Bibliothek `postgres` | entschieden in SERVER.md |
| Betrieb | Docker Compose unter `/opt/murmel` | vorhanden auf dem VPS |

Nur Caddy veröffentlicht Ports. API und Datenbank sind von außen nicht erreichbar (Docker umgeht
ufw bei veröffentlichten Ports).

## Endpunkte

| Methode | Pfad | Antwort |
|---|---|---|
| GET | `/api/health` | `200 {"ok":true,"version":"<commit>","db":"ok"}`; bei Datenbankfehler `503` mit `"db":"fehler"` |

## Projektstruktur

```
server/                 API-Paket (eigenes package.json, eigene Tests)
  src/index.ts          Start, Fastify, Routen
  src/db.ts             Verbindung, Migrationen
  src/app.test.ts       Tests (node:test)
  migrations/*.sql      Schema in Reihenfolge, je Datei einmal angewendet
  Dockerfile
deploy/server/          Betrieb auf dem VPS
  compose.yml, Caddyfile, backup.sh, murmel-backup.service/.timer
tools/deploy-server.sh  Rollout vom Entwicklungsrechner
```

## Befehle

```
Tests API:    npm --prefix server test
Rollout:      tools/deploy-server.sh            (baut dist/, überträgt Spiel + Server, startet neu)
Rückweg:      tools/deploy-server.sh --rollback (vorheriges Spiel-Release, vorheriges API-Image)
```

## Rollout

- Spiel: `dist/` nach `/opt/murmel/www/releases/<commit>`, dann Symlink `current` atomar umhängen;
  die letzten 5 Releases bleiben.
- API: Quellen nach `/opt/murmel/src`, Image `murmel-api:<commit>` auf dem VPS bauen, Compose neu
  starten; das vorherige Image bleibt für den Rückweg.
- Geheimnisse (Datenbankpasswort) entstehen einmalig auf dem VPS in `/opt/murmel/.env` (Rechte
  600) und verlassen den Server nie.

## Sicherung

Täglich 03:30 `pg_dump` (komprimiert) nach `/var/backups/murmel`, 14 Tage aufbewahrt. Sicherung
außer Haus: offen (eigener Schritt, Ziel festlegen).

## Tests und Abnahme

- [x] `npm --prefix server test` grün (Gesundheitsprüfung mit und ohne Datenbank).
- [x] `https://054heee.cserverhost.cloud/` liefert das Spiel mit gültigem Zertifikat.
- [x] `https://054heee.cserverhost.cloud/api/health` liefert `ok` und `db: ok`.
- [x] Ports 3000 und 5432 sind von außen nicht erreichbar.
- [x] Rückweg einmal ausgeführt und wieder vorwärts.
- [x] Sicherung einmal von Hand ausgelöst, Datei vorhanden und lesbar.

## Grenzen

- Immer: Tests vor Commit; Geheimnisse nur auf dem Server; jeder Rollout mit Rückweg.
- Erst fragen: DNS (`murmel.games`), Sicherung außer Haus (Ziel/Kosten), neue kostenpflichtige Dienste.
- Nie: Datenbank oder API-Port nach außen öffnen; Passwörter im Repo oder in der Ausgabe.
