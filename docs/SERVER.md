# Server-Konzept: Konten, Bestenlisten, Spieler-Levels, Mehrspieler

Stand 13.11.2026. **Entschieden: große Version mit eigenem Server** (Abschnitt 11). Vor dem Bau
werden die Bauphasen (Abschnitt 3) freigegeben; jeder Baustein bekommt eine eigene Spezifikation.

## 1. Ziel

Murmel bleibt ein Spiel, das **ohne Konto, ohne Server und offline** vollständig funktioniert.
Ein kleiner, freiwilliger Server ergänzt nur, was ein einzelner Browser nicht kann:

| Wunsch | Warum ein Server nötig ist |
|---|---|
| Fortschritt auf PC und Handy gleich | Der Browser-Speicher (`localStorage`) gilt nur für ein Gerät |
| Bestenlisten (Zeit je Level) | Zeiten anderer Spieler müssen irgendwo liegen und geprüft werden |
| Spieler-Levels teilen, finden, bewerten | Eine gemeinsame Sammlung braucht Speicher und Moderation |
| Zu zweit spielen | Zwei Browser müssen sich finden (Vermittlung); das Spiel selbst läuft direkt zwischen ihnen |

Was **ohne** Server geht und vorher gebaut werden kann: Bestzeiten auf dem eigenen Gerät,
Leveleditor mit Teilen per Link (das Level steckt im Link), Fortschritt als Datei sichern.

## 2. Aufbau

```
Browser (murmel.games, IONOS-Webspace, statisch, offline-fähig)
   │  HTTPS, JSON              │  WebSocket (nur Vermittlung)
   ▼                           ▼
api.murmel.games  ── kleiner VPS (Docker) ──  Datenbank + nächtliche Sicherung
```

- **Spiel:** bleibt unverändert auf IONOS; Deploy wie heute per Push auf `main`.
- **API:** eigener Dienst auf einem VPS, Node.js/TypeScript (gleiche Sprache wie das Spiel,
  Spiellogik wie Levelprüfung kann wiederverwendet werden). Ein Container, davor ein Reverse-Proxy
  mit Let's-Encrypt-Zertifikat.
- **Datenbank:** PostgreSQL (oder SQLite für den Anfang, siehe offene Fragen).
- **Mehrspieler:** WebRTC zwischen den beiden Browsern; der Server vermittelt nur den
  Verbindungsaufbau (Signalisierung). Ein TURN-Relay nur, wenn direkte Verbindungen oft scheitern.
- **Ohne Server:** Fällt die API aus, spielt jeder weiter wie heute; Konto-Funktionen zeigen
  „gerade nicht erreichbar“ und holen später nach.

## 3. Bausteine-Übersicht (Nutzerentscheidung 13.11.2026: große Version mit eigenem Server)

| Baustein (id) | Aufgabe | Hängt ab von |
|---|---|---|
| `lokal` | Bestzeiten, Statistik, Fortschritt sichern/laden – nur im Browser | – |
| `aufzeichnung` | Deterministischer Zufall je Lauf, Eingabeaufzeichnung, Nachspielen ohne Grafik (Node) | – |
| `editor` | Leveleditor im Browser, Teilen per Link | – |
| `api-basis` | IONOS-VPS, PostgreSQL, Reverse-Proxy, Sicherung, Überwachung, Deploy | – |
| `umzug` | Spiel vom eigenen Server, IONOS-Webspace als Notbetrieb mit Umschaltung | `api-basis` |
| `konten` | Mail-Link, Passkey, Google/Apple/GitHub; Profil; Konto löschen | `api-basis` |
| `sync` | Fortschritt und Bestzeiten geräteübergreifend | `konten`, `lokal` |
| `bestenliste` | Zeiten je Level, Ranglisten, Prüfung per Nachspielen | `konten`, `aufzeichnung` |
| `loesbarkeit` | Nächtliches Nachspielen aller Levels mit gespeicherten Lösungen | `api-basis`, `aufzeichnung` |
| `geister` | Geister-Läufe, Lösungen ansehen, Tipps | `bestenliste` |
| `spielerlevels` | Hochladen (nur selbst gelöst), Suche, Bewertung, Melden | `konten`, `editor`, `aufzeichnung` |
| `tageslevel` | Tageslevel, Wochenaufgabe, Rangliste, Web-Push | `bestenliste` |
| `levelseiten` | Eine Seite je Level mit Vorschaubild für Suchmaschinen | `umzug` |
| `mehrspieler` | Zu zweit über WebRTC, Raum per Code | `api-basis` |
| `wettkampf` | Server als Schiedsrichter: mehr Spieler, Zuschauer, Wettrennen | `mehrspieler`, `aufzeichnung` |
| `enigma-upload` | Enigma-Leveldatei hochladen und umwandeln | `spielerlevels` |
| `auswertung` | Datensparsam: wo Spieler scheitern oder abbrechen | `api-basis` |
| `cloudstand` | Spielstand mitten im Level in der Cloud | `sync` |

