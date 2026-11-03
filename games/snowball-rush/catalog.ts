// Content & economy data (owner: meta): skins, balls, upgrades, cases, leagues, rewards, IAP products, daily calendar.
// Everything here is data + pure functions over the save (no DOM). Names are Loc objects: pass them to tr() at use time.
import type { CaseId, Currency, Drop, Loc, RacerStats, Rarity, Reward, Save, UpgradeId } from './types';
import { lang, tr } from './i18n';
import { dayKey, randInt, weighted } from './util';

// ---------------------------------------------------------------- items
export interface ItemDef {
  id: string;
  name: Loc;
  rarity: Rarity;
  /** direct price in the wardrobe (absent = not sold directly) */
  price?: { cur: Currency; n: number };
  /** where else it comes from (shown on locked cards): 'default' owned from the start, 'case' cases only,
   * 'offer' offers/IAP packs (see PRODUCTS), 'daily' calendar, 'gift' tutorial gift (the `winter` skin, given free when
   * the wardrobe unlocks — `price` is the fallback if the gift was somehow missed) */
  src?: 'default' | 'case' | 'offer' | 'daily' | 'gift';
  /** cases that can drop it (absent = every case that drops its rarity; [] = never from cases) */
  cases?: CaseId[];
}

export const SKINS: ItemDef[] = [
  { id: 'noob', name: { ru: 'Нубик', en: 'Noob' }, rarity: 'common', src: 'default', cases: [] },
  { id: 'winter', name: { ru: 'Нубик в шапке', en: 'Winter Noob' }, rarity: 'common', price: { cur: 'coins', n: 500 }, src: 'gift' },
  { id: 'skier', name: { ru: 'Лыжник', en: 'Skier' }, rarity: 'common', price: { cur: 'coins', n: 1500 } },
  { id: 'hockey', name: { ru: 'Хоккеист', en: 'Hockey Player' }, rarity: 'common', price: { cur: 'coins', n: 3000 } },
  { id: 'penguin', name: { ru: 'Пингвин', en: 'Penguin' }, rarity: 'rare', price: { cur: 'gems', n: 120 } },
  { id: 'elf', name: { ru: 'Эльф', en: 'Elf' }, rarity: 'rare', price: { cur: 'gems', n: 150 } },
  { id: 'gingerbread', name: { ru: 'Пряник', en: 'Gingerbread' }, rarity: 'rare', src: 'case' },
  { id: 'snowman', name: { ru: 'Снеговик', en: 'Snowman' }, rarity: 'epic', price: { cur: 'gems', n: 350 } },
  { id: 'reindeer', name: { ru: 'Олень', en: 'Reindeer' }, rarity: 'epic', src: 'case' },
  { id: 'snowmaiden', name: { ru: 'Снегурочка', en: 'Snow Maiden' }, rarity: 'epic', price: { cur: 'gems', n: 400 } },
  { id: 'iceknight', name: { ru: 'Ледяной рыцарь', en: 'Ice Knight' }, rarity: 'epic', src: 'offer', cases: [] },
  { id: 'santa', name: { ru: 'Дед Мороз', en: 'Santa' }, rarity: 'legendary', src: 'offer', cases: ['santa'] },
  { id: 'yeti', name: { ru: 'Йети', en: 'Yeti' }, rarity: 'legendary', price: { cur: 'gems', n: 900 } },
  { id: 'nutcracker', name: { ru: 'Щелкунчик', en: 'Nutcracker' }, rarity: 'legendary', src: 'case' },
];

