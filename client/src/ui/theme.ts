import type Phaser from 'phaser';
import { FONTS } from '../config/clientConfig';

export const COLORS = {
  ink: 0x070a1f,
  panel: 0x121a44,
  panelEdge: 0x2e3b8c,
  text: '#eef3ff',
  textDim: '#9aa6d6',
  accent: 0xffd166,
  accentCss: '#ffd166',
  good: '#5cf2a0',
  bad: '#ff5d73',
  button: 0x24306f,
  buttonHover: 0x34449a,
  buttonEdge: 0x5b6fd6,
  primary: 0xff7a59,
  primaryHover: 0xff916f,
} as const;

type TextStyle = Phaser.Types.GameObjects.Text.TextStyle;

export const TEXT = {
  title: (size = 44): TextStyle => ({ fontFamily: FONTS.display, fontSize: `${size}px`, color: COLORS.text }),
  display: (size = 16, color: string = COLORS.text): TextStyle => ({ fontFamily: FONTS.display, fontSize: `${size}px`, color }),
  body: (size = 18, color: string = COLORS.text): TextStyle => ({ fontFamily: FONTS.body, fontSize: `${size}px`, color, fontStyle: '500' }),
} as const;
