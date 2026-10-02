# ORB LANCERS

An original, browser-based **online co-op** arcade game in the classic
bubble-popping genre. Up to **four** *Lancers* (round-helmeted divers with tether
harpoons) pop bouncing **orbs** that split into smaller orbs, across 25
levels with hazards (floor spikes, fast red orbs, timed platforms, bombs),
each player on their own device, in the same live game world.

- **Client:** Phaser 3 + TypeScript + Vite
- **Server:** Cloudflare Workers + Durable Objects (one object per room) + WebSockets (Hibernation API)
- **Server-authoritative:** clients send *inputs only*; the room simulates everything
- **Free-tier friendly:** inputs on change, compact 30 Hz snapshots, no polling, no per-frame storage

All names, characters, art (procedurally generated), sounds (synthesized),
levels and UI are original. Nothing is taken from any commercial game.

> Full design write-up (diagrams, responsibility matrix, protocol, lifecycle,
> cost strategy): [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## Quick start

```bash
npm install
npm run dev          # Worker on :8787 + Vite client on :5173
```

Open **two browser windows** (or one normal + one private window) at
<http://localhost:5173>:

| Window A                         | Window B                                   |
|----------------------------------|--------------------------------------------|
| PLAY ONLINE → nickname → CREATE ROOM | PLAY ONLINE → nickname → type the code → JOIN ROOM |
| sees `ROOM CODE  K 7 P X 2 M`    | (or open the invite link `/?room=K7PX2M`)  |
| START                            | START → 3 · 2 · 1 · GO!                    |

**Other devices on your network:** Vite listens on `0.0.0.0`, so a phone or
second PC can open `http://<your-PC-LAN-IP>:5173`. The Vite dev server proxies
`/api` (HTTP and WebSocket) to Wrangler, so nothing else needs configuring.

**Over the internet:** deploy (below) and both players open the `workers.dev` URL.

### Scripts

| Command                 | What it does                                                    |
|-------------------------|-----------------------------------------------------------------|
| `npm run dev`           | Worker (`wrangler dev`, :8787) + client (`vite`, :5173)         |
| `npm run dev:worker`    | Worker + Durable Objects only                                   |
| `npm run dev:client`    | Phaser client only                                              |
| `npm test`              | Unit tests (simulation, physics, protocol, levels, room logic)  |
| `npm run test:e2e`      | Two real WebSocket bots play against a running Worker           |
| `npm run typecheck`     | Strict TypeScript for shared, worker and client                 |
| `npm run build`         | Client build → `client/dist` (+ embeddable `dist/embed/orb-lancers.js`) |
| `npm run deploy`        | Build client and deploy Worker + Durable Objects + static assets |

> **Windows tip:** if `wrangler dev` fails with `SQLITE_CANTOPEN`, the project
> path is too long for Windows' 260-character limit (local Durable Object state
> lives under `.wrangler/state/...`). Move the project to a shorter path, or run
> `npx wrangler dev --persist-to C:\tmp\orb-state`.

---

## Project structure

