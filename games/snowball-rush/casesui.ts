// Cases (owner: ui-store): case cards (price, keys, free-for-ad timer, chances) and the roulette opening animation.
import type { CaseId, Ctx, ScreenApi } from './types';

export function createCases(ctx: Ctx): ScreenApi { throw new Error('TODO' + ctx); }
/** pay (gems / key / ad) and play the roulette; true if a case was opened */
export function openCase(ctx: Ctx, id: CaseId, via: 'gems' | 'key' | 'ad'): Promise<boolean> { throw new Error('TODO' + ctx + id + via); }
