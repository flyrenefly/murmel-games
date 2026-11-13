# Spezifikation: Zu zweit spielen (`mehrspieler`, Stufe 1)

Stand 13.11.2026. Planung: `docs/SERVER.md` Abschnitt 7. Entscheidungen des Nutzers (13.11.):
eigener TURN-Server (coturn) auf dem VPS, beide Spielarten (gemeinsam und Wettrennen), Verbindung
ausschließlich über TURN, damit Mitspieler die IP-Adresse des anderen nicht sehen. Stufe 2
(`wettkampf`, Server als Schiedsrichter) ist nicht Teil dieser Stufe.

## 1. Ziel

Zwei Spieler verbinden sich ohne Konto über einen **4-stelligen Raumcode** und spielen
entweder **gemeinsam** ein Zwei-Murmel-Level (jeder steuert seine Murmel) oder ein
**Wettrennen** (beide spielen dasselbe Level mit eigener Murmel, der andere ist als Geist zu
sehen, wer zuerst löst, gewinnt). Ohne Mehrspieler bleibt das Spiel unverändert, auch offline.

## 2. Ablauf

1. Spieler A wählt im Menü **„Zu zweit“ → „Raum öffnen“**, wählt Spielart und Level und bekommt
   einen Code (z. B. `4821`).
2. Spieler B wählt **„Zu zweit“ → „Beitreten“** und gibt den Code ein.
3. Der Server vermittelt über einen WebSocket (`/api/raum`) die WebRTC-Verbindungsdaten
   (SDP-Angebot/-Antwort, ICE-Kandidaten) und gibt beiden kurzlebige TURN-Zugangsdaten.
4. Die Browser bauen einen WebRTC-Datenkanal auf, **nur über unseren TURN-Server**
   (`iceTransportPolicy: 'relay'`). Danach läuft das Spiel über den Datenkanal; der WebSocket
   bleibt für Neuverbindungen offen.
5. Bricht die Verbindung ab, zeigen beide den Status und bieten **„Neu verbinden“** an
   (gleicher Raum, neue Aushandlung) oder „Verlassen“.

## 3. Server: Räume und Vermittlung (`server/src/raum.ts`)

- **WebSocket** `GET /api/raum` (Upgrade; Caddy leitet `/api/*` weiter, `reverse_proxy` reicht
  Upgrades durch). Paket `ws`, am HTTP-Server der API eingehängt. Nachrichten sind JSON, höchstens
  16 KB.
- **Nachrichten Browser → Server**
  - `{ t: 'oeffnen' }` – neuen Raum öffnen.
  - `{ t: 'beitreten', code: '1234' }` – Raum betreten.
  - `{ t: 'signal', data: … }` – an den Partner weiterreichen (SDP/ICE, auch Spielinfo vor der
    Verbindung, z. B. Level und Spielart).
- **Nachrichten Server → Browser**
  - `{ t: 'raum', code, rolle: 'gastgeber' | 'gast', turn: { urls, username, credential, ttl } | null }`
  - `{ t: 'partner', da: true | false }` – Partner ist da / weg.
  - `{ t: 'signal', data }` – vom Partner.
  - `{ t: 'fehler', grund }` – `code-unbekannt`, `raum-voll`, `zu-viele-raeume`,
    `zu-viele-versuche`, `ungueltig`.
- **Codes**: 4 Ziffern `0000`–`9999`, zufällig (`crypto.randomInt`), nie doppelt unter den offenen
  Räumen. Höchstens 2 Teilnehmer.
- **Verfall**: Räume ohne Aktivität (keine Nachricht) verfallen nach **30 min**; die Verbindungen
  werden geschlossen. Verlässt der Gastgeber den Raum, wird er geschlossen; verlässt der Gast ihn,
  bleibt der Raum offen (Wiederbeitritt).
- **Begrenzungen je IP** (im Speicher, ein API-Container):
  - höchstens **3 offene Räume** je IP;
  - höchstens **20 Beitrittsversuche je 10 min** je IP (gegen Code-Raten: 10 000 Codes);
  - höchstens **6 gleichzeitige WebSockets** je IP, insgesamt höchstens 2000 Räume;
  - höchstens 50 Nachrichten je 10 s je Verbindung (Signale sind wenige).
- **TURN-Zugangsdaten** (TURN-REST-Verfahren, coturn `use-auth-secret`):
  `username = <Ablaufzeit in Unix-Sekunden>:<zufällige Kennung>`,
  `credential = base64(HMAC-SHA1(TURN_SECRET, username))`, Gültigkeit **1 h**. Ausgegeben werden
  sie nur im Antwortpaket `raum`, also nur für einen offenen Raum. Ohne `TURN_SECRET` (lokale
  Entwicklung) ist `turn` `null`.
- **Datenschutz**: Keine Speicherung in der Datenbank. Die IP-Adresse wird nur im Speicher für die
  Begrenzungen gehalten und mit dem Fenster verworfen; SDP/ICE werden nur durchgereicht, nicht
  gespeichert und nicht geloggt.

