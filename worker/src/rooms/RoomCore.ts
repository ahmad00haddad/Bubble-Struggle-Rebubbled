import {
  CLOSE_CODES,
  IDLE_SNAPSHOT_EVERY_TICKS,
  LEVELS,
  Match,
  ROOM,
  SNAPSHOT_EVERY_TICKS,
  encodeSnapshot,
  parseClientMessage,
  sanitizeNickname,
  type ClientMessage,
  type ErrorCode,
  type LevelConfig,
  type MatchPhase,
  type RoomInfo,
  type RoomPhase,
  type ServerMessage,
  type TickedEvent,
} from '@orb/shared';
import { RateLimiter } from '../networking/rateLimit';

/** Anything that can carry text frames to one client (a WebSocket in production). */
export interface Conn {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** Platform services the room needs. Implemented by the Durable Object (and by fakes in tests). */
export interface RoomHost {
  now(): number;
  random(): number;
  startLoop(): void;
  stopLoop(): void;
  /** Persist the small room record (never game state). */
  persist(meta: RoomMeta | null): void;
  /** Schedule (or clear) the single wake-up alarm. */
  setAlarm(atMs: number | null): void;
  log(level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>): void;
}

export interface SeatMeta {
  name: string;
  token: string;
  ready: boolean;
}

export interface RoomMeta {
  code: string;
  createdAt: number;
  everJoined: boolean;
  seats: (SeatMeta | null)[];
  /** Room option, host-controlled in the lobby. Absent means on. */
  chaos?: boolean;
  /** Set when the room has expired; the record is kept briefly as a tombstone. */
  expiredAt?: number;
}

interface Seat extends SeatMeta {
  conn: Conn | null;
  disconnectedAt: number | null;
  rematch: boolean;
  inputs: { s: number; b: number }[];
  lastSeqSeen: number;
  limiter: RateLimiter;
}

export type JoinResult = { ok: true; slot: number; token: string } | { ok: false; code: ErrorCode };

const emptySeats = <T>(): (T | null)[] => Array.from({ length: ROOM.maxPlayers }, () => null);

const PHASE_MAP: Record<MatchPhase, RoomPhase> = {
  countdown: 'COUNTDOWN',
  playing: 'PLAYING',
  paused: 'PAUSED',
  levelComplete: 'LEVEL_COMPLETE',
  timeUp: 'TIME_UP',
  gameOver: 'GAME_OVER',
  victory: 'VICTORY',
};

const ERROR_CLOSE: Partial<Record<ErrorCode, number>> = {
  ROOM_FULL: CLOSE_CODES.ROOM_FULL,
  ROOM_NOT_FOUND: CLOSE_CODES.ROOM_NOT_FOUND,
  ROOM_EXPIRED: CLOSE_CODES.ROOM_EXPIRED,
  BAD_REQUEST: CLOSE_CODES.BAD_REQUEST,
};

const ERROR_TEXT: Record<ErrorCode, string> = {
  ROOM_FULL: 'This room already has two players.',
  ROOM_NOT_FOUND: 'No room with that code exists.',
  ROOM_EXPIRED: 'This room has expired.',
  BAD_REQUEST: 'Invalid request.',
  RATE_LIMIT: 'Too many messages.',
  REPLACED: 'You joined this room from another tab.',
  SERVER_ERROR: 'Server error.',
};

/**
 * All room logic for one multiplayer match: seats, lobby, the authoritative
 * Match, snapshots, disconnect/reconnect, expiry. Has no Cloudflare
 * dependencies so it is unit-testable and portable to a plain Node server.
 */
export class RoomCore {
  meta: RoomMeta | null;
  seats: (Seat | null)[] = emptySeats();
  match: Match | null = null;
  private levels: readonly LevelConfig[];
  private loopRunning = false;
  private sentLevelVersion = -1;
  private lastPhase: RoomPhase | null = null;
  private pendingEvents: TickedEvent[] = [];
  private ticksSinceSnap = 0;
  private emptySince: number | null = null;
  private terminalSince: number | null = null;

  constructor(
    private host: RoomHost,
    meta: RoomMeta | null,
    levels: readonly LevelConfig[] = LEVELS,
  ) {
    this.levels = levels;
    this.meta = meta;
    if (meta && !meta.expiredAt) {
      const now = host.now();
      this.seats = meta.seats.map((s) =>
        // `ready` is lobby-only state; never resurrect it from storage.
        s ? { ...s, ready: false, conn: null, disconnectedAt: now, rematch: false, inputs: [], lastSeqSeen: 0, limiter: new RateLimiter() } : null,
      );
      while (this.seats.length < ROOM.maxPlayers) this.seats.push(null);
    }
  }

