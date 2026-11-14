# Spec: `auswertung` – wo Spieler scheitern oder abbrechen

Baustein aus `docs/SERVER.md` (Abschnitte 3 und 10): datensparsam und ohne Fremdanbieter erkennen, in
welchen Levels Spieler scheitern, oft neu starten oder aufgeben, damit Reihenfolge und Schwierigkeit der
Levelpakete besser werden. Grundlage: die anonyme Spielstatistik (`/api/event`, Migration
`002_statistik.sql`, `statistik.html`). Stand 14.11.2026.

**Stand 14.11.2026:** A1–A4 gebaut (Branch `auswertung`). Geprüft: vitest (Zählen, Zeitklassen, Puffer,
Bündeln, Abschalten, Rechnung der Statistikseite), `node --test` (API mit Speicher-Stand-in;
PostgreSQL-Teil nur in der CI), Browser (Vite): Schalter unter „Fortschritt“ schreibt und löscht
`murmel.statistikAus`; Abschnitt „Wo Spieler hängen“ mit nachgestellten Serverantworten.
Nicht geprüft: echtes Senden aus dem Browser gegen den Live-Server, `pagehide` auf Mobilgeräten.

## Ziel

Für jedes Level je Tag wissen: wie oft ein Lauf begonnen, gelöst, neu gestartet oder abgebrochen wurde,
wie viele Abstürze dabei vorkamen und wie lange gelöste und abgebrochene Läufe ungefähr dauerten. Daraus
zeigt die Statistikseite den Admins die **schwersten Levels** und die **Abbruchquote je Paket**.

## Grenzen

- **Kein Tracking:** keine Kennung je Spieler, Gerät oder Lauf, kein Cookie, keine IP-Adresse, kein
  Prüfwert (anders als die Spielerzählung der Spielstatistik), keine Uhrzeit vom Gerät.
- **Nur Zähler:** Der Server addiert eingehende Zahlen in Tageszeilen je Level und vergisst die
  Anfrage. Es gibt keine Tabelle mit einzelnen Läufen oder Sendungen.
- **Ohne Konto**, gleich ob angemeldet oder nicht; das Konto wird nicht mitgeschickt und nicht gelesen.
- **Abschaltbar:** „Do Not Track“ oder „Global Privacy Control“ im Browser und ein neuer Schalter
  „Anonyme Statistik senden“ unter **Fortschritt**. Der Schalter gilt für die ganze Spielstatistik, also
  auch für die heutigen Start-/Lösungsmeldungen. Standard: an (wie bisher die Spielstatistik).
- **Nicht gezählt:** Levels aus Links (Editor, `link:`), Läufe zu zweit und im Wettkampf, Entwicklung
  (`localhost`).
- **Aufbewahrung:** Tageszeilen älter als 365 Tage löscht der Server beim ersten Eintrag eines neuen Tages.
- **Offline:** Das Spiel sammelt nur im Arbeitsspeicher der offenen Seite (nichts im Browser-Speicher,
  siehe „Offline-Puffer“) und sendet gebündelt, sobald es wieder online ist.

## Warum nicht am heutigen Ping

Geprüft: Der Ping `/api/event` meldet je Ereignis sofort per `sendBeacon` (`start`, `solve`) und bildet
dabei für die Spielerzählung einen Tages-Prüfwert aus IP-Adresse und Browserkennung. Die Auswertung
braucht davon nichts und soll gerade **ohne** diesen Prüfwert auskommen; sie braucht dagegen das Ende
eines Laufs (Neustart, Abbruch, Abstürze, Dauer) und das Bündeln mehrerer Läufe in einer Sendung. Ein
eigener Endpunkt hält beide Wege sauber getrennt:

- gleicher Schalter und gleiche Sperren im Spiel (`statsAllowed`), gleiche Leseberechtigung
  (Admin oder `STATS_TOKEN`), gleiche Seite `statistik.html`;
- eigener Schreibweg `POST /api/auswertung` ohne IP, ohne Prüfwert, ohne Einzelereignis.

„Gestartet“ und „gelöst“ zählt die Auswertung selbst, damit die Quoten aus **einer** Quelle stammen
(der Ping verliert offline Meldungen, die Auswertung bündelt sie).

## Was gezählt wird

Ein **Lauf** beginnt mit dem ersten Physikschritt eines geladenen Levels (wie „Versuche“ im lokalen
Fortschritt) und endet so:

