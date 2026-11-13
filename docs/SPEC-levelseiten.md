# Spec: `levelseiten` – eine Seite je Level für Suchmaschinen

Baustein „Levelseiten“. Stand 13.11.2026, Branch `levelseiten`.

## Ziel

Jedes Level des Spiels bekommt eine eigene, leichte, von Suchmaschinen lesbare Seite mit Vorschaubild,
Titel, Paket, Autor, Lizenz, Bestzeiten und einem Knopf, der genau dieses Level im Spiel startet. Dazu
eine Übersicht je Paket und eine Startseite „Alle Levels“. Alles entsteht beim Build statisch; die
Seiten brauchen kein Spiel-JavaScript.

## Umfang

- **Drin:** Murmels eigene Levels (`src/levels/*.json`) und alle übernommenen Enigma-Pakete
  (`public/levels/enigma/<pack>.json`, Reihenfolge aus `index.json`), zusammen 1144 Levels in 20 Paketen.
- **Später:** Spieler-Levels. Sie liegen nur in der Datenbank und kommen und gehen ohne Build; statische
  Seiten wären veraltet, und für Seiten zur Laufzeit bräuchte die API ein Vorschaubild ohne Browser.
  Eigener Baustein, wenn gewünscht.
- **Nicht:** neue Daten, Tracking, Änderungen an der API oder der Datenbank.

## Adressen

```
/level/                                   Alle Levels (Pakete)
/level/<paket>/                           Übersicht eines Pakets
/level/<paket>/<level>/                   Levelseite (index.html)
/level/<paket>/<level>/vorschau.webp      Vorschaubild, auch og:image
/level/<paket>/<level>/klein.webp         kleines Bild (320 px) für die Übersichten
/level/bestzeiten.js                      Nachladen der Bestzeiten (ein Skript für alle Seiten)
```

- `<paket>`: Paket-ID mit `-` statt `_` (`enigma_ii` → `enigma-ii`, `murmel` → `murmel`).
- `<level>`: Titel als Slug (klein, `ä`→`ae`, `ß`→`ss`, Akzente weg, alles andere zu `-`).
  Haben in einem Paket mehrere Levels denselben Slug (z. B. neun Mal „- meditation -“), bekommen
  **alle** davon den Slug ihrer Level-ID angehängt (`meditation-med1`); leer → nur der ID-Slug.
- **Warum ohne Levelnummer** (Vorschlag war `<nr>-<slug>`): Die Nummer ist die Position im Paket. Murmel
  übernimmt Enigma-Pakete schrittweise (z. B. 96 von 100); kommt ein Level dazu, rutschen alle
  folgenden Nummern weiter, und jede Adresse danach würde ungültig. Titel und Level-ID kommen aus
  den Enigma-Dateien und ändern sich nicht. Die Nummer steht auf der Seite und im Titel.
- **Schrägstrich am Ende:** Jede Seite ist ein Ordner mit `index.html`; das funktioniert auf jedem
  statischen Server ohne Umschreibregeln (Caddy leitet `…/welcome` selbst auf `…/welcome/` um).
- **Gleiches Level in mehreren Paketen** (22 IDs): Jede Fundstelle bekommt ihre Seite, der Canonical
  zeigt auf die erste Fundstelle in Spielreihenfolge (kein doppelter Inhalt für Suchmaschinen).

## Inhalt einer Levelseite

- `<h1>` Titel; darunter „Level n von m · Paket · von Autor“.
- Vorschaubild (siehe unten) mit `width`/`height`, Alt-Text „Spielfeld von „Titel“ im Stil Klassisch“.
- Beschreibung: der erste Text des Levels (`texts`, Dokumente im Level) mit mindestens 40 Zeichen
  (kürzere wie „Welcome to Enigma II“ taugen nicht), gekürzt auf 155 Zeichen an einer Wortgrenze; ohne Text eine erzeugte Zeile („„Titel“ ist Level n von m im Paket … von …“).
- Großer Knopf **Jetzt spielen** → `../../../#start=<paket-id>/<level-id>` (siehe Spielstart).
- Bestenliste: Abschnitt „Bestzeiten“ mit Link „Ganze Rangliste“ (`bestenliste.html?level=…&titel=…`).
  Ohne JS steht dort nur der Link; mit JS lädt `bestzeiten.js` die Bestzeit und die Top 3.
- Lizenz und Autor als Text; Quelle (Enigma-Datei) bei übernommenen Levels.
- Navigation: voriges Level, nächstes Level, Paketübersicht, Alle Levels.
- Kopf wie `ueber.html` (Marke, „Jetzt spielen“), Fuß mit Impressum, Datenschutz, Über Murmel.

## SEO

