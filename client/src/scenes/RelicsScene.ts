import Phaser from 'phaser';
import { RELIC_KINDS } from '@orb/shared';
import { TEXTURES, TEX_SCALE } from '../assets/textures';
import { VIEW } from '../config/clientConfig';
import { HOWTO_AR, RELIC_AR } from '../config/howToText';
import { AR_FONT, arStyle, getLang } from '../config/lang';
import { RELIC_INFO } from '../config/relics';
import { Button, ButtonGroup } from '../ui/Button';
import { langToggle } from '../ui/langToggle';
import { COLORS, TEXT } from '../ui/theme';
import { goTo, heading, menuBackdrop, panel } from '../ui/widgets';
import { SCENES } from './keys';

/** The relic list: permanent traits a Lancer finds during a run. */
export class RelicsScene extends Phaser.Scene {
  constructor() {
    super(SCENES.relics);
  }

  create(): void {
    this.cameras.main.fadeIn(200, 7, 10, 31);
    menuBackdrop(this);
    panel(this, VIEW.width / 2, 322, 900, 540);
    const ar = getLang() === 'ar';
    if (ar) this.add.text(VIEW.width / 2, 72, HOWTO_AR.relicsTitle, arStyle(32, COLORS.accentCss, true)).setOrigin(0.5).setShadow(3, 4, '#1a0f3d', 0, false, true);
    else heading(this, 'RELICS: PERMANENT TRAITS', 74);
    const hint = 'Unknown Relic crates drop when the team works together. You keep a relic for the whole run.';
    if (ar) this.add.text(VIEW.width / 2, 106, HOWTO_AR.relicsHint, arStyle(14, COLORS.textDim)).setOrigin(0.5, 0);
    else this.add.text(VIEW.width / 2, 106, hint, TEXT.body(14, COLORS.textDim)).setOrigin(0.5, 0);

    const cw = 436;
    RELIC_KINDS.forEach((k, i) => {
      const info = RELIC_INFO[k];
      const x = 50 + (i % 2) * (cw + 8);
      const y = 138 + Math.floor(i / 2) * 68;
      const rx = ar ? VIEW.width - x : x;
      this.add.image(ar ? rx - 22 : rx + 22, y + 24, TEXTURES.powerUp('relic')).setScale(1.2 / TEX_SCALE);
      this.add.text(ar ? rx - 22 : rx + 22, y + 24, info.code, TEXT.display(8, '#ffffff')).setOrigin(0.5).setAlpha(0);
      if (ar) {
        this.add.text(rx - 52, y + 2, RELIC_AR[k].name, arStyle(15, '#ffd166', true)).setOrigin(1, 0);
        this.add.text(rx - 52, y + 24, RELIC_AR[k].desc, { ...arStyle(13, COLORS.text), wordWrap: { width: cw - 64 } }).setOrigin(1, 0);
      } else {
        this.add.text(rx + 52, y + 2, `${info.code}  ${info.name}`, TEXT.display(9, '#ffd166'));
        this.add.text(rx + 52, y + 22, info.desc, { ...TEXT.body(13, COLORS.text), wordWrap: { width: cw - 64 } });
      }
    });

    const back = new Button(this, VIEW.width / 2, 576, ar ? HOWTO_AR.back : 'BACK', () => goTo(this, SCENES.howTo), ar ? { width: 220, height: 40, fontSize: 18, fontFamily: AR_FONT } : { width: 220, height: 40 });
    const toggle = langToggle(this);
    new ButtonGroup(this, [back, toggle], { onBack: () => goTo(this, SCENES.howTo) }).focus(0);
  }
}