export const BALLS: ItemDef[] = [
  { id: 'snow', name: { ru: 'Снежок', en: 'Snowball' }, rarity: 'common', src: 'default', cases: [] },
  { id: 'tangerine', name: { ru: 'Мандарин', en: 'Tangerine' }, rarity: 'common', price: { cur: 'coins', n: 800 } },
  { id: 'candy', name: { ru: 'Леденец', en: 'Candy' }, rarity: 'rare', price: { cur: 'gems', n: 100 } },
  { id: 'ornament', name: { ru: 'Ёлочный шар', en: 'Tree Ornament' }, rarity: 'rare', price: { cur: 'coins', n: 2500 } },
  { id: 'garland', name: { ru: 'Гирлянда', en: 'Garland' }, rarity: 'epic', price: { cur: 'gems', n: 300 } },
  { id: 'ice', name: { ru: 'Ледяной кристалл', en: 'Ice Crystal' }, rarity: 'epic', src: 'case' },
  { id: 'disco', name: { ru: 'Диско-шар', en: 'Disco Ball' }, rarity: 'epic', price: { cur: 'gems', n: 350 } },
  { id: 'gold', name: { ru: 'Золотой ком', en: 'Golden Snowball' }, rarity: 'legendary', src: 'offer' },
  { id: 'olivier', name: { ru: 'Оливье', en: 'Olivier Salad' }, rarity: 'legendary', price: { cur: 'gems', n: 800 } },
];

export const DEFAULT_SKIN = 'noob';
export const DEFAULT_BALL = 'snow';

export function itemsOf(kind: 'skin' | 'ball'): ItemDef[] { return kind === 'skin' ? SKINS : BALLS; }
/** item definition (unknown ids → the default item, so callers never crash on stale data) */
export function itemDef(kind: 'skin' | 'ball', id: string): ItemDef {
  const list = itemsOf(kind);
  return list.find((d) => d.id === id) ?? list[0];
}
export function isItem(kind: 'skin' | 'ball', id: unknown): id is string {
  return typeof id === 'string' && itemsOf(kind).some((d) => d.id === id);
}
export function ownsItem(save: Save, kind: 'skin' | 'ball', id: string): boolean {
  return (kind === 'skin' ? save.skins : save.balls).includes(id);
}
/** buy an item for its direct price (wardrobe) and equip it; false if not for sale, owned or unaffordable */
export function buyItem(save: Save, kind: 'skin' | 'ball', id: string): boolean {
  const d = itemDef(kind, id);
  if (d.id !== id || !d.price || ownsItem(save, kind, id) || !(save[d.price.cur] >= d.price.n)) return false;
  save[d.price.cur] -= d.price.n;
  (kind === 'skin' ? save.skins : save.balls).push(id);
  if (kind === 'skin') save.skin = id; else save.ball = id;
  return true;
}
/** gem value of an item (gem price, or a rarity-based value for case/offer items; offers show it as the old price) */
export function gemValue(d: ItemDef): number {
  return d.price?.cur === 'gems' ? d.price.n : ({ common: 40, rare: 150, epic: 400, legendary: 1000 } as const)[d.rarity];
}

