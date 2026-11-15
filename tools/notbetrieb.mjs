#!/usr/bin/env node
// Wächter für den Notbetrieb (docs/SERVER.md Abschnitt 9, Nutzerentscheidung 15.11.2026).
//
// Läuft alle 5 Minuten in GitHub Actions (.github/workflows/notbetrieb.yml), also außerhalb des VPS:
//  - Liefert der VPS das Spiel nicht mehr aus (3 Fehlschläge in rund 90 s) und der IONOS-Webspace
//    schon, stellt er die A-Einträge von murmel.games und www.murmel.games auf den Webspace um.
//  - Zeigen die Einträge auf den Webspace und liefert der VPS wieder stabil aus (5 Erfolge in
//    rund 4 min), stellt er sie automatisch zurück.
// Er fasst nur A-Einträge an, deren Inhalt eine der beiden bekannten Adressen ist. Steht dort etwas
// anderes (Handänderung), tut er nichts und meldet das.
//
// Ohne IONOS_DNS_API_KEY prüft er nur und meldet einen Ausfall (Aktion „warnung“).
// Ausgabe für den Workflow: aktion=<keine|zum-notbetrieb|zurueck|warnung> und eine Zeile Text.
import https from 'node:https';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DOMAIN = 'murmel.games';
export const NAMEN = ['murmel.games', 'www.murmel.games'];
export const VPS_IP = '85.215.139.111';
export const WEBSPACE_IP = '217.160.0.80';
export const TTL = 300;

/** Stand der DNS-Einträge: 'vps', 'notbetrieb', 'gemischt' oder 'fremd' (unbekannte Adresse). */
export function dnsStand(inhalte) {
  if (inhalte.some((ip) => ip !== VPS_IP && ip !== WEBSPACE_IP)) return 'fremd';
  if (inhalte.every((ip) => ip === VPS_IP)) return 'vps';
  if (inhalte.every((ip) => ip === WEBSPACE_IP)) return 'notbetrieb';
  return 'gemischt';
}

/**
 * Entscheidung aus DNS-Stand und Prüfungen.
 * vps: Ergebnisse der VPS-Prüfungen (true = liefert aus), webspace: Ergebnis der Webspace-Prüfung.
 * Umschalten zum Notbetrieb nur, wenn ALLE VPS-Prüfungen scheitern (mindestens 3) und der Webspace
 * ausliefert – scheitert beides, liegt es eher am Netz des Prüfers. Zurück nur bei mindestens
 * 5 erfolgreichen VPS-Prüfungen ohne Ausnahme.
 */
export function entscheide({ stand, vps, webspace }) {
  const alleFehl = vps.length >= 3 && vps.every((ok) => !ok);
  const stabil = vps.length >= 5 && vps.every((ok) => ok);
  if (stand === 'fremd') return { aktion: 'keine', grund: 'DNS zeigt auf eine unbekannte Adresse – Handänderung, Wächter greift nicht ein' };
  if (stand === 'vps' || stand === 'gemischt') {
    if (alleFehl && webspace) return { aktion: 'zum-notbetrieb', grund: 'VPS liefert nicht aus, Webspace schon' };
    if (alleFehl) return { aktion: 'keine', grund: 'VPS und Webspace beide nicht erreichbar – vermutlich Netz des Prüfers, keine Umschaltung' };
    if (stand === 'gemischt' && stabil) return { aktion: 'zurueck', grund: 'Einträge gemischt, VPS stabil – alles auf den VPS' };
    return { aktion: 'keine', grund: stand === 'gemischt' ? 'Einträge gemischt, VPS nicht stabil' : 'VPS liefert aus' };
  }
  // stand === 'notbetrieb'
  if (stabil) return { aktion: 'zurueck', grund: 'VPS liefert wieder stabil aus' };
  return { aktion: 'keine', grund: 'Notbetrieb aktiv, VPS noch nicht stabil' };
}

/** GET https://<ip>/ mit SNI und Host murmel.games; true bei 200 und Murmel-Inhalt. */
export function liefertAus(ip, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve) => {
    const req = https.request(
      { host: ip, servername: DOMAIN, path: '/', method: 'GET', headers: { host: DOMAIN, 'user-agent': 'murmel-waechter' }, timeout: timeoutMs },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { if (body.length < 200000) body += d; });
        res.on('end', () => resolve(res.statusCode === 200 && /murmel/i.test(body)));
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.end();
  });
}

