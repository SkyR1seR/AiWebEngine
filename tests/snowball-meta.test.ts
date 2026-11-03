import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Playgama, PlaygamaProduct } from '../src/playgama/index';
import type { CaseId, Ctx, Drop, Rarity, Save } from '../games/snowball-rush/types';
import { BALL_IDS, SKIN_IDS } from '../games/snowball-rush/types';
import { setLang } from '../games/snowball-rush/i18n';
import { rng } from '../games/snowball-rush/util';
import {
  BALLS, CASES, COIN_PACKS, DAILY, DUP_COMP, LEAGUES, PITY, PRODUCTS, SKINS, UPGRADES, adCoins, buyItem, canClaimDaily, caseOdds,
  casePool, claimDaily, dropTable, grantDrop, grantRewards, isItemDrop, itemDef, leagueOf, openCaseResult, product, raceCoins,
  racerStats, rollCase, rouletteFiller, settleRace, trophyDelta, upgradeCost, upgradeLabel,
} from '../games/snowball-rush/catalog';
import { canAfford, defaultSave, earn, normalize, playerName, spend } from '../games/snowball-rush/save';
import {
  ADS_FROM_LEVEL, FEATURES, UNLOCK_LEVEL, adsAllowed, claimSkinGift, freebieAvailable, isUnlocked, lockLabel, markAnnounced, pendingUnlocks,
} from '../games/snowball-rush/unlocks';
import {
  COMEBACK_MS, HOT_MS, STARTER_MS, activeOffers, buyGemOffer, markBought, newYearEnd, offerById, resetOfferSession, triggerComeback,
} from '../games/snowball-rush/offers';
import { Payments, buyProduct, restorePurchases } from '../games/snowball-rush/payments';

const T0 = new Date(2026, 10, 3, 12, 0, 0).getTime(); // Nov 3 2026, local noon
const H = 3600e3;

/** a save that passed `level` levels */
function saveAt(level: number, now = T0): Save {
  const s = defaultSave(now);
  s.level = level;
  return s;
}
type Cat = 'coins' | 'gems' | Rarity;
const cat = (d: Drop): Cat => (isItemDrop(d) ? d.rarity : d.kind);

beforeEach(() => setLang('en'));

describe('catalog: items', () => {
  it('lists every skin and ball id once, defaults first', () => {
    expect(SKINS.map((s) => s.id)).toEqual([...SKIN_IDS]);
    expect(BALLS.map((s) => s.id)).toEqual([...BALL_IDS]);
    expect(itemDef('skin', 'noob').src).toBe('default');
    expect(itemDef('ball', 'snow').src).toBe('default');
    expect(itemDef('skin', 'nope').id).toBe('noob');
    for (const d of [...SKINS, ...BALLS]) expect(d.name.ru && d.name.en).toBeTruthy();
  });
  it('buys items for their direct price only', () => {
    const s = defaultSave(T0);
    s.coins = 2000;
    expect(buyItem(s, 'skin', 'gingerbread')).toBe(false); // cases only
    expect(buyItem(s, 'skin', 'hockey')).toBe(false); // 3000 coins
    expect(buyItem(s, 'skin', 'skier')).toBe(true);
    expect(s.coins).toBe(500);
    expect(s.skin).toBe('skier');
    expect(buyItem(s, 'skin', 'skier')).toBe(false); // owned
  });
});

