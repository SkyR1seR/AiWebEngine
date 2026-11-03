// Level generator (owner: core). Pure data, deterministic per (n, seed).
import type { LevelData, Obstacle, ObstacleKind } from './types';

/** smooth difficulty 0..1 of level n (before easing) */
export function difficulty(n: number): number { throw new Error('TODO difficulty ' + n); }
/** easing 0..0.5 from failed attempts on the level: every retry is a bit easier */
export function easeFor(tries: number): number { throw new Error('TODO easeFor ' + tries); }

/**
 * Build level `n` (0-based). Same (n, seed, ease) → same level. `ease` (from easeFor(save.tries)) keeps the layout
 * recognizable but removes some obstacles, lowers wall/hole requirements and bot skill.
 */
export function generateLevel(n: number, seed = n * 7919 + 13, ease = 0): LevelData {
  throw new Error('TODO generateLevel ' + n + seed + ease);
}

/** obstacle kinds that appear for the first time in level n (intro cards) */
export function newKinds(n: number): ObstacleKind[] { throw new Error('TODO newKinds ' + n); }

/** surface code (SURF) at a world point, -1 outside the track / over a hole */
export function surfaceAt(L: LevelData, x: number, d: number): number {
  throw new Error('TODO surfaceAt' + L + x + d);
}

/** the hole (kind 'gap') covering distance d, if any */
export function gapAt(L: LevelData, d: number): Obstacle | null {
  throw new Error('TODO gapAt' + L + d);
}
