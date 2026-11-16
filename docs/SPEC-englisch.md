# Spec: `englisch` – englische Fassung von Murmel

Auftrag vom 15.11.2026 (Konzept „Murmel bekannt machen“, `murmel-wiki/konzept-veroeffentlichung.md`,
Abschnitt 4, Punkt 9). Stand 15.11.2026.

**Stand 15.11.2026:** gebaut in drei PRs (Branches `englisch`, `englisch-b`, `englisch-c`). Geprüft:
`tsc`, vitest (Wörterbücher vollständig, ohne verwaiste Schlüssel, HTML-Seiten markiert), Werkzeug- und
Servertests, `npm run build` mit und ohne Levelseiten, `check:levelseiten` (2438 Seiten de/en).
Im Browser bei 375 px: Spiel (Startkarte, Levelpakete, Fortschritt, Umschalten in beide Richtungen),
`/en/` aus `dist` mit `#start=`, englische Levelseite; Editor, Forum, Spieler-Levels, Rangliste,
Statistik, Lösbarkeit von den Bereichsbearbeitern. Nicht geprüft: Konto-Dialoge und Zu zweit mit
echtem Server, Anmelde-Mail und Web Push auf echten Geräten.
Zusätzlich: eigene Levels haben `titleEn`; Node (Tests, Server, Werkzeuge) läuft immer deutsch.

## Ziel

Murmel ist vollständig auf Englisch spielbar und umschaltbar. Englischsprachige Besucher (Reddit,
Hacker News, itch.io, Enigma-Gemeinschaft) sehen das Spiel ohne Zutun auf Englisch. Suchmaschinen
finden eigene englische Seiten (Startseite, „About“, Level- und Paketseiten).

Nicht-Ziele: weitere Sprachen (das Gerüst erlaubt sie, gebaut wird nur `de`/`en`); verbindliche
englische Rechtstexte; Übersetzung von Spielerinhalten (Forum, Spieler-Levels, Namen).

## Sprachwahl

- **Reihenfolge:**
  1. gespeicherte Wahl `localStorage["murmel.sprache"]` (`"de"` oder `"en"`);
  2. sonst die Adresse: Seiten unter `/en/` sind englisch;
  3. sonst `navigator.languages[0]` bzw. `navigator.language`: `de*` → Deutsch, alles andere → Englisch.
- **Speichern** nur nach ausdrücklicher Wahl am Schalter. Gespeichert wird nur `de`/`en`; das ist für
  die gewünschte Funktion unbedingt erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG). Kein Cookie, kein Server.
- **Schalter:**
  - im Spiel: auf der Startkarte (Zeile „Sprache · Language“) und unter „Fortschritt“;
  - auf allen anderen Seiten mit Skript (Editor, Forum, Spieler-Levels, Bestenliste, Statistik,
    Lösbarkeit): ein kleiner Knopf „English“ bzw. „Deutsch“ in Kopf- oder Fußzeile;
  - auf statischen Seiten (`ueber.html`, Levelseiten): ein Link auf die andere Sprachfassung.
  Die Beschriftung nennt immer die *andere* Sprache in ihrer eigenen Sprache („English“/„Deutsch“),
  damit ihn auch findet, wer die aktuelle Sprache nicht liest. Umschalten lädt die Seite neu (einfach
  und robust: Texte, die beim Laden gebaut werden, stimmen dann sicher).
- `document.documentElement.lang` folgt der Sprache.
- **Service Worker:** Er braucht die Sprache für Web-Push-Texte, hat aber keinen Zugriff auf
  `localStorage`. Die Seite legt die Sprache deshalb zusätzlich als Eintrag `sprache` im Cache
  `murmel-einstellungen` ab (nur `de`/`en`). Ohne Eintrag gilt `self.navigator.language`.

## Texte zentralisieren

### Entscheidung: eigenes kleines Wörterbuch, deutscher Text als Schlüssel

Geprüft wurden i18next (~40 kB, Plugins, Namespaces, Ladefunktionen – fast alles ungenutzt),
typesafe-i18n (Generator-Schritt, wenig gepflegt) und Lingui/FormatJS (Compiler, ICU-Syntax). Keine
davon ist klar besser: Murmel braucht zwei Sprachen, Platzhalter und gelegentlich Einzahl/Mehrzahl.
Ein eigenes Modul mit ~60 Zeilen deckt das ab, ohne neue Abhängigkeit und ohne Build-Schritt.

