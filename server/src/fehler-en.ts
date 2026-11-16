/**
 * English error texts (docs/SPEC-englisch.md, „Server“): the routes answer with German texts; the onSend
 * hook in src/sprache.ts swaps them for these when the request asks for English. Key = German text in the
 * code. src/sprache.test.ts reads every error text from the sources and checks that it is translated.
 */
export const FEHLER_EN: Readonly<Record<string, string>> = {
  // general
  'nicht berechtigt': 'Not authorized',
  'nicht gefunden': 'Not found',
  'nicht angemeldet': 'Not signed in',
  'nur für Admins': 'Admins only',
  'fremde Herkunft': 'Request from a foreign origin',
  'Zu viele Anfragen. Bitte warte ein paar Minuten.': 'Too many requests. Please wait a few minutes.',
  'zu viele Anfragen': 'Too many requests',
  'Anfrage ungültig': 'Invalid request',

  // accounts and sign-in (konten.ts, anbieter.ts)
  'Dieses Konto ist gesperrt.': 'This account is blocked.',
  'Der Mailversand ist noch nicht eingerichtet. Anmelden per Mail geht deshalb gerade nicht.':
    "Sending email isn't set up yet, so signing in by email doesn't work right now.",
  'Bitte gib eine gültige Mailadresse ein.': 'Please enter a valid email address.',
  'Zu viele Anmeldelinks von hier. Bitte warte ein paar Minuten.': 'Too many sign-in links from here. Please wait a few minutes.',
  'Für diese Adresse wurden gerade schon mehrere Links verschickt. Bitte schau in dein Postfach oder versuch es in einer Stunde wieder.':
    'Several links have just been sent to this address. Please check your inbox or try again in an hour.',
  'Die Mail konnte gerade nicht verschickt werden. Bitte versuch es später noch einmal.': "The email couldn't be sent just now. Please try again later.",
  'Dieser Anmeldelink ist abgelaufen oder wurde schon benutzt. Fordere einfach einen neuen an.':
    'This sign-in link has expired or has already been used. Just request a new one.',
  'Der Vorgang ist abgelaufen. Bitte noch einmal versuchen.': 'This has expired. Please try again.',
  'Der Passkey konnte nicht geprüft werden.': "The passkey couldn't be verified.",
  'Anmelden mit Passkey hat nicht geklappt. Hast du auf diesem Gerät einen Passkey für Murmel?':
    "Signing in with a passkey didn't work. Do you have a passkey for Murmel on this device?",
  'Passkey nicht gefunden': 'Passkey not found',
  'Die Anmeldung ist abgelaufen. Bitte versuch es noch einmal.': 'The sign-in has expired. Please try again.',
  'Dieser Anmeldeweg ist nicht verbunden.': "This sign-in method isn't connected.",
  'Das ist dein letzter Anmeldeweg. Richte zuerst einen anderen ein (zum Beispiel einen Passkey), dann kannst du diesen entfernen.':
    'This is your last sign-in method. Set up another one first (a passkey, for example), then you can remove this one.',

  // leaderboard (bestenliste.ts, loesbarkeit.ts)
  'Die Prüfung ist fehlgeschlagen. Bitte versuch es später noch einmal.': 'The check failed. Please try again later.',
  'Dieses Level gibt es in der aktuellen Spielversion nicht.': "This level doesn't exist in the current version of the game.",
  'Dein Spiel ist nicht auf dem neuesten Stand – bitte die Seite neu laden.': 'Your game is out of date – please reload the page.',
  'Die Prüfung dauerte zu lange.': 'The check took too long.',
  'Der Lauf ließ sich nicht nachspielen.': "The run couldn't be replayed.",
  'Beim Nachspielen wurde das Level nicht gelöst.': "The replay didn't solve the level.",
  'Die Bestenliste ist gerade nicht verfügbar.': "The leaderboard isn't available right now.",
  'Es werden schon Läufe von dir geprüft. Bitte einen Moment warten.': 'Your runs are already being checked. Please wait a moment.',
  'Gerade ist viel los. Bitte versuch es später noch einmal.': "It's very busy right now. Please try again later.",
  'Prüfung nicht gefunden – vielleicht wurde der Server neu gestartet.': 'Check not found – maybe the server was restarted.',
  'Eintrag nicht gefunden': 'Entry not found',
  'nur gewonnene Läufe sind Lösungen': 'only won runs are solutions',
  'nur gewonnene Läufe kommen in die Bestenliste': 'only won runs go on the leaderboard',
  'nur ein gewonnener Lauf ist eine Lösung': 'only a won run is a solution',
  'Lauf länger als eine Stunde': 'run longer than one hour',
  'Eingaben ungültig': 'invalid input',
  'unbekanntes Aufzeichnungsformat': 'unknown recording format',
  'Level-Kennung fehlt oder ist ungültig': 'level ID missing or invalid',
  'Level-Kennung fehlt': 'level ID missing',
  'Startwert ungültig': 'invalid seed',
  'anderer Physiktakt': 'different physics tick',
  'Schrittzahl ungültig': 'invalid step count',
  'Eingaben fehlen oder sind zu viele': 'input missing or too long',

  // cloud save, sync, ghosts, tips
  'kein Spielstand': 'No saved game',
  'Zu viele Abgleiche. Bitte warte ein paar Minuten.': 'Too many syncs. Please wait a few minutes.',
  'Der Fortschritt wurde inzwischen auf einem anderen Gerät geändert.': 'Your progress has been changed on another device in the meantime.',
  'Diesen Lauf gibt es nicht als Geist.': "This run isn't available as a ghost.",

  // forum
  'Bitte wähle zuerst einen Anzeigenamen.': 'Please choose a display name first.',
  'Zu viele Klicks. Bitte warte ein paar Minuten.': 'Too many clicks. Please wait a few minutes.',
  'Dieses Thema gibt es nicht (mehr).': "This topic doesn't exist (any more).",
  'Der Name braucht 3 bis 24 Zeichen: Buchstaben, Ziffern, Leerzeichen, Punkt, Strich. Namen wie „Admin“ oder „Team“ sind vergeben.':
    'The name needs 3 to 24 characters: letters, digits, spaces, periods, hyphens. Names like “Admin” or “Team” are taken.',
  'Diesen Namen hat schon jemand. Bitte wähle einen anderen.': 'Someone already has this name. Please choose another one.',
  'Der Titel braucht 3 bis 120 Zeichen.': 'The title needs 3 to 120 characters.',
  'Der Text braucht 1 bis 5000 Zeichen.': 'The text needs 1 to 5000 characters.',
  'Diesen Beitrag gibt es nicht (mehr).': "This post doesn't exist (any more).",
  'Nur eigene Beiträge lassen sich löschen.': 'You can only delete your own posts.',
  'Dieses Konto gibt es nicht (mehr).': "This account doesn't exist (any more).",
  'Admins lassen sich nicht sperren.': "Admins can't be blocked.",

  // player levels (spielerlevels.ts)
  'Dieses Level gibt es nicht (mehr).': "This level doesn't exist (any more).",
  'Das Level ist ungültig.': 'The level is invalid.',
  'Die Lösung ließ sich nicht nachspielen.': "The solution couldn't be replayed.",
  'Beim Nachspielen löst deine Aufzeichnung dieses Level nicht. Spiel es im Editor noch einmal probe und veröffentliche es danach.':
    "When replayed, your recording doesn't solve this level. Test-play it in the editor again and publish it after that.",
  'Hochladen ist gerade nicht verfügbar. Bitte versuch es später noch einmal.': "Uploading isn't available right now. Please try again later.",
  'Bitte wähle zuerst einen Anzeigenamen – er steht als Autor beim Level.': 'Please choose a display name first – it appears as the author of the level.',
  'Eine neue Version geht nur für eigene Levels.': 'You can only upload a new version of your own levels.',
  'Es wird schon etwas von dir geprüft. Bitte einen Moment warten.': 'Something of yours is already being checked. Please wait a moment.',
  'Heute wurden schon viele Prüfungen von dir gestartet. Bitte versuch es morgen noch einmal.':
    "You've already started a lot of checks today. Please try again tomorrow.",
  'Eigene Levels kannst du nicht bewerten.': "You can't rate your own levels.",
  'Bewerten geht erst nach der Freigabe.': 'Rating is only possible once the level has been approved.',
  'Bewerten kann, wer das Level gelöst hat – angemeldet, mit einem geprüften Lauf in der Bestenliste.':
    'You can rate a level once you have solved it – signed in, with a checked run on the leaderboard.',
  'Eigene Levels kannst du zurückziehen oder löschen.': 'You can withdraw or delete your own levels.',
  'Bitte nenne kurz den Grund (mindestens 3 Zeichen).': 'Please briefly give a reason (at least 3 characters).',
  'Du hast dieses Level schon gemeldet.': "You've already reported this level.",
  'Dieses Level lässt sich nicht zurückziehen.': "This level can't be withdrawn.",
  'Nur zurückgezogene Levels lassen sich wieder einreichen.': 'Only withdrawn levels can be resubmitted.',
  'Der Autor hat dieses Level zurückgezogen oder ersetzt.': 'The author has withdrawn or replaced this level.',
  'Bitte nenne dem Autor einen Grund.': 'Please give the author a reason.',
  'Das Level fehlt.': 'The level is missing.',
  'Das Level ist zu groß (höchstens 256 KB).': 'The level is too large (256 KB at most).',
  'Spieler-Levels stehen unter CC BY-SA 4.0 – bitte die Lizenz bestätigen.': 'Player levels are published under CC BY-SA 4.0 – please confirm the license.',
  'Der Titel braucht 3 bis 60 Zeichen.': 'The title needs 3 to 60 characters.',
  'Die Beschreibung darf höchstens 500 Zeichen haben.': 'The description may have 500 characters at most.',
  'Die Lösung gehört nicht zu einem Level aus dem Editor.': "The solution doesn't belong to a level from the editor.",
  'Ungültige Angabe „ersetzt“.': 'Invalid value for “ersetzt” (replaces).',

  // daily level and weekly challenge (tageslevel.ts)
  'Tageslevel gerade nicht verfügbar.': 'Daily level not available right now.',
  'Aufgabe unbekannt': 'Unknown challenge',
  'Diese Aufgabe gibt es nicht.': "This challenge doesn't exist.",
  'Diese Aufgabe ist vorbei.': 'This challenge is over.',
  'Der Lauf gehört zu einem anderen Level.': 'The run belongs to a different level.',
  'Der Lauf hat einen anderen Startwert als die Aufgabe.': 'The run has a different seed from the challenge.',

  // reminders (webpush.ts)
  'Zu viele Änderungen. Bitte versuch es später noch einmal.': 'Too many changes. Please try again later.',
  'Erinnerungen sind gerade voll. Bitte versuch es später noch einmal.': 'Reminders are full right now. Please try again later.',
  'Endpoint fehlt': 'Endpoint missing',
  'Endpoint ungültig': 'Invalid endpoint',
  'Push-Dienst unbekannt': 'Unknown push service',
  'Schlüssel ungültig': 'Invalid key',
  'Auswahl fehlt': 'Selection missing',
  'Nichts ausgewählt': 'Nothing selected',
};