| Ende | wann |
|---|---|
| `geloest` | Das Level wird gewonnen. |
| `neustart` | Dasselbe Level wird neu geladen (Neustart, „Nochmal“ nach Absturz ohne Leben). |
| `abbruch` | Ein anderes Level wird geladen oder die Seite geschlossen bzw. verlassen (`pagehide`). |

Je Lauf-Ende zählen außerdem die **Abstürze** des Laufs und die **Zeitklasse** der Spielzeit (Physik-
schritte, also ohne Pausen):

| Klasse | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| Spielzeit | unter 1 min | 1–3 min | 3–10 min | 10–30 min | ab 30 min |

Getrennt für gelöste und für abgebrochene Läufe (Neustarts haben keine Zeitklasse). Nur Klassen, keine
genauen Zeiten: Wer die Bestenliste will, meldet sich dort an.

## Spiel (`src/auswertung.ts`)

- `Auswertung.start(pack, level)` und `Auswertung.ende(pack, level, art, sekunden, abstuerze)` addieren in
  einen Puffer `Map<pack\nlevel, Zaehler>`. Ist die Statistik aus, wird nichts gezählt.
- **Senden:** als ein JSON-Bündel mit `sendBeacon` an `/api/auswertung`, höchstens 50 Levels je
  Sendung (sonst mehrere). Anlässe: Seite wird verborgen (`visibilitychange`) oder verlassen
  (`pagehide`), Browser wieder online (`online`), oder 20 beendete Läufe im Puffer.
- **Offline** (`navigator.onLine === false`) oder wenn `sendBeacon` ablehnt, bleibt der Puffer erhalten.
  Ein angenommener Beacon leert ihn; ob er ankommt, prüft das Spiel nicht (verlorene Zähler sind kein
  Fehler).
- Das Bündel enthält keine Zeit, keine Kennung, keine Reihenfolge der Läufe.

### Offline-Puffer

Ein Puffer im `localStorage` würde auch Zähler über das Schließen der Seite hinaus retten, ist aber ein
Speichern auf dem Endgerät, das für das Spielen nicht nötig ist (§ 25 TDDDG, wohl Einwilligung nötig).
Deshalb **nur im Arbeitsspeicher**: Wird die Seite offline geschlossen, gehen diese Zähler verloren.
(Offene Frage an den Nutzer, siehe unten.) Der Schalter selbst liegt als Einstellung im `localStorage`
(`murmel.statistikAus`), wie Stil und Steuerung.

## API

### `POST /api/auswertung`

```json
{ "levels": [ { "pack": "enigma_i", "level": "enigma:m_tutor/m_tut1",
  "gestartet": 3, "geloest": 1, "neustart": 2, "abbruch": 0, "abstuerze": 4,
  "zeitGeloest": [0, 1, 0, 0, 0], "zeitAbbruch": [0, 0, 0, 0, 0] } ] }
```

- Schema streng: 1–50 Einträge, `pack` und `level` nach `LEVEL_ID`, Zähler ganzzahlig 0–500,
  `abstuerze` 0–10 000, Zeitklassen genau 5 Werte 0–500. Fremde Felder (etwa eine Zeit oder Kennung)
  verwirft Fastify vor der Verarbeitung (`removeAdditional`); sie werden nie gespeichert.
- Antwort immer `204` (auch bei Datenbankfehler, der nur ins Protokoll geht). Kein Cookie, keine
  Konto-Auswertung; das Server-Protokoll enthält wie überall nur Methode und Pfad.
- Der Tag ist der Berliner Tag beim **Eingang** (offline gesammelte Zähler landen am Sendetag).

### `GET /api/statistik/auswertung?tage=30`

Nur Admin oder `Authorization: Bearer <STATS_TOKEN>` (sonst `401`), `Cache-Control: no-store`.
Antwort: die Summen je Level im Zeitraum, sortiert nach Paket und Level:

```json
{ "levels": [ { "pack": "…", "level": "…", "gestartet": 0, "geloest": 0, "neustart": 0, "abbruch": 0,
  "abstuerze": 0, "zeitGeloest": [0,0,0,0,0], "zeitAbbruch": [0,0,0,0,0] } ] }
```

## Datenbank (Migration `015_auswertung.sql`)

```sql
create table auswertung_level (
  day date not null, pack text not null, level text not null,
  gestartet integer not null default 0, geloest integer not null default 0,
  neustart integer not null default 0, abbruch integer not null default 0,
  abstuerze integer not null default 0,
  zeit_geloest integer[] not null default '{0,0,0,0,0}',
  zeit_abbruch integer[] not null default '{0,0,0,0,0}',
  primary key (day, pack, level)
);
```

