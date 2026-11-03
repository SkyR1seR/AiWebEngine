// Save data (owner: meta): defaults, migration/normalization, currency helpers.
// normalize() accepts anything (cloud JSON of an older version, a corrupted localStorage value, hand-edited data) and
// always returns a complete, valid Save: unknown ids are dropped, numbers are finite and in range, defaults owned.
import type { CaseId, Currency, Feature, ObstacleKind, Save, UpgradeId } from './types';
import { BALL_IDS, SKIN_IDS } from './types';
import { tr } from './i18n';
import { AD_COINS_MS, CASES, DEFAULT_BALL, DEFAULT_SKIN, FREE_UP_MS, LEAGUES, UPGRADES } from './catalog';
import { FEATURES } from './unlocks';

export const SAVE_VERSION = 1;
const KINDS: readonly ObstacleKind[] = ['wall', 'spikes', 'fire', 'hammer', 'pusher', 'plow', 'icicle', 'gap', 'bonus'];
const MAX_NUM = 1e9;

export function defaultSave(now: number): Save {
  return {
    v: SAVE_VERSION, name: '', coins: 0, gems: 0, level: 0, trophies: 0, league: 0,
    up: { speed: 0, grip: 0, armor: 0, start: 0, magnet: 0 },
    skins: [DEFAULT_SKIN], skin: DEFAULT_SKIN, balls: [DEFAULT_BALL], ball: DEFAULT_BALL,
    keys: { snow: 0, ice: 0, santa: 0 },
    muted: false, music: true, first: now,
    daily: { day: 0, last: '' },
    freeCase: 0, adCoins: { day: '', n: 0, next: 0 }, freeUp: 0,
    noAds: false, bought: [], tokens: [],
    races: 0, wins: 0, lossStreak: 0, tut: 0, pity: 0, trial: null,
    tries: 0, seen: [], announced: [], unlockedAt: {}, freebies: [],
  };
}

/**
 * Version migrations: MIGRATIONS[v] upgrades raw data of version v to v + 1 (before normalization). Add an entry and bump
 * SAVE_VERSION when a field changes meaning; new fields with defaults need no migration (normalize fills them).
 */
const MIGRATIONS: Record<number, (o: Record<string, unknown>) => void> = {};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
/** finite integer in [min, max], else `def` */
function int(v: unknown, def: number, min = 0, max = MAX_NUM): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : def;
}
/** array of unique strings accepted by `ok` */
function ids<T extends string>(v: unknown, ok: (s: string) => boolean, limit = 200): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const s of v) if (typeof s === 'string' && ok(s) && !out.includes(s as T) && out.length < limit) out.push(s as T);
  return out;
}
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown) => (typeof v === 'string' && DAY_RE.test(v) ? v : '');

