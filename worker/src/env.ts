import type { GameRoom } from './GameRoom';

export interface Env {
  GAME_ROOMS: DurableObjectNamespace<GameRoom>;
  /** Static client build (optional; present when wrangler `assets` is configured). */
  ASSETS?: Fetcher;
  /** Comma-separated list of origins allowed to use the API, or "*". */
  ALLOWED_ORIGINS?: string;
  ENVIRONMENT?: string;
  /** "debug" enables verbose room logs. */
  LOG_LEVEL?: string;
}
