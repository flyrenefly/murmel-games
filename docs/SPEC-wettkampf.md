# Spezifikation: Wettkampf (`wettkampf`, Mehrspieler Stufe 2)

Stand 13.11.2026. Planung: `docs/SERVER.md` Abschnitte 3 und 7. Baut auf `mehrspieler` (Stufe 1,
`docs/SPEC-mehrspieler.md`) und `aufzeichnung` (`docs/SPEC-aufzeichnung.md`) auf. Stufe 1 bleibt
unverändert bestehen.

## 1. Ziel

Ein **Wettrennen für bis zu 4 Spieler plus Zuschauer** im selben Level, bei dem der **Server
Schiedsrichter** ist: Er rechnet jeden Lauf aus den Eingaben der Spieler selbst mit, und nur sein
Ergebnis zählt. Zuschauer sehen das Rennen live, ohne mitzuspielen. Kein Konto nötig, nichts wird
gespeichert. Ohne Server bleibt das Spiel unverändert, auch offline.

Erste Ausbaustufe (dieser Baustein): nur Wettrennen. Gemeinsames Lösen bleibt bei Stufe 1 (zu zweit,
WebRTC). Nicht dabei: Chat, frei wählbare Namen, Ranglisten über Räume hinweg, Wiederbeitritt in ein
laufendes Rennen.

## 2. Architektur-Entscheidung

### 2.1 Geprüfte Wege

| Weg | Wie | Urteil |
|---|---|---|
| A. Voll autoritativ | Browser schickt nur Eingaben, der Server rechnet und schickt den Zustand zurück; der Browser zeigt, was der Server rechnet | Jede Eingabe wirkt erst nach einer Netz-Runde (30–150 ms). Für ein Maus-Physikspiel spürbar träge; bräuchte Vorhersage plus Korrektur. |
| B. Prüfung am Ende | Browser rechnen allein, melden Positionen; am Ziel schickt jeder seine Aufzeichnung, der Server spielt sie nach | Billig, aber Mitspieler und Zuschauer sehen nur behauptete Positionen; Abweichungen fallen erst am Ende auf. |
| **C. Vorrechnen + Mitrechnen** | Jeder Browser rechnet seinen Lauf selbst (keine Eingabeverzögerung) und schickt die Eingaben **je Physikschritt** laufend an den Server. Der Server rechnet jeden Lauf mit genau diesen Eingaben **live** mit. Positionen, Zielzeiten und Platzierung kommen nur aus der Server-Rechnung. | **Gewählt.** |

### 2.2 Warum C

- **Kein Unterschied im Spielgefühl:** Im Wettrennen berühren sich die Murmeln nicht – jeder Lauf ist
  eine eigene Welt. Die Rechnung des Browsers ist darum keine Vorhersage, die korrigiert werden
  müsste: Mit gleichem Level, Startwert und Eingaben rechnen Browser und Server **bitgleich**
  (nachgewiesen für die Bestenliste, `aufzeichnung` A5).
- **Schiedsrichter:** Ziel, Zeit und Platz entscheidet der Server aus seiner Rechnung. Ein Browser kann
  weder Position noch Zielzeit behaupten. Meldet ein Browser „im Ziel“, ohne dass der Server dort
  ankommt, ist der Lauf `abweichung` (raus).
- **Zuschauer sehen die Wahrheit:** Die Murmeln aller Fahrer kommen aus der Server-Rechnung. Das
  Spielfeld des verfolgten Fahrers (Türen, Steine, Oxyd) rechnet der Zuschauer-Browser aus dessen
  Eingaben nach – wie ein Geist (`src/game/geist.ts`).
- **Tragbar auf dem VPS (2 vCPU, 4 GB):** gemessen 5–15 µs je Physikschritt für übliche Levels, bis
  160 µs für schwere (Enigma VIII, Pentomino). Bei 400 Schritten/s sind das 0,2–6 % eines Kerns je
  Fahrer. Grenzen in 2.4.
- **Bausteine vorhanden:** `GameSession`, Eingabeformat und Nachspielen aus `aufzeichnung`; der Server
  lädt den Spielcode der aktiven Version schon für die Bestenliste (`/game`, Kindprozess).

