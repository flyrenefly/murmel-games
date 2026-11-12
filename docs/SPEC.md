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
  Das Ziel (Objektname, `#id` oder Position) löst der Konverter in Koordinaten auf; bei
  mehreren Zielen gilt das erste (`getDestinationByIndex(0)`), eine Lua-Position „x,y“ wird
  unverändert genommen (Value::POSITION, keine Zentrierung).
  `on`/`off` schalten nur den Sog.
- **st_stoneimpulse** (`StoneImpulse.cc`): schon ein leichter Treffer oder `signal` true startet
  ihn: 220 ms Ausdehnen, dann Impuls an alle vier Nachbarn (Impulssteine pulsieren weiter,
  Kisten werden geschoben, blaue/gelbe Puzzle-Fragmente verschoben), 275 ms Zusammenziehen
  (länger, damit kein Hin und Her entsteht). Hohl: durchlässig, nur aktiv massiv, Murmel
  darin zerspringt. Noch nicht: beweglich, laserempfindlich (steady), verbunden.
- **st_invisible**: massiver, nicht gezeichneter Stein.
- **fl_inverse** (weiß/grau): Haftung −2 – Mausbewegung wirkt umgekehrt.
- **fl_space**: Reibung und Haftung 0 (Murmel lässt sich nicht beschleunigen). Böden mit
  `force_x/force_y` bleiben vorerst draußen.
- **fl_swamp** (`Swamp::get_sink_speed`, `BasicBall::sink`): die Murmel sinkt mit Tempo
  4 · (1 − v/6) ein (schneller als 6 Felder/s steigt sie wieder), bei Tiefe 7 ist sie
  versunken (Klang „swamped“, unsichtbar bis zum Neustart). Gezeichnet mit den 7
  Sink-Bildern; außerhalb des Sumpfs ist die Tiefe sofort 0. Nebenbei: das Murmelbild
  wechselt wie in Enigma je nach Pixelposition zwischen zwei Glanzbildern.
- **fl_hay** (und die anderen FloodStream-Böden): gewöhnlicher Boden. Levels mit
  flutendem Wasser (Zustand FLOODING, `fl_water_source`) bleiben draußen.
- **it_meditation_*** (`Meditation.cc`): Mulden (caldera −3, hollow −2, dent −1) ziehen,
  Hügel (bump 1, hill 2, volcano 3) stoßen ab: Kraft 90 · (Akteur − Feldmitte) im Radius
  0,5 (dent/bump 0,3), der Vulkan hat innen (< 0,3) einen Krater. Gilt für alle Akteure.
  Nachrichten flip, signal, toggle, shovel; ein daraufgeschobener Stein schaufelt sie eine
  Stufe flacher. Perlen und das Meditieren gibt es noch nicht.
- **it_landmine** (`Landmine.cc`): explodiert, wenn ein Akteur näher als 0,3 an die Mitte
  kommt oder ein Stein daraufgeschoben wird (Klang explosion2). Die Explosion (50 ms)
  zerschmettert Murmeln im Feld und hinterlässt eine Mulde (it_meditation_hollow), außer
  auf Abgrund, Wasser und Sumpf.
- Gegenstände (Auslöser, Zettel, Wurmloch, Mulde, Mine, Samen) halten Steine nicht mehr auf.
- **it_seed_wood** (`SeedItem.cc`) und **Inventar** (`player.cc`, `Inventory`): Die Murmel
  hebt einen ruhenden Samen auf, wenn ihre Mitte näher als 0,2 an der Feldmitte ist (höchstens
  12 Gegenstände, neue vorn). Linksklick oder Leertaste legt den ersten Gegenstand in das Feld
  der Murmel, wenn dort kein Gegenstand liegt; ohne Gegenstände wechselt der Klick wie bisher
  die Murmel (Yin-Yang). Auf Touchgeräten gibt es den Knopf „Ablegen“. Ein abgelegter Samen,
  ein daraufgeschobener Stein oder die Nachricht grow/signal lässt ihn wachsen: 13 Bilder à
  120 ms, dann st_box_wood_growing (3 × 130 ms; berührte Murmeln zerspringen, ein Stein im
  Feld wird ersetzt), danach eine normale Holzkiste – auf Abgrund, Wasser und Sumpf eine
  Brücke. Die übrigen Samen (greenbrown, volcano, hay) und die Oxyd-Sonderregel (Samen auf
  Gitter wird Holzboden) fehlen noch.
