import { generateRoomCode, normalizeRoomCode } from '@orb/shared';
import type { Env } from './env';
import { corsHeaders, isOriginAllowed, json } from './networking/http';

export { GameRoom } from './GameRoom';

const MAX_CODE_ATTEMPTS = 8;

/**
 * HTTP edge:
 *   GET  /api/health
 *   POST /api/rooms              → { code }
 *   GET  /api/rooms/:code        → { exists, expired, players, full, inMatch }
 *   GET  /api/rooms/:code/ws     → WebSocket (forwarded to the room's Durable Object)
 *   *                            → static client (when deployed with assets)
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    if (!path.startsWith('/api')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (!isOriginAllowed(request, env)) {
      return json(request, env, { error: 'ORIGIN_NOT_ALLOWED' }, 403);
    }

    try {
      if (path === '/api/health') {
        return json(request, env, { ok: true, env: env.ENVIRONMENT ?? 'unknown', time: Date.now() });
      }

      if (path === '/api/rooms' && request.method === 'POST') {
        for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
          const code = generateRoomCode();
          const stub = env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(code));
          if ((await stub.initRoom(code)) === 'ok') return json(request, env, { code }, 201);
        }
        return json(request, env, { error: 'NO_CODE_AVAILABLE' }, 503);
      }

      const m = path.match(/^\/api\/rooms\/([^/]+)(\/ws)?$/);
      if (m) {
        const code = normalizeRoomCode(decodeURIComponent(m[1]));
        if (!code) return json(request, env, { error: 'BAD_CODE' }, 400);
        const stub = env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(code));
        if (m[2]) {
          if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
            return json(request, env, { error: 'EXPECTED_WEBSOCKET' }, 426);
          }
          return stub.fetch(request);
        }
        if (request.method === 'GET') return json(request, env, await stub.getStatus());
      }

      return json(request, env, { error: 'NOT_FOUND' }, 404);
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'request.failed', path, error: String(err) }));
      return json(request, env, { error: 'SERVER_ERROR' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