## 4. TURN-Server (coturn)

- Dienst `turn` in `deploy/server/compose.yml`, Abbild `coturn/coturn`, `network_mode: host`
  (Relay-Ports ohne Docker-NAT, und ufw gilt – veröffentlichte Docker-Ports würden ufw umgehen).
- Konfiguration `deploy/server/turnserver.conf` (im Repo, ohne Geheimnis); das Geheimnis kommt aus
  `/opt/murmel/.env` (`TURN_SECRET`) und wird beim Start in eine Datei im Container geschrieben
  (nicht auf der Kommandozeile).
- **Nur Relay, gehärtet**: `use-auth-secret`, `realm`, kein TLS-Port, `no-cli`, `no-multicast-peers`,
  `denied-peer-ip` für 0.0.0.0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.168/16,
  198.18/15, 224/4, 240/4 und IPv6-Pendants; `no-tcp-relay`; `user-quota=4`, `total-quota=200`,
  `max-bps=96000` (Bytes/s je Sitzung), `bps-capacity=8000000`.
- **Logs**: keine (`log-file=/dev/null`, `no-stdout-log`), also keine IP-Adressen.
- **Ports**: 3478/udp und 3478/tcp, Relay **49160–49200/udp**. In ufw mit Kommentar `turn`.
- **API-Umgebung**: `TURN_SECRET`, `TURN_URLS` (Standard
  `turn:<SITE_ADDRESS>:3478?transport=udp,turn:<SITE_ADDRESS>:3478?transport=tcp`).
- **Rückweg**: `docker compose stop turn && docker compose rm -f turn`;
  `sudo ufw delete allow 3478/udp`, `… 3478/tcp`, `… 49160:49200/udp`; im Spiel erscheint dann
  „Verbindung nicht möglich“. Siehe `docs/SERVER.md` (Betrieb).

## 5. Spiel (Browser, `src/mehrspieler/`)

### 5.1 Verbindung (`verbindung.ts`)
- `RTCPeerConnection({ iceServers: [unser TURN], iceTransportPolicy: 'relay' })`, ein Datenkanal
  `murmel` (geordnet, zuverlässig). Der Gastgeber erstellt das Angebot.
- **Ohne TURN** (Server liefert `turn: null`): Im gebauten Spiel keine Verbindung (Meldung). Im
  Dev-Server (`import.meta.env.DEV`) wird ersatzweise `iceTransportPolicy: 'all'` ohne Server
  verwendet – nur für lokale Tests (zwei Tabs auf einem Rechner).
- Status: `getrennt`, `warte-auf-partner`, `verbinde`, `verbunden`, `abgebrochen`.

### 5.2 Nachrichtenformat (`nachrichten.ts`, Version 1)
JSON auf dem Datenkanal, jede Nachricht `{ v: 1, t, … }`, geprüft mit `parseNachricht` (unbekannte
oder kaputte Nachrichten werden verworfen):
- `hallo { name? }`, `start { art: 'gemeinsam' | 'rennen', pack, index, levelId, seed }`
- **Gemeinsam**: `eingabe { seq, fx, fy, ax, ay, aktionen[] }` (Gast → Gastgeber, je Bild);
  `schritte { ab, s: [[fx0,fy0,ax0,ay0,fx1,fy1,ax1,ay1, aktion?]…], m: Murmelzustand[], ende? }`
  (Gastgeber → Gast, **25-mal pro Sekunde**).
- **Wettrennen**: `stand { x, y, farbe, schritte }` (≈ 15/s), `ziel { schritte }`, `aufgabe`.
- `neustart`, `tschuess`.

### 5.3 Gemeinsam (Gastgeber rechnet)
- Gleichzeitige Steuerung: `PhysicsWorld.coop` gibt jedem Spieler eine eigene Maus- und
  Tastenkraft – Spieler 1 (Gastgeber) die schwarzen Murmeln und Perlen, Spieler 2 (Gast) die
  weißen. Yin-Yang-Wechsel ist im gemeinsamen Spiel aus; jede Aktion (benutzen, ablegen,
  drehen) gilt dem Inventar ihres Spielers. Ohne `coop` ist die Physik unverändert.
- Der **Gastgeber** rechnet mit `GameSession` (`coopStep(host, gast)`). Er nimmt je Schritt die
  letzte Eingabe des Gasts.
- Der **Gast** bekommt 25-mal pro Sekunde den Zustand: die Eingaben aller Schritte seit der
  letzten Nachricht und den Murmelzustand (Position, Geschwindigkeit) am Ende. Er führt die
  Schritte mit seiner eigenen `GameSession` (gleicher Startwert) nach – so folgt das Spielfeld
  (Türen, Steine, Oxyd) – und setzt danach die Murmeln auf den Zustand des Gastgebers (Korrektur
  gegen Rundungsunterschiede zwischen Browsern). **Glättung**: Der Gast spielt die empfangenen
  Schritte im Takt der Physik mit einem Puffer von etwa einer Nachricht (≈ 40 ms) ab und
  interpoliert wie im Einzelspiel zwischen zwei Physikständen; wächst der Puffer, holt er
  schneller auf.