- **st_brownie und *_movable** (`StandardStones.cc`, `GlassStones.cc`): einfache Steine mit
  MOVABLE_STANDARD – geschoben wie eine Holzkiste, versinken aber nicht und bauen keine
  Brücke (das kann nur `BoxStone`). Gebaut: st_brownie, st_granite/camouflage/redbrown/
  invisible_movable, st_rawglass/lightglass/darkglass_movable; Schatten nach models-2d.lua
  (sh_round, sh_rawglass, sonst sh_solid). Offen: flat, plaster, greenbrown, death,
  stoneimpulse und rotator in der _movable-Form (eigene Sonderregeln).
- **st_boulder** (`BoulderStone.cc`): rollt in seine Richtung (Standard Nord), gesteuert vom
  Ende jedes Animationsdurchlaufs (3 × 120 ms): frei → ein Feld weiter (Murmel im Zielfeld
  zerspringt), sonst warten. Beim Ankommen und beim Drehen erhält der Stein davor einen
  Auslöser – ein Oxyd-Stein öffnet sich dann wie bei einem Treffer. Auf einem Abgrund
  stürzt er ab (Sturzanimation, dann weg), Wasser hält ihn nicht auf. Die Murmel kann ihn
  nicht schieben; Impulssteine bewegen ihn. Nachrichten turn, turnback, flip
  (counterclock). Offen: Zauberstab, Licht (Laser), Rotatoren.
- **it_magicwand** und Inventardrehung (`SimpleItems.cc`, `player.cc`): gewöhnlicher
  Gegenstand (Aufheben unter 0,3 zur Feldmitte, bei jedem Schritt – wie in Enigma wird ein
  abgelegter Gegenstand nahe der Mitte sofort wieder aufgehoben). Er wirkt, wenn er vorn
  liegt (`WieldedItemIs`): Ein Treffer dreht Felsbrocken und farblose Einbahnsteine um;
  blaue Puzzlesteine explodieren zuerst als Cluster, sonst verschieben sie sich, sonst
  rotiert die Reihe. Rechtsklick, Tab oder „Drehen“ rotiert das Inventar
  (`Inventory::rotate_left`). Die Leiste zeigt „Hand: …“ und den Rest.
- **Hohle Puzzlesteine** (`PuzzleStone.cc`, OBJBIT_HOLLOW): Die Murmel rollt hindurch, ein
  Treffer bewirkt nichts, beim Verschieben zerdrücken sie keine Murmel; mit ihrem Cluster
  bewegen, rotieren und explodieren sie wie andere. Bilder `st_puzzle_*_hollow`, Schatten
  `sh_puzzle_hollow`. Der Export (enigma-web 0d6063b4, Lauf 43209170049) schreibt dafür
  `$hollow` (das Flag steht in Enigma nicht in der Attributliste). Hinweis: Jeder Export hält
  Enigmas Zufall eines Ladevorgangs fest (Oxyd-Farben, Zufallsstarts, gemischte Puzzles); ein
  neuer Export ändert diese Varianten.
- **Nachrichten an Oxyd-Steine** (`OxydStone.cc`, `StateObject.cc`): Benannte Oxyd-Steine
  bekommen einen unsichtbaren Stellvertreter `st_oxyd_ref` (Ziel für Auslöser, Schalter,
  Lua). open/on/signal 1 öffnen wie ein Treffer (`tryOpen`), close/off/signal 0 schließen
  einen einzeln offenen Stein, toggle wechselt, closeall schließt alle, shuffle mischt die
  Farben aller geschlossenen Steine neu (gleichverteilt; Enigmas Mischregeln aus
  `wo:shuffleOxyd` bleiben unberücksichtigt). `oxydcolor` „%3“ gilt wie in `Value::toInt`
  als 3.
