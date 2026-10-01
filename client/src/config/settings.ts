/**
 * Per-device preferences. localStorage holds ONLY these cosmetic settings and
 * the last nickname — never game or multiplayer state.
 */
export interface Settings {
  volume: number;
  muted: boolean;
  screenShake: boolean;
  showNetStats: boolean;
  nickname: string;
}

const KEY = 'orb-lancers.settings';
const DEFAULTS: Settings = { volume: 0.7, muted: false, screenShake: true, showNetStats: true, nickname: '' };

let cache: Settings | null = null;

export function getSettings(): Settings {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache!;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  cache = { ...getSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable (private mode) — keep in memory */
  }
  return cache;
}
