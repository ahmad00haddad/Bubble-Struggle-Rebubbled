# ORB LANCERS — Architecture

An original co-op arcade game: two "Lancers" (small round-helmeted divers with
tether-harpoons) pop bouncing **orbs** that split into smaller orbs. Inspired by
the classic bubble-popping genre; all names, art, sounds, levels and UI are original.

---

## 1. Final architecture diagram

```
 Device A (browser)                                    Device B (browser)
 ┌──────────────────────────┐                          ┌──────────────────────────┐
 │ Lovable shell (/play)    │                          │ Lovable shell (/play)    │
 │  └─ mountGame(div)       │                          │  └─ mountGame(div)       │
 │     Phaser 3 canvas      │                          │     Phaser 3 canvas      │
 │     ├ InputController    │                          │     ├ InputController    │
 │     ├ Prediction (self)  │                          │     ├ Prediction (self)  │
 │     ├ SnapshotBuffer     │                          │     ├ SnapshotBuffer     │
 │     └ NetClient (WSS)    │                          │     └ NetClient (WSS)    │
 └───────────┬──────────────┘                          └───────────┬──────────────┘
             │  inputs (on change), ping                           │
             │  ◄── snapshots 15 Hz, room/level msgs               │
             ▼                                                     ▼
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ Cloudflare Worker  (worker/src/index.ts)                                      │
 │   POST /api/rooms            → generate code, init DO (collision-checked)     │
 │   GET  /api/rooms/:code      → room status (exists / full / expired)          │
 │   GET  /api/rooms/:code/ws   → WebSocket upgrade, forwarded to DO             │
 │   GET  /api/health           → health check                                   │
 │   *                          → static client assets (optional self-hosting)   │
 └────────────────────────────────────┬─────────────────────────────────────────┘
                                      │ idFromName(code)
                ┌─────────────────────┼─────────────────────┐
                ▼                     ▼                     ▼
      ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
      │ DO GameRoom ABC123│  │ DO GameRoom KJ72PX│  │ DO GameRoom 92LMQ7│
      │  RoomCore         │  │  (independent)    │  │  (independent)    │
      │  ├ seats[2]       │  └──────────────────┘  └──────────────────┘
      │  ├ Match (shared) │
      │  │ └ GameSimulation 30 Hz (authoritative)
      │  └ storage: room meta only (code, names, tokens) │
      └──────────────────┘
```

The **same** deterministic simulation code (`shared/src/sim`) runs:
- inside the Durable Object for online play (authoritative), and
- inside the browser for **solo** play only (no server needed, costs nothing).

Online clients never run the authoritative simulation. They predict only their
own horizontal movement and render everything else from server snapshots.

## 2. Client / server responsibility matrix

| Concern                         | Server (GameRoom DO)          | Client (Phaser)                                   |
|---------------------------------|-------------------------------|---------------------------------------------------|
| Room codes, join, seat, tokens  | **Owns**, validates           | Requests, stores reconnect token (sessionStorage) |
| Lobby ready / countdown         | **Owns** state machine        | Sends `ready`, renders                            |
| Player position / velocity      | **Authoritative**             | Predicts own X, reconciles; interpolates partner  |
| Input                           | Validates bits, seq, rate     | Samples keyboard/touch, sends on change           |
| Shooting / cooldown / max ropes | **Owns**                      | Sends shoot edge only                             |
| Harpoon travel + hits           | **Owns**                      | Renders (interpolated)                            |
| Orb physics / splits / pops     | **Owns**                      | Renders (interpolated + deterministic sub-tick)   |
| Player damage, lives, respawn   | **Owns**                      | Renders, plays FX                                 |
| Score, bonuses                  | **Owns**                      | Displays only                                     |
| Power-up drop / pickup / effect | **Owns** (seeded RNG)         | Displays only                                     |
| Timer                           | **Owns**                      | Displays                                          |
| Level load / complete / victory | **Owns**                      | Displays transitions                              |
| Pause / disconnect / rematch    | **Owns**                      | Sends requests, shows dialogs                     |
| Audio, particles, shake, UI     | —                             | **Owns** (driven by server events)                |

## 3. Folder structure

