import type Phaser from 'phaser';
import { AR_FONT, getLang, loadArabicFont, setLang } from '../config/lang';
import { HOWTO_AR } from '../config/howToText';
import { VIEW } from '../config/clientConfig';
import { Button } from './Button';

/** Corner button on the how-to pages: switches this page between English and Arabic and redraws it. */
export function langToggle(scene: Phaser.Scene): Button {
  const toArabic = getLang() === 'en';
  return new Button(
    scene,
    VIEW.width - 110,
    30,
    toArabic ? HOWTO_AR.toggleToArabic : HOWTO_AR.toggleToEnglish,
    () => {
      void (async () => {
        if (toArabic) await loadArabicFont();
        setLang(toArabic ? 'ar' : 'en');
        scene.scene.restart();
      })();
    },
    toArabic ? { width: 170, height: 40, fontSize: 18, fontFamily: AR_FONT } : { width: 170, height: 40, fontSize: 11 },
  );
}
