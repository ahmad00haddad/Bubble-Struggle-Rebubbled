import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { VIEW } from '../config/clientConfig';
import { getSettings } from '../config/settings';
import { Button, ButtonGroup } from '../ui/Button';
import { COLORS, TEXT } from '../ui/theme';
import { goTo, menuBackdrop, titleText } from '../ui/widgets';
import { SCENES } from './keys';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super(SCENES.menu);
  }

  create(): void {
    this.cameras.main.fadeIn(220, 7, 10, 31);
    menuBackdrop(this);
    titleText(this, 120, 52);
    this.add.text(VIEW.width / 2, 178, 'A CO-OP ORB-POPPING ARCADE ADVENTURE', TEXT.body(18, COLORS.textDim)).setOrigin(0.5);

    const cx = VIEW.width / 2;
    const items: [string, () => void, boolean?][] = [
      ['PLAY SOLO', () => goTo(this, SCENES.game, { mode: 'solo', nickname: getSettings().nickname || 'Lancer' }), true],
      ['PLAY ONLINE', () => goTo(this, SCENES.online), true],
      ['HOW TO PLAY', () => goTo(this, SCENES.howTo)],
      ['SETTINGS', () => goTo(this, SCENES.settings)],
    ];
    const buttons = items.map(([label, fn, primary], i) => new Button(this, cx, 262 + i * 68, label, fn, { primary }));
    new ButtonGroup(this, buttons).focus(0);

    this.add.text(cx, VIEW.height - 22, 'ARROWS + ENTER TO NAVIGATE  ·  ORIGINAL GAME — ALL ART & SOUND GENERATED', TEXT.body(13, COLORS.textDim)).setOrigin(0.5).setAlpha(0.7);
    this.input.once('pointerdown', () => audio.unlock());
    this.input.keyboard?.once('keydown', () => audio.unlock());
  }
}
