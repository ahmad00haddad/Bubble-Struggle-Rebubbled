// Measures round-trip time to freshly created rooms: SERVER=https://your.workers.dev ROOMS=10 npm run rtt
// Rooms close to you answer in a few ms; a room placed in a far region shows 60+ ms.
import WebSocket from 'ws';
const BASE = process.env.SERVER ?? 'https://orb-lancers.ahmad000haddad.workers.dev'; const WS = BASE.replace(/^http/, 'ws');
const rooms = Number(process.env.ROOMS ?? 4);
const all = [];
for (let r = 0; r < rooms; r++) {
  const { code } = await fetch(`${BASE}/api/rooms`, { method: 'POST' }).then((x) => x.json());
  const ws = new WebSocket(`${WS}/api/rooms/${code}/ws?name=t&token=`);
  await new Promise((res) => ws.on('open', res));
  const samples = [];
  for (let i = 0; i < 12; i++) {
    const t0 = performance.now();
    ws.send('ping');
    await new Promise((res) => { const h = (d) => { if (String(d) === 'pong') { ws.off('message', h); res(); } }; ws.on('message', h); setTimeout(res, 3000); });
    samples.push(performance.now() - t0);
    await new Promise((res) => setTimeout(res, 80));
  }
  samples.shift();
  samples.sort((a, b) => a - b);
  all.push(samples[Math.floor(samples.length / 2)]);
  ws.close();
}
console.log('median RTT per room (ms):', all.map((x) => Math.round(x)).join(', '));