  get isOpen(): boolean {
    return !!this.meta && !this.meta.expiredAt;
  }

  // -------------------------------------------------------------------------
  // HTTP-level operations
  // -------------------------------------------------------------------------

  /** Claim this room for a freshly generated code. 'exists' → caller must pick another code. */
  init(code: string): 'ok' | 'exists' {
    if (this.isOpen) return 'exists';
    const now = this.host.now();
    this.meta = { code, createdAt: now, everJoined: false, seats: emptySeats() };
    this.seats = emptySeats();
    this.persist();
    this.scheduleAlarm();
    this.host.log('info', 'room.created', { code });
    return 'ok';
  }

  status(): { exists: boolean; expired: boolean; players: number; full: boolean; inMatch: boolean } {
    if (!this.meta) return { exists: false, expired: false, players: 0, full: false, inMatch: false };
    if (this.meta.expiredAt) return { exists: false, expired: true, players: 0, full: false, inMatch: false };
    const players = this.seats.filter(Boolean).length;
    return { exists: true, expired: false, players, full: players >= ROOM.maxPlayers, inMatch: !!this.match };
  }

  // -------------------------------------------------------------------------
  // Connections
  // -------------------------------------------------------------------------

  /** Why a connection would be refused, or null if it may join. */
  admissionError(token: unknown): ErrorCode | null {
    if (!this.meta) return 'ROOM_NOT_FOUND';
    if (this.meta.expiredAt) return 'ROOM_EXPIRED';
    if (typeof token === 'string' && token && this.seats.some((s) => s?.token === token)) return null;
    return this.seats.some((s) => s === null) ? null : 'ROOM_FULL';
  }

  /** Send the error frame and close code for a refused connection. */
  reject(conn: Conn, code: ErrorCode): void {
    this.sendTo(conn, { t: 'error', code, msg: ERROR_TEXT[code] });
    conn.close(ERROR_CLOSE[code] ?? CLOSE_CODES.BAD_REQUEST, code);
  }

  /** A new socket wants a seat. On failure the socket receives an error and is closed. */
  join(conn: Conn, rawName: unknown, token: unknown): JoinResult {
    const err = this.admissionError(token);
    if (err) {
      this.reject(conn, err);
      return { ok: false, code: err };
    }
    const meta = this.meta!;

    // Reconnect with an existing token → same seat.
    let slot = typeof token === 'string' && token ? this.seats.findIndex((s) => s?.token === token) : -1;
    const isNewSeat = slot < 0;
    if (slot >= 0) {
      const seat = this.seats[slot]!;
      if (seat.conn && seat.conn !== conn) {
        this.sendTo(seat.conn, { t: 'error', code: 'REPLACED', msg: ERROR_TEXT.REPLACED });
        seat.conn.close(CLOSE_CODES.REPLACED, 'REPLACED');
      }
      seat.conn = conn;
      seat.disconnectedAt = null;
      seat.inputs = [];
      this.host.log('info', 'player.reconnected', { code: meta.code, slot });
    } else {
      slot = this.seats.findIndex((s) => s === null);
      const name = sanitizeNickname(rawName, `Lancer ${slot + 1}`);
      this.seats[slot] = {
        name,
        token: crypto.randomUUID(),
        ready: false,
        conn,
        disconnectedAt: null,
        rematch: false,
        inputs: [],
        lastSeqSeen: 0,
        limiter: new RateLimiter(),
      };
      meta.everJoined = true;
      this.persist();
      this.host.log('info', 'player.joined', { code: meta.code, slot });
    }
    const seat = this.seats[slot]!;
    this.emptySince = null;
    // Input sequence numbers restart with every connection.
    seat.lastSeqSeen = 0;
    this.sendTo(conn, { t: 'welcome', slot, token: seat.token, code: meta.code });

    if (this.match) {
      const sim = this.match.sim;
      const p = sim.players[slot];
      if (p) {
        p.lastSeq = 0;
        p.ticksSinceSeq = 0;
        p.input = 0;
        if (!this.match.isTerminal) {
          // A brand-new partner starts fresh; a returning player keeps their stats.
          if (isNewSeat) sim.resetPlayer(slot);
          if (!p.active) sim.setActive(slot, true);
        }
      }
      this.sendLevel(conn);
      if (this.match.phase === 'paused' && this.match.pauseReason === 'disconnect' && this.allActiveConnected()) {
        this.match.resume();
      }
      this.sendTo(conn, encodeSnapshot(this.match, []));
      this.ensureLoop();
    }
    this.broadcastRoom();
    this.scheduleAlarm();
    return { ok: true, slot, token: seat.token };
  }

