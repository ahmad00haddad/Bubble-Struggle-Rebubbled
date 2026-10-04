import type { BubbleSpawn, LevelConfig } from '@orb/shared';

/**
 * Purpose-built levels for measuring special bubbles in isolation. Same layout, same
 * clock; only the special differs, so the plain control is a fair baseline.
 * Not shipped: real levels get specials in the level-redesign phase.
 */
const layout = (special: (i: number) => Partial<BubbleSpawn>): BubbleSpawn[] =>
  [
    { size: 2, x: 220, y: 150 },
    { size: 2, x: 740, y: 150, velocityX: -108 },
    { size: 1, x: 480, y: 120, velocityY: 150 },
  ].map((b, i) => ({ ...(b as BubbleSpawn), ...special(i) }));

function demo(id: string, special: (i: number) => Partial<BubbleSpawn>): LevelConfig {
  return {
    id,
    name: id,
    timeLimit: 60,
    playerSpawnPoints: [380, 580],
    platforms: [],
    bubbles: layout(special),
    powerUps: { dropChance: 0, pool: {}, placed: [] },
    difficulty: { rating: 1, bubbleSpeed: 1 },
    theme: { sky: [0, 0], accent: 0, orb: 0 },
  };
}

export const DEMO_LEVELS: LevelConfig[] = [
  demo('demo-plain', () => ({})),
  demo('demo-hardshell', () => ({ special: 'hardshell' })),
  demo('demo-ghost', (i) => ({ special: 'ghost', phase: i * 1.7 })),
  demo('demo-twin', (i) => (i < 2 ? { special: 'twin', group: 1 } : {})),
  demo('demo-sync', (i) => (i < 2 ? { special: 'sync' } : {})),
  demo('demo-pincer', (i) => (i < 2 ? { special: 'pincer' } : {})),
  demo('demo-heavy', (i) => (i === 0 ? { special: 'heavy' } : {})),
  demoSequence(),
  demo('demo-coop', (i) => (i < 2 ? { special: 'coop' } : {})),
  demo('demo-coop3', (i) => (i < 2 ? { special: 'coop', need: 3 } : {})),
  demo('demo-link', (i) => (i < 2 ? { special: 'link', group: 1 } : {})),
  demo('demo-priority', (i) => (i === 0 ? { special: 'priority' } : {})),
  demo('demo-mixed', (i) => (i === 0 ? { special: 'hardshell' } : i === 1 ? { special: 'ghost', phase: 0.5 } : {})),
];

/** Three small numbered orbs in one set, plus one big ordinary orb as company. */
function demoSequence(): LevelConfig {
  const l = demo('demo-sequence', () => ({}));
  l.bubbles = [
    { size: 2, x: 480, y: 120 },
    { size: 1, x: 200, y: 150, special: 'sequence', group: 1, order: 1 },
    { size: 1, x: 480, y: 220, velocityX: -120, special: 'sequence', group: 1, order: 2 },
    { size: 1, x: 760, y: 150, velocityX: -120, special: 'sequence', group: 1, order: 3 },
  ];
  return l;
}