// ---------------------------------------------------------------- upgrades
export interface UpgradeDef { id: UpgradeId; name: Loc; desc: Loc; max: number }
export const UPGRADES: UpgradeDef[] = [
  { id: 'speed', name: { ru: 'Скорость', en: 'Speed' }, desc: { ru: 'Бегаешь быстрее', en: 'Run faster' }, max: 20 },
  { id: 'grip', name: { ru: 'Липкий снег', en: 'Sticky Snow' }, desc: { ru: 'Ком растёт быстрее', en: 'Your snowball grows faster' }, max: 20 },
  { id: 'armor', name: { ru: 'Ледяная броня', en: 'Ice Armor' }, desc: { ru: 'Ком меньше тает, а на старте есть щиты', en: 'Less melting, plus shields at the start' }, max: 20 },
  { id: 'start', name: { ru: 'Стартовый ком', en: 'Head Start' }, desc: { ru: 'Ком больше с самого старта', en: 'A bigger snowball right from the start' }, max: 15 },
  { id: 'magnet', name: { ru: 'Магнит', en: 'Magnet' }, desc: { ru: 'Собирай монеты издалека', en: 'Grab coins from farther away' }, max: 15 },
];
export const UPGRADE_IDS: readonly UpgradeId[] = ['speed', 'grip', 'armor', 'start', 'magnet'];
export function upgradeMax(id: UpgradeId): number { return UPGRADES.find((u) => u.id === id)?.max ?? 0; }
/** coins to go from `lvl` to `lvl + 1` (Infinity when maxed) */
export function upgradeCost(id: UpgradeId, lvl: number): number {
  if (lvl >= upgradeMax(id)) return Infinity;
  return Math.max(5, Math.round((60 * Math.pow(1.27, Math.max(0, lvl))) / 5) * 5);
}
/** decimal number in the current language's style, Latin digits ("2.5" / "2,5") */
function dec(x: number): string {
  const v = Math.round(x * 10) / 10;
  try { return v.toLocaleString(`${lang}-u-nu-latn`); } catch { return String(v); }
}
/** localized effect at a level, e.g. "+25% к скорости" */
export function upgradeLabel(id: UpgradeId, lvl: number): string {
  const s = racerStats({ speed: 0, grip: 0, armor: 0, start: 0, magnet: 0, [id]: lvl });
  switch (id) {
    case 'speed': { const p = dec((s.speedMul - 1) * 100); return tr({ ru: `+${p}% к скорости`, en: `+${p}% speed` }); }
    case 'grip': { const p = Math.round((s.growMul - 1) * 100); return tr({ ru: `+${p}% к росту кома`, en: `+${p}% snowball growth` }); }
    case 'armor': {
      const p = Math.round((1 - s.meltMul) * 100), n = s.shields;
      return n > 0 ? tr({ ru: `−${p}% таяния, щиты: ${n}`, en: `−${p}% melting, shields: ${n}` }) : tr({ ru: `−${p}% таяния`, en: `−${p}% melting` });
    }
    case 'start': { const n = s.startSize; return tr({ ru: `Ком на старте: ${n}`, en: `Starting snowball: ${n}` }); }
    case 'magnet': { const p = Math.round((s.magnet / 0.9 - 1) * 100); return tr({ ru: `+${p}% к радиусу сбора`, en: `+${p}% pickup radius` }); }
  }
}
/** gameplay stats of a racer from upgrade levels (levels clamped to 0..max) */
export function racerStats(up: Record<UpgradeId, number>): RacerStats {
  const l = (id: UpgradeId) => Math.min(upgradeMax(id), Math.max(0, Math.floor(up?.[id] || 0)));
  const a = l('armor');
  return {
    speedMul: 1 + 0.025 * l('speed'),
    growMul: 1 + 0.06 * l('grip'),
    meltMul: Math.max(0.3, 1 - 0.035 * a),
    startSize: 3 + l('start'),
    magnet: 0.9 + 0.12 * l('magnet'),
    shields: a >= 20 ? 3 : a >= 12 ? 2 : a >= 5 ? 1 : 0,
  };
}

// ---------------------------------------------------------------- timers of free (ad) rewards
/** free upgrade level for a rewarded ad: cooldown (ms) */
export const FREE_UP_MS = 10 * 60e3;
/** ad coins in the shop: cooldown (ms) and daily limit */
export const AD_COINS_MS = 3 * 60e3;
export const AD_COINS_PER_DAY = 10;
/** coins for watching an ad in the shop at a level */
export function adCoins(level: number): number { return 60 + 10 * Math.max(0, Math.floor(level || 0)); }