- **it_spring / it_spring_keep / it_spring_drop** (`SimpleItems.cc` Spring, `Balls.cc`
  JUMPING): aufhebbar (Radius 0,3). Klick/Leertaste mit der Feder vorn: Die Murmel springt
  (`keep` bleibt im Inventar, `drop` wird abgelegt – nur wo kein Gegenstand liegt). Ein
  Sprung dauert so lange wie die Animation (Ping-Pong aus 4 Bildern à 70 ms = 0,56 s). Im
  Flug (`World::get_local_force`, `Actor::think`): keine Maus-, Boden- oder Gegenstandskraft,
  keine Reibung, kein Bodenkontakt (Abgrund, Wasser, Sumpf wirken erst nach der Landung),
  keine Auslöser, Minen oder Aufheben, keine Zusammenstöße mit Gegnern; globale Kräfte,
  Wurmlöcher und Steine wirken weiter. Klang `boink`.
- **st_chameleon** (`ChameleonStone.cc`): zeigt das Bild des Bodens darunter (verdeckt
  Gegenstände dort), Akteure rollen hindurch (`STONE_PASS`), andere Steine können nicht
  hinein.
- **Leben und it_extralife** (`player.cc`, Nutzerentscheidung 12.11.: Enigmas Regel für die
  Enigma-Levels, Murmels eigene Levels behalten unbegrenzte Leben): Ein neues Spiel
  (Levelauswahl, Neustart) beginnt mit zwei Extraleben im Inventar (`ProvideExtralifes`,
  sonst keine); nach einem gewonnenen Level werden die übrigen ins nächste mitgenommen
  (`PrepareLevel`). Jeder Tod kostet eins (außer `InfiniteReincarnation`). Ohne Extraleben
  beginnt das Level als neues Spiel. Bei `ConserveLevel = false` startet nach einem Tod das
  ganze Level neu (das Leben ist verbraucht). Extraleben sind Gegenstände: aufheben,
  ablegen (Klick, wenn eines vorn liegt), drehen. Mit zwei Murmeln liegt der Yin-Yang
  als Gegenstand vorn im Inventar (`AddYinYang`), ein Klick damit wechselt die Murmel.
  Der Importer übernimmt `ConserveLevel`, `ProvideExtralifes`, `InfiniteReincarnation`
  (bei API-1-Levels per Textsuche). Offen: Ist eine von zwei Murmeln ohne Leben tot,
  wechselt Enigma zur anderen statt neu zu starten.
- **ac_pearl_white / ac_pearl_black** (`Balls.cc` Pearl): weitere Kugeln des Spielers
  (Radius 13/64, Masse 0,7, `adhesion` 1, `controllers` 3 – sie folgen immer der Maus, der
  Yin-Yang wechselt nur zwischen den Murmeln). Sonst wie Murmeln: fallen, zerspringen,
  sinken, lösen Auslöser aus, heben Gegenstände auf, kosten beim Tod ein Extraleben;
  Gummibänder und `velocity_x/_y` aus dem Level gelten. Bilder `ac_pearl_*`, `sh_pearl`,
  Fallanimation 70 65 60 55 50 ms. In Murmels Physik sind sie Einträge in `marbles` mit
  `pearl: true`.
- **Weiße Murmel ohne Yin-Yang** (Levels ohne `el:network`): Sie gehört Spieler 2
  (`controllers` 2) und ist im Einzelspiel eine passive Kugel ohne Mauskraft; der Yin-Yang
  fehlt. Sie hat eigene zwei Extraleben (Spieler 2); ohne Leben bleibt sie liegen, außer
  sie ist `essential` – dann beginnt das Level neu.
