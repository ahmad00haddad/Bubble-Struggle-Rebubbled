import Phaser from 'phaser';
import { POWERUP_TYPES } from '@orb/shared';
import { TEXTURES, TEX_SCALE } from '../assets/textures';
import { VIEW } from '../config/clientConfig';
import { HOWTO_AR, POWERUP_AR } from '../config/howToText';
import { AR_FONT, arStyle, getLang } from '../config/lang';
import { KIND_COLOR, POWERUP_INFO } from '../config/powerups';
import { Button, ButtonGroup } from '../ui/Button';
import { langToggle } from '../ui/langToggle';
import { COLORS, TEXT } from '../ui/theme';
import { goTo, heading, menuBackdrop, panel } from '../ui/widgets';
import { SCENES } from './keys';

/** One page listing every crate: what it does, and whether it is a help, a gamble, a trap or for teams. */
export class PowerUpsScene extends Phaser.Scene {
  constructor() {
    super(SCENES.powerups);
  }

  create(): void {
    this.cameras.main.fadeIn(200, 7, 10, 31);
    menuBackdrop(this);
    panel(this, VIEW.width / 2, 322, 900, 540);
    const ar = getLang() === 'ar';
    if (ar) this.add.text(VIEW.width / 2, 72, HOWTO_AR.guideTitle, arStyle(34, COLORS.accentCss, true)).setOrigin(0.5).setShadow(3, 4, '#1a0f3d', 0, false, true);
    else heading(this, 'POWER-UPS & CRATES', 74);

    const legend = [
      ['good', 'HELPS'],
      ['risky', 'GAMBLE'],
      ['trap', 'TRAP'],
      ['team', 'TEAMS'],
    ] as const;
    legend.forEach(([k, label], i) => {
      if (ar) this.add.text(VIEW.width - 250 - i * 150, 98, `${HOWTO_AR.legend[k]} ●`, arStyle(15, KIND_COLOR[k], true)).setOrigin(1, 0);
      else this.add.text(250 + i * 150, 104, `● ${label}`, TEXT.display(8, KIND_COLOR[k]));
    });

    const cols = 3;
    const cw = 292;
    const x0 = 56;
    POWERUP_TYPES.forEach((t, i) => {
      const info = POWERUP_INFO[t];
      const x = x0 + (i % cols) * cw;
      const y = 134 + Math.floor(i / cols) * 56;
      if (ar) {
        // Mirrored: icon on the right, text to its left, right aligned.
        const rx = VIEW.width - x;
        this.add.image(rx - 14, y + 16, TEXTURES.powerUp(t)).setScale(1 / TEX_SCALE);
        this.add.text(rx - 36, y - 2, `${POWERUP_AR[t].name} (${info.name})`, arStyle(12, KIND_COLOR[info.kind], true)).setOrigin(1, 0);
        this.add.text(rx - 36, y + 14, POWERUP_AR[t].desc, { ...arStyle(12, COLORS.text), wordWrap: { width: cw - 44 } }).setOrigin(1, 0);
      } else {
        this.add.image(x + 14, y + 16, TEXTURES.powerUp(t)).setScale(1 / TEX_SCALE);
        this.add.text(x + 36, y + 2, info.name, TEXT.display(8, KIND_COLOR[info.kind]));
        this.add.text(x + 36, y + 16, info.desc, { ...TEXT.body(12, COLORS.text), wordWrap: { width: cw - 44 } });
      }
    });

    const back = new Button(this, VIEW.width / 2, 576, ar ? HOWTO_AR.back : 'BACK', () => goTo(this, SCENES.howTo), ar ? { width: 220, height: 40, fontSize: 18, fontFamily: AR_FONT } : { width: 220, height: 40 });
    const toggle = langToggle(this);
    new ButtonGroup(this, [back, toggle], { onBack: () => goTo(this, SCENES.howTo) }).focus(0);
  }
}
