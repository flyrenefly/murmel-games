# murmel.games – Spezifikation (Entwurf)

Ein neues, eigenständiges Murmel-Rätselspiel für den Browser, inspiriert vom
Spielgefühl der Atari-ST-Klassiker der 90er. Eigener Name, eigene Grafik, eigene
Levels, eigener Code. Kein Code, keine Grafik und keine Levels aus Oxyd oder Enigma.

## Spielprinzip

- Der Spieler steuert eine Murmel über ein Spielfeld aus Kacheln (Draufsicht).
- Ziel jedes Levels: alle **Signalsteine** paarweise aufdecken. Anstoßen öffnet
  einen Stein und zeigt sein Symbol; passt das zweite geöffnete Symbol nicht,
  schließen sich beide wieder (Memory-Prinzip).
- Hindernisse und Werkzeuge kommen schrittweise dazu: Abgründe, Wasser, Eis,
  Rampen, Schalter, Türen, Schlüssel, bewegliche Blöcke, Teleporter.
- Physik ist das Herz: Trägheit, Rollen, Abprallen, Gefälle.

## Zielplattformen und Steuerung

| Gerät | Steuerung |
|---|---|
| PC/Laptop | Maus mit Pointer Lock (Mausbewegung = Beschleunigung) |
| Handy/Tablet | Neigen (Bewegungssensor), alternativ virtueller Stick |
| Controller | Gamepad-API, linker Stick |

Installierbar als App (PWA), offline spielbar.

## Technik

| Bereich | Wahl | Grund |
|---|---|---|
| Sprache/Build | TypeScript, Vite | Stand der Technik, schneller Build, statische Ausgabe |
| Darstellung | Three.js (WebGL 2, WebGPU wo verfügbar) | Echte Spiegelung/Glanz der Murmel, Schatten, Licht; Kamera von oben mit leichter Perspektive |
| Physik | Eigene kleine Physik (Kreis gegen Kachelraster), feste 120-Hz-Schritte mit Interpolation | Rapier wäre 1,3 MB (gzip) groß gewesen; die eigene Lösung hat wenige KB und rechnet schneller |
| Flüssigkeit | Instancing (wenige Draw-Calls), Schattenfleck statt Schattenkarten, Bloom nur im Neon-Stil, adaptive Auflösung, Texturen zur Laufzeit gezeichnet (keine Bilddownloads) | Schneller Start, stabile Bildrate auch auf Handys |
| Ton | Web Audio API | Geringe Latenz |
| Levels | JSON-Dateien, später Leveleditor im Browser | Einfach zu erstellen und zu teilen |
| Speicherung | IndexedDB (lokal); Phase 2 optional Server-API | Kein Konto nötig |
| Tests | Vitest (Spiellogik), Playwright (Ende-zu-Ende) | Automatisch in CI |
| Hosting | IONOS-Webspace, Upload per GitHub Actions (SFTP) | Rein statische Dateien |

## Phase 1 – spielbarer Kern (Abnahme)

- [ ] Seite lädt unter https://murmel.games in unter 3 s (schnelle Verbindung), Startbildschirm erscheint.
- [ ] Murmel rollt physikalisch glaubwürdig, Steuerung per Maus und per Neigen am Handy.
- [ ] Signalsteine mit Paar-Logik, Abgrund (Leben verloren, Neustart am Startpunkt), Wände.
- [ ] 10 eigene Levels mit steigender Schwierigkeit, Levelauswahl, Fortschritt bleibt nach Neuladen erhalten.
- [ ] Ton und Musik nach erster Interaktion.
- [ ] 60 fps auf aktuellem Mittelklasse-Handy.
- [ ] Automatischer Build, Tests und Upload per GitHub Actions.

## Später (nicht Phase 1)

- Weitere Elemente (Eis, Wasser, Schalter, Türen, Teleporter, Blöcke).
- Leveleditor im Browser, Levels teilen.
- Bestenliste und geräteübergreifender Fortschritt (kleine Server-API).
- Kooperativ zu zweit (zwei Murmeln, WebRTC).

## Grafikstile (umschaltbar)

Zwei Stile, jederzeit im Spiel umschaltbar (Knopf und Taste `T`), Wahl wird
gespeichert. Spiellogik und Physik sind vom Stil völlig getrennt; ein Stil ist
nur eine Sammlung aus Materialien, Licht, Hintergrund und Nachbearbeitung.

| Stil | Aussehen |
|---|---|
| **Glas und Stein** | Glänzende, spiegelnde Glasmurmel, helle Stein-/Marmorkacheln, weiches Licht mit Schatten |
| **Retro-modern** | Dunkler Hintergrund, leuchtende Neonkanten, Glüheffekt (Bloom), klare Formen |

Weitere Stile lassen sich später ohne Änderung der Spiellogik ergänzen.

## Enigma-Levels übernehmen (Phase 2)

Analyse am 11.11.2026 über die Leveldateien von Enigma (Stand Repo master):

- 1335 Levels ohne Nachbauten der Original-Oxyd/Esprit-Levels und ohne
  Experimente; davon 1197 unter GPL v2+, 45 „an Enigma gespendet“, 89 ohne
  Lizenzangabe (nicht übernehmen, solange ungeklärt).
- **Nicht übernommen:** `enigma_oxyd`, `enigma_oxydextra`, `enigma_oxydmagnum`,
  `enigma_peroxyd`, `enigma_esprit` – das sind Nachbauten der Originallevels.
- Levels sind Lua-Skripte mit Kachelkarten; 601 verschiedene Objektarten, viele
  davon nur optische Varianten. 878 Levels ohne eigene Lua-Funktionen.
- Weg: Konverter zur Build-Zeit führt das Level-Lua mit nachgebildeter
  Enigma-API aus und erzeugt unser JSON-Format. Ein Level wird freigeschaltet,
  sobald unser Spiel alle darin benutzten Objektarten kann.
- Das Levelformat bekommt deshalb von Anfang an drei Ebenen pro Kachel:
  Boden, Stein, Gegenstand (wie Enigma), plus Akteure.
- GPL-Levels bleiben GPL; Quellenangabe und Autoren je Level werden angezeigt.

## Entscheidungen

- Arbeitstitel „Murmel“, Domain murmel.games.
- Beide Grafikstile umschaltbar (Nutzerwunsch 11.11.2026).
- Repo: privates Repo `flyrenefly/murmel-games` (kein GitHub Pages nötig).
