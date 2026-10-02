import Phaser from 'phaser';
import { POWERUP_TYPES } from '@orb/shared';
import { TEXTURES, TEX_SCALE } from '../assets/textures';
import { VIEW } from '../config/clientConfig';
import { KIND_COLOR, POWERUP_INFO } from '../config/powerups';
import { Button, ButtonGroup } from '../ui/Button';
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
    heading(this, 'POWER-UPS & CRATES', 74);
    const legend = [
      ['good', 'HELPS'],
      ['risky', 'GAMBLE'],
      ['trap', 'TRAP'],
      ['team', 'TEAMS'],
    ] as const;
    legend.forEach(([k, label], i) => this.add.text(250 + i * 150, 104, `● ${label}`, TEXT.display(8, KIND_COLOR[k])));

    const cols = 3;
    const cw = 292;
    const x0 = 56;
    POWERUP_TYPES.forEach((t, i) => {
      const info = POWERUP_INFO[t];
      const x = x0 + (i % cols) * cw;
      const y = 134 + Math.floor(i / cols) * 56;
      this.add.image(x + 14, y + 16, TEXTURES.powerUp(t)).setScale(1 / TEX_SCALE);
      this.add.text(x + 36, y + 2, info.name, TEXT.display(8, KIND_COLOR[info.kind]));
      this.add.text(x + 36, y + 16, info.desc, { ...TEXT.body(12, COLORS.text), wordWrap: { width: cw - 44 } });
    });

    const back = new Button(this, VIEW.width / 2, 562, 'BACK', () => goTo(this, SCENES.howTo), { width: 220 });
    new ButtonGroup(this, [back], { onBack: () => goTo(this, SCENES.howTo) }).focus(0);
  }
}