describe('catalog: cases', () => {
  it('drop tables sum to 1', () => {
    for (const c of CASES) {
      const sum = caseOdds(c.id).reduce((a, o) => a + o.chance, 0);
      expect(sum).toBeCloseTo(1, 9);
      expect(dropTable(c.id).reduce((a, o) => a + o.w, 0)).toBeCloseTo(1, 9);
    }
  });
  it('pools exclude defaults and offer exclusives; santa only from the santa case', () => {
    for (const c of CASES) {
      for (const r of ['common', 'rare', 'epic', 'legendary'] as Rarity[]) {
        const ids = casePool(c.id, r).map((p) => p.def.id);
        expect(ids).not.toContain('noob');
        expect(ids).not.toContain('snow');
        expect(ids).not.toContain('iceknight');
        if (r === 'legendary') expect(ids.includes('santa')).toBe(c.id === 'santa');
        if (r === 'legendary') expect(ids).toContain('gold');
      }
    }
  });
  it('rollCase follows the drop table (seeded Monte-Carlo)', () => {
    const N = 100000;
    for (const id of ['snow', 'ice', 'santa'] as CaseId[]) {
      const s = defaultSave(T0), r = rng(1234 + id.length), n: Record<string, number> = {};
      for (let i = 0; i < N; i++) {
        const d = rollCase(id, s, r);
        n[cat(d)] = (n[cat(d)] ?? 0) + 1;
        if (d.kind === 'coins') {
          expect(d.n % 10).toBe(0);
          const slot = dropTable(id).find((x) => x.kind === 'coins')!;
          if (slot.kind === 'coins') { expect(d.n).toBeGreaterThanOrEqual(slot.min); expect(d.n).toBeLessThanOrEqual(slot.max); }
        }
      }
      expect(s.pity).toBe(0); // pure
      for (const slot of dropTable(id)) {
        const k = slot.kind === 'item' ? slot.rarity : slot.kind;
        const p = (n[k] ?? 0) / N, sd = Math.sqrt((slot.w * (1 - slot.w)) / N);
        expect(Math.abs(p - slot.w)).toBeLessThan(6 * sd + 1e-4);
      }
    }
  });
  it('prefers items the player does not own', () => {
    const s = defaultSave(T0);
    const pool = casePool('ice', 'rare');
    const owned = pool.slice(0, 3); // 3 of 5 owned
    for (const p of owned) (p.kind === 'skin' ? s.skins : s.balls).push(p.def.id);
    const r = rng(7);
    let items = 0, fresh = 0;
    for (let i = 0; i < 40000; i++) {
      const d = rollCase('ice', s, r);
      if (isItemDrop(d) && d.rarity === 'rare') { items++; if (!d.dup) fresh++; }
    }
    // 70% among the missing + 30% uniform over all (2/5 missing) → 0.82
    expect(fresh / items).toBeGreaterThan(0.79);
    expect(fresh / items).toBeLessThan(0.85);
  });
  it('pity guarantees a legendary on the 25th ice/santa open', () => {
    const s = defaultSave(T0), zero = () => 0; // rnd 0 always picks the first slot (coins on ice)
    for (let i = 0; i < PITY - 1; i++) expect(openCaseResult(s, 'ice', zero).kind).toBe('coins');
    expect(s.pity).toBe(PITY - 1);
    const d = openCaseResult(s, 'ice', zero);
    expect(isItemDrop(d) && d.rarity).toBe('legendary');
    expect(s.pity).toBe(0);
    // snow cases neither count nor use pity
    s.pity = 30;
    expect(rollCase('snow', s, zero).kind).toBe('coins');
    openCaseResult(s, 'snow', zero);
    expect(s.pity).toBe(30);
    expect(isItemDrop(rollCase('santa', s, zero)) && (rollCase('santa', s, zero) as { rarity: Rarity }).rarity).toBe('legendary');
  });
  it('compensates duplicates with coins', () => {
    const s = defaultSave(T0);
    s.skins.push('penguin');
    grantDrop(s, { kind: 'skin', id: 'penguin', rarity: 'rare', dup: true, comp: DUP_COMP.rare });
    expect(s.coins).toBe(400);
    expect(s.skins.filter((x) => x === 'penguin').length).toBe(1);
    const drops = grantRewards(s, [{ kind: 'skin', id: 'penguin' }, { kind: 'ball', id: 'gold' }, { kind: 'gems', n: 5 }, { kind: 'key', id: 'ice', n: 2 }]);
    expect(drops).toEqual([
      { kind: 'skin', id: 'penguin', rarity: 'rare', dup: true, comp: 400 },
      { kind: 'ball', id: 'gold', rarity: 'legendary', dup: false, comp: 0 },
      { kind: 'gems', n: 5 },
    ]);
    expect(s.coins).toBe(800);
    expect(s.balls).toContain('gold');
    expect(s.keys.ice).toBe(2);
    // everything of a rarity owned → the roll is a dup with comp
    for (const p of casePool('santa', 'legendary')) (p.kind === 'skin' ? s.skins : s.balls).push(p.def.id);
    const d = rollCase('santa', { ...s, pity: 99 }, rng(3));
    expect(isItemDrop(d) && d.dup && d.comp).toBe(DUP_COMP.legendary);
  });
  it('roulette filler returns n drops without dups', () => {
    const f = rouletteFiller('santa', 40, rng(9));
    expect(f.length).toBe(40);
    for (const d of f) {
      expect(['gems', 'epic', 'legendary']).toContain(cat(d));
      if (isItemDrop(d)) expect(d.dup).toBe(false);
    }
  });
});