Einfügen mit `on conflict do update` (Zähler und Zeitklassen elementweise addiert), alles in einer
Transaktion. Beim ersten Eintrag eines Tages: `delete … where day < heute - 365`.

## Statistikseite

Neuer Abschnitt **„Wo Spieler hängen“** auf `statistik.html`, sichtbar nur, wenn
`/api/statistik/auswertung` antwortet (Admin oder Schlüssel), mit dem Zeitraum der Seite:

- **Schwerste Levels:** Levels mit mindestens 5 beendeten Läufen, sortiert nach Lösungsquote
  (gelöst ÷ beendete Läufe), höchstens 20; Spalten Level, Paket, Läufe, gelöst %, Neustarts je Lauf,
  Abbrüche, Abstürze je Lauf, häufigste Zeitklasse der gelösten Läufe.
- **Abbruchquote je Paket:** je Paket Läufe, gelöst %, Abbruch % (Abbrüche ÷ beendete Läufe), sortiert
  nach Abbruch %.

Rechnen im Browser (`src/auswertung-seite.ts`, reine Funktionen getestet).

## Datenschutz – Entwurf (nicht live; braucht die Freigabe des Nutzers)

Ergänzung am Ende des Abschnitts „Spielstatistik“ in `datenschutz.html`:

> Damit wir sehen, welche Levels zu schwer sind oder an der falschen Stelle im Paket stehen, zählt das
> Spiel außerdem, wie oft ein Level begonnen, gelöst, neu gestartet oder abgebrochen wurde, wie viele
> Abstürze es dabei gab und in welcher groben Zeitspanne (unter 1 Minute bis über 30 Minuten) ein Lauf
> endete. Diese Zahlen sammelt das Spiel nur im Arbeitsspeicher der geöffneten Seite – nicht im
> Browser-Speicher – und schickt sie gebündelt ohne Uhrzeit und ohne Kennung an unseren Server, auch wenn
> Sie offline gespielt haben, sobald wieder eine Verbindung besteht. Der Server addiert sie zu Tageszahlen
> je Level; IP-Adressen, Prüfwerte oder einzelne Spielverläufe werden dafür nicht gespeichert, ein Konto
> wird nicht zugeordnet. Die Tageszahlen löschen wir nach 365 Tagen. Unter „Fortschritt“ können Sie die
> gesamte Spielstatistik mit dem Schalter „Anonyme Statistik senden“ abschalten; „Do Not Track“ und
> „Global Privacy Control“ wirken ebenso. Rechtsgrundlage ist unser berechtigtes Interesse an der
> Verbesserung des Spiels (Art. 6 Abs. 1 lit. f DSGVO).

Außerdem muss der bestehende Satz „Wenn Ihr Browser „Do Not Track“ … sendet, meldet das Spiel nichts.“
um den neuen Schalter ergänzt werden (im Entwurf oben enthalten).

## Bauschritte

| Schritt | Inhalt | Prüfung |
|---|---|---|
| A1 | `src/auswertung.ts`: Zähler, Zeitklassen, Puffer, Bündel, Senden; Schalter in `stats.ts` | vitest |
| A2 | Migration 015, `POST /api/auswertung`, `GET /api/statistik/auswertung`, DB und Speicher | `node --test`, CI mit PostgreSQL |
| A3 | Einbau in `main.ts` (Laufbeginn, Sieg, Neustart/Abbruch, `pagehide`, Senden) und Schalter unter Fortschritt | vitest, tsc |
| A4 | Abschnitt „Wo Spieler hängen“ auf `statistik.html` | vitest (Rechnung), tsc |

## Offene Fragen

1. **Offline-Puffer im Browser-Speicher** (überlebt Schließen der Seite) nur mit Einwilligung – lohnt sich
   das? Gebaut ist die Variante ohne Speicher.
2. **Missbrauch:** Wie `/api/event` ist der Schreibweg offen; Obergrenzen je Sendung begrenzen Ausreißer,
   gezielte Verfälschung verhindert das nicht. Bei Bedarf ein Anfragelimit je IP nur im Arbeitsspeicher
   (wie `limit.ts`).
3. **Tipps** (`docs/SPEC-tipps.md`): ob ein Lauf mit gezeigtem Weg endete, wäre ein weiterer starker
   Schwierigkeitshinweis – nicht gebaut.
