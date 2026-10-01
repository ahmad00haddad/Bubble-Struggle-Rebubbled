import type { LevelConfig, LevelPowerUps } from '../types/level';

/**
 * All levels are pure data. To add a level, append an object here; no engine
 * code changes are needed. Arena is 960x480, floor at y = 480.
 * Bubble sizes: 0 small, 1 medium, 2 large, 3 huge.
 */

const basicDrops = (dropChance: number, extra: Partial<LevelPowerUps> = {}): LevelPowerUps => ({
  dropChance,
  pool: { shield: 3, extraTime: 2, doubleHarpoon: 3, speedBoost: 3, extraLife: 1 },
  placed: [],
  ...extra,
});

export const LEVELS: LevelConfig[] = [
  {
    id: 'dawn-drift',
    name: 'Dawn Drift',
    timeLimit: 60,
    playerSpawnPoints: [380, 580],
    platforms: [],
    bubbles: [{ size: 2, x: 240, y: 170 }],
    powerUps: basicDrops(0.2, { pool: { shield: 2, doubleHarpoon: 3, speedBoost: 2 } }),
    difficulty: { rating: 1, bubbleSpeed: 0.85 },
    theme: { sky: [0x1a2350, 0x3b5aa0], accent: 0x5ee6c8, orb: 0xff7a59 },
  },
  {
    id: 'twin-tides',
    name: 'Twin Tides',
    timeLimit: 75,
    playerSpawnPoints: [400, 560],
    platforms: [],
    bubbles: [
      { size: 2, x: 190, y: 150 },
      { size: 2, x: 770, y: 150, velocityX: -108 },
    ],
    powerUps: basicDrops(0.15),
    difficulty: { rating: 2, bubbleSpeed: 0.9 },
    theme: { sky: [0x14284a, 0x2c6e8f], accent: 0x8cf0ff, orb: 0x7d7bff },
  },
  {
    id: 'ledge-garden',
    name: 'Ledge Garden',
    timeLimit: 90,
    playerSpawnPoints: [400, 560],
    platforms: [
      { x: 140, y: 250, w: 160, h: 16 },
      { x: 660, y: 250, w: 160, h: 16 },
    ],
    bubbles: [{ size: 3, x: 480, y: 130 }],
    powerUps: basicDrops(0.15, { placed: [{ type: 'shield', x: 480, y: 40, delay: 8 }] }),
    difficulty: { rating: 3, bubbleSpeed: 0.95 },
    theme: { sky: [0x1d2b33, 0x2f6f5e], accent: 0xb6f25c, orb: 0xffc145 },
  },
  {
    id: 'quickstep',
    name: 'Quickstep',
    timeLimit: 90,
    playerSpawnPoints: [300, 660],
    platforms: [{ x: 400, y: 300, w: 160, h: 16 }],
    bubbles: [
      { size: 2, x: 140, y: 150 },
      { size: 2, x: 820, y: 150, velocityX: -108 },
      { size: 1, x: 420, y: 200, velocityX: -120 },
      { size: 1, x: 540, y: 200 },
    ],
    powerUps: basicDrops(0.14),
    difficulty: { rating: 4, bubbleSpeed: 1.1 },
    theme: { sky: [0x2a1640, 0x6b2f6b], accent: 0xff8ad8, orb: 0x5cf2a0 },
  },
  {
    id: 'the-comb',
    name: 'The Comb',
    timeLimit: 110,
    playerSpawnPoints: [380, 580],
    platforms: [
      { x: 180, y: 220, w: 90, h: 16 },
      { x: 435, y: 180, w: 90, h: 16 },
      { x: 690, y: 220, w: 90, h: 16 },
    ],
    bubbles: [
      { size: 3, x: 300, y: 110 },
      { size: 2, x: 700, y: 120, velocityX: -108 },
    ],
    powerUps: basicDrops(0.13, { placed: [{ type: 'doubleHarpoon', x: 480, y: 120, delay: 12 }] }),
    difficulty: { rating: 5, bubbleSpeed: 1.05 },
    theme: { sky: [0x10243a, 0x1f5a7a], accent: 0xffd166, orb: 0xef476f },
  },
  {
    id: 'crossfire',
    name: 'Crossfire',
    timeLimit: 110,
    playerSpawnPoints: [380, 580],
    platforms: [
      { x: 0, y: 280, w: 150, h: 16 },
      { x: 810, y: 280, w: 150, h: 16 },
    ],
    bubbles: [
      { size: 2, x: 170, y: 130 },
      { size: 2, x: 480, y: 100, velocityX: -108 },
      { size: 2, x: 790, y: 130 },
    ],
    powerUps: basicDrops(0.13),
    difficulty: { rating: 6, bubbleSpeed: 1.15 },
    theme: { sky: [0x331a14, 0x8a3b24], accent: 0xffb347, orb: 0x44c2fd },
  },
  {
    id: 'overhang',
    name: 'Overhang',
    timeLimit: 130,
    playerSpawnPoints: [470, 490],
    platforms: [
      { x: 120, y: 230, w: 300, h: 16 },
      { x: 540, y: 230, w: 300, h: 16 },
    ],
    bubbles: [
      { size: 3, x: 200, y: 120 },
      { size: 3, x: 760, y: 120, velocityX: -96 },
    ],
    powerUps: basicDrops(0.14, { placed: [{ type: 'extraTime', x: 480, y: 60, delay: 30 }] }),
    difficulty: { rating: 7, bubbleSpeed: 1.1 },
    theme: { sky: [0x0d1b2a, 0x274060], accent: 0x9bf6ff, orb: 0xf72585 },
  },
  {
    id: 'hailstorm',
    name: 'Hailstorm',
    timeLimit: 100,
    playerSpawnPoints: [420, 540],
    platforms: [
      { x: 300, y: 200, w: 60, h: 16 },
      { x: 600, y: 200, w: 60, h: 16 },
    ],
    bubbles: [
      { size: 1, x: 80, y: 120 },
      { size: 1, x: 220, y: 160, velocityX: -120 },
      { size: 1, x: 420, y: 110 },
      { size: 1, x: 540, y: 110, velocityX: -120 },
      { size: 1, x: 740, y: 160 },
      { size: 1, x: 880, y: 120, velocityX: -120 },
      { size: 0, x: 150, y: 260 },
      { size: 0, x: 350, y: 300, velocityX: -132 },
      { size: 0, x: 610, y: 300 },
      { size: 0, x: 810, y: 260, velocityX: -132 },
    ],
    powerUps: basicDrops(0.1),
    difficulty: { rating: 8, bubbleSpeed: 1.2 },
    theme: { sky: [0x1b1f3b, 0x4a4e8f], accent: 0xe0e7ff, orb: 0x4cc9f0 },
  },
  {
    id: 'labyrinth',
    name: 'Labyrinth',
    timeLimit: 150,
    playerSpawnPoints: [300, 660],
    platforms: [
      { x: 100, y: 190, w: 140, h: 16 },
      { x: 720, y: 190, w: 140, h: 16 },
      { x: 330, y: 290, w: 300, h: 16 },
      { x: 410, y: 120, w: 140, h: 16 },
    ],
    bubbles: [
      { size: 3, x: 170, y: 100 },
      { size: 3, x: 790, y: 100, velocityX: -96 },
      { size: 1, x: 400, y: 220 },
      { size: 1, x: 560, y: 220, velocityX: -120 },
    ],
    powerUps: basicDrops(0.14, { placed: [{ type: 'shield', x: 480, y: 60, delay: 20 }] }),
    difficulty: { rating: 9, bubbleSpeed: 1.2 },
    theme: { sky: [0x1a1033, 0x502a6e], accent: 0xc77dff, orb: 0x80ffdb },
  },
  {
    id: 'final-bloom',
    name: 'Final Bloom',
    timeLimit: 170,
    playerSpawnPoints: [380, 580],
    platforms: [
      { x: 200, y: 260, w: 120, h: 16 },
      { x: 640, y: 260, w: 120, h: 16 },
      { x: 420, y: 170, w: 120, h: 16 },
    ],
    bubbles: [
      { size: 3, x: 140, y: 110 },
      { size: 3, x: 480, y: 80, velocityX: -96 },
      { size: 3, x: 820, y: 110, velocityX: -96 },
      { size: 2, x: 300, y: 150 },
      { size: 2, x: 660, y: 150, velocityX: -108 },
    ],
    powerUps: basicDrops(0.16, {
      placed: [
        { type: 'doubleHarpoon', x: 260, y: 60, delay: 5 },
        { type: 'extraTime', x: 700, y: 60, delay: 60 },
      ],
    }),
    difficulty: { rating: 10, bubbleSpeed: 1.25 },
    theme: { sky: [0x240b1e, 0x7a1f3d], accent: 0xffe066, orb: 0xff5d8f },
  },
];