describe('catalog: upgrades, leagues, rewards', () => {
  it('upgrade costs grow and are rounded to 5', () => {
    for (const u of UPGRADES) {
      let prev = 0;
      for (let l = 0; l < u.max; l++) {
        const c = upgradeCost(u.id, l);
        expect(c % 5).toBe(0);
        expect(c).toBeGreaterThan(prev);
        prev = c;
      }
      expect(upgradeCost(u.id, u.max)).toBe(Infinity);
    }
    expect(upgradeCost('speed', 0)).toBe(60);
    expect(upgradeCost('speed', 1)).toBe(75);
  });
  it('stats are monotonic and match the design at max level', () => {
    const zero = { speed: 0, grip: 0, armor: 0, start: 0, magnet: 0 };
    expect(racerStats(zero)).toEqual({ speedMul: 1, growMul: 1, meltMul: 1, startSize: 3, magnet: 0.9, shields: 0 });
    let prev = racerStats(zero);
    for (let l = 1; l <= 20; l++) {
      const s = racerStats({ speed: l, grip: l, armor: l, start: l, magnet: l });
      expect(s.speedMul).toBeGreaterThan(prev.speedMul);
      expect(s.growMul).toBeGreaterThan(prev.growMul);
      expect(s.meltMul).toBeLessThanOrEqual(prev.meltMul);
      expect(s.startSize).toBeGreaterThanOrEqual(prev.startSize);
      expect(s.magnet).toBeGreaterThanOrEqual(prev.magnet);
      expect(s.shields).toBeGreaterThanOrEqual(prev.shields);
      prev = s;
    }
    expect(prev.speedMul).toBeCloseTo(1.5);
    expect(prev.growMul).toBeCloseTo(2.2);
    expect(prev.meltMul).toBeCloseTo(0.3);
    expect(prev.startSize).toBe(18); // start max 15
    expect(prev.magnet).toBeCloseTo(2.7); // magnet max 15
    expect(prev.shields).toBe(3);
    expect(racerStats({ ...zero, armor: 5 }).shields).toBe(1);
    expect(racerStats({ ...zero, armor: 12 }).shields).toBe(2);
  });
  it('labels upgrades as whole phrases', () => {
    expect(upgradeLabel('speed', 3)).toBe('+7.5% speed');
    expect(upgradeLabel('grip', 2)).toBe('+12% snowball growth');
    expect(upgradeLabel('armor', 2)).toBe('−7% melting');
    expect(upgradeLabel('armor', 12)).toBe('−42% melting, shields: 2');
    expect(upgradeLabel('start', 4)).toBe('Starting snowball: 7');
    expect(upgradeLabel('magnet', 15)).toBe('+200% pickup radius');
    setLang('ru');
    expect(upgradeLabel('speed', 3)).toBe('+7,5% к скорости');
  });
  it('race coins, trophies and leagues', () => {
    expect(raceCoins(1, 0, 0, 1)).toBe(25);
    expect(raceCoins(5, 0, 0, 1)).toBe(5);
    expect(raceCoins(1, 10, 20, 2)).toBe(170);
    for (let p = 1; p < 5; p++) expect(raceCoins(p, 5, 10, 1)).toBeGreaterThan(raceCoins(p + 1, 5, 10, 1));
    expect(raceCoins(2, 20, 0, 1)).toBeGreaterThan(raceCoins(2, 3, 0, 1));
    expect(raceCoins(1, 0, 0, NaN)).toBe(25);
    expect([1, 2, 3, 4, 5].map(trophyDelta)).toEqual([30, 18, 8, -6, -12]);
    expect(LEAGUES.length).toBe(7);
    expect(leagueOf(0)).toBe(0);
    expect(leagueOf(149)).toBe(0);
    expect(leagueOf(150)).toBe(1);
    expect(leagueOf(99999)).toBe(6);
    for (let i = 1; i < LEAGUES.length; i++) expect(LEAGUES[i].min).toBeGreaterThan(LEAGUES[i - 1].min);
  });
  it('settleRace applies a race to the save', () => {
    const s = defaultSave(T0);
    let r = settleRace(s, 5, 3, 1);
    expect(r).toMatchObject({ passed: false, trophies: 0, leagueUp: -1 });
    expect(s).toMatchObject({ level: 0, tries: 1, lossStreak: 1, trophies: 0, races: 1, wins: 0 });
    s.trophies = 140;
    r = settleRace(s, 1, 10, 2, 1);
    expect(r).toMatchObject({ passed: true, trophies: 30, leagueUp: 1, gems: 1 + LEAGUES[1].gems, coins: raceCoins(1, 0, 10, 2) });
    expect(s).toMatchObject({ level: 1, tries: 0, lossStreak: 0, league: 1, wins: 1, gems: 6 });
  });
  it('products, packs, daily', () => {
    expect(PRODUCTS.map((p) => p.id).sort()).toEqual(['gems_1500', 'gems_330', 'gems_4000', 'gems_60', 'gems_700', 'newyear_pack', 'no_ads', 'starter_pack']);
    expect(product('no_ads')!.consumable).toBe(false);
    expect(product('starter_pack')!.rewards).toContainEqual({ kind: 'skin', id: 'iceknight' });
    expect(COIN_PACKS.map((p) => [p.gems, p.coins])).toEqual([[20, 1000], [90, 5500], [250, 17000]]);
    expect(adCoins(0)).toBe(60);
    expect(adCoins(10)).toBe(160);
    expect(DAILY.length).toBe(7);
    const s = defaultSave(T0);
    expect(canClaimDaily(s, T0)).toBe(true);
    expect(claimDaily(s, T0)).toEqual({ kind: 'coins', n: 300 });
    expect(claimDaily(s, T0 + H)).toBeNull();
    expect(claimDaily(s, T0 + 24 * H)).toEqual({ kind: 'key', id: 'snow', n: 1 });
    expect(s.keys.snow).toBe(1);
    expect(s.coins).toBe(300);
  });
});

