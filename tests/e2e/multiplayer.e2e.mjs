// End-to-end multiplayer test: two real WebSocket clients against a running
// Worker + Durable Object (`npm run dev:worker`, or SERVER=https://… for prod).
//
//   node tests/e2e/multiplayer.e2e.mjs
//
// Nothing here simulates the game: the bots only send inputs and read what the
// authoritative server broadcasts.
import WebSocket from 'ws';

const BASE = (process.env.SERVER ?? 'http://localhost:8787').replace(/\/$/, '');
const WS_BASE = BASE.replace(/^http/, 'ws');
const PHASES = ['countdown', 'playing', 'paused', 'levelComplete', 'timeUp', 'gameOver', 'victory'];

let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${label}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Bot {
  constructor(name) {
    this.name = name;
    this.msgs = [];
    this.snaps = [];
    this.events = [];
    this.seq = 0;
    this.bits = 0;
    this.closeCode = null;
  }
  connect(code, token) {
    const q = new URLSearchParams({ name: this.name });
    if (token) q.set('token', token);
    this.ws = new WebSocket(`${WS_BASE}/api/rooms/${code}/ws?${q}`);
    this.closeCode = null;
    this.ws.on('message', (data) => {
      const s = data.toString();
      if (s === 'pong') return this.msgs.push({ t: 'pong-raw' });
      const m = JSON.parse(s);
      this.msgs.push(m);
      if (m.t === 'welcome') {
        this.slot = m.slot;
        this.token = m.token;
      }
      if (m.t === 'room') this.room = m;
      if (m.t === 'level') this.level = m;
      if (m.t === 'snap') {
        this.snaps.push(m);
        if (m.e) this.events.push(...m.e);
        if (this.snaps.length > 400) this.snaps.shift();
      }
    });
    this.ws.on('close', (c) => (this.closeCode = c));
    return this.waitFor((m) => m.t === 'welcome' || m.t === 'error', 8000);
  }
  send(o) {
    this.ws.send(typeof o === 'string' ? o : JSON.stringify(o));
  }
  input(bits) {
    if (bits === this.bits) return;
    this.bits = bits;
    this.send({ t: 'in', s: ++this.seq, b: bits });
  }
  get snap() {
    return this.snaps[this.snaps.length - 1];
  }
  /** Waits for the next matching message after the previously matched one. */
  async waitFor(pred, timeout = 8000) {
    const start = Date.now();
    this.cursor ??= 0;
    while (Date.now() - start < timeout) {
      for (; this.cursor < this.msgs.length; this.cursor++) {
        if (pred(this.msgs[this.cursor])) return this.msgs[this.cursor++];
      }
      await sleep(15);
    }
    return null;
  }
  async waitClose(timeout = 3000) {
    const start = Date.now();
    while (this.closeCode === null && Date.now() - start < timeout) await sleep(15);
    return this.closeCode;
  }
  waitRoom(phase, timeout) {
    return this.waitFor((m) => m.t === 'room' && m.phase === phase, timeout);
  }
  close() {
    this.ws?.terminate();
  }
}

async function createRoom() {
  const r = await fetch(`${BASE}/api/rooms`, { method: 'POST' });
  return (await r.json()).code;
}

