import Phaser from 'phaser';
import { generateTextures } from '../assets/textures';
import { VIEW } from '../config/clientConfig';
import { TEXT } from '../ui/theme';
import { SCENES } from './keys';
import { portal } from '../platform/portal';

export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENES.boot);
  }

  preload(): void {
    // To replace generated art with files, load them here using the keys in
    // assets/textures.ts (e.g. this.load.image('lancer-0-0', 'art/p1.png')).
  }

  async create(): Promise<void> {
    const t = this.add.text(VIEW.width / 2, VIEW.height / 2, 'LOADING…', TEXT.body(20)).setOrigin(0.5);
    try {
      // Wait (briefly) for the web fonts so Phaser text renders with them.
      await Promise.race([
        Promise.all([document.fonts.load('16px "Press Start 2P"'), document.fonts.load('500 16px "Chakra Petch"')]),
        new Promise((r) => setTimeout(r, 2500)),
      ]);
    } catch {
      /* fall back to monospace */
    }
    generateTextures(this);
    t.destroy();
    // CrazyGames: a friend's invite or the multiplayer landing page sends the player straight into a room.
    await Promise.race([portal.init(), new Promise((r) => setTimeout(r, 4000))]);
    portal.onJoinRoom((code) => {
      const u = new URL(window.location.href);
      u.searchParams.set('room', code);
      window.location.href = u.toString();
    });
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room') ?? portal.inviteRoom();
    if (room) this.scene.start(SCENES.online, { joinCode: room, auto: portal.inviteRoom() === room ? 'join' : undefined });
    else if (portal.instantMultiplayer) this.scene.start(SCENES.online, { auto: 'create' });
    else this.scene.start(SCENES.menu);
  }
}