  /** Re-attach a socket that survived Durable Object hibernation. */
  restore(conn: Conn, slot: number, token: string): boolean {
    const seat = this.seats[slot];
    if (!seat || seat.token !== token) return false;
    seat.conn = conn;
    seat.disconnectedAt = null;
    return true;
  }

  onMessage(conn: Conn, raw: unknown): void {
    const slot = this.slotOf(conn);
    if (slot < 0) return;
    const seat = this.seats[slot]!;

    const verdict = seat.limiter.hit(this.host.now());
    if (verdict === 'kick') {
      this.host.log('warn', 'rate.kick', { code: this.meta?.code, slot });
      this.sendTo(conn, { t: 'error', code: 'RATE_LIMIT', msg: ERROR_TEXT.RATE_LIMIT });
      conn.close(CLOSE_CODES.RATE_LIMIT, 'RATE_LIMIT');
      this.onClose(conn);
      return;
    }
    if (verdict === 'drop') return;

    if (raw === 'ping') {
      // Normally answered by the runtime's auto-response without waking the DO.
      conn.send('pong');
      return;
    }
    const msg = parseClientMessage(raw);
    if (!msg) return;
    this.handle(slot, seat, msg);
  }

  onClose(conn: Conn): void {
    const slot = this.slotOf(conn);
    if (slot < 0) return;
    const seat = this.seats[slot]!;
    seat.conn = null;
    seat.disconnectedAt = this.host.now();
    seat.inputs = [];
    this.host.log('info', 'player.disconnected', { code: this.meta?.code, slot });

    const m = this.match;
    if (m && !m.isTerminal) {
      const p = m.sim.players[slot];
      if (p) p.input = 0;
      if (this.connectedCount() === 0) {
        // Nobody left to play with: freeze the world and stop burning CPU.
        m.pause('disconnect', slot);
        this.stopLoop();
      } else if (p?.active) {
        m.pause('disconnect', slot);
      }
    }
    if (!this.match) seat.ready = false;
    this.broadcastRoom();
    this.scheduleAlarm();
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  private handle(slot: number, seat: Seat, msg: ClientMessage): void {
    const m = this.match;
    switch (msg.t) {
      case 'in': {
        if (msg.s <= seat.lastSeqSeen) return; // duplicate / out of order
        seat.lastSeqSeen = msg.s;
        seat.inputs.push({ s: msg.s, b: msg.b });
        if (seat.inputs.length > ROOM.maxQueuedInputs) seat.inputs.splice(0, seat.inputs.length - ROOM.maxQueuedInputs / 2);
        return;
      }
      case 'ready': {
        if (m) return;
        seat.ready = msg.v;
        this.persist();
        this.maybeStartMatch();
        this.broadcastRoom();
        return;
      }
      case 'rtc': {
        // LAN mode signaling: hand the text to the other seat, untouched.
        const target = this.seats[msg.to];
        if (msg.to !== slot && target?.conn) this.sendTo(target.conn, { t: 'rtc', from: slot, d: msg.d });
        return;
      }
      case 'chaos': {
        // Host only, and only before a match starts.
        if (m || slot !== this.hostSlot() || !this.meta) return;
        this.meta.chaos = msg.v;
        this.persist();
        this.broadcastRoom();
        return;
      }
      case 'pause': {
        if (m && m.sim.players[slot]?.active && m.pause('player', slot)) {
          this.flushPhase();
        }
        return;
      }
      case 'resume': {
        if (!m || m.phase !== 'paused') return;
        if (m.pauseReason === 'disconnect' && !this.allActiveConnected()) return;
        m.resume();
        this.flushPhase();
        return;
      }
      case 'solo': {
        // Continue without a disconnected partner. Their seat stays reserved
        // until the grace period ends, so they can still drop back in.
        if (!m || m.isTerminal) return;
        let changed = false;
        this.seats.forEach((s, i) => {
          if (s && !s.conn && m.sim.players[i]?.active) {
            m.sim.setActive(i, false);
            changed = true;
          }
        });
        if (changed && m.phase === 'paused' && m.pauseReason === 'disconnect') m.resume();
        this.flushPhase();
        return;
      }
      case 'lobby': {
        this.endMatchToLobby();
        return;
      }
      case 'rematch': {
        if (!m) {
          // Room fell back to the lobby (e.g. after hibernation): treat as ready.
          seat.ready = true;
          this.maybeStartMatch();
          this.broadcastRoom();
          return;
        }
        if (!m.isTerminal) return;
        seat.rematch = true;
        const present = this.seats.filter((s): s is Seat => !!s && !!s.conn);
        if (present.length > 0 && present.every((s) => s.rematch)) this.startMatch();
        else this.broadcastRoom();
        return;
      }
      case 'leave': {
        const conn = seat.conn;
        this.freeSeat(slot);
        conn?.close(CLOSE_CODES.LEFT, 'LEFT');
        return;
      }
      case 'ping':
        seat.conn?.send(JSON.stringify({ t: 'pong', c: msg.c, s: m?.tick ?? 0 } satisfies ServerMessage));
        return;
    }
  }

  // -------------------------------------------------------------------------
  // Match lifecycle
  // -------------------------------------------------------------------------

  private maybeStartMatch(): void {
    const seated = this.seats.filter((s): s is Seat => !!s);
    if (seated.length >= ROOM.minPlayersToStart && seated.every((s) => s.ready && s.conn)) this.startMatch();
  }

  private startMatch(): void {
    if (!this.meta) return;
    const active = this.seats.map((s) => !!s && !!s.conn);
    this.match = new Match({ levels: this.levels, activeSlots: active, seed: Math.floor(this.host.random() * 2 ** 32), shuffle: true, chaos: this.meta.chaos !== false });
    this.sentLevelVersion = -1;
    this.pendingEvents = [];
    this.ticksSinceSnap = 0;
    for (const s of this.seats) {
      if (!s) continue;
      s.ready = false;
      s.rematch = false;
      s.inputs = [];
      s.lastSeqSeen = 0;
    }
    this.terminalSince = null;
    this.persist();
    this.host.log('info', 'match.start', { code: this.meta.code, players: active.filter(Boolean).length });
    this.broadcastRoomPhase('READY');
    this.syncLevel();
    this.flushPhase();
    this.ensureLoop();
  }

  private endMatchToLobby(): void {
    if (!this.match) return;
    this.match = null;
    this.stopLoop();
    this.seats.forEach((s, i) => {
      if (!s) return;
      s.ready = false;
      s.rematch = false;
      if (!s.conn) this.seats[i] = null;
    });
    this.persist();
    this.broadcastRoom();
    this.scheduleAlarm();
  }

  private freeSeat(slot: number): void {
    const seat = this.seats[slot];
    if (!seat) return;
    this.seats[slot] = null;
    this.host.log('info', 'seat.freed', { code: this.meta?.code, slot });
    const m = this.match;
    if (m) {
      m.sim.setActive(slot, false);
      const remaining = this.seats.some((s) => s && s.conn);
      if (!remaining) {
        this.match = null;
        this.stopLoop();
      } else if (m.phase === 'paused' && m.pauseReason === 'disconnect' && this.allActiveConnected()) {
        m.resume();
      } else if (!m.isTerminal && !m.sim.players.some((p) => p.active)) {
        this.match = null;
        this.stopLoop();
      }
    }
    for (const s of this.seats) if (s) s.ready = false;
    this.persist();
    this.broadcastRoom();
    this.scheduleAlarm();
  }

  /** Called by the host at TICK_RATE while a match is live. */
  tick(): void {
    const m = this.match;
    this.checkDeadlines();
    if (!m) {
      this.stopLoop();
      return;
    }
    // Never let the world run while an active player is missing (e.g. they
    // dropped during a level-complete screen and the next level is starting).
    if (m.phase === 'countdown' || m.phase === 'playing') {
      const missing = this.seats.findIndex((s, i) => !!s && !s.conn && !!m.sim.players[i]?.active);
      if (missing >= 0 && m.pause('disconnect', missing)) {
        this.pendingEvents.push(...m.drainEvents());
        this.broadcastRoom();
      }
    }
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i];
      const inp = s?.inputs.shift();
      if (inp) m.sim.setInput(i, inp.b, inp.s);
    }
    m.advance();
    this.pendingEvents.push(...m.drainEvents());
    this.syncLevel();

