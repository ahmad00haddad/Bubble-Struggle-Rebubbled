import Phaser from 'phaser';
import { setServerUrl, VIEW } from './config/clientConfig';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { HowToScene } from './scenes/HowToScene';
import { LobbyScene } from './scenes/LobbyScene';
import { MenuScene } from './scenes/MenuScene';
import { OnlineScene } from './scenes/OnlineScene';
import { LevelSelectScene } from './scenes/LevelSelectScene';
import { PowerUpsScene } from './scenes/PowerUpsScene';
import { SettingsScene } from './scenes/SettingsScene';
import { REGISTRY } from './scenes/keys';
import type { NetSession } from './networking/NetSession';

export interface MountOptions {
  /** Base URL of the Cloudflare Worker, e.g. https://orb-lancers.you.workers.dev */
  serverUrl?: string;
}

export interface GameHandle {
  destroy(): void;
  game: Phaser.Game;
}

/**
 * Mount the game into any element. This is the only API a host page
 * (Lovable, plain HTML, React, …) needs:
 *
 *   const handle = mountGame(document.getElementById('game')!, { serverUrl });
 *   // later: handle.destroy();
 */
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Chakra+Petch:wght@500;700&display=swap';

/** Host pages (Lovable etc.) don't include our <link>; add the fonts once. */
function ensureFonts(): void {
  if (document.querySelector(`link[href="${FONT_HREF}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = FONT_HREF;
  document.head.appendChild(link);
}

export function mountGame(parent: HTMLElement, opts: MountOptions = {}): GameHandle {
  setServerUrl(opts.serverUrl);
  ensureFonts();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: VIEW.width,
    height: VIEW.height,
    backgroundColor: '#070a1f',
    pixelArt: false,
    antialias: true,
    render: { powerPreference: 'high-performance' },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    input: { activePointers: 3 },
    // ?timerLoop=1 drives the loop with setTimeout instead of requestAnimationFrame
    // (useful for automated tests in background/hidden browser tabs).
    fps: { target: 60, forceSetTimeOut: new URLSearchParams(window.location.search).has('timerLoop') },
    scene: [BootScene, MenuScene, HowToScene, PowerUpsScene, SettingsScene, OnlineScene, LobbyScene, LevelSelectScene, GameScene],
  });
  return {
    game,
    destroy() {
      const s = game.registry.get(REGISTRY.session) as NetSession | undefined;
      s?.leave();
      game.destroy(true);
    },
  };
}