**Bauphasen**

| Phase | Bausteine | Server nötig |
|---|---|---|
| A | `lokal`, `aufzeichnung`, `editor` | nein – sofort möglich, nutzt auch ohne Konto |
| B | `api-basis`, `umzug`, `konten` | ja (VPS-Bestellung durch den Nutzer) |
| C | `sync`, `bestenliste`, `loesbarkeit` | ja |
| D | `geister`, `spielerlevels`, `tageslevel`, `levelseiten` | ja |
| E | `mehrspieler`, `wettkampf`, `enigma-upload`, `auswertung`, `cloudstand` | ja |

`aufzeichnung` ist der Schlüsselbaustein: Bestenliste, Lösbarkeitsprüfung, Geister, Tipps,
Spieler-Levels und Wettkampf bauen darauf auf.

Jeder Baustein bekommt vor dem Bau eine eigene Spezifikation (`docs/SPEC-<id>.md`).

## 4. Konten (`konten`)

- **Anmeldung ohne Passwort:** Login-Link per Mail, **Passkey** (Fingerabdruck/Face ID) und
  **Google, Apple, GitHub** (OpenID Connect/OAuth). Murmel speichert keine Passwörter; ein Konto kann
  mehrere Anmeldewege verknüpfen.
- **Daten je Konto:** Mailadresse, frei wählbarer Anzeigename, Erstellungsdatum. Keine Klarnamen.
- **Sitzung:** sicheres HttpOnly-Cookie auf `api.murmel.games` oder kurzlebiges Token; Abmelden
  auf allen Geräten möglich.
- **Konto löschen** mit einem Klick, löscht Fortschritt, Zeiten und (wählbar) eigene Levels.
- **Mailversand:** über das vorhandene IONOS-Postfach oder einen Versanddienst (offene Frage).

## 5. Fortschritt-Sync und Bestenlisten (`sync`, `bestenliste`)

- Gespeichert werden je Konto: gelöste Levels, Bestzeit, Abstürze, Zeitpunkt.
- **Zusammenführen** bei mehreren Geräten: gelöst bleibt gelöst, die bessere Zeit gewinnt.
- **Schutz vor Schummeln:** Der Browser schickt zur Zeit die **Eingabeaufzeichnung** (Mausbewegung
  je Physikschritt). Der Server spielt sie mit derselben Spiellogik nach (Node, ohne Grafik) und
  übernimmt die Zeit nur, wenn das Level dabei gelöst wird. Das geht, weil Physik und Objekte schon
  heute in reinem TypeScript laufen; Voraussetzung ist ein **deterministischer Zufall** (fester
  Startwert je Lauf).
- Ranglisten je Level (Top 100 + eigener Platz), keine globale Punktzahl am Anfang.

## 6. Leveleditor und Spieler-Levels (`editor`, `spielerlevels`)

- Editor im Browser auf Basis des vorhandenen Levelformats (`LevelFile`), Objekte aus der
  bestehenden Objektliste, sofort probespielbar.
- **Ohne Server** teilbar: Level komprimiert im Link (`murmel.games/#level=…`).
- **Mit Server:** hochladen nur, wenn der Autor es selbst gelöst hat (gleiche Nachspiel-Prüfung
  wie bei Bestzeiten → keine unlösbaren Levels).
- Liste mit Suche, „neu“, „beliebt“, Bewertung 1–5, Melden-Knopf.
- **Moderation:** neue Levels erst sichtbar nach Freigabe oder nach N positiven Bewertungen
  (offene Frage); Lizenz der Spieler-Levels: GPL-kompatibel (Vorschlag CC BY-SA 4.0).

## 7. Mehrspieler (`mehrspieler`)

- Ein Spieler öffnet einen Raum und bekommt einen **4-stelligen Code**, der zweite tritt bei.
- Verbindung direkt zwischen den Browsern (WebRTC-Datenkanal); der Server vermittelt nur.
- Spielmodell: ein Browser rechnet die Physik (Gastgeber), der andere schickt Eingaben und erhält
  den Zustand – einfach und ohne Auseinanderlaufen. Erste Levels: die vorhandenen
  Yin-Yang-/Zwei-Murmel-Levels.
- Kein Konto nötig; Räume verfallen nach 30 min ohne Aktivität.

