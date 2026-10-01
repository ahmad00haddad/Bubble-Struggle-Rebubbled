import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const WORKER_DEV = process.env.WORKER_DEV_URL ?? 'http://127.0.0.1:8787';

export default defineConfig({
  resolve: {
    alias: { '@orb/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    // In dev the client talks to its own origin; Vite forwards /api (incl. WebSockets)
    // to `wrangler dev`. This also makes LAN testing from a phone work.
    proxy: {
      '/api': { target: WORKER_DEV, changeOrigin: true, ws: true },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});
