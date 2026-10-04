import {
  BUBBLE_SIZES,
  HARPOON,
  INPUT,
  PLAYER,
  TICK_DT,
  TICK_RATE,
  GameSimulation,
  Rng,
  activePlatforms,
  advanceBubble,
  circleRectOverlap,
  onSpikes,
  orbSpeedMul,
  passesHarpoon,
  playerHitbox,
  scaleProfile,
  type CoopStats,
  type BubbleState,
  type LevelConfig,
  type PlayerState,
} from '@orb/shared';

/**
 * Headless balance harness. Plays one level with N scripted bots against the real
 * GameSimulation and reports raw measurements. It never judges "balanced".
 *
 * Bot limits (read the numbers as relative, not absolute): it ignores power-ups,
 * decides every 4 ticks, looks 0.5 s ahead, misses 8% of decisions, and splits
 * targets greedily between players. It plays like a decent but unspectacular human.
 */

export interface RunResult {
  level: string;
  players: number;
  seed: number;
  outcome: 'cleared' | 'timeup' | 'gameover';
  /** Seconds of level time used (the full limit when not cleared). */
  seconds: number;
  deaths: number;
  livesRemaining: number;
  popped: number;
  shots: number;
  /**
   * Special counters; null on levels without specials, so "0" never means "unmeasured".
   * Triggered = enrage, fuse start/saved, sync/pincer/heavy/sequence completed.
   * Failed = fuse expired, harpoon through a ghost, window expired, wasted (denied) hit, sequence reset.
   */
  specialsTriggered: number | null;
  specialsFailed: number | null;
  skyEvents: number | null;
  heatPeak: number | null;
  /** Cooperative target counters (cumulative for the run); null when the level has none. */
  coop: CoopStats | null;
}

const TRIGGER = new Set<string>(['enrage', 'fuseStart', 'fuseSave', 'syncDone', 'pincerDone', 'heavyDone', 'seqDone', 'coopDone', 'linkDone', 'priorityDone']);
const FAIL = new Set<string>(['fuseFail', 'miss', 'syncFail', 'pincerFail', 'heavyFail', 'seqReset', 'deny', 'coopFail', 'linkFail', 'priorityFail']);

const DECISION_TICKS = 4;
const LOOKAHEAD_STEPS = 5;
const STEP_S = 0.1;
const AIM_STEP = 2;

interface Track {
  b: BubbleState;
  path: { x: number; y: number }[];
}

function track(sim: GameSimulation): Track[] {
  const platforms = activePlatforms(sim.level, sim.levelTicks);
  return sim.bubbles.map((b) => {
    const c = { ...b };
    const mul = orbSpeedMul(sim.level, b.fast, sim.scale.speedMul, b.rage, b.hot);
    const path: { x: number; y: number }[] = [];
    for (let i = 0; i < LOOKAHEAD_STEPS; i++) {
      advanceBubble(c, STEP_S, platforms, mul);
      path.push({ x: c.x, y: c.y });
    }
    return { b, path };
  });
}

function clampX(x: number): number {
  return Math.min(Math.max(x, PLAYER.width / 2), 960 - PLAYER.width / 2);
}

function danger(sim: GameSimulation, tracks: Track[], x0: number, dir: number): number {
  let cost = 0;
  for (let k = 0; k < LOOKAHEAD_STEPS; k++) {
    const x = clampX(x0 + dir * PLAYER.speed * STEP_S * (k + 1));
    const box = playerHitbox(x);
    const w = 1 + (LOOKAHEAD_STEPS - k) * 0.4;
    for (const t of tracks) {
      if (circleRectOverlap(t.path[k].x, t.path[k].y, BUBBLE_SIZES[t.b.size].radius + 5, box)) cost += w;
    }
    if (onSpikes(sim.level, x)) cost += 3;
    const bomb = sim.level.bombs;
    if (bomb) for (const b of sim.bombs) if (b.fuse < 1.4 && Math.abs(x - b.x) < bomb.radius + 20) cost += 3;
  }
  return cost;
}

/** A platform between the Lancer and the orb would eat the harpoon. */
function blocked(sim: GameSimulation, x: number, targetY: number): boolean {
  return activePlatforms(sim.level, sim.levelTicks).some((p) => x + 3 > p.x && x - 3 < p.x + p.w && p.y + p.h > targetY);
}

