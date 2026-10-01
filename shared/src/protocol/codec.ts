import { POWERUP_TYPES, type BubbleSize, type PowerUpType } from '../constants/game';
import type { Match } from '../sim/Match';
import { MATCH_PHASES, type LifeState, type MatchPhase, type TickedEvent } from '../types/state';
import type { SnapMessage } from './messages';

const LIFE: LifeState[] = ['alive', 'dead', 'out'];
const r1 = (v: number) => Math.round(v * 10) / 10;
const t10 = (v: number) => Math.ceil(v * 10);

export const PLAYER_FLAG = { INVULN: 1, ACTIVE: 2 } as const;

/** Decoded, render-friendly snapshot. */
export interface NetPlayer {
  slot: number;
  x: number;
  life: LifeState;
  lives: number;
  score: number;
  invuln: boolean;
  active: boolean;
  shield: number;
  speed: number;
  dbl: number;
  lastSeq: number;
  ticksSince: number;
  facing: -1 | 1;
}
export interface NetBubble {
  id: number;
  size: BubbleSize;
  x: number;
  y: number;
  vx: number;
  vy: number;
}
export interface NetHarpoon {
  id: number;
  owner: number;
  x: number;
  tipY: number;
}
export interface NetPowerUp {
  id: number;
  type: PowerUpType;
  x: number;
  y: number;
  life: number;
}
export interface Snapshot {
  tick: number;
  phase: MatchPhase;
  phaseTicks: number;
  timeLeftTicks: number;
  levelIndex: number;
  players: NetPlayer[];
  bubbles: NetBubble[];
  harpoons: NetHarpoon[];
  powerups: NetPowerUp[];
  events: TickedEvent[];
}

export function encodeSnapshot(match: Match, events: TickedEvent[]): SnapMessage {
  const sim = match.sim;
  const msg: SnapMessage = {
    t: 'snap',
    k: match.tick,
    ph: MATCH_PHASES.indexOf(match.phase),
    pt: match.phaseTicks,
    tl: sim.timeLeftTicks,
    li: sim.levelIndex,
    p: sim.players.map((p) => [
      p.slot,
      r1(p.x),
      LIFE.indexOf(p.life),
      p.lives,
      p.score,
      (p.invuln > 0 ? PLAYER_FLAG.INVULN : 0) | (p.active ? PLAYER_FLAG.ACTIVE : 0),
      t10(p.shield),
      t10(p.speed),
      t10(p.dbl),
      p.lastSeq,
      p.ticksSinceSeq,
      p.facing,
    ]),
    b: sim.bubbles.map((b) => [b.id, b.size, r1(b.x), r1(b.y), r1(b.vx), r1(b.vy)]),
    h: sim.harpoons.map((h) => [h.id, h.owner, r1(h.x), r1(h.tipY)]),
    u: sim.powerups.map((u) => [u.id, POWERUP_TYPES.indexOf(u.type), r1(u.x), r1(u.y), t10(u.life)]),
  };
  if (events.length) msg.e = events;
  return msg;
}

export function decodeSnapshot(m: SnapMessage): Snapshot {
  return {
    tick: m.k,
    phase: MATCH_PHASES[m.ph] ?? 'playing',
    phaseTicks: m.pt,
    timeLeftTicks: m.tl,
    levelIndex: m.li,
    players: m.p.map((a) => ({
      slot: a[0],
      x: a[1],
      life: LIFE[a[2]] ?? 'alive',
      lives: a[3],
      score: a[4],
      invuln: (a[5] & PLAYER_FLAG.INVULN) !== 0,
      active: (a[5] & PLAYER_FLAG.ACTIVE) !== 0,
      shield: a[6] / 10,
      speed: a[7] / 10,
      dbl: a[8] / 10,
      lastSeq: a[9],
      ticksSince: a[10],
      facing: a[11] < 0 ? -1 : 1,
    })),
    bubbles: m.b.map((a) => ({ id: a[0], size: a[1] as BubbleSize, x: a[2], y: a[3], vx: a[4], vy: a[5] })),
    harpoons: m.h.map((a) => ({ id: a[0], owner: a[1], x: a[2], tipY: a[3] })),
    powerups: m.u.map((a) => ({ id: a[0], type: POWERUP_TYPES[a[1]] ?? 'shield', x: a[2], y: a[3], life: a[4] / 10 })),
    events: m.e ?? [],
  };
}

/** Build the same decoded view directly from a local match (solo mode). */
export function snapshotFromMatch(match: Match, events: TickedEvent[] = []): Snapshot {
  const sim = match.sim;
  return {
    tick: match.tick,
    phase: match.phase,
    phaseTicks: match.phaseTicks,
    timeLeftTicks: sim.timeLeftTicks,
    levelIndex: sim.levelIndex,
    players: sim.players.map((p) => ({
      slot: p.slot,
      x: p.x,
      life: p.life,
      lives: p.lives,
      score: p.score,
      invuln: p.invuln > 0,
      active: p.active,
      shield: p.shield,
      speed: p.speed,
      dbl: p.dbl,
      lastSeq: p.lastSeq,
      ticksSince: p.ticksSinceSeq,
      facing: p.facing,
    })),
    bubbles: sim.bubbles.map((b) => ({ ...b })),
    harpoons: sim.harpoons.map((h) => ({ ...h })),
    powerups: sim.powerups.map((u) => ({ id: u.id, type: u.type, x: u.x, y: u.y, life: u.life })),
    events,
  };
}