### 2.3 Transport

- **WebSocket `/api/wettkampf`** zur API (eigene Route neben `/api/raum`). Kein WebRTC, kein TURN: Der
  Server sitzt ohnehin in der Mitte. Die IP-Adresse eines Spielers sieht nur der Server, nie ein
  Mitspieler oder Zuschauer.
- Caddy: `handle /api/* { reverse_proxy api:3000 }` reicht WebSocket-Upgrades ohne Zusatz durch (wie
  bei `/api/raum`, live seit Stufe 1). Die CSP `connect-src 'self'` erlaubt `wss://` zum selben Host.
  **Keine Änderung am Caddyfile nötig.**
- Nachrichten sind JSON-Text, vom Browser höchstens 16 KB.

### 2.4 Rechnen auf dem Server

- Ein **Kindprozess** (`tools/lib/wettkampf-worker.mjs` aus dem Spielcode unter `GAME_DIR`, wie der
  Prüfprozess der Bestenliste) hält je Fahrer eine `GameSession`. Er läuft mit `nice 10`, die API hat
  Vorrang. Fehlt der Spielcode, ist der Wettkampf aus (Fehler `aus`), alles andere läuft.
- Die API sammelt die Eingaben und gibt sie **10-mal pro Sekunde** gebündelt an den Prozess; der
  antwortet je Fahrer mit Schrittzahl, Position, Farbe, Sieg (mit Zielschritt). Stürzt der Prozess ab,
  enden laufende Rennen ohne Wertung (`ergebnis` mit `abbruch`), der nächste Start startet ihn neu.
- **Grenzen:** höchstens **6 Rennen gleichzeitig** (24 Fahrer) und **40 Räume** insgesamt. Liegt die
  Rechenlast des Prozesses über 70 % eines Kerns (gleitend über 10 s), startet kein neues Rennen
  (`ausgelastet`). Laufende Rennen werden dann nur verzögert entschieden, nicht verfälscht: Die
  Wertung hängt an Spielschritten, nicht an der Uhrzeit des Servers.

## 3. Ablauf

1. Spieler A wählt **„Zu zweit“ → „Wettkampf“ → „Raum öffnen“**, wählt ein Level und bekommt einen
   **5-stelligen Code** (Stufe 1 hat 4 Stellen – so sind die Räume nicht zu verwechseln). A ist
   **Spielleiter**.
2. Andere wählen „Wettkampf“ → **„Mitfahren“** oder **„Zuschauen“** und geben den Code ein. Die
   Lobby zeigt Fahrer (Spieler 1–4, „du“) und die Zahl der Zuschauer.
3. Der Spielleiter drückt **„Start“** (ab 2 Fahrern). Der Server schickt `runde` (Level, Startwert);
   alle laden das Level und melden `bereit`. Sind alle bereit (spätestens nach 20 s; wer dann nicht
   bereit ist, setzt diese Runde aus), kommt `los` mit **3 s Countdown**.
4. Jeder spielt sein Level. Die anderen Fahrer sind als halbdurchsichtige **Geister** zu sehen; eine
   kleine Rangliste zeigt Zeit und Status aller.
5. Die Runde endet, wenn alle Fahrer im Ziel oder raus sind, oder nach **15 min** Spielzeit. Der Server
   schickt `ergebnis` mit Plätzen. Danach wählt der Spielleiter „Nochmal“ oder ein anderes Level.
6. Zuschauer folgen einem Fahrer (Tasten 1–4 oder Knöpfe), sehen sein Spielfeld, die anderen als
   Geister und die Rangliste.

## 4. Regeln des Schiedsrichters

- **Zeit** = Spielschritte seit `los`, über Neustarts hinweg (wie Stufe 1: Neustart = gleiches Level,
  gleicher Startwert, die Uhr läuft weiter). **Platz** nach Zielzeit aufsteigend; gleiche Zeit = gleicher Platz.
- **Ziel** zählt erst, wenn der Server-Lauf gewinnt. Der Browser meldet `ziel { schritte }`; kommt der
  Server bei allen Eingaben bis dorthin nicht ins Ziel, ist der Fahrer `abweichung`.
