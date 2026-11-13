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
| Google, Apple, GitHub | Stufe 2 (unten). `AccountStore.signIn({ provider, subject, email }, role)` findet das Konto über `account_identities`, sonst über die bestätigte Adresse (verknüpft), sonst legt es an. |

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
| `GET /api/konto` | `{ angemeldet, mail, anbieter, konto? }`; `mail: false` = SMTP nicht eingerichtet; `anbieter` = aktive Anbieter; `konto.anmeldewege` = verbundene Wege |
| `POST /api/konto/mail` `{ email }` | Link schicken (202; 503 ohne SMTP; 429 bei Begrenzung) |
| `POST /api/konto/mail/einloesen` `{ token }` | Link einlösen, setzt das Cookie |
| `POST /api/konto/passkey/registrieren` (+ `/abschliessen`) | Passkey hinzufügen (angemeldet) |
| `POST /api/konto/passkey/anmelden` (+ `/abschliessen`) | Mit Passkey anmelden |
| `DELETE /api/konto/passkey/:id` | Passkey entfernen (409, wenn es der letzte Anmeldeweg ist) |
| `GET /api/konto/{google,apple,github}/start` | Anmelden bzw. verbinden beim Anbieter (Stufe 2) |
| `GET …/google/zurueck`, `GET …/github/zurueck`, `POST …/apple/zurueck` | Rücksprung vom Anbieter |
| `POST /api/konto/anbieter/abschliessen` `{ vorgang }` | Anmeldung bzw. Verbindung abschließen |
| `POST /api/konto/anbieter/trennen` `{ anbieter, kennung }` | Anmeldeweg trennen (nie den letzten) |
| `POST /api/konto/abmelden` `{ alle? }` | Abmelden (hier oder überall) |
| `DELETE /api/konto` | Konto löschen |

## Betrieb

`/opt/murmel/.env`: `ADMIN_EMAILS`, `SMTP_HOST`, `SMTP_PORT` (587 = STARTTLS, Standard; 465 = TLS),
`SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, optional `PUBLIC_ORIGIN` (Standard `https://murmel.games`).
Ohne SMTP-Werte startet die API normal; die Anmeldung per Mail meldet dann „nicht eingerichtet“.

## Stufe 2: Anmeldung mit Google, Apple, GitHub

Stand 13.11.2026. Nutzerentscheidung: zusätzlich zu Mail-Link und Passkey; Apple über das
Apple-Developer-Konto von WH-Control. Code: `server/src/anbieter.ts`, Oberfläche `src/konto-ui.ts`.

### Anbieter

| Anbieter | Verfahren | Kennung (`subject`) | Mailadresse |
|---|---|---|---|
| Google | OpenID Connect, Authorization Code + PKCE (S256), `state`, `nonce`; Scopes `openid email profile` | `sub` aus dem ID-Token | `email`, nur mit `email_verified` |
| GitHub | OAuth Web Flow + PKCE, `state`; Scope `user:email` | numerische GitHub-ID (`/user`) | `/user/emails`: nur `primary` und `verified` |
| Apple | Sign in with Apple (Web), `response_mode=form_post`, `state`, `nonce`; Scopes `name email` | `sub` aus dem ID-Token | `email` mit `email_verified`, ggf. Relay-Adresse (`…@privaterelay.appleid.com`) |

- **ID-Token (Google, Apple)** wird immer geprüft: nur `RS256`, Signatur über die JWKS des Anbieters
  (Schlüssel 1 h zwischengespeichert, unbekannte `kid` lädt höchstens einmal je Minute neu), `iss`,
  `aud` = eigene Client-ID, `exp`/`iat` (60 s Toleranz), `nonce`.
- **Apple Client Secret:** ES256-JWT (`iss` Team-ID, `sub` Services ID, `aud` `https://appleid.apple.com`,
  5 min gültig), bei jedem Tausch neu aus `APPLE_TEAM_ID`, `APPLE_KEY_ID` und der `.p8`-Datei erzeugt.
- Den Namen, den Apple nur beim ersten Mal mitschickt, speichert Murmel nicht.

### Ablauf

