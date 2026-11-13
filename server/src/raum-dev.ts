// Room service alone, without database: for the dev server and the end-to-end test of
// „Zu zweit“ (tools/e2e-mehrspieler.mjs). No TURN secret → rooms hand out no TURN data and the
// dev build connects directly (docs/SPEC-mehrspieler.md 5.1). Wettkampf (docs/SPEC-wettkampf.md) plays
// with the game code of this repository. Never used on the server.
//   PORT=3182 node server/src/raum-dev.ts
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { RoomHub } from './raum.ts';
import { WettkampfHub } from './wettkampf.ts';
import { wettkampfRechner } from './wettkampf-rechner.ts';

const port = Number(process.env.PORT ?? 3182);
const db = { ping: async () => {}, recordEvent: async () => {}, statistics: async () => ({ days: [], levels: [] }) };
const wettkampf = new WettkampfHub({ rechner: wettkampfRechner(fileURLToPath(new URL('../..', import.meta.url)), { nice: 0 }) });
const app = buildApp({ version: 'dev', db, raum: new RoomHub(), wettkampf });
await app.listen({ host: '127.0.0.1', port });
console.log(`Raumdienst auf http://127.0.0.1:${port}/api/raum und /api/wettkampf`);