- **Schritt mit der Uhr:** Ein Fahrer darf nicht mehr Schritte schicken, als seit `los` Zeit vergangen
  ist (+1 s Spielraum) → sonst `zu-schnell` (raus). Liegt er mehr als **20 s** hinter der Uhr (z. B.
  Tab im Hintergrund), ist er `zu-langsam` (raus). Der Browser holt kleine Rückstände selbst auf
  (Schritte ohne Eingabe, nach dem Wechsel zurück in den Tab), damit Zeitlupe kein Vorteil ist.
- **Neustart:** Eintrag `[1, "restart"]` im Eingabestrom. Der Server beginnt den Lauf neu; Extraleben
  nimmt er mit, wenn sein eigener Lauf das verlangt (`restartRequested === 'keep'`), wie die Hülle in
  `main.ts`.
- **Aufgeben** oder Verbindung weg = `raus` (kein Wiederbeitritt in die laufende Runde; zur nächsten
  Runde wieder beitreten).

## 5. Protokoll (`/api/wettkampf`, Version 1)

Eingabe-Einträge wie die Aufzeichnung (`docs/SPEC-aufzeichnung.md`): `[n, fx, fy]`,
`[n, fx, fy, ax, ay]` (Kräfte in 1/1024) oder `[n, aktion]` mit `use`, `drop`, `rotate`, `swap`,
zusätzlich `[1, "restart"]`.

**Browser → Server**
- `{ t: 'oeffnen', level: { pack, index, id } }` – Raum öffnen, als Spielleiter und Fahrer.
- `{ t: 'beitreten', code, als: 'fahrer' | 'zuschauer' }`
- `{ t: 'level', level }` – Spielleiter, nur außerhalb eines Rennens.
- `{ t: 'start' }` – Spielleiter, ab 2 Fahrern.
- `{ t: 'bereit', runde }` – Level geladen.
- `{ t: 'eingabe', runde, ab, e: Eintrag[] }` – `ab` = Schritte vor diesen Einträgen (lückenlos).
- `{ t: 'ziel', runde, schritte }`, `{ t: 'aufgeben', runde }`
- `{ t: 'folgen', fahrer }` – Zuschauer: Eingaben dieses Fahrers schicken.
- `{ t: 'ping' }`

**Server → Browser**
- `{ t: 'raum', code, du, rolle }` – `du` = eigene Nummer (1–4 Fahrer, 0 Zuschauer).
- `{ t: 'lobby', leiter, fahrer: [nr…], zuschauer, level, phase }` – bei jeder Änderung.
- `{ t: 'runde', runde, level, seed, fahrer: [nr…] }`, `{ t: 'los', runde, in }` (ms bis zum Start).
- `{ t: 'stand', runde, f: [[nr, x, y, farbe, schritte, status, zeit|null]…] }` – 10-mal pro Sekunde,
  aus der Server-Rechnung. Status: `faehrt`, `ziel`, `raus`.
- `{ t: 'verlauf', runde, fahrer, ab, e }` – an Zuschauer: zuerst der ganze bisherige Strom (in
  Stücken), dann laufend neue Einträge.
- `{ t: 'ergebnis', runde, plaetze: [{ nr, platz|null, zeit|null, status, grund? }…], abbruch? }`
- `{ t: 'fehler', grund }` – `code-unbekannt`, `raum-voll`, `zuschauer-voll`, `zu-viele-raeume`,
  `zu-viele-versuche`, `ausgelastet`, `aus`, `level-unbekannt`, `ungueltig`, `zu-gross`, `verfallen`.

## 6. Grenzen und Missbrauchsschutz

- Je Raum **4 Fahrer**, **8 Zuschauer**. Insgesamt **40 Räume**, **6 Rennen** gleichzeitig.
- Je IP (nur im Speicher, wie Stufe 1): **2 offene Räume**, **10 gleichzeitige Verbindungen**,
  **30 Beitrittsversuche je 10 min** (Codes 00000–99999: Raten ist aussichtslos), höchstens
  **200 Nachrichten je 10 s** je Verbindung.