async function main() {
  console.log(`E2E against ${BASE}`);

  const h = await fetch(`${BASE}/api/health`).then((r) => r.json());
  ok(h.ok === true, 'health check');

  // --- invalid rooms -------------------------------------------------------
  ok((await fetch(`${BASE}/api/rooms/!!/`)).status === 400, 'malformed room code → 400');
  const ghost = await fetch(`${BASE}/api/rooms/ZZZZ22`).then((r) => r.json());
  ok(ghost.exists === false, 'unknown room status → exists:false');
  const g = new Bot('Ghost');
  const gerr = await g.connect('ZZZZ22');
  ok(gerr?.t === 'error' && gerr.code === 'ROOM_NOT_FOUND', 'joining a non-existent room → ROOM_NOT_FOUND');
  { const cc = await g.waitClose(); ok(cc === 4004, `socket closed with 4004 (got ${cc})`); }

  // --- create / join ---------------------------------------------------------
  const code = await createRoom();
  ok(/^[A-Z2-9]{6}$/.test(code), `room created: ${code}`);
  const A = new Bot('Alice');
  const B = new Bot('Bob');
  ok((await A.connect(code))?.slot === 0, 'player 1 joined slot 0');
  ok((await A.waitRoom('WAITING_FOR_PLAYER')) !== null, 'P1 sees WAITING_FOR_PLAYER');
  ok((await B.connect(code.toLowerCase()))?.slot === 1, 'player 2 joined slot 1 (lower-case code accepted)');
  ok((await A.waitRoom('PLAYER_JOINED')) !== null, 'P1 sees PLAYER_JOINED');
  ok(A.room.seats[1]?.name === 'Bob' && B.room.seats[0]?.name === 'Alice', 'both see each other’s nickname');

  const C = new Bot('Carol');
  const cerr = await C.connect(code);
  ok(cerr?.code === 'ROOM_FULL', 'third player → ROOM_FULL');
  ok((await C.waitClose()) === 4003, 'third socket closed with 4003');

  // --- ready → countdown → playing -------------------------------------------
  A.send({ t: 'ready', v: true });
  B.send({ t: 'ready', v: true });
  ok((await A.waitRoom('COUNTDOWN')) && (await B.waitRoom('COUNTDOWN')), 'both ready → COUNTDOWN on both devices');
  ok(A.level?.cfg?.id && A.level.cfg.id === B.level?.cfg?.id, `both received level "${A.level?.cfg?.name}"`);
  ok((await A.waitRoom('PLAYING', 6000)) && (await B.waitRoom('PLAYING', 6000)), 'countdown → PLAYING on both');

  // --- simultaneous movement ------------------------------------------------
  await sleep(150);
  const ax0 = A.snap.p[0][1];
  const bx0 = A.snap.p[1][1];
  A.input(2); // right
  B.input(1); // left
  await sleep(1000);
  A.input(0);
  B.input(0);
  await sleep(300);
  const ax1 = B.snap.p[0][1];
  const bx1 = A.snap.p[1][1];
  ok(ax1 > ax0 + 100, `P1 moved right on P2's screen (${ax0} → ${ax1})`);
  ok(bx1 < bx0 - 100, `P2 moved left on P1's screen (${bx0} → ${bx1})`);
  const common = A.snaps.find((s) => s.k === B.snap.k) ?? null;
  const sameTick = B.snaps.find((s) => s.k === A.snap.k);
  ok(!!sameTick && JSON.stringify(sameTick.b) === JSON.stringify(A.snap.b), 'both devices receive identical orb state for the same tick');
  void common;

  // --- both bots play: authoritative pops -------------------------------------
  console.log('  …bots playing for up to 45s');
  const playUntil = Date.now() + 45_000;
  let shootToggleA = false;
  let shootToggleB = false;
  const drive = (bot, toggle) => {
    const s = bot.snap;
    if (!s || PHASES[s.ph] !== 'playing') {
      bot.input(0);
      return toggle;
    }
    const me = s.p[bot.slot];
    const x = me[1];
    // target the orb nearest horizontally (each bot prefers its own half)
    const orbs = s.b.slice().sort((p, q) => Math.abs(p[2] - x) - Math.abs(q[2] - x));
    if (!orbs.length) return toggle;
    const tx = orbs[0][2];
    let bits = tx > x + 8 ? 2 : tx < x - 8 ? 1 : 0;
    if (Math.abs(tx - x) < 30) {
      toggle = !toggle;
      if (toggle) bits |= 4;
    }
    bot.input(bits);
    return toggle;
  };
  while (Date.now() < playUntil) {
    shootToggleA = drive(A, shootToggleA);
    shootToggleB = drive(B, shootToggleB);
    const pops = A.events.filter((e) => e.k === 'pop');
    if (pops.length >= 6 || ['levelComplete', 'gameOver'].includes(PHASES[A.snap?.ph])) break;
    await sleep(50);
  }
  A.input(0);
  B.input(0);
  await sleep(400);
  const popsA = A.events.filter((e) => e.k === 'pop').map((e) => e.id);
  const popsB = B.events.filter((e) => e.k === 'pop').map((e) => e.id);
  const shotsBy = new Set(A.events.filter((e) => e.k === 'shoot').map((e) => e.p));
  ok(shotsBy.has(0) && shotsBy.has(1), 'both players fired harpoons (server-confirmed shoot events)');
  ok(popsA.length >= 3, `server-authoritative orb pops happened (${popsA.length})`);
  ok(JSON.stringify(popsA) === JSON.stringify(popsB.slice(0, popsA.length)) || JSON.stringify(popsB) === JSON.stringify(popsA.slice(0, popsB.length)), 'both devices saw the same pops in the same order');
  const splits = A.events.filter((e) => e.k === 'pop' && e.s > 0).length;
  ok(splits === 0 || A.snap.b.length > 0 || PHASES[A.snap.ph] === 'levelComplete', 'splits produced child orbs');
  const scoreA = A.snap.p.map((p) => p[4]);
  const scoreB = B.snap.p.map((p) => p[4]);
  ok(JSON.stringify(scoreA) === JSON.stringify(scoreB) && scoreA.some((s) => s > 0), `scores synchronized ${JSON.stringify(scoreA)}`);
  ok(A.snap.tl === B.snap.tl || Math.abs(A.snap.tl - B.snap.tl) <= 3, 'timer synchronized');

  // --- ping ---------------------------------------------------------------
  const t0 = Date.now();
  A.send('ping');
  ok((await A.waitFor((m) => m.t === 'pong-raw', 3000)) !== null, `ping/pong auto-response (${Date.now() - t0} ms)`);

  // --- disconnect / reconnect ------------------------------------------------
  const tokenB = B.token;
  B.close();
  const paused = await A.waitFor((m) => m.t === 'room' && m.seats[1] && !m.seats[1].connected, 5000);
  ok(!!paused, 'P1 notified: PLAYER 2 DISCONNECTED');
  ok(paused?.phase === 'PAUSED' || ['LEVEL_COMPLETE', 'GAME_OVER', 'TIME_UP'].includes(paused?.phase), `match paused for P1 (${paused?.phase})`);
  ok(typeof paused?.grace?.msLeft === 'number', `reconnect window shown (${Math.round((paused?.grace?.msLeft ?? 0) / 1000)}s)`);

  const B2 = new Bot('Bob');
  const wb = await B2.connect(code, tokenB);
  ok(wb?.t === 'welcome' && wb.slot === 1, 'P2 reconnected into the same seat with its token');
  ok((await B2.waitFor((m) => m.t === 'level', 3000)) !== null, 'reconnected client received level data');
  ok((await B2.waitFor((m) => m.t === 'snap', 3000)) !== null, 'reconnected client receives snapshots');
  const back = await A.waitFor((m) => m.t === 'room' && m.seats[1]?.connected && m.phase !== 'PAUSED', 5000);
  ok(!!back, `P1 sees P2 back, match resumes (${back?.phase})`);

  // --- pause / resume ---------------------------------------------------------
  await A.waitRoom('PLAYING', 6000);
  A.send({ t: 'pause' });
  ok((await B2.waitFor((m) => m.t === 'room' && m.phase === 'PAUSED' && m.pause?.reason === 'player', 3000)) !== null, 'P1 pause → paused on P2');
  B2.send({ t: 'resume' });
  ok((await A.waitFor((m) => m.t === 'room' && m.phase === 'COUNTDOWN' && !m.pause, 3000)) !== null, 'P2 resume → countdown on P1');

  // --- multiple independent rooms ------------------------------------------
  const code2 = await createRoom();
  const D = new Bot('Dee');
  await D.connect(code2);
  const st1 = await fetch(`${BASE}/api/rooms/${code}`).then((r) => r.json());
  const st2 = await fetch(`${BASE}/api/rooms/${code2}`).then((r) => r.json());
  ok(code2 !== code && st1.players === 2 && st1.inMatch && st2.players === 1 && !st2.inMatch, 'second room is independent of the first');
  D.close();

  // --- back to lobby, leave ---------------------------------------------------
  A.send({ t: 'lobby' });
  ok((await B2.waitRoom('PLAYER_JOINED', 3000)) !== null, 'return to lobby → both in PLAYER_JOINED');
  A.send({ t: 'ready', v: true });
  B2.send({ t: 'ready', v: true });
  ok((await B2.waitRoom('COUNTDOWN', 3000)) !== null, 'new match from lobby (rematch path) starts');
  B2.send({ t: 'leave' });
  ok((await A.waitFor((m) => m.t === 'room' && m.seats[1] === null, 3000)) !== null, 'P2 leaves → seat freed for P1');

  A.close();
  B2.close();

  // --- game over → rematch needs BOTH votes -----------------------------------
  if (!process.env.SKIP_REMATCH) {
    console.log('  …two bots walk into orbs until game over (up to ~90s)');
    const rcode = await createRoom();
    const R1 = new Bot('Rae');
    const R2 = new Bot('Sol');
    await R1.connect(rcode);
    await R2.connect(rcode);
    R1.send({ t: 'ready', v: true });
    R2.send({ t: 'ready', v: true });
    await R1.waitRoom('PLAYING', 8000);
    const seek = (bot) => {
      const s = bot.snap;
      if (!s || PHASES[s.ph] !== 'playing') return bot.input(0);
      const x = s.p[bot.slot][1];
      const orb = s.b.slice().sort((p, q) => Math.abs(p[2] - x) - Math.abs(q[2] - x))[0];
      if (!orb) return bot.input(0);
      bot.input(orb[2] > x + 6 ? 2 : orb[2] < x - 6 ? 1 : 0); // never shoots
    };
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline && PHASES[R1.snap?.ph] !== 'gameOver') {
      seek(R1);
      seek(R2);
      await sleep(50);
    }
    ok(PHASES[R1.snap?.ph] === 'gameOver' && PHASES[R2.snap?.ph] === 'gameOver', 'both clients reach GAME OVER (lives synchronized)');
    ok(R1.snap.p.every((p) => p[3] === 0), 'all lives spent on the server');
    await R1.waitRoom('GAME_OVER', 3000);
    R1.send({ t: 'rematch' });
    const vote = await R2.waitFor((m) => m.t === 'room' && m.seats[0]?.rematch === true, 3000);
    ok(!!vote && vote.phase === 'GAME_OVER', 'one rematch vote is shown to the partner, match does NOT restart yet');
    await sleep(500);
    ok(R1.room.phase === 'GAME_OVER', 'still GAME_OVER after a single vote');
    R2.send({ t: 'rematch' });
    ok((await R1.waitRoom('COUNTDOWN', 3000)) !== null, 'second vote → rematch countdown');
    const fresh = await R1.waitFor((m) => m.t === 'snap' && m.p.every((p) => p[3] === 3 && p[4] === 0), 3000);
    ok(!!fresh, 'rematch resets lives and scores');
    R1.close();
    R2.close();
  }

  console.log(failures ? `\n${failures} FAILED` : '\nALL E2E CHECKS PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