/** fill missing/invalid fields of loaded data (cloud or localStorage) */
export function normalize(raw: Partial<Save> | null | undefined, now: number): Save {
  const s = defaultSave(now);
  let o: Obj = isObj(raw) ? { ...(raw as Obj) } : {};
  if (typeof (raw as unknown) === 'string') try { const p = JSON.parse(raw as unknown as string); if (isObj(p)) o = p; } catch { /* garbage */ }
  // migrations from older versions (data without `v` is treated as version 1, the first released format)
  for (let v = int(o.v, 1, 0, SAVE_VERSION); v < SAVE_VERSION; v++) MIGRATIONS[v]?.(o);

  s.name = typeof o.name === 'string' ? o.name.trim().slice(0, 20) : '';
  s.coins = int(o.coins, 0);
  s.gems = int(o.gems, 0);
  s.level = int(o.level, 0, 0, 100000);
  s.trophies = int(o.trophies, 0);
  s.league = int(o.league, 0, 0, LEAGUES.length - 1);
  const up = isObj(o.up) ? o.up : {};
  for (const u of UPGRADES) s.up[u.id as UpgradeId] = int(up[u.id], 0, 0, u.max);

  s.skins = ids(o.skins, (x) => (SKIN_IDS as readonly string[]).includes(x));
  if (!s.skins.includes(DEFAULT_SKIN)) s.skins.unshift(DEFAULT_SKIN);
  s.skin = typeof o.skin === 'string' && s.skins.includes(o.skin) ? o.skin : DEFAULT_SKIN;
  s.balls = ids(o.balls, (x) => (BALL_IDS as readonly string[]).includes(x));
  if (!s.balls.includes(DEFAULT_BALL)) s.balls.unshift(DEFAULT_BALL);
  s.ball = typeof o.ball === 'string' && s.balls.includes(o.ball) ? o.ball : DEFAULT_BALL;

  const keys = isObj(o.keys) ? o.keys : {};
  for (const c of CASES) s.keys[c.id as CaseId] = int(keys[c.id], 0, 0, 9999);
  s.muted = o.muted === true;
  s.music = o.music !== false;
  s.first = int(o.first, 0, 0, now) || now;

  const dl = isObj(o.daily) ? o.daily : {};
  s.daily = { day: int(dl.day, 0, 0, 1e6), last: day(dl.last) };
  // cooldown timestamps: a clock that was set far ahead must not lock a timer for days
  const snowEvery = CASES[0].adEvery ?? 0;
  s.freeCase = int(o.freeCase, 0, 0, now + snowEvery);
  s.freeUp = int(o.freeUp, 0, 0, now + FREE_UP_MS);
  const ac = isObj(o.adCoins) ? o.adCoins : {};
  s.adCoins = { day: day(ac.day), n: int(ac.n, 0, 0, 1000), next: int(ac.next, 0, 0, now + AD_COINS_MS) };

  s.noAds = o.noAds === true;
  s.bought = ids(o.bought, (x) => x.length > 0 && x.length < 64);
  // product ids granted but not consumed yet (see payments.ts); may repeat (two unconsumed purchases of one product)
  s.tokens = Array.isArray(o.tokens) ? o.tokens.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 64).slice(0, 50) : [];
  s.races = int(o.races, 0);
  s.wins = Math.min(s.races, int(o.wins, 0));
  s.lossStreak = int(o.lossStreak, 0, 0, 1000);
  s.tut = int(o.tut, 0, 0, 0x7fffffff);
  s.pity = int(o.pity, 0, 0, 1000);
  if (isObj(o.trial)) {
    const t: { skin?: string; ball?: string } = {};
    if (typeof o.trial.skin === 'string' && (SKIN_IDS as readonly string[]).includes(o.trial.skin)) t.skin = o.trial.skin;
    if (typeof o.trial.ball === 'string' && (BALL_IDS as readonly string[]).includes(o.trial.ball)) t.ball = o.trial.ball;
    s.trial = t.skin || t.ball ? t : null;
  }
  s.tries = int(o.tries, 0, 0, 1000);
  s.seen = ids<ObstacleKind>(o.seen, (x) => (KINDS as readonly string[]).includes(x));
  s.announced = ids<Feature>(o.announced, (x) => (FEATURES as readonly string[]).includes(x));
  const ua = isObj(o.unlockedAt) ? o.unlockedAt : {};
  for (const f of FEATURES) { const t = int(ua[f], 0, 0, now); if (t > 0) s.unlockedAt[f] = t; }
  s.freebies = ids(o.freebies, (x) => x.length > 0 && x.length < 32, 32);
  return s;
}

/** the name shown for the player: their own, or the localized hero name «Нубик» / "Noob" */
export function playerName(save: Save): string {
  return save.name.trim() || tr({ ru: 'Нубик', en: 'Noob' });
}

export function canAfford(s: Save, cur: Currency, n: number): boolean {
  return Number.isFinite(n) && n >= 0 && s[cur] >= n;
}
/** subtract if affordable; returns success */
export function spend(s: Save, cur: Currency, n: number): boolean {
  if (!canAfford(s, cur, n)) return false;
  s[cur] -= Math.ceil(n);
  return true;
}
/** add currency (non-positive / non-finite amounts are ignored) */
export function earn(s: Save, cur: Currency, n: number): void {
  if (Number.isFinite(n) && n > 0) s[cur] = Math.min(MAX_NUM, s[cur] + Math.floor(n));
}
