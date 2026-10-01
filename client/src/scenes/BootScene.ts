import Phaser from 'phaser';
import { generateTextures } from '../assets/textures';
import { VIEW } from '../config/clientConfig';
import { TEXT } from '../ui/theme';
import { SCENES } from './keys';

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
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) this.scene.start(SCENES.online, { joinCode: room });
    else this.scene.start(SCENES.menu);
  }
}
