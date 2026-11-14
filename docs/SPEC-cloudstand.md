# Baustein `cloudstand`: Spielstand in der Cloud

Planung: `docs/SERVER.md` Abschnitte 3 und 10. Baut auf `sync` (`docs/SPEC-sync.md`), `konten`
(`docs/SPEC-konten.md`) und der Eingabeaufzeichnung (`docs/SPEC-aufzeichnung.md`) auf. Stand 14.11.2026.

## Ziel

Wer angemeldet ist, kann ein Level mittendrin unterbrechen und es auf einem anderen Gerät (oder später
auf demselben) an genau dieser Stelle weiterspielen. Ohne Konto oder ohne Netz bleibt alles wie heute:
kein Stand, keine Anfrage, keine Meldung.

## Ansatz: Startwert plus Eingabeaufzeichnung (kein Speicherabzug)

Ein Stand ist **kein Abbild des Objektzustands**, sondern der Lauf selbst:

- Level-Kennung und Paket, **Startwert des Zufalls** (`seed`), mitgebrachte Extraleben (`carryLives`),
- die **Eingabeaufzeichnung** des Laufs bis zum Speicherpunkt (Format Version 1 aus
  `src/game/recording.ts`, also genau das, was `session.recording()` liefert),
- ein **Prüfcode** des Zustands am Speicherpunkt (siehe unten) und die Spielversion.

Zum Weiterspielen erzeugt das Spiel einen neuen Lauf mit Startwert und Leben und spielt die Eingaben
Schritt für Schritt nach – ohne Grafik, ohne Töne (`replay.ts`, wie Bestenliste und Geister). Danach
ist der Lauf in genau dem Zustand des Speicherpunkts, und die Aufzeichnung läuft nahtlos weiter.

**Warum nicht der Objektzustand:** Ein Abbild müsste Physik, alle Objekte, Inventare, Gummibänder,
Zeitgeber, Gegner, den Zustand des Zufallsgenerators und vor allem den **Lua-Zustand** (Variablen,
Closures, Zeitgeber der Levelskripte) vollständig sichern und wiederherstellen. Für Lua geht das nicht
sauber (Fengari-Stapel und Closures lassen sich nicht serialisieren), und jedes neue Objekt müsste
mitgepflegt werden. Die Aufzeichnung gibt es dagegen schon, sie ist geprüft (bitgenau Browser ↔ Node)
und klein.

### Geht das mit Lua-Levels und Zufall?

- **Zufall:** Jeder Zufall des Laufs kommt aus *einem* Generator mit dem gespeicherten Startwert
  (`createRng(seed)`), auch der Zufall der Lua-Skripte (`random: this.rng` im Lua-Host) und das Mischen
  der Oxyd-Paare. Gleicher Startwert + gleiche Eingaben = gleicher Lauf.
- **Lua:** Skripte laufen synchron in den Physikschritten und bekommen nur Ereignisse aus der Simulation;
  `session.test.ts` und `replay.test.ts` prüfen den Determinismus auch mit Lua-Levels. Das Einzige,
  was Lua asynchron tut (`signalsAdded` per `queueMicrotask`), betrifft nur die Darstellung.
- **Zeit:** Alle Zeitgeber zählen Physikschritte (`aufzeichnung` A2), nichts hängt an der Uhr.
- **Grenze 1 – andere Spielversion:** Ändert ein Update das Level oder die Spiellogik, kann derselbe
  Lauf anders ausgehen. Deshalb der **Prüfcode**: Nach dem Nachspielen vergleicht das Spiel Schrittzahl,
  Abstürze, Oxyd-Zustände, Inventare und die Murmelpositionen (auf 1/1000 Feld gerundet) mit dem
  gespeicherten Wert. Passt er nicht, beginnt das Level neu mit dem Hinweis „Der gesicherte Stand passt
  nicht mehr zu dieser Spielversion.“ – nie ein falscher Zustand.
- **Grenze 2 – andere Browser-Engine:** Chrome/Edge (V8), Firefox und Safari dürfen `Math.sin`,
  `Math.hypot` usw. im letzten Bit unterschiedlich runden; über viele Schritte kann das einen Lauf
  verändern. Der Prüfcode erkennt auch das. Zwischen Geräten mit derselben Engine (z. B. PC-Chrome und
  Android-Chrome) ist der Lauf bitgenau gleich. Wie oft es zwischen Engines scheitert, zeigt erst der
  Betrieb (offene Frage 2).
- **Dauer des Nachspielens:** in Node rund 120 000–180 000 Schritte/s, also eine Stunde Spielzeit
  (1,44 Mio. Schritte) in etwa 10 s am PC, auf Handys mehrfach länger. Das Spiel spielt in Häppchen nach
  und zeigt „Spielstand wird wiederhergestellt … 40 %“.

## Was gespeichert wird

Je Konto und Level **höchstens ein Stand** (Tabelle `cloud_saves`, Migration `014_cloudstand.sql`):