```
shared/      Pure TypeScript used by BOTH server and client (no DOM, no Workers APIs)
  src/constants/game.ts       every gameplay tunable (physics, sizes, scoring, timers, network)
  src/constants/controls.ts   key bindings
  src/types/                  LevelConfig, game state, events
  src/levels/levels.ts        the 10 levels (pure data) + validate.ts
  src/sim/GameSimulation.ts   deterministic world: players, orbs, tethers, power-ups
  src/sim/Match.ts            countdown → playing → level complete → … → game over / victory
  src/protocol/               message types, strict parser, snapshot codec, room codes
worker/      Cloudflare Worker + Durable Object
  src/index.ts                HTTP router (/api/rooms, /api/health, WebSocket upgrade, static assets)
  src/GameRoom.ts             Durable Object glue: hibernation API, alarms, 30 Hz loop, storage
  src/rooms/RoomCore.ts       ALL room logic, platform-independent (unit-tested in Node)
  src/networking/             CORS / origin checks, per-socket rate limiter
client/      Phaser 3 game
  src/embed.ts                mountGame(element, { serverUrl }) — the only host-facing API
  src/scenes/                 Boot, Menu, HowTo, Settings, Online, Lobby, Game
  src/game/                   LocalSource (solo) / NetSource (online) → one render interface
  src/networking/             NetClient (reconnect), NetSession, SnapshotBuffer, Prediction
  src/entities/               ArenaView, PlayerView, WorldLayers (orbs, tethers, power-ups)
  src/input/                  InputController (keyboard + touch)
  src/audio/                  AudioManager (synth placeholders, file-replaceable)
  src/assets/textures.ts      procedural art (replaceable by key)
  src/ui/                     HUD, buttons, panels, theme
integrations/lovable/         PlayPage.tsx — drop-in React route for Lovable
tests/                        vitest unit tests + e2e/multiplayer.e2e.mjs
wrangler.jsonc                Worker, DO binding, SQLite migration, assets, vars
```

---

## Architecture in one picture

```
 Phone/PC A ──WSS──┐                         ┌──WSS── Phone/PC B
  inputs on change │   Cloudflare Worker     │ inputs on change
  ◄─ 30 Hz snaps   └─► /api/rooms/CODE/ws ◄──┘ ◄─ 30 Hz snaps
                              │ idFromName(CODE)
                              ▼
                  Durable Object  GameRoom "CODE"
                  RoomCore → Match → GameSimulation (30 Hz, in memory)
                  storage: tiny room record only (names, reconnect tokens)
```

- **Authority:** the Durable Object owns positions, orbs, splits, collisions,
  tethers, damage, lives, score, timer, power-ups, level progression, victory
  and defeat. Clients send `{t:"in", s:seq, b:bits}` and never results.
- **Same code, two places:** `shared/src/sim` runs in the Durable Object for
  online play and in the browser for **solo** (solo costs nothing server-side).
- **Smoothness:** remote entities render ~100 ms in the past between two real
  snapshots; orbs are advanced with the shared physics between snapshots so
  bounces stay crisp; your own Lancer is predicted and reconciled.

---

## How rooms work

1. `POST /api/rooms` → the Worker generates a 6-character code from an
   unambiguous alphabet (no `I O 0 1`, 32⁶ ≈ 1 billion codes) and asks that
   code's Durable Object to `initRoom()`. If the code is already in use, it retries
   with a new one (collision-checked server-side).
2. Players connect to `GET /api/rooms/<CODE>/ws?name=<nick>&token=<token?>`.
   Codes are case-insensitive (`abc-234` → `ABC234`) and validated on the server.
3. The first message is `welcome {slot, token}`. The token lives in
   `sessionStorage` and lets the same tab rejoin its seat after a refresh or
   network drop. The URL also keeps `?room=CODE`, so refreshing rejoins automatically.
4. Lobby: both press **START** (ready). When both are ready, the countdown starts automatically.
5. A third player gets `error ROOM_FULL` (close code 4003). Unknown code → `ROOM_NOT_FOUND` (4004).
   Expired → `ROOM_EXPIRED` (4010).

**Room lifecycle:** `WAITING_FOR_PLAYER → PLAYER_JOINED → READY → COUNTDOWN →
PLAYING ⇄ PAUSED → LEVEL_COMPLETE → (next level) COUNTDOWN … → GAME_OVER / VICTORY →
REMATCH (both vote) or lobby / close`. `TIME_UP` restarts the level, costing
everyone a life.

**Disconnects:**
- Partner drops mid-game → the match **pauses** and the other player sees
  *PLAYER 2 DISCONNECTED* with a 60 s reconnect countdown and **Wait / Continue
  solo / Return to lobby**. The game never freezes silently.
- Reconnecting with the token puts the player back in the same seat (lives and
  score kept), followed by a 3-2-1 resume.