- Eingaben: Einträge geprüft wie `decodeInput`, Schritte nur lückenlos (`ab`), nicht vor der Uhr,
  höchstens 15 min je Runde; höchstens 300 000 Einträge je Fahrer und Runde.
- **Raumleben:** Ohne Fahrer schließt der Raum sofort (Zuschauer bekommen `verfallen`). Lobby ohne
  Start und ohne Nachricht 15 min → geschlossen. Geht der Spielleiter, wird der nächste Fahrer
  Spielleiter.
- Nur Levels aus den Paketen des Spiels (nach `id` im Katalog des Servers), keine Link- oder
  Spieler-Levels.

## 7. Datenschutz

- **Keine Datenbank, keine Migration** (014 bleibt frei). Räume, Eingaben und Ergebnisse liegen nur im
  Arbeitsspeicher und verschwinden mit dem Raum.
- Die IP-Adresse hält die API nur im Speicher für die Begrenzungen (wie Stufe 1), nie in Logs.
  Eingaben werden nicht geloggt.
- Mitspieler und Zuschauer sehen: Spielernummer, Murmelposition, Zeit und Status – keine IP, keinen
  Namen. Zuschauer bekommen die Eingaben des verfolgten Fahrers (zum Nachrechnen des Spielfelds).
- Datenschutzerklärung: Abschnitt „Zu zweit spielen“ braucht eine Ergänzung (Entwurf in der Übergabe,
  **nur nach Freigabe des Nutzers**).

## 8. Spiel (Browser)

- `src/mehrspieler/wettkampf.ts`: Protokoll (prüfen, packen), Eingabestrom aus der Aufzeichnung der
  Session, Uhr-Aufholen, Geister, Rangliste – ohne DOM, getestet.
- `src/mehrspieler/wettkampf-ui.ts`: WebSocket, Menüs, Lobby, Countdown, Rangliste, Zuschauen. Es
  hängt sich an die vorhandenen Haken von `zuZweit` (`rechnen`, `geister`, `gewonnen`, `seed`,
  `levelGeladen`, `laeuft`, `folgt`); `main.ts` bekommt nur den Startwert-und-Leben-Parameter beim
  Laden.
- Wettkampf-Läufe zählen nicht in Fortschritt, Bestzeiten und Lösungsstatistik.
- Gestaltung nach `apple-design`: klare Hierarchie, Treffflächen ≥ 44 px, Status nie nur über Farbe
  (Text + Symbol), `prefers-reduced-motion` respektiert, Tastatur bedienbar, Rangliste als
  `role="status"`-Tabelle.

## 9. Tests

- `server/src/wettkampf.test.ts` (`node --test`): Codes, Rollen, Grenzen, Lobby, Start/Bereit/Los,
  Eingaben (lückenlos, Uhr, Größe), Wertung und Gleichstand, Abweichung, Spielleiterwechsel,
  Zuschauer-Verlauf – mit einem Ersatz-Rechner; dazu der echte Kindprozess mit dem Spielcode des
  Repos (eine Lösung aus `solutions/` gewinnt als Fahrer) und ein WebSocket-Ende-zu-Ende-Test.
- `src/mehrspieler/wettkampf.test.ts` (vitest): Nachrichten prüfen, Eingabestrom (gleiche Einträge wie
  die Aufzeichnung, Neustart), Aufholen, Rangliste.
- Browser: drei Fenster (zwei Fahrer, ein Zuschauer) gegen den lokalen Raumdienst.

## 10. Betrieb

- Keine neuen Ports, keine Firewall-Änderung, kein neuer Dienst, keine `.env`-Werte.
- `release.sh` legt den Spielcode samt `tools/` schon unter `/opt/murmel/game/<version>` ab; der
  Kindprozess kommt von dort.
- Lokal: `PORT=3182 node server/src/raum-dev.ts` startet jetzt auch den Wettkampf (Spielcode aus dem
  Repo), dazu `MURMEL_API=http://127.0.0.1:3182 npx vite --port 5182`.
- Rückweg: `WETTKAMPF=aus` in `/opt/murmel/.env` schaltet die Route ab (Fehler `aus` im Spiel); oder
  den Commit zurücknehmen.
