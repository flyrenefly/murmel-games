// Mirrors dist/ to the webspace via SFTP (used by .github/workflows/deploy.yml).
// Uploads all files and removes remote files that no longer exist locally.
// The server key must match one of the pinned fingerprints (deploy/ionos_known_hosts).
//
// Env: SFTP_HOST, SFTP_USER, SFTP_PASSWORD. Usage: node tools/deploy-sftp.mjs dist

import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import SftpClient from 'ssh2-sftp-client';

const localRoot = process.argv[2] ?? 'dist';
const { SFTP_HOST: host, SFTP_USER: username, SFTP_PASSWORD: password } = process.env;
if (!host || !username || !password) throw new Error('SFTP_HOST, SFTP_USER and SFTP_PASSWORD are required');

// ssh-keygen -lf deploy/ionos_known_hosts
const PINNED = new Set([
  'psLDE8kfhoS9GWrc/GTrdlPvyKPcWcGZv2JxOCvwF3w', // RSA
  '1gx2w8Rtv3wCgi7Jh8myf/KVd72cRQbow03UP8P095Q', // ED25519
]);

function localFiles(dir, rel = '') {
  const out = [];
  for (const name of readdirSync(join(dir, rel))) {
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(join(dir, r)).isDirectory()) out.push(...localFiles(dir, r));
    else out.push(r);
  }
  return out;
}

async function remoteFiles(sftp, dir = '.', rel = '') {
  const out = [];
  for (const e of await sftp.list(rel ? posix.join(dir, rel) : dir)) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.type === 'd') out.push(...(await remoteFiles(sftp, dir, r)));
    else out.push(r);
  }
  return out;
}

const sftp = new SftpClient();
await sftp.connect({
  host,
  port: 22,
  username,
  password,
  readyTimeout: 30000,
  hostVerifier: (key) => PINNED.has(createHash('sha256').update(key).digest('base64').replace(/=+$/, '')),
});
try {
  const files = localFiles(localRoot);
  const dirs = new Set(files.map((f) => posix.dirname(f)).filter((d) => d !== '.'));
  for (const d of [...dirs].sort()) await sftp.mkdir(d, true);
  let n = 0;
  for (const f of files) {
    await sftp.fastPut(join(localRoot, f), f);
    n++;
  }
  const keep = new Set(files);
  let removed = 0;
  for (const f of await remoteFiles(sftp)) {
    if (!keep.has(f)) {
      await sftp.delete(f);
      removed++;
    }
  }
  console.log(`uploaded ${n} files, removed ${removed} old files`);
} finally {
  await sftp.end();
}