| Feld | Inhalt |
|---|---|
| `level` | Level-Kennung (≤ 200 Zeichen, keine Steuerzeichen) |
| `pack` | Paket-Kennung, um das Level wiederzufinden (≤ 100 Zeichen) |
| `seed` | Startwert (0 … 2³²−1) |
| `leben` | mitgebrachte Extraleben oder `null` (0 … 99) |
| `steps` | Physikschritte bis zum Speicherpunkt (1 … 1 440 000 = eine Stunde, wie die Bestenliste) |
| `version` | Spielversion (Commit) beim Sichern, nur zur Anzeige und Fehlersuche |
| `pruef` | Prüfcode des Zustands (≤ 200 Zeichen) |
| `daten` | Eingabeaufzeichnung als JSON, gzip-komprimiert, Base64 (≤ 2 000 000 Zeichen) |
| `updated_at` | Zeitpunkt des Sicherns (vom Server) |

- **Größe:** Eine Stunde mit dauernder Mausbewegung sind rund 4 MB JSON, komprimiert rund 1 MB. Ist ein
  Stand trotzdem größer, wird er nicht gesichert („Dieser Lauf ist zu lang für die Cloud.“).
- **Höchstens 20 Stände je Konto:** Ein 21. Level verdrängt den ältesten Stand.
- **Aufbewahrung:** Ein Stand verschwindet, sobald das Level gelöst ist, nach **90 Tagen** ohne neues
  Sichern und **sofort mit dem Konto** (`on delete cascade`).
- **Nie in Ranglisten:** Stände sind nur für das eigene Konto lesbar, keine Route zeigt fremde Stände.
  Ein **fortgesetzter Lauf** geht außerdem nicht in die Bestenliste und nicht in die Tages-/Wochenaufgabe
  (wie ein Lauf mit gezeigtem Tipp): Wer an einem Speicherpunkt beliebig oft neu ansetzen kann, hätte
  sonst einen Vorteil. Er zählt als gelöst und für den eigenen Fortschritt.
- Der Server kennt keine Spiellogik und entpackt `daten` nicht; er prüft nur Form und Größe.

## API (`server/src/cloudstand.ts`)

Alle Routen hinter `requireSignedIn` (lesen) bzw. `requireAccount` (schreiben, nicht gesperrt),
`Cache-Control: no-store`, CSRF wie `sync` (schreibend nur ohne oder mit eigener `Origin`), höchstens
120 Anfragen je Konto in 15 Minuten (`429`). Die Level-Kennung steht im Query (`?level=`), weil sie `/`
und `:` enthalten kann.

| Route | Zweck |
|---|---|
| `GET /api/spielstand` | Liste der eigenen Stände ohne Daten: `{ staende: [{ level, pack, steps, gespeichert }] }` |
| `GET /api/spielstand?level=…` | Ein Stand mit Daten: `{ level, pack, seed, leben, steps, version, pruef, daten, gespeichert }`, sonst `404` |
| `PUT /api/spielstand?level=…` | Body `{ pack, seed, leben, steps, version, pruef, daten }` → `{ gespeichert }`; Body höchstens 2,5 MiB |
| `DELETE /api/spielstand?level=…` | Stand löschen → `204` (auch wenn keiner da war) |

Konflikte: **Das zuletzt Gesicherte gilt** (kein Sperren). Ein Speicherpunkt ist kein Zähler; wer auf
zwei Geräten dasselbe Level offen hat, setzt dort fort, wo er zuletzt pausiert hat.

Aufräumen: einmal täglich löscht der Server Stände, die älter als 90 Tage sind (Zeitgeber wie Web Push,
in Tests aus).

## Im Spiel (`src/cloudstand.ts`, `src/main.ts`)

Nur wenn angemeldet (nicht gesperrt), das Level aus einem normalen Paket stammt (nicht aus einem Link,
kein Spieler-Level), nicht zu zweit gespielt wird, der Lauf läuft (nicht gewonnen) und mindestens ein
Schritt gespielt ist. Sonst geschieht nichts – wie heute.

- **Sichern im Pausenmenü:** Öffnet sich die Pause, wird der Stand gesichert, wenn er sich seit dem
  letzten Sichern geändert hat. Eine Statuszeile im Pausenmenü (`role="status"`): „Wird in der Cloud
  gesichert …“ → „In der Cloud gesichert – auf einem anderen Gerät weiterspielen.“ bzw. „Sichern gerade
  nicht möglich.“ / „Dieser Lauf ist zu lang für die Cloud.“
- **Sichern beim Verlassen:** Wird die Seite verborgen oder geschlossen (`visibilitychange` → `hidden`),
  wird ebenfalls gesichert (`fetch` mit `keepalive`, solange der Stand unter 60 KB liegt; größere Stände
  sichert schon die Pause, die beim Verlassen des Mausfangs ohnehin aufgeht).