/** Kleiner Client für die IONOS-DNS-API (https://developer.hosting.ionos.de/docs/dns). */
export function ionosDns(key, fetchFn = fetch) {
  const base = 'https://api.hosting.ionos.com/dns/v1';
  const call = async (method, path, body) => {
    const r = await fetchFn(base + path, {
      method,
      headers: { 'X-API-Key': key, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(`IONOS-DNS ${method} ${path.replace(/\?.*$/, '')}: HTTP ${r.status}`);
    return r.status === 204 ? null : r.json();
  };
  return {
    async zone() {
      const zonen = await call('GET', '/zones');
      const z = zonen.find((x) => x.name === DOMAIN);
      if (!z) throw new Error(`Zone ${DOMAIN} nicht gefunden`);
      return z.id;
    },
    /** A-Eintrag je Name (genau einer erwartet). */
    async aEintraege(zoneId) {
      const out = [];
      for (const name of NAMEN) {
        const z = await call('GET', `/zones/${zoneId}?recordName=${encodeURIComponent(name)}&recordType=A`);
        const rec = (z.records ?? []).filter((r) => r.name === name && r.type === 'A');
        if (rec.length !== 1) throw new Error(`${name}: ${rec.length} A-Einträge statt 1`);
        out.push(rec[0]);
      }
      return out;
    },
    async setzen(zoneId, rec, ip) {
      await call('PUT', `/zones/${zoneId}/records/${rec.id}`, { content: ip, ttl: TTL, prio: rec.prio ?? 0, disabled: false });
    },
  };
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

/** n Prüfungen im Abstand von abstandMs; bricht ab, sobald das Ergebnis die Entscheidung nicht mehr ändern kann. */
async function pruefeVps(n, abstandMs, abbruchBei) {
  const erg = [];
  for (let i = 0; i < n; i++) {
    if (i) await warte(abstandMs);
    erg.push(await liefertAus(VPS_IP));
    if (erg[erg.length - 1] === abbruchBei) break;
  }
  return erg;
}

function ausgabe(aktion, text) {
  console.log(`${aktion}: ${text}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `aktion=${aktion}\ntext=${text.replace(/\n/g, ' ')}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `**${aktion}** – ${text}\n`);
}

async function main() {
  const key = process.env.IONOS_DNS_API_KEY?.trim();
  const nurPruefen = process.env.NUR_PRUEFEN === 'true';
  const erst = await liefertAus(VPS_IP);

  if (!key) {
    if (erst) return ausgabe('keine', 'VPS liefert aus (ohne DNS-Schlüssel nur Prüfung)');
    const vps = [erst, ...(await pruefeVps(2, 45000, true))];
    if (vps.some(Boolean)) return ausgabe('keine', 'VPS kurz nicht erreichbar, wieder da');
    return ausgabe('warnung', 'VPS liefert murmel.games nicht aus; ohne IONOS_DNS_API_KEY keine automatische Umschaltung');
  }

  const dns = ionosDns(key);
  const zoneId = await dns.zone();
  const recs = await dns.aEintraege(zoneId);
  const stand = dnsStand(recs.map((r) => r.content));

  let vps;
  if (stand === 'vps') {
    // Normalfall: eine erfolgreiche Prüfung genügt; sonst bis zu 3 Prüfungen, Abbruch beim ersten Erfolg.
    vps = erst ? [true] : [false, ...(await pruefeVps(2, 45000, true))];
  } else {
    // Notbetrieb oder gemischt: für die Rückkehr 5 Erfolge in Folge, Abbruch beim ersten Fehlschlag.
    vps = erst ? [true, ...(await pruefeVps(4, 60000, false))] : [false, ...(await pruefeVps(2, 45000, true))];
  }
  const webspace = vps.every((ok) => !ok) ? await liefertAus(WEBSPACE_IP) : true;
  const { aktion, grund } = entscheide({ stand, vps, webspace });
  const info = `DNS ${stand}, VPS-Prüfungen ${vps.map((ok) => (ok ? '✓' : '✗')).join('')}, Webspace ${webspace ? '✓' : '✗'} – ${grund}`;

  if (aktion === 'keine' || nurPruefen) return ausgabe(nurPruefen && aktion !== 'keine' ? 'keine' : aktion, (nurPruefen && aktion !== 'keine' ? `[nur Prüfung, würde: ${aktion}] ` : '') + info);
  const ziel = aktion === 'zum-notbetrieb' ? WEBSPACE_IP : VPS_IP;
  for (const rec of recs) if (rec.content !== ziel) await dns.setzen(zoneId, rec, ziel);
  const nachher = dnsStand((await dns.aEintraege(zoneId)).map((r) => r.content));
  ausgabe(aktion, `${info}; DNS jetzt ${nachher} (wirksam nach höchstens ${TTL / 60} min)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    ausgabe('fehler', String(e?.message ?? e));
    process.exitCode = 1;
  });
}
