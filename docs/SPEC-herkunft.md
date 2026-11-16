# Spec: `herkunft` – von welchen Seiten Besucher kommen

Ziel: je Tag sehen, von welchen fremden Seiten Besucher zu Murmel kamen (z. B. „news.ycombinator.com:
37“), ohne Tracking. Gleiches Muster wie die Auswertung (`docs/SPEC-auswertung.md`). Stand 16.11.2026.

## Grenzen

- **Nur die Domain** aus `document.referrer` (Rechnername, ohne Pfad, Query, Port, Zugangsdaten). Der
  Server prüft und normalisiert sie und speichert nur Tag, Domain und Anzahl.
- **Keine Kennung, keine IP-Adresse, kein User-Agent, keine Rohzeilen.** Die IP-Adresse liegt nur für die
  Ratenbegrenzung im Arbeitsspeicher (`limit.ts`) und wird nicht protokolliert.
- **Einmal je Browser-Tab-Sitzung:** Ein Merker in `sessionStorage` (`murmel.herkunft`, Wert `1`,
  verschwindet mit dem Tab) verhindert, dass weitere Seiten oder ein Neuladen erneut zählen. Kein
  `localStorage`, kein Profil. Ohne `sessionStorage` wird nichts gesendet.
- **Abschaltbar wie die Spielstatistik:** Schalter „Anonyme Statistik senden“, „Do Not Track“,
  „Global Privacy Control“; in der Entwicklung (`localhost`) nie.
- **Aufbewahrung:** 13 Monate (Vergleich mit dem Vorjahresmonat möglich). Ältere Zeilen löscht der
  Server beim ersten Eintrag eines neuen Tages – derselbe Mechanismus wie bei der Auswertung.

## Kampagnen-Zusatz `?von=`

Eigene Links (Anzeigen, Beiträge) tragen einen Zusatz, z. B. `https://murmel.games/?von=google`,
`/en/?von=reddit`. So lassen sich Anzeigen- und normale Suchbesucher trennen (beide kämen sonst als
google.com an).

