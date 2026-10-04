# Orb Lancers — agent handoff

Original online co-op arcade game (bubble-popping genre, no copyrighted names/art).
1–4 players, each on their own device, server-authoritative.

- Live: https://orb-lancers.ahmad000haddad.workers.dev (Cloudflare account ahmad000haddad@gmail.com, wrangler already logged in on the owner's PC)
- Repo: https://github.com/ahmad00haddad/Bubble-Struggle-Rebubbled (branch `main`)
- Deep docs: `README.md` (how-tos, protocol, deploy) and `docs/ARCHITECTURE.md`. Read those only when needed.
- The owner is not a developer and writes in Arabic. Do the work end-to-end, explain results simply.

## Stack and layout
- `shared/` — pure TS used by server AND client: `constants/game.ts` (all tunables), `sim/GameSimulation.ts` (deterministic world), `sim/Match.ts` (phases), `sim/hazards.ts`, `levels/levels.ts` (25 levels, sorted by `difficulty.rating`), `protocol/` (messages, snapshot codec, room codes).
- `worker/` — Cloudflare Worker + Durable Object. `rooms/RoomCore.ts` holds all room logic (platform-free, unit-tested); `GameRoom.ts` is the DO glue (hibernation API, 30 Hz loop, alarms); `index.ts` routes `/api/*` and serves `client/dist`.
- `client/` — Phaser 3 + Vite. `embed.ts` exports `mountGame(el, {serverUrl})`. Scenes in `scenes/`, rendering in `entities/`, networking (prediction, interpolation, reconnect) in `networking/`.
- `integrations/lovable/PlayPage.tsx` — React route that mounts the game. Simplest Lovable option: full-screen iframe of the live URL.
- `@orb/shared` is resolved by path aliases (tsconfig, vite, vitest, wrangler `alias`), not npm workspace links.

## Rules
- Version: `GAME_VERSION` in `shared/src/constants/game.ts` is shown top-right on the main menu. Bump it (1.1 → 1.2 …) with every change that is deployed, and say the new number when reporting.
- Server is authoritative: clients send only input bits; never let the client decide hits, score, power-ups.
- Gameplay changes go in `shared/` so server and solo mode stay identical. Add a unit test for each.
- Never send full state per frame, never write game state to storage (free-tier budget).
- Lovable (or any other agent) should only touch the website shell, never `shared/`, `worker/` or game logic. It once pushed levels directly into `shared/src/levels/levels.ts`; always `git pull` before editing.

## Commands
- `npm install`, `npm test` (410 unit tests), `npm run typecheck`
- `npm run dev` (worker :8787 + client :5173), `npm run test:e2e` (needs worker running; `SERVER=<url>` to test production)
- `npm run deploy` (builds client + deploys Worker/DO/assets)
- Windows: wrangler dev fails with `SQLITE_CANTOPEN` if the project path is long; clone to a short path such as `C:\dev\orb-lancers`, or use `--persist-to C:\tmp\orb-state`.
- Browser testing in hidden/background tabs: add `?timerLoop=1`. Jump to a solo level: `?level=19` then PLAY SOLO.