describe('save', () => {
  it('normalizes garbage to a valid default save', () => {
    const def = defaultSave(T0);
    for (const g of [null, undefined, 42, 'abc', [], true, '{"coins":5}']) {
      const s = normalize(g as never, T0);
      expect(s.skins).toEqual(['noob']);
      expect(s.skin).toBe('noob');
      expect(s.ball).toBe('snow');
      expect({ ...s, coins: 0 }).toEqual(def);
    }
    expect(normalize(def, T0)).toEqual(def);
    expect(normalize(JSON.parse(JSON.stringify(def)), T0)).toEqual(def);
  });
  it('repairs invalid fields', () => {
    const raw = {
      coins: NaN, gems: -5, level: 'x', trophies: Infinity, skins: ['bogus', 'penguin', 'penguin', 5], skin: 'bogus', balls: 'snow', ball: 'gold',
      up: { speed: 999, grip: -1, armor: 2.7, start: '3' }, keys: { snow: 1.7, ice: -2 }, seen: ['wall', 'xxx', 'wall'], announced: ['shop', 'foo'],
      unlockedAt: { shop: 'x', cases: 123, upgrades: T0 + 1e9 }, trial: { skin: 'nope' }, daily: 5, tokens: 'x', bought: ['starter', 7],
      freeCase: T0 + 1e12, name: '  Vasya  ', music: 0, muted: 'yes', first: -1, wins: 50, races: 3, extra: 1,
    };
    const s = normalize(raw as never, T0);
    expect(s).toMatchObject({ coins: 0, gems: 0, level: 0, skins: ['noob', 'penguin'], skin: 'noob', balls: ['snow'], ball: 'snow' });
    expect(s.trophies).toBe(0);
    expect(s.up).toEqual({ speed: 20, grip: 0, armor: 2, start: 3, magnet: 0 });
    expect(s.keys).toEqual({ snow: 1, ice: 0, santa: 0 });
    expect(s.seen).toEqual(['wall']);
    expect(s.announced).toEqual(['shop']);
    expect(s.unlockedAt).toEqual({ cases: 123, upgrades: T0 });
    expect(s.trial).toBeNull();
    expect(s.daily).toEqual({ day: 0, last: '' });
    expect(s.tokens).toEqual([]);
    expect(s.bought).toEqual(['starter']);
    expect(s.freeCase).toBeLessThanOrEqual(T0 + 4 * H);
    expect(s.name).toBe('Vasya');
    expect(s.music).toBe(true);
    expect(s.muted).toBe(false);
    expect(s.first).toBe(T0);
    expect(s.wins).toBe(3);
    expect('extra' in s).toBe(false);
  });
  it('loads old saves without the new fields', () => {
    const old = { v: 1, coins: 120, gems: 3, level: 5, skins: ['noob', 'skier'], skin: 'skier', up: { speed: 2 }, keys: { snow: 1 } };
    const s = normalize(old as never, T0);
    expect(s).toMatchObject({ coins: 120, gems: 3, level: 5, skin: 'skier', tries: 0, seen: [], announced: [], unlockedAt: {}, freebies: [], tokens: [] });
    expect(s.up).toEqual({ speed: 2, grip: 0, armor: 0, start: 0, magnet: 0 });
    expect(s.keys).toEqual({ snow: 1, ice: 0, santa: 0 });
    expect(s.trial).toBeNull();
    // a valid trial and tokens with repeats survive
    const t = normalize({ trial: { skin: 'yeti' }, tokens: ['gems_60', 'gems_60'] } as never, T0);
    expect(t.trial).toEqual({ skin: 'yeti' });
    expect(t.tokens).toEqual(['gems_60', 'gems_60']);
  });
  it('currency helpers and the player name', () => {
    const s = defaultSave(T0);
    earn(s, 'coins', 100);
    earn(s, 'coins', -50);
    earn(s, 'gems', NaN);
    expect(s.coins).toBe(100);
    expect(canAfford(s, 'coins', 100)).toBe(true);
    expect(canAfford(s, 'coins', 101)).toBe(false);
    expect(canAfford(s, 'coins', -1)).toBe(false);
    expect(spend(s, 'coins', 101)).toBe(false);
    expect(spend(s, 'coins', 40)).toBe(true);
    expect(s.coins).toBe(60);
    expect(playerName(s)).toBe('Noob');
    setLang('ru');
    expect(playerName(s)).toBe('Нубик');
    s.name = 'Kubik';
    expect(playerName(s)).toBe('Kubik');
  });
});