- **Weiterspielen:** Beim Öffnen eines Levels (Startbildschirm des Levels) fragt das Spiel die Liste der
  eigenen Stände ab. Gibt es einen für dieses Level, heißt der erste Knopf **„Weiterspielen (2:31)“**
  (Spielzeit des Stands), der zweite **„Neu beginnen“**. „Neu beginnen“ lässt den Stand liegen, bis er
  überschrieben wird oder abläuft.
- **Wiederherstellen:** Stand holen, entpacken, prüfen (`decodeInput`), Lauf mit Startwert und Leben
  anlegen, in Häppchen nachspielen (Overlay mit Fortschritt), Prüfcode vergleichen, Lauf übernehmen
  und pausiert zeigen. Fehler (Netz, kaputte Daten, Prüfcode passt nicht) → Hinweis und normaler Start.
- **Nach dem Sieg** wird der Stand dieses Levels gelöscht.
- **Fortschritt:** Ein fortgesetzter Lauf zählt keinen zweiten Versuch; Spielzeit und Abstürze zählen nur
  den Teil, der auf diesem Gerät gespielt wurde.
- Ohne `CompressionStream` (sehr alte Browser) gibt es keinen Cloudstand; alles andere bleibt.

## Tests

- Server (`node --test`, `server/src/cloudstand.test.ts`), Speicher- und PostgreSQL-Store
  (`TEST_DATABASE_URL`): sichern/holen/auflisten/löschen, nur das eigene Konto, ohne Konto `401`,
  gesperrt `403` beim Schreiben, Grenzen (`400`), höchstens 20 Stände (ältester fällt weg), Aufräumen
  nach 90 Tagen, Begrenzung je Konto (`429`), fremde Herkunft `403`, Konto löschen löscht die Stände.
- Spiel (vitest, `src/cloudstand.test.ts`): Lauf sichern → komprimieren → entpacken → nachspielen ergibt
  denselben Zustand und läuft gleich weiter (auch Lua-Level); falscher Prüfcode wird erkannt; kaputte
  oder zu große Daten werden abgelehnt; API-Hülle (404, offline).

## Grenzen

- **Immer:** ohne Konto und offline unverändert; Stände nur für das eigene Konto; Tests vor jedem Commit.
- **Erst fragen:** Datenschutzerklärung (Entwurf unten), längere Aufbewahrung, mehr Stände je Konto.
- **Nie:** Stände in Ranglisten oder für andere sichtbar; Spiellogik auf dem Server für Stände.

## Datenschutz (Entwurf – erst nach Freigabe in `datenschutz.html`)

Neuer Abschnitt nach „Fortschritt auf allen Geräten“:

```html
      <h2>Spielstand in der Cloud</h2>
      <p>
        Wenn Sie angemeldet sind, sichert das Spiel einen angefangenen Level-Lauf, sobald Sie pausieren oder die
        Seite verlassen, damit Sie ihn auf einem anderen Gerät an derselben Stelle fortsetzen können. Dafür
        speichern wir zu Ihrem Konto je Level: die Kennung des Levels und des Pakets, den Startwert des Zufalls,
        die mitgebrachten Extraleben, Ihre Eingaben während des Laufs (Mausbewegungen, Tasten und Aktionen je
        Spielschritt), die gespielte Zeit, einen Prüfwert des Spielzustands, die Spielversion und den Zeitpunkt
        des Sicherns. Ohne Konto wird nichts übertragen.
      </p>
      <p>
        Diese Daten sind nur für Sie sichtbar und erscheinen in keiner Rangliste. Wir bewahren höchstens 20
        Spielstände je Konto auf. Ein Spielstand wird gelöscht, sobald Sie das Level lösen, spätestens 90 Tage
        nach dem letzten Sichern und sofort, wenn Sie Ihr Konto löschen; aus den nächtlichen Datensicherungen
        verschwindet er nach spätestens 14 Tagen. Zum Schutz vor Überlastung begrenzen wir die Zahl der
        Anfragen je Konto; dafür wird die Kontonummer kurzzeitig im Arbeitsspeicher gehalten.
      </p>
      <p>
        Rechtsgrundlage ist die Bereitstellung der von Ihnen gewünschten Funktion (Art. 6 Abs. 1 lit. b DSGVO).
        Die Daten werden auf unserem Server in Deutschland verarbeitet.
      </p>
```

Anpassung im Abschnitt „Konto (freiwillig)“: „… Anmeldelinks und der abgeglichene Fortschritt sofort
entfernt“ → „… Anmeldelinks, der abgeglichene Fortschritt und gesicherte Spielstände sofort entfernt“.

## Offene Fragen an den Nutzer

1. Datenschutzabsatz oben freigeben (Wortlaut, 90 Tage, 20 Stände)?
2. Scheitert das Nachspielen zwischen Browser-Engines (z. B. PC-Chrome → iPhone-Safari) im Betrieb oft,
   wäre der Ausweg ein zusätzlicher Speicherabzug für Levels ohne Lua – deutlich mehr Code. Erst
   beobachten?
3. Fortgesetzte Läufe ohne Bestenliste – einverstanden?
