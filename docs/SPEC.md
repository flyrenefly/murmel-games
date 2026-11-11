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

## Enigma-Levels übernehmen – Umsetzung (ab 11.11.2026)

Statt Enigmas Lua-/C++-Levelschnittstelle nachzubauen, lädt **Enigma selbst** jedes
Level und exportiert den fertigen Weltzustand:

1. Fork `flyrenefly/enigma-web`, Branch `level-export`: `--makepreview` mit
   `ENIGMA_EXPORT_JSON=<dir>` schreibt je Level Böden, Steine, Gegenstände (Art und
   Attribute) und Akteure als JSON. GitHub Actions baut Enigma unter Linux und lädt
   den Export als Artefakt `enigma-levels-json` hoch.
2. `tools/import-enigma.mjs <export> <enigma>/data` übersetzt in Murmel-Levelpakete
   (`public/levels/enigma/`), kopiert die benötigten Grafiken und schreibt
   `tools/import-report.md` mit den Gründen für nicht übernommene Levels.
3. Ein Level wird übernommen, wenn Lizenz passt (GPL, gespendet, gemeinfrei), genau
   eine schwarze Murmel, keine Gegenstände und nur bereits unterstützte Böden/Steine
   vorkommen. Mit jedem neuen Objekt in Murmel steigt die Zahl automatisch.
4. Oxyd-Farben ohne feste Vorgabe werden wie in Enigma bei jedem Levelstart neu
   gemischt (`?` im Levelformat).

## Enigma-Objekte nachbauen – Stufe 1 (ab 11.11.2026)

Nutzerentscheidung 11.11.2026: Objekte einzeln nachbauen (statt Enigma als WebAssembly).
Erster Konverterlauf: 7 von 1322 Levels; fast jedes Level braucht mehrere Objekte.
Stufe 1 deckt die häufigsten Mechanik-Bausteine ab, Vorlage ist der Enigma-Quelltext:

- **Levelformat:** neben `map`/`legend` eine Liste `objects` (`{x, y, k, a}`: Zelle,
  Enigma-Art, Attribute). Interaktive Steine und alle Gegenstände stehen dort.
- **Nachrichten** (`Object::performAction`, `StateObject::message`): Ziel = Name,
  `#id` oder `name#*`; Aktion `toggle` (Standard), `signal` (Wert 0/1), `open`/`on`,
  `close`/`off`; `target_N`/`action_N` je Zustand; `inverse` kehrt den Wert um.
  Lua-Rückrufe (`callback`) werden nicht nachgebaut – solche Levels bleiben draußen.
- **it_trigger:** gedrückt, solange der Murmel-Mittelpunkt auf dem Feld liegt;
  sendet `true` beim Drücken, `false` beim Loslassen; `invisible` = unsichtbar.
- **st_switch** (auch `_black`/`_white`, `instant`): kippt beim Treffer, Animation
  3 × 60 ms, Aktion mit neuem Zustand nach der Animation (sofort bei `instant`);
  farbige Schalter reagieren nur auf die gleichfarbige Murmel.
- **st_door_a/b/c/d:** geschlossen massiv, offen durchlässig, Öffnen/Schließen mit
  Animation (60 ms je Bild), während der Bewegung massiv; schließt eine Tür über der
  Murmel, zerspringt sie. `st_door_d` sperrt nur die beiden Seiten aus `faces`
  (`$connections`: W=1, S=2, O=4, N=8).
- **st_grate_cross/framed:** für die rollende Murmel durchlässig.
- **it_document:** beim Überrollen erscheint der Text (aus `el:string` des Levels,
  deutsch falls übersetzt); Abweichung: kein Inventar, der Zettel verschwindet sofort.
- **st_box_wood/hay/rock** (`BoxStone.cc`, `maybe_push_stone`): trifft die Murmel eine
  Seite (nicht die Ecke) mit mehr als 4 Feldern/s, rückt die Kiste ein Feld weiter,
  wenn dort kein Stein ist; schiebt sie sich auf die Murmel, zerspringt diese. Auf
  Abgrund, Wasser oder Sumpf wird sie zum Boden (`fl_wood_framed_h/_v`, Heu, Fels).
  Kisten drücken Trigger. Noch nicht: mit Drähten verbundene Kisten, Axt.

- **st_timer** (`TimerStone.cc`): sendet alle `interval` s (Standard 1) abwechselnd
  true/false, beginnend mit true; `loop=false` einmal; `on`/`off`/`signal` starten/stoppen.
- **st_quake** (`QuakeStone.cc`): sieht aus wie ein geschlossener Oxyd-Stein; Treffer,
  `toggle` oder `signal` mit true lassen ihn beben (800 ms) und schließen **alle**
  Oxyd-Steine, auch gelöste Paare.
- **st_death** (`DeathStone.cc`): jede Berührung, auch eine sanfte, zerschmettert die
  Murmel; Pulsanimation 3 × 140 ms; `st_death_invisible` unsichtbar. Noch nicht: beweglich.
