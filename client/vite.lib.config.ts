import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Builds the game as ONE self-contained ES module exposing `mountGame()`,
 * for host apps (e.g. Lovable) that import it at runtime:
 *   const { mountGame } = await import('https://<worker>/embed/orb-lancers.js')
 * Output: client/dist/embed/orb-lancers.js (served by the Worker with CORS).
 */
export default defineConfig({
  resolve: {
    alias: { '@orb/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
  },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  publicDir: false,
  build: {
    outDir: 'dist/embed',
    emptyOutDir: true,
    minify: true,
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    lib: {
      entry: fileURLToPath(new URL('./src/embed.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'orb-lancers.js',
    },
  },
});
