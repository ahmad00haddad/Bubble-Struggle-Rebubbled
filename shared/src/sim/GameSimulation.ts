import {
  BUBBLE_SIZES,
  HAZARDS,
  HEAT,
  HARPOON,
  INPUT,
  ANCHOR,
  CHAOS,
  CHAOS_KINDS,
  PHYSICS,
  PLAYER,
  POWERUP,
  RARE,
  SCORING,
  SKY,
  SPECIAL,
  TICK_DT,
  TICK_RATE,
  WORLD,
  type BubbleSize,
  type PowerUpType,
  type ChaosKind,
  type GiftEventType,
  type SkyKind,
  type SpecialKind,
} from '../constants/game';
import type { LevelConfig } from '../types/level';
import type {
  BombState,
  BubbleState,
  HarpoonState,
  PlayerState,
  PowerUpState,
  SimEvent,
  SimStatus,
  SkyState,
} from '../types/state';
import { moveFxOf, movePlayerFx, speedMulOf } from './physics';
import { advanceBubble, advanceHarpoon, advancePowerUp, anchorStickY, circleRectOverlap, harpoonRect, playerHitbox } from './physics';
import { Rng } from './rng';
import { activePlatforms, onSpikes, orbSpeedMul, spawnX } from './hazards';
import { scaleProfile, type ScaleProfile } from './scaling';
import { planSky, type SkyPlanEntry } from './director';
import { SPECIAL_DEFS, isIntangible, passesHarpoon, type SpecialHost } from './specials';

export interface SimOptions {
  levels: readonly LevelConfig[];
  /** One entry per seat; true = participating. Length is the seat count (1 or 2). */
  activeSlots: boolean[];
  seed: number;
  /** Chaos pickups allowed (host setting, default on). They also need 2+ Lancers. */
  chaos?: boolean;
}

function newPlayer(slot: number, active: boolean): PlayerState {
  return {
    slot,
    active,
    x: 0,
    facing: 1,
    input: 0,
    shootLatch: false,
    lives: PLAYER.startLives,
    score: 0,
    life: active ? 'alive' : 'out',
    respawnTimer: 0,
    invuln: 0,
    shield: 0,
    speed: 0,
    dbl: 0,
    cooldown: 0,
    hitThisLevel: false,
    anc: 0,
    wide: 0,
    boots: 0,
    potato: 0,
    mag: 0,
    boom: 0,
    sx: 0,
    don: 0,
    fx: 0,
    fxT: 0,
    fxImm: 0,
    fxP: -1,
    lastSeq: 0,
    ticksSinceSeq: 0,
  };
}

/**
 * The authoritative, deterministic game world for one level at a time.
 * Pure TypeScript: runs identically in a Durable Object and in the browser (solo).
 * It knows nothing about networking, rendering, or wall-clock time.
 */
export class GameSimulation {
  readonly levels: readonly LevelConfig[];
  readonly rng: Rng;
  tick = 0;
  levelIndex = 0;
  level!: LevelConfig;
  /** Player-count scaling, fixed for the whole level (set in loadLevel). */
  scale: ScaleProfile = scaleProfile(1);
  levelTicks = 0;
  timeLeftTicks = 0;
  status: SimStatus = 'running';
  players: PlayerState[];
  bubbles: BubbleState[] = [];
  harpoons: HarpoonState[] = [];
  powerups: PowerUpState[] = [];
  bombs: BombState[] = [];
  /** Reseeded on every level load from (seed, level), so a retry replays identical special state. */
  private specialRng: Rng;
  private readonly seed: number;
  private readonly specialHost: SpecialHost;
  /** The one sky event in progress (warning or lasting effect), if any. */
  sky: SkyState | null = null;
  private skyPlan: SkyPlanEntry[] = [];
  /** Slow Orbs: seconds left (0 = normal speed). */
  slowT = 0;
  /** Baton Crate: who holds it and how long a teammate has to pop an orb to share the shield. */
  baton: { owner: number; t: number } | null = null;
  /** Rapid-popping meter (pops, decaying) and whether the governor is currently on. */
  heat = 0;
  hot = false;
  private skyRng: Rng;
  private chaosRng: Rng;
  readonly chaosEnabled: boolean;
  private nextBombAt = Infinity;
  private nextId = 1;
  private placedSpawned = new Set<number>();
  private events: SimEvent[] = [];

  constructor(opts: SimOptions) {
    if (opts.levels.length === 0) throw new Error('No levels');
    this.levels = opts.levels;
    this.rng = new Rng(opts.seed);
    this.seed = opts.seed >>> 0;
    this.specialRng = new Rng(this.seed ^ SPECIAL.seedSalt);
    this.skyRng = new Rng(this.seed ^ SKY.seedSalt);
    this.chaosRng = new Rng(this.seed ^ CHAOS.seedSalt);
    this.chaosEnabled = opts.chaos !== false;
    const self = this;
    this.specialHost = {
      get rng() {
        return self.specialRng;
      },
      get scale() {
        return self.scale;
      },
      activePlayers: () => this.players.reduce((n, p) => n + (p.active && p.life !== 'out' ? 1 : 0), 0),
      orbs: () => this.bubbles,
      bubbleById: (id) => this.bubbles.find((b) => b.id === id),
      popGroup: (ids, owner) => {
        for (const id of ids) {
          const i = this.bubbles.findIndex((b) => b.id === id);
          if (i >= 0) this.popBubble(i, owner);
        }
      },
      emit: (t, b) => this.emit({ k: 'sp', t, id: b.id, x: Math.round(b.x), y: Math.round(b.y) }),
    };
    this.players = opts.activeSlots.map((a, i) => newPlayer(i, a));
    this.loadLevel(0);
  }

