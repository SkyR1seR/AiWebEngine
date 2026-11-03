// Gameplay tunables (owner: core). Other modules may read the exported constants. DESIGN.md §2 is the reference.
import type { RacerStats } from './types';

/** start ball size before upgrades */
export const START_SIZE = 3;
export const MAX_SIZE = 30;
/** a ball smaller than this melts away (a new start-size ball appears) */
export const MIN_SIZE = 2;
/** gap between the racer and the ball surface (m): ball center d = racer d + r + BALL_AHEAD */
export const BALL_AHEAD = 0.45;
/** skin pixel size in meters (character is 32 px = 1.44 m tall) */
export const PX = 0.045;
/** character height (m) */
export const BODY_H = 1.44;
/** half extent of the racer's body box (x and d) */
export const BODY_HALF = 0.3;
/** start line x positions; player is at index 2 (center) */
export const START_X = [-4.8, -2.4, 0, 2.4, 4.8];
/** racers start at this distance */
export const START_D = 1.5;

// ---- movement
export const BASE_SPEED = 6.4;
/** forward acceleration / deceleration toward the target speed (m/s²) */
export const ACCEL = 9;
export const DECEL = 5;
/** speed multiplier per surface code (snow, ice, thaw, salt, boost pad) */
export const SURF_SPEED = [1, 1.15, 0.92, 0.92, 1];
/** boost pad: duration (s) and speed multiplier */
export const PAD_BOOST_T = 1.6;
export const PAD_BOOST_MUL = 1.45;
/** gift power-up boost */
export const GIFT_BOOST_T = 2.5;
export const GIFT_BOOST_MUL = 1.4;
/** gift power-up growth */
export const GIFT_GROW = 6;
/** big balls are slower: sizeMul = max(SIZE_SLOW_MIN, 1 - SIZE_SLOW * max(0, s - SIZE_SLOW_FROM)) */
export const SIZE_SLOW = 0.008;
export const SIZE_SLOW_FROM = 12;
export const SIZE_SLOW_MIN = 0.82;
/** max lateral speed (m/s), steering gain (1/s), lateral acceleration on snow / ice (m/s²) */
export const STEER_SPEED = 8.5;
export const STEER_GAIN = 10;
export const STEER_ACC = 70;
export const ICE_STEER_ACC = 11;
/** racer x limit: ±X_LIMIT */
export const X_LIMIT = 6.5 - 0.35;
/** ball x follows racer x with exponential damping (1/s) */
export const BALL_LAG = 10;

// ---- ball size
/** growth per meter rolled on snow: GROW_RATE * growMul / (1 + s / GROW_SOFT) */
export const GROW_RATE = 0.42;
export const GROW_SOFT = 22;
/** size/s lost on thaw / salt / at a bonfire (× meltMul) */
export const THAW_MELT = 3.2;
export const SALT_MELT = 6;
export const FIRE_MELT = 16;
/** after a melt-out the new ball doesn't melt for this long (s): no event spam on a long salt patch / in a fire */
export const MELT_GRACE = 0.4;

// ---- obstacles
/** smashing costs SMASH_COST * strength of size */
export const SMASH_COST = 0.3;
/** a too-small ball chips the obstacle: strengthLeft -= CHIP * size (shared) */
export const CHIP = 0.5;
/** bonus walls cost BONUS_COST * strength (design said 0.5: then x4/x5 are unreachable even with a max ball) */
export const BONUS_COST = 0.25;
/** stun duration per obstacle kind (s) */
export const STUN: Record<string, number> = { wall: 0.7, spikes: 0.6, pusher: 0.6, hammer: 0.8, plow: 1.0, icicle: 0.6, fire: 0.6 };
/** knock back on a shatter: at least KNOCKBACK (m), more if needed so the new ball stops KNOCK_ROOM before the obstacle
 * (room to steer to another wall section instead of hitting the same one again); the bounce takes KNOCK_T s */
export const KNOCKBACK = 1.2;
export const KNOCKBACK_MAX = 4;
export const KNOCK_ROOM = 2.5;
export const KNOCK_T = 0.35;
/** hammer lateral knock (m/s) */
export const HAMMER_KNOCK = 7;
/** hammer pivot height (m), head radius, max swing (rad) */
export const HAMMER_PIVOT = 4.5;
export const HAMMER_HEAD = 0.75;
export const HAMMER_SWING = 1.15;
/** hammer arm length (m); the ball collides with HAMMER_BALL × its radius (big balls squash a bit) */
export const HAMMER_ARM = 3.8;
export const HAMMER_BALL = 0.8;
/** plow: x range of its center (m); ball collision factor (× radius) */
export const PLOW_RANGE = 5;
export const PLOW_BALL = 0.7;
/** icicle: shadow warning (s) before the impact, drop time (s), impact window (s) */
export const ICICLE_WARN = 1.0;
export const ICICLE_DROP = 0.25;
export const ICICLE_HIT = 0.35;
/** an icicle hits the ball if it lands within w + ICICLE_BALL × radius of its center */
export const ICICLE_BALL = 0.6;
/** falling into a hole: duration (s) and depth (m) */
export const FALL_T = 1.5;
export const FALL_DEPTH = 3;
/** min half width of a bridge (m) */
export const BRIDGE_HALF = 0.9;
/** brief invulnerability after a shield absorbed an indestructible hit, or after a stun ends (s) */
export const SAFE_T = 0.6;
export const MAX_SHIELDS = 3;

// ---- finish
/** bots stop at about finishD + BOT_STOP (+ a bit per place) and stand at x = ±BOT_SIDE_X */
export const BOT_STOP = 4;
export const BOT_SIDE_X = 5.5;
/** min seconds between overtake events of the same pair; bump events */
export const OVERTAKE_GAP = 1.5;
export const BUMP_GAP = 1;
/** lateral push between racers (m/s max) */
export const PUSH_SPEED = 4;

// ---- level
export const FINISH_BASE = 140;
export const FINISH_PER_LEVEL = 9;
export const FINISH_MAX = 420;
/** bonus zone after the finish */
export const BONUS_MULTS = [1.2, 1.5, 2, 3, 4, 5];
export const BONUS_STRENGTHS = [5, 9, 13, 18, 23, 28];
export const BONUS_FIRST = 12;
export const BONUS_STEP = 8;
/** pickup radius (m) when the stats don't say otherwise */
export const BASE_MAGNET = 0.9;

/** speed factor of a ball size (big balls are slower) */
export function sizeSpeed(s: number): number {
  return Math.max(SIZE_SLOW_MIN, 1 - SIZE_SLOW * Math.max(0, s - SIZE_SLOW_FROM));
}

/** racer stats without upgrades (bots / tests) */
export function baseStats(): RacerStats {
  return { speedMul: 1, growMul: 1, meltMul: 1, startSize: START_SIZE, magnet: BASE_MAGNET, shields: 0 };
}