1. `GET /api/konto/<anbieter>/start` legt einen Vorgang an (`state`, PKCE-Verifier, `nonce`, 10 min,
   im Arbeitsspeicher der API) und setzt das Bindungs-Cookie `__Host-murmel-anbieter` (zufällig,
   `HttpOnly; Secure; SameSite=None; Path=/`, 10 min). `SameSite=None`, weil Apple per POST von
   `appleid.apple.com` zurückkommt; das Sitzungs-Cookie bleibt `Strict`. Ist man angemeldet, merkt sich
   der Vorgang das Konto: Der neue Weg wird dann **verbunden** statt angemeldet.
2. Rücksprung `…/google/zurueck`, `…/github/zurueck` (GET) bzw. `…/apple/zurueck` (POST, Formular):
   `state` muss zu einem offenen Vorgang desselben Anbieters gehören **und** zum Bindungs-Cookie
   passen (sonst „abgelaufen“). Dann Code tauschen, Token bzw. Adresse prüfen. Gespeichert wird kein
   Token des Anbieters. Ergebnis ist ein einmaliger Abschlusswert (2 min), die API leitet auf
   `/#anbieter=<wert>` um; Fehler auf `/#anbieter-fehler=<grund>`.
3. Die Seite schickt `POST /api/konto/anbieter/abschliessen { vorgang }` (gleiche Herkunft, Bindungs-Cookie
   muss wieder passen). Erst hier wird angemeldet (`AccountStore.signIn`) bzw. verbunden
   (`linkIdentity`) und das Sitzungs-Cookie gesetzt – in einer normalen Anfrage derselben Seite, damit
   `SameSite=Strict` in allen Browsern sicher gesetzt wird.

- **CSRF:** Die Herkunftsprüfung lässt nur `POST /api/konto/apple/zurueck` von fremder Herkunft zu;
  dieser Weg ist über `state`, Bindungs-Cookie und `nonce` abgesichert und ändert selbst nichts am Konto.
- **Begrenzung:** 10 Starts je IP und 15 min (wie beim Mail-Link je IP), übrige Schritte über die
  allgemeine Grenze von 60 Konto-Anfragen.
- **Konten:** gefunden über `account_identities`, sonst über die bestätigte Adresse (verknüpft), sonst
  neu. Je Anmeldeweg werden Anbieter, Kennung, Mailadresse und Zeitpunkt gespeichert
  (Migration `012_anmeldewege.sql`: Spalte `email`). Die Admin-Rolle folgt weiter `ADMIN_EMAILS`
  (Adresse des Kontos).
- **Verbinden und trennen:** Die Kontoseite zeigt die Anmeldewege (Mail, Google, Apple, GitHub) und bietet
  „Mit … verbinden“ für die übrigen an. Ein Weg, der schon zu einem anderen Konto gehört, wird nicht
  umgehängt. Trennen (`POST /api/konto/anbieter/trennen { anbieter, kennung }`) und Passkey entfernen
  gehen nur, solange danach noch mindestens ein Anmeldeweg (Anbieter, Mail oder Passkey) bleibt (409).
  Der Mail-Link funktioniert unabhängig davon für die Kontoadresse.
- **Konfiguration:** `/opt/murmel/.env` → `compose.yml`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `APPLE_SERVICES_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`; der
  Schlüssel `/opt/murmel/apple-signin.p8` schreibgeschützt unter `/run/murmel/apple-signin.p8`
  (fehlt die Datei, hängt `release.sh` `/dev/null` ein). Fehlt ein Wert, ist der Anbieter aus: kein Knopf,
  seine Routen antworten 404. `GET /api/konto` meldet `anbieter: ['google', …]` (die aktiven).
- Rücksprung-Adressen: `https://murmel.games/api/konto/{google,github,apple}/zurueck`.

## Tests

`server/src/anbieter.test.ts` prüft alle drei Anbieter gegen nachgebaute Endpunkte (eigene RSA-Schlüssel
und JWKS): falsches `aud`/`iss`/`nonce`, abgelaufenes Token, fremde Signatur, `state` und Bindungs-Cookie,
Verknüpfen über die Adresse, Admin-Rolle, Verbinden, Trennen und den letzten Anmeldeweg – mit Speicher-Store
und über `TEST_DATABASE_URL` gegen PostgreSQL.

`server/src/konten.test.ts` läuft dieselben Abläufe gegen einen Speicher-Store und – mit
`TEST_DATABASE_URL`, in der CI mit PostgreSQL-Dienst – gegen die echte Datenbank. Passkeys werden
mit einem Software-Authenticator (`soft-authenticator.ts`, ES256) geprüft. Spielteil: `src/konto.test.ts`.
