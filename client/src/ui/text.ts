import type Phaser from 'phaser';

/**
 * Phaser re-draws a Text object's canvas and re-uploads its texture on EVERY style call
 * (setColor, setAlign, setShadow...), even with the same value. Calling those once per frame
 * per label is a big hidden cost that grows with the number of Lancers. These helpers only
 * touch the text when something actually changed.
 */
export function setLabel(t: Phaser.GameObjects.Text, text: string, color?: string): void {
  if (t.text !== text) t.setText(text);
  if (color !== undefined && t.style.color !== color) t.setColor(color);
}
