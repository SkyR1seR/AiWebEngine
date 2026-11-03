// Shared contracts of Snowball Rush. See DESIGN.md. Owners may ADD optional fields to their sections (small Edits only).
import type { Game } from 'aiwebengine';
import type { UI } from 'aiwebengine/ui';
import type { Playgama } from 'aiwebengine/playgama';
import type { Payments } from './payments';

// ---------------------------------------------------------------- common (lead)
/** ISO 639-1 code of a supported language (see i18n.LANGS) */
export type Lang = string;
export interface Loc { ru: string; en: string }
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type Currency = 'coins' | 'gems';
export type UpgradeId = 'speed' | 'grip' | 'armor' | 'start' | 'magnet';
export type CaseId = 'snow' | 'ice' | 'santa';
export type PowerUp = 'shield' | 'boost' | 'grow';
/** menu features that unlock gradually (see unlocks.ts) */
export type Feature = 'upgrades' | 'wardrobe' | 'daily' | 'cases' | 'shop';

/** character skin ids (art draws them, catalog prices them). 'noob' = the hero Нубик (images/noob.png), the default */
export const SKIN_IDS = [
  'noob', 'winter', 'skier', 'hockey', 'penguin', 'elf', 'gingerbread', 'snowman', 'reindeer', 'snowmaiden', 'iceknight', 'santa', 'yeti', 'nutcracker',
] as const;
export type SkinId = typeof SKIN_IDS[number];
/** ball skin ids */
export const BALL_IDS = ['snow', 'tangerine', 'candy', 'ornament', 'garland', 'ice', 'disco', 'gold', 'olivier'] as const;
export type BallId = typeof BALL_IDS[number];

// ---------------------------------------------------------------- level (core)
export const TRACK_W = 13;
/** half width of the drivable track (m) */
export const HALF_W = 6.5;
/** surface codes in LevelData.surface */
export const SURF = { snow: 0, ice: 1, thaw: 2, salt: 3, boost: 4 } as const;
export type Surf = typeof SURF[keyof typeof SURF];

export type ObstacleKind = 'wall' | 'spikes' | 'fire' | 'hammer' | 'pusher' | 'plow' | 'icicle' | 'gap' | 'bonus';

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  /** center distance along the track (m) */
  d: number;
  /** lateral center (m) */
  x: number;
  /** lateral half extent (walls/spikes/pusher half size, fire/icicle radius, hammer arm length) */
  w: number;
  /** half extent along the track */
  len: number;
  /** ball size needed to smash / extinguish / bridge; Infinity = indestructible */
  strength: number;
  /** pusher: x amplitude (m); plow: unused */
  amp?: number;
  /** angular speed (rad/s) for pusher/hammer, m/s for plow */
  speed?: number;
  phase?: number;
  /** icicle cycle length (s) */
  period?: number;
  /** bonus wall multiplier */
  mult?: number;
  /** what lies behind a wall section (visual hint + reward is a pickup placed by the generator) */
  reward?: 'coins' | 'gem' | 'gift';
}

export type PickupKind = 'coin' | 'gem' | 'gift';
export interface Pickup { id: number; kind: PickupKind; d: number; x: number }

export interface LevelData {
  /** level index (0-based) */
  n: number;
  seed: number;
  /** rows (m) including the bonus zone */
  length: number;
  startD: number;
  finishD: number;
  /** surface code per cell, index r * TRACK_W + c */
  surface: Uint8Array;
  obstacles: Obstacle[];
  pickups: Pickup[];
  /** visual theme 0 day, 1 sunset, 2 night (garland lights), 3 snowstorm */
  theme: number;
  /** base bot skill for this level 0..1 */
  botSkill: number;
}

// ---------------------------------------------------------------- racers (core)
export interface Profile {
  name: string;
  skin: string;
  ball: string;
  trophies: number;
  /** player level shown in lobby */
  level: number;
  isBot: boolean;
  vip?: boolean;
}

/** per-racer stats from upgrades (catalog.racerStats) */
export interface RacerStats {
  speedMul: number;
  growMul: number;
  meltMul: number;
  startSize: number;
  magnet: number;
  shields: number;
}

export type RacerState = 'ready' | 'run' | 'stun' | 'fall' | 'finished' | 'done';

export interface Racer {
  id: number;
  isPlayer: boolean;
  profile: Profile;
  stats: RacerStats;
  /** bots: 0..1 */
  skill: number;
  state: RacerState;
  /** time in the current state (s) */
  stateT: number;
  x: number;
  d: number;
  /** vertical offset (falling into a hole < 0) */
  y: number;
  /** current forward speed (m/s) */
  speed: number;
  /** lateral velocity (m/s) */
  vx: number;
  /** steering target set by controls / bot AI */
  targetX: number;
  /** speed multiplier set by race.ts (rubber band) */
  rubber: number;
  /** ball size (radius = size / 10); 0 = no ball (crossing a hole after bridging) */
  size: number;
  ballX: number;
  ballD: number;
  /** accumulated rolling angle (rad) */
  ballRot: number;
  shields: number;
  boostT: number;
  coins: number;
  gems: number;
  /** place at the finish (1..5), 0 = not finished */
  place: number;
  finishTime: number;
  /** bonus multiplier reached in the bonus zone */
  mult: number;
  /** surface code under the ball this step (for effects/sound) */
  surf: number;
  /** true while the ball overlaps a melting source (fire/thaw/salt) */
  melting: boolean;
  /** live race position 1..5 (updated by sim) */
  pos: number;
}

