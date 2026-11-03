// Time-limited offers (owner: meta): starter pack, rotating hot deal, New Year pack, comeback offer. Pure logic.
import type { Loc, Reward, Save } from './types';

export interface Offer {
  /** unique id of this offer instance, e.g. 'starter', 'hot:2934', 'newyear', 'comeback' */
  id: string;
  kind: 'starter' | 'hot' | 'newyear' | 'comeback';
  title: Loc;
  desc: Loc;
  rewards: Reward[];
  /** bought with real money (IAP product id) ... */
  productId?: string;
  /** ... or with gems */
  gems?: number;
  /** strike-through old price in gems (gem offers) */
  oldGems?: number;
  /** discount percent shown on the badge */
  discount: number;
  /** ms timestamp when it disappears */
  endsAt: number;
  /** what to draw big on the card */
  hero: { kind: 'skin' | 'ball' | 'key' | 'gems' | 'coins'; id?: string };
}

/** offers available now (not bought, not expired), most valuable first */
export function activeOffers(save: Save, now: number, flags: { comebackSince?: number } = {}): Offer[] {
  throw new Error('TODO' + save + now + flags);
}
export function offerById(save: Save, now: number, id: string): Offer | undefined { throw new Error('TODO' + save + now + id); }
/** remember that this offer instance was bought */
export function markBought(save: Save, offer: Offer): void { throw new Error('TODO' + save + offer); }
