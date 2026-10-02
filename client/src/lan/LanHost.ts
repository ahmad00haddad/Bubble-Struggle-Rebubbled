import { TICK_MS } from '@orb/shared';
import { RoomCore, type Conn, type RoomHost } from '../../../worker/src/rooms/RoomCore';

/** Max ticks simulated in one timer callback after a stall (same rule as the Durable Object). */
const MAX_CATCH_UP_TICKS = 4;

/**
 * LAN mode: the host's browser runs the very same RoomCore the online server runs, and friends
 * connect to it over WebRTC data channels. Same rules, same simulation, same protocol; only the
 * place it runs changes. The host must keep the game tab visible (browsers slow hidden tabs).
 */
export class LanHost {
  readonly core: RoomCore;
  /** Guests that finished joining; `onAllJoined` fires when it reaches `expected`. */
  joined = 0;
  expected = 0;
  onAllJoined: () => void = () => {};

  private interval: ReturnType<typeof setInterval> | null = null;
  private alarm: ReturnType<typeof setTimeout> | null = null;
  private loopStart = 0;
  private ticksDone = 0;
  private channels: RTCDataChannel[] = [];
  private destroyed = false;

  constructor(code: string) {
    const host: RoomHost = {
      now: () => Date.now(),
      random: () => Math.random(),
      startLoop: () => this.startLoop(),
      stopLoop: () => this.stopLoop(),
      persist: () => {},
      setAlarm: (at) => {
        if (this.alarm) clearTimeout(this.alarm);
        this.alarm = at === null ? null : setTimeout(() => this.core.alarm(), Math.max(0, at - Date.now()));
      },
      log: () => {},
    };
    this.core = new RoomCore(host, null);
    this.core.init(code);
  }

  /** The host's own seat: `deliver` receives every frame the room sends it. */
  attachLocal(deliver: (data: string) => void, name: string): Conn {
    const conn: Conn = { send: deliver, close: () => {} };
    this.core.join(conn, name, null);
    return conn;
  }

  localMessage(conn: Conn, raw: string): void {
    if (!this.destroyed) this.core.onMessage(conn, raw);
  }

  /** A friend's data channel, once it has said hello. */
  attachPeer(dc: RTCDataChannel, name: string): boolean {
    if (this.destroyed) return false;
    const conn: Conn = {
      send: (data) => {
        if (dc.readyState === 'open') dc.send(data);
      },
      close: () => dc.close(),
    };
    const refused = this.core.admissionError(null);
    if (refused) {
      this.core.reject(conn, refused);
      return false;
    }
    this.channels.push(dc);
    dc.onmessage = (ev) => {
      if (typeof ev.data === 'string') this.core.onMessage(conn, ev.data);
    };
    dc.onclose = () => this.core.onClose(conn);
    this.core.join(conn, name, null);
    if (++this.joined === this.expected) this.onAllJoined();
    return true;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopLoop();
    if (this.alarm) clearTimeout(this.alarm);
    for (const dc of this.channels) {
      try {
        dc.close();
      } catch {
        /* already closed */
      }
    }
    this.channels = [];
  }

  private startLoop(): void {
    if (this.interval || this.destroyed) return;
    this.loopStart = Date.now();
    this.ticksDone = 0;
    this.interval = setInterval(() => {
      const due = Math.floor((Date.now() - this.loopStart) / TICK_MS) - this.ticksDone;
      const run = Math.min(due, MAX_CATCH_UP_TICKS);
      this.ticksDone += Math.max(due, 0);
      for (let i = 0; i < run && this.interval; i++) this.core.tick();
    }, TICK_MS);
  }

  private stopLoop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }
}
