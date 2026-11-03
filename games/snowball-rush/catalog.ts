// Content & economy data (owner: meta): skins, balls, upgrades, cases, leagues, rewards, IAP products, daily calendar.
import type { CaseId, Currency, Drop, Loc, RacerStats, Rarity, Reward, Save, UpgradeId } from './types';

export interface ItemDef {
  id: string;
  name: Loc;
  rarity: Rarity;
  /** direct price in the wardrobe (absent = not sold directly) */
  price?: { cur: Currency; n: number };
  /** where else it comes from (shown on locked cards) */
  src?: 'default' | 'case' | 'offer' | 'daily';
}
export const SKINS: ItemDef[] = [];
export const BALLS: ItemDef[] = [];
export function itemDef(kind: 'skin' | 'ball', id: string): ItemDef { throw new Error('TODO' + kind + id); }

export interface UpgradeDef { id: UpgradeId; name: Loc; desc: Loc; max: number }
export const UPGRADES: UpgradeDef[] = [];
/** coins to go from `lvl` to `lvl + 1` */
export function upgradeCost(id: UpgradeId, lvl: number): number { throw new Error('TODO' + id + lvl); }
/** localized effect at a level, e.g. "+25% скорость" */
export function upgradeLabel(id: UpgradeId, lvl: number): string { throw new Error('TODO' + id + lvl); }
/** gameplay stats of a racer from upgrade levels */
export function racerStats(up: Record<UpgradeId, number>): RacerStats { throw new Error('TODO' + up); }

export interface CaseDef { id: CaseId; name: Loc; rarity: Rarity; price: number; /** free via rewarded ad every N ms */ adEvery?: number }
export const CASES: CaseDef[] = [];
/** drop table for the "chances" popup (chance 0..1) */
export function caseOdds(id: CaseId): { label: Loc; rarity: Rarity | null; chance: number }[] { throw new Error('TODO' + id); }
/** roll a case (pure: does not change the save; pity counted from save.pity) */
export function rollCase(id: CaseId, save: Save, rnd: () => number = Math.random): Drop { throw new Error('TODO' + id + save + rnd); }
/** random items for the roulette strip around the real drop */
export function rouletteFiller(id: CaseId, n: number, rnd: () => number = Math.random): Drop[] { throw new Error('TODO' + id + n + rnd); }
/** apply a drop to the save (dup → comp coins, pity update for case drops is done by the caller via save.pity) */
export function grantDrop(save: Save, d: Drop): void { throw new Error('TODO' + save + d); }
/** apply rewards; returns what was actually granted (owned items → dup with comp coins) */
export function grantRewards(save: Save, rewards: Reward[]): Drop[] { throw new Error('TODO' + save + rewards); }
export const DUP_COMP: Record<Rarity, number> = { common: 150, rare: 400, epic: 1000, legendary: 2500 };

export interface League { name: Loc; min: number; gems: number; color: string }
export const LEAGUES: League[] = [];
export function leagueOf(trophies: number): number { throw new Error('TODO' + trophies); }
export function trophyDelta(place: number): number { throw new Error('TODO' + place); }
/** race reward: (placeBase + collected) * mult */
export function raceCoins(place: number, level: number, collected: number, mult: number): number { throw new Error('TODO' + place + level + collected + mult); }

export interface Product {
  id: string;
  title: Loc;
  rewards: Reward[];
  /** shown when the portal catalog has no price */
  fallbackPrice: string;
  consumable: boolean;
  /** "+20%" style bonus label */
  bonus?: number;
  badge?: Loc;
}
export const PRODUCTS: Product[] = [];
export function product(id: string): Product | undefined { throw new Error('TODO' + id); }
/** gems → coins packs in the shop */
export const COIN_PACKS: { id: string; gems: number; coins: number }[] = [];
/** coins for watching an ad in the shop at a level */
export function adCoins(level: number): number { throw new Error('TODO' + level); }
/** 7-day New Year calendar rewards (index = day % 7) */
export const DAILY: Reward[] = [];
