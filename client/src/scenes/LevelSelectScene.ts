import Phaser from 'phaser';
import { LEVELS } from '@orb/shared';
import { VIEW } from '../config/clientConfig';
import type { NetSession } from '../networking/NetSession';
import { getSettings } from '../config/settings';
import { Button, ButtonGroup } from '../ui/Button';
import { COLORS, TEXT } from '../ui/theme';
import { goTo, heading, menuBackdrop, panel } from '../ui/widgets';
import { REGISTRY, SCENES } from './keys';

/**
 * Pick one level and play only it. From the main menu it starts a solo practice run; from an online
 * lobby (`forRoom`) the host picks the level the whole room will play.
 */
export class LevelSelectScene extends Phaser.Scene {
  private forRoom = false;

  constructor() {
    super(SCENES.levelSelect);
  }

  init(data: { forRoom?: boolean }): void {
    this.forRoom = !!data?.forRoom;
  }

  create(): void {
    const session = this.forRoom ? (this.registry.get(REGISTRY.session) as NetSession | undefined) : undefined;
    if (this.forRoom && !session) {
      this.scene.start(SCENES.menu);
      return;
    }
    this.cameras.main.fadeIn(200, 7, 10, 31);
    menuBackdrop(this);
    panel(this, VIEW.width / 2, 312, 920, 500);
    heading(this, this.forRoom ? 'ROOM: PICK A LEVEL' : 'PRACTICE: PICK A LEVEL', 60);
    this.add.text(VIEW.width / 2, 92, this.forRoom ? 'The whole room plays only this level. Co-op targets need 2+ players.' : 'Plays that one level alone. To try co-op targets, pick a level in an online room.', TEXT.body(14, COLORS.textDim)).setOrigin(0.5);

    const cols = 5;
    const w = 168;
    const gap = 8;
    const x0 = VIEW.width / 2 - ((cols - 1) * (w + gap)) / 2;
    const buttons = LEVELS.map((l, i) => {
      const x = x0 + (i % cols) * (w + gap);
      const y = 134 + Math.floor(i / cols) * 54;
      return new Button(this, x, y, `${i + 1} ${l.name.toUpperCase()}`, () => {
        if (session) {
          session.setPick(i);
          goTo(this, SCENES.lobby);
        } else goTo(this, SCENES.game, { mode: 'solo', nickname: getSettings().nickname || 'Lancer', startLevel: i, practice: true });
      }, { width: w, height: 44, fontSize: 8 });
    });
    const leaveTo = this.forRoom ? SCENES.lobby : SCENES.menu;
    const all = session ? new Button(this, VIEW.width / 2, 512, 'ALL LEVELS, IN ORDER', () => {
      session.setPick(-1);
      goTo(this, SCENES.lobby);
    }, { width: 320, height: 40, fontSize: 10, primary: true }) : null;
    const back = new Button(this, VIEW.width / 2, 570, 'BACK', () => goTo(this, leaveTo), { width: 220, height: 40 });
    new ButtonGroup(this, [...buttons, ...(all ? [all] : []), back], { onBack: () => goTo(this, leaveTo) }).focus(0);
  }
}
