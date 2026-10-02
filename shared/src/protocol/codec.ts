import { POWERUP_TYPES, SKY_KINDS, SPECIAL_KINDS, type SkyKind, type BubbleSize, type PowerUpType, type SpecialKind } from '../constants/game';
import type { Match } from '../sim/Match';
import type { BubbleState } from '../types/state';
import { MATCH_PHASES, type LifeState, type MatchPhase, type TickedEvent } from '../types/state';
import type { SnapMessage } from './messages';

const LIFE: LifeState[] = ['alive', 'dead', 'out'];
const r1 = (v: number) => Math.round(v * 10) / 10;
const t10 = (v: number) => Math.ceil(v * 10);

export const PLAYER_FLAG = { INVULN: 1, ACTIVE: 2 } as const;
export const BUBBLE_FLAG = { FAST: 1, RAGE: 2, HOT: 4 } as const;

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
  /** Seconds the Anchor pickup stays loaded. */
  anchor: number;
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
  fast?: boolean;
  rage?: boolean;
  hot?: boolean;
  sp?: SpecialKind;
  /** Special aux timer in seconds (see BubbleState.sa). */
  sa?: number;
  /** Twin partner id / sequence group. */
  lk?: number;
  /** Hit mask (sync, pincer, heavy). */
  hm?: number;
  /** Sequence place. */
  n?: number;
}
export interface NetBomb {
  id: number;
  x: number;
  y: number;
  fuse: number;
}
export interface NetHarpoon {
  id: number;
  owner: number;
  x: number;
  tipY: number;
  /** Anchor harpoon (sticks to the ceiling). */
  anchor?: boolean;
  /** Seconds of sticking left once stuck. */
  ttl?: number;
}
export interface NetPowerUp {
  id: number;
  type: PowerUpType;
  x: number;
  y: number;
  life: number;
}
/** The sky event in progress, as clients see it. */
export interface NetSky {
  kind: SkyKind;
  phase: 'warn' | 'active';
  /** Seconds left in this phase. */
  t: number;
  /** Gift x, or comet side. */
  a: number;
  lanes: number[];
}
export interface Snapshot {
  tick: number;
  phase: MatchPhase;
  phaseTicks: number;
  timeLeftTicks: number;
  levelIndex: number;
  levelTicks: number;
  players: NetPlayer[];
  bubbles: NetBubble[];
  harpoons: NetHarpoon[];
  powerups: NetPowerUp[];
  bombs: NetBomb[];
  sky?: NetSky;
  /** Heat as a share of the governor threshold (0 when cold, 1 = governor on). */
  heat: number;
  events: TickedEvent[];
}

/** Row: [id, size, x, y, vx, vy, flags(bit0 fast, bit1 rage)] plus [kindIndex, sa10, lk, hm, n] only for specials. */
function encodeBubble(b: BubbleState): number[] {
  const row = [b.id, b.size, r1(b.x), r1(b.y), r1(b.vx), r1(b.vy), (b.fast ? BUBBLE_FLAG.FAST : 0) | (b.rage ? BUBBLE_FLAG.RAGE : 0) | (b.hot ? BUBBLE_FLAG.HOT : 0)];
  if (b.sp) row.push(SPECIAL_KINDS.indexOf(b.sp), t10(b.sa ?? 0), b.lk ?? 0, b.hm ?? 0, b.n ?? 0);
  return row;
}

function decodeBubble(a: number[]): NetBubble {
  const out: NetBubble = { id: a[0], size: a[1] as BubbleSize, x: a[2], y: a[3], vx: a[4], vy: a[5], fast: (a[6] & BUBBLE_FLAG.FAST) !== 0 };
  if (a[6] & BUBBLE_FLAG.RAGE) out.rage = true;
  if (a[6] & BUBBLE_FLAG.HOT) out.hot = true;
  if (a.length > 7) {
    out.sp = SPECIAL_KINDS[a[7]];
    out.sa = a[8] / 10;
    if (a[9]) out.lk = a[9];
    if (a[10]) out.hm = a[10];
    if (a[11]) out.n = a[11];
  }
  return out;
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
    lt: sim.levelTicks,
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
      t10(p.anc),
    ]),
    b: sim.bubbles.map(encodeBubble),
    h: sim.harpoons.map((h) => (h.anchor ? [h.id, h.owner, r1(h.x), r1(h.tipY), 1, t10(h.ttl ?? 0)] : [h.id, h.owner, r1(h.x), r1(h.tipY)])),
    u: sim.powerups.map((u) => [u.id, POWERUP_TYPES.indexOf(u.type), r1(u.x), r1(u.y), t10(u.life)]),
  };
  if (sim.bombs.length) msg.x = sim.bombs.map((b) => [b.id, r1(b.x), r1(b.y), t10(b.fuse)]);
  if (sim.sky) msg.s = [SKY_KINDS.indexOf(sim.sky.kind), sim.sky.phase === 'active' ? 1 : 0, t10(sim.sky.t), sim.sky.a, ...sim.sky.lanes];
  if (sim.heat >= 0.05) msg.hl = Math.round(sim.heatRatio * 100);
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
    levelTicks: m.lt ?? 0,
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
      anchor: (a[12] ?? 0) / 10,
    })),
    bubbles: m.b.map(decodeBubble),
    harpoons: m.h.map((a) => (a.length > 4 ? { id: a[0], owner: a[1], x: a[2], tipY: a[3], anchor: true, ttl: a[5] / 10 } : { id: a[0], owner: a[1], x: a[2], tipY: a[3] })),
    powerups: m.u.map((a) => ({ id: a[0], type: POWERUP_TYPES[a[1]] ?? 'shield', x: a[2], y: a[3], life: a[4] / 10 })),
    bombs: (m.x ?? []).map((a) => ({ id: a[0], x: a[1], y: a[2], fuse: a[3] / 10 })),
    ...(m.s ? { sky: { kind: SKY_KINDS[m.s[0]], phase: m.s[1] ? ('active' as const) : ('warn' as const), t: m.s[2] / 10, a: m.s[3], lanes: m.s.slice(4) } } : {}),
    heat: (m.hl ?? 0) / 100,
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
    levelTicks: sim.levelTicks,
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
      anchor: p.anc,
      lastSeq: p.lastSeq,
      ticksSince: p.ticksSinceSeq,
      facing: p.facing,
    })),
    bubbles: sim.bubbles.map((b) => ({ ...b })),
    harpoons: sim.harpoons.map((h) => ({ id: h.id, owner: h.owner, x: h.x, tipY: h.tipY, ...(h.anchor ? { anchor: true, ttl: h.ttl ?? 0 } : {}) })),
    powerups: sim.powerups.map((u) => ({ id: u.id, type: u.type, x: u.x, y: u.y, life: u.life })),
    bombs: sim.bombs.map((b) => ({ id: b.id, x: b.x, y: b.y, fuse: b.fuse })),
    ...(sim.sky ? { sky: { ...sim.sky, lanes: [...sim.sky.lanes] } } : {}),
    heat: sim.heatRatio,
    events,
  };
}
