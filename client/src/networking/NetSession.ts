import Phaser from 'phaser';
import {
  speedMulOf,
  decodeSnapshot,
  moveFxFromPlayers,
  type ErrorCode,
  type LevelConfig,
  type RoomInfo,
  type ServerMessage,
} from '@orb/shared';
import { wsUrl } from '../config/clientConfig';
import type { Link, NetStatus } from './Link';
import { NetClient } from './NetClient';
import { Prediction } from './Prediction';
import { SnapshotBuffer } from './SnapshotBuffer';

const tokenKey = (code: string) => `orb-lancers.token.${code}`;

/** Keep ?room=CODE in the address bar so a refresh rejoins the same seat. */
function setRoomParam(code: string | null): void {
  try {
    const u = new URL(window.location.href);
    if (code) u.searchParams.set('room', code);
    else u.searchParams.delete('room');
    window.history.replaceState(window.history.state, '', u);
  } catch {
    /* sandboxed iframe etc. */
  }
}

/**
 * Client view of one online room. Survives scene changes (stored in the game
 * registry) so lobby → game → lobby keeps the same connection.
 *
 * Events: 'welcome' | 'room' (RoomInfo) | 'level' | 'status' (NetStatus) | 'error' ({code,msg})
 */
export class NetSession extends Phaser.Events.EventEmitter {
  slot = -1;
  room: RoomInfo | null = null;
  level: LevelConfig | null = null;
  levelIndex = 0;
  levelCount = 0;
  error: { code: ErrorCode | 'UNREACHABLE'; msg: string } | null = null;
  readonly buffer = new SnapshotBuffer();
  readonly prediction = new Prediction();
  private client: Link;
  /** LAN mode: this session talks to a room run by one of the players, not to the online server. */
  readonly peer: boolean;
  private autoReady: boolean;
  private token: string | null;
  private left = false;

  constructor(
    readonly code: string,
    readonly nickname: string,
    opts: { link?: Link; peer?: boolean; autoReady?: boolean } = {},
  ) {
    super();
    this.peer = !!opts.peer;
    this.autoReady = !!opts.autoReady;
    this.token = this.peer ? null : sessionStorage.getItem(tokenKey(code));
    this.client =
      opts.link ??
      new NetClient(() => {
        const q = new URLSearchParams({ name: this.nickname });
        if (this.token) q.set('token', this.token);
        return wsUrl(`/api/rooms/${code}/ws?${q}`);
      });
    this.client.onMessage = (m) => this.handle(m);
    this.client.onStatus = (s) => {
      if (s === 'reconnecting') this.prediction.reset();
      if (s === 'closed' && !this.error && !this.left) {
        this.error = { code: 'UNREACHABLE', msg: this.peer ? 'Lost connection to the host of the match.' : 'Lost connection to the game server.' };
        this.emit('error', this.error);
      }
      this.emit('status', s);
    };
  }

  get status(): NetStatus {
    return this.client.status;
  }

  get rttMs(): number {
    return this.client.rttMs;
  }

  connect(): void {
    this.client.connect();
  }

  // ---- outbound --------------------------------------------------------------

  sendInput(bits: number): void {
    const seq = this.prediction.setBits(bits);
    if (seq !== null) this.client.send({ t: 'in', s: seq, b: bits });
  }

  /** Host only: switch chaos pickups on or off before the match starts. */
  setChaos(v: boolean): void {
    this.client.send({ t: 'chaos', v });
  }
  /** LAN mode: pass connection details to another player through the online room. */
  sendRtc(to: number, d: string): void {
    this.client.send({ t: 'rtc', to, d });
  }
  setReady(v: boolean): void {
    this.client.send({ t: 'ready', v });
  }
  pause(): void {
    this.client.send({ t: 'pause' });
  }
  resume(): void {
    this.client.send({ t: 'resume' });
  }
  rematch(): void {
    this.client.send({ t: 'rematch' });
  }
  continueSolo(): void {
    this.client.send({ t: 'solo' });
  }
  toLobby(): void {
    this.client.send({ t: 'lobby' });
  }

  /** Give up the seat for good and close. */
  leave(): void {
    this.left = true;
    this.client.send({ t: 'leave' });
    sessionStorage.removeItem(tokenKey(this.code));
    setRoomParam(null);
    setTimeout(() => this.client.close(), 100);
    this.removeAllListeners();
  }

  // ---- inbound ---------------------------------------------------------------

  private handle(m: ServerMessage): void {
    switch (m.t) {
      case 'welcome':
        this.slot = m.slot;
        this.prediction.reset();
        if (!this.peer) {
          this.token = m.token;
          sessionStorage.setItem(tokenKey(this.code), m.token);
          setRoomParam(this.code);
        }
        this.emit('welcome', m);
        if (this.autoReady) this.setReady(true);
        break;
      case 'rtc':
        this.emit('rtc', m.from, m.d);
        break;
      case 'room':
        this.room = m;
        this.emit('room', m);
        break;
      case 'level':
        this.level = m.cfg;
        this.levelIndex = m.i;
        this.levelCount = m.n;
        this.emit('level', m.cfg);
        break;
      case 'snap': {
        const s = decodeSnapshot(m);
        this.buffer.push(s, performance.now());
        const me = s.players[this.slot];
        if (me) this.prediction.reconcile(me, s.phase === 'playing', speedMulOf(me), moveFxFromPlayers(s.players, this.slot));
        break;
      }
      case 'error':
        this.error = { code: m.code, msg: m.msg };
        if (m.code === 'ROOM_EXPIRED' || m.code === 'ROOM_NOT_FOUND') {
          sessionStorage.removeItem(tokenKey(this.code));
          setRoomParam(null);
        }
        this.emit('error', this.error);
        break;
      case 'pong':
        break;
    }
  }
}