// ---------------------------------------------------------------- cases
export interface CaseDef { id: CaseId; name: Loc; rarity: Rarity; price: number; /** free via rewarded ad every N ms */ adEvery?: number }
export const CASES: CaseDef[] = [
  { id: 'snow', name: { ru: 'Снежный подарок', en: 'Snow Gift' }, rarity: 'common', price: 30, adEvery: 4 * 3600e3 },
  { id: 'ice', name: { ru: 'Ледяной подарок', en: 'Ice Gift' }, rarity: 'rare', price: 90 },
  { id: 'santa', name: { ru: 'Подарок Деда Мороза', en: "Santa's Gift" }, rarity: 'legendary', price: 250 },
];
export function caseDef(id: CaseId): CaseDef { return CASES.find((c) => c.id === id) ?? CASES[0]; }
/** ice/santa opens without a legendary before the next one is guaranteed (the 25th open) */
export const PITY = 25;
export const DUP_COMP: Record<Rarity, number> = { common: 150, rare: 400, epic: 1000, legendary: 2500 };

/** a row of a case drop table: currency amount range or an item of a rarity */
export type DropSlot = { w: number; kind: 'coins' | 'gems'; min: number; max: number } | { w: number; kind: 'item'; rarity: Rarity };
const DROPS: Record<CaseId, DropSlot[]> = {
  snow: [
    { w: 0.52, kind: 'coins', min: 150, max: 400 }, { w: 0.05, kind: 'gems', min: 3, max: 6 },
    { w: 0.30, kind: 'item', rarity: 'common' }, { w: 0.11, kind: 'item', rarity: 'rare' },
    { w: 0.017, kind: 'item', rarity: 'epic' }, { w: 0.003, kind: 'item', rarity: 'legendary' },
  ],
  ice: [
    { w: 0.25, kind: 'coins', min: 500, max: 1200 }, { w: 0.05, kind: 'gems', min: 10, max: 25 },
    { w: 0.48, kind: 'item', rarity: 'rare' }, { w: 0.18, kind: 'item', rarity: 'epic' }, { w: 0.04, kind: 'item', rarity: 'legendary' },
  ],
  santa: [{ w: 0.10, kind: 'gems', min: 40, max: 80 }, { w: 0.62, kind: 'item', rarity: 'epic' }, { w: 0.28, kind: 'item', rarity: 'legendary' }],
};
/** raw drop table (tests / balancing) */
export function dropTable(id: CaseId): readonly DropSlot[] { return DROPS[id] ?? DROPS.snow; }

const ITEM_LABEL: Record<Rarity, Loc> = {
  common: { ru: 'Обычный предмет', en: 'Common item' },
  rare: { ru: 'Редкий предмет', en: 'Rare item' },
  epic: { ru: 'Эпический предмет', en: 'Epic item' },
  legendary: { ru: 'Легендарный предмет', en: 'Legendary item' },
};
/** drop table for the "chances" popup (chance 0..1) */
export function caseOdds(id: CaseId): { label: Loc; rarity: Rarity | null; chance: number }[] {
  return dropTable(id).map((s) => {
    if (s.kind === 'item') return { label: ITEM_LABEL[s.rarity], rarity: s.rarity, chance: s.w };
    const a = s.min, b = s.max;
    const label = s.kind === 'coins' ? { ru: `${a}–${b} монет`, en: `${a}–${b} coins` } : { ru: `${a}–${b} кристаллов`, en: `${a}–${b} gems` };
    return { label, rarity: null, chance: s.w };
  });
}

/** skins and balls of a rarity that case `id` can drop */
export function casePool(id: CaseId, rarity: Rarity): { kind: 'skin' | 'ball'; def: ItemDef }[] {
  const out: { kind: 'skin' | 'ball'; def: ItemDef }[] = [];
  for (const kind of ['skin', 'ball'] as const) {
    for (const def of itemsOf(kind)) {
      if (def.rarity === rarity && def.src !== 'default' && (!def.cases || def.cases.includes(id))) out.push({ kind, def });
    }
  }
  return out;
}