- **st_oneway** (`OneWayStone.cc`): Durchgang nur in Pfeilrichtung (sperrt die Pfeilseite
  von außen); `signal`/`flip` drehen um; weiße sperren die schwarze Murmel ganz.
- **st_puzzle** (`PuzzleStone.cc`, Enigma-Modus): Steine mit Verbindungen (`$connections`)
  bilden Fragmente; vollständig = keine offene Verbindung. *Gelb:* Treffer auf eine Seite
  rotiert die Reihe gleichfarbiger Steine von der Murmel weg (letzter rückt an den Anfang),
  ein einzelner Stein wird bei kräftigem Stoß wie eine Kiste geschoben, ein vollständiges
  Puzzle ohne weitere Nachbarn explodiert Stein für Stein (0,2 s Zündverzögerung, die
  Explosion zerschmettert die Murmel). *Blau:* kräftiger Stoß schiebt das ganze Fragment,
  wenn alle Zielfelder frei sind; über Wasser immer, über Abgrund nur vollständig wird es
  zu Boden (`fl_gray`). Puzzlesteine drücken Trigger. Noch nicht: hohle Steine, Zauberstab,
  Laser, `FallenPuzzle`.
- **it_wormhole** (`WormHole.cc`): zieht die Murmel an (Kraft 0,6·strength/Abstand, Standard
  strength 30, range 10, unabhängig vom Boden) und versetzt sie, sobald ihr Mittelpunkt
  näher als 0,125 an der Lochmitte ist, ans Ziel (Tempo 0); `interval` sperrt danach.
  Das Ziel (Objektname, `#id` oder Position) löst der Konverter in Koordinaten auf.
  `on`/`off` schalten nur den Sog.
- **fl_inverse** (weiß/grau): Haftung −2 – Mausbewegung wirkt umgekehrt.
- **fl_space**: Reibung und Haftung 0 (Murmel lässt sich nicht beschleunigen). Böden mit
  `force_x/force_y` bleiben vorerst draußen.
- **API 1** (Enigma-Kompatibilität < 1.10): Nachrichten werden wie in `api1init.lua`
  umbenannt (`openclose` an Türen und `onoff` an Schalter → `toggle`).

## Auffindbarkeit (SEO, ab 11.11.2026)

Nutzerwunsch: bei der Suche nach „Enigma“ oder „Oxyd“ gefunden werden.
- Startseite: Titel/Beschreibung mit Oxyd, Enigma, Murmelspiel, Browser, kostenlos;
  canonical, Open Graph/Twitter mit `og-image.png` (1200×630), JSON-LD `WebSite` +
  `VideoGame` (isBasedOn Enigma), noscript-Text.
- Inhaltsseite `ueber.html`: Spielprinzip, Steuerung, Oxyd-Geschichte, Enigma, Levels,
  FAQ mit `FAQPage`-JSON-LD. Oxyd nur als Bezug („in der Tradition von“), mit Hinweis,
  dass Murmel unabhängig ist und keine Originalinhalte enthält.
- `robots.txt`, `sitemap.xml`, `manifest.webmanifest`, `favicon.svg`.
- Offen beim Nutzer: Google Search Console (Domain bestätigen, Sitemap einreichen).

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

## Original-Gefühl: Grafik und Steuerung nach Enigma (umgesetzt 11.11.2026)

Nutzerwunsch: Grafik und Steuerung sollen dem Original entsprechen. Umsetzung mit
Enigma (GPL) als Vorlage, nicht mit den Dongleware-Originalgrafiken (Rechte ungeklärt):

- Stil **Klassisch** (Standard) und **Klassisch (Retro)**: 2D-Canvas, Enigma-Grafiken
  32 px (`public/enigma/`), 640×416 Spielfeld + Statusleiste, ganzzahlig skaliert,
  Bildsprung zwischen 20×13-Ausschnitten (Raster 19×12 wie Enigma), Schatten,
  Öffnungs-/Blink-/Paar-Animationen der Oxyd-Steine, Fallanimation der Murmel.
- Physik nach `src/world.cc`: Maus = Kraft (MouseSpeed × Pixel × Haftung) für einen
  10-ms-Takt, Reibung ∝ v^0,8 je Boden (fl_gray 5,0/3,0), Höchstgeschwindigkeit 70,
  vollelastischer Steinkontakt, Schritt 2,5 ms, Treffer erst ab 0,3 Kacheln/s.
  Abweichung: Bei Dauerkraft (Tasten/Neigen) prallen langsame Stöße nicht ab.
- Paarregel nach `OxydStone.cc` (Enigma-Modus).

## Entscheidungen

- Arbeitstitel „Murmel“, Domain murmel.games.
- Weg B (Nutzer 11.11.2026): eigene Engine mit Enigma-Grafik und -Physik statt Enigma-Port.
- Beide Grafikstile umschaltbar (Nutzerwunsch 11.11.2026).
- Repo: privates Repo `flyrenefly/murmel-games` (kein GitHub Pages nötig).