- **Rotoren `attacknearest` / `prefercurrent`** (`RotorBase::think`): nur die nächste Kugel
  jagen; alle 0,8–1,6 s mit Wahrscheinlichkeit `prefercurrent` nur die gesteuerte Murmel.
  (Wurde vorher vom Importer weggelassen; außer Persecution Mania nutzt kein Level es.)
- **st_passage_black / st_passage_white** (`PassageStone.cc`): Nur ein Akteur der eigenen
  Farbe kommt durch (Murmeln, Perlen, Killer); Rotoren und Kreisel prallen ab, Kisten
  können nicht hinein. signal/toggle und der Auslöser eines Felsbrockens wechseln die
  Farbe, open/on → weiß, close/off → schwarz. Form (square, slash, cross, frame,
  backslash) liefert der Export seit enigma-web 701939f7 als `$flavor` (Lauf 43234502499;
  neuer Export = neue Zufallsvarianten). `blockAt` kennt dafür die Farbe des Akteurs.
- **wo["FallenPuzzle"]** (`PuzzleStone.cc`, `server::FallenPuzzle`): Boden, den ein in Wasser
  oder Abgrund versunkener Puzzlestein hinterlässt (Standard fl_gray). Ein Bodenname gilt
  direkt; „=key“ heißt `enigma.settile(ti[key])` – der Importer löst die Kachel über die
  Lua-Schicht auf (`__describetile`). Gegenstände dort (it_strip, it_pipe) fehlen noch.
- **it_yinyang als Gegenstand, Inventar je Spieler** (`SimpleItems.cc` Yinyang,
  `player.cc`): Jeder Spieler hat ein eigenes Inventar mit eigenen Extraleben; was eine
  Kugel aufhebt, gehört ihrem Besitzer (weiße Murmel = Spieler 2, schwarze Murmel und
  Perlen = Spieler 1). Ein Yin-Yang im Inventar wechselt per Klick zum anderen Spieler
  (`SwapPlayers`), auch zu einer sonst passiven weißen Murmel; angezeigt wird das
  Inventar des aktuellen Spielers. Netzwerk-Levels geben beiden Spielern zu Beginn einen
  Yin-Yang (`AddYinYang`). Hat Spieler 2 keine Leben mehr, bleibt die weiße Murmel liegen
  und die Steuerung geht an Spieler 1 zurück.
- **st_swap** (`SwapStone.cc`): Ein kräftiger Stoß (oder ein Impuls) lässt ihn mit dem Stein
  dahinter den Platz tauschen – Objektsteine wie Mauern der Karte; ohne Stein dahinter
  passiert nichts. 0,1 s Richtungsbild (st_swap_n/s/e/w). Abweichung: Mit Oxyd-Steinen
  tauscht er in Murmel nicht (deren Platz ist dort fest mit der Paarlogik verbunden).
- **st_fourswitch** (`FourSwitch.cc`): Jeder Treffer dreht ihn eine Richtung weiter (im
  Uhrzeigersinn, `counterclock` umgekehrt); auch signal (ungerader Wert, API 1 jeder),
  toggle und ein fallender Felsbrocken-Auslöser. Mit `target_0`…`target_3` erhält die alte
  Richtung false (nicht beim ersten Drehen), die neue true; mit `target` geht die neue
  Richtung als Zahl an das Ziel (`orientate` an Felsbrocken, Zahl an Lua-Rückrufe; API 1:
  true für West/Ost). Nachrichten tragen dafür optional einen Zahlenwert.
- **Lua-Ergänzungen:** Gruppen sind als Iterator aufrufbar (`for o in group do`); setzt ein
  Rückruf Kacheln, nimmt der Importer die unterstützten Arten aller `ti`-Einträge auf
  (Kacheln in eigenen Tabellen wie `floors[dir]`).
