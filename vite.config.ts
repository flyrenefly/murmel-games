import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths so the build works in any webspace folder.
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      // Game plus the crawlable info page (SEO).
      input: { main: resolve(__dirname, 'index.html'), ueber: resolve(__dirname, 'ueber.html') },
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