    const phase = this.computePhase();
    const changed = phase !== this.lastPhase;
    this.ticksSinceSnap++;
    const every = m.isLive ? SNAPSHOT_EVERY_TICKS : IDLE_SNAPSHOT_EVERY_TICKS;
    if (changed || (!m.isTerminal && this.ticksSinceSnap >= every)) this.sendSnapshot();
    if (changed) this.broadcastRoom();

    if (m.isTerminal) {
      // Results screen: nothing moves, so send nothing. Stay in memory for a
      // while so rematch votes work, then let the object hibernate.
      const now = this.host.now();
      if (this.terminalSince === null) {
        this.terminalSince = now;
        this.host.log('info', 'match.end', { code: this.meta?.code, phase: m.phase, levelIndex: m.sim.levelIndex });
        this.scheduleAlarm();
      } else if (now - this.terminalSince > ROOM.terminalHoldSeconds * 1000) {
        this.stopLoop();
      }
    }
  }

  /** Called by the host when the alarm fires. */
  alarm(): void {
    this.checkDeadlines();
    if (this.meta) this.scheduleAlarm();
  }

  private checkDeadlines(): void {
    const meta = this.meta;
    if (!meta) return;
    const now = this.host.now();

    if (meta.expiredAt) {
      if (now >= meta.expiredAt + ROOM.tombstoneTtlSeconds * 1000) {
        this.meta = null;
        this.host.persist(null);
        this.host.setAlarm(null);
      }
      return;
    }
    if (now >= meta.createdAt + ROOM.maxRoomLifetimeSeconds * 1000) return this.expire('lifetime');
    if (!meta.everJoined && now >= meta.createdAt + ROOM.unjoinedRoomTtlSeconds * 1000) return this.expire('unjoined');

    // Free seats whose owner did not come back in time.
    this.seats.forEach((s, i) => {
      if (s && !s.conn && s.disconnectedAt !== null && now >= s.disconnectedAt + ROOM.disconnectGraceSeconds * 1000) {
        this.host.log('info', 'grace.expired', { code: meta.code, slot: i });
        this.freeSeat(i);
      }
    });

    if (meta.everJoined) {
      if (this.connectedCount() === 0) {
        this.emptySince ??= now;
        if (now >= this.emptySince + ROOM.emptyRoomTtlSeconds * 1000) return this.expire('empty');
      } else {
        this.emptySince = null;
      }
    }
  }