describe('unlocks', () => {
  it('opens features by level and announces each once', () => {
    const s = saveAt(0);
    expect(FEATURES.some((f) => isUnlocked(s, f))).toBe(false);
    expect(pendingUnlocks(s, T0)).toEqual([]);
    s.level = 1;
    expect(pendingUnlocks(s, T0)).toEqual(['upgrades']);
    expect(s.unlockedAt.upgrades).toBe(T0);
    expect(pendingUnlocks(s, T0 + 5)).toEqual(['upgrades']);
    expect(s.unlockedAt.upgrades).toBe(T0); // stamped only once
    markAnnounced(s, 'upgrades');
    markAnnounced(s, 'upgrades');
    expect(s.announced).toEqual(['upgrades']);
    expect(pendingUnlocks(s, T0)).toEqual([]);
    s.level = 10;
    expect(pendingUnlocks(s, T0 + 9)).toEqual(['wardrobe', 'daily', 'cases', 'shop']);
    expect(s.unlockedAt.shop).toBe(T0 + 9);
    for (const f of FEATURES) expect(isUnlocked(saveAt(UNLOCK_LEVEL[f]), f) && !isUnlocked(saveAt(UNLOCK_LEVEL[f] - 1), f)).toBe(true);
  });
  it('labels, ads and freebies', () => {
    expect(lockLabel('shop')).toBe(`Unlocks at level ${UNLOCK_LEVEL.shop + 1}`);
    expect(adsAllowed(saveAt(ADS_FROM_LEVEL - 1))).toBe(false);
    const s = saveAt(ADS_FROM_LEVEL);
    expect(adsAllowed(s)).toBe(true);
    s.noAds = true;
    expect(adsAllowed(s)).toBe(false);
    const w = saveAt(1);
    expect(freebieAvailable(w, 'upgrade')).toBe(true);
    expect(claimSkinGift(w)).toBeNull(); // wardrobe still locked
    w.level = 2;
    expect(claimSkinGift(w)).toMatchObject({ kind: 'skin', id: 'winter', dup: false });
    expect(w.skin).toBe('winter');
    expect(claimSkinGift(w)).toBeNull();
  });
});

