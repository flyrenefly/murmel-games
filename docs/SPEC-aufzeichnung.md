# Spec: `aufzeichnung` – fester Zufall, Eingabeaufzeichnung, Nachspielen

Baustein aus `docs/SERVER.md` (Phase A, ohne Server). Stand 13.11.2026.

## Ziel

Ein Lauf eines Levels lässt sich **exakt wiederholen**: Wer Level, Startwert des Zufalls und die
aufgezeichneten Eingaben kennt, erhält ohne Grafik (Node) dasselbe Ergebnis – gleiche Schrittzahl
bis zum Sieg, gleiche Endpositionen. Darauf bauen Bestenliste (Prüfung durch Nachspielen),
Lösbarkeitsprüfung, Geister, Tipps, Spieler-Levels und Wettkampf auf.

## Ausgangslage (Befund 13.11.2026)

- Physik läuft in festen Schritten (`PHYSICS_DT`), Zufall ist fast überall als Funktion übergeben
  (`parseLevel`, `ObjectWorld`, Lua-Host, `chaseForce`, Paar-Mischung).
- **Nicht deterministisch** ist die Spielschleife in `src/main.ts`:
  - Mausbewegung wird einmal pro Bild addiert, nicht pro Physikschritt;
  - Zeitgeber (Schutz, Unsichtbarkeit, Trunkenheit, Rotor, Fallen) laufen mit der Bildzeit;
  - Strudel nutzt `performance.now()`; Neustart nach Tod läuft asynchron;
  - Simulation und Darstellung/Menüs sind in einer Datei verwoben.

## Stufen

| Stufe | Inhalt | Prüfung |
|---|---|---|
| A1 | `src/game/rng.ts`: Zufall mit Startwert (32 bit), ein Generator je Lauf; der Startwert wird beim Levelstart gezogen und gemerkt | Tests: gleiche Folge bei gleichem Startwert, Verteilung grob gleichmäßig |
| A2 | Alle Zeitgeber und die Mauskraft an Physikschritte koppeln (Verhalten bei 60 Bildern/s unverändert) | bestehende Tests grün; Spielgefühl im Browser unverändert |
| A3 | Simulation in `src/game/session.ts` ohne DOM: `GameSession.step(eingabe)` – Physik, Objekte, Lua, Tod/Wiedergeburt, Sieg; `main.ts` wird Hülle (Eingabe, Darstellung, Menüs, Töne) | Tests: Session läuft in Node; Browser-Durchlauf aller Levels ohne Fehler |
| A4 | Aufzeichnung je Physikschritt: Kraft (x, y, auf 1/1024 gerundet) und Aktionen (Ablegen, Drehen, Wechseln, Neustart), lauflängenkomprimiert | Test: Aufzeichnen → Format → Einlesen ergibt dieselbe Eingabefolge |
| A5 | Nachspielen: `replay(level, seed, aufzeichnung)` in Node, Werkzeug `tools/replay.mjs` | Test: zwei Läufe mit gleichem Startwert und gleichen Eingaben sind Schritt für Schritt gleich; ein im Browser aufgezeichneter Sieg wird in Node als Sieg mit gleicher Schrittzahl erkannt |

**Stand 13.11.2026:** A1, A2 und A3 erledigt, A4 als Modul (`src/game/recording.ts`). A3: Die
Simulation steckt in `src/game/session.ts` (`GameSession`, `step(eingabe)`, Oberfläche über `SessionUI`);
`main.ts` ist die Hülle. Geprüft: 6 Session-Tests in Node (Determinismus über den ganzen Zustand,
auch mit Lua; Fallen; Sieg), alle 1141 Levels laden im Browser, Spieltest (Bewegung, Fallen, Oxyd).
A4 und A5 erledigt: Die Session zeichnet jeden Lauf auf (`session.recording()`, Test-Hook
`window.murmel.recording()`), `replay()` in `src/game/replay.ts` spielt ihn in Node nach. Nachweis: ein
im Browser (Edge) aufgezeichneter Lauf ergibt in Node bitgenau denselben Endzustand
(`src/game/fixtures/browser-hostile-world.json`). Offen: `levelHash`, Werkzeug für die Kommandozeile
(kommt mit `bestenliste`, wenn der Server nachspielt).

## Format (Version 1)

```json
{ "v": 1, "level": "enigma_iv/ant03_3", "levelHash": "sha256…", "seed": 123456789,
  "dt": 0.005, "steps": 18234, "result": "sieg",
  "input": [[120, 0, 0], [3, 512, -64], [1, "drop"], [40, 0, 0], …] }
```

- `input`: Lauflängen `[anzahl, mausX, mausY]` oder `[anzahl, mausX, mausY, achseX, achseY]` (Kräfte in
  1/1024; die Achsenkraft von Tasten/Neigen nur, wenn sie nicht 0 ist) oder Aktion `[anzahl, "name"]`;
  eine Aktion gilt vor dem nächsten Schritt. Aktionen: `use` (Klick/Leertaste), `drop`, `rotate`, `swap`.
- Die Session rundet jede Eingabe beim Spielen auf 1/1024 – Spiel und Nachspielen rechnen mit denselben Zahlen.
- Umgesetzt in `src/game/recording.ts` (Stufe A4, Modul; Einbindung in die Spielschleife nach A3).
- `levelHash` bindet die Aufzeichnung an den Levelinhalt (geänderte Levels → alte Aufzeichnungen
  ungültig, nicht falsch).

## Grenzen

- **Immer:** Spielverhalten bleibt gleich (jede Stufe einzeln mit Browser-Durchlauf geprüft);
  Tests zuerst; kleine Commits.
- **Erst fragen:** Änderungen am Spielgefühl (z. B. andere Mausempfindlichkeit), Speichern von
  Aufzeichnungen außerhalb des Browsers.
- **Nie:** Darstellung, Töne oder Zeitmessung des Browsers in die Simulation ziehen.

## Abhängigkeiten zu laufender Arbeit

Die Level-Sitzungen (Pentomino, API 1, Objekte) ändern `objects.ts`, `luahost.ts`, `enigma.lua`.
A1–A2 berühren `main.ts` und die Aufrufstellen des Zufalls nur punktuell; A3 verschiebt Code aus
`main.ts` – vorher mit der Integrationssitzung abstimmen, damit keine Arbeit verloren geht.

## Offene Fragen

1. Darf A2 das Spielgefühl minimal ändern (Mausbewegung je Schritt statt je Bild verteilt)? Bei 60
   Bildern/s identisch, bei 144 Hz-Monitoren gleichmäßiger.
2. Aufzeichnungen zunächst nur im Browser speichern (für Bestzeiten) – Hochladen erst mit `bestenliste`.
