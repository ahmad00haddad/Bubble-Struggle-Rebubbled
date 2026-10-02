// Bundles tests/balance/cli.ts (resolving @orb/shared) and runs it. Usage: npm run balance -- --seeds 20
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(mkdtempSync(join(tmpdir(), 'orb-balance-')), 'cli.mjs');
await build({
  entryPoints: [join(root, 'tests/balance/cli.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out,
  alias: { '@orb/shared': join(root, 'shared/src/index.ts') },
  logLevel: 'error',
});
await import(pathToFileURL(out).href);