- `<html lang="de">`, `<title>` „Titel – Level n, Paket | Murmel“, `<meta name="description">`,
  `<link rel="canonical">` (absolute Adresse `https://murmel.games/…`), `robots index, follow,
  max-image-preview:large`.
- Open Graph (`og:type` website, `og:title`, `og:description`, `og:url`, `og:image` mit Breite/Höhe,
  `og:image:alt`, `og:locale` de_DE, `og:site_name`) und `twitter:card` summary_large_image.
- JSON-LD (Datenblock, kein ausführbares Skript, also mit der CSP verträglich):
  `CreativeWork` für das Level mit `name`, `author` (`Person`), `license` (URL bei GPL-Varianten,
  sonst Text), `image`, `url`, `position`, `isPartOf` → `VideoGame` „Murmel“ (`url`, `gamePlatform`
  Web browser, `isAccessibleForFree`), dazu `BreadcrumbList` (Alle Levels › Paket › Level).
  Paketseite: `CollectionPage` mit `ItemList`; Startseite: `CollectionPage`.
- Genau ein `<h1>` und genau ein Canonical je Seite (Test).
- **Sitemap:** Der Build schreibt `dist/sitemap.xml` aus `public/sitemap.xml` (feste Seiten) plus
  Startseite, Paket- und Levelseiten (nur kanonische Adressen). `robots.txt` erlaubt alles und nennt die
  Sitemap – passt so.

## Vorschaubilder

- **Wie:** In Node ohne Browser. Das Level startet mit der Spiellogik aus `src/` wie bei der Ladeprobe
  (`GameSession.create`, Seed 1, Lua über fengari), der echte Renderer „Klassisch“
  (`src/render/classic.ts`) zeichnet es mit den Enigma-Grafiken aus `public/enigma/gfx32/`. Neu ist dort
  nur `renderWhole()`: das ganze Level statt eines Bildschirms, ohne Statusleiste. Die Canvas kommt
  von **`@napi-rs/canvas`** (devDependency, fertige Binärpakete für Windows/Linux, keine
  Install-Skripte, kein Browser). Ein paar Browser-Teile bildet `tools/levelseiten/vorschau.mjs` nach
  (`Image` liest aus `public/`, `document.createElement('canvas')`, `window` für `resize()`), und ein
  Ladehaken ersetzt `import.meta.env.BASE_URL`.
- **Warum nicht headless Edge/Chromium:** Der Browser müsste in der CI installiert werden, das Spiel
  für jedes Level hochfahren und Screenshots machen – langsamer und fehleranfälliger. Der Weg über den
  echten Renderer zeigt dasselbe Bild.
- **Format:** WebP, ganzes Level. `vorschau.webp` (Qualität 70) höchstens 800 px breit (größere Levels
  werden verkleinert, normale 20×13-Levels bleiben 640×416 in Originalpixeln), dazu `klein.webp`
  (320 px, Qualität 60) für die Raster der Übersichten. WebP verstehen alle heutigen Browser und die
  großen Vorschau-Dienste; PNG wäre ein Mehrfaches größer. Gemessen: im Mittel 58 KB + 13 KB je Level,
  zusammen rund 80 MB (Qualität 82 wären 73 KB je Bild gewesen).
- **Buildzeit:** Mehrere Kindprozesse (Kerne, höchstens 8), je Level etwa 50 ms, Lua-Levels mehr.
  Ein Level, das nicht startet, bricht den Build ab (die CI prüft vorher mit `check:levels`, dass alle
  starten).
- **Wo es läuft:** als Vite-Plugin `levelPages()` in `vite.config.ts` (closeBundle), also in jedem
  `vite build`. Das ist nötig, weil der Server (`deploy/server/update.sh`) nur `npx vite build`
  aufruft, nicht `npm run build`. `MURMEL_LEVELSEITEN=0` überspringt es lokal.

## Bestzeiten

- Clientseitig: `bestzeiten.js` (aus `src/levelseiten/bestzeiten.ts`, Typen beim Build entfernt) holt
  `GET /api/bestenliste/level?id=<level-id>` – dieselbe öffentliche Antwort wie die Ranglistenseite –
  und zeigt die Bestzeit und die Top 3 mit Anzeigenamen („ohne Namen“, wenn keiner gesetzt ist).
- `credentials: 'omit'`: Die Seite schickt kein Sitzungscookie mit, es entsteht kein Bezug zu einem
  Konto. Die API protokolliert die Abfrage ohne Query (bestehendes Verhalten). **Keine neuen Daten**,
  deshalb keine Änderung der Datenschutzerklärung.
- Ohne JS oder ohne API: Die Seite ist vollständig, nur ohne Zeiten; der Link zur Rangliste bleibt.
- Warum nicht beim Build: Zeiten ändern sich ständig, und die CI hat (zu Recht) keinen Zugriff auf
  die Datenbank.