Wie bei gettext ist **der deutsche Text selbst der Schlüssel**; das englische Wörterbuch ordnet ihm die
Übersetzung zu. Vorteile: Der Code bleibt lesbar, Deutsch kann nie fehlen, Diffs bleiben klein.
Fehlende englische Einträge fängt der **Typprüfer** ab: `t()` nimmt nur Schlüssel des jeweiligen
Wörterbuchs an.

```ts
// src/i18n/en/spiel.ts
export default {
  Neustart: 'Restart',
  '{n} von {m} Paaren offen': '{n} of {m} pairs open',
} as const;

// src/main.ts
import { woerterbuch } from './i18n';
import EN from './i18n/en/spiel';
const t = woerterbuch(EN);
btn.textContent = t('Neustart');
t('{n} von {m} Paaren offen', { n: 2, m: 5 });
```

- `woerterbuch(en)` liefert `t(de, werte?)`: in Deutsch der Schlüssel, in Englisch `en[de]`, Platzhalter
  `{name}` werden ersetzt.
- Einzahl/Mehrzahl: zwei Schlüssel, die Wahl trifft der Code (`n === 1 ? t('1 Level') : t('{n} Levels', { n })`).
- Je Bereich ein Wörterbuch unter `src/i18n/en/` (spiel, editor, konto, forum, …). Seiten laden nur
  ihre Bereiche.
- Zahlen und Daten: `gebietsschema()` liefert `de-DE` bzw. `en-GB` (EU-Seite, 24-h-Uhr, Tag vor Monat).
- **Statisches HTML:** Elemente mit `data-i18n` (Text) oder `data-i18n-html` (Text mit Links/Markup)
  werden übersetzt; Schlüssel ist der auf Leerzeichen normierte Textinhalt. `data-i18n-attr="title,
  aria-label,placeholder"` übersetzt Attribute. Ohne JavaScript bleibt die Seite deutsch.
- Der Bundle-Zuwachs für deutsche Besucher (englische Texte werden mitgeladen) liegt bei wenigen kB
  gzip je Seite; ein nachgeladenes Wörterbuch würde dafür jeden Text beim Laden asynchron machen.

### Umfang

Spiel (HUD, Menüs, Levelauswahl, Fortschritt, Tipps, Cloudstand, Sync, Bestenliste, Geister,
Tageslevel, Web Push, Steuerung, Zu zweit, Wettkampf, Gegenstandsnamen, Meldungen der Spielwelt),
Editor (inkl. Enigma-Upload, Veröffentlichen), Konto, Forum, Spieler-Levels, Bestenliste, Statistik,
Lösbarkeit (Admin), Fehlermeldungen von Client und Server, Anmelde-Mail, Web-Push-Texte, `ueber.html`.

Bleibt deutsch: Impressum, Datenschutz (siehe unten), Admin-Mails an die Betreiber, Server-Logs,
Leveltitel und Autorennamen (aus Enigma, meist englisch), Spielerinhalte.

## Server

- Sprache je Anfrage aus `Accept-Language`. Das Spiel setzt diesen Kopf bei eigenen API-Aufrufen
  ausdrücklich auf die gewählte Sprache (`de` oder `en`) – das ist ein CORS-sicherer Kopf, braucht keine
  Preflight-Anfrage und keine neue Speicherung. Erkennung: erste Sprache `de*` → Deutsch, sonst Englisch;
  ohne Kopf → Deutsch (bisheriges Verhalten).
- **Fehlermeldungen:** Die Routen liefern weiter `{ error: "<deutscher Text>" }`. Ein `onSend`-Hook
  übersetzt `error` für englische Anfragen über ein Wörterbuch (deutscher Text → englischer Text,
  Muster für Texte mit Werten). Ein Test liest alle `error:`-Texte aus den Quellen und prüft, dass jeder
  übersetzt ist.
- **Anmelde-Mail:** Betreff und Text in der Sprache der Anfrage, die den Link anfordert.
- **Web Push:** Die Nachricht enthält beide Sprachen (`{ titel, text, url, en: { titel, text } }`); der
  Service Worker wählt (siehe Sprachwahl). Kein Sprachfeld am Abonnement.
- Keine neue Speicherung personenbezogener Daten.

## Levelseiten und SEO

- **Englische Startseite** `/en/` (aus `dist/index.html` erzeugt): englischer Titel, Beschreibung,
  `og:locale=en_US`, JSON-LD mit `inLanguage: "en"`, `noscript`-Text, `<base href="../">`, damit alle
  relativen Wege der Hauptseite gelten. Ebenso `/en/ueber.html` aus `ueber.html`.