describe('offers', () => {
  beforeEach(() => resetOfferSession());
  it('shows nothing while the shop is locked', () => {
    const s = saveAt(UNLOCK_LEVEL.shop - 1);
    s.lossStreak = 5;
    expect(triggerComeback(s, T0)).toBe(false);
    expect(activeOffers(s, T0)).toEqual([]);
    expect(activeOffers(s, T0, { comebackSince: T0 })).toEqual([]);
  });
  it('starter pack lives 48 h from the shop unlock and hides once bought', () => {
    const s = saveAt(4);
    pendingUnlocks(s, T0);
    const st = offerById(s, T0 + H, 'starter')!;
    expect(st.endsAt).toBe(T0 + STARTER_MS);
    expect(st.productId).toBe('starter_pack');
    expect(st.rewards).toEqual(product('starter_pack')!.rewards);
    expect(offerById(s, T0 + STARTER_MS - 1, 'starter')).toBeTruthy();
    expect(offerById(s, T0 + STARTER_MS, 'starter')).toBeUndefined();
    s.bought.push('starter_pack');
    expect(offerById(s, T0 + H, 'starter')).toBeUndefined();
  });
  it('hot deal is stable within a window and rotates across windows', () => {
    const s = saveAt(6), w = Math.floor(T0 / HOT_MS);
    const a = offerById(s, w * HOT_MS, 'hot')!, b = offerById(s, (w + 1) * HOT_MS - 1, 'hot')!;
    expect(a).toEqual(b);
    expect(a.id).toBe(`hot:${w}`);
    expect(a.endsAt).toBe((w + 1) * HOT_MS);
    let prev = '';
    for (let i = 0; i < 12; i++) {
      const o = offerById(s, (w + i) * HOT_MS + 1, 'hot')!;
      expect(o.gems! < o.oldGems!).toBe(true);
      expect(o.discount).toBeGreaterThanOrEqual(40);
      const key = JSON.stringify(o.rewards);
      expect(key).not.toBe(prev);
      prev = key;
      for (const r of o.rewards) if (r.kind === 'skin' || r.kind === 'ball') expect(itemDef(r.kind, r.id).src).not.toBe('offer');
    }
    // buying hides it until the next window
    s.gems = 10000;
    expect(buyGemOffer(s, a)).not.toBeNull();
    expect(s.gems).toBe(10000 - a.gems!);
    expect(offerById(s, w * HOT_MS + 5, 'hot')).toBeUndefined();
    expect(buyGemOffer(s, a)).toBeNull();
    expect(offerById(s, (w + 1) * HOT_MS, 'hot')).toBeTruthy();
  });
  it('hot item deals skip owned items', () => {
    const s = saveAt(6);
    for (const d of SKINS) s.skins.push(d.id);
    for (const d of BALLS) s.balls.push(d.id);
    const w = Math.floor(T0 / HOT_MS);
    for (let i = 0; i < 6; i++) {
      const o = offerById(s, (w + i) * HOT_MS, 'hot')!;
      expect(o.rewards.some((r) => r.kind === 'skin' || r.kind === 'ball')).toBe(false);
    }
  });
  it('New Year pack window', () => {
    const s = saveAt(6);
    const end = new Date(2027, 0, 15, 23, 59, 59, 999).getTime();
    expect(newYearEnd(new Date(2026, 11, 1, 0, 0, 1).getTime())).toBe(end);
    expect(newYearEnd(new Date(2027, 0, 15, 12).getTime())).toBe(end);
    expect(newYearEnd(new Date(2027, 0, 16, 0, 0, 1).getTime())).toBeNull();
    expect(newYearEnd(new Date(2026, 10, 30, 23).getTime())).toBeNull();
    const ny = offerById(s, new Date(2026, 11, 20).getTime(), 'newyear')!;
    expect(ny.endsAt).toBe(end);
    expect(ny.title.en).toBe('New Year Mega Pack');
    expect(ny.rewards).toEqual(product('newyear_pack')!.rewards);
    const winter = offerById(s, T0, 'newyear')!;
    expect(winter.title.en).toBe('Winter Pack');
    expect(winter.endsAt).toBeGreaterThan(T0);
    expect(winter.endsAt - T0).toBeLessThanOrEqual(72 * H);
    expect(offerById(s, winter.endsAt - 1, 'newyear')!.endsAt).toBe(winter.endsAt);
    s.bought.push('newyear_pack');
    expect(offerById(s, T0, 'newyear')).toBeUndefined();
  });
  it('comeback offer after 2 losses, once per session, 30 minutes', () => {
    const s = saveAt(6);
    s.lossStreak = 1;
    expect(triggerComeback(s, T0)).toBe(false);
    s.lossStreak = 2;
    expect(triggerComeback(s, T0)).toBe(true);
    expect(triggerComeback(s, T0 + 1)).toBe(false);
    const o = offerById(s, T0 + 60e3, 'comeback')!;
    expect(o).toMatchObject({ gems: 45, oldGems: 120, endsAt: T0 + COMEBACK_MS });
    expect(offerById(s, T0 + COMEBACK_MS, 'comeback')).toBeUndefined();
    s.gems = 50;
    expect(buyGemOffer(s, o)).toEqual([{ kind: 'coins', n: 2500 }]);
    expect(s.keys.ice).toBe(1);
    expect(s.gems).toBe(5);
    expect(offerById(s, T0 + 60e3, 'comeback')).toBeUndefined();
    // explicit flags work without the session
    resetOfferSession();
    expect(activeOffers(s, T0 + 60e3, { comebackSince: T0 + 1000 }).some((x) => x.kind === 'comeback')).toBe(true);
  });
  it('markBought prunes old hot entries', () => {
    const s = saveAt(6), w = Math.floor(T0 / HOT_MS);
    markBought(s, offerById(s, w * HOT_MS, 'hot')!);
    markBought(s, offerById(s, (w + 1) * HOT_MS, 'hot')!);
    expect(s.bought.filter((b) => b.startsWith('hot:'))).toEqual([`hot:${w + 1}`]);
  });
});

