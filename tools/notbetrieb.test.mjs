import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dnsStand, entscheide, ionosDns, VPS_IP, WEBSPACE_IP } from './notbetrieb.mjs';

test('dnsStand erkennt VPS, Notbetrieb, gemischt und fremde Adressen', () => {
  assert.equal(dnsStand([VPS_IP, VPS_IP]), 'vps');
  assert.equal(dnsStand([WEBSPACE_IP, WEBSPACE_IP]), 'notbetrieb');
  assert.equal(dnsStand([VPS_IP, WEBSPACE_IP]), 'gemischt');
  assert.equal(dnsStand([VPS_IP, '1.2.3.4']), 'fremd');
});

test('Normalbetrieb: VPS liefert aus → nichts', () => {
  assert.equal(entscheide({ stand: 'vps', vps: [true], webspace: true }).aktion, 'keine');
  assert.equal(entscheide({ stand: 'vps', vps: [false, false, true], webspace: true }).aktion, 'keine');
});

test('Ausfall: drei Fehlschläge und Webspace da → Notbetrieb', () => {
  assert.equal(entscheide({ stand: 'vps', vps: [false, false, false], webspace: true }).aktion, 'zum-notbetrieb');
});

test('zu wenige Fehlschläge reichen nicht', () => {
  assert.equal(entscheide({ stand: 'vps', vps: [false, false], webspace: true }).aktion, 'keine');
});

test('VPS und Webspace beide weg → keine Umschaltung (Netz des Prüfers)', () => {
  assert.equal(entscheide({ stand: 'vps', vps: [false, false, false], webspace: false }).aktion, 'keine');
});

test('Notbetrieb: zurück erst nach 5 Erfolgen in Folge', () => {
  assert.equal(entscheide({ stand: 'notbetrieb', vps: [true, true, true, true, true], webspace: true }).aktion, 'zurueck');
  assert.equal(entscheide({ stand: 'notbetrieb', vps: [true, true, true, true], webspace: true }).aktion, 'keine');
  assert.equal(entscheide({ stand: 'notbetrieb', vps: [true, true, false], webspace: true }).aktion, 'keine');
});

test('gemischt: Ausfall → Notbetrieb, stabil → zurück', () => {
  assert.equal(entscheide({ stand: 'gemischt', vps: [false, false, false], webspace: true }).aktion, 'zum-notbetrieb');
  assert.equal(entscheide({ stand: 'gemischt', vps: [true, true, true, true, true], webspace: true }).aktion, 'zurueck');
});

test('fremde Adresse → Wächter greift nie ein', () => {
  assert.equal(entscheide({ stand: 'fremd', vps: [false, false, false], webspace: true }).aktion, 'keine');
  assert.equal(entscheide({ stand: 'fremd', vps: [true, true, true, true, true], webspace: true }).aktion, 'keine');
});

test('IONOS-Client: liest Zone und A-Einträge, setzt Inhalt per PUT', async () => {
  const calls = [];
  const fake = async (url, opt) => {
    calls.push([opt.method, url, opt.body, opt.headers['X-API-Key']]);
    const u = new URL(url);
    if (u.pathname.endsWith('/zones')) return ok([{ id: 'z1', name: 'murmel.games' }, { id: 'z2', name: 'andere.de' }]);
    if (opt.method === 'GET') {
      const name = u.searchParams.get('recordName');
      return ok({ records: [{ id: `r-${name}`, name, type: 'A', content: VPS_IP, prio: 0 }, { id: 'x', name, type: 'MX', content: 'mx' }] });
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const ok = (j) => ({ ok: true, status: 200, json: async () => j });
  const dns = ionosDns('k.geheim', fake);
  const zone = await dns.zone();
  assert.equal(zone, 'z1');
  const recs = await dns.aEintraege(zone);
  assert.deepEqual(recs.map((r) => r.name), ['murmel.games', 'www.murmel.games']);
  await dns.setzen(zone, recs[0], WEBSPACE_IP);
  const put = calls.find((c) => c[0] === 'PUT');
  assert.match(put[1], /\/zones\/z1\/records\/r-murmel\.games$/);
  assert.deepEqual(JSON.parse(put[2]), { content: WEBSPACE_IP, ttl: 300, prio: 0, disabled: false });
  assert.ok(calls.every((c) => c[3] === 'k.geheim'));
});

test('IONOS-Client: Fehler nennen keine Abfrageparameter und keinen Schlüssel', async () => {
  const dns = ionosDns('k.geheim', async () => ({ ok: false, status: 401 }));
  await assert.rejects(dns.zone(), (e) => /HTTP 401/.test(e.message) && !e.message.includes('geheim'));
});
