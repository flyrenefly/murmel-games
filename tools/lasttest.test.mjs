import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perzentil, kennzahlen } from './lasttest.mjs';

test('perzentil: nächster Rang', () => {
  const l = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(perzentil(l, 50), 50);
  assert.equal(perzentil(l, 95), 100);
  assert.equal(perzentil([7], 99), 7);
  assert.ok(Number.isNaN(perzentil([], 50)));
});

test('kennzahlen: Fehlerquote, Anfragen/s und Statuszählung', () => {
  const m = [
    { ms: 10, ok: true, bytes: 1000, status: 200 },
    { ms: 30, ok: true, bytes: 1000, status: 200 },
    { ms: 20, ok: false, bytes: 0, status: 503 },
    { ms: 40, ok: false, bytes: 0, status: 0 },
  ];
  const k = kennzahlen(m, 2000);
  assert.equal(k.anfragen, 4);
  assert.equal(k.rps, 2);
  assert.equal(k.fehler, 2);
  assert.equal(k.fehlerquote, 0.5);
  assert.equal(k.p50, 20);
  assert.equal(k.max, 40);
  assert.deepEqual(k.status, { 200: 2, 503: 1, 0: 1 });
});
