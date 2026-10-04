import Phaser from 'phaser';
import { BUBBLE_SIZES, CONTROLS, POWERUP_TYPES, describeKeys } from '@orb/shared';
import { TEXTURES, TEX_SCALE } from '../assets/textures';
import { VIEW } from '../config/clientConfig';
import { HOWTO_AR } from '../config/howToText';
import { AR_FONT, arStyle, getLang } from '../config/lang';
import { Button, ButtonGroup } from '../ui/Button';
import { langToggle } from '../ui/langToggle';
import { COLORS, TEXT } from '../ui/theme';
import { goTo, heading, menuBackdrop, panel } from '../ui/widgets';
import { SCENES } from './keys';

export class HowToScene extends Phaser.Scene {
  constructor() {
    super(SCENES.howTo);
  }

  create(): void {
    this.cameras.main.fadeIn(200, 7, 10, 31);
    menuBackdrop(this);
    panel(this, VIEW.width / 2, 302, 860, 492);
    const ar = getLang() === 'ar';

    // Arabic mirrors the layout: x is the left edge in English and becomes the right edge in Arabic.
    const X = (x: number) => (ar ? VIEW.width - x : x);
    const put = (x: number, y: number, s: string, size: number, color: string, kind: 'body' | 'display' = 'body', wrap?: number) => {
      const style = ar ? arStyle(kind === 'display' ? Math.round(size * 1.5) : size + 1, color, kind === 'display') : kind === 'display' ? TEXT.display(size, color) : TEXT.body(size, color);
      return this.add.text(X(x), y, s, wrap ? { ...style, wordWrap: { width: wrap } } : style).setOrigin(ar ? 1 : 0, 0);
    };

    if (ar) this.add.text(VIEW.width / 2, 82, HOWTO_AR.title, arStyle(34, COLORS.accentCss, true)).setOrigin(0.5).setShadow(3, 4, '#1a0f3d', 0, false, true);
    else heading(this, 'HOW TO PLAY', 84);

    const left = 110;
    const lines = ar
      ? HOWTO_AR.lines(BUBBLE_SIZES[0].points)
      : [
          'Pop every orb before the clock runs out.',
          'Your tether shoots straight up — anything it touches gets hit.',
          `Big orbs split in two: huge → large → medium → small → gone.`,
          `Small orbs are worth the most (${BUBBLE_SIZES[0].points} pts). Don't let any orb touch you!`,
          'Online: play co-op with a friend on another device using a room code.',
        ];
    lines.forEach((l, i) => put(left, 112 + i * 24, '• ' + l, 16, COLORS.text));

    const c1 = CONTROLS.player1;
    const c2 = CONTROLS.player2;
    const move1 = describeKeys([...c1.left, ...c1.right]);
    const move2 = describeKeys([...c2.left, ...c2.right]);
    put(left, 240, ar ? HOWTO_AR.controls : 'CONTROLS', 14, COLORS.accentCss, 'display');
    if (ar) {
      put(left, 266, `${HOWTO_AR.move}: ${move1}  ${HOWTO_AR.or}  ${move2}`, 17, COLORS.text);
      put(left, 290, `${HOWTO_AR.shoot}: ${describeKeys(c1.shoot)}  ${HOWTO_AR.or}  ${describeKeys(c2.shoot)}`, 17, COLORS.text);
      put(left, 314, `${HOWTO_AR.pause}: ${describeKeys(CONTROLS.pause)}`, 17, COLORS.text);
    } else {
      put(left, 266, `Move: ${move1}  or  ${move2}`, 17, COLORS.text);
      put(left, 292, `Shoot: ${describeKeys(c1.shoot)}  or  ${describeKeys(c2.shoot)}      Pause: ${describeKeys(CONTROLS.pause)}`, 17, COLORS.text);
    }

    put(540, 240, ar ? HOWTO_AR.powerups : 'POWER-UPS', 14, COLORS.accentCss, 'display');
    // A strip of icons; the full guide has the names and what each one does.
    POWERUP_TYPES.forEach((t, i) => this.add.image(X(556 + (i % 11) * 32), 282 + Math.floor(i / 11) * 34, TEXTURES.powerUp(t)).setScale(1 / TEX_SCALE));
    put(540, 334, ar ? HOWTO_AR.crates : 'Crates fall now and then. Some help, some are\ngambles, a few are traps — you choose.', 14, COLORS.text, 'body', 350);
    const guideLabel = ar ? HOWTO_AR.guide : 'POWERS';
    const guide = new Button(this, X(630), 394, guideLabel, () => goTo(this, SCENES.powerups), ar ? { width: 170, height: 36, fontSize: 16, fontFamily: AR_FONT } : { width: 170, height: 36, fontSize: 9 });
    const relics = new Button(this, X(815), 394, ar ? HOWTO_AR.relics : 'RELICS', () => goTo(this, SCENES.relics), ar ? { width: 170, height: 36, fontSize: 16, fontFamily: AR_FONT } : { width: 170, height: 36, fontSize: 9 });

    put(left, 372, ar ? HOWTO_AR.specials : 'SPECIAL ORBS', 14, COLORS.accentCss, 'display');
    const specials = ar
      ? HOWTO_AR.specialLines
      : [
          'Steel ring: needs two hits. Ghost: wait until it is solid.',
          'Gold link: pop its twin before the fuse runs out.',
          'Dots: hit it with different Lancers. Numbers: hit in order.',
          'Green ring (co-op): different Lancers must hit it within 2 s. The same one twice is not enough.',
          'Orange line: pop one orb, then a TEAMMATE must pop the other within 4 s.',
          'Gold ring with a timer: pop it before the timer ends for +6 s on the clock.',
          'Rare events fall from the sky — watch the warning!',
        ];
    specials.forEach((l, i) => put(left, 413 + i * 18, '• ' + l, 13, COLORS.text));

    const back = new Button(this, VIEW.width / 2, 576, ar ? HOWTO_AR.back : 'BACK', () => goTo(this, SCENES.menu), ar ? { width: 220, height: 40, fontSize: 18, fontFamily: AR_FONT } : { width: 220, height: 40 });
    const toggle = langToggle(this);
    new ButtonGroup(this, [back, guide, relics, toggle], { onBack: () => goTo(this, SCENES.menu) }).focus(0);
  }
}