## Spielstart per Adresse

- Neu: `#start=<paket-id>/<level-id>` (Level-ID URL-kodiert), z. B. `#start=enigma_ii/enigma%3Anat1`.
- `src/startlink.ts` liest den Hash (vitest); `main.ts` lädt das Paket, sucht das Level **per ID** (nicht
  per Nummer, damit Links nach einer Erweiterung des Pakets stimmen), startet es und entfernt den Hash.
  Unbekanntes Paket/Level → Hinweis, sonst wie bisher das zuletzt gespielte Level. Auch bei `hashchange`.

## Offline und Server

- `level/` kommt **nicht** in den Offline-Speicher: Das Plugin läuft nach dem Offline-Plugin (also
  nach dem Schreiben von `sw.js`), und die Ausschlussliste in `vite.config.ts` nennt `level/` zusätzlich.
- Caddy: `@html` bekommt `*/`, damit die Ordnerseiten wie die anderen HTML-Seiten `no-cache` haben.

## Gestaltung

Wie `ueber.html` (dieselben Farbwerte, Systemschrift 17 px, max. 760 px Breite), hell und dunkel per
`prefers-color-scheme`, ab 375 px ohne waagrechtes Scrollen. Knöpfe mindestens 44 px hoch. Im Dunkeln
hat „Jetzt spielen“ dunkle Schrift auf dem hellen Blau (#0b0b12 auf #7fb2ff ≈ 8,9:1; weiß wäre 2,1:1).
Vorschaubild pixelgenau (`image-rendering: pixelated`). Alles CSS steht in der Seite (keine zusätzliche
Anfrage), Bild als einzige größere Datei.

## Bausteine und Prüfung

| Teil | Datei | Prüfung |
|---|---|---|
| Slugs, Adressen, Metadaten, HTML, Sitemap | `src/levelseiten/seiten.ts` | vitest `seiten.test.ts` (Slugs, Eindeutigkeit, Canonical, Sitemap, Metadaten) |
| Bestzeiten im Browser | `src/levelseiten/bestzeiten.ts` | vitest (Format, Top 3) |
| Spielstart | `src/startlink.ts`, `src/main.ts` | vitest; Browser: Knopf startet das richtige Level |
| Vorschaubilder | `src/render/classic.ts` (`renderWhole`), `tools/levelseiten/vorschau*.mjs` | Build, Stichproben angesehen |
| Generator | `tools/levelseiten/bauen.mjs`, Vite-Plugin in `vite.config.ts` | Build ohne Fehler; HTML-Check `npm run check:levelseiten` (`tools/levelseiten/pruefen.mjs`, auch in der CI): je Seite `lang="de"`, ein `<title>`, Description, genau ein `<h1>`, genau ein Canonical, `og:image` als Datei, gültiges JSON-LD, alle relativen Links und Bilder vorhanden, Sitemap vollständig, nichts davon in `sw.js` |
| Browser | `vite preview --port 5186` | hell, dunkel, 375 px, „Jetzt spielen“ |

## Stand

**13.11.2026:** gebaut (Branch `levelseiten`).

- Build (Windows, 8 Prozesse): **1144 Levelseiten, 20 Paketseiten, 1 Übersicht**; Sitemap +1143
  Adressen (1144 minus 22 Dubletten plus 21 Übersichten); Levelseiten-Schritt rund 30 s (davon
  Bilder rund 23 s), ganzer `npm run build` rund 37 s. HTML je Levelseite rund 9 KB.
- Geprüft: vitest (Slugs, Eindeutigkeit, Stabilität bei neuen Levels, Canonical der Dubletten,
  Metadaten, JSON-LD, Sitemap, robots.txt, Bestzeiten-Format, Startlink für jedes echte Level),
  `check:levelseiten` über alle 1165 Seiten, Browser mit `vite preview --port 5186` und einer
  Test-API mit erfundenen Namen: Levelseite hell und dunkel, 375 px ohne waagrechtes Scrollen,
  Top 3 inkl. „ohne Namen“, „Jetzt spielen“ startet das richtige Level (Basic Tutorial 12 „Floors 2“),
  Startlink per `hashchange` im offenen Spiel, unbekanntes Level → Hinweis, Paket- und Übersichtsseite.
- Nicht geprüft: Build im Server-Container (node:24-alpine, musl-Binärpaket von @napi-rs/canvas ist im
  Lockfile), Darstellung in echten Vorschau-Diensten (Facebook, X, LinkedIn), echte Bestenliste live.
- Hinweis Betrieb: Der SFTP-Spiegel zum IONOS-Webspace (`deploy.yml`, `tools/deploy-sftp.mjs`) lädt
  jedes Mal alle Dateien hoch; mit den Levelseiten sind das rund 2300 Dateien und 90 MB mehr.
