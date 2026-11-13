# Spec: `webpush` – Erinnerung an das Tageslevel

Baustein T4 aus `docs/SPEC-tageslevel.md`. Stand 13.11.2026, Branch `web-push`.

**Geprüft:** `node --test` (Verschlüsselung bytegenau gegen das Beispiel aus RFC 8291, VAPID-Signatur,
Routen, Versand mit 404/410, einmal je Zeitraum; PostgreSQL-Teil in der CI), vitest (Erkennung inkl.
iPhone/iPad, Erlaubnis vor Abo, Abmelden, Schlüsselwechsel), Build mit `push`/`notificationclick` in
`sw.js`, Vorschau im Browser mit nachgebildeter API (Zeile „Erinnerung“, Karte, verweigerte Erlaubnis).
**Nicht geprüft:** echte Zustellung über FCM, Mozilla und Apple (braucht Schlüssel auf dem Server).
Datenschutztext: Entwurf liegt bei der Koordination, Freigabe offen.

## Ziel

Wer möchte, bekommt eine Mitteilung, sobald um Mitternacht (Berliner Zeit) ein neues Tageslevel
bereitsteht, auf Wunsch auch montags für die neue Wochenaufgabe. Das geht ohne Konto: ein Abo gilt für
einen Browser. Ohne Erinnerung, ohne Konto und offline bleibt das Spiel unverändert.

## Was gespeichert wird (Migration `013_webpush.sql`)

Nur, was der Versand braucht: Endpoint (die Adresse beim Push-Dienst des Browsers), die zwei Schlüssel
des Abos (`p256dh`, `auth`), die Auswahl (Tag, Woche) und die Anlegezeit. **Keine** IP-Adresse, kein
Konto, kein Gerätename. Dazu eine Tabelle der schon verschickten Zeiträume (`art`, `zeitraum`), damit
ein Neustart nicht doppelt schickt.

- **Abmelden** löscht die Zeile sofort.
- Antwortet der Push-Dienst mit **404 oder 410**, ist das Abo erloschen: Die Zeile wird gelöscht.
- Abos ohne Auswahl gibt es nicht (beides aus = abmelden).

## API

| Methode | Pfad | Inhalt |
|---|---|---|
| GET | `/api/push` | `{ schluessel }` (öffentlicher VAPID-Schlüssel), ohne Schlüssel 404 |
| POST | `/api/push/abo` | `{ endpoint, keys: { p256dh, auth }, tag, woche }` → 204; legt an oder ändert die Auswahl |
| DELETE | `/api/push/abo` | `{ endpoint }` → 204, auch wenn es das Abo nicht gab |

- Ohne VAPID-Schlüssel gibt es die Routen nicht (404); das Spiel zeigt dann keinen Schalter.
- Schreiben nur von der eigenen Seite (Origin-Prüfung wie bei den anderen Schreibrouten).
- **Endpoint nur bei bekannten Push-Diensten** (https; Google FCM, Mozilla, Apple, Microsoft WNS),
  sonst 400. Der Server schickt an diese Adresse – ohne Liste könnte jemand ihn an beliebige Ziele
  (auch interne) Anfragen senden lassen.
- Grenzen: Endpoint höchstens 1 KB, Schlüssel in fester Länge (65 bzw. 16 Byte); 20 Schreibzugriffe je
  IP und Stunde (nur im Speicher, wie die anderen Grenzen); höchstens 100 000 Abos insgesamt.

## Versand

- **Zeitgeber in der API** (nicht systemd): Die API stellt sich einen Wecker auf die nächste Berliner
  Mitternacht (höchstens eine Stunde voraus, dann neu rechnen) und prüft beim Start einmal sofort.
  Gründe: Die API hat Datenbank, Levelkatalog (Titel des Tageslevels) und Schlüssel schon; es braucht
  keinen neuen Container, kein neues Skript und keine Installation als root. Ein systemd-Timer müsste
  von Hand installiert werden, und `update.sh` (das sich beim Rollout selbst ersetzt) müsste ein neues
  Skript mitkopieren. Es läuft genau ein API-Container, also schickt nur einer.
- **Einmal je Zeitraum:** Vor dem Versand trägt die API `(art, zeitraum)` ein (`on conflict do nothing`).
  Nur wer den Eintrag anlegt, schickt. Fiel die API um Mitternacht aus (Rollout), holt der Start das nach.
- Montags bekommt, wer beides gewählt hat, **eine** Mitteilung („Neues Tageslevel und neue Wochenaufgabe“).
- Text: Titel „Murmel“, Inhalt „Neues Tageslevel: *Titel*“ (ohne Levelkatalog ohne Titel). Ein Klick
  öffnet das Spiel mit `#tageslevel` und startet das Tageslevel.