```
/
├─ package.json            npm workspaces + root scripts
├─ wrangler.jsonc          Worker + Durable Object + static assets config
├─ tsconfig.base.json
├─ vitest.config.ts
├─ shared/                 @orb/shared — pure TS, no DOM / no Workers APIs
│  └─ src/
│     ├─ constants/        game.ts (all tunables), controls.ts (key bindings)
│     ├─ types/            level.ts, state.ts
│     ├─ levels/           levels.ts (10 levels) + validate.ts
│     ├─ sim/              rng.ts, physics.ts, GameSimulation.ts, Match.ts
│     └─ protocol/         messages.ts, codec.ts, roomCode.ts, names.ts
├─ worker/
│  └─ src/
│     ├─ index.ts          HTTP router (Worker entry), exports GameRoom
│     ├─ GameRoom.ts       Durable Object glue (hibernation API, storage, alarms, loop)
│     ├─ rooms/RoomCore.ts pure room logic (testable in Node)
│     ├─ networking/       http helpers, rate limiter
│     └─ env.ts
├─ client/
│  ├─ index.html, vite.config.ts
│  └─ src/
│     ├─ main.ts / embed.ts   mountGame() API (Lovable / any host)
│     ├─ config/              client config (server URL, render sizes)
│     ├─ scenes/              Boot, Menu, HowTo, Settings, Online, Lobby, Game
│     ├─ entities/            PlayerView, OrbView, HarpoonView, PowerUpView
│     ├─ game/                LocalSource (solo), NetSource (online), RenderState
│     ├─ networking/          NetClient, SnapshotBuffer, Prediction, api.ts
│     ├─ input/               InputController (keyboard + touch)
│     ├─ audio/               AudioManager + synth recipes
│     ├─ assets/              procedural texture generation (replaceable)
│     └─ ui/                  theme, Button, Panel, TextInput
├─ integrations/lovable/   React wrapper example (GamePage.tsx)
├─ tests/                  unit tests (vitest) + e2e/ (real WebSocket bots)
└─ docs/ARCHITECTURE.md
```

## 4. WebSocket message protocol

JSON, short keys, one message type per frame. Connect:
`wss://<host>/api/rooms/<CODE>/ws?name=<nick>&token=<reconnectToken?>`

**Client → Server**

| `t`       | fields                 | meaning                                            |
|-----------|------------------------|----------------------------------------------------|
| `in`      | `s` seq, `b` bits      | input changed (bits: 1=left 2=right 4=shoot)       |
| `ready`   | `v` bool               | lobby ready toggle (both ready → countdown)        |
| `pause`   | —                      | request pause (pauses both)                        |
| `resume`  | —                      | resume (3-2-1 countdown)                           |
| `rematch` | —                      | vote rematch after game over / victory             |
| `solo`    | —                      | continue solo while partner is disconnected        |
| `lobby`   | —                      | return room to lobby                               |
| `leave`   | —                      | leave seat permanently                             |
| `ping` (plain text) | —            | latency probe every 3 s; answered by the runtime's auto-response without waking the DO |

**Server → Client**

| `t`       | fields                                                   |
|-----------|----------------------------------------------------------|
| `welcome` | `slot`, `token`, `code`                                  |
| `room`    | `code`, `phase`, `seats[2]`, `pause?`, `grace?`, `inMatch` |
| `level`   | `i` index, `n` total, `cfg` LevelConfig                  |
| `snap`    | compact snapshot (see §5), includes ticked events        |
| `pong`    | plain-text reply to `ping` (RTT measured client-side)    |
| `error`   | `code` (ROOM_FULL, ROOM_NOT_FOUND, ROOM_EXPIRED, BAD_REQUEST, RATE_LIMIT, SERVER_ERROR), `msg` |

WebSocket close codes: 4001 replaced by newer connection, 4003 room full,
4004 room not found, 4010 room expired, 4008 rate-limited, 4000 left.

## 5. Game state schema

Authoritative (server memory, `shared/src/types/state.ts`):

```
MatchState { phase, phaseTicks, levelIndex, sim }
SimState {
  tick, timeLeftTicks, status: running|cleared|timeup|gameover
  players[2]: { slot, active, x, facing, input, lives, score,
                life: alive|dead|out, respawnTimer, invuln,
                shield, speed, dbl (power-up timers), cooldown,
                lastSeq, ticksSinceSeq, hitThisLevel }
  bubbles[]:  { id, size(0..3), x, y, vx, vy }
  harpoons[]: { id, owner, x, tipY }
  powerups[]: { id, type, x, y, life, grounded }
}
```

Wire snapshot (`snap`, tuples, numbers rounded to 0.1):

```
{ t:"snap", k:tick, ph:phaseIdx, pt:phaseTicks, tl:timeLeftTicks, li:levelIndex,
  p:[[slot,x,life,lives,score,flags,shieldT,speedT,dblT,lastSeq,ticksSince,facing], …],
  b:[[id,size,x,y,vx,vy], …], h:[[id,owner,x,tipY], …], u:[[id,type,x,y,life], …],
  e:[[tick,kind,…args], …] }
```

Static data (platforms, theme, level name, player names) is **never** in the
snapshot — it is sent once via `level` / `room` messages (delta by message type).

## 6. Durable Object room lifecycle