/**
 * Texts with inserted values: the pattern matches the whole German text; the function builds the English
 * one from the groups (`t` translates a nested text, e.g. the reason after „Lösung:“).
 */
export const FEHLER_MUSTER_EN: readonly [RegExp, (m: RegExpExecArray, t: (s: string) => string) => string][] = [
  [/^Bitte melde dich wieder an und verbinde (.+) dann noch einmal\.$/, (m) => `Please sign in again, then connect ${m[1]} once more.`],
  [
    /^Dieses (.+)-Konto gehört schon zu einem anderen Murmel-Konto\. Trenne es dort, dann kannst du es hier verbinden\.$/,
    (m) => `This ${m[1]} account already belongs to another Murmel account. Disconnect it there, then you can connect it here.`,
  ],
  [/^Höchstens (\d+) Läufe pro Stunde\. Bitte versuch es später noch einmal\.$/, (m) => `At most ${m[1]} runs per hour. Please try again later.`],
  [/^Höchstens (\d+) neue Themen pro Stunde\. Bitte versuch es später noch einmal\.$/, (m) => `At most ${m[1]} new topics per hour. Please try again later.`],
  [/^Höchstens (\d+) Beiträge pro Stunde\. Bitte versuch es später noch einmal\.$/, (m) => `At most ${m[1]} posts per hour. Please try again later.`],
  [/^Höchstens (\d+) Levels pro Tag\. Bitte versuch es morgen noch einmal\.$/, (m) => `At most ${m[1]} levels per day. Please try again tomorrow.`],
  [
    /^Es warten schon (\d+) Levels von dir auf Freigabe\. Bitte warte, bis ein Admin sie angesehen hat\.$/,
    (m) => `${m[1]} of your levels are already waiting for approval. Please wait until an admin has looked at them.`,
  ],
  [/^Es warten schon (\d+) Levels von dir auf Freigabe\.$/, (m) => `${m[1]} of your levels are already waiting for approval.`],
  [
    /^Unbekannte Angabe „(.*)“: Spieler-Levels enthalten nur, was der Editor baut \(kein Lua\)\.$/,
    (m) => `Unknown field “${m[1]}”: player levels only contain what the editor builds (no Lua).`,
  ],
  [/^Die Karte fehlt oder ist größer als (\d+)×(\d+)\.$/, (m) => `The map is missing or larger than ${m[1]}×${m[2]}.`],
  [/^Ein Level darf höchstens (\d+) Dokumente enthalten\.$/, (m) => `A level may contain ${m[1]} documents at most.`],
  [/^Ein Dokumenttext darf höchstens (\d+) Zeichen haben\.$/, (m) => `A document text may have ${m[1]} characters at most.`],
  [/^Die Angabe „Vorlage“ darf höchstens (\d+) Zeichen haben\.$/, (m) => `The “based on” credit may have ${m[1]} characters at most.`],
  [/^Lösung: (.+)$/s, (m, t) => `Solution: ${t(m[1])}`],
];