## 8. Betrieb, Datenschutz, Kosten

- **Server:** eigener VPS für Murmel, **getrennt von WH-Control** (Hobbyprojekt nicht auf
  Firmeninfrastruktur; siehe offene Fragen). Ausstattung und Ausbau siehe 8.1.
- **Deploy:** GitHub Actions baut ein Container-Image, Rollout per SSH; Rückweg = vorheriges Image.
- **Sicherung:** nächtlicher Datenbank-Dump, verschlüsselt außer Haus, Rücksicherung getestet.
- **Überwachung:** Erreichbarkeitsprüfung + Mail bei Ausfall.
- **Datenschutz:** Datenschutzerklärung um Konto, Mail, Bestenlisten, Spieler-Levels und
  Server-Protokolle erweitern; Auftragsverarbeitung mit VPS- und ggf. Mail-Anbieter; Daten nur in
  der EU; Protokolle ohne volle IP, 7 Tage.
- **Sicherheit:** Eingaben prüfen, Begrenzung der Anfragen je IP/Konto, Upload-Größen begrenzen,
  keine Geheimnisse im Repo (GitHub-Secrets).

### 8.0 Spielerstatistik (`statistik`, Nutzerentscheidung 13.11.2026: eigene Zähler)

- **Was gezählt wird:** je Tag (Berliner Kalendertag) eindeutige Spieler, Levelstarts und gelöste
  Levels, dazu Starts/Gelöst je Level. Ein „Spieler“ ist, wer an dem Tag mindestens ein Level startet.
- **Spiel:** `src/stats.ts` schickt beim ersten Start eines Laufs und beim Lösen `{type, level}` per
  `navigator.sendBeacon` an `POST /api/event`. Kein Cookie, keine gespeicherte Kennung. Still bei
  `localhost`, bei „Do Not Track“ und „Global Privacy Control“; offline und auf dem IONOS-Webspace
  läuft die Meldung ins Leere (404), das Spiel merkt davon nichts.
- **Server:** `server/src/app.ts` (Endpunkte), `server/src/db.ts`, Tabellen in
  `server/migrations/002_statistik.sql`. Eindeutige Spieler über einen Prüfwert (HMAC-SHA256 aus IP
  und Browserkennung mit einem Tagesschlüssel, 16 Byte). Mit dem ersten Ereignis eines neuen Tages
  werden die Schlüssel und Prüfwerte der Vortage gelöscht; danach gibt es nur noch Zahlen.
  Die IP-Adresse wird nicht gespeichert. Hinter Caddy gilt genau ein Proxy-Schritt als
  vertrauenswürdig (`req.ip` = von Caddy gesehene Adresse).
- **Ansehen:** `https://murmel.games/statistik.html` (noindex, nicht im Offline-Speicher) fragt
  `GET /api/statistik?tage=N` mit `Authorization: Bearer <STATS_TOKEN>`. Ohne `STATS_TOKEN` in
  `/opt/murmel/.env` bleibt die Statistik geschlossen (401). Das Token legt der Nutzer fest
  (z. B. `openssl rand -hex 24`); es steht nie im Repo.
- **Grenzen:** Mehrere Personen hinter derselben IP mit gleichem Browser zählen als einer; ein
  Browserwechsel am selben Tag als zwei. Gezählt wird erst, wenn `murmel.games` auf den Server zeigt.
- **Datenschutzerklärung:** Absatz zur Statistik vor dem ersten Zählen ergänzen (Nutzerfreigabe).
- **Tests:** `server/src/app.test.ts` (Endpunkte, Prüfwert, Token), `server/src/db.test.ts` gegen
  echtes PostgreSQL (in der CI als Dienst, lokal übersprungen), `src/stats.test.ts`.

### 8.1 Erstausstattung und Ausbau

| | Start | Begründung |
|---|---|---|
| CPU | 2 vCPU | API braucht wenig; Hauptlast ist das Nachspielen von Läufen (Bestenliste) und die nächtliche Lösbarkeitsprüfung (~1300 Levels, geschätzt 30–60 min auf einem Kern) |
| RAM | 4 GB | Node, PostgreSQL, Reverse-Proxy, Docker bequem; 2 GB wäre knapp |
| Speicher | 80–120 GB NVMe | Spiel ~17 MB, Datenbank anfangs MB; Rest Puffer für Images, Aufzeichnungen, lokale Sicherungen |
| System | Ubuntu LTS + Docker | gleicher Aufbau wie die übrigen Server |
| Netz | feste IPv4 + IPv6, Traffic laut Tarif prüfen | je neuer Spieler ~4 MB Grundausstattung plus geöffnete Pakete |

