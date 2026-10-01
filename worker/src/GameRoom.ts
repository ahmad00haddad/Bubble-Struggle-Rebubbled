import { DurableObject } from 'cloudflare:workers';
import { TICK_MS } from '@orb/shared';
import type { Env } from './env';
import { RoomCore, type RoomHost, type RoomMeta } from './rooms/RoomCore';

interface Attachment {
  slot: number;
  token: string;
}

/** Max ticks simulated in one timer callback when the isolate was briefly starved. */
const MAX_CATCH_UP_TICKS = 4;

/**
 * One Durable Object instance = one room = one match.
 *
 * - WebSockets use the Hibernation API: lobby rooms are evicted from memory
 *   between messages and cost nothing while idle.
 * - While a match is live, a 30 Hz interval keeps the room in memory and the
 *   whole game state stays in RAM. Storage holds only the tiny room record.
 * - "ping" frames are answered by the runtime (auto-response) without waking
 *   the object.
 */
export class GameRoom extends DurableObject<Env> {
  private core!: RoomCore;
  private interval: ReturnType<typeof setInterval> | null = null;
  private loopStart = 0;
  private ticksDone = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void ctx.blockConcurrencyWhile(async () => {
      const meta = (await ctx.storage.get<RoomMeta>('meta')) ?? null;
      this.core = new RoomCore(this.host(), meta);
      for (const ws of ctx.getWebSockets()) {
        const att = ws.deserializeAttachment() as Attachment | null;
        if (!att || !this.core.restore(ws, att.slot, att.token)) {
          try {
            ws.close(4004, 'ROOM_NOT_FOUND');
          } catch {
            /* already closed */
          }
        }
      }
    });
  }

  private host(): RoomHost {
    const debug = this.env.LOG_LEVEL === 'debug';
    return {
      now: () => Date.now(),
      random: () => Math.random(),
      startLoop: () => this.startLoop(),
      stopLoop: () => this.stopLoop(),
      persist: (meta) => {
        if (meta) void this.ctx.storage.put('meta', meta);
        else void this.ctx.storage.deleteAll();
      },
      setAlarm: (at) => {
        if (at === null) void this.ctx.storage.deleteAlarm();
        else void this.ctx.storage.setAlarm(at);
      },
      log: (level, msg, data) => {
        if (level === 'info' && !debug && !msg.startsWith('room.') && !msg.startsWith('match.')) return;
        const line = JSON.stringify({ level, msg, ...data });
        if (level === 'error') console.error(line);
        else if (level === 'warn') console.warn(line);
        else console.log(line);
      },
    };
  }

  // ---- RPC (called by the Worker) -----------------------------------------

  async initRoom(code: string): Promise<'ok' | 'exists'> {
    return this.core.init(code);
  }

  async getStatus() {
    return this.core.status();
  }

  // ---- WebSocket upgrade --------------------------------------------------

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    const refused = this.core.admissionError(token);
    if (refused) {
      // Refused sockets are never hibernatable: accept, explain, close.
      server.accept();
      this.core.reject(server, refused);
      return new Response(null, { status: 101, webSocket: client });
    }

    this.ctx.acceptWebSocket(server);
    const res = this.core.join(server, url.searchParams.get('name'), token);
    if (res.ok) server.serializeAttachment({ slot: res.slot, token: res.token } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- Hibernation API handlers ------------------------------------------

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    this.reattach(ws);
    this.core.onMessage(ws, message);
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.reattach(ws);
    this.core.onClose(ws);
    try {
      ws.close(code === 1005 ? 1000 : code, 'closing');
    } catch {
      /* already closed */
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.reattach(ws);
    this.core.onClose(ws);
  }

  override async alarm(): Promise<void> {
    this.core.alarm();
  }

  /** Make sure the core knows this socket (object identity can change across hibernation). */
  private reattach(ws: WebSocket): void {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att) this.core.restore(ws, att.slot, att.token);
  }

  // ---- Game loop -----------------------------------------------------------

  private startLoop(): void {
    if (this.interval) return;
    this.loopStart = Date.now();
    this.ticksDone = 0;
    this.interval = setInterval(() => this.onInterval(), TICK_MS);
  }

  private stopLoop(): void {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = null;
  }

  private onInterval(): void {
    const due = Math.floor((Date.now() - this.loopStart) / TICK_MS) - this.ticksDone;
    const run = Math.min(due, MAX_CATCH_UP_TICKS);
    this.ticksDone += Math.max(due, 0);
    try {
      for (let i = 0; i < run && this.interval; i++) this.core.tick();
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'tick.failed', error: String(err) }));
    }
  }
}
