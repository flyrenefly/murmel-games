# Murmel

Ein freies Murmel-Rätselspiel für den Browser: Rolle die Murmel über das
Spielfeld und decke die Signalsteine paarweise auf. Inspiriert vom Spielgefühl
der Murmel-Klassiker auf dem Atari ST.

Spielen: **https://murmel.games** (in Vorbereitung)

## Merkmale

- Läuft in jedem aktuellen Browser, auch auf dem Handy (Steuerung durch Neigen).
- Zwei umschaltbare Grafikstile: **Glas und Stein** und **Retro-modern** (Taste `T`).
- Steuerung: Maus (wie früher), Pfeiltasten/WASD, Neigen, Gamepad.
- Klein und schnell: rund 150 KB (gzip), eigene schlanke Physik, adaptive Auflösung.

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