Das Spiel rechnet im Browser; der Server sieht nur kleine Anfragen. Diese Ausstattung reicht für
einige tausend Spieler am Tag. Teuer werden erst das Nachspielen und Mehrspieler mit dem Server
als Schiedsrichter (`wettkampf`), weil dort der Server die Physik je Raum rechnet.

**Anbieter:** IONOS liegt nahe (Konto, Domain und DNS sind schon dort; einfache Umschaltung auf den
Webspace-Notbetrieb). Ältere Übersichten nennen für 2 vCPU/4 GB ca. 6 €/Monat; aktuelle Preise im
IONOS-Kundenkonto prüfen (Stand 13.11.2026 keine belastbare Preisliste gefunden).

**Hochrüsten:** Ein IONOS-VPS lässt sich per Upgrade um CPU, RAM und Speicher erweitern; der Server
ist dabei einige Minuten nicht erreichbar. Zurückstufen ist nicht vorgesehen – daher klein
anfangen. Quelle: IONOS-Hilfe „Important information on upgrading your VPS“
(ionos.co.uk/help/server-cloud-infrastructure/general-information-vps/important-information-on-upgrading-your-vps/).

**Ausbaupfad bei stark steigender Spielerzahl**
1. Hochstufen (mehr CPU/RAM) – in Minuten erledigt.
2. Statische Dateien entlasten: Spiel aus einem CDN oder weiter vom IONOS-Webspace, Server nur API.
3. Datenbank auslagern (eigener Server oder verwaltete Datenbank).
4. Rechenarbeit trennen: Nachspielen/Lösbarkeitsprüfung auf einem Arbeits-Server, Mehrspieler-Räume
   auf weiteren Servern; ab hier ggf. IONOS-Cloud-Server mit flexiblen Ressourcen (Bedingungen
   vorher prüfen).

## 9. Komplettumzug auf den eigenen Server (entschieden 13.11.2026)

**Erledigt am 13.11.2026:** `murmel.games` und `www.murmel.games` zeigen per A-Eintrag (TTL 5 min)
auf den VPS `85.215.139.111`; IPv6-Einträge entfernt (der VPS hat keine IPv6). Caddy liefert beide
Namen mit Let's-Encrypt-Zertifikat aus, `www` leitet auf `murmel.games` um. Mail-Einträge (MX, SPF,
DKIM, DMARC) unverändert. Der Server rollt jeden grünen Commit auf `main` selbst aus
(`murmel-update.timer`); GitHub Actions spielt das Spiel weiterhin zusätzlich auf den IONOS-Webspace,
der damit aktuell bleibt.

**Rückweg auf den Webspace (Notbetrieb, von Hand):** IONOS → Domains & SSL → murmel.games →
„Verwendungsart anpassen“ → Webspace `/murmel-games`. Das stellt die alten Einträge
(A `217.160.0.80`, AAAA `2001:8d8:100f:f000::2ef`) wieder her; wirksam nach höchstens 5 min.
Eine automatische Umschaltung (Zeuge) ist noch nicht gebaut.

Statt Spiel auf IONOS + API auf dem VPS liegt **alles auf dem eigenen Server**; der IONOS-Webspace
bleibt als **statischer Notbetrieb** (wie beim WH-Website-Notbetrieb: fällt der Server aus, liefert
IONOS das Spiel weiter, nur Konto-Funktionen pausieren).

```
murmel.games ──► eigener VPS: Reverse-Proxy ─┬─ Spiel (statische Dateien)
                                             ├─ /api  (Konten, Zeiten, Levels)
                                             └─ /ws   (Mehrspieler)
        Ausfall ──► IONOS-Webspace (statische Kopie, offline-fähiges Spiel)
```

**Vorteile**
- Spiel und API unter **derselben Adresse**: keine Freigaben zwischen Domains (CORS), einfache und
  sichere Anmelde-Cookies, der Service Worker kann auch Kontodaten zwischenspeichern.
- **Saubere Versionen:** jede Version wird auf einmal live (statt Datei für Datei per SFTP), Rückweg
  mit einem Befehl.
- **Volle Kontrolle über die Auslieferung:** Brotli, HTTP/3, genaue Cache-Regeln, strenge
  Sicherheitsheader (CSP), COOP/COEP für schnellere WebAssembly-Rechnung mit mehreren Kernen.
- **Dauerverbindungen (WebSockets)** für Mehrspieler und Live-Funktionen.
- **Vom Server erzeugte Inhalte**, z. B. eine Seite je Level mit Vorschaubild.

