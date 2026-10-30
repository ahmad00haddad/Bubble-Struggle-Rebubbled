// Builds a self-contained copy of the game for HTML5 portals (itch.io, CrazyGames...):
// relative asset paths, talks to the live server, invite links point at the live site.
// Output: dist-portal/ and orb-lancers-web.zip (upload the zip as an HTML game).
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const LIVE = process.env.LIVE_URL ?? 'https://orb-lancers.ahmad000haddad.workers.dev';
rmSync('dist-portal', { recursive: true, force: true });
rmSync('orb-lancers-web.zip', { force: true });
execSync('npx vite build --base=./ --outDir ../dist-portal --emptyOutDir', {
  cwd: 'client',
  stdio: 'inherit',
  env: { ...process.env, VITE_SERVER_URL: LIVE, VITE_PUBLIC_URL: LIVE },
});
execSync(`powershell -NoProfile -Command "Compress-Archive -Path dist-portal/* -DestinationPath orb-lancers-web.zip"`, { stdio: 'inherit' });
console.log('\nReady: orb-lancers-web.zip');