  get speedMul(): number {
    return this.level.difficulty.bubbleSpeed * this.scale.speedMul;
  }

  /** Heat as a share of this level's trigger threshold (1 = governor starts). */
  get heatRatio(): number {
    return this.heat / this.scale.heatThreshold;
  }

  /** Orb speed factor from Slow Orbs. */
  get orbSlow(): number {
    return this.slowT > 0 ? RARE.slowMul : 1;
  }

  /** Orb gravity factor: Gravity Wobble lightens it while active. */
  get gravMul(): number {
    return this.sky?.kind === 'wobble' && this.sky.phase === 'active' ? SKY.wobbleGravity : 1;
  }

  get isLastLevel(): boolean {
    return this.levelIndex >= this.levels.length - 1;
  }

  /** Load (or reload) a level. Scores and lives carry over. */
  loadLevel(index: number): void {
    this.levelIndex = index;
    this.level = this.levels[index];
    this.levelTicks = 0;
    this.scale = scaleProfile(this.players.filter((p) => p.active).length);
    this.timeLeftTicks = Math.round(this.level.timeLimit * this.scale.timeMul * TICK_RATE);
    this.status = 'running';
    this.harpoons = [];
    this.powerups = [];
    this.bombs = [];
    this.nextBombAt = this.level.bombs ? (this.level.bombs.firstAt ?? this.level.bombs.every) * TICK_RATE : Infinity;
    this.placedSpawned.clear();
    const m = this.speedMul;
    this.bubbles = this.level.bubbles.map((s) => ({
      id: this.nextId++,
      size: s.size,
      x: s.x,
      y: s.y,
      vx: (s.velocityX ?? BUBBLE_SIZES[s.size].speedX) * m,
      vy: (s.velocityY ?? 0) * m * (s.fast ? HAZARDS.fastOrbMultiplier : 1),
      ...(s.fast ? { fast: true } : {}),
    }));
    for (const b of this.bubbles) if (b.fast) b.vx *= HAZARDS.fastOrbMultiplier;
    this.initSpecials();
    this.heat = 0;
    this.hot = false;
    this.slowT = 0;
    this.baton = null;
    this.sky = null;
    this.skyRng = new Rng((this.seed ^ SKY.seedSalt ^ Math.imul(this.levelIndex + 1, 0x85ebca6b)) >>> 0);
    this.skyPlan = planSky(this.level, this.scale, this.skyRng);
    this.chaosRng = new Rng((this.seed ^ CHAOS.seedSalt ^ Math.imul(this.levelIndex + 1, 0xc2b2ae35)) >>> 0);
    for (const p of this.players) {
      p.x = spawnX(this.level, p.slot);
      p.facing = 1;
      p.shootLatch = false;
      p.respawnTimer = 0;
      p.invuln = 0;
      p.speed = 0;
      p.dbl = 0;
      p.cooldown = 0;
      p.anc = 0;
      p.wide = p.boots = p.potato = p.mag = p.boom = p.sx = p.don = 0;
      p.fx = 0;
      p.fxT = 0;
      p.fxImm = 0;
      p.fxP = -1;
      p.hitThisLevel = false;
      if (p.active && p.life === 'dead') p.life = p.lives > 0 ? 'alive' : 'out';
    }
  }

  /** Tag special orbs from the level data, run their init, and link Twin Fuse pairs. */
  private initSpecials(): void {
    this.specialRng = new Rng((this.seed ^ SPECIAL.seedSalt ^ Math.imul(this.levelIndex + 1, 0x9e3779b1)) >>> 0);
    const pairs = new Map<number, BubbleState>();
    this.level.bubbles.forEach((s, i) => {
      if (!s.special) return;
      const b = this.bubbles[i];
      b.sp = s.special;
      SPECIAL_DEFS[s.special].init?.(this.specialHost, b, s);
      if (s.special === 'twin' && s.group !== undefined) {
        const other = pairs.get(s.group);
        if (other) {
          other.lk = b.id;
          b.lk = other.id;
        } else pairs.set(s.group, b);
      }
    });
    this.promoteSpecials();
  }

  /**
   * Multiplayer: turn some ordinary orbs into specials so bigger teams meet more mechanics
   * instead of just more orbs. Share comes from the scale profile; solo gets none.
   */
  private promoteSpecials(): void {
    const share = this.scale.specialShare;
    if (share <= 0 || this.level.noPromote) return;
    const explicit = this.bubbles.filter((b) => b.sp).length;
    const want = Math.min(SPECIAL.promoteMax, Math.round(share * this.bubbles.length) - explicit);
    if (want <= 0) return;
    const pool: Partial<Record<SpecialKind, number>> = { ...SPECIAL.promote };
    if (this.scale.players < 3) delete pool.heavy;
    const candidates = this.bubbles.filter((b) => !b.sp && b.size >= 1);
    for (let i = 0; i < want && candidates.length > 0; i++) {
      const b = candidates.splice(Math.floor(this.specialRng.next() * candidates.length), 1)[0];
      const kind = this.specialRng.weighted(pool);
      if (!kind) break;
      b.sp = kind;
      SPECIAL_DEFS[kind].init?.(this.specialHost, b, {} as never);
    }
  }

  /** A harpoon connected with a tangible orb. The harpoon is spent either way. */
  private hitBubble(index: number, owner: number, x: number): void {
    const b = this.bubbles[index];
    if (b.sp && SPECIAL_DEFS[b.sp].onHit?.(this.specialHost, b, { owner, x }) === 'absorb') return;
    this.popBubble(index, owner);
  }

