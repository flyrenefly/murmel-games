# Lasttest murmel.games (16.11.2026)

Frage: Verkraftet der VPS (IONOS, 2 vCPU, 4 GB, Caddy + Fastify-API + PostgreSQL 18 in Docker
Compose) einen Ansturm von ~200 gleichzeitigen Besuchern nach einer Bekanntmachung (Hacker News,
Reddit)?

**Kurz:** Ja, der Server ist nicht der Engpass. Bei 100 gleichzeitigen Besuchern mit vollem
Seitenaufbau (≈ 18 neue Besuche/s, ≈ 65 000 Besuche/h) blieben 41–54 % CPU frei, die API antwortete
mit p95 ≈ 130 ms, es gab keinen einzigen Fehler. 200 gleichzeitige wiederkehrende Besucher (Startseite
+ API, ≈ 60 Besuche/s) liefen mit p95 32 ms. Begrenzt hat die Leitung des Testrechners (~100 Mbit/s):
die volle 200er-Stufe ließ sich von hier aus nicht erzeugen. Die offene Größe ist damit die
**ausgehende Bandbreite des VPS**, nicht CPU, RAM oder Datenbank.

## Aufbau

- Skript: [`tools/lasttest.mjs`](../tools/lasttest.mjs) (Node ≥ 20, ohne Abhängigkeiten), Server-Mitschrift:
  [`tools/lasttest-server.sh`](../tools/lasttest-server.sh) (nur lesend: `/proc/loadavg`, `vmstat`,
  `free`, `docker stats`, `pg_stat_activity`).
- Gelaufen am 16.11.2026, 10:27–10:35 MEZ, von einem Windows-Rechner (Node 24) gegen
  `https://murmel.games` (Version `90fe3564c8fc`). Gesamtlast ≈ 4,5 min.
- **Ein Besuch** (ohne Browser-Cache): `/` → 9 Bundles aus der Startseite parallel (JS/CSS) →
  `/levels/enigma/index.json` → ein zufälliges Levelpaket → parallel `/api/health`,
  `/api/tageslevel`, `/api/bestenliste/level?id=…`. Danach 1–5 s Denkzeit, dann der nächste Besuch.
  Jeder virtuelle Besucher lädt also alle ~4 s die ganze Seite neu – deutlich strenger als echte
  Besucher, die die Bundles einmal laden und dann spielen.
- `--leicht`: wiederkehrender Besucher (Bundles/Pakete aus dem Cache) – nur `/` und die drei
  API-Lesungen. Prüft API und Datenbank, ohne die Leitung des Testrechners zu füllen.
- **Nicht** getestet: Anmeldung, Mails, Forum, Uploads, Wettkampf, Bestenlisten-/Tageslevel-Läufe
  und die anonymen Zählungen (`POST /api/auswertung`) – letztere landen ununterscheidbar in der
  echten Tagesauswertung und blieben deshalb weg. Der Test hat auf dem Server nichts geschrieben.
- Sicherheitsleinen: Abbruch bei Fehlerquote > 2 % oder p95 > 3 s (rollendes 5-s-Fenster); eigener
  Wächter fragt alle 2 s `/` direkt per IP ab wie der Notbetrieb-Wächter (Abbruch nach 2 Fehlschlägen).
  Der Wächter schlug nie an; der Notbetrieb-Wächter (3 Fehlschläge à 5 min) war nie in Reichweite.
- User-Agent `murmel-lasttest/1` – in den Protokollen erkennbar.

## Ergebnisse

| Stufe | Besuche/s | Anfragen/s | p50 | p95 | p99 | Fehler | Caddy ausgehend¹ |
|---|---:|---:|---:|---:|---:|---:|---:|
| 25 voll | 7,5 | 113 | 34 ms | 90 ms | 139 ms | 0 / 7 245 | ≈ 30 Mbit/s |
| 50 voll | 13,9 | 208 | 41 ms | 126 ms | 249 ms | 0 / 13 470 | ≈ 55 Mbit/s |
| 100 voll² | 18,2 | 273 | 88 ms | 967 ms | 2 533 ms | 0 / 12 300 | ≈ 77 Mbit/s |
| 200 leicht | 59,4 | 238 | 24 ms | 32 ms | 44 ms | 0 / 15 412 | < 4 Mbit/s |