- Grace period expires → the seat is freed and the match continues solo. A new
  friend can then join that seat and drop into the running match.
- There is no client "host": slot 0 and slot 1 are symmetric; the Durable Object is the host.

**Cleanup (alarms):** unjoined rooms expire after 15 min, empty rooms after 2 min,
any room after 3 h. Results screens stay in memory for 3 min (for rematch votes),
then the room may hibernate. Expired rooms leave a 24 h tombstone so late
joiners see "expired" instead of "not found".

---

## WebSocket protocol

JSON text frames with short keys. Full types: `shared/src/protocol/messages.ts`.

**Client → server**

| message                  | meaning                                              |
|--------------------------|------------------------------------------------------|
| `{"t":"in","s":12,"b":5}`| input changed: seq 12, bits (1 left, 2 right, 4 shoot) |
| `{"t":"ready","v":true}` | lobby ready / START                                  |
| `{"t":"pause"}` / `{"t":"resume"}` | pause both players / resume via countdown  |
| `{"t":"rematch"}`        | vote for a rematch (needs both)                      |
| `{"t":"solo"}`           | continue without a disconnected partner              |
| `{"t":"lobby"}`          | return the room to the lobby                         |
| `{"t":"leave"}`          | give up the seat                                     |
| `ping` (plain text)      | answered with `pong` by the runtime **without waking** the Durable Object |

**Server → client**

| message   | when                                                                 |
|-----------|----------------------------------------------------------------------|
| `welcome` | after joining: `{slot, token, code}`                                 |
| `room`    | any lobby/phase/seat change: `{phase, inMatch, seats[], pause?, grace?}` |
| `level`   | when a level loads: `{i, n, cfg: LevelConfig}` (static data sent once) |
| `snap`    | 30 Hz while playing (~4 Hz while frozen, none on results screens)    |
| `error`   | `{code, msg}` (`ROOM_FULL`, `ROOM_NOT_FOUND`, `ROOM_EXPIRED`, `RATE_LIMIT`, `REPLACED`, …) |

Snapshot tuples (numbers rounded to 0.1):
```
p: [slot, x, life, lives, score, flags, shield10, speed10, dbl10, lastSeq, ticksSince, facing]
b: [id, size, x, y, vx, vy]      h: [id, owner, x, tipY]      u: [id, type, x, y, life10]
e: [{tick, k:"pop", id, s, x, y, by, pts}, …]   // events, replayed at their tick
```

**Validation:** strict message parsing (unknown types ignored), input bits
masked, sequence numbers must increase, ≤1 KB frames, 40 msg/s soft limit,
120 msg/s kick, server-side shoot cooldown and tether limit, movement clamped
by the server, scores and power-ups computed only on the server.

---

## Controls

| Action | Keys (both schemes control *your* Lancer) |
|--------|-------------------------------------------|
| Move   | ← → or A D                               |
| Shoot  | Space or Q                               |
| Pause  | Esc or P                                 |
| Menus  | ↑ ↓ + Enter, or mouse/touch              |

Touch devices automatically get ◀ ▶ FIRE buttons.

**Change controls:** edit `shared/src/constants/controls.ts` (values are
`KeyboardEvent.code` strings). Nothing else references keys directly.
Gamepads or other inputs can call `InputController.setVirtual(...)`.

---

## Gameplay values

Everything is in `shared/src/constants/game.ts`: orb radii / bounce heights /
speeds / points, gravity, player speed, lives, respawn and invulnerability
times, tether speed / cooldown / limits, power-up durations, scoring bonuses,
match timings, room timeouts and network rates. Server and client import the
same file.

Scoring: small orb 200 · medium 150 · large 100 · huge 50 · pickup 50 ·
level clear 1000 · time bonus 10/s · survival (no hit) 500.

---

## Hazards

All optional fields on `LevelConfig`, simulated on the server:

