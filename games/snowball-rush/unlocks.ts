// Gradual unlocking of menu features (owner: meta). Pure logic over the save.
// Levels: save.level counts levels passed (0-based); the UI shows "Level save.level + 1", so a feature with
// UNLOCK_LEVEL n opens when the player reaches displayed level n + 1 (lockLabel uses that number).
import type { Drop, Feature, Loc, Save } from './types';
import { tr } from './i18n';
import { grantRewards } from './catalog';

/** level (= levels passed, save.level) at which each feature opens */
export const UNLOCK_LEVEL: Record<Feature, number> = { upgrades: 1, wardrobe: 2, daily: 2, cases: 3, shop: 4 };
/** interstitial ads start at this level (and never after the first race of a session) */
export const ADS_FROM_LEVEL = 3;
/** all features in unlock order */
export const FEATURES: readonly Feature[] = ['upgrades', 'wardrobe', 'daily', 'cases', 'shop'];

export function isUnlocked(save: Save, f: Feature): boolean { return save.level >= UNLOCK_LEVEL[f]; }
/** features unlocked but not announced yet (in UNLOCK order); also stamps save.unlockedAt for newly opened ones */
export function pendingUnlocks(save: Save, now: number): Feature[] {
  const out: Feature[] = [];
  for (const f of FEATURES) {
    if (!isUnlocked(save, f)) continue;
    if (save.unlockedAt[f] == null) save.unlockedAt[f] = now;
    if (!save.announced.includes(f)) out.push(f);
  }
  return out;
}
export function markAnnounced(save: Save, f: Feature): void {
  if (!save.announced.includes(f)) save.announced.push(f);
}

/** "Unlocks at level 3" for a locked button (toast / tooltip) */
export function lockLabel(f: Feature): string {
  const n = UNLOCK_LEVEL[f] + 1;
  return tr({ ru: `Откроется на уровне ${n}`, en: `Unlocks at level ${n}` });
}
/** short lock badge: "Ур. 3" */
export function lockShort(f: Feature): string {
  const n = UNLOCK_LEVEL[f] + 1;
  return tr({ ru: `Ур. ${n}`, en: `Lv. ${n}` });
}
const NAMES: Record<Feature, Loc> = {
  upgrades: { ru: 'Улучшения', en: 'Upgrades' },
  wardrobe: { ru: 'Гардероб', en: 'Wardrobe' },
  daily: { ru: 'Новогодний календарь', en: 'Gift Calendar' },
  cases: { ru: 'Подарки', en: 'Gifts' },
  shop: { ru: 'Магазин', en: 'Shop' },
};
/** localized feature name */
export function featureName(f: Feature): string { return tr(NAMES[f]); }

/** interstitials allowed by progress and purchases (the caller also skips the first race of a session) */
export function adsAllowed(save: Save): boolean { return save.level >= ADS_FROM_LEVEL && !save.noAds; }

// ---- one-time tutorial freebies (save.freebies): first upgrade free, first snow case free, wardrobe gift skin
export type Freebie = 'upgrade' | 'case' | 'skin';
const FREEBIE_FEATURE: Record<Freebie, Feature> = { upgrade: 'upgrades', case: 'cases', skin: 'wardrobe' };
/** the freebie's feature is unlocked and it was not used yet */
export function freebieAvailable(save: Save, which: Freebie): boolean {
  return isUnlocked(save, FREEBIE_FEATURE[which]) && !save.freebies.includes(which);
}
export function useFreebie(save: Save, which: Freebie): void {
  if (!save.freebies.includes(which)) save.freebies.push(which);
}
/** wardrobe gift: gives the `winter` skin once (equips it); null if already given or the wardrobe is locked */
export function claimSkinGift(save: Save): Drop | null {
  if (!freebieAvailable(save, 'skin')) return null;
  useFreebie(save, 'skin');
  const [d] = grantRewards(save, [{ kind: 'skin', id: 'winter' }]);
  if (d && d.kind === 'skin' && !d.dup) save.skin = 'winter';
  return d ?? null;
}