/** Per (slot, orb) sideways aim offset, set by the coordination logic (Pincer edge aiming). */
type Offsets = Map<string, number>;

function eligible(sim: GameSimulation, t: Track): boolean {
  if (passesHarpoon(t.b)) return false; // blinking ghost or lit sequence orb: harpoons fly through
  if (t.b.sp === 'sequence') {
    // Only the lowest unlit number is a legal target.
    const next = sim.bubbles.filter((o) => o.sp === 'sequence' && o.lk === t.b.lk && (o.sa ?? 0) < 1).reduce((lo, o) => Math.min(lo, o.n ?? 99), 99);
    return t.b.n === next;
  }
  return true;
}

function decide(
  sim: GameSimulation,
  p: PlayerState,
  tracks: Track[],
  mine: Track[],
  offsets: Offsets,
  harpoonFree: boolean,
  shootNow: boolean,
): number {
  let target: Track | undefined;
  let best = Infinity;
  for (const t of mine) {
    if (!eligible(sim, t)) continue;
    const d = Math.abs(t.path[AIM_STEP].x - p.x) - BUBBLE_SIZES[t.b.size].radius;
    if (d < best) {
      best = d;
      target = t;
    }
  }
  const off = target ? (offsets.get(`${p.slot}:${target.b.id}`) ?? 0) : 0;
  // Edge aiming needs precision: lead by the real harpoon flight time to this orb, not a fixed 0.3 s.
  const aim = target && off !== 0 ? Math.min(LOOKAHEAD_STEPS - 1, Math.max(0, Math.round((436 - target.b.y) / HARPOON.speed / STEP_S) - 1)) : AIM_STEP;
  const tx = target ? target.path[aim].x + off : 0;
  let pick = 0;
  let pickCost = Infinity;
  for (const dir of [0, -1, 1]) {
    let cost = danger(sim, tracks, p.x, dir);
    if (target) cost += Math.abs(clampX(p.x + dir * PLAYER.speed * STEP_S * 2) - tx) / 400;
    if (cost < pickCost - 1e-9) {
      pickCost = cost;
      pick = dir;
    }
  }
  let bits = 0;
  if (pick < 0) bits |= INPUT.LEFT;
  if (pick > 0) bits |= INPUT.RIGHT;
  if (target && harpoonFree && shootNow) {
    const r = BUBBLE_SIZES[target.b.size].radius;
    const tol = off !== 0 ? 6 : r + 3;
    if (Math.abs(p.x - tx) < tol && !blocked(sim, p.x, target.path[aim].y)) bits |= INPUT.SHOOT;
  }
  return bits;
}

/** How many distinct bots should go for this orb at once. */
function crew(sim: GameSimulation, b: BubbleState, alive: number): number {
  if (alive < 2) return 1;
  if (b.sp === 'sync' || b.sp === 'pincer') return 2;
  if (b.sp === 'coop') return Math.min(alive, Math.max(2, b.n ?? 2));
  if (b.sp === 'heavy') return Math.min(alive, Math.max(2, Math.ceil(sim.scale.players / 2)));
  return 1;
}

