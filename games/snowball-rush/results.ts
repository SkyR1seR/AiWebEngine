// Race results (owner: ui-core): places table, rewards (coins, trophies, gems, league up), x2 for an ad, next/retry/menu.
import type { Ctx, Racer } from './types';

export interface ResultData {
  level: number;
  place: number;
  passed: boolean;
  /** all racers sorted by place */
  racers: Racer[];
  player: Racer;
  /** coins before the x2 ad (already added to the save) */
  coins: number;
  collected: number;
  mult: number;
  trophies: number;
  gems: number;
  /** league reached for the first time (index) or -1 */
  leagueUp: number;
}
/** shows the screen; the x2 ad adds coins itself; resolves with the chosen action */
export function showResults(ctx: Ctx, r: ResultData): Promise<'next' | 'retry' | 'menu'> { throw new Error('TODO' + ctx + r); }