function roll(id: CaseId, save: Save | null, rnd: () => number): Drop {
  const pity = !!save && id !== 'snow' && save.pity >= PITY - 1;
  const slot: DropSlot = pity ? { w: 1, kind: 'item', rarity: 'legendary' } : weighted(rnd, dropTable(id));
  if (slot.kind !== 'item') {
    const n = randInt(rnd, slot.min, slot.max);
    return { kind: slot.kind, n: slot.kind === 'coins' ? Math.round(n / 10) * 10 : n };
  }
  const pool = casePool(id, slot.rarity);
  if (!pool.length) return { kind: 'coins', n: DUP_COMP[slot.rarity] };
  // not-owned items are preferred: 70% of the time the pick is among the missing ones, else among all
  const fresh = save ? pool.filter((p) => !ownsItem(save, p.kind, p.def.id)) : pool;
  const from = fresh.length && rnd() < 0.7 ? fresh : pool;
  const it = from[Math.min(from.length - 1, Math.floor(rnd() * from.length))];
  const dup = !!save && ownsItem(save, it.kind, it.def.id);
  return { kind: it.kind, id: it.def.id, rarity: slot.rarity, dup, comp: dup ? DUP_COMP[slot.rarity] : 0 };
}
/** roll a case (pure: does not change the save; pity counted from save.pity) */
export function rollCase(id: CaseId, save: Save, rnd: () => number = Math.random): Drop { return roll(id, save, rnd); }
/** random items for the roulette strip around the real drop */
export function rouletteFiller(id: CaseId, n: number, rnd: () => number = Math.random): Drop[] {
  const out: Drop[] = [];
  for (let i = 0; i < n; i++) out.push(roll(id, null, rnd));
  return out;
}
export type ItemDrop = Extract<Drop, { id: string }>;
/** drop of a skin / ball (type guard: Drop's kinds are unions, so plain kind checks don't narrow) */
export function isItemDrop(d: Drop): d is ItemDrop { return d.kind === 'skin' || d.kind === 'ball'; }
/** apply a drop to the save (an already owned item → DUP_COMP coins; pity is updated by openCaseResult) */
export function grantDrop(save: Save, d: Drop): void {
  if (isItemDrop(d)) {
    if (ownsItem(save, d.kind, d.id)) earnSafe(save, 'coins', DUP_COMP[d.rarity] ?? 0);
    else (d.kind === 'skin' ? save.skins : save.balls).push(d.id);
  } else earnSafe(save, d.kind, d.n);
}
/** roll + grant + pity update in one call (payment — gems / key / ad — is the caller's job) */
export function openCaseResult(save: Save, id: CaseId, rnd: () => number = Math.random): Drop {
  const d = rollCase(id, save, rnd);
  grantDrop(save, d);
  if (id !== 'snow') save.pity = isItemDrop(d) && d.rarity === 'legendary' ? 0 : save.pity + 1;
  return d;
}
/** apply rewards; returns what was actually granted (owned items → dup with comp coins).
 * Keys and noAds are applied too but not listed (Drop has no variant for them; show the Reward[] for those). */
export function grantRewards(save: Save, rewards: Reward[]): Drop[] {
  const out: Drop[] = [];
  for (const r of rewards) {
    if (r.kind === 'coins' || r.kind === 'gems') { earnSafe(save, r.kind, r.n); out.push({ kind: r.kind, n: r.n }); }
    else if (r.kind === 'key') save.keys[r.id] = (save.keys[r.id] || 0) + Math.max(0, Math.floor(r.n));
    else if (r.kind === 'noAds') save.noAds = true;
    else {
      const def = itemDef(r.kind, r.id);
      if (def.id !== r.id) continue;
      const dup = ownsItem(save, r.kind, r.id);
      const d: Drop = { kind: r.kind, id: r.id, rarity: def.rarity, dup, comp: dup ? DUP_COMP[def.rarity] : 0 };
      grantDrop(save, d);
      out.push(d);
    }
  }
  return out;
}
function earnSafe(save: Save, cur: Currency, n: number) {
  if (Number.isFinite(n) && n > 0) save[cur] = (save[cur] || 0) + Math.floor(n);
}

