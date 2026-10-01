import { INPUT, ROOM } from '../constants/game';
import type { LevelConfig } from '../types/level';
import type { TickedEvent } from '../types/state';

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { t: 'in'; s: number; b: number }
  | { t: 'ready'; v: boolean }
  | { t: 'pause' }
  | { t: 'resume' }
  | { t: 'rematch' }
  | { t: 'solo' }
  | { t: 'lobby' }
  | { t: 'leave' }
  | { t: 'ping'; c: number };

const SIMPLE = new Set(['pause', 'resume', 'rematch', 'solo', 'lobby', 'leave']);

/**
 * Strict parser: anything malformed returns null and is dropped by the server.
 * Never throws.
 */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > ROOM.maxMessageBytes) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case 'in':
      if (!Number.isSafeInteger(o.s) || (o.s as number) < 1) return null;
      if (!Number.isInteger(o.b) || (o.b as number) < 0 || (o.b as number) > INPUT.MASK) return null;
      return { t: 'in', s: o.s as number, b: o.b as number };
    case 'ready':
      if (typeof o.v !== 'boolean') return null;
      return { t: 'ready', v: o.v };
    case 'ping':
      if (typeof o.c !== 'number' || !Number.isFinite(o.c)) return null;
      return { t: 'ping', c: o.c };
    default:
      if (typeof o.t === 'string' && SIMPLE.has(o.t)) return { t: o.t } as ClientMessage;
      return null;
  }
}

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'ROOM_FULL'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_EXPIRED'
  | 'BAD_REQUEST'
  | 'RATE_LIMIT'
  | 'REPLACED'
  | 'SERVER_ERROR';

/** WebSocket close codes used by the server (4000-4999 are application-defined). */
export const CLOSE_CODES = {
  LEFT: 4000,
  REPLACED: 4001,
  ROOM_FULL: 4003,
  ROOM_NOT_FOUND: 4004,
  RATE_LIMIT: 4008,
  ROOM_EXPIRED: 4010,
  BAD_REQUEST: 4400,
  SERVER_ERROR: 4500,
} as const;

/** Close codes after which the client must NOT auto-reconnect. */
export const FATAL_CLOSE_CODES: readonly number[] = [
  CLOSE_CODES.LEFT,
  CLOSE_CODES.REPLACED,
  CLOSE_CODES.ROOM_FULL,
  CLOSE_CODES.ROOM_NOT_FOUND,
  CLOSE_CODES.ROOM_EXPIRED,
  CLOSE_CODES.BAD_REQUEST,
];

/**
 * Room lifecycle as seen by clients. NEXT_LEVEL is the instant between
 * LEVEL_COMPLETE and the next COUNTDOWN (announced by a `level` message).
 */
export type RoomPhase =
  | 'WAITING_FOR_PLAYER'
  | 'PLAYER_JOINED'
  | 'READY'
  | 'COUNTDOWN'
  | 'PLAYING'
  | 'PAUSED'
  | 'LEVEL_COMPLETE'
  | 'TIME_UP'
  | 'GAME_OVER'
  | 'VICTORY'
  | 'CLOSED';

export interface SeatInfo {
  name: string;
  connected: boolean;
  ready: boolean;
  rematch: boolean;
  /** Participating in the current match. */
  active: boolean;
}

export interface RoomInfo {
  code: string;
  phase: RoomPhase;
  inMatch: boolean;
  seats: (SeatInfo | null)[];
  pause?: { by: number; reason: 'player' | 'disconnect' };
  /** A disconnected partner's reconnect window. */
  grace?: { slot: number; msLeft: number };
}

export interface SnapMessage {
  t: 'snap';
  /** Server match tick. */
  k: number;
  /** Phase index into MATCH_PHASES. */
  ph: number;
  /** Ticks left in the current phase (countdown etc.). */
  pt: number;
  /** Level ticks left on the clock. */
  tl: number;
  li: number;
  /** Ticks since the level started (drives timed platforms on clients). */
  lt: number;
  /** [slot, x, life, lives, score, flags, shield10, speed10, dbl10, lastSeq, ticksSince, facing] */
  p: number[][];
  /** [id, size, x, y, vx, vy, fast(0|1)] */
  b: number[][];
  /** [id, owner, x, tipY] */
  h: number[][];
  /** [id, typeIndex, x, y, life10] */
  u: number[][];
  /** Bombs: [id, x, y, fuse10] (omitted when none) */
  x?: number[][];
  e?: TickedEvent[];
}

export type ServerMessage =
  | { t: 'welcome'; slot: number; token: string; code: string }
  | ({ t: 'room' } & RoomInfo)
  | { t: 'level'; i: number; n: number; cfg: LevelConfig }
  | SnapMessage
  | { t: 'pong'; c: number; s: number }
  | { t: 'error'; code: ErrorCode; msg: string };
