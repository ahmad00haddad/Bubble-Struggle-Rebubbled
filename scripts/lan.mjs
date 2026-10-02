// Play on the same Wi-Fi/LAN with almost no lag: one PC runs the game server, everyone else opens its address.
//   npm run lan        then share the printed http://<this PC>:8787 address
// Both servers run on this PC, so ping is a few milliseconds instead of the trip to Cloudflare.
import { spawn, spawnSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const build = spawnSync(npm, ['run', 'build'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (build.status !== 0) process.exit(build.status ?? 1);

const ips = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n && n.family === 'IPv4' && !n.internal)
  .map((n) => n.address);
console.log('\nShare one of these with the other players (same network, browser):');
for (const ip of ips) console.log(`   http://${ip}:8787`);
console.log('\nIf they cannot connect, allow Node/Wrangler through the Windows firewall (private network).\n');

const server = spawn('npx', ['wrangler', 'dev', '--ip', '0.0.0.0', '--port', '8787', '--persist-to', process.env.TEMP ? `${process.env.TEMP}/orb-state` : '/tmp/orb-state'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
server.on('exit', (code) => process.exit(code ?? 0));