- **st_redfiber, st_lightglass, st_darkglass** (`GlassStones.cc`): feste Steine; sie lassen
  nur Laser bzw. unsichtbare Akteure durch, beides gibt es in Murmel nicht.
- **it_sensor** bleibt offen: Die drei Levels, die nur am Sensor scheiterten (Limited
  Supplies, Magic Trinity, Tilt Board), rufen damit Lua-Funktionen auf (siehe Lua-Rückrufe).
- **st_fake_quake** (`FakeStone.cc`): sieht aus wie ein Bebenstein und wackelt beim Treffer
  (Klang „st-fakeoxyd“), schließt aber keine Oxyd-Steine und kennt keine Nachrichten.
- **API 1** (Enigma-Kompatibilität < 1.10): Nachrichten werden wie in `api1init.lua`
  umbenannt (`openclose` an Türen und `onoff` an Schalter → `toggle`).

### Weitere Akteure (`src/game/actors.ts`)

- **ac_rotor / ac_top** (`Rotors.cc`): Radius 22/64 bzw. 16/64, Masse 0,8. Liegt die Murmel
  näher als `range` (Vorgabe 5), zieht die Kraft `strength` (Vorgabe 10) zu ihr, sonst mit
  `gohome` zurück zur Startposition. Rollen mit Bodenreibung, prallen an Steinen ab, lösen
  aber keine Steine aus.
- **ac_killer** (`KillerActor.cc`): sieht aus wie eine Perle (Radius 13/64, Masse 0,7) und
  folgt der Maus wie die Murmel, mit doppelter Mauskraft (Attribut adhesion 2).
- Berührt einer davon die Murmel, zerspringt sie. Akteure prallen elastisch voneinander ab
  (`World::handle_actor_contact`, reduzierte Masse, Rückprall 1).
- Gegner lösen Steine aus wie die Murmel (Oxyd-Steine öffnen sich für jeden Akteur,
  `OxydStone::actor_hit`), berühren sie aber nicht (keine Todessteine). Farbige Schalter
  reagieren nur auf den Killer der passenden Farbe.
- **ac_marble_white** (zweite Murmel): nur in Levels mit Netzwerkmodus, denn nur dort gibt
  Enigma im Einzelspiel das Yin-Yang aus (`player::LevelLoaded`). Klick, Leertaste oder der
  Knopf „Murmel wechseln“ steuert die andere Murmel (`SwapPlayers`); nur die gesteuerte
  spürt die Maus. Beide öffnen Oxyd-Steine, drücken Auslöser, fallen und starten an ihrem
  eigenen Startpunkt neu. `essential` und `AutoRespawn` werden nicht nachgebildet.
- **Gummibänder** (`ot_rubberband`, `src/game/rubber.ts`, nach `Rubberband::applyForces`):
  Feder zwischen zwei Akteuren oder einem Akteur und einer Steinmitte. Länger als `length`
  zieht sie mit `strength · (len − length)` (negativ: stößt ab), kürzer als `threshold`
  drückt sie; `min`/`max` wirken als harte Grenze (Seil/Stange). Der Physikschritt sammelt
  dafür erst alle Kräfte, wendet dann die Bänder an und bewegt danach (Reihenfolge wie
  `World::move_actors`). Enigmas Code weist im Federzweig die zweite `ActorInfo` per
  Referenz zu (kopiert sie also); nachgebaut ist die beabsichtigte Gegenkraft.
  Der Export (enigma-web `level-export`) liefert die Bänder als `rubberbands`; Bänder an
  beweglichen Steinen (Kisten, Puzzles …) bleiben vorerst draußen. Gezeichnet als 2 px
  breite orange Linie (240, 140, 20).

### Lua-Rückrufe (ab 12.11.2026, `src/lua/`, `src/game/luahost.ts`)

Viele Enigma-Levels lassen Auslöser, Schalter oder Timer eine Lua-Funktion des Levels aufrufen
(`Object::performAction`: Ziel ohne Objekt und Aktion „callback“ oder leer → `lua::CallFunc`
mit `(value, sender)`). Nutzerentscheidung 12.11.: Lua-Interpreter statt Nachbau je Level.

