// Englische Texte: Ladefehler von parseLevel (src/game/level.ts). Sie werden als {grund} in Editor-,
// Link- und Umwandlungsmeldungen eingesetzt; die Meldung selbst bleibt deutsch (der Server übersetzt sie
// mit denselben Texten, server/src/fehler-en.ts). Anzeige über src/game/ladefehler.ts.
export default {
  'leere Karte': 'empty map',
  "unbekanntes Zeichen '{zeichen}' in Zeile {zeile}": "unknown character '{zeichen}' in row {zeile}",
  'Oxyd-Stein ohne Symbol': 'Oxyd stone without a symbol',
  'mehr als ein Startpunkt': 'more than one starting point',
  "kein Startpunkt '@'": "no starting point '@'",
  'keine Oxyd-Steine': 'no Oxyd stones',
  'Symbol {symbol} kommt {n}× vor, erwartet paarweise': 'symbol {symbol} occurs {n}×, expected in pairs',
  'Oxyd-Farbe {farbe} ohne Partner': 'Oxyd color {farbe} has no partner',
} as const;
