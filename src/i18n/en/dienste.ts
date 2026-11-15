// Englische Texte: Dienste des Spiels – Tipps, Cloudstand, Abgleich, Bestenliste, Tageslevel, Geister,
// Steuerung, Drehsperre, Web Push, Lösungen, Pakete (Schlüssel = deutscher Text im Code)
export default {
  // Tipps (src/tipps-ui.ts)
  Tipp: 'Hint',
  'Für dieses Level gibt es noch keinen Tipp.': 'There is no hint for this level yet.',
  'Einen Moment …': 'One moment …',
  Weiterspielen: 'Keep playing',
  'Weiter zeigen': 'Show more',
  'Weg zeigen': 'Show the way',
  'Der Geist zeigt den Weg.': 'The ghost shows the way.',
  'Mit einem gezeigten Weg gelöst – dieser Lauf zählt nicht für die Bestenliste.': 'Solved with the way shown once – this run does not count for the leaderboard.',
  'Mit {n} gezeigten Wegen gelöst – dieser Lauf zählt nicht für die Bestenliste.': 'Solved with the way shown {n} times – this run does not count for the leaderboard.',
  'Mit einem Tipp gelöst.': 'Solved with one hint.',
  'Mit {n} Tipps gelöst.': 'Solved with {n} hints.',

  // Spielstand in der Cloud (src/cloudstand.ts)
  'Wird in der Cloud gesichert …': 'Saving to the cloud …',
  'In der Cloud gesichert.': 'Saved to the cloud.',
  'Dieser Lauf ist zu lang für die Cloud.': 'This run is too long for the cloud.',
  'Sichern gerade nicht möglich – kein Netz.': 'Saving is not possible right now – no network.',
  'Sichern gerade nicht möglich.': 'Saving is not possible right now.',
  'Der Spielstand ist gerade nicht erreichbar.': 'The saved game cannot be reached right now.',
  'Kein Spielstand mehr in der Cloud.': 'The saved game is no longer in the cloud.',
  'Der Spielstand ließ sich nicht laden.': 'The saved game could not be loaded.',
  'Der Spielstand ist beschädigt.': 'The saved game is damaged.',

  // Fortschritt auf allen Geräten (src/sync.ts)
  'Auf allen Geräten abgeglichen um {zeit}.': 'Synced across all devices at {zeit}.',
  'Auf allen Geräten abgeglichen am {datum}.': 'Synced across all devices on {datum}.',
  'Wird abgeglichen …': 'Syncing …',
  'Wartet auf Netz – wird später nachgereicht.': 'Waiting for a network – will sync later.',
  'Konto gesperrt – Abgleich pausiert.': 'Account blocked – sync paused.',
  'Abgleich gerade nicht möglich – wird später nachgereicht.': 'Sync is not possible right now – will try again later.',
  'Nur auf diesem Gerät. Mit einem Konto auf allen Geräten.': 'Only on this device. With an account, on all your devices.',

  // Bestenliste (src/bestenliste.ts)
  'Bestenliste gerade nicht erreichbar.': 'The leaderboard cannot be reached right now.',
  'Anmelden, um in die Bestenliste zu kommen.': 'Sign in to get onto the leaderboard.',
  'Prüfung abgebrochen. Deine Zeit bleibt auf diesem Gerät gespeichert.': 'Check cancelled. Your time stays saved on this device.',
  'Die Prüfung dauert zu lange. Schau später in die Rangliste.': 'The check is taking too long. Look at the ranking later.',
  'Bestenliste: wird geprüft …': 'Leaderboard: checking …',
  'Bestenliste: {grund}': 'Leaderboard: {grund}',
  'Platz {platz} von {von}': 'Place {platz} of {von}',
  '1 Eintrag': '1 entry',
  '{n} Einträge': '{n} entries',
  'Bestenliste: {platz} · neue persönliche Bestzeit': 'Leaderboard: {platz} · new personal best',
  'Bestenliste: {platz} (deine Bestzeit {zeit})': 'Leaderboard: {platz} (your best time {zeit})',

  // Tageslevel und Wochenaufgabe (src/tageslevel.ts)
  'Tagesrangliste gerade nicht erreichbar.': 'The daily ranking cannot be reached right now.',
  Tageslevel: 'Daily level',
  Wochenaufgabe: 'Weekly challenge',
  '1 Zeit': '1 time',
  '{n} Zeiten': '{n} times',
  'noch keine Zeiten': 'no times yet',
  'Heute · {titel}': 'Today · {titel}',
  'Diese Woche · {titel}': 'This week · {titel}',
  'Wochenaufgabe KW {kw}': 'Weekly challenge, week {kw}',
  'Tageslevel {datum}': 'Daily level {datum}',
  '{name}: wird geprüft …': '{name}: checking …',
  '{name}: {platz} (deine Bestzeit {zeit})': '{name}: {platz} (your best time {zeit})',

  // Geister (src/geister.ts)
  'Deine Bestzeit {zeit}': 'Your best time {zeit}',
  'Platz {platz} · {name} · {zeit}': 'Place {platz} · {name} · {zeit}',
  'Spieler ohne Namen': 'Unnamed player',

  // Steuerung (src/steuerung-ui.ts) und Drehsperre (src/drehsperre.ts)
  Steuerung: 'Steering',
  Neigen: 'Tilt',
  Wischen: 'Swipe',
  'Für das Spielen im Liegen die Drehsperre im Kontrollzentrum einschalten.': 'To play lying down, turn on Rotation Lock in Control Center.',
  'Für das Spielen im Liegen „Automatisch drehen“ in den Schnelleinstellungen ausschalten.': 'To play lying down, turn off “Auto-rotate” in Quick Settings.',

  // Erinnerungen per Web Push (src/webpush.ts)
  'Täglich und Wochenaufgabe': 'Daily and weekly challenge',
  Täglich: 'Daily',
  Aus: 'Off',
  'Auf iPhone und iPad gibt es Erinnerungen nur, wenn Murmel auf dem Home-Bildschirm liegt: im Teilen-Menü „Zum Home-Bildschirm“ wählen und Murmel von dort öffnen.':
    'On iPhone and iPad, reminders only work when Murmel is on the Home Screen: choose “Add to Home Screen” in the Share menu and open Murmel from there.',
  'Mitteilungen sind für Murmel blockiert. Du kannst sie in den Website-Einstellungen des Browsers wieder erlauben.':
    'Notifications are blocked for Murmel. You can allow them again in the browser’s website settings.',

  // Als Lösung speichern (src/loesung.ts, nur Admins)
  'Nur gewonnene Läufe sind Lösungen.': 'Only won runs are solutions.',
  'Der Server ist gerade nicht erreichbar. Die Lösung wurde nicht gespeichert.': 'The server cannot be reached right now. The solution was not saved.',
  'Lösung gespeichert – sie wird jede Nacht nachgespielt.': 'Solution saved – it is replayed every night.',
  'Diese Lösung ist schon gespeichert.': 'This solution is already saved.',
  'Nur angemeldete Admins können Lösungen speichern.': 'Only signed-in admins can save solutions.',
  'Nicht gespeichert: {msg}': 'Not saved: {msg}',

  // Pakete (src/packs.ts)
  'Geteiltes Level': 'Shared level',
  'Spieler-Levels': 'Player levels',
} as const;