**Nachteile:** eigener Betrieb (Updates, Sicherheit, Backups, Überwachung); ohne Notbetrieb wäre ein
Serverausfall ein Totalausfall. Der Umzug selbst braucht eine DNS-Umstellung (nur auf ausdrücklichen
Auftrag) und eine Umschaltung wie beim WH-Notbetrieb (Zeuge/Prüfung, die bei Ausfall auf IONOS zeigt).

## 10. Größere Vorhaben, die ein eigener Server ermöglicht

| Vorhaben (id) | Inhalt | Grundlage |
|---|---|---|
| `geister` | Gegen den eigenen oder den besten Lauf als durchscheinende Murmel spielen; fremde Lösungen ansehen | Eingabeaufzeichnung (`bestenliste`) |
| `tipps` | Bei langem Hängen den nächsten Schritt aus einer gespeicherten Lösung zeigen | gespeicherte Lösungen |
| `loesbarkeit` | Jede Nacht alle ~1300 Levels mit gespeicherten Lösungen ohne Grafik nachspielen; meldet, wenn eine Änderung ein Level unlösbar macht | Nachspielen im Server, Lösungen |
| `wettkampf` | Mehrspieler mit Server als Schiedsrichter: mehr als zwei Spieler, Zuschauer, Wettrennen im selben Level | `mehrspieler`, Physik im Server |
| `tageslevel` | Tageslevel und Wochenaufgabe mit eigener Rangliste, Erinnerung per Push | `bestenliste`, Web Push |
| `levelseiten` | Eine Seite je Level mit Vorschaubild, Beschreibung, Bestzeit – Einstiege über Suchmaschinen | Server-Rendering |
| `enigma-upload` | Spieler laden eine Enigma-Leveldatei hoch, der Server wandelt sie mit dem Importer um | `tools/import-enigma.mjs` |
| `auswertung` | Datensparsam, ohne Fremdanbieter: wo Spieler scheitern oder abbrechen → bessere Reihenfolge und Schwierigkeit der Pakete (Datenschutzerklärung anpassen) | eigene Protokolle |
| `cloudstand` | Spielstand mitten im Level in der Cloud, auf einem anderen Gerät weiterspielen | `sync`, Spielstand-Format |

Größter Nutzen zuerst: **`loesbarkeit`** (löst das größte offene Qualitätsproblem: heute wird nur
geprüft, ob Levels laden) und **`geister`** – beide bauen auf der Eingabeaufzeichnung auf, die für
die Bestenlisten ohnehin entsteht.

## 11. Entscheidungen und offene Fragen

**Entschieden (Nutzer, 13.11.2026)**
- Große Version mit eigenem Server, Komplettumzug mit IONOS-Webspace als Notbetrieb (Abschnitt 9).
- Anbieter: **IONOS-VPS**, Start 2 vCPU / 4 GB / 80–120 GB NVMe (Abschnitt 8.1).
- Anmeldung: **Mail-Link + Passkey, zusätzlich Google, Apple und GitHub**.
- Spieler-Levels: **automatisch sichtbar**, wenn vom Autor gelöst; gemeldete Levels werden
  ausgeblendet und vom Nutzer geprüft.
- Alle Vorhaben aus Abschnitt 10 gehören zur großen Version (Reihenfolge Abschnitt 3).
- Datenbank: PostgreSQL (Vorschlag übernommen, da die große Version gesetzt ist).

**Noch offen**
1. **Bauphasen** aus Abschnitt 3 freigeben (Phase A beginnt ohne Server)?
2. **Mailversand** für Login-Links: über das IONOS-Postfach von murmel.games (Vorschlag für den
   Start) oder einen Versanddienst?
3. **VPS-Bestellung** bei IONOS macht der Nutzer selbst (Kauf); danach SSH-Schlüssel für den Deploy.
4. **DNS-Umstellung** von `murmel.games` auf den Server erst auf ausdrücklichen Auftrag.
5. **Fremdanmeldung:** Für Apple ist ein kostenpflichtiges Apple-Developer-Konto nötig (das von
   WH-Control nutzen oder ein eigenes?); Google und GitHub brauchen je eine eigene App-Anmeldung.

## 12. Grenzen (für alle Bausteine)

- **Immer:** Spiel bleibt ohne Konto und offline voll spielbar; Tests vor jedem Commit; jede
  Server-Änderung mit Rückweg.
- **Erst fragen:** DNS-Einträge, neue kostenpflichtige Dienste, Datenbankschema-Änderungen nach
  dem Start, Änderungen an der Datenschutzerklärung.
- **Nie:** Passwörter speichern, Tracking/Werbung, Geheimnisse im Repo, Spielerdaten außerhalb der EU.