export function runLevel(level: LevelConfig, players: number, seed: number): RunResult {
  const sim = new GameSimulation({ levels: [level], activeSlots: Array.from({ length: players }, () => true), seed });
  const rng = new Rng(seed ^ 0x9e3779b9);
  const hasSpecials = level.bubbles.some((b) => b.special);
  const hasCoop = level.bubbles.some((b) => b.special === 'coop' || b.special === 'link' || b.special === 'priority');
  let heatPeak = 0;
  let sky = 0;
  let triggered = 0;
  let failed = 0;
  let deaths = 0;
  let popped = 0;
  let shots = 0;
  let seq = 1;
  const bits = new Array<number>(players).fill(0);
  const maxTicks = Math.ceil(level.timeLimit * sim.scale.timeMul * TICK_RATE) + 5;

  for (let i = 0; i < maxTicks && sim.status === 'running'; i++) {
    if (i % DECISION_TICKS === 0) {
      const tracks = track(sim);
      const alive = sim.players.filter((p) => p.life === 'alive');
      // Greedy split: each orb belongs to its nearest living bot(s). Co-op orbs get a crew.
      const owned = new Map<number, Track[]>(alive.map((p) => [p.slot, []]));
      const offsets: Offsets = new Map();
      for (const t of tracks) {
        const crewSize = crew(sim, t.b, alive.length);
        // Link: once the partner is on the clock the Lancer who popped the first orb leaves it to a teammate.
        const pool = t.b.sp === 'link' && (t.b.sa ?? 0) > 0 && alive.length >= 2 ? alive.filter((p) => ((t.b.hm ?? 0) & (1 << p.slot)) === 0) : alive;
        const ranked = [...pool].sort((a, c) => Math.abs(t.path[AIM_STEP].x - a.x) - Math.abs(t.path[AIM_STEP].x - c.x)).slice(0, crewSize);
        ranked.forEach((p, rank) => {
          owned.get(p.slot)!.push(t);
          if (t.b.sp === 'pincer') {
            // Aim at an edge: first shooter the left edge, second the right. If already armed, take the open side.
            const armedSide = (t.b.sa ?? 0) > 0 ? (t.b.hm ?? 0) : 0;
            const wantLeft = armedSide ? armedSide === 2 : rank === 0;
            const m = Math.max(BUBBLE_SIZES[t.b.size].radius * 0.6, 8);
            offsets.set(`${p.slot}:${t.b.id}`, wantLeft ? -m : m);
          }
        });
      }
      const eligibleTracks = tracks.filter((t) => eligible(sim, t));
      const shootNow = (i / DECISION_TICKS) % 2 === 0;
      for (const p of alive) {
        if (rng.next() < 0.08) continue; // missed decision: keep the previous input
        const max = p.dbl > 0 ? HARPOON.doubleMax : HARPOON.baseMax;
        const free = sim.harpoons.filter((h) => h.owner === p.slot).length < max && p.cooldown <= 0;
        const mine = owned.get(p.slot)!.some((t) => eligible(sim, t)) ? owned.get(p.slot)! : eligibleTracks;
        bits[p.slot] = decide(sim, p, tracks, mine, offsets, free, shootNow);
      }
      for (const p of sim.players) {
        // SHOOT is only held on alternate decisions so every press is a fresh rising edge.
        const b = p.life === 'alive' ? bits[p.slot] : 0;
        sim.setInput(p.slot, shootNow ? b : b & ~INPUT.SHOOT, seq++);
      }
    }
    sim.step();
    heatPeak = Math.max(heatPeak, sim.heatRatio);
    for (const e of sim.drainEvents()) {
      if (e.k === 'pop') popped++;
      else if (e.k === 'die') deaths++;
      else if (e.k === 'shoot') shots++;
      else if (e.k === 'sky' && e.t === 'start') sky++;
      else if (e.k === 'sp') {
        if (TRIGGER.has(e.t)) triggered++;
        else if (FAIL.has(e.t)) failed++;
      }
    }
  }

  const outcome: RunResult['outcome'] = sim.status === 'cleared' ? 'cleared' : sim.status === 'gameover' ? 'gameover' : 'timeup';
  return {
    level: level.id,
    players,
    seed,
    outcome,
    seconds: sim.levelTicks * TICK_DT,
    deaths,
    livesRemaining: sim.players.reduce((n, p) => n + (p.active ? p.lives : 0), 0),
    popped,
    shots,
    specialsTriggered: hasSpecials ? triggered : null,
    specialsFailed: hasSpecials ? failed : null,
    skyEvents: sky,
    heatPeak,
    coop: hasCoop ? { ...sim.coopStats, byKind: { ...sim.coopStats.byKind } } : null,
  };
}