/** sim callbacks (all optional) */
export interface SimEvents {
  shatter?(r: Racer, cause: ObstacleKind | 'melt', o: Obstacle | null): void;
  smash?(r: Racer, o: Obstacle): void;
  shield?(r: Racer, o: Obstacle): void;
  bridge?(r: Racer, o: Obstacle, x0: number, x1: number): void;
  fall?(r: Racer, o: Obstacle): void;
  respawn?(r: Racer): void;
  pickup?(r: Racer, p: Pickup, power: PowerUp | null): void;
  boostPad?(r: Racer): void;
  finish?(r: Racer, place: number): void;
  bonus?(r: Racer, o: Obstacle): void;
  done?(r: Racer): void;
  bump?(a: Racer, b: Racer): void;
  overtake?(a: Racer, b: Racer): void;
}

// ---------------------------------------------------------------- save (meta)
export interface Save {
  v: number;
  name: string;
  coins: number;
  gems: number;
  /** current level (0-based) */
  level: number;
  trophies: number;
  /** highest league index whose reward was granted */
  league: number;
  up: Record<UpgradeId, number>;
  skins: string[];
  skin: string;
  balls: string[];
  ball: string;
  /** unopened cases (keys) */
  keys: Record<CaseId, number>;
  muted: boolean;
  music: boolean;
  /** first launch timestamp (ms) */
  first: number;
  /** calendar: days claimed so far, last claim date 'YYYY-MM-DD' */
  daily: { day: number; last: string };
  /** timestamp when the ad-case is available again */
  freeCase: number;
  /** ad coins in shop: date, count today, next allowed timestamp */
  adCoins: { day: string; n: number; next: number };
  /** timestamp when the ad-upgrade is available again */
  freeUp: number;
  noAds: boolean;
  /** one-time purchases / offer ids already bought */
  bought: string[];
  /** processed purchase tokens (dedupe) */
  tokens: string[];
  races: number;
  wins: number;
  /** losses in a row */
  lossStreak: number;
  /** tutorial flags bitmask */
  tut: number;
  /** ice/santa cases opened since the last legendary */
  pity: number;
  /** skin/ball tried for the next race via ad */
  trial: { skin?: string; ball?: string } | null;
  /** failed attempts on the current level (each one makes the level a bit easier; reset when passed) */
  tries: number;
  /** obstacle kinds already introduced to the player (intro card shown) */
  seen: ObstacleKind[];
  /** features whose unlock was announced */
  announced: Feature[];
  /** feature → timestamp when it unlocked (starter offer timer starts at the shop unlock) */
  unlockedAt: Partial<Record<Feature, number>>;
  /** one-time tutorial freebies used: 'upgrade' (first upgrade free), 'case' (first snow case free), 'skin' (winter skin gift) */
  freebies: string[];
}

// ---------------------------------------------------------------- economy results (meta)
export type Reward =
  | { kind: 'coins'; n: number }
  | { kind: 'gems'; n: number }
  | { kind: 'skin'; id: string }
  | { kind: 'ball'; id: string }
  | { kind: 'key'; id: CaseId; n: number }
  | { kind: 'noAds' };

/** result of opening a case / granting an item (dup = already owned → compensated with `comp` coins) */
export type Drop =
  | { kind: 'coins' | 'gems'; n: number }
  | { kind: 'skin' | 'ball'; id: string; rarity: Rarity; dup: boolean; comp: number };

// ---------------------------------------------------------------- UI context (ui-core / integrator)
export type ShopTab = 'offers' | 'gems' | 'coins' | 'cases';
export interface Nav {
  menu(): void;
  play(): void;
  shop(tab?: ShopTab): void;
  wardrobe(tab?: 'skins' | 'balls'): void;
  upgrades(): void;
  cases(): void;
  daily(): void;
  /** open an offer popup by offer id */
  offer(id: string): void;
}

export interface Ctx {
  game: Game;
  ui: UI;
  /** platform SDK (Playgama Bridge): ads, saves, payments, lifecycle messages */
  sdk: Playgama;
  pay: Payments;
  save: Save;
  persist(): void;
  nav: Nav;
  /** call after changing the save: updates currency bar, badges, lobby look */
  refresh(): void;
  /** current time (ms); single source so tests/dev can shift it */
  now(): number;
}

/** a full-screen UI screen */
export interface ScreenApi {
  show(arg?: string): void;
  hide(): void;
  readonly visible: boolean;
  refresh(): void;
}
