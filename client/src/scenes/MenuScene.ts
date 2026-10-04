import Phaser from 'phaser';
import { GAME_VERSION, utcDay } from '@orb/shared';
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
    this.add.text(VIEW.width - 14, 14, `v${GAME_VERSION}`, TEXT.display(10, COLORS.accentCss)).setOrigin(1, 0).setAlpha(0.9);
    this.add.text(VIEW.width / 2, 178, 'A CO-OP ORB-POPPING ARCADE ADVENTURE', TEXT.body(18, COLORS.textDim)).setOrigin(0.5);

    const cx = VIEW.width / 2;
    const items: [string, () => void, boolean?][] = [
      ['PLAY SOLO', () => goTo(this, SCENES.game, { mode: 'solo', nickname: getSettings().nickname || 'Lancer', startLevel: Math.max(0, Number(new URLSearchParams(location.search).get('level') ?? 1) - 1) || 0 }), true],
      ['PLAY ONLINE', () => goTo(this, SCENES.online), true],
      ['DAILY LEVEL', () => goTo(this, SCENES.game, { mode: 'solo', nickname: getSettings().nickname || 'Lancer', daily: utcDay() })],
      ['PRACTICE', () => goTo(this, SCENES.levelSelect)],
      ['HOW TO PLAY', () => goTo(this, SCENES.howTo)],
      ['SETTINGS', () => goTo(this, SCENES.settings)],
    ];
    const buttons = items.map(([label, fn, primary], i) => new Button(this, cx, 238 + i * 56, label, fn, { primary, height: 48 }));
    new ButtonGroup(this, buttons).focus(0);

    this.add.text(cx, VIEW.height - 22, 'ARROWS + ENTER TO NAVIGATE  ·  ORIGINAL GAME — ALL ART & SOUND GENERATED', TEXT.body(13, COLORS.textDim)).setOrigin(0.5).setAlpha(0.7);
    this.input.once('pointerdown', () => audio.unlock());
    this.input.keyboard?.once('keydown', () => audio.unlock());
  }
}