- **Interpreter:** fengari (Lua 5.3 in JavaScript, MIT), im Browser `fengari-web` (das
  Paket `fengari` hält den Vite-Entwicklungsserver wegen dessen `process`-Objekt für Node),
  in Node (Importer, Tests) `fengari`. Wird nur in Lua-Levels nachgeladen (ca. 68 KB gzip).
- **API-Schicht `src/lua/enigma.lua`:** Teil von Enigmas API 2 – `po`, Positionslisten,
  `no[]`, `st/it/fl`, Gruppen (`+ - *`, `g[obj]`, `g[-1]`, `:sub`, `:sort`, `:shuffle`,
  Nachrichten an alle), Objekte (Attribute, `:open/:close/:toggle/:message/:kill/:exists`),
  `ti`, `wo[pos] = Kachel`, `wo["GlobalForce"]`, `wo["FrictionStrength"]`, `cond`,
  Konstanten aus `api2init.lua`. Lua-5.1-Ausgleich (`unpack`, `table.getn` …; ganze
  Koordinaten bleiben Ganzzahlen, weil 5.3 sonst „8.0“ statt „8“ schreibt).
- **Init-Modus:** Das Levelskript läuft beim Start einmal; Weltaufbau (`wo(...)`,
  `wo[...] = …`, `wo:shuffleOxyd`, Objektänderungen) wird übersprungen, weil der Export ihn
  schon enthält. Weltwerte zählen (der Export enthält sie nicht).
- **Brücke `luahost.ts`:** Referenzen `o:<id>` (Objekte), `c:fl|st:x:y` (Böden, einfache
  Steine), `a:<n>` (Akteure). Neue Steine/Böden zur Laufzeit ändern `level.cells`, die
  Physik (`setSolid`) und zeichnen die statische Ebene neu; Objekte (Türen, Gitter …)
  entstehen über `ObjectWorld.create`. Namen auf „#“ werden wie in Enigma durchnummeriert.
- **Weltwerte auch ohne Rückrufe:** Der Importer führt jedes Levelskript einmal auf dem
  Export aus und übernimmt `GlobalForce` und `FrictionStrength` (`world`). Vorher ignoriert:
  Good Luck!, Parabola (Schwerkraft), Friction Nightmare, Worse Nightmare (Reibung).
  Reibung nach `world.cc`: Faktor auf die Bodenreibung, negativ beschleunigend.
- **ot_timer** (`TimerGadget.cc`): Der Importer zeichnet `wo:add`-Aufrufe im Init-Modus auf;
  Timer werden Objekte ohne Feld (x = −1), Logik wie `st_timer`, standardmäßig an.
  Andere `ot_`-Objekte (ot_counter …) führen zur Ablehnung. Levels, die ot_timer nutzten,
  waren vorher ohne Timer im Spiel (Inverse Maze II und Kaleidoscope fielen deshalb heraus:
  `lib.maze` bzw. `wo:drawRect` mit Resolver im Rückruf fehlen).
- **Importprüfung (`tools/lua-check.mjs`):** Rückrufe dürfen nur bekannte Funktionen,
  Methoden und Arten setzen; abgelehnt werden API 1 (`set_stone`, `enigma.*` …),
  Bibliotheken (`lib.*`, `res.*` im Spiel), Akteure zur Laufzeit, unbekannte Kachelarten,
  Fehler beim Init. Ziele, die nichts benennen, ignoriert Enigma – der Importer auch
  (außer bei Bibliotheken oder Namen, die im Skript vorkommen).
- **Offen:** 3D-Stil zeichnet zur Laufzeit gesetzte Steine/Böden nicht neu; `postinit`
  wird nicht aufgerufen (der Export ist nach `postinit` entstanden); Akteur in einem neu
  gesetzten Stein ungeprüft.

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