// ---------------------------------------------------------------- payments
function fakeSdk(o: { supported?: boolean; catalog?: PlaygamaProduct[]; purchase?: (id: string) => unknown; consume?: (id: string) => boolean; purchases?: string[] } = {}) {
  const calls = { purchase: [] as string[], consume: [] as string[] };
  const sdk = {
    get paymentsSupported() { return o.supported ?? true; },
    catalog: async () => o.catalog ?? [],
    purchase: async (id: string) => { calls.purchase.push(id); return o.purchase ? o.purchase(id) : { id }; },
    consume: async (id: string) => { calls.consume.push(id); return o.consume ? o.consume(id) : true; },
    purchases: async () => [...(o.purchases ?? [])],
  };
  return { sdk: sdk as unknown as Playgama, calls, o };
}
function fakeCtx(pay: Payments, save = saveAt(6)) {
  return { save, pay, persist: vi.fn(), refresh: vi.fn(), now: () => T0 } as unknown as Ctx & { persist: ReturnType<typeof vi.fn> };
}

describe('payments', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('supported: catalog prices, buy grants once and consumes', async () => {
    const f = fakeSdk({ catalog: [
      { id: 'gems_60', price: '49 YAN', priceValue: 49, currency: 'YAN' },
      { id: 'gems_330', price: '', priceValue: 2.99, currency: 'USD' },
    ] });
    const pay = await Payments.init(f.sdk);
    expect(pay.available).toBe(true);
    expect(pay.test).toBe(false);
    expect(pay.price('gems_60').text).toBe('49 YAN');
    expect(pay.price('gems_330').text).toBe('2.99 USD');
    expect(pay.price('gems_700').text).toBe('');
    const ctx = fakeCtx(pay);
    const drops = await buyProduct(ctx, 'gems_60');
    expect(drops).toEqual([{ kind: 'gems', n: 60 }]);
    expect(ctx.save.gems).toBe(60);
    expect(f.calls.purchase).toEqual(['gems_60']);
    expect(f.calls.consume).toEqual(['gems_60']);
    expect(ctx.save.tokens).toEqual([]);
    expect(ctx.persist).toHaveBeenCalled();
    // permanent product: never consumed, sets noAds, can't be bought twice
    expect(await buyProduct(ctx, 'no_ads')).toEqual([]);
    expect(ctx.save.noAds).toBe(true);
    expect(f.calls.consume).toEqual(['gems_60']);
    expect(await buyProduct(ctx, 'no_ads')).toBeNull();
    // one-time pack
    expect(await buyProduct(ctx, 'starter_pack')).not.toBeNull();
    expect(ctx.save.skins).toContain('iceknight');
    expect(ctx.save.bought).toContain('starter_pack');
    expect(await buyProduct(ctx, 'starter_pack')).toBeNull();
    expect(await buyProduct(ctx, 'unknown')).toBeNull();
  });
  it('unsupported without a local host: unavailable', async () => {
    const f = fakeSdk({ supported: false });
    const pay = await Payments.init(f.sdk);
    expect(pay.available).toBe(false);
    expect(await pay.buy('gems_60', () => { throw new Error('no'); })).toBe(false);
    expect(await buyProduct(fakeCtx(pay), 'gems_60')).toBeNull();
    expect(await pay.pending()).toEqual([]);
    expect(f.calls.purchase).toEqual([]);
  });
  it('unsupported on localhost: test mode with fallback prices', async () => {
    vi.stubGlobal('location', { hostname: 'localhost', search: '' });
    const f = fakeSdk({ supported: false });
    const pay = await Payments.init(f.sdk);
    expect(pay.available && pay.test).toBe(true);
    expect(pay.price('gems_60').text).toBe('$0.99');
    const ctx = fakeCtx(pay);
    const t = Date.now();
    expect(await buyProduct(ctx, 'gems_330')).toEqual([{ kind: 'gems', n: 330 }]);
    expect(Date.now() - t).toBeGreaterThanOrEqual(250);
    expect(ctx.save.tokens).toEqual([]);
    expect(f.calls.purchase).toEqual([]);
    vi.stubGlobal('location', { hostname: 'example.com', search: '?testpay=1' });
    expect((await Payments.init(f.sdk)).test).toBe(true);
    vi.stubGlobal('location', { hostname: 'example.com', search: '' });
    expect((await Payments.init(f.sdk)).available).toBe(false);
  });
  it('cancelled purchase grants nothing', async () => {
    const f = fakeSdk({ purchase: () => null });
    const pay = await Payments.init(f.sdk);
    const grant = vi.fn();
    expect(await pay.buy('gems_60', grant)).toBe(false);
    expect(grant).not.toHaveBeenCalled();
    const ctx = fakeCtx(pay);
    expect(await buyProduct(ctx, 'gems_60')).toBeNull();
    expect(ctx.save.gems).toBe(0);
    expect(f.calls.consume).toEqual([]);
  });
  it('restore: grants unprocessed purchases once even when consume keeps failing', async () => {
    let consumeOk = false;
    const f = fakeSdk({ consume: () => consumeOk, purchases: ['gems_330', 'no_ads', 'bogus'] });
    const pay = await Payments.init(f.sdk);
    const ctx = fakeCtx(pay);
    await restorePurchases(ctx);
    expect(ctx.save.gems).toBe(330);
    expect(ctx.save.noAds).toBe(true);
    expect(ctx.save.tokens).toEqual(['gems_330']);
    expect(f.calls.consume).toEqual(['gems_330']); // no_ads is never consumed
    await restorePurchases(ctx); // consume fails again: no second grant
    expect(ctx.save.gems).toBe(330);
    consumeOk = true;
    await restorePurchases(ctx);
    expect(ctx.save.gems).toBe(330);
    expect(ctx.save.tokens).toEqual([]);
    f.o.purchases = ['no_ads'];
    await restorePurchases(ctx);
    expect(ctx.save.gems).toBe(330);
  });
  it('a purchase whose consume failed is consumed (not granted) at the next launch', async () => {
    let consumeOk = false;
    const f = fakeSdk({ consume: () => consumeOk });
    const pay = await Payments.init(f.sdk);
    const ctx = fakeCtx(pay);
    expect(await buyProduct(ctx, 'gems_60')).toEqual([{ kind: 'gems', n: 60 }]);
    expect(ctx.save.tokens).toEqual(['gems_60']);
    // next launch: the platform still lists it
    const save2 = normalize(JSON.parse(JSON.stringify(ctx.save)), T0);
    f.o.purchases = ['gems_60'];
    consumeOk = true;
    const ctx2 = fakeCtx(await Payments.init(f.sdk), save2);
    await restorePurchases(ctx2);
    expect(save2.gems).toBe(60);
    expect(save2.tokens).toEqual([]);
    // stale marks (no pending purchase) are dropped
    save2.tokens = ['gems_60'];
    f.o.purchases = [];
    await restorePurchases(ctx2);
    expect(save2.tokens).toEqual([]);
    expect(save2.gems).toBe(60);
  });
  it('never throws', async () => {
    const bad = { get paymentsSupported(): boolean { throw new Error('x'); } } as unknown as Playgama;
    const pay = await Payments.init(bad);
    expect(pay.available).toBe(false);
    const f = fakeSdk({ purchase: () => { throw new Error('boom'); } });
    const ctx = fakeCtx(await Payments.init(f.sdk));
    expect(await buyProduct(ctx, 'gems_60')).toBeNull();
    const broken = { pay: { activePurchases: async () => { throw new Error('x'); } }, save: saveAt(1), persist() {}, refresh() {} } as unknown as Ctx;
    await expect(restorePurchases(broken)).resolves.toBeUndefined();
    // a portal that never answers: restore gives up after a while and keeps the marks
    vi.useFakeTimers();
    try {
      const hang = fakeSdk();
      (hang.sdk as unknown as { purchases: () => Promise<string[]> }).purchases = () => new Promise(() => {});
      const pay2 = await Payments.init(hang.sdk);
      const c = fakeCtx(pay2);
      c.save.tokens = ['gems_60'];
      const done = restorePurchases(c);
      await vi.advanceTimersByTimeAsync(6000);
      await done;
      expect(c.save.tokens).toEqual(['gems_60']);
      const pend = pay2.pending();
      await vi.advanceTimersByTimeAsync(6000);
      expect(await pend).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});
