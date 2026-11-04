/**
 * Game portal integration (CrazyGames SDK v3). Only active in builds made with VITE_PORTAL=crazygames
 * (npm run build:crazygames); every other build gets the no-op version, so the live site and itch.io
 * never load ad scripts. Ads are client-only and never touch the simulation.
 */
interface CrazySdk {
  init(): Promise<void>;
  environment: 'local' | 'crazygames' | 'disabled';
  ad: { requestAd(type: 'midgame' | 'rewarded', cb: { adStarted?: () => void; adFinished?: () => void; adError?: (e: unknown) => void }): void };
  game: {
    isInstantMultiplayer?: boolean;
    inviteParams?: Record<string, string> | null;
    inviteLink?(params: Record<string, string>): string;
    updateRoom?(room: { roomId?: string; isJoinable?: boolean; inviteParams?: Record<string, string> }): void;
    leftRoom?(): void;
    addJoinRoomListener?(fn: (params: Record<string, string>) => void): void;
    gameplayStart(): void;
    gameplayStop(): void;
    loadingStart?(): void;
    loadingStop?(): void;
    settings?: { muteAudio?: boolean };
    addSettingsChangeListener?(fn: (s: { muteAudio?: boolean }) => void): void;
  };
}

const ENABLED = import.meta.env.VITE_PORTAL === 'crazygames';
/** Minimum gap between two midgame ads (ms). CrazyGames also enforces its own pacing. */
const MIDGAME_GAP = 3 * 60_000;

let sdk: CrazySdk | null = null;
let ready: Promise<void> | null = null;
let playing = false;
let lastMidgame = -Infinity;
let muteHook: ((muted: boolean) => void) | null = null;
let externalMute = false;

function load(): Promise<void> {
  if (!ENABLED) return Promise.resolve();
  if (ready) return ready;
  ready = new Promise<void>((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
    s.onload = async () => {
      try {
        const api = (window as unknown as { CrazyGames?: { SDK: CrazySdk } }).CrazyGames?.SDK;
        if (api) {
          await api.init();
          if (api.environment !== 'disabled') {
            sdk = api;
            externalMute = !!api.game.settings?.muteAudio;
            muteHook?.(externalMute);
            api.game.addSettingsChangeListener?.((st) => {
              externalMute = !!st.muteAudio;
              muteHook?.(externalMute);
            });
          }
        }
      } catch {
        /* SDK failed: the game runs without ads */
      }
      resolve();
    };
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
  return ready;
}

function request(type: 'midgame' | 'rewarded', onPause: (paused: boolean) => void): Promise<boolean> {
  return new Promise((resolve) => {
    if (!sdk) return resolve(false);
    let started = false;
    const end = (ok: boolean) => {
      if (started) onPause(false);
      resolve(ok);
    };
    sdk.ad.requestAd(type, {
      adStarted: () => {
        started = true;
        onPause(true);
      },
      adFinished: () => end(true),
      adError: () => end(false),
    });
  });
}

export const portal = {
  /** True only in a CrazyGames build. Use it to show ad-related buttons. */
  get enabled(): boolean {
    return ENABLED;
  },
  /** True once the SDK is live (a rewarded ad can be offered). */
  get adsReady(): boolean {
    return !!sdk;
  },
  init(): Promise<void> {
    return load();
  },
  /** The portal's own mute switch (call once from the audio manager). */
  onMute(fn: (muted: boolean) => void): void {
    muteHook = fn;
    if (externalMute) fn(true);
  },
  /** Tell the portal when real gameplay runs (used for its ad pacing and stats). */
  setPlaying(on: boolean): void {
    if (!sdk || on === playing) return;
    playing = on;
    if (on) sdk.game.gameplayStart();
    else sdk.game.gameplayStop();
  },
  /** Between-games ad, at a natural break only, and not more often than MIDGAME_GAP. */
  midgame(onPause: (paused: boolean) => void): Promise<boolean> {
    if (!sdk || performance.now() - lastMidgame < MIDGAME_GAP) return Promise.resolve(false);
    lastMidgame = performance.now();
    return request('midgame', onPause);
  },
  /** Room code from a CrazyGames invite (friend list, notification or invite link), if the game was opened by one. */
  inviteRoom(): string | null {
    return sdk?.game.inviteParams?.room ?? null;
  },
  /** CrazyGames wants this player sent straight into a new private room (multiplayer landing page). */
  get instantMultiplayer(): boolean {
    return !!sdk?.game.isInstantMultiplayer;
  },
  /** CrazyGames invite link for a room, or null outside CrazyGames. */
  inviteLink(room: string): string | null {
    try {
      return sdk?.game.inviteLink?.({ room }) ?? null;
    } catch {
      return null;
    }
  },
  /** Tell CrazyGames which room the player is in and whether friends can join it now. */
  updateRoom(room: string, joinable: boolean): void {
    sdk?.game.updateRoom?.({ roomId: room, isJoinable: joinable, inviteParams: { room } });
  },
  leftRoom(): void {
    sdk?.game.leftRoom?.();
  },
  /** A friend accepted an invite while the game is already open. */
  onJoinRoom(fn: (room: string) => void): void {
    sdk?.game.addJoinRoomListener?.((p) => p?.room && fn(p.room));
  },
  /** Opt-in ad for a reward. Resolves true only when the ad played to the end. */
  rewarded(onPause: (paused: boolean) => void): Promise<boolean> {
    return request('rewarded', onPause);
  },
};
