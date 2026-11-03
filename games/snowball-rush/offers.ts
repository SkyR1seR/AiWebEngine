// Time-limited offers (owner: meta): starter pack, rotating hot deal, New Year pack, comeback offer. Pure logic: every
// timer is derived from `now` and the save, so offers survive reloads and look the same on every screen.
import type { Drop, Loc, Reward, Save } from './types';
import { caseDef, gemValue, grantRewards, itemsOf, ownsItem, product } from './catalog';
import { isUnlocked } from './unlocks';
import { spend } from './save';
import { hash } from './util';

export interface Offer {
  /** unique id of this offer instance, e.g. 'starter', 'hot:2934', 'newyear', 'comeback:<start ms>' */
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

const HOUR = 3600e3;
/** starter pack lifetime after the shop unlocks */
export const STARTER_MS = 48 * HOUR;
/** hot deal rotation window */
export const HOT_MS = 6 * HOUR;
/** comeback offer lifetime */
export const COMEBACK_MS = 30 * 60e3;
/** the New Year pack outside Dec 1 – Jan 15 is a «Зимний набор» with a rolling 3-day timer */
const WINTER_MS = 72 * HOUR;

/** session state: the comeback offer starts at most once per session (see triggerComeback) */
const session: { comebackSince?: number } = {};
/** start the comeback offer after 2 losses in a row (shop unlocked, once per session); true = just started (show it) */
export function triggerComeback(save: Save, now: number): boolean {
  if (session.comebackSince != null || save.lossStreak < 2 || !isUnlocked(save, 'shop')) return false;
  session.comebackSince = now;
  return true;
}
/** forget the session state (tests) */
export function resetOfferSession(): void { delete session.comebackSince; }

const has = (save: Save, ...ids: string[]) => ids.some((id) => save.bought.includes(id));
/** price after a discount (percent) */
const off = (old: number, pct: number) => Math.round((old * (100 - pct)) / 100);

function starter(save: Save, now: number): Offer | null {
  if (has(save, 'starter', 'starter_pack')) return null;
  const p = product('starter_pack')!;
  return {
    id: 'starter', kind: 'starter', productId: p.id, rewards: p.rewards, discount: 90,
    endsAt: (save.unlockedAt.shop ?? now) + STARTER_MS, hero: { kind: 'skin', id: 'iceknight' },
    title: { ru: 'Стартовый набор', en: 'Starter Pack' },
    desc: { ru: 'Только один раз: эпический Ледяной рыцарь, 300 кристаллов и 3000 монет!', en: 'One time only: the epic Ice Knight, 300 gems and 3000 coins!' },
  };
}

/** end of the New Year season (Jan 15 23:59:59 local) if `now` is within Dec 1 – Jan 15, else null */
export function newYearEnd(now: number): number | null {
  const d = new Date(now), m = d.getMonth(), y = d.getFullYear();
  if (m === 11) return new Date(y + 1, 0, 15, 23, 59, 59, 999).getTime();
  if (m === 0 && d.getDate() <= 15) return new Date(y, 0, 15, 23, 59, 59, 999).getTime();
  return null;
}
function newYear(save: Save, now: number): Offer | null {
  if (has(save, 'newyear', 'newyear_pack')) return null;
  const p = product('newyear_pack')!, end = newYearEnd(now);
  return {
    id: 'newyear', kind: 'newyear', productId: p.id, rewards: p.rewards, discount: 80,
    endsAt: end ?? (Math.floor(now / WINTER_MS) + 1) * WINTER_MS, hero: { kind: 'skin', id: 'santa' },
    title: end ? { ru: 'Новогодний мега-набор', en: 'New Year Mega Pack' } : { ru: 'Зимний набор', en: 'Winter Pack' },
    desc: { ru: 'Легендарный Дед Мороз, Золотой ком и 800 кристаллов!', en: 'Legendary Santa, the Golden Snowball and 800 gems!' },
  };
}

function comeback(save: Save, now: number, since: number | undefined): Offer | null {
  if (since == null || now >= since + COMEBACK_MS || has(save, `comeback:${since}`)) return null;
  return {
    id: `comeback:${since}`, kind: 'comeback', gems: 45, oldGems: 120, discount: 63, endsAt: since + COMEBACK_MS,
    rewards: [{ kind: 'coins', n: 2500 }, { kind: 'key', id: 'ice', n: 1 }], hero: { kind: 'key', id: 'ice' },
    title: { ru: 'Не сдавайся!', en: "Don't give up!" },
    desc: { ru: '2500 монет и Ледяной подарок со скидкой!', en: '2500 coins and an Ice Gift at a discount!' },
  };
}

/** hot deal kinds in rotation order (one per 6 h window) */
const HOT_CYCLE = ['item', 'snowKeys', 'coins', 'item', 'iceKeys', 'legend'] as const;

/** items a hot deal may sell: not owned, not default / offer-exclusive, not sold for coins */
function hotItems(save: Save, legend: boolean) {
  const out: { kind: 'skin' | 'ball'; id: string; old: number; epic: boolean }[] = [];
  for (const kind of ['skin', 'ball'] as const) {
    for (const d of itemsOf(kind)) {
      const okRarity = legend ? d.rarity === 'legendary' : d.rarity === 'rare' || d.rarity === 'epic';
      if (!okRarity || d.src === 'default' || d.src === 'offer' || d.price?.cur === 'coins' || ownsItem(save, kind, d.id)) continue;
      out.push({ kind, id: d.id, old: gemValue(d), epic: d.rarity === 'epic' });
    }
  }
  return out;
}

function hot(save: Save, now: number): Offer | null {
  const w = Math.floor(now / HOT_MS), id = `hot:${w}`;
  if (has(save, id)) return null;
  const base = { id, kind: 'hot' as const, title: { ru: 'Горячее предложение', en: 'Hot Deal' }, endsAt: (w + 1) * HOT_MS };
  const gemDeal = (old: number, pct: number) => ({ gems: off(old, pct), oldGems: old, discount: pct });
  const k = HOT_CYCLE[w % HOT_CYCLE.length];
  if (k === 'item' || k === 'legend') {
    const items = hotItems(save, k === 'legend');
    if (items.length) {
      const it = items[hash(id) % items.length], pct = k === 'legend' ? 40 : 50;
      const desc = k === 'legend' ? { ru: `Легендарный предмет со скидкой ${pct}%!`, en: `A legendary item at ${pct}% off!` }
        : it.epic ? { ru: 'Эпический предмет за полцены!', en: 'An epic item at half price!' }
          : { ru: 'Редкий предмет за полцены!', en: 'A rare item at half price!' };
      return { ...base, ...gemDeal(it.old, pct), desc, rewards: [{ kind: it.kind, id: it.id }], hero: { kind: it.kind, id: it.id } };
    }
    // everything owned: a mixed bundle instead
    return {
      ...base, ...gemDeal(150, 50), hero: { kind: 'key', id: 'ice' },
      rewards: [{ kind: 'coins', n: 3000 }, { kind: 'key', id: 'ice', n: 1 }],
      desc: { ru: '3000 монет и Ледяной подарок за полцены!', en: '3000 coins and an Ice Gift at half price!' },
    };
  }
  if (k === 'snowKeys') {
    return {
      ...base, ...gemDeal(3 * caseDef('snow').price, 40), hero: { kind: 'key', id: 'snow' }, rewards: [{ kind: 'key', id: 'snow', n: 3 }],
      desc: { ru: '3 Снежных подарка со скидкой!', en: '3 Snow Gifts at a discount!' },
    };
  }
  if (k === 'iceKeys') {
    return {
      ...base, ...gemDeal(2 * caseDef('ice').price, 45), hero: { kind: 'key', id: 'ice' }, rewards: [{ kind: 'key', id: 'ice', n: 2 }],
      desc: { ru: '2 Ледяных подарка со скидкой!', en: '2 Ice Gifts at a discount!' },
    };
  }
  return {
    ...base, ...gemDeal(120, 50), hero: { kind: 'coins' }, rewards: [{ kind: 'coins', n: 6000 }],
    desc: { ru: 'Гора монет за полцены!', en: 'A pile of coins at half price!' },
  };
}

/** offers available now (not bought, not expired), most valuable first; nothing until the shop unlocks.
 * `flags.comebackSince` defaults to the session state set by triggerComeback(). */
export function activeOffers(save: Save, now: number, flags: { comebackSince?: number } = session): Offer[] {
  if (!isUnlocked(save, 'shop')) return [];
  const out: Offer[] = [];
  for (const o of [starter(save, now), newYear(save, now), comeback(save, now, flags.comebackSince), hot(save, now)]) {
    if (o && now < o.endsAt) out.push(o);
  }
  return out;
}
/** an active offer by its id; a bare kind ('hot', 'comeback', ...) finds the current instance of that kind */
export function offerById(save: Save, now: number, id: string, flags?: { comebackSince?: number }): Offer | undefined {
  return activeOffers(save, now, flags).find((o) => o.id === id || o.kind === id);
}
/** remember that this offer instance was bought (older hot/comeback instances are pruned from save.bought) */
export function markBought(save: Save, offer: Offer): void {
  if (offer.kind === 'hot' || offer.kind === 'comeback') {
    const pre = offer.kind + ':';
    save.bought = save.bought.filter((b) => !b.startsWith(pre));
  }
  if (!save.bought.includes(offer.id)) save.bought.push(offer.id);
}
/** buy a gem offer: spend gems, grant rewards, mark bought. Drops granted (keys are applied but not listed), or null */
export function buyGemOffer(save: Save, offer: Offer): Drop[] | null {
  if (offer.gems == null || has(save, offer.id) || !spend(save, 'gems', offer.gems)) return null;
  const drops = grantRewards(save, offer.rewards);
  markBought(save, offer);
  return drops;
}