export interface Summary {
  level: string;
  players: number;
  runs: number;
  clearRate: number;
  gameoverRate: number;
  /** Median seconds over cleared runs (null when none cleared). */
  clearSecondsMedian: number | null;
  /** Effective time limit for this player count. */
  timeLimit: number;
  deathsMean: number;
  livesRemainingMean: number;
  poppedMean: number;
  shotsMean: number;
  specialsTriggered: number | null;
  specialsFailed: number | null;
  skyEvents: number | null;
  heatPeak: number | null;
  /** Cooperative targets, mean per run (null when the level has none). */
  coop: {
    spawned: number;
    completed: number;
    failed: number;
    /** completed / (completed + failed); null when none were resolved. */
    successRate: number | null;
    repeatHits: number;
    /** Mean Lancers who took part per completed target. */
    participantsPerTarget: number | null;
    /** Mean seconds a target spent with its window or deadline running, per resolved target. */
    armedSecondsPerTarget: number | null;
  } | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function summarizeCoop(rs: RunResult[]): Summary['coop'] {
  const cs = rs.map((r) => r.coop).filter((c): c is CoopStats => c !== null);
  if (!cs.length) return null;
  const sum = (f: (c: CoopStats) => number) => cs.reduce((a, c) => a + f(c), 0);
  const completed = sum((c) => c.completed);
  const failed = sum((c) => c.failed);
  const resolved = completed + failed;
  return {
    spawned: sum((c) => c.spawned) / cs.length,
    completed: completed / cs.length,
    failed: failed / cs.length,
    successRate: resolved ? completed / resolved : null,
    repeatHits: sum((c) => c.repeatHits) / cs.length,
    participantsPerTarget: completed ? sum((c) => c.participants) / completed : null,
    armedSecondsPerTarget: resolved ? sum((c) => c.armedTicks) / TICK_RATE / resolved : null,
  };
}

export function summarize(rs: RunResult[], timeLimit: number): Summary {
  const cleared = rs.filter((r) => r.outcome === 'cleared');
  const optional = (k: 'specialsTriggered' | 'specialsFailed' | 'skyEvents' | 'heatPeak') =>
    rs.every((r) => r[k] === null) ? null : mean(rs.map((r) => r[k] ?? 0));
  return {
    level: rs[0].level,
    players: rs[0].players,
    runs: rs.length,
    clearRate: cleared.length / rs.length,
    gameoverRate: rs.filter((r) => r.outcome === 'gameover').length / rs.length,
    clearSecondsMedian: median(cleared.map((r) => r.seconds)),
    timeLimit,
    deathsMean: mean(rs.map((r) => r.deaths)),
    livesRemainingMean: mean(rs.map((r) => r.livesRemaining)),
    poppedMean: mean(rs.map((r) => r.popped)),
    shotsMean: mean(rs.map((r) => r.shots)),
    specialsTriggered: optional('specialsTriggered'),
    specialsFailed: optional('specialsFailed'),
    skyEvents: optional('skyEvents'),
    heatPeak: optional('heatPeak'),
    coop: summarizeCoop(rs),
  };
}

export function measure(level: LevelConfig, players: number, seeds: number): Summary {
  const rs: RunResult[] = [];
  for (let s = 1; s <= seeds; s++) rs.push(runLevel(level, players, s * 7919));
  return summarize(rs, Math.round(level.timeLimit * scaleProfile(players).timeMul));
}

const f1 = (v: number | null) => (v === null ? '-' : v.toFixed(1));

/** Tab-separated, aligned with spaces for the terminal. Dashes mean "not implemented yet". */
export function formatTable(rows: Summary[]): string {
  const head = ['level', 'N', 'clear%', 'gameov%', 'med.s', 'limit', 'deaths', 'lives', 'popped', 'shots', 'spec+', 'spec-', 'sky', 'heat', 'coop+', 'coop-', 'coop%', 'repeat', 'ppl', 'win.s'];
  const body = rows.map((r) => [
    r.level,
    String(r.players),
    String(Math.round(r.clearRate * 100)),
    String(Math.round(r.gameoverRate * 100)),
    f1(r.clearSecondsMedian),
    String(r.timeLimit),
    f1(r.deathsMean),
    f1(r.livesRemainingMean),
    f1(r.poppedMean),
    f1(r.shotsMean),
    f1(r.specialsTriggered),
    f1(r.specialsFailed),
    f1(r.skyEvents),
    f1(r.heatPeak),
    f1(r.coop?.completed ?? null),
    f1(r.coop?.failed ?? null),
    r.coop?.successRate == null ? '-' : String(Math.round(r.coop.successRate * 100)),
    f1(r.coop?.repeatHits ?? null),
    f1(r.coop?.participantsPerTarget ?? null),
    f1(r.coop?.armedSecondsPerTarget ?? null),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  return [line(head), ...body.map(line)].join('\n');
}
