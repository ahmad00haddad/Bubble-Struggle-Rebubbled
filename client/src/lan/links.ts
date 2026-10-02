import { NET, type ServerMessage } from '@orb/shared';
import type { Conn } from '../../../worker/src/rooms/RoomCore';
import type { Link, NetStatus } from '../networking/Link';
import type { LanHost } from './LanHost';

/** A friend's end of the match: one WebRTC data channel to the host. */
export class RtcGuestLink implements Link {
  status: NetStatus = 'connecting';
  rttMs = 0;
  closeCode = 0;
  isFatal = false;
  onMessage: (m: ServerMessage) => void = () => {};
  onStatus: (s: NetStatus) => void = () => {};

  private timer: ReturnType<typeof setInterval> | null = null;
  private sentAt = 0;

  constructor(
    private dc: RTCDataChannel,
    private name: string,
  ) {}

  connect(): void {
    const dc = this.dc;
    dc.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      if (ev.data === 'pong') {
        const sample = performance.now() - this.sentAt;
        this.rttMs = this.rttMs ? this.rttMs * 0.7 + sample * 0.3 : sample;
        return;
      }
      try {
        this.onMessage(JSON.parse(ev.data) as ServerMessage);
      } catch {
        /* ignore garbage */
      }
    };
    dc.onclose = () => this.end();
    dc.onerror = () => this.end();
    const open = () => {
      this.setStatus('open');
      // The host seats us when it hears this (it ignores the channel until then).
      dc.send(JSON.stringify({ t: 'hello', name: this.name }));
      this.ping();
      this.timer = setInterval(() => this.ping(), Math.min(NET.pingIntervalMs, 2000));
    };
    if (dc.readyState === 'open') open();
    else dc.onopen = open;
  }

  send(msg: object): void {
    if (this.dc.readyState === 'open') this.dc.send(JSON.stringify(msg));
  }

  close(): void {
    this.end();
    try {
      this.dc.close();
    } catch {
      /* ignore */
    }
  }

  private ping(): void {
    if (this.dc.readyState !== 'open') return;
    this.sentAt = performance.now();
    this.dc.send('ping');
  }

  private end(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.isFatal = true;
    this.setStatus('closed');
  }

  private setStatus(s: NetStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.onStatus(s);
  }
}

/** The host's own seat: talks to the room running in this very tab, no network at all. */
export class LoopLink implements Link {
  status: NetStatus = 'connecting';
  rttMs = 0;
  closeCode = 0;
  readonly isFatal = false;
  onMessage: (m: ServerMessage) => void = () => {};
  onStatus: (s: NetStatus) => void = () => {};

  private conn: Conn | null = null;

  constructor(
    private host: LanHost,
    private name: string,
  ) {}

  connect(): void {
    this.status = 'open';
    this.onStatus('open');
    this.conn = this.host.attachLocal((data) => {
      // Deliver on a microtask so the room is never re-entered from its own send.
      queueMicrotask(() => {
        if (data === 'pong') return;
        try {
          this.onMessage(JSON.parse(data) as ServerMessage);
        } catch {
          /* ignore */
        }
      });
    }, this.name);
  }

  send(msg: object): void {
    if (this.conn) this.host.localMessage(this.conn, JSON.stringify(msg));
  }

  close(): void {
    this.status = 'closed';
    this.host.destroy();
  }
}