- Technik: RFC 8030 (Push), RFC 8291 (Verschlüsselung `aes128gcm`), RFC 8292 (VAPID, ES256), mit
  `node:crypto` statt einer zusätzlichen Bibliothek; geprüft mit dem Beispiel aus RFC 8291.
  `TTL` bis zum Ende des Zeitraums, `Urgency: normal`, `Topic: tageslevel` (eine neuere Mitteilung
  ersetzt eine noch nicht zugestellte). Je Anfrage 10 s Zeitlimit, 10 gleichzeitig, kein Wiederholen.

## Schlüssel (`/opt/murmel/.env`)

`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (base64url, roh: 65 bzw. 32 Byte), `VAPID_SUBJECT`
(`mailto:…` oder `https://…`). Fehlt einer oder passen sie nicht zusammen, bleibt die Funktion aus
(Warnung im Protokoll ohne Werte). Erzeugen: `node src/webpush-schluessel.ts` im API-Image.

**Einschalten auf dem Server** (einmalig nach dem Merge, als Benutzer `murmel` in `/opt/murmel`):

1. `.env` sichern: `cp .env .env.bak-$(date +%Y%m%d-%H%M%S)-vor-webpush`
2. `umask 077; docker compose run --rm --no-deps -T api node src/webpush-schluessel.ts >> .env`
   (schreibt `VAPID_PUBLIC_KEY` und `VAPID_PRIVATE_KEY`; nichts davon anzeigen)
3. `echo 'VAPID_SUBJECT=mailto:<Kontaktadresse aus dem Impressum>' >> .env`
4. `docker compose up -d api`, dann im Protokoll prüfen: keine Warnung „VAPID … off“;
   `curl -s https://murmel.games/api/push` antwortet mit `{"schluessel":…}`.

**Rückweg:** die drei `VAPID_*`-Zeilen aus `.env` löschen und `docker compose up -d api`. Routen und
Schalter verschwinden; vorhandene Abos bleiben gespeichert, bekommen aber nichts mehr. Ganz löschen:
`delete from push_subscriptions;`. **Neue Schlüssel** machen alle Abos ungültig (die Browser müssen neu
abonnieren; das Spiel erkennt den neuen Schlüssel beim nächsten Laden und abonniert still neu, solange die Erlaubnis besteht).

## Oberfläche (Skill `apple-design`)

- In der Liste „Levelpakete“ unter „Heute“ und „Diese Woche“ eine Zeile **„Erinnerung“** mit Stand
  („Aus“, „Täglich“, „Täglich und Wochenaufgabe“). Sie erscheint nur, wenn der Server Push anbietet und
  der Browser es kann (oder auf iPhone/iPad außerhalb der Home-Bildschirm-App, siehe unten).
- Ein Klick öffnet die Karte „Erinnerung“ mit zwei Schaltern (Tageslevel, Wochenaufgabe) und einem
  Satz, wie es funktioniert. Die **Erlaubnis fragt der Browser erst nach dem Einschalten** eines
  Schalters, nie beim Laden.
- Erlaubnis verweigert: Hinweis, dass sie in den Browser-Einstellungen wieder erteilt werden kann.
- **iOS/iPadOS:** Web Push nur in der Home-Bildschirm-App (`navigator.standalone`). Im Browser zeigt die
  Karte: „Auf iPhone und iPad gibt es Erinnerungen nur, wenn Murmel zum Home-Bildschirm hinzugefügt ist:
  Teilen → Zum Home-Bildschirm.“
- Beim Laden gleicht das Spiel ein bestehendes Abo still mit dem Server ab (der Browser kann den
  Endpoint wechseln); die Auswahl merkt es sich lokal.

## Bausteine und Prüfung

| Stufe | Inhalt | Prüfung |
|---|---|---|
| W1 | `server/src/webpush.ts`: VAPID, Verschlüsselung, Versand, Routen, Zeitgeber; Stores DB/Speicher; Migration 013 | `node --test` (RFC-8291-Beispiel, VAPID-Signatur, Routen, Versand mit 404/410, einmal je Zeitraum), DB-Teil in der CI |
| W2 | Spiel: `src/webpush.ts`, Zeile und Karte, `#tageslevel`; Service Worker `push`, `notificationclick` | vitest |
| W3 | Datenschutz: Abschnitt „Erinnerung an das Tageslevel (Web Push)“ – **erst nach Freigabe** | – |

## Grenzen

- **Immer:** freiwillig, nur nach Klick; Spiel ohne Push voll spielbar; keine Werte der Schlüssel im Protokoll.
- **Erst fragen:** Datenschutztext; weitere Mitteilungsarten.
- **Nie:** Tracking über das Abo, Verknüpfung mit Konten, IP speichern.