  private expire(reason: string): void {
    if (!this.meta) return;
    this.host.log('info', 'room.expired', { code: this.meta.code, reason });
    for (const s of this.seats) {
      if (s?.conn) {
        this.sendTo(s.conn, { t: 'error', code: 'ROOM_EXPIRED', msg: ERROR_TEXT.ROOM_EXPIRED });
        s.conn.close(CLOSE_CODES.ROOM_EXPIRED, 'ROOM_EXPIRED');
      }
    }
    this.match = null;
    this.stopLoop();
    this.seats = emptySeats();
    this.meta = { code: this.meta.code, createdAt: this.meta.createdAt, everJoined: true, seats: [], expiredAt: this.host.now() };
    this.persist();
    this.scheduleAlarm();
  }

  private scheduleAlarm(): void {
    const meta = this.meta;
    if (!meta) return this.host.setAlarm(null);
    if (meta.expiredAt) return this.host.setAlarm(meta.expiredAt + ROOM.tombstoneTtlSeconds * 1000);
    const now = this.host.now();
    const candidates = [meta.createdAt + ROOM.maxRoomLifetimeSeconds * 1000];
    if (!meta.everJoined) candidates.push(meta.createdAt + ROOM.unjoinedRoomTtlSeconds * 1000);
    for (const s of this.seats) {
      if (s && !s.conn && s.disconnectedAt !== null) candidates.push(s.disconnectedAt + ROOM.disconnectGraceSeconds * 1000);
    }
    if (meta.everJoined && this.connectedCount() === 0) {
      candidates.push((this.emptySince ?? now) + ROOM.emptyRoomTtlSeconds * 1000);
    }
    this.host.setAlarm(Math.max(now + 1000, Math.min(...candidates)));
  }

