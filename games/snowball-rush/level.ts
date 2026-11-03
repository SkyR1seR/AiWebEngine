// Level generator (owner: core). Pure data, deterministic per (n, seed).
import type { LevelData, Obstacle } from './types';

/** Build level `n` (0-based). Same (n, seed) → same level. */
export function generateLevel(n: number, seed = n * 7919 + 13): LevelData {
  throw new Error('TODO generateLevel ' + n + seed);
}

/** surface code (SURF) at a world point, -1 outside the track / over a hole */
export function surfaceAt(L: LevelData, x: number, d: number): number {
  throw new Error('TODO surfaceAt' + L + x + d);
}

/** the hole (kind 'gap') covering distance d, if any */
export function gapAt(L: LevelData, d: number): Obstacle | null {
  throw new Error('TODO gapAt' + L + d);
}
