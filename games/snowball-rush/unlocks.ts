// Gradual unlocking of menu features (owner: meta). Pure logic over the save.
import type { Feature, Save } from './types';

/** level (= levels passed, save.level) at which each feature opens */
export const UNLOCK_LEVEL: Record<Feature, number> = { upgrades: 1, wardrobe: 2, daily: 2, cases: 3, shop: 4 };
/** interstitial ads start at this level (and never after the first race of a session) */
export const ADS_FROM_LEVEL = 3;

export function isUnlocked(save: Save, f: Feature): boolean { throw new Error('TODO' + save + f); }
/** features unlocked but not announced yet (in UNLOCK order); also stamps save.unlockedAt for newly opened ones */
export function pendingUnlocks(save: Save, now: number): Feature[] { throw new Error('TODO' + save + now); }
export function markAnnounced(save: Save, f: Feature): void { throw new Error('TODO' + save + f); }