¹ aus `docker stats` (Netz-Ausgang des Caddy-Containers, komprimiert). ² nach 45 s abgebrochen
(p95 im 5-s-Fenster 3,3 s) – Ursache: Leitung des Testrechners, siehe unten. Die 200er-Stufe „voll“
wurde deshalb nicht gefahren.

p95 nach Art der Anfrage:

| Stufe | HTML | Bundles | Level-JSON | `/api/health` | `/api/tageslevel` | `/api/bestenliste/level` |
|---|---:|---:|---:|---:|---:|---:|
| 25 voll | 47 | 98 | 97 | 43 | 50 | 47 |
| 50 voll | 69 | 135 | 158 | 67 | 75 | 72 |
| 100 voll | 360 | 1 023 | 1 549 | 124 | 133 | 133 |
| 200 leicht | – | – | – | 30 | 36 | 32 |

Serverwerte (Spitzen je Stufe, 5-s-Takt):

| Stufe | CPU frei | Load (1 min) | Caddy CPU³ | API CPU | DB CPU | RAM belegt | DB-Verbindungen |
|---|---:|---:|---:|---:|---:|---:|---:|
| Ruhe | 99–100 % | 0,2 | 0 % | 0,2 % | 0 % | ≈ 940 MB | 2 |
| 25 voll | 72–84 % | 0,8 | 20–43 % | 3–7 % | 1–8 % | — | 6 |
| 50 voll | 54–77 % | 0,7 | 43–84 % | 4–10 % | 2–8 % | — | 8 |
| 100 voll | 41–72 % | 1,4 | 36–85 % | 2–14 % | 1–22 % | — | 11 (Pool voll) |
| 200 leicht | 67–79 % | 1,2 | 10–21 % | 15–23 % | 9–20 % | — | 11 (Pool voll) |

³ `docker stats`: 100 % = ein Kern von zwei. RAM der Container blieb unter 60 MB je Dienst, der
Rechner hatte durchgehend > 2,8 GB frei.

Protokolle: keine Fehler in API- oder Caddy-Log, kein OOM, keine Paketverluste im Kernel-Log.

## Engpass

1. **Leitung des Testrechners.** Paralleldownload von Cloudflare: 98 Mbit/s, von murmel.games:
   86 Mbit/s. In Stufe 100 lieferte Caddy ≈ 77 Mbit/s komprimiert – die Leitung war voll. Typisch
   dafür: nur die großen Antworten (Bundles, Levelpakete) wurden langsam, die kleinen API-Antworten
   blieben bei p95 ≈ 130 ms, und der Server hatte noch die halbe CPU frei.
2. **Unbekannt: ausgehende Bandbreite des VPS.** Belegt sind ≥ 77 Mbit/s. Was der IONOS-Tarif
   darüber hinaus liefert, ließ sich von hier nicht messen (ein Upload-Test vom VPS zu Cloudflare
   ergab widersprüchliche 24–110 Mbit/s und ist kein belastbarer Wert).
3. **Datenmenge je Erstbesuch** ist der eigentliche Hebel: Startseite + Bundles ≈ 0,3 MB, ein
   Levelpaket bis ≈ 0,14 MB (gzip). Danach lädt der Service Worker im Hintergrund **768 Dateien**
   vor (`PRECACHE` in `dist/sw.js`): 686 Enigma-Grafiken aus `enigma/gfx32` (≈ 1,45 MB) **und**
   `enigma/gfx32-retro` (≈ 1,10 MB), 22 Klänge (≈ 0,42 MB), 42 JS-Dateien u. a. Gemessen über alle
   768 Dateien: **3,76 MB übertragen** (5,5 MB entpackt). Zusammen mit der Seite selbst also ≈ 4 MB
   und ~780 Anfragen je neuem Besucher. Bei 200 neuen Besuchern in kurzer Zeit sind das ≈ 0,8 GB –
   bei 100 Mbit/s gut eine Minute Vollauslastung, bei 1 Gbit/s wenige Sekunden.
   Das Vorladen blockiert den Spielstart nicht, konkurriert aber um die Bandbreite mit den
   Erstaufrufen neuer Besucher.

Zur Einordnung (grober, öffentlich oft genannter Erfahrungswert, hier nicht gemessen): Ein Platz
auf der Hacker-News-Startseite bringt einige tausend bis ~20 000 Besucher pro Stunde, also etwa
1–6 neue Besuche/s. Gemessen ohne Fehler: 18 Besuche/s mit vollem Seitenaufbau.

