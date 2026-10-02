import Phaser from 'phaser';
import { BUBBLE_SIZES, CONTROLS, POWERUP_TYPES, describeKeys, type PowerUpType } from '@orb/shared';
import { TEXTURES, TEX_SCALE } from '../assets/textures';
import { VIEW } from '../config/clientConfig';
import { Button, ButtonGroup } from '../ui/Button';
import { COLORS, TEXT } from '../ui/theme';
import { goTo, heading, menuBackdrop, panel } from '../ui/widgets';
import { SCENES } from './keys';

const PU_TEXT: Record<PowerUpType, string> = {
  shield: 'Shield — absorbs one hit',
  extraLife: 'Extra Life — +1 life',
  extraTime: 'Extra Time — +20 s on the clock',
  doubleHarpoon: 'Double Tether — two shots at once',
  speedBoost: 'Speed Boost — run faster',
  anchor: 'Anchor Tether — next shot sticks to the ceiling for 4 s',
  chaos: 'Chaos — a short prank on a teammate (multiplayer only)',
};

export class HowToScene extends Phaser.Scene {
  constructor() {
    super(SCENES.howTo);
  }

  create(): void {
    this.cameras.main.fadeIn(200, 7, 10, 31);
    menuBackdrop(this);
    panel(this, VIEW.width / 2, 300, 860, 470);
    heading(this, 'HOW TO PLAY', 96);

    const left = 110;
    const lines = [
      'Pop every orb before the clock runs out.',
      'Your tether shoots straight up — anything it touches gets hit.',
      `Big orbs split in two: huge → large → medium → small → gone.`,
      `Small orbs are worth the most (${BUBBLE_SIZES[0].points} pts). Don't let any orb touch you!`,
      'Online: play co-op with a friend on another device using a room code.',
    ];
    lines.forEach((l, i) => this.add.text(left, 132 + i * 28, '• ' + l, TEXT.body(18)));

    this.add.text(left, 286, 'CONTROLS', TEXT.display(14, COLORS.accentCss));
    const c1 = CONTROLS.player1;
    const c2 = CONTROLS.player2;
    this.add.text(left, 312, `Move: ${describeKeys([...c1.left, ...c1.right])}  or  ${describeKeys([...c2.left, ...c2.right])}`, TEXT.body(17));
    this.add.text(left, 338, `Shoot: ${describeKeys(c1.shoot)}  or  ${describeKeys(c2.shoot)}      Pause: ${describeKeys(CONTROLS.pause)}`, TEXT.body(17));

    this.add.text(540, 286, 'POWER-UPS', TEXT.display(14, COLORS.accentCss));
    POWERUP_TYPES.forEach((t, i) => {
      this.add.image(556, 320 + i * 30, TEXTURES.powerUp(t)).setScale(1 / TEX_SCALE);
      this.add.text(580, 310 + i * 30, PU_TEXT[t], TEXT.body(15));
    });

    this.add.text(left, 372, 'SPECIAL ORBS', TEXT.display(14, COLORS.accentCss));
    const specials = [
      'Steel ring: needs two hits. Ghost: wait until it is solid.',
      'Gold link: pop its twin before the fuse runs out.',
      'Dots: hit it with different Lancers. Numbers: hit in order.',
      'Rare events fall from the sky — watch the warning!',
    ];
    specials.forEach((l, i) => this.add.text(left, 398 + i * 24, '• ' + l, TEXT.body(15)));

    const back = new Button(this, VIEW.width / 2, 556, 'BACK', () => goTo(this, SCENES.menu), { width: 220 });
    new ButtonGroup(this, [back], { onBack: () => goTo(this, SCENES.menu) }).focus(0);
  }
}