## Current state (2026-10-02)
- Done and verified: online rooms (create/join/code/invite link), lobby, countdown, pause, disconnect → pause → reconnect, continue solo, drop-in, rematch (needs all votes), 25 levels, 5 power-ups, hazards (floor spikes, fast red orbs, timed platforms, bombs), 2–4 players, touch buttons, synthesized audio, deployed and e2e-tested in production.
- Not yet verified: a real match with 4 humans on 4 devices; Lovable integration (owner reported errors, details never shared — ask for the exact error text).
- Gameplay depth pass (2026-10): player-count scaling (`shared/src/sim/scaling.ts`: speed/time/drops/heat per 1-4 players), special orbs (`shared/src/sim/specials/`: hardshell, ghost, twin fuse, sync, pincer, heavy, sequence, quad-lock), anchor harpoon pickup, Surprise Director sky events (`sim/director.ts`: gift crate, comet, gravity wobble, hail), heat governor, multiplayer chaos pickup (jam, flip, slow, tether, swap; host switch in the lobby), levels 1-10 retuned and given one new mechanic each. Multiplayer also promotes some ordinary orbs to specials (`ScaleProfile.specialShare`).
- Rare crates (v1.2, `RARE` in constants, effects in `GameSimulation.applyRare`): shrink time, heavy boots, hot potato, wide tether, pinata, gamble chest, decoy (looks like a shield, drops a bomb), slow orbs, freeze, magnet core, double or nothing, boomerang; team-only baton and rescue flare. They join every drop pool and Gift Crates; client names/descriptions live in `client/src/config/powerups.ts` and the in-game guide (`PowerUpsScene`).
- Latency (v1.3): snapshots run at 30 Hz with a 70 ms interpolation delay. New rooms use a Durable Object location hint (`DO_LOCATION_HINT` in wrangler.jsonc, currently "me"); about 60% of rooms land near Amman (1-10 ms), the rest 58+ ms. Measured: "eeur" and no hint were both worse. `npm run rtt` measures it.
- Same-network play: `npm run lan` builds the client and runs the game server on this PC at 0.0.0.0:8787; friends on the same Wi-Fi open the printed http://<ip>:8787 (ping 1-5 ms instead of ~60 to Cloudflare). Own tether is drawn instantly on fire (`client/src/game/ownShots.ts`, cosmetic only; the server still decides).
- Client performance rule: never call Phaser Text style setters (`setColor`, `setAlign`, `setShadow`...) every frame. Each call re-draws the text canvas and re-uploads its texture, and per-player labels multiplied that cost. Use `setLabel` from `client/src/ui/text.ts`. Particle bursts reuse pooled emitters in `GameScene`.
- LAN mode (v1.5, lobby button "LAN MATCH (P2P)", host only): the host's browser runs the same `RoomCore` (`client/src/lan/LanHost.ts`) and friends connect over WebRTC data channels (`links.ts`); the online room only relays the connection details (`rtc` message, `LanCoordinator.ts`). Same rules and protocol, but the host tab is the server (keep it visible), so this mode is host-authoritative, unlike online rooms. If linking fails nothing changes and normal START still works.
- Rendering (v1.5): online orbs and tethers are drawn from the newest snapshot advanced with the shared physics (no interpolation delay); remote players stay interpolated. Events play on arrival. Own tether starts instantly (`ownShots.ts`).
- Balance harness: `npm run balance -- --seeds 20 --levels 1-10 [--n 1,2,3,4] [--demo]` plays levels with scripted bots against the real sim and prints clear time, deaths, special/sky/heat counters. Measurements only, it never judges balance. Bots ignore pickups.
- New mechanics: add a `SpecialDef` in `shared/src/sim/specials/` and append its kind to `SPECIAL_KINDS` (append only: kind order is in the snapshot format; same for `POWERUP_TYPES`, `SKY_KINDS`, `CHAOS_KINDS`). Specials and sky/chaos use their own seeded RNG streams so drops and bombs stay deterministic.
- Ideas not built yet: more hazard types (e.g. moving platforms, bomb defusing), mobile portrait layout, accounts/leaderboards.
- Cooperative targets (unreleased, after v1.5): specials `coop` (hits from N different Lancers inside a window; `need` on the spawn), `link` (pop one, a DIFFERENT Lancer must pop its partner in 4 s), `priority` (9 s deadline, +6 s clock if popped in time). Multiplayer only (solo = ordinary orbs). Code in `shared/src/sim/specials/{coop,link,priority,coopStats}.ts`; telemetry `sim.coopStats` (never networked); balance harness prints coop columns. Rescue beacon: a Flare drops where a Lancer is knocked out while a teammate stands. Baton window rides the snapshot as `bt`. Levels 12-25 place them progressively (12 coop, 13 link, 14 priority, finale all three). Tests: `tests/coop*.test.ts`, `tests/teamSupport.test.ts`.
- Level order is by difficulty (random order was tried and reverted; `shuffleLevels` / `Match({ shuffle: true })` still exist but nothing uses them). Practice (main menu, solo) and the lobby level picker (host) play ONE chosen level only: solo `LocalSource(nick, level, true)`, online `pick` message / `RoomInfo.pick` / `matchOffset`. The HUD shows the real level number via `levelIndex + offset`.
- Relics (v1.8): permanent per-run traits (`RELIC_KINDS`, bitmask `PlayerState.rel`, snapshot player column 23). Unknown Relic crate (`relic` PowerUpType) drops when the team completes a coop/link/priority/sync/heavy target or a Pinch (`tryRelicDrop`, gap of 2 cleared levels, own RNG). Pinch = two different Lancers hit the two halves of one pop within 4 ticks: both vanish. Stage events: `level.stage {wall, mirror}` (Split Wall blocks Lancers, Mirror reverses controls; seeded plan in `sim/stage.ts`, snapshot field `w`), `level.ice` patches (server-side slide; client prediction ignores ice so expect small corrections). Dash = double-tap a direction (server-detected, no new input bit). Client: `config/relics.ts`, `RelicsScene`, EN/AR texts in `howToText.ts`.