- **Client:** liest beim Laden `von` aus der Adresse (Kleinbuchstaben, nur `^[a-z0-9-]{1,32}# Spec: `herkunft` – von welchen Seiten Besucher kommen

Ziel: je Tag sehen, von welchen fremden Seiten Besucher zu Murmel kamen (z. B. „news.ycombinator.com:
37“), ohne Tracking. Gleiches Muster wie die Auswertung (`docs/SPEC-auswertung.md`). Stand 16.11.2026.

## Grenzen

- **Nur die Domain** aus `document.referrer` (Rechnername, ohne Pfad, Query, Port, Zugangsdaten). Der
  Server prüft und normalisiert sie und speichert nur Tag, Domain und Anzahl.
- **Keine Kennung, keine IP-Adresse, kein User-Agent, keine Rohzeilen.** Die IP-Adresse liegt nur für die
  Ratenbegrenzung im Arbeitsspeicher (`limit.ts`) und wird nicht protokolliert.
- **Einmal je Browser-Tab-Sitzung:** Ein Merker in `sessionStorage` (`murmel.herkunft`, Wert `1`,
  verschwindet mit dem Tab) verhindert, dass weitere Seiten oder ein Neuladen erneut zählen. Kein
  `localStorage`, kein Profil. Ohne `sessionStorage` wird nichts gesendet.
- **Abschaltbar wie die Spielstatistik:** Schalter „Anonyme Statistik senden“, „Do Not Track“,
  „Global Privacy Control“; in der Entwicklung (`localhost`) nie.
- **Aufbewahrung:** 13 Monate (Vergleich mit dem Vorjahresmonat möglich). Ältere Zeilen löscht der
  Server beim ersten Eintrag eines neuen Tages – derselbe Mechanismus wie bei der Auswertung.

, sonst
  ignoriert) und entfernt den Parameter **immer** per `history.replaceState` (andere Parameter und der
  Hash bleiben), damit er nicht geteilt oder als Lesezeichen gespeichert wird. Gezählt wird nur beim
  ersten Aufruf der Tab-Sitzung, im selben Beacon wie die Domain: `{domain?, von?}`. Ohne fremden
  Referrer, aber mit `von`, wird trotzdem gezählt.
- **Server:** gleiche Prüfung; Freigabeliste `google, reddit, mastodon, bluesky, hn, newsletter, presse`,
  jeder andere gültige Wert zählt als `sonstige` (kein Freitext in der Tabelle). Ungültiges `von` oder
  ungültige Domain → 400 für die ganze Meldung; mindestens eins von beiden muss da sein.
- **Tabelle:** Spalte `von` im Primärschlüssel `(day, domain, von)`; `''` heißt „nicht vorhanden“.
- **Bericht:** je Tag und im Zeitraum zusätzlich `kampagnen` (alle Werte, kein Schwellwert nötig, da nur
  Freigabeliste) und `ohneDomain` (Besuche nur mit Kampagne). Die Kreuzung Domain × Kampagne wird nicht
  angezeigt.

## Entscheidung: kein Zähler „direkt“

Leerer Referrer oder eigene Domain → **nichts senden.** Gründe: (1) Ein leerer Referrer heißt nicht
„direkt aufgerufen“ – Apps, Mailprogramme, Lesezeichen, `Referrer-Policy: no-referrer` fremder Seiten
und manche Browser liefern alle nichts; die Zahl wäre irreführend. (2) Besucher je Tag zählt schon die
Spielstatistik (`stat_day`); ein zweiter Besuchszähler wäre zusätzliche Datenerhebung ohne neuen Nutzen.
(3) Weniger Anfragen, weniger Daten.

## Client (`src/herkunft.ts`)

`herkunftMelden(browserHerkunft())` läuft beim Laden von Spiel (`main.ts`), Forum, Bestenliste und
Spieler-Levels. Ablauf: `von` aus der Adresse lesen und entfernen; schon gemerkt → Ende; merken (scheitert → Ende); Statistik aus → Ende; Domain
fremd und `http(s)` oder Kampagne vorhanden → `sendBeacon('/api/herkunft', {"domain": "…", "von": "…"})`. Nicht fremd: eigener Rechnername,
`murmel.games` und Unterdomains, `localhost`.

Nicht eingebaut: die statischen Levelseiten (`/level/…`, `tools/levelseiten`). Ihr Skript
`bestzeiten.js` darf keine Importe haben; ein Einbau dort ist ein eigener Schritt.

## Server (`server/src/herkunft*.ts`, Migration `018_herkunft.sql`)

- `POST /api/herkunft` `{ domain }`: fremde Felder werden verworfen. `normalizeDomain`: trimmen,
  Kleinbuchstaben, Schlusspunkt und führendes `www.` weg; erlaubt sind nur ASCII-Rechnernamen mit
  mindestens zwei Teilen (je 1–63 Zeichen `a-z0-9-`, nicht mit `-` am Rand), letzter Teil beginnt mit
  einem Buchstaben (keine IPv4-Adressen), höchstens 253 Zeichen; `murmel.games` und Unterdomains werden
  abgelehnt. Ungültig → 400, sonst 204 (auch bei Datenbankfehler).
- Ratenbegrenzung: 60 Meldungen je IP-Adresse in 15 Minuten (429), nur im Arbeitsspeicher.
- Höchstens 500 verschiedene Domains je Tag (Schutz vor Referrer-Spam); bekannte Domains zählen weiter.
- Tabelle `herkunft_tag(day, domain, von, anzahl)`, Primärschlüssel `(day, domain, von)`.
- `GET /api/statistik/herkunft?tage=` (Admin oder `STATS_TOKEN`, wie die übrige Statistik): Bericht je
  Tag (neueste zuerst) und für den Zeitraum. Domains mit weniger als 3 Besuchern verlassen den Server nur
  als Summe („andere“: Anzahl Domains und Besucher).

## Anzeige (`statistik.html`)

Abschnitt „Herkunft“ nach „Wo Spieler hängen“: Tabelle „Im Zeitraum“ (Domain, Besucher, dazu „andere“ und „ohne
fremde Seite (nur Kampagne)“), „Kampagne (von)“ und „Je Tag“ (Tag, Besucher, Herkunft, Kampagne). Zeitraum aus der Auswahl der Seite (Standard 30 Tage).
