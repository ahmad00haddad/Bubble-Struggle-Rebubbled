import {
  BUBBLE_SIZES,
  HARPOON,
  INPUT,
  PHYSICS,
  PLAYER,
  POWERUP,
  SCORING,
  TICK_DT,
  TICK_RATE,
  WORLD,
  type BubbleSize,
  type PowerUpType,
} from '../constants/game';
import type { LevelConfig } from '../types/level';
import type {
  BubbleState,
  HarpoonState,
  PlayerState,
  PowerUpState,
  SimEvent,
  SimStatus,
} from '../types/state';
import { advanceBubble, advanceHarpoon, advancePowerUp, circleRectOverlap, harpoonRect, movePlayerX, playerHitbox } from './physics';
import { Rng } from './rng';

export interface SimOptions {
  levels: readonly LevelConfig[];
  /** One entry per seat; true = participating. Length is the seat count (1 or 2). */
  activeSlots: boolean[];
  seed: number;
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
  levelTicks = 0;
  timeLeftTicks = 0;
  status: SimStatus = 'running';
  players: PlayerState[];
  bubbles: BubbleState[] = [];
  harpoons: HarpoonState[] = [];
  powerups: PowerUpState[] = [];
  private nextId = 1;
  private placedSpawned = new Set<number>();
  private events: SimEvent[] = [];

  constructor(opts: SimOptions) {
    if (opts.levels.length === 0) throw new Error('No levels');
    this.levels = opts.levels;
    this.rng = new Rng(opts.seed);
    this.players = opts.activeSlots.map((a, i) => newPlayer(i, a));
    this.loadLevel(0);
  }

  get speedMul(): number {
    return this.level.difficulty.bubbleSpeed;
  }

  get isLastLevel(): boolean {
    return this.levelIndex >= this.levels.length - 1;
  }

  /** Load (or reload) a level. Scores and lives carry over. */
  loadLevel(index: number): void {
    this.levelIndex = index;
    this.level = this.levels[index];
    this.levelTicks = 0;
    this.timeLeftTicks = Math.round(this.level.timeLimit * TICK_RATE);
    this.status = 'running';
    this.harpoons = [];
    this.powerups = [];
    this.placedSpawned.clear();
    const m = this.speedMul;
    this.bubbles = this.level.bubbles.map((s) => ({
      id: this.nextId++,
      size: s.size,
      x: s.x,
      y: s.y,
      vx: (s.velocityX ?? BUBBLE_SIZES[s.size].speedX) * m,
      vy: (s.velocityY ?? 0) * m,
    }));
    for (const p of this.players) {
      p.x = this.level.playerSpawnPoints[p.slot] ?? WORLD.width / 2;
      p.facing = 1;
      p.shootLatch = false;
      p.respawnTimer = 0;
      p.invuln = 0;
      p.speed = 0;
      p.dbl = 0;
      p.cooldown = 0;
      p.hitThisLevel = false;
      if (p.active && p.life === 'dead') p.life = p.lives > 0 ? 'alive' : 'out';
    }
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
    p.x = this.level.playerSpawnPoints[slot] ?? WORLD.width / 2;
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
    const platforms = this.level.platforms;

    this.timeLeftTicks--;

    // --- Players -----------------------------------------------------------
    for (const p of this.players) {
      if (!p.active) continue;
      p.ticksSinceSeq++;
      if (p.life === 'dead') {
        p.respawnTimer -= dt;
        if (p.respawnTimer <= 0) {
          p.life = 'alive';
          p.x = this.level.playerSpawnPoints[p.slot] ?? WORLD.width / 2;
          p.invuln = PLAYER.invulnAfterRespawn;
          this.emit({ k: 'respawn', p: p.slot });
        }
        continue;
      }
      if (p.life !== 'alive') continue;

      const speedMul = p.speed > 0 ? POWERUP.speedMultiplier : 1;
      p.x = movePlayerX(p.x, p.input, speedMul, dt);
      if (p.input & INPUT.LEFT && !(p.input & INPUT.RIGHT)) p.facing = -1;
      else if (p.input & INPUT.RIGHT && !(p.input & INPUT.LEFT)) p.facing = 1;

      p.invuln = Math.max(0, p.invuln - dt);
      p.shield = Math.max(0, p.shield - dt);
      p.speed = Math.max(0, p.speed - dt);
      p.dbl = Math.max(0, p.dbl - dt);
      p.cooldown = Math.max(0, p.cooldown - dt);

      if (p.shootLatch) {
        p.shootLatch = false;
        const max = p.dbl > 0 ? HARPOON.doubleMax : HARPOON.baseMax;
        const mine = this.harpoons.reduce((n, h) => n + (h.owner === p.slot ? 1 : 0), 0);
        if (p.cooldown <= 0 && mine < max) {
          p.cooldown = HARPOON.cooldown;
          this.harpoons.push({ id: this.nextId++, owner: p.slot, x: p.x, tipY: WORLD.height - PLAYER.height });
          this.emit({ k: 'shoot', p: p.slot, x: Math.round(p.x) });
        }
      }
    }

    // --- Orbs --------------------------------------------------------------
    for (const b of this.bubbles) advanceBubble(b, dt, platforms, this.speedMul);

    // --- Harpoons: travel, then hit test along the whole tether -----------
    const survivors: HarpoonState[] = [];
    for (const h of this.harpoons) {
      const tip = advanceHarpoon(h.x, h.tipY, dt, platforms);
      if (tip === null) continue;
      h.tipY = tip;
      const rect = harpoonRect(h.x, h.tipY);
      const idx = this.bubbles.findIndex((b) => circleRectOverlap(b.x, b.y, BUBBLE_SIZES[b.size].radius, rect));
      if (idx >= 0) {
        this.popBubble(idx, h.owner);
        continue;
      }
      survivors.push(h);
    }
    this.harpoons = survivors;

    // --- Orb vs player ----------------------------------------------------
    for (const p of this.players) {
      if (!p.active || p.life !== 'alive' || p.invuln > 0) continue;
      const box = playerHitbox(p.x);
      const hit = this.bubbles.some((b) => circleRectOverlap(b.x, b.y, BUBBLE_SIZES[b.size].radius - 1, box));
      if (hit) this.damagePlayer(p);
    }

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
    const pts = BUBBLE_SIZES[b.size].points;
    const scorer = this.players[by];
    if (scorer) scorer.score += pts;
    this.bubbles.splice(index, 1);
    this.emit({ k: 'pop', id: b.id, s: b.size, x: Math.round(b.x), y: Math.round(b.y), by, pts });

    if (b.size > 0) {
      const child = (b.size - 1) as BubbleSize;
      const m = this.speedMul;
      const vx = BUBBLE_SIZES[child].speedX * m;
      const vy = -PHYSICS.splitKickVy * m;
      this.bubbles.push(
        { id: this.nextId++, size: child, x: b.x, y: b.y, vx: -vx, vy },
        { id: this.nextId++, size: child, x: b.x, y: b.y, vx, vy },
      );
    }

    const pu = this.level.powerUps;
    if (this.powerups.length < POWERUP.maxOnField && this.rng.next() < pu.dropChance) {
      const type = this.rng.weighted(pu.pool);
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
    }
  }
}