  // -------------------------------------------------------------------------
  // Outbound
  // -------------------------------------------------------------------------

  roomInfo(): RoomInfo {
    const m = this.match;
    const now = this.host.now();
    const info: RoomInfo = {
      code: this.meta?.code ?? '',
      phase: this.computePhase(),
      inMatch: !!m,
      host: this.hostSlot(),
      chaos: this.meta?.chaos !== false,
      seats: this.seats.map((s, i) =>
        s
          ? {
              name: s.name,
              connected: !!s.conn,
              ready: s.ready,
              rematch: s.rematch,
              active: !!m?.sim.players[i]?.active,
            }
          : null,
      ),
    };
    if (m?.phase === 'paused' && m.pauseReason) info.pause = { by: m.pausedBy, reason: m.pauseReason };
    const gone = this.seats.findIndex((s) => s && !s.conn && s.disconnectedAt !== null);
    if (gone >= 0) {
      const s = this.seats[gone]!;
      info.grace = { slot: gone, msLeft: Math.max(0, s.disconnectedAt! + ROOM.disconnectGraceSeconds * 1000 - now) };
    }
    return info;
  }

  /** The host is the lowest seated slot (the room creator unless they left). */
  private hostSlot(): number {
    return this.seats.findIndex((s) => !!s);
  }

  private computePhase(): RoomPhase {
    if (!this.isOpen) return 'CLOSED';
    if (this.match) return PHASE_MAP[this.match.phase];
    const seated = this.seats.filter((s): s is Seat => !!s);
    if (seated.length < ROOM.minPlayersToStart) return 'WAITING_FOR_PLAYER';
    return seated.every((s) => s.ready) ? 'READY' : 'PLAYER_JOINED';
  }

  private broadcastRoom(): void {
    const info = this.roomInfo();
    this.lastPhase = info.phase;
    this.broadcast({ t: 'room', ...info });
  }

  private broadcastRoomPhase(phase: RoomPhase): void {
    this.broadcast({ t: 'room', ...this.roomInfo(), phase });
  }

  /** Push phase change immediately (pause/resume feel instant). */
  private flushPhase(): void {
    if (this.match) {
      this.pendingEvents.push(...this.match.drainEvents());
      this.sendSnapshot();
    }
    this.broadcastRoom();
  }

  private syncLevel(): void {
    const m = this.match;
    if (!m || m.levelVersion === this.sentLevelVersion) return;
    this.sentLevelVersion = m.levelVersion;
    for (const s of this.seats) if (s?.conn) this.sendLevel(s.conn);
  }

  private sendLevel(conn: Conn): void {
    const m = this.match;
    if (!m) return;
    this.sendTo(conn, { t: 'level', i: m.sim.levelIndex, n: this.levels.length, cfg: m.sim.level });
  }

  private sendSnapshot(): void {
    if (!this.match) return;
    const snap = encodeSnapshot(this.match, this.pendingEvents);
    this.pendingEvents = [];
    this.ticksSinceSnap = 0;
    this.broadcast(snap);
  }

  private broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const s of this.seats) {
      if (!s?.conn) continue;
      try {
        s.conn.send(data);
      } catch {
        // Socket died between checks; the close handler will clean up.
      }
    }
  }

  private sendTo(conn: Conn, msg: ServerMessage): void {
    try {
      conn.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private slotOf(conn: Conn): number {
    return this.seats.findIndex((s) => s?.conn === conn);
  }

  private connectedCount(): number {
    return this.seats.reduce((n, s) => n + (s?.conn ? 1 : 0), 0);
  }

  private allActiveConnected(): boolean {
    const m = this.match;
    return this.seats.every((s, i) => !m?.sim.players[i]?.active || !!s?.conn);
  }

  private ensureLoop(): void {
    if (this.loopRunning || !this.match || this.match.isTerminal) return;
    this.loopRunning = true;
    this.host.startLoop();
  }

  private stopLoop(): void {
    if (!this.loopRunning) return;
    this.loopRunning = false;
    this.host.stopLoop();
  }

  private persist(): void {
    if (!this.meta) return;
    if (!this.meta.expiredAt) {
      this.meta.seats = this.seats.map((s) => (s ? { name: s.name, token: s.token, ready: s.ready } : null));
    }
    this.host.persist(this.meta);
  }
}
