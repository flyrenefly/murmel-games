# Murmel

Ein freies Murmel-Rätselspiel für den Browser: Rolle die Murmel über das
Spielfeld und decke die Signalsteine paarweise auf. Inspiriert vom Spielgefühl
der Murmel-Klassiker auf dem Atari ST.

Spielen: **https://murmel.games** (in Vorbereitung)

## Merkmale

- Läuft in jedem aktuellen Browser, auch auf dem Handy (Steuerung durch Neigen).
- Fünf umschaltbare Stile (Taste `T`): **Klassisch** und **Klassisch (Retro)** mit den
  Grafiken von Enigma, dazu **Glas**, **Neon** und **16-Bit**.
- Rollphysik und Maussteuerung nach Enigma: Maus wirkt als Kraft, Reibung je Boden,
  einstellbare Mausgeschwindigkeit (`+`/`−`, wie in Enigma 1–15, Standard 4).
- Paarregel wie in Enigma: ein offener Stein bleibt offen, ein falscher zweiter schließt ihn.
- Original-Soundeffekte aus Enigma (Steinstoß, Oxyd öffnen, Paar, Absturz).
- Steuerung außerdem per Pfeiltasten/WASD, Neigen, Gamepad.
- Klein und schnell: rund 150 KB Code (gzip) plus 165 KB Grafik.

## Entwickeln

```bash
npm install
npm run dev      # Entwicklungsserver
npm test         # Tests (Vitest)
npm run build    # statische Dateien in dist/
```

Levels liegen als JSON in `src/levels/`. Format: Zeichenkarte mit `#` Wand,
`.` Boden, `o` Abgrund, `@` Start, `A`–`Z` Signalsteine (jedes Symbol genau zweimal).

Spezifikation und Plan: [docs/SPEC.md](docs/SPEC.md)

## Lizenz

GPL-3.0-or-later, siehe [LICENSE](LICENSE).

Die Grafiken in `public/enigma/` stammen aus [Enigma](https://github.com/Enigma-Game/Enigma)
(GPL-2.0-or-later), siehe [public/enigma/README.md](public/enigma/README.md); die Klänge in
`public/sounds/` ebenfalls aus Enigma, siehe [public/sounds/README.md](public/sounds/README.md). Physik und
Paarregel sind nach Enigmas Quellcode (`src/world.cc`, `src/stones/OxydStone.cc`) nachgebaut.

Lua-Rückrufe der Enigma-Levels laufen in [fengari](https://github.com/fengari-lua/fengari)
(Lua 5.3 in JavaScript, MIT; im Browser `fengari-web`). `src/lua/enigma.lua` bildet einen Teil von
Enigmas Lua-API 2 nach (Konstanten und Verhalten aus Enigmas `data/api2init.lua` und `src/lua.cc`).
