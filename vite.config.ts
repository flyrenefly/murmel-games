import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** All files below dir, as paths with forward slashes. */
function files(dir: string, rel = ''): string[] {
  return readdirSync(join(dir, rel)).flatMap((name) => {
    const r = rel ? `${rel}/${name}` : name;
    return statSync(join(dir, r)).isDirectory() ? files(dir, r) : [r];
  });
}

/**
 * Content-Security-Policy without 'unsafe-eval': fengari-web builds two helpers with Function() when
 * it loads. Both are replaced by equivalent plain code (delete in sloppy mode returns false instead of
 * throwing, hence the try/catch). The third Function() only runs when Lua loads external JavaScript,
 * which Murmel never does. Fails the build if fengari changes, so the CSP never breaks silently.
 */
function cspSafeFengari(): Plugin {
  const swaps: [string, string][] = [
    ['Function("t","k","delete t[k]")', '((t,k)=>{try{return delete t[k]}catch{return false}})'],
    ['Function("return ()=>void 0;")', '(()=>()=>void 0)'],
  ];
  return {
    name: 'murmel-csp-fengari',
    transform(code, id) {
      if (!/fengari-web[\\/]dist[\\/]fengari-web\.bundle\.js$/.test(id.split('?')[0])) return null;
      let out = code;
      for (const [from, to] of swaps) {
        if (!out.includes(from)) throw new Error(`fengari-web: ${from} nicht gefunden – CSP-Anpassung prüfen`);
        out = out.split(from).join(to);
      }
      return { code: out, map: null };
    },
  };
}

/**
 * Offline play: writes dist/sw.js from src/sw-template.js with the list of files to precache
 * (everything but the level packs, which are cached when opened) and a version hash of them.
 */
function offline(): Plugin {
  let outDir = 'dist';
  return {
    name: 'murmel-offline',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      // statistik.html, forum.html, loesbarkeit.html and bestenliste.html need the server anyway: not precached
      const skip = /^(\.htaccess|sw\.js|statistik\.html|assets\/statistik-[\w-]+\.js|forum\.html|assets\/forumseite-[\w-]+\.js|loesbarkeit\.html|assets\/loesbarkeit-[\w-]+\.js|bestenliste\.html|assets\/bestenliste-[\w-]+\.js|robots\.txt|sitemap\.xml|og-image\.png|levels\/enigma\/.*\.json)$|\.map$/;
      const list = files(outDir).filter((f) => !skip.test(f)).sort();
      const template = readFileSync(resolve(__dirname, 'src/sw-template.js'), 'utf8');
      const hash = createHash('sha256').update(template);
      for (const f of list) hash.update(f).update(readFileSync(join(outDir, f)));
      const precache = ['./', ...list.filter((f) => f !== 'index.html')];
      const sw = template
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__PRECACHE__', JSON.stringify(precache));
      writeFileSync(join(outDir, 'sw.js'), sw);
    },
  };
}

/** Short commit of this build: shown in bug reports from the game ("Fehler melden"). */
function gameVersion(): string {
  const env = process.env.MURMEL_VERSION || process.env.GITHUB_SHA;
  if (env) return env.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  define: { __MURMEL_VERSION__: JSON.stringify(gameVersion()) },
  // Relative paths so the build works in any webspace folder.
  base: './',
  plugins: [cspSafeFengari(), offline()],
  // npm run dev: the API (server/, port 3000) under the same address as on the server
  server: { proxy: { '/api': 'http://localhost:3000' } },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      // Game plus the crawlable info page (SEO).
      input: { main: resolve(__dirname, 'index.html'), ueber: resolve(__dirname, 'ueber.html'),
        impressum: resolve(__dirname, 'impressum.html'),
        datenschutz: resolve(__dirname, 'datenschutz.html'),
        statistik: resolve(__dirname, 'statistik.html'),
        forumseite: resolve(__dirname, 'forum.html'),
        loesbarkeit: resolve(__dirname, 'loesbarkeit.html'),
        bestenliste: resolve(__dirname, 'bestenliste.html'),
        editor: resolve(__dirname, 'editor.html'),
      },
      output: {
        // Keep the big libraries in their own long-cacheable files.
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          return undefined;
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