- **Level- und Paketseiten** unter `/en/level/…` mit denselben Slugs; Vorschaubilder werden nicht
  verdoppelt, die englischen Seiten verweisen auf die Bilder unter `/level/…`.
- `hreflang` in beide Richtungen auf allen zweisprachigen Seiten (`de`, `en`, `x-default` → deutsch).
- `og:locale` je Sprache (`de_DE` / `en_US`) und `og:locale:alternate`.
- **Sitemap:** die bestehende `sitemap.xml` wird um die englischen Adressen erweitert, jede `<url>` mit
  `xhtml:link rel="alternate"` beider Sprachen.
- **Dokumenttexte aus Enigma** (`el:i18n`): Der Import speichert bisher nur die deutsche Übersetzung
  (sonst Englisch). Neu: `textsEn` mit dem englischen Original, wo es abweicht. Das Spiel und die
  Levelseiten nehmen in Englisch `textsEn[key] ?? texts[key]`.
- **Markenrecht:** in Texten nur „in the style of Oxyd and Enigma“ bzw. „like Oxyd and Enigma“, nie
  „Oxyd online“ o. ä.; keine Werbung mit dem Namen als Schlagwort.
- Notbetrieb (`MURMEL_LEVELSEITEN=0`): `/en/` und `/en/ueber.html` entstehen trotzdem; `/en/level/`
  wie `/level/` nicht.

## Rechtstexte

Impressum und Datenschutz bleiben verbindlich deutsch und werden nicht geändert. Englische
Lesefassungen mit dem Hinweis „Only the German version is legally binding“ entstehen nur als Entwurf in
der Übergabe und brauchen die Freigabe des Nutzers. Ebenso ein Entwurf für den Absatz „Speicherung im
Browser“ (Sprachwahl).

## Gestaltung (Apple-Design-Leitlinien)

- Sprachschalter gut auffindbar (Startkarte und Fortschritt, Fußzeilen), Zielgröße ≥ 44 px.
- Längere englische bzw. kürzere deutsche Texte: keine festen Breiten an Knöpfen; Umbrüche erlaubt.
- Alles auf 375 px benutzbar; im Browser in beiden Sprachen geprüft.

## Befehle

```
npx tsc --noEmit
npx vitest run
npm run test:tools
(cd server && npm run typecheck && npm test)
npm run build
MURMEL_LEVELSEITEN=0 npm run build
npm run check:levelseiten
```

## Tests

- `src/i18n.test.ts`: Sprachwahl (gespeichert, Adresse, Browser), Platzhalter, Gebietsschema.
- `src/i18n/woerterbuecher.test.ts`: in jedem Wörterbuch hat jeder Schlüssel eine nicht leere
  englische Übersetzung mit denselben Platzhaltern; jeder Schlüssel wird im Code verwendet; jedes
  `data-i18n`-Element in den HTML-Seiten hat einen Eintrag.
- Server: Fehlertexte vollständig übersetzt, Sprache aus `Accept-Language`, Mail- und Push-Text in
  beiden Sprachen.
- Levelseiten: englische Seiten mit `lang="en"`, `hreflang`, `og:locale`, Sitemap mit Alternativen;
  `check:levelseiten` prüft auch `/en/level/`.

## Aufteilung

Drei aufeinander aufbauende PRs, jeder für sich lauffähig:

- **(a) `englisch`:** Grundgerüst (i18n, Schalter, Tests), Spiel (`index.html`, `main.ts` und die
  Spielmodule), Service-Worker-Sprache.
- **(b) `englisch-b`:** Editor, Konto, Forum, Spieler-Levels, Bestenliste, Statistik, Lösbarkeit,
  Zu zweit/Wettkampf, Server (Fehler, Mail, Push).
- **(c) `englisch-c`:** `/en/`, `/en/ueber.html`, Levelseiten, Sitemap, `textsEn`.

## Grenzen

- Immer: Tests vor Commit; Texte nur über Wörterbücher; natürliches Englisch statt Wort-für-Wort.
- Vorher fragen: Datenschutz-/Rechtstexte, neue Abhängigkeiten, neue Speicherung.
- Nie: „Oxyd online“ in Texten; Rechtsseiten ändern; mergen.

## Offene Fragen

- Englische Lesefassungen von Impressum/Datenschutz veröffentlichen? (Entwürfe in der Übergabe)
- Soll `/en/` später eine eigene Domain-Weiterleitung (z. B. `murmel.games/en`) in Werbetexten sein?