- Levels: alle Levels mit einer steuerbaren weißen Murmel (Enigma-Netzwerk-Levels, z. B. „Bridge
  Builders“, „Teamwork“). Die Liste filtert danach.
- Gewinnen: Der Gastgeber meldet `ende`; beide sehen „Geschafft!“. Fortschritt und Bestzeiten
  werden im gemeinsamen Spiel nicht gezählt (keine gültige Aufzeichnung).

### 5.4 Wettrennen
- Beide laden dasselbe Level mit demselben Startwert (`seed` aus `start`) und rechnen selbst.
- Jeder sendet ≈ 15-mal pro Sekunde seine Position; der andere sieht sie als halbdurchsichtigen
  **Geist** (Murmel in der Farbe des Partners, im klassischen Stil und in 3D).
- Wer löst, sendet `ziel { schritte }`. **Sieger ist, wer in weniger Spielzeit löst**
  (Physikschritte seit „los“, beide starten im selben Moment). Das ergibt auf beiden Seiten dasselbe
  Ergebnis, auch wenn sich Nachrichten kreuzen. Entschieden ist es, sobald beide im Ziel sind oder die
  Spielzeit des anderen die eigene Zielzeit überschreitet. Neustart im Rennen: gleiches Level, gleicher
  Startwert, die Uhr läuft weiter.
- Mehrspieler-Läufe zählen nicht in Fortschritt, Bestzeiten und Lösungsstatistik (keine gültige
  Einzelspiel-Aufzeichnung).

### 5.4a Grenzen der Stufe 1
- Rechnet der Gastgeber in einem Hintergrund-Tab, steht das Spiel (Browser liefern dort keine
  Animationsbilder).
- Die Aufhebesperre (Maustaste gedrückt) gilt nur für den Gastgeber.
- Nach einem Neuverbinden beginnt das Level im gemeinsamen Spiel neu.

### 5.5 Oberfläche
- Startmenü: neuer Knopf **„Zu zweit“** → Dialog mit „Raum öffnen“ / „Beitreten“.
  - Öffnen: Spielart (Segmente „Gemeinsam“ / „Wettrennen“), Level (Gemeinsam: Liste der
    Zwei-Murmel-Levels; Wettrennen: aktuelles Level), dann großer Code in Ziffern mit
    Abstand, Statuszeile „Warte auf Mitspieler …“.
  - Beitreten: ein Feld mit `inputmode="numeric"`, 4 Ziffern, Fehler direkt darunter.
- Während des Spiels: kleine **Statusmarke** oben („Zu zweit · verbunden“, Punkt grün/gelb/rot).
- Abbruch: Pause mit „Verbindung verloren“, Knöpfe **„Neu verbinden“** und „Allein weiter“.
- Gestaltung nach dem Skill `apple-design`: klare Hierarchie, große Treffflächen (≥ 44 px),
  Status nie nur über Farbe, `prefers-reduced-motion` respektiert, Tastatur bedienbar.

### 5.6 Einbindung in `main.ts`
Möglichst klein: ein Knopf im Startmenü, ein Haken in der Spielschleife (`frame`) für das
Schrittrechnen im gemeinsamen Spiel, Kamera auf die eigene Murmel, Geist in den Akteuren,
`onWin` meldet an das Modul. Der Rest liegt in `src/mehrspieler/`.

## 6. Tests
- `server/src/raum.test.ts` (`node --test`): Codes (4 Ziffern, eindeutig), Öffnen/Beitreten,
  Raum voll, Verfall nach 30 min, Begrenzungen je IP, Weiterreichen von Signalen, TURN-HMAC gegen
  einen festen Prüfwert, WebSocket-Ende-zu-Ende gegen die echte App.
- `src/mehrspieler/*.test.ts` (vitest): Nachrichtenformat (gültig/ungültig), Zustandsübertragung
  (Gastgeber und Gast rechnen ein Zwei-Murmel-Level, der Gast folgt), Glättungspuffer,
  Koop-Physik (zwei Kräfte gleichzeitig; ohne `coop` unverändert).
- Ende-zu-Ende `tools/e2e-mehrspieler.mjs`: Dev-Server auf Port **5182** mit lokaler API, zwei
  Browser-Tabs: Raum öffnen, beitreten, verbinden, Gast bewegt Murmel. Lokal ohne coturn läuft
  das im Dev-Modus mit `iceTransportPolicy: 'all'` (siehe 5.1).
- Nach dem Rollout: live mit zwei Tabs über TURN prüfen (`chrome://webrtc-internals`: nur
  `relay`-Kandidaten).

## 7. Datenschutz
Neuer Abschnitt „Zu zweit spielen“ in `datenschutz.html` – **nur nach Freigabe durch den Nutzer**.
Entwurf im Abschlussbericht.

## 8. Nicht in Stufe 1
Mehr als zwei Spieler, Chat, Schiedsrichter auf dem Server (`wettkampf`), Ranglisten für
Wettrennen, Zuschauer.
