// wrangler's static-assets binding requires the directory to exist, even in dev
// before the client has been built once.
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
const dir = new URL('../client/dist/', import.meta.url);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL('index.html', dir), '<!doctype html><title>Orb Lancers</title><p>Client not built yet. Run <code>npm run build</code> or use the Vite dev server on :5173.</p>');
}
