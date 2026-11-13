// Erzeugt ein VAPID-Schlüsselpaar für die Erinnerung (docs/SPEC-webpush.md). Einmalig auf dem Server:
//   docker compose run --rm --no-deps api node src/webpush-schluessel.ts >> /opt/murmel/.env
// Die Ausgabe enthält den privaten Schlüssel: nicht weitergeben, nicht ins Protokoll kopieren.
import { generateVapidKeys } from './webpush.ts';

const k = generateVapidKeys();
process.stdout.write(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}\n`);
