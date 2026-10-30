// Builds a self-contained copy of the game for HTML5 portals (itch.io, CrazyGames...):
// relative asset paths, talks to the live server, invite links point at the live site.
// Output: dist-portal/ and orb-lancers-web.zip (upload the zip as an HTML game).
// PORTAL=crazygames adds the CrazyGames SDK (ads) and writes orb-lancers-crazygames.zip instead.
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const PORTAL = process.argv[2] ?? process.env.PORTAL ?? '';
const ZIP = PORTAL ? `orb-lancers-${PORTAL}.zip` : 'orb-lancers-web.zip';
const LIVE = process.env.LIVE_URL ?? 'https://orb-lancers.ahmad000haddad.workers.dev';
rmSync('dist-portal', { recursive: true, force: true });
rmSync(ZIP, { force: true });
execSync('npx vite build --base=./ --outDir ../dist-portal --emptyOutDir', {
  cwd: 'client',
  stdio: 'inherit',
  env: { ...process.env, VITE_SERVER_URL: LIVE, VITE_PUBLIC_URL: LIVE, VITE_PORTAL: PORTAL },
});
// Python's zipfile writes forward-slash paths; PowerShell 5's Compress-Archive writes backslashes,
// which portals cannot resolve (assets/... returns 404).
execSync(`python -c "import zipfile,os;z=zipfile.ZipFile('${ZIP}','w',zipfile.ZIP_DEFLATED);[z.write(os.path.join(r,f),os.path.relpath(os.path.join(r,f),'dist-portal').replace(os.sep,'/')) for r,_,fs in os.walk('dist-portal') for f in fs];z.close()"`, { stdio: 'inherit' });
console.log(`
Ready: ${ZIP}`);