  /** Give knocked-out players a fresh start (used between levels in co-op). */
  reviveOutPlayers(lives: number): void {
    for (const p of this.players) {
      if (p.active && p.life === 'out') {
        p.lives = lives;
        p.life = 'alive';
      }
    }
  }

  /** Fresh stats for a seat taken over by a new person mid-match (stays inactive until setActive). */
  resetPlayer(slot: number): void {
    if (!this.players[slot]) return;
    const fresh = newPlayer(slot, false);
    fresh.life = 'alive';
    this.players[slot] = fresh;
  }

  setActive(slot: number, active: boolean): void {
    const p = this.players[slot];
    if (!p || p.active === active) return;
    p.active = active;
    p.input = 0;
    p.shootLatch = false;
    if (!active) {
      this.harpoons = this.harpoons.filter((h) => h.owner !== slot);
      return;
    }
    // Rejoining: drop back in at spawn with protection.
    if (p.lives <= 0) p.lives = PLAYER.reviveLives;
    p.life = 'alive';
    p.x = spawnX(this.level, slot);
    p.invuln = PLAYER.invulnAfterRespawn;
  }

  /** Apply an input change. Shoot fires on the rising edge only. */
  setInput(slot: number, bits: number, seq: number): void {
    const p = this.players[slot];
    if (!p) return;
    bits &= INPUT.MASK;
    if (bits & INPUT.SHOOT && !(p.input & INPUT.SHOOT)) p.shootLatch = true;
    p.input = bits;
    p.lastSeq = seq;
    p.ticksSinceSeq = 0;
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private emit(e: SimEvent): void {
    this.events.push(e);
  }

  /** Advance one fixed tick. No-op unless status is 'running'. */
  step(): void {
    if (this.status !== 'running') return;
    this.tick++;
    this.levelTicks++;
    const dt = TICK_DT;
    const platforms = activePlatforms(this.level, this.levelTicks);

    this.timeLeftTicks--;

    // --- Players -----------------------------------------------------------
    for (const p of this.players) {
      if (!p.active) continue;
      p.ticksSinceSeq++;
      if (p.life === 'dead') {
        p.respawnTimer -= dt;
        if (p.respawnTimer <= 0) {
          p.life = 'alive';
          p.x = spawnX(this.level, p.slot);
          p.invuln = PLAYER.invulnAfterRespawn;
          this.emit({ k: 'respawn', p: p.slot });
        }
        continue;
      }
      if (p.life !== 'alive') continue;

      this.stepFxTimer(p, dt);
      const speedMul = speedMulOf(p);
      p.x = movePlayerFx(p.x, p.input, speedMul, moveFxOf(p.fx, p.fx > 0 && p.fxP >= 0 ? (this.players[p.fxP]?.x ?? null) : null), dt);
      if (p.input & INPUT.LEFT && !(p.input & INPUT.RIGHT)) p.facing = -1;
      else if (p.input & INPUT.RIGHT && !(p.input & INPUT.LEFT)) p.facing = 1;

      p.invuln = Math.max(0, p.invuln - dt);
      p.shield = Math.max(0, p.shield - dt);
      p.speed = Math.max(0, p.speed - dt);
      p.dbl = Math.max(0, p.dbl - dt);
      p.cooldown = Math.max(0, p.cooldown - dt);
      p.anc = Math.max(0, p.anc - dt);
      p.wide = Math.max(0, p.wide - dt);
      p.boots = Math.max(0, p.boots - dt);
      p.potato = Math.max(0, p.potato - dt);
      p.mag = Math.max(0, p.mag - dt);
      p.boom = Math.max(0, p.boom - dt);
      p.sx = Math.max(0, p.sx - dt);
      if (p.fx === CHAOS_KINDS.indexOf('jam') + 1) p.shootLatch = false; // jammed: the press is lost
      if (p.potato > 0) p.shootLatch = false; // Hot Potato: fast, but you cannot shoot

      if (p.shootLatch) {
        p.shootLatch = false;
        const max = p.dbl > 0 ? HARPOON.doubleMax : HARPOON.baseMax;
        // A stuck anchor tether does not use up the owner's harpoon slot.
        const mine = this.harpoons.reduce((n, h) => n + (h.owner === p.slot && h.ttl === undefined ? 1 : 0), 0);
        if (p.cooldown <= 0 && mine < max) {
          p.cooldown = HARPOON.cooldown;
          const anchor = p.anc > 0 && !this.level.noAnchor;
          const boom = !anchor && p.boom > 0 && !this.level.noAnchor;
          if (anchor) p.anc = 0;
          if (boom) p.boom = 0;
          this.harpoons.push({
            id: this.nextId++,
            owner: p.slot,
            x: p.x,
            tipY: WORLD.height - PLAYER.height,
            ...(anchor ? { anchor: true } : {}),
            ...(boom ? { bm: 0 as const, bh: RARE.boomerangHits } : {}),
            ...(p.wide > 0 ? { wide: true } : {}),
          });
          this.emit({ k: 'shoot', p: p.slot, x: Math.round(p.x) });
        }
      }
    }

    // --- Magnet Core: every few ticks small and medium orbs turn toward the Lancer -----
    if (this.levelTicks % RARE.magnetEvery === 0) {
      for (const p of this.players) {
        if (!p.active || p.life !== 'alive' || p.mag <= 0) continue;
        for (const b of this.bubbles) {
          const dx = p.x - b.x;
          if (b.size <= 1 && b.fz === undefined && Math.abs(dx) > 12) b.vx = Math.sign(dx) * Math.abs(b.vx);
        }
      }
    }

    // --- Orbs --------------------------------------------------------------
    const slow = this.orbSlow;
    for (const b of this.bubbles) {
      if (b.fz !== undefined) {
        b.fz -= dt;
        if (b.fz > 0) continue; // frozen: stays put
        delete b.fz;
        this.gift('thaw', -1, b.x, b.y);
      }
      advanceBubble(b, dt, platforms, orbSpeedMul(this.level, b.fast, this.scale.speedMul, b.rage, b.hot, slow), this.gravMul);
    }
    this.stepHeat(dt);
    this.stepSlow(dt);
    if (this.baton && (this.baton.t -= dt) <= 0) this.baton = null;
    // Specials mutate only their own orb's fields here, never the array.
    for (const b of this.bubbles) if (b.sp) SPECIAL_DEFS[b.sp].onTick?.(this.specialHost, b, dt);

    // --- Harpoons: travel, then hit test along the whole tether -----------
    const survivors: HarpoonState[] = [];
    for (const h of this.harpoons) {
      const w = h.wide ? HARPOON.width * RARE.wideMul : HARPOON.width;
      if (h.bm === 1) {
        // Boomerang on its way back down.
        h.tipY += HARPOON.speed * dt;
        if (h.tipY >= WORLD.height - PLAYER.height) continue;
      } else if (h.ttl === undefined) {
        const tip = advanceHarpoon(h.x, h.tipY, dt, platforms, w);
        if (tip === null) {
          if (h.bm === 0) h.bm = 1;
          else if (!h.anchor) continue;
          else {
            // Anchor: stick where the tether stopped and keep working for a few seconds.
            h.tipY = anchorStickY(h.x, h.tipY, platforms, w);
            h.ttl = ANCHOR.stickSeconds;
            h.cd = 0;
            this.emit({ k: 'anchor', p: h.owner, x: Math.round(h.x), y: Math.round(h.tipY) });
          }
        } else h.tipY = tip;
      } else {
        h.ttl -= dt;
        if (h.ttl <= 0) continue;
      }
      // Anchors and boomerangs are not spent by every hit; a short cooldown paces their pops.
      if ((h.anchor || h.bm !== undefined) && (h.cd ?? 0) > 0) {
        h.cd = (h.cd ?? 0) - dt;
        survivors.push(h);
        continue;
      }
      // A returning boomerang strikes with its head (44 px square), so it can catch the children of its first hit.
      const rect = h.bm === 1 ? { x: h.x - 22, y: h.tipY - 22, w: 44, h: 44 } : harpoonRect(h.x, h.tipY, w);
      const idx = this.bubbles.findIndex((b) => !passesHarpoon(b) && circleRectOverlap(b.x, b.y, BUBBLE_SIZES[b.size].radius, rect));
      if (idx >= 0) {
        this.hitBubble(idx, h.owner, h.x);
        if (h.anchor) {
          h.cd = ANCHOR.hitCooldown;
          survivors.push(h);
        } else if (h.bm !== undefined) {
          // Boomerang pierces: it keeps going (up, then back down) until its hits are used.
          h.bh = (h.bh ?? 1) - 1;
          h.cd = 0.1;
          if (h.bh > 0) survivors.push(h);
        }
        continue;
      }
      if (!h.passed) {
        const ghost = this.bubbles.find((b) => b.sp && isIntangible(b) && circleRectOverlap(b.x, b.y, BUBBLE_SIZES[b.size].radius, rect));
        if (ghost) {
          h.passed = true;
          this.specialHost.emit('miss', ghost);
        }
      }
      survivors.push(h);
    }
    this.harpoons = survivors;

    // --- Orb vs player ----------------------------------------------------
    for (const p of this.players) {
      if (!p.active || p.life !== 'alive' || p.invuln > 0) continue;
      const box = playerHitbox(p.x);
      const hit = this.bubbles.some((b) => b.fz === undefined && !isIntangible(b) && circleRectOverlap(b.x, b.y, BUBBLE_SIZES[b.size].radius - 1, box));
      if (hit || onSpikes(this.level, p.x)) this.damagePlayer(p);
    }

    // --- Bombs -------------------------------------------------------------
    this.stepBombs(dt, platforms);

    // --- Power-ups ---------------------------------------------------------
    const elapsed = this.levelTicks * dt;
    this.level.powerUps.placed.forEach((pl, i) => {
      if (!this.placedSpawned.has(i) && elapsed >= pl.delay) {
        this.placedSpawned.add(i);
        this.spawnPowerUp(pl.type, pl.x, pl.y);
      }
    });
    const keep: PowerUpState[] = [];
    for (const u of this.powerups) {
      // A timed platform vanished under it: fall again.
      const bottom = u.y + POWERUP.size / 2;
      if (u.grounded && bottom < WORLD.height - 0.5 && !platforms.some((p) => Math.abs(p.y - bottom) < 1 && u.x >= p.x && u.x <= p.x + p.w)) {
        u.grounded = false;
      }
      advancePowerUp(u, dt, platforms);
      u.life -= dt;
      if (u.life <= 0) continue;
      const half = POWERUP.size / 2;
      const rect = { x: u.x - half, y: u.y - half, w: POWERUP.size, h: POWERUP.size };
      const taker = this.players.find((p) => {
        if (!p.active || p.life !== 'alive') return false;
        const hb = playerHitbox(p.x);
        return hb.x < rect.x + rect.w && hb.x + hb.w > rect.x && hb.y < rect.y + rect.h && hb.y + hb.h > rect.y;
      });
      if (taker) {
        this.applyPowerUp(taker, u.type);
        this.emit({ k: 'pickup', p: taker.slot, type: u.type, x: Math.round(u.x), y: Math.round(u.y) });
        continue;
      }
      keep.push(u);
    }
    this.powerups = keep;

    // --- Sky events ----------------------------------------------------------
    this.stepSky(dt);
    this.updateHot();

    // --- Level resolution --------------------------------------------------
    const anyActive = this.players.some((p) => p.active);
    if (anyActive && this.players.every((p) => !p.active || p.life === 'out')) {
      this.status = 'gameover';
      return;
    }
    if (this.bubbles.length === 0) {
      this.status = 'cleared';
      const secs = Math.max(0, Math.floor(this.timeLeftTicks / TICK_RATE));
      const bonus = this.players.map((p) => {
        if (!p.active) return 0;
        let b = SCORING.levelClear + secs * SCORING.timeBonusPerSecond;
        if (!p.hitThisLevel && p.life !== 'out') b += SCORING.survivalBonus;
        if (p.don === 1) {
          b *= 2; // Double or Nothing paid off
          this.gift('donWin', p.slot, p.x, WORLD.height - 60);
        }
        p.score += b;
        return b;
      });
      this.emit({ k: 'clear', bonus });
      return;
    }
    if (this.timeLeftTicks <= 0) {
      this.timeLeftTicks = 0;
      this.status = 'timeup';
      this.emit({ k: 'timeup' });
    }
  }

  /** Orb spawned mid-level by an event (same speed rules as level-load orbs). */
  private spawnOrb(size: BubbleSize, x: number, y: number, dir: number, vy: number, fast: boolean): void {
    const m = this.speedMul * this.orbSlow;
    const f = fast ? HAZARDS.fastOrbMultiplier : 1;
    this.bubbles.push({ id: this.nextId++, size, x, y, vx: dir * BUBBLE_SIZES[size].speedX * m * f, vy: vy * m * f, ...(fast ? { fast: true } : {}) });
  }

  private stepSky(dt: number): void {
    const sky = this.sky;
    if (!sky) {
      const next = this.skyPlan[0];
      if (!next || this.levelTicks < next.at) return;
      this.skyPlan.shift();
      this.startSkyWarning(next.kind);
      return;
    }
    sky.t -= dt;
    if (sky.t > 0) return;
    if (sky.phase === 'active') {
      this.emit({ k: 'sky', t: 'end', kind: sky.kind });
      this.sky = null;
      return;
    }
    this.landSky(sky);
  }

  private startSkyWarning(kind: SkyKind): void {
    const r = this.skyRng;
    const sky: SkyState = { kind, phase: 'warn', t: SKY.warn[kind], a: 0, lanes: [] };
    if (kind === 'gift') sky.a = Math.round(60 + r.next() * (WORLD.width - 120));
    else if (kind === 'comet') sky.a = r.next() < 0.5 ? -1 : 1;
    else if (kind === 'hail') {
      let x = 80 + r.next() * 220;
      for (let i = 0; i < SKY.hailCount; i++) {
        sky.lanes.push(Math.round(Math.min(x, WORLD.width - 60)));
        x += SKY.hailGap + r.next() * 120;
      }
    }
    this.sky = sky;
    this.emit({ k: 'sky', t: 'warn', kind, ...(kind === 'gift' ? { x: sky.a } : {}) });
  }

  /** The warning ran out: the event lands. One-shot events finish here; Wobble starts its lasting phase. */
  private landSky(sky: SkyState): void {
    const r = this.skyRng;
    this.emit({ k: 'sky', t: 'start', kind: sky.kind, ...(sky.kind === 'gift' ? { x: sky.a } : {}) });
    switch (sky.kind) {
      case 'gift': {
        const type = r.weighted(this.dropPool(SKY.giftPool));
        if (type) this.spawnPowerUp(type, sky.a, POWERUP.size / 2 + 2);
        break;
      }
      case 'comet': {
        const fromLeft = sky.a > 0;
        this.spawnOrb(1, fromLeft ? 24 : WORLD.width - 24, 60, fromLeft ? 1 : -1, 0, true);
        break;
      }
      case 'hail':
        for (const x of sky.lanes) this.spawnOrb(0, x, 24, r.next() < 0.5 ? -1 : 1, 180, false);
        break;
      case 'wobble':
        sky.phase = 'active';
        sky.t = SKY.wobbleSeconds;
        return;
    }
    this.emit({ k: 'sky', t: 'end', kind: sky.kind });
    this.sky = null;
  }

  /** Decay the heat meter, expire boosts, and flip the governor on/off with hysteresis. */
  private stepHeat(dt: number): void {
    this.heat *= Math.exp(-dt / HEAT.decaySeconds);
    for (const b of this.bubbles) {
      if (b.ht === undefined) continue;
      b.ht -= dt;
      if (b.ht > 0) continue;
      // Boost over: back to the orb's normal speed with the same arc shape.
      b.vx /= HEAT.boostMul;
      b.vy /= HEAT.boostMul;
      delete b.hot;
      delete b.ht;
    }
  }

  private updateHot(): void {
    const thr = this.scale.heatThreshold;
    if (!this.hot && this.heat >= thr) {
      this.hot = true;
      this.emit({ k: 'heat', on: true });
    } else if (this.hot && this.heat < thr * HEAT.coolRatio) {
      this.hot = false;
      this.emit({ k: 'heat', on: false });
    }
  }

  /** Chaos is live: host allows it, the team profile allows it, and 2+ Lancers can still play. */
  chaosOn(): boolean {
    return this.chaosEnabled && this.scale.chaos && this.specialHost.activePlayers() >= 2;
  }

  /** An orb close to a Lancer's body makes that Lancer a bad target (never an unavoidable hit). */
  private bodySafe(x: number): boolean {
    const cy = WORLD.height - PLAYER.hitboxHeight / 2;
    return !this.bubbles.some((b) => Math.hypot(b.x - x, b.y - cy) < BUBBLE_SIZES[b.size].radius + CHAOS.dangerRadius);
  }

  private stepFxTimer(p: PlayerState, dt: number): void {
    if (p.fx === 0) {
      p.fxImm = Math.max(0, p.fxImm - dt);
      return;
    }
    p.fxT -= dt;
    const tether = p.fx === CHAOS_KINDS.indexOf('tether') + 1;
    const partner = tether ? this.players[p.fxP] : undefined;
    if (p.fxT > 0 && !(tether && (!partner || !partner.active || partner.life !== 'alive'))) return;
    p.fx = 0;
    p.fxT = 0;
    p.fxP = -1;
    p.fxImm = CHAOS.immunity;
    this.emit({ k: 'chaos', t: 'end', by: -1, to: p.slot });
  }

  /** The user grabbed a chaos pickup: pick a safe teammate and an effect, or fizzle harmlessly. */
  private fireChaos(user: PlayerState): void {
    const fizzle = () => this.emit({ k: 'chaos', t: 'fizzle', by: user.slot, to: -1 });
    if (!this.chaosOn()) return fizzle();
    const r = this.chaosRng;
    const kind = r.weighted(CHAOS.weights) as ChaosKind | undefined;
    const targets = this.players.filter(
      (t) => t.active && t.life === 'alive' && t.slot !== user.slot && t.invuln <= 0 && t.fx === 0 && t.fxImm <= 0 && this.bodySafe(t.x),
    );
    if (!kind || targets.length === 0) return fizzle();
    const target = targets[Math.floor(r.next() * targets.length)];
    if (kind === 'swap') {
      if (!this.bodySafe(user.x)) return fizzle();
      [user.x, target.x] = [target.x, user.x];
      user.invuln = Math.max(user.invuln, CHAOS.swapGrace);
      target.invuln = Math.max(target.invuln, CHAOS.swapGrace);
      target.fxImm = CHAOS.immunity;
    } else {
      if (kind === 'tether' && user.fx !== 0) return fizzle();
      const idx = CHAOS_KINDS.indexOf(kind) + 1;
      const secs = CHAOS.seconds[kind];
      target.fx = idx;
      target.fxT = secs;
      if (kind === 'tether') {
        target.fxP = user.slot;
        user.fx = idx;
        user.fxT = secs;
        user.fxP = target.slot;
      }
    }
    this.emit({ k: 'chaos', t: kind, by: user.slot, to: target.slot });
  }

  private stepBombs(dt: number, platforms: readonly { x: number; y: number; w: number; h: number }[]): void {
    const cfg = this.level.bombs;
    if (!cfg && this.bombs.length === 0) return;
    if (cfg && this.levelTicks >= this.nextBombAt) {
      this.nextBombAt = this.levelTicks + cfg.every * TICK_RATE;
      const x = 40 + this.rng.next() * (WORLD.width - 80);
      this.bombs.push({ id: this.nextId++, x, y: HAZARDS.bombSize, fuse: cfg.fuse, grounded: false });
    }
    const half = HAZARDS.bombSize / 2;
    const keep: BombState[] = [];
    for (const b of this.bombs) {
      if (!b.grounded) {
        const oldBottom = b.y + half;
        let bottom = oldBottom + HAZARDS.bombFallSpeed * dt;
        for (const p of platforms) {
          if (b.x >= p.x && b.x <= p.x + p.w && oldBottom <= p.y && bottom >= p.y) {
            bottom = p.y;
            b.grounded = true;
          }
        }
        if (bottom >= WORLD.height) {
          bottom = WORLD.height;
          b.grounded = true;
        }
        b.y = bottom - half;
      }
      b.fuse -= dt;
      if (b.fuse > 0) {
        keep.push(b);
        continue;
      }
      this.emit({ k: 'boom', x: Math.round(b.x), y: Math.round(b.y), r: b.r ?? cfg?.radius ?? RARE.decoy.radius });
      const radius = b.r ?? cfg?.radius ?? RARE.decoy.radius;
      for (const p of this.players) {
        if (!p.active || p.life !== 'alive' || p.invuln > 0) continue;
        const dx = p.x - b.x;
        const dy = WORLD.height - PLAYER.hitboxHeight / 2 - b.y;
        if (dx * dx + dy * dy <= radius * radius) this.damagePlayer(p);
      }
    }
    this.bombs = keep;
  }

  /** Time ran out: every standing player loses a life. Returns true if anyone survives. */
  applyTimeUpPenalty(): boolean {
    for (const p of this.players) {
      if (!p.active || p.life === 'out') continue;
      p.lives = Math.max(0, p.lives - 1);
      p.life = p.lives > 0 ? 'alive' : 'out';
      this.emit({ k: 'die', p: p.slot, out: p.life === 'out' });
    }
    return this.players.some((p) => p.active && p.life !== 'out');
  }

  private damagePlayer(p: PlayerState): void {
    p.hitThisLevel = true;
    if (p.shield > 0) {
      p.shield = 0;
      p.invuln = PLAYER.invulnAfterShieldBreak;
      this.emit({ k: 'hurt', p: p.slot, shield: true });
      return;
    }
    p.lives = Math.max(0, p.lives - 1);
    p.shootLatch = false;
    p.speed = 0;
    p.dbl = 0;
    p.anc = 0;
    p.wide = p.boots = p.potato = p.mag = p.boom = p.sx = 0;
    if (p.don === 1) {
      p.don = 2; // Double or Nothing: the 'nothing' part
      p.score = Math.max(0, p.score - RARE.doubleLoss);
      this.gift('donLose', p.slot, p.x, WORLD.height - 60);
    }
    p.fx = 0;
    p.fxT = 0;
    p.fxP = -1;
    if (p.lives > 0) {
      p.life = 'dead';
      p.respawnTimer = PLAYER.respawnDelay;
    } else {
      p.life = 'out';
    }
    this.emit({ k: 'hurt', p: p.slot, shield: false });
    this.emit({ k: 'die', p: p.slot, out: p.life === 'out' });
  }

  private popBubble(index: number, by: number): void {
    const b = this.bubbles[index];
    if (b.sp) SPECIAL_DEFS[b.sp].onPop?.(this.specialHost, b);
    this.heat += 1;
    const pts = BUBBLE_SIZES[b.size].points;
    const scorer = this.players[by];
    if (scorer) scorer.score += pts * (scorer.sx > 0 ? 2 : 1);
    if (scorer && this.baton && by !== this.baton.owner && scorer.life === 'alive') {
      // Baton Crate: the first teammate to pop an orb shares the shield.
      scorer.shield = Math.max(scorer.shield, POWERUP.durations.shield);
      this.gift('batonGive', by, scorer.x, WORLD.height - 60, this.baton.owner);
      this.baton = null;
    }
    this.bubbles.splice(index, 1);
    this.emit({ k: 'pop', id: b.id, s: b.size, x: Math.round(b.x), y: Math.round(b.y), by, pts });

    if (b.size > 0) {
      const child = (b.size - 1) as BubbleSize;
      const m = this.speedMul;
      const vx = BUBBLE_SIZES[child].speedX * m;
      const vy = -PHYSICS.splitKickVy * m;
      const f = b.fast ? HAZARDS.fastOrbMultiplier : 1;
      // While the team runs hot, new children start a little faster for a few seconds.
      const h = (this.hot ? HEAT.boostMul : 1) * this.orbSlow;
      const heated = this.hot ? { hot: true, ht: HEAT.boostSeconds } : {};
      this.bubbles.push(
        { id: this.nextId++, size: child, x: b.x, y: b.y, vx: -vx * f * h, vy: vy * f * h, ...(b.fast ? { fast: true } : {}), ...heated },
        { id: this.nextId++, size: child, x: b.x, y: b.y, vx: vx * f * h, vy: vy * f * h, ...(b.fast ? { fast: true } : {}), ...heated },
      );
    }

    const pu = this.level.powerUps;
    if (this.powerups.length < POWERUP.maxOnField && this.rng.next() < pu.dropChance * this.scale.dropMul) {
      const type = this.rng.weighted(this.dropPool(pu.pool));
      if (type) this.spawnPowerUp(type, b.x, b.y);
    }
  }

  private spawnPowerUp(type: PowerUpType, x: number, y: number): void {
    const half = POWERUP.size / 2;
    const u: PowerUpState = {
      id: this.nextId++,
      type,
      x: Math.min(Math.max(x, half), WORLD.width - half),
      y: Math.min(y, WORLD.height - half),
      life: POWERUP.lifetime,
      grounded: false,
    };
    this.powerups.push(u);
    this.emit({ k: 'drop', type, x: Math.round(u.x), y: Math.round(u.y) });
  }

  private applyPowerUp(p: PlayerState, type: PowerUpType): void {
    p.score += SCORING.pickup;
    switch (type) {
      case 'shield':
        p.shield = POWERUP.durations.shield;
        break;
      case 'extraLife':
        p.lives = Math.min(PLAYER.maxLives, p.lives + 1);
        break;
      case 'extraTime':
        this.timeLeftTicks += POWERUP.extraTimeSeconds * TICK_RATE;
        break;
      case 'doubleHarpoon':
        p.dbl = POWERUP.durations.doubleHarpoon;
        break;
      case 'speedBoost':
        p.speed = POWERUP.durations.speedBoost;
        break;
      case 'anchor':
        p.anc = ANCHOR.chargeSeconds;
        break;
      case 'chaos':
        this.fireChaos(p);
        break;
      default:
        this.applyRare(p, type);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Rare crates
  // ---------------------------------------------------------------------------

  private gift(t: GiftEventType, p: number, x: number, y: number, to?: number): void {
    this.emit({ k: 'gift', t, p, x: Math.round(x), y: Math.round(y), ...(to !== undefined ? { to } : {}) });
  }

  /** Drop odds for a pool: the level's own weights plus the rare crates this team can use. */
  private dropPool(base: Partial<Record<PowerUpType, number>>): Partial<Record<PowerUpType, number>> {
    const pool: Partial<Record<PowerUpType, number>> = { ...base, ...RARE.drops };
    if (this.level.noAnchor) {
      delete pool.anchor;
      delete pool.boomerang;
      delete pool.pinata;
    }
    if (this.chaosOn()) pool.chaos = CHAOS.dropWeight * this.scale.chaosRate;
    if (this.scale.players >= 2 && this.specialHost.activePlayers() >= 2) {
      pool.baton = RARE.mpDrops.baton;
      if (this.players.some((q) => q.active && (q.life === 'dead' || q.life === 'out'))) pool.flare = RARE.flareWeight;
    }
    return pool;
  }

  private nearestOrb(x: number, ok: (b: BubbleState) => boolean): BubbleState | undefined {
    let best: BubbleState | undefined;
    for (const b of this.bubbles) if (ok(b) && (!best || Math.abs(b.x - x) < Math.abs(best.x - x))) best = b;
    return best;
  }

  private applyRare(p: PlayerState, type: PowerUpType): void {
    const y = WORLD.height - 60;
    switch (type) {
      case 'shrink': {
        // Less clock, but your pops are worth double for a while. Never leaves less than a few seconds.
        const cut = RARE.shrinkSeconds * TICK_RATE;
        const floor = Math.min(this.timeLeftTicks, RARE.shrinkMinLeft * TICK_RATE);
        this.timeLeftTicks = Math.max(floor, this.timeLeftTicks - cut);
        p.sx = RARE.seconds.sx;
        this.gift('shrink', p.slot, p.x, y);
        break;
      }
      case 'boots':
        p.boots = RARE.seconds.boots;
        p.shield = Math.max(p.shield, POWERUP.durations.shield);
        this.gift('boots', p.slot, p.x, y);
        break;
      case 'potato':
        p.potato = RARE.seconds.potato;
        this.gift('potato', p.slot, p.x, y);
        break;
      case 'wide':
        p.wide = RARE.seconds.wide;
        this.gift('wide', p.slot, p.x, y);
        break;
      case 'magnet':
        p.mag = RARE.seconds.magnet;
        this.gift('magnet', p.slot, p.x, y);
        break;
      case 'boomerang':
        p.boom = RARE.boomerangCharge;
        this.gift('boomerang', p.slot, p.x, y);
        break;
      case 'double':
        p.don = 1;
        this.gift('double', p.slot, p.x, y);
        break;
      case 'decoy':
        // It looked like a Shield: a bomb now sits under you. Run.
        this.bombs.push({ id: this.nextId++, x: p.x, y: WORLD.height - HAZARDS.bombSize / 2, fuse: RARE.decoy.fuse, grounded: true, r: RARE.decoy.radius });
        this.gift('decoy', p.slot, p.x, y);
        break;
      case 'slow': {
        if (this.slowT <= 0) {
          for (const b of this.bubbles) {
            b.vx *= RARE.slowMul;
            b.vy *= RARE.slowMul;
          }
        }
        this.slowT = RARE.seconds.slow;
        this.gift('slow', p.slot, p.x, y);
        break;
      }
      case 'freeze': {
        const b = this.nearestOrb(p.x, (o) => o.fz === undefined);
        if (b) {
          b.fz = RARE.seconds.freeze;
          this.gift('freeze', p.slot, b.x, b.y);
        }
        break;
      }
      case 'pinata': {
        // The nearest plain small or medium orb breaks straight into pickups instead of children.
        const b = this.nearestOrb(p.x, (o) => o.size <= 1 && !o.sp);
        if (!b) {
          const t = this.skyRng.weighted(RARE.goodPool);
          if (t) this.spawnPowerUp(t, p.x, POWERUP.size);
          break;
        }
        const idx = this.bubbles.indexOf(b);
        const pts = BUBBLE_SIZES[b.size].points;
        p.score += pts;
        this.bubbles.splice(idx, 1);
        this.emit({ k: 'pop', id: b.id, s: b.size, x: Math.round(b.x), y: Math.round(b.y), by: p.slot, pts });
        const n = Math.min(RARE.pinataMax, b.size + 2);
        for (let i = 0; i < n; i++) {
          const t = this.skyRng.weighted(RARE.goodPool);
          if (t) this.spawnPowerUp(t, b.x + (i - (n - 1) / 2) * 34, b.y);
        }
        this.gift('pinata', p.slot, b.x, b.y);
        break;
      }
      case 'chest': {
        const target = this.nearestOrb(p.x, (o) => o.size < 3 && !o.sp);
        if (this.skyRng.next() < RARE.chestLife || !target) {
          p.lives = Math.min(PLAYER.maxLives, p.lives + 1);
          this.gift('chestLife', p.slot, p.x, y);
        } else {
          target.size = (target.size + 1) as BubbleSize;
          this.gift('chestCurse', p.slot, target.x, target.y);
        }
        break;
      }
      case 'baton':
        p.shield = Math.max(p.shield, POWERUP.durations.shield);
        if (this.specialHost.activePlayers() >= 2) this.baton = { owner: p.slot, t: RARE.batonSeconds };
        this.gift('baton', p.slot, p.x, y);
        break;
      case 'flare': {
        const down = this.players.find((q) => q.active && q.slot !== p.slot && (q.life === 'dead' || q.life === 'out'));
        if (!down) {
          this.gift('flareFizzle', p.slot, p.x, y);
          break;
        }
        if (down.life === 'out') down.lives = Math.max(1, down.lives);
        down.life = 'alive';
        down.respawnTimer = 0;
        down.x = p.x;
        down.invuln = PLAYER.invulnAfterRespawn;
        this.emit({ k: 'respawn', p: down.slot });
        this.gift('flare', p.slot, p.x, y, down.slot);
        break;
      }
      default:
        break;
    }
  }

  /** Slow Orbs wears off: orbs return to their normal speed with the same arc shape. */
  private stepSlow(dt: number): void {
    if (this.slowT <= 0) return;
    this.slowT -= dt;
    if (this.slowT > 0) return;
    this.slowT = 0;
    for (const b of this.bubbles) {
      b.vx /= RARE.slowMul;
      b.vy /= RARE.slowMul;
    }
    this.gift('slowEnd', -1, WORLD.width / 2, 100);
  }
}
