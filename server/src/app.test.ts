import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from './app.ts';
import { pendingMigrations } from './migrate.ts';

test('GET /api/health meldet ok, Version und erreichbare Datenbank', async () => {
  const app = buildApp({ version: 'abc123', db: { ping: async () => {} } });

  const res = await app.inject({ method: 'GET', url: '/api/health' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, version: 'abc123', db: 'ok' });
});

test('GET /api/health antwortet 503, wenn die Datenbank nicht erreichbar ist', async () => {
  const app = buildApp({
    version: 'abc123',
    db: {
      ping: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    },
  });

  const res = await app.inject({ method: 'GET', url: '/api/health' });

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json(), { ok: false, version: 'abc123', db: 'fehler' });
});

test('die Fehlermeldung der Datenbank gelangt nicht in die Antwort', async () => {
  const app = buildApp({
    version: 'v',
    db: {
      ping: async () => {
        throw new Error('password authentication failed for user murmel');
      },
    },
  });

  const res = await app.inject({ method: 'GET', url: '/api/health' });

  assert.doesNotMatch(res.body, /password|murmel/);
});

test('unbekannte API-Pfade antworten 404 als JSON', async () => {
  const app = buildApp({ version: 'v', db: { ping: async () => {} } });

  const res = await app.inject({ method: 'GET', url: '/api/gibt-es-nicht' });

  assert.equal(res.statusCode, 404);
  assert.equal(res.headers['content-type']?.toString().startsWith('application/json'), true);
});

test('pendingMigrations liefert nur noch nicht angewendete .sql-Dateien in Namensreihenfolge', () => {
  const files = ['002_konten.sql', 'README.md', '001_init.sql', '003_zeiten.sql'];
  const applied = new Set(['001_init.sql']);

  assert.deepEqual(pendingMigrations(files, applied), ['002_konten.sql', '003_zeiten.sql']);
});
