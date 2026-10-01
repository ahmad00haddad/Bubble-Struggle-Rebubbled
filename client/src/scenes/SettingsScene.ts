import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { VIEW } from '../config/clientConfig';
import { getSettings, updateSettings } from '../config/settings';
import { Button, ButtonGroup } from '../ui/Button';
import { goTo, heading, menuBackdrop, panel } from '../ui/widgets';
import { SCENES } from './keys';

export class SettingsScene extends Phaser.Scene {
  constructor() {
    super(SCENES.settings);
  }

  create(): void {
    this.cameras.main.fadeIn(200, 7, 10, 31);
    menuBackdrop(this);
    panel(this, VIEW.width / 2, 300, 560, 440);
    heading(this, 'SETTINGS', 110);

    const cx = VIEW.width / 2;
    const s = () => getSettings();
    const volLabel = () => `VOLUME  ${s().muted ? 'MUTED' : Math.round(s().volume * 100) + '%'}`;
    const vol = new Button(this, cx, 190, volLabel(), () => {
      const steps = [0, 0.25, 0.5, 0.7, 1];
      const cur = s().muted ? 0 : s().volume;
      const next = steps[(steps.findIndex((v) => v >= cur - 0.01) + 1) % steps.length];
      updateSettings({ volume: next, muted: next === 0 });
      audio.applyVolume();
      vol.setText(volLabel());
    }, { width: 420 });
    const shake = new Button(this, cx, 258, `SCREEN SHAKE  ${s().screenShake ? 'ON' : 'OFF'}`, () => {
      updateSettings({ screenShake: !s().screenShake });
      shake.setText(`SCREEN SHAKE  ${s().screenShake ? 'ON' : 'OFF'}`);
      if (s().screenShake) this.cameras.main.shake(180, 0.006);
    }, { width: 420 });
    const net = new Button(this, cx, 326, `NETWORK STATS  ${s().showNetStats ? 'ON' : 'OFF'}`, () => {
      updateSettings({ showNetStats: !s().showNetStats });
      net.setText(`NETWORK STATS  ${s().showNetStats ? 'ON' : 'OFF'}`);
    }, { width: 420 });
    const full = new Button(this, cx, 394, 'TOGGLE FULLSCREEN', () => {
      if (this.scale.isFullscreen) this.scale.stopFullscreen();
      else this.scale.startFullscreen();
    }, { width: 420 });
    const back = new Button(this, cx, 476, 'BACK', () => goTo(this, SCENES.menu), { width: 220 });
    new ButtonGroup(this, [vol, shake, net, full, back], { onBack: () => goTo(this, SCENES.menu) }).focus(0);
  }
}