| Field | Effect |
|-------|--------|
| `spikes: [{ x, w }]` | Floor strip that hurts any Lancer standing on it |
| bubble `fast: true` | Red orb, 1.5× speed; its children stay fast |
| platform `cycle: { on, off, offset? }` | Platform appears/disappears on a timer (blinks 1 s before vanishing) |
| `bombs: { every, fuse, radius, firstAt? }` | Bombs drop from the ceiling, land, and explode after `fuse` s |

Tunables: `HAZARDS` in `shared/src/constants/game.ts`. Solo testing a level: `/?level=19` then PLAY SOLO. Levels play in order of `difficulty.rating`.

## 2–4 players

Rooms hold up to 4 (`ROOM.maxPlayers`). A match starts when at least 2 are
seated and everyone seated pressed START. Seats 3 and 4 spawn beside the
level's two spawn points. Players can drop into a running match through a free seat.

## How to add a level

Append an object to `shared/src/levels/levels.ts`:

```ts
{
  id: 'sky-forge',
  name: 'Sky Forge',
  timeLimit: 120,                       // seconds
  playerSpawnPoints: [380, 580],        // x for P1, P2 (arena is 960×480, floor y=480)
  platforms: [{ x: 300, y: 220, w: 360, h: 16 }],
  bubbles: [
    { size: 3, x: 200, y: 110 },                    // 0 small … 3 huge
    { size: 2, x: 760, y: 140, velocityX: -108 },
  ],
  powerUps: {
    dropChance: 0.15,
    pool: { shield: 3, doubleHarpoon: 2, speedBoost: 2, extraTime: 1, extraLife: 1 },
    placed: [{ type: 'shield', x: 480, y: 40, delay: 10 }],
  },
  difficulty: { rating: 7, bubbleSpeed: 1.15 },
  theme: { sky: [0x101a3a, 0x3a2a6a], accent: 0x7ff3ff, orb: 0xff5d8f },
}
```

Run `npm test`. The level validator checks bounds, platform heights (players
must fit underneath), overlapping spawns, and unknown power-ups.

## How to add a power-up

1. Add the name to `POWERUP_TYPES` (and a duration in `POWERUP`, if timed) in `shared/src/constants/game.ts`.
2. Implement its effect in `applyPowerUp()` in `shared/src/sim/GameSimulation.ts`
   (for timed effects, add a timer field to `PlayerState`, decrement it in `step()`, and include it in the snapshot codec).
3. Give it an icon in `drawPowerUp()` (`client/src/assets/textures.ts`), a label in
   `PU_LABEL` (GameScene) and a line in HowToScene.
4. Add it to some levels' `pool` / `placed`, and add a unit test in `tests/simulation.test.ts`.

The server decides drops (seeded RNG) and pickups; clients only display them.

## How to replace assets

- **Art:** all textures have stable keys (see `TEXTURES` in
  `client/src/assets/textures.ts`, e.g. `lancer-0-1`, `pu-shield`, `heart`).
  Load your images with the same keys in `BootScene.preload()`. Existing keys
  are never regenerated. Generated art is drawn at 2× (`TEX_SCALE`), so supply
  2× images or adjust the scale.
- **Sounds:** `audio.load('split', '/audio/split.ogg')` (keys in
  `client/src/audio/AudioManager.ts`). Loaded files replace the synthesized
  placeholder for that key.
- **Fonts:** Google Fonts *Press Start 2P* and *Chakra Petch* (OFL), set in
  `client/src/config/clientConfig.ts`.

---

## Environment variables

| Where            | Name               | Purpose                                                      |
|------------------|--------------------|--------------------------------------------------------------|
| `wrangler.jsonc` | `ALLOWED_ORIGINS`  | Comma-separated origins allowed to use the API (your Lovable domain), or `*` |
| `wrangler.jsonc` | `ENVIRONMENT`      | Reported by `/api/health`                                    |
| `wrangler.jsonc` | `LOG_LEVEL`        | `info` (room/match events) or `debug` (every join/leave)     |
| `.dev.vars`      | same names         | Local overrides for `wrangler dev` (copy `.dev.vars.example`)|
| client build     | `VITE_SERVER_URL`  | Worker URL when the client is hosted elsewhere (defaults to same origin) |