// ---------------------------------------------------------------- leagues & race rewards
export interface League { name: Loc; min: number; gems: number; color: string }
export const LEAGUES: League[] = [
  { name: { ru: 'Снежинка', en: 'Snowflake' }, min: 0, gems: 0, color: '#bfe3ff' },
  { name: { ru: 'Сосулька', en: 'Icicle' }, min: 150, gems: 5, color: '#5cc8ff' },
  { name: { ru: 'Метель', en: 'Snowstorm' }, min: 400, gems: 10, color: '#8fa2ff' },
  { name: { ru: 'Вьюга', en: 'Blizzard' }, min: 800, gems: 15, color: '#b070ff' },
  { name: { ru: 'Северное сияние', en: 'Northern Lights' }, min: 1400, gems: 20, color: '#38e0a0' },
  { name: { ru: 'Ледяной король', en: 'Ice King' }, min: 2200, gems: 30, color: '#ffcf3a' },
  { name: { ru: 'Дед Мороз', en: 'Santa Claus' }, min: 3200, gems: 40, color: '#ff4a4a' },
];
export function leagueOf(trophies: number): number {
  let i = 0;
  while (i + 1 < LEAGUES.length && trophies >= LEAGUES[i + 1].min) i++;
  return i;
}
const TROPHIES = [30, 18, 8, -6, -12];
export function trophyDelta(place: number): number { return TROPHIES[place - 1] ?? TROPHIES[4]; }
const PLACE_K = [1, 0.7, 0.5, 0.3, 0.2];
/** race reward: (placeBase + collected) * mult, placeBase = (25 + 4 * level) * [1, .7, .5, .3, .2][place - 1] */
export function raceCoins(place: number, level: number, collected: number, mult: number): number {
  const base = (25 + 4 * Math.max(0, level || 0)) * (PLACE_K[place - 1] ?? PLACE_K[4]);
  const m = Number.isFinite(mult) && mult > 1 ? mult : 1;
  return Math.round((base + Math.max(0, collected || 0)) * m);
}
export interface RaceOutcome { passed: boolean; coins: number; trophies: number; gems: number; leagueUp: number }
/**
 * Apply a finished race to the save: coins, trophies (never < 0), gems picked up + league-up gems, counters,
 * level / tries / lossStreak (places 1–3 pass the level). Returns the numbers for the results screen.
 */
export function settleRace(save: Save, place: number, collected: number, mult: number, gemsPicked = 0): RaceOutcome {
  const passed = place >= 1 && place <= 3;
  const c = raceCoins(place, save.level, collected, mult);
  const before = save.trophies;
  save.trophies = Math.max(0, before + trophyDelta(place));
  earnSafe(save, 'coins', c);
  let g = Math.max(0, Math.floor(gemsPicked || 0)), leagueUp = -1;
  const lg = leagueOf(save.trophies);
  if (lg > save.league) {
    for (let i = save.league + 1; i <= lg; i++) g += LEAGUES[i].gems;
    save.league = leagueUp = lg;
  }
  earnSafe(save, 'gems', g);
  save.races++;
  if (place === 1) save.wins++;
  if (passed) { save.level++; save.tries = 0; save.lossStreak = 0; } else { save.tries++; save.lossStreak++; }
  return { passed, coins: c, trophies: save.trophies - before, gems: g, leagueUp };
}

