# Baustein `konten` – Stufe 1: Mail-Link, Passkey, Admin

Stand 13.11.2026. Grundlage: `docs/SERVER.md` Abschnitte 4 und 12.

## Ziel

Freiwilliges Konto ohne Passwort. Das Spiel bleibt ohne Konto und offline voll spielbar; fehlt die
API (Notbetrieb auf IONOS, offline), meldet der Kontodialog „gerade nicht erreichbar“.

## Anmeldewege

| Weg | Ablauf |
|---|---|
| Mail-Link | Adresse eingeben → Mail mit `https://murmel.games/#anmelden=<token>` → Seite öffnet „Jetzt anmelden“ (ein Klick, damit Mail-Scanner den Link nicht verbrauchen) → Sitzung. Legt beim ersten Mal das Konto an. Ist zugleich der Weg für „Passwort vergessen“. |
| Passkey | Nach dem ersten Login bietet die Kontoseite „Passkey einrichten“ an (WebAuthn, auffindbarer Schlüssel). Danach „Mit Passkey anmelden“ ohne Adresse. |
| Google, Apple, GitHub | Stufe 2. Schnittstelle steht: `AccountStore.signIn({ provider, subject, email }, role)` findet das Konto über `account_identities`, sonst über die bestätigte Adresse (verknüpft), sonst legt es an. |

## Regeln

- **Keine Passwörter.** Login-Links, Sitzungen und WebAuthn-Vorgänge liegen nur als SHA-256 in der DB.
- Login-Link: 15 Minuten, einmal einlösbar (ein `update … returning`).
- Sitzung: Cookie `__Host-murmel`, `HttpOnly; Secure; SameSite=Strict; Path=/`, 90 Tage;
  „Abmelden“ und „Überall abmelden“.
- Begrenzung: 5 Mail-Links je IP und 15 min, 3 je Adresse und Stunde, 60 Konto-Anfragen je IP und 15 min.
- CSRF: ändernde Anfragen mit fremdem `Origin` → 403 (dazu SameSite=Strict).
- Konto löschen: sofort, mit Sitzungen, Passkeys, Anmeldewegen und offenen Links.
- Sperre (`accounts.blocked_at`, für das Forum): gesperrte Konten können sich anmelden, abmelden und
  ihr Konto löschen, aber nicht schreiben. Für spätere Endpunkte: `requireAccount` (angemeldet, nicht
  gesperrt), `requireAdmin`, `requireSignedIn` (auch gesperrt) aus `server/src/konten.ts`; `req.account`
  ist auf allen `/api`-Pfaden gesetzt. Endpunkte zum Sperren baut das Forum (`AccountStore.setBlocked`).
- Admin: Adressen in `ADMIN_EMAILS` (`/opt/murmel/.env`, nicht im Repo). Die Rolle wird bei jeder
  Anmeldung gesetzt oder entzogen. `GET /api/admin/uebersicht` (Kontenzahlen) nur für Admins.
  Statistik für Admins ohne `STATS_TOKEN`: nach dem Zusammenführen mit `statistik`.

## Schnittstelle (`/api/konto`)

| Methode, Pfad | Zweck |
|---|---|
| `GET /api/konto` | `{ angemeldet, mail, konto? }`; `mail: false` = SMTP nicht eingerichtet |
| `POST /api/konto/mail` `{ email }` | Link schicken (202; 503 ohne SMTP; 429 bei Begrenzung) |
| `POST /api/konto/mail/einloesen` `{ token }` | Link einlösen, setzt das Cookie |
| `POST /api/konto/passkey/registrieren` (+ `/abschliessen`) | Passkey hinzufügen (angemeldet) |
| `POST /api/konto/passkey/anmelden` (+ `/abschliessen`) | Mit Passkey anmelden |
| `DELETE /api/konto/passkey/:id` | Passkey entfernen |
| `POST /api/konto/abmelden` `{ alle? }` | Abmelden (hier oder überall) |
| `DELETE /api/konto` | Konto löschen |

## Betrieb

`/opt/murmel/.env`: `ADMIN_EMAILS`, `SMTP_HOST`, `SMTP_PORT` (587 = STARTTLS, Standard; 465 = TLS),
`SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, optional `PUBLIC_ORIGIN` (Standard `https://murmel.games`).
Ohne SMTP-Werte startet die API normal; die Anmeldung per Mail meldet dann „nicht eingerichtet“.

## Tests

`server/src/konten.test.ts` läuft dieselben Abläufe gegen einen Speicher-Store und – mit
`TEST_DATABASE_URL`, in der CI mit PostgreSQL-Dienst – gegen die echte Datenbank. Passkeys werden
mit einem Software-Authenticator (`soft-authenticator.ts`, ES256) geprüft. Spielteil: `src/konto.test.ts`.
