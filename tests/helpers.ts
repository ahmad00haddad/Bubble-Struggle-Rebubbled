import type { BubbleSpawn, LevelConfig, PowerUpType, Rect } from '@orb/shared';

export function testLevel(over: Partial<LevelConfig> & { bubbles?: BubbleSpawn[]; platforms?: Rect[] } = {}): LevelConfig {
  return {
    id: over.id ?? 'test',
    name: 'Test',
    timeLimit: 60,
    playerSpawnPoints: [200, 760],
    platforms: [],
    bubbles: [{ size: 2, x: 480, y: 150 }],
    powerUps: { dropChance: 0, pool: {}, placed: [] },
    difficulty: { rating: 1, bubbleSpeed: 1 },
    theme: { sky: [0, 0], accent: 0, orb: 0 },
    ...over,
  };
}

export function placed(type: PowerUpType, x: number, y = 440, delay = 0) {
  return { dropChance: 0, pool: {}, placed: [{ type, x, y, delay }] };
}
