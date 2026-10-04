import { MATCH, PLAYER, TICK_RATE } from '../constants/game';
import type { LevelConfig } from '../types/level';
import type { MatchPhase, TickedEvent } from '../types/state';
import { shuffleLevels } from '../levels/order';
import { GameSimulation } from './GameSimulation';

export interface MatchOptions {
  levels: readonly LevelConfig[];
  activeSlots: boolean[];
  seed: number;
  /** With `shuffle`, the level to play first (an index into `levels`); otherwise the level to start on. */
  startLevel?: number;
  /** Play the levels in a random order (seeded, so server and replays agree) instead of by difficulty. */
  shuffle?: boolean;
  /** Chaos pickups allowed (host setting). */
  chaos?: boolean;
}

export type PauseReason = 'player' | 'disconnect';

/**
 * Drives a GameSimulation through countdown → playing → level complete → … →
 * game over / victory. Shared by the Durable Object (online) and the browser (solo).
 *
 * `tick` advances on every call regardless of phase, so it doubles as the
 * server clock clients synchronise against.
 */
export class Match {
  readonly sim: GameSimulation;
  tick = 0;
  phase: MatchPhase = 'countdown';
  phaseTicks = 0;
  /** Incremented whenever a level is (re)loaded so hosts know to announce it. */
  levelVersion = 0;
  pauseReason: PauseReason | null = null;
  pausedBy = -1;
  private pausedTicks = 0;
  private events: TickedEvent[] = [];

  constructor(opts: MatchOptions) {
    const levels = opts.shuffle ? shuffleLevels(opts.levels, opts.seed, opts.startLevel || undefined) : opts.levels;
    this.sim = new GameSimulation({ levels, activeSlots: opts.activeSlots, seed: opts.seed, chaos: opts.chaos });
    if (!opts.shuffle && opts.startLevel) this.sim.loadLevel(Math.min(opts.startLevel, opts.levels.length - 1));
    this.setPhase('countdown', MATCH.countdownSeconds);
  }

  get isTerminal(): boolean {
    return this.phase === 'gameOver' || this.phase === 'victory';
  }

  /** True when the world is moving and clients need high-rate snapshots. */
  get isLive(): boolean {
    return this.phase === 'playing';
  }

  drainEvents(): TickedEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  pause(reason: PauseReason, by: number): boolean {
    if (this.phase !== 'playing' && this.phase !== 'countdown') return false;
    this.pauseReason = reason;
    this.pausedBy = by;
    this.pausedTicks = 0;
    this.setPhase('paused', 0);
    return true;
  }

  /** Resume through a short countdown so nobody is ambushed. */
  resume(): boolean {
    if (this.phase !== 'paused') return false;
    this.pauseReason = null;
    this.pausedBy = -1;
    this.setPhase('countdown', MATCH.countdownSeconds);
    return true;
  }

  advance(): void {
    this.tick++;
    switch (this.phase) {
      case 'countdown':
        if (--this.phaseTicks <= 0) this.setPhase('playing', 0);
        break;
      case 'playing':
        this.stepPlaying();
        break;
      case 'paused':
        if (this.pauseReason === 'player' && ++this.pausedTicks > MATCH.maxPauseSeconds * TICK_RATE) this.resume();
        break;
      case 'levelComplete':
        if (--this.phaseTicks <= 0) {
          this.sim.reviveOutPlayers(PLAYER.reviveLives);
          this.sim.loadLevel(this.sim.levelIndex + 1);
          this.levelVersion++;
          this.setPhase('countdown', MATCH.countdownSeconds);
        }
        break;
      case 'timeUp':
        if (--this.phaseTicks <= 0) {
          this.sim.loadLevel(this.sim.levelIndex);
          this.levelVersion++;
          this.setPhase('countdown', MATCH.countdownSeconds);
        }
        break;
      case 'gameOver':
      case 'victory':
        break;
    }
  }

  private stepPlaying(): void {
    const sim = this.sim;
    sim.step();
    this.collectSimEvents();
    switch (sim.status) {
      case 'running':
        return;
      case 'cleared':
        this.setPhase(sim.isLastLevel ? 'victory' : 'levelComplete', sim.isLastLevel ? 0 : MATCH.levelCompleteSeconds);
        return;
      case 'timeup': {
        const survivors = sim.applyTimeUpPenalty();
        this.collectSimEvents();
        this.setPhase(survivors ? 'timeUp' : 'gameOver', survivors ? MATCH.timeUpSeconds : 0);
        return;
      }
      case 'gameover':
        this.setPhase('gameOver', 0);
        return;
    }
  }

  private collectSimEvents(): void {
    for (const e of this.sim.drainEvents()) this.events.push({ ...e, tick: this.tick });
  }

  private setPhase(phase: MatchPhase, seconds: number): void {
    this.phase = phase;
    this.phaseTicks = Math.round(seconds * TICK_RATE);
    this.events.push({ k: 'phase', ph: phase, tick: this.tick });
  }
}
