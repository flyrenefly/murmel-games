# Server-Konzept: Konten, Bestenlisten, Spieler-Levels, Mehrspieler

Stand 13.11.2026, **Entwurf zur Freigabe**. Gebaut wird erst, wenn die Bausteine-Übersicht
(Abschnitt 3) und die offenen Fragen (Abschnitt 11) entschieden sind.

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

## 3. Bausteine-Übersicht (zur Freigabe)

| Baustein (id) | Aufgabe | Hängt ab von |
|---|---|---|
| `lokal` | Bestzeiten, Statistik, Fortschritt sichern/laden – nur im Browser | – |
| `api-basis` | Server, Datenbank, Sicherung, Überwachung, Deploy | – |
| `konten` | Anmeldung ohne Passwort, Profil, Konto löschen | `api-basis` |
| `sync` | Fortschritt und Bestzeiten geräteübergreifend abgleichen | `konten`, `lokal` |
| `bestenliste` | Zeiten je Level, Rangliste, Prüfung gegen Schummeln | `konten`, `lokal` |
| `editor` | Leveleditor im Browser, Teilen per Link | – |
| `spielerlevels` | Levels hochladen, suchen, spielen, bewerten, melden | `konten`, `editor` |
| `mehrspieler` | Zu zweit über WebRTC, Raum per Code | `api-basis` (Konto optional) |

Reihenfolge: `lokal` und `editor` (ohne Server, sofort möglich) → `api-basis` → `konten` →
`sync` + `bestenliste` → `spielerlevels` → `mehrspieler`.

Jeder Baustein bekommt vor dem Bau eine eigene Spezifikation (`docs/SPEC-<id>.md`).

## 4. Konten (`konten`)

- **Anmeldung ohne Passwort:** Login-Link per Mail; zusätzlich **Passkey** (Fingerabdruck/Face ID)
  für schnelles Anmelden. Murmel speichert keine Passwörter.
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

- **Server:** kleiner VPS (2 vCPU, 2–4 GB RAM), ca. 4–8 €/Monat. Eigener Server für Murmel,
  **getrennt von WH-Control** (Hobbyprojekt nicht auf Firmeninfrastruktur; siehe offene Fragen).
- **Deploy:** GitHub Actions baut ein Container-Image, Rollout per SSH; Rückweg = vorheriges Image.
- **Sicherung:** nächtlicher Datenbank-Dump, verschlüsselt außer Haus, Rücksicherung getestet.
- **Überwachung:** Erreichbarkeitsprüfung + Mail bei Ausfall.
- **Datenschutz:** Datenschutzerklärung um Konto, Mail, Bestenlisten, Spieler-Levels und
  Server-Protokolle erweitern; Auftragsverarbeitung mit VPS- und ggf. Mail-Anbieter; Daten nur in
  der EU; Protokolle ohne volle IP, 7 Tage.
- **Sicherheit:** Eingaben prüfen, Begrenzung der Anfragen je IP/Konto, Upload-Größen begrenzen,
  keine Geheimnisse im Repo (GitHub-Secrets).

## 9. Variante: alles auf den eigenen Server (Empfehlung, sobald `api-basis` kommt)

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

## 11. Offene Fragen (Entscheidung durch den Nutzer)

1. **Bausteine und Reihenfolge** aus Abschnitt 3 so freigeben? Oder erst `lokal` + `editor` ohne Server?
2. **Wo läuft der Server?** Eigener kleiner VPS (Vorschlag, z. B. netcup oder IONOS) oder auf
   vorhandener Infrastruktur?
3. **Anmeldung:** Mail-Link + Passkey (Vorschlag) – zusätzlich Anmelden mit Google/Apple/GitHub gewünscht?
4. **Mailversand:** über die IONOS-Adresse von murmel.games oder über einen Versanddienst?
5. **Moderation** der Spieler-Levels: von Hand freigeben oder nach Bewertungen automatisch?
6. **Datenbank:** PostgreSQL von Anfang an (Vorschlag) oder SQLite, bis es mehr Spieler gibt?
7. **Subdomain** `api.murmel.games` (DNS bei IONOS) – darf ich sie anlegen, wenn es so weit ist?
   (Entfällt bei der Variante aus Abschnitt 9: dann zeigt `murmel.games` selbst auf den Server.)
8. **Komplettumzug** (Abschnitt 9) mit IONOS als Notbetrieb – ja, sobald `api-basis` gebaut wird?
9. **Größere Vorhaben** (Abschnitt 10): welche davon, und `loesbarkeit` + `geister` zuerst?

## 12. Grenzen (für alle Bausteine)

- **Immer:** Spiel bleibt ohne Konto und offline voll spielbar; Tests vor jedem Commit; jede
  Server-Änderung mit Rückweg.
- **Erst fragen:** DNS-Einträge, neue kostenpflichtige Dienste, Datenbankschema-Änderungen nach
  dem Start, Änderungen an der Datenschutzerklärung.
- **Nie:** Passwörter speichern, Tracking/Werbung, Geheimnisse im Repo, Spielerdaten außerhalb der EU.