// ---------------------------------------------------------------- IAP products
export interface Product {
  id: string;
  title: Loc;
  rewards: Reward[];
  /** shown when the portal catalog has no price (local test mode only) */
  fallbackPrice: string;
  consumable: boolean;
  /** "+20%" style bonus label */
  bonus?: number;
  badge?: Loc;
  /** one purchase per player: recorded in save.bought, the shop / offer hides it afterwards */
  once?: boolean;
}
export const PRODUCTS: Product[] = [
  { id: 'gems_60', title: { ru: '60 кристаллов', en: '60 gems' }, rewards: [{ kind: 'gems', n: 60 }], fallbackPrice: '$0.99', consumable: true },
  { id: 'gems_330', title: { ru: '330 кристаллов', en: '330 gems' }, rewards: [{ kind: 'gems', n: 330 }], fallbackPrice: '$4.99', consumable: true, bonus: 10 },
  {
    id: 'gems_700', title: { ru: '700 кристаллов', en: '700 gems' }, rewards: [{ kind: 'gems', n: 700 }], fallbackPrice: '$9.99', consumable: true,
    bonus: 20, badge: { ru: 'Хит', en: 'Bestseller' },
  },
  { id: 'gems_1500', title: { ru: '1500 кристаллов', en: '1500 gems' }, rewards: [{ kind: 'gems', n: 1500 }], fallbackPrice: '$19.99', consumable: true, bonus: 30 },
  {
    id: 'gems_4000', title: { ru: '4000 кристаллов', en: '4000 gems' }, rewards: [{ kind: 'gems', n: 4000 }], fallbackPrice: '$49.99', consumable: true,
    bonus: 50, badge: { ru: 'Выгодно', en: 'Best value' },
  },
  {
    id: 'starter_pack', title: { ru: 'Стартовый набор', en: 'Starter Pack' }, fallbackPrice: '$1.99', consumable: true, once: true,
    rewards: [{ kind: 'gems', n: 300 }, { kind: 'skin', id: 'iceknight' }, { kind: 'coins', n: 3000 }],
  },
  {
    id: 'newyear_pack', title: { ru: 'Новогодний мега-набор', en: 'New Year Mega Pack' }, fallbackPrice: '$9.99', consumable: true, once: true,
    rewards: [{ kind: 'skin', id: 'santa' }, { kind: 'ball', id: 'gold' }, { kind: 'gems', n: 800 }],
  },
  { id: 'no_ads', title: { ru: 'Без рекламы', en: 'No Ads' }, rewards: [{ kind: 'noAds' }], fallbackPrice: '$4.99', consumable: false, once: true },
];
/** gem packs in shop order */
export const GEM_PRODUCTS = ['gems_60', 'gems_330', 'gems_700', 'gems_1500', 'gems_4000'];
export function product(id: string): Product | undefined { return PRODUCTS.find((p) => p.id === id); }
/** gems → coins packs in the shop */
export const COIN_PACKS: { id: string; gems: number; coins: number }[] = [
  { id: 'coins_1000', gems: 20, coins: 1000 },
  { id: 'coins_5500', gems: 90, coins: 5500 },
  { id: 'coins_17000', gems: 250, coins: 17000 },
];

// ---------------------------------------------------------------- daily calendar
/** 7-day New Year calendar rewards (index = day % 7) */
export const DAILY: Reward[] = [
  { kind: 'coins', n: 300 },
  { kind: 'key', id: 'snow', n: 1 },
  { kind: 'gems', n: 5 },
  { kind: 'coins', n: 800 },
  { kind: 'key', id: 'ice', n: 1 },
  { kind: 'coins', n: 1500 },
  { kind: 'gems', n: 25 },
];
/** today's calendar cell (0..6) — the next one to claim */
export function dailyIndex(save: Save): number { return save.daily.day % DAILY.length; }
/** a gift can be claimed today (once per local calendar day; a missed day does not reset the loop) */
export function canClaimDaily(save: Save, now: number): boolean { return save.daily.last !== dayKey(now); }
/** claim today's gift: applies it and returns the reward, or null if already claimed today */
export function claimDaily(save: Save, now: number): Reward | null {
  if (!canClaimDaily(save, now)) return null;
  const r = DAILY[dailyIndex(save)];
  grantRewards(save, [r]);
  save.daily = { day: save.daily.day + 1, last: dayKey(now) };
  return r;
}