## Empfehlungen (Vorschläge, nichts davon ist auf dem Server umgesetzt)

1. **Precache verkleinern** (größter Hebel, im Repo): `gfx32` gehört zum Stil „klassisch“,
   `gfx32-retro` zu „klassisch-retro“ (`src/render/styles.ts`); nur den aktiven Grafiksatz vorladen und den
   anderen (`gfx32` bzw. `gfx32-retro`) erst bei Umschalten in den Cache legen – spart ≈ 1,1–1,45 MB
   und ~340 Anfragen je Erstbesuch. Alternativ die Grafiken zu einem Sprite/Atlas bündeln (eine
   Anfrage statt 686).
2. **Bandbreite des Tarifs klären** (IONOS-Datenblatt/Kundenkonto) und, falls < 1 Gbit/s, einen
   zweiten Lasttest von einem Rechner mit schneller Leitung oder von zwei Standorten gleichzeitig
   fahren (`node tools/lasttest.mjs --stufen 200`), um die volle 200er-Stufe zu messen.
3. **Vorkomprimierte Dateien**: Caddy komprimiert jede statische Antwort bei jedem Abruf neu
   (`encode zstd gzip`); in Stufe 50/100 war Caddy mit bis zu 85 % eines Kerns der größte
   CPU-Verbraucher. Der Build könnte `.gz`/`.zst` neben JS/CSS/JSON/HTML legen und
   `file_server { precompressed zstd gzip }` sie direkt ausliefern. Kein Engpass heute, aber der
   billigste CPU-Gewinn, falls die Bandbreite höher ist als hier messbar.
4. **Cache-Header für Grafiken/Klänge/Pakete**: `/enigma/*`, `/sounds/*`, `/icons/*`,
   `/levels/enigma/*.json` und `manifest.webmanifest` senden kein `Cache-Control` (nur ETag/
   Last-Modified), der Browser rät dann selbst. Für Spieler mit Service Worker spielt das kaum eine
   Rolle (er cacht selbst); ohne SW (z. B. Safari privat, erster Aufruf) wären z. B.
   `Cache-Control: public, max-age=86400` für Grafiken/Klänge und `no-cache` für Pakete
   (Revalidierung per 304, nach einem Release sofort frisch) eindeutiger. Nicht in diesem PR
   umgesetzt, weil die Dateien nicht gehasht sind und eine falsch gewählte Frist nach Releases
   veraltete Grafiken ausliefern würde – lieber zusammen mit Punkt 1 entscheiden.
5. **DB-Pool (10)** reicht: In beiden Spitzenstufen war der Pool voll geöffnet (11 Verbindungen
   inkl. Wartung), aber stets nur 1–2 Abfragen aktiv, API-p95 ≤ 133 ms. Keine Änderung nötig.
   `/api/tageslevel` stellt je Aufruf mehrere Abfragen; ein 10-s-Speicher-Cache für Gäste wäre der
   nächste Schritt, falls die API je zum Engpass wird – heute nicht.
6. **Ratenbegrenzung** der Lese-Endpunkte ist nicht nötig; die schreibenden haben sie bereits je IP.
   Hinweis: Viele Besucher hinter einem gemeinsamen NAT (Firmen, Mobilfunk-CGNAT) teilen sich die
   IP-Fenster der Schreib-Endpunkte (z. B. Auswertung) – bei einer Bekanntmachung im Blick behalten.
7. **API-Protokoll**: Jede Anfrage erzeugt ≈ 200 Byte Log; bei 3 × 10 MB Rotation hält das Log
   ≈ 150 000 Anfragen. Unter Ansturm sind das wenige Stunden – für die Fehlersuche während der
   Bekanntmachung rechtzeitig sichern oder `/api/health` vom Protokoll ausnehmen.

## Wiederholen

```bash
# Server mitschreiben (nur lesend), Ausgabe lokal
ssh -i ~/.ssh/murmel_vps_ed25519 murmel@85.215.139.111 'sh -s 90' < tools/lasttest-server.sh > server.log &
# Stufen 25 → 50 → 100 → 200, je 60 s, 45 s Pause
node tools/lasttest.mjs --json ergebnis.json
# nur API/DB mit 200 wiederkehrenden Besuchern
node tools/lasttest.mjs --leicht --stufen 200
```

Vorher prüfen, dass die eigene Leitung nicht schon bei Stufe 100 voll ist (siehe oben), und den Test
nicht aus GitHub Actions starten.
