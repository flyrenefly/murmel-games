// Englische Texte: Statistikseite (Schlüssel = deutscher Text in src/statistik.ts, src/auswertung-seite.ts)
export default {
  '{spieler} Spieler · {starts} Starts': '{spieler} players · {starts} starts',
  'In diesem Zeitraum wurde noch kein Level gestartet.': 'No level was started in this period.',
  'In diesem Zeitraum gab es weder neue Konten noch Anmeldungen.': 'No new accounts and no sign-ins in this period.',
  'Noch kein Level mit mindestens 5 beendeten Läufen in diesem Zeitraum.': 'No level with at least 5 finished runs in this period yet.',
  'In diesem Zeitraum wurde noch kein Lauf beendet.': 'No run was finished in this period.',
  'Lade …': 'Loading …',
  // Herkunft (src/statistik.ts)
  'andere (Domains: {n})': 'others (domains: {n})',
  andere: 'others',
  'ohne fremde Seite (nur Kampagne)': 'no other site (campaign only)',
  ohne: 'none',
  'In diesem Zeitraum kam niemand über einen Kampagnen-Link (?von=).': 'Nobody came through a campaign link (?von=) in this period.',
  'In diesem Zeitraum kam noch niemand von einer fremden Seite.': 'Nobody came from another site in this period yet.',
  'Der Zugangsschlüssel stimmt nicht. Er steht auf dem Server in /opt/murmel/.env unter STATS_TOKEN.':
    'The access key is wrong. You can find it on the server in /opt/murmel/.env under STATS_TOKEN.',
  'Nicht als Admin angemeldet. Melde dich im Spiel unter „Konto“ an, dann erscheint die Statistik ohne Schlüssel – oder gib den Zugangsschlüssel ein.':
    'Not signed in as an admin. Sign in in the game under “Account” and the statistics appear without a key – or enter the access key.',
  'Der Server antwortet gerade nicht. Später noch einmal versuchen.': 'The server is not responding right now. Please try again later.',
  // Zeitklassen (src/auswertung-seite.ts)
  'unter 1 min': 'under 1 min',
  '1–3 min': '1–3 min',
  '3–10 min': '3–10 min',
  '10–30 min': '10–30 min',
  'ab 30 min': '30 min or more',
} as const;