```
           POST /api/rooms (init)
                  │
        WAITING_FOR_PLAYER ◄──────────── seat freed (leave / lobby)
                  │ 2nd player joins
            PLAYER_JOINED
                  │ both ready
                READY ──► COUNTDOWN ──► PLAYING ◄──► PAUSED (player / disconnect)
                                          │
                       ┌──────────────────┼──────────────────┐
                 all orbs popped       timer = 0         all players out
                       │                  │                   │
                LEVEL_COMPLETE          TIME_UP ──► (restart level / GAME_OVER)
                       │                                      │
                  NEXT_LEVEL ─► COUNTDOWN …            GAME_OVER / VICTORY
                                                              │
                                              REMATCH (both vote) or ROOM_CLOSE
```

Timers: unjoined room expires after 15 min; empty room (all sockets gone) is
deleted after 2 min; disconnected partner grace = 60 s (then auto "continue solo");
results screen kept in memory for 3 min (rematch votes), then the room may
hibernate (a woken room falls back to the lobby; persisted `ready` flags are
never trusted); hard room lifetime 3 h. Expired rooms leave a tiny tombstone (24 h) so joiners
see "ROOM EXPIRED" instead of "INVALID ROOM".

## 7. Level schema

```ts
LevelConfig {
  id: string; name: string; timeLimit: number /*s*/;
  playerSpawnPoints: [number, number];          // x for P1, P2
  platforms: { x, y, w, h }[];                  // arena coords, 960×480
  bubbles: { size: 0|1|2|3, x, y, velocityX?, velocityY? }[];
  powerUps: { dropChance, pool: {type: weight}, placed: {type,x,y,delay}[] };
  difficulty: { rating: 1..10, bubbleSpeed: multiplier };
  theme: { sky: [top,bottom], accent, orb }
}
```
Levels are pure data, validated by `validateLevel()` (unit-tested).

## 8. Networking strategy

- **Server tick 30 Hz**, snapshots **15 Hz** while things move, ~4 Hz while frozen
  (countdown/pause), none while game over.
- **Inputs sent only on change** (seq-numbered). The server queues one input per
  tick per player so the client timeline is preserved.
- **Client-side prediction** for own movement; **reconciliation** uses
  `lastSeq` + `ticksSince` from the snapshot to replay unacknowledged ticks.
- **Remote players / harpoons / power-ups**: interpolated with a 100 ms buffer
  against an estimated server clock.
- **Orbs**: interpolated by *deterministic sub-tick simulation* from the earlier
  snapshot (shared physics), so floor bounces stay crisp instead of being cut.
- **Events** (pop, hurt, pickup …) carry their tick and fire when the render
  clock reaches it, so sound/particles line up with visuals.
- Reconnect: exponential backoff with the room token; the DO swaps the socket.

## 9. Free-tier cost strategy

- Incoming WS messages are billed (20 msgs ≈ 1 request): inputs are sent only
  on change (~3–6/s while playing), ping every 3 s. No polling anywhere.
- Outgoing snapshots are compact tuples (~0.3–1 KB) at 15 Hz.
- WebSocket **Hibernation API**: lobby rooms hibernate; the game loop (setInterval)
  only runs while a match is active and stops at game over / when empty.
- Storage writes only on seat/ready changes (never per frame); SQLite-backed DOs
  (required on the Free plan).
- Aggressive cleanup via alarms (see §6). Solo mode never touches the server.
- Honest budget: an active room is ~128 MB × wall time. 13 000 GB-s/day free ≈
  ~28 room-hours/day; 100 000 requests/day free. Not unlimited.

## 10. Local testing strategy

1. `npm test` — unit tests: physics, split, collisions, scoring, power-ups,
   levels, codec, room codes, RoomCore lifecycle (fake sockets).
2. `npm run dev` — Wrangler (8787) + Vite (5173, proxies `/api` incl. WS).
   Open two browser windows (or a normal + private window) → Create / Join.
3. `npm run test:e2e` — two real WebSocket bot clients against `wrangler dev`:
   create, join, ready, countdown, simultaneous movement, authoritative pops,
   room full, invalid room, disconnect + reconnect, rematch.
4. LAN devices: Vite listens on 0.0.0.0 → open `http://<PC-LAN-IP>:5173` on a phone.

## 11. Production deployment strategy

- `npx wrangler login` → `npm run deploy` (builds client, deploys Worker + DO +
  static assets). Free `*.workers.dev` URL, WSS automatic.
- Lovable: either iframe the Worker-hosted game at `/play`, or import the
  client bundle and call `mountGame(el, { serverUrl })` from a React route.
  Set `VITE_SERVER_URL=https://orb-lancers.<account>.workers.dev`.
- `ALLOWED_ORIGINS` var restricts which sites may open rooms.
- Migration path: `RoomCore` has no Cloudflare dependencies; a Node `ws` server
  can host it unchanged behind a different transport if traffic grows.