The client also accepts `?server=https://…` in the URL, or
`mountGame(el, { serverUrl })`.

---

## Production deployment (free tier)

```bash
npx wrangler login
npm run deploy
```

This builds the client and deploys **one Worker** that serves the game, the
API, the WebSockets and the Durable Objects at
`https://orb-lancers.<your-account>.workers.dev` (WSS is automatic).
The Durable Object namespace is created by the `v1` migration in `wrangler.jsonc`
(`new_sqlite_classes`, which the Free plan requires). No dashboard steps are needed.

Checks after deploying:
```bash
curl https://orb-lancers.<account>.workers.dev/api/health
SERVER=https://orb-lancers.<account>.workers.dev npm run test:e2e
```

Then set `ALLOWED_ORIGINS` to your real domains and redeploy. For extra abuse
protection, add a Cloudflare WAF rate-limiting rule on `POST /api/rooms`.

### Free-tier budget (be realistic)

- Durable Objects on the Free plan: about 100,000 requests/day (incoming WS
  messages count 20:1) and 13,000 GB-s/day of duration. A live room is ~128 MB
  of wall time, so roughly **28 room-hours of active play per day**. Lobby rooms
  hibernate and cost almost nothing; solo play never touches the server.
- Per room: ~2 × 3–6 input messages/s plus a ping every 3 s.
- Storage writes happen only on join/leave/ready, never per frame.

Not unlimited. If the game grows, upgrade to Workers Paid ($5/mo) or move
`RoomCore` (which has no Cloudflare dependencies) behind a Node `ws` server.

---

## Lovable integration

Lovable stays the **website shell**: landing page, navigation, accounts later.
The Phaser game stays a self-contained module that Lovable only *mounts*.
No gameplay lives in React, and the game doesn't depend on Lovable's AI being online.

**Option A — mount the module (recommended):** copy
[`integrations/lovable/PlayPage.tsx`](integrations/lovable/PlayPage.tsx) into the
Lovable app as a `/play` route and set `VITE_ORB_SERVER_URL` to your Worker URL. It
imports `https://<worker>/embed/orb-lancers.js` (served with CORS) and calls
`mountGame(div, { serverUrl })`. Invite links work: `/play?room=K7PX2M`.
Live demo of this pattern: `/embed-demo.html` on your Worker.

**Option B — iframe:** `<iframe src="https://<worker>/" allow="fullscreen; autoplay; clipboard-write">`.

---

## Testing

- `npm test`: 71 unit tests covering orb physics (floor/wall/platform bounces,
  consistent heights), splitting, smallest-orb destruction, rising-edge shooting,
  tether limits, damage/shield/respawn/game over, every power-up, seeded drops,
  determinism, match flow (countdown → clear → next level → victory, time up,
  pause), protocol parsing (rejects cheating messages), the snapshot codec,
  room codes, nicknames, all 10 levels, and the room lifecycle (join, room full,
  invalid room, ready → countdown, authoritative inputs, duplicate sequence
  numbers, disconnect → pause → reconnect, continue solo, grace expiry → drop-in,
  lobby, leave, rematch voting, rate limiting, expiry/tombstones, hibernation
  restore, room independence, partner missing at the next level).
- `npm run test:e2e` (needs `npm run dev:worker`): two real WebSocket clients
  create and join a room, check ROOM_FULL and invalid rooms, move simultaneously,
  play until the server reports pops, and confirm both clients saw identical pops,
  scores and timer. Then they disconnect, reconnect, pause/resume, run a second
  independent room, return to the lobby, leave, play to game over, and require
  both votes for a rematch.
- Browser testing tip: `?timerLoop=1` makes Phaser use a timer loop instead of
  `requestAnimationFrame` (for background or hidden tabs during automated tests).
