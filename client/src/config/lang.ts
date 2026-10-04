import type Phaser from 'phaser';
import { getSettings, updateSettings } from './settings';

/**
 * Language of the "How to play" pages only (the rest of the game stays English).
 * The choice is remembered on this device like the other cosmetic settings.
 */
export type Lang = 'en' | 'ar';

export function getLang(): Lang {
  return getSettings().lang === 'ar' ? 'ar' : 'en';
}

export function setLang(lang: Lang): void {
  updateSettings({ lang });
}

/** Press Start 2P and Chakra Petch have no Arabic letters, so Arabic text uses its own stack. */
export const AR_FONT = 'Cairo, Tahoma, "Segoe UI", Arial, sans-serif';

type TextStyle = Phaser.Types.GameObjects.Text.TextStyle;

/** Right-to-left text style: base direction rtl, right aligned (pair with setOrigin(1, 0)). */
export function arStyle(size: number, color: string, bold = false): TextStyle {
  return { fontFamily: AR_FONT, fontSize: `${size}px`, color, fontStyle: bold ? '700' : '500', rtl: true, align: 'right' };
}

/**
 * Canvas text only uses a web font that is already loaded, and a page does not fetch one
 * until something on the page uses it. Ask for it explicitly (with a short timeout, so a
 * blocked font CDN just falls back to the system Arabic font).
 */
export async function loadArabicFont(): Promise<void> {
  try {
    await Promise.race([
      Promise.all([document.fonts.load('500 16px Cairo', 'مرحبا'), document.fonts.load('700 16px Cairo', 'مرحبا')]),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch {
    /* no font loading API: the fallback stack is used */
  }
}
