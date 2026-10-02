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
- Server is authoritative: clients send only input bits; never let the client decide hits, score, power-ups.
- Gameplay changes go in `shared/` so server and solo mode stay identical. Add a unit test for each.
- Never send full state per frame, never write game state to storage (free-tier budget).
- Lovable (or any other agent) should only touch the website shell, never `shared/`, `worker/` or game logic. It once pushed levels directly into `shared/src/levels/levels.ts`; always `git pull` before editing.

## Commands
- `npm install`, `npm test` (340 unit tests), `npm run typecheck`
- `npm run dev` (worker :8787 + client :5173), `npm run test:e2e` (needs worker running; `SERVER=<url>` to test production)
- `npm run deploy` (builds client + deploys Worker/DO/assets)
- Windows: wrangler dev fails with `SQLITE_CANTOPEN` if the project path is long; clone to a short path such as `C:\dev\orb-lancers`, or use `--persist-to C:\tmp\orb-state`.
- Browser testing in hidden/background tabs: add `?timerLoop=1`. Jump to a solo level: `?level=19` then PLAY SOLO.

## Current state (2026-10-02)
- Done and verified: online rooms (create/join/code/invite link), lobby, countdown, pause, disconnect → pause → reconnect, continue solo, drop-in, rematch (needs all votes), 25 levels, 5 power-ups, hazards (floor spikes, fast red orbs, timed platforms, bombs), 2–4 players, touch buttons, synthesized audio, deployed and e2e-tested in production.
- Not yet verified: a real match with 4 humans on 4 devices; Lovable integration (owner reported errors, details never shared — ask for the exact error text).
- Gameplay depth pass (2026-10): player-count scaling (`shared/src/sim/scaling.ts`: speed/time/drops/heat per 1-4 players), special orbs (`shared/src/sim/specials/`: hardshell, ghost, twin fuse, sync, pincer, heavy, sequence, quad-lock), anchor harpoon pickup, Surprise Director sky events (`sim/director.ts`: gift crate, comet, gravity wobble, hail), heat governor, multiplayer chaos pickup (jam, flip, slow, tether, swap; host switch in the lobby), levels 1-10 retuned and given one new mechanic each. Multiplayer also promotes some ordinary orbs to specials (`ScaleProfile.specialShare`).
- Balance harness: `npm run balance -- --seeds 20 --levels 1-10 [--n 1,2,3,4] [--demo]` plays levels with scripted bots against the real sim and prints clear time, deaths, special/sky/heat counters. Measurements only, it never judges balance. Bots ignore pickups.
- New mechanics: add a `SpecialDef` in `shared/src/sim/specials/` and append its kind to `SPECIAL_KINDS` (append only: kind order is in the snapshot format; same for `POWERUP_TYPES`, `SKY_KINDS`, `CHAOS_KINDS`). Specials and sky/chaos use their own seeded RNG streams so drops and bombs stay deterministic.
- Ideas not built yet: more hazard types (e.g. moving platforms, bomb defusing), mobile portrait layout, accounts/leaderboards.
