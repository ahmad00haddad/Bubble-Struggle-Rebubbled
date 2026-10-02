import { FATAL_CLOSE_CODES, NET, type ErrorCode, type ServerMessage } from '@orb/shared';

import type { Link, NetStatus } from './Link';

export type { NetStatus } from './Link';

const FATAL_ERRORS: ErrorCode[] = ['ROOM_FULL', 'ROOM_NOT_FOUND', 'ROOM_EXPIRED', 'REPLACED', 'BAD_REQUEST'];

/**
 * One WebSocket with automatic reconnect (exponential-ish backoff), latency
 * measurement and fatal-error detection. Never polls: pings are tiny "ping"
 * text frames the Durable Object runtime answers without waking the room.
 */
export class NetClient implements Link {
  status: NetStatus = 'connecting';
  rttMs = 0;
  closeCode = 0;
  onMessage: (m: ServerMessage) => void = () => {};
  onStatus: (s: NetStatus) => void = () => {};

  private ws: WebSocket | null = null;
  private attempts = 0;
  private fatal = false;
  private userClosed = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingSentAt = 0;

  constructor(private url: () => string) {}

  connect(): void {
    this.cleanupSocket();
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url());
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.setStatus('open');
      this.ping();
      this.pingTimer = setInterval(() => this.ping(), NET.pingIntervalMs);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      if (ev.data === 'pong') {
        const sample = performance.now() - this.pingSentAt;
        this.rttMs = this.rttMs ? this.rttMs * 0.7 + sample * 0.3 : sample;
        return;
      }
      let m: ServerMessage;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.t === 'error' && FATAL_ERRORS.includes(m.code)) {
        this.fatal = true;
        // Don't wait for the server's close handshake.
        setTimeout(() => ws.close(), 50);
      }
      this.onMessage(m);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.stopPing();
      this.closeCode = ev.code;
      if (this.userClosed || this.fatal || FATAL_CLOSE_CODES.includes(ev.code)) {
        this.setStatus('closed');
      } else {
        this.scheduleRetry();
      }
    };
  }

  send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.userClosed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.stopPing();
    try {
      this.ws?.close(1000, 'bye');
    } catch {
      /* ignore */
    }
    this.setStatus('closed');
  }

  get isFatal(): boolean {
    return this.fatal;
  }

  private ping(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.pingSentAt = performance.now();
    this.ws.send('ping');
  }

  private scheduleRetry(): void {
    const delays = NET.reconnectDelaysMs;
    if (this.attempts >= delays.length) {
      this.setStatus('closed');
      return;
    }
    this.setStatus('reconnecting');
    const delay = delays[this.attempts++];
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private cleanupSocket(): void {
    this.stopPing();
    if (this.ws) {
      this.ws.onopen = this.ws.onmessage = this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.ws = null;
  }

  private setStatus(s: NetStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.onStatus(s);
  }
}
