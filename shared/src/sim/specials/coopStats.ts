/** The cooperative special kinds, for per-kind telemetry. */
export type CoopKind = 'coop' | 'link' | 'priority';

export interface CoopKindStats {
  /** Targets that entered play as cooperative (solo turns them into ordinary orbs, not counted). */
  spawned: number;
  completed: number;
  /** Windows or deadlines that ran out. */
  failed: number;
}

/**
 * Cooperative target counters for the balance harness and tests. Server-side only (never
 * networked); cumulative over the whole match, so a level reload does not reset them.
 * The top-level spawned / completed / failed are the sums over `byKind`.
 */
export interface CoopStats extends CoopKindStats {
  /** Hits that counted toward a target (first hit and each new Lancer). */
  hits: number;
  /** Hits wasted because the same Lancer had already contributed. */
  repeatHits: number;
  /** Sum over completed targets of the Lancers who took part. */
  participants: number;
  /** Ticks spent with a window open, summed over all targets. */
  armedTicks: number;
  /** Rescue beacons dropped when a Lancer was knocked out with a teammate still standing. */
  rescueOffered: number;
  /** Downed Lancers brought back by a Rescue Flare. */
  rescued: number;
  /** Orbs removed whole by two Lancers hitting them together. */
  pinches: number;
  byKind: Record<CoopKind, CoopKindStats>;
}

export function newCoopStats(): CoopStats {
  const k = (): CoopKindStats => ({ spawned: 0, completed: 0, failed: 0 });
  return { spawned: 0, completed: 0, failed: 0, hits: 0, repeatHits: 0, participants: 0, armedTicks: 0, rescueOffered: 0, rescued: 0, pinches: 0, byKind: { coop: k(), link: k(), priority: k() } };
}

export function countCoop(s: CoopStats, kind: CoopKind, what: 'spawned' | 'completed' | 'failed'): void {
  s[what]++;
  s.byKind[kind][what]++;
}
