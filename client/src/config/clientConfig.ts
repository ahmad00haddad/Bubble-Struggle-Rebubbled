import { WORLD } from '@orb/shared';

/** Canvas layout. The 960x480 simulation arena sits under a 64 px HUD. */
export const VIEW = {
  width: WORLD.width,
  height: 600,
  hudHeight: 64,
  arenaY: 64,
  arenaBottom: 64 + WORLD.height,
} as const;

export const FONTS = {
  display: '"Press Start 2P", monospace',
  body: '"Chakra Petch", "Segoe UI", sans-serif',
} as const;

export const PLAYER_COLORS = [0xff6b5a, 0x47e5bc] as const;
export const PLAYER_CSS = ['#ff6b5a', '#47e5bc'] as const;

let serverOverride: string | null = null;

export function setServerUrl(url: string | null | undefined): void {
  serverOverride = url ? url.replace(/\/+$/, '') : null;
}

/**
 * Where the Worker lives. Priority: mountGame({serverUrl}) → ?server= query →
 * VITE_SERVER_URL at build time → same origin (dev proxy / Worker-hosted build).
 */
export function serverUrl(): string {
  if (serverOverride) return serverOverride;
  const q = new URLSearchParams(window.location.search).get('server');
  if (q) return q.replace(/\/+$/, '');
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (env) return env.replace(/\/+$/, '');
  return window.location.origin;
}

export function wsUrl(path: string): string {
  return serverUrl().replace(/^http/, 'ws') + path;
}
