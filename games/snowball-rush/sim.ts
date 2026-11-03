// Race simulation (owner: core). Pure logic, fixed step, no rendering. Single source of truth for gameplay rules (DESIGN §2).
//
// Events (SimEvents) fire synchronously inside step():
//   shatter(r, cause, o)  ball destroyed (cause = obstacle kind, 'melt' or 'bonus'); stunned unless 'melt'/'bonus'
//   smash(r, o)           obstacle destroyed for everybody (also when a too-small ball chipped it to 0: then after shatter)
//   shield(r, o)          a shield absorbed the hit (destructible o is broken; indestructible: brief invulnerability)
//   bridge / fall / respawn, pickup(r, p, power), boostPad, finish(r, place), bonus(r, o) (bonus wall smashed,
//   r.mult updated), done(r), bump(a, b) (≥ 1 s per pair), overtake(a, b) (a passed b, ≥ 1.5 s per pair).
// Displayed wall numbers must come from strengthLeft(o) (walls get chipped). Broken obstacles: `broken` (bonus walls too).
import type { LevelData, Obstacle, ObstacleKind, Pickup, PowerUp, Profile, Racer, RacerStats, SimEvents } from './types';
import { HALF_W, SURF, TRACK_W } from './types';
import { rng } from './util';
import { wallRows } from './level';
import {
  ACCEL, BALL_AHEAD, BALL_LAG, BASE_SPEED, BODY_H, BODY_HALF, BONUS_COST, BOT_SIDE_X, BOT_STOP, BRIDGE_HALF, BUMP_GAP, CHIP, DECEL,
  FALL_DEPTH, FALL_T, FIRE_MELT, GIFT_BOOST_MUL, GIFT_BOOST_T, GIFT_GROW, GROW_RATE, GROW_SOFT, HAMMER_HEAD, HAMMER_KNOCK,
  HAMMER_BALL, HAMMER_PIVOT, HAMMER_SWING, ICE_STEER_ACC, ICICLE_BALL, ICICLE_DROP, ICICLE_HIT, ICICLE_WARN, KNOCKBACK, KNOCKBACK_MAX, KNOCK_ROOM, KNOCK_T, MAX_SHIELDS,
  MAX_SIZE, MELT_GRACE, MIN_SIZE, OVERTAKE_GAP, PAD_BOOST_MUL, PAD_BOOST_T, PLOW_BALL, PLOW_RANGE, PUSH_SPEED, SAFE_T, SALT_MELT,
  SMASH_COST, sizeSpeed, START_D, START_X, STEER_ACC, STEER_GAIN, STEER_SPEED, STUN,
  SURF_SPEED, THAW_MELT, X_LIMIT,
} from './config';

export interface RacerSetup { profile: Profile; isPlayer: boolean; stats: RacerStats; skill: number }
/** shared snow bridge plugging a hole */
export interface Bridge { o: number; x0: number; x1: number }

/** per-racer internal state (plain keys: terser mangles `_` props) */
interface Aux {
  rnd: () => number;
  boostMul: number;
  onPad: boolean;
  /** cursors into the d-sorted obstacle / pickup arrays */
  oc: number;
  pc: number;
  /** hole being crossed and the x range to stay in (bridge) */
  gap: Obstacle | null;
  gx0: number;
  gx1: number;
  stunFor: number;
  knockDecel: number;
  /** invulnerability vs indestructible obstacles (s) */
  safeT: number;
  /** no melting right after a melt-out (s) */
  graceT: number;
  /** fire currently touched (chipped once per contact) */
  fireId: number;
  /** next bonus wall; player's constant speed in the bonus zone; bots' stop distance and side */
  bonusI: number;
  bonusSpeed: number;
  stopD: number;
  sideX: number;
}

/** max half extent of any obstacle along d (window margin) */
const EXT = 2;
const BODY_R = 0.35;
/** balls may overlap a little before they push each other (big balls are half the track wide) */
const BALL_SOFT = 0.8;
const INDESTRUCTIBLE: Partial<Record<ObstacleKind, 1>> = { hammer: 1, plow: 1, icicle: 1 };
const POWERS: PowerUp[] = ['shield', 'boost', 'grow'];
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const mod = (a: number, n: number) => ((a % n) + n) % n;

export class RaceSim {
  /** sim clock (s): advances on every step, also during the countdown (moving obstacles animate) */
  time = 0;
  /** time when the race started (finishTime = time - startTime) */
  startTime = 0;
  running = false;
  racers: Racer[] = [];
  /** ids of destroyed obstacles (shared by everybody) */
  broken = new Set<number>();
  bridges: Bridge[] = [];
  /** ids of collected pickups */
  taken = new Set<number>();
  /** finish order */
  order: Racer[] = [];
  /** track obstacles sorted by d (bonus walls excluded) and pickups sorted by d — read-only views for AI/HUD */
  readonly obs: Obstacle[];
  readonly pk: Pickup[];
  /** bonus walls in order */
  readonly bonusWalls: Obstacle[];

  private _aux: Aux[] = [];
  private _chip = new Map<number, number>();
  private _player: Racer;
  private _rank: Racer[] = [];
  private _ahead: Uint8Array;
  private _lastOT: Float64Array;
  private _lastBump: Float64Array;
  private _cross: Racer[] = [];
  private _rows: Obstacle[][];
  private _gaps: Obstacle[];
  private _ice = { warn: 0, fall: -1, hit: false };

  constructor(public level: LevelData, setups: RacerSetup[], public events: SimEvents = {}) {
    const all = level.obstacles.slice().sort((a, b) => a.d - b.d);
    this.obs = all.filter((o) => o.kind !== 'bonus');
    this.bonusWalls = all.filter((o) => o.kind === 'bonus');
    this.pk = level.pickups.slice().sort((a, b) => a.d - b.d);
    this._rows = wallRows(level);
    this._gaps = this.obs.filter((o) => o.kind === 'gap');
    const N = setups.length;
    this._ahead = new Uint8Array(N * N);
    this._lastOT = new Float64Array(N * N).fill(-1e9);
    this._lastBump = new Float64Array(N * N).fill(-1e9);
    // the player starts in the middle, bots fill the other slots
    const slots = [2, 0, 1, 3, 4];
    let bot = 1;
    setups.forEach((s, i) => {
      const x = START_X[slots[s.isPlayer ? 0 : bot++ % slots.length]] ?? 0;
      const size = s.stats.startSize;
      this.racers.push({
        id: i, isPlayer: s.isPlayer, profile: s.profile, stats: s.stats, skill: s.skill, state: 'ready', stateT: 0,
        x, d: START_D, y: 0, speed: 0, vx: 0, targetX: x, rubber: 1, size, ballX: x, ballD: START_D + size / 10 + BALL_AHEAD,
        ballRot: 0, shields: Math.min(MAX_SHIELDS, s.stats.shields), boostT: 0, coins: 0, gems: 0, place: 0, finishTime: 0,
        mult: 1, surf: SURF.snow, melting: false, pos: i + 1,
      });
      this._aux.push({
        rnd: rng((level.seed * 31 + i * 977 + 1) >>> 0), boostMul: 1, onPad: false, oc: 0, pc: 0, gap: null, gx0: 0, gx1: 0,
        stunFor: 0, knockDecel: 0, safeT: 0, graceT: 0, fireId: -1, bonusI: 0, bonusSpeed: 0, stopD: 0, sideX: 0,
      });
    });
    this._player = this.racers.find((r) => r.isPlayer) ?? this.racers[0];
    this._rank = this.racers.slice();
    this._updatePos(false);
  }

  /** countdown over: everybody runs */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.startTime = this.time;
    for (const r of this.racers) if (r.state === 'ready') { r.state = 'run'; r.stateT = 0; }
  }

  /** advance by a fixed step (1/60) */
  step(dt: number): void {
    this.time += dt;
    if (!this.running) return;
    const lag = 1 - Math.exp(-BALL_LAG * dt);
    for (let i = 0; i < this.racers.length; i++) this._stepRacer(this.racers[i], this._aux[i], dt, lag);
    this._collide(dt);
    this._finishLine();
    this._updatePos(true);
  }

  get player(): Racer { return this._player; }

  /** current lateral x of a (moving) obstacle: pusher/plow center, hammer head */
  obstacleX(o: Obstacle, t = this.time): number {
    switch (o.kind) {
      case 'pusher': return o.x + (o.amp ?? 0) * Math.sin((o.speed ?? 1) * t + (o.phase ?? 0));
      case 'plow': {
        const u = mod(((o.speed ?? 3) * t) / (2 * PLOW_RANGE) + (o.phase ?? 0), 2);
        return u < 1 ? -PLOW_RANGE + 2 * PLOW_RANGE * u : PLOW_RANGE - 2 * PLOW_RANGE * (u - 1);
      }
      case 'hammer': return o.x + o.w * Math.sin(this.hammerAngle(o, t));
      default: return o.x;
    }
  }
  /** hammer swing angle (rad); head at (x + w sinθ, HAMMER_PIVOT - w cosθ) */
  hammerAngle(o: Obstacle, t = this.time): number { return HAMMER_SWING * Math.sin((o.speed ?? 1.5) * t + (o.phase ?? 0)); }
  /** remaining strength of a destructible obstacle (too-small balls chip it: -0.5*size per hit); Infinity if indestructible */
  strengthLeft(o: Obstacle): number {
    if (INDESTRUCTIBLE[o.kind]) return Infinity;
    return this._chip.get(o.id) ?? o.strength;
  }
  /**
   * icicle: warn 0..1 (shadow growing, then 1 during the impact), fall -1 (hanging) or 0..1 (dropping; 1 = on the ground),
   * hit = dangerous now. NOTE: the returned object is reused (read it right away).
   */
  icicleState(o: Obstacle, t = this.time): { warn: number; fall: number; hit: boolean } {
    const P = o.period ?? 3, c = mod(t + (o.phase ?? 0), P), hit0 = P - ICICLE_HIT, warn0 = hit0 - ICICLE_WARN, drop0 = hit0 - ICICLE_DROP;
    const s = this._ice;
    s.hit = c >= hit0;
    s.warn = s.hit ? 1 : c >= warn0 ? (c - warn0) / ICICLE_WARN : 0;
    s.fall = s.hit ? 1 : c >= drop0 ? (c - drop0) / ICICLE_DROP : -1;
    return s;
  }

  // ---------------------------------------------------------------- query helpers (HUD / tutorial / AI)
  isBroken(o: Obstacle): boolean { return this.broken.has(o.id); }
  /** 0..1 progress to the finish */
  progress(r: Racer): number { return clamp(r.d / this.level.finishD, 0, 1); }
  /** the next unbroken obstacle ahead of the racer's ball (optionally of the given kinds), or null */
  nextObstacle(r: Racer, kinds?: readonly ObstacleKind[]): Obstacle | null {
    const from = r.ballD - r.size / 10;
    for (let i = this._aux[r.id]?.oc ?? 0; i < this.obs.length; i++) {
      const o = this.obs[i];
      if (o.d + o.len < from || this.broken.has(o.id) || (kinds && !kinds.includes(o.kind))) continue;
      return o;
    }
    return null;
  }
  /** sections of the first wall row whose d > `d` (shared array: don't modify), or null */
  nextWallRow(d: number): Obstacle[] | null {
    for (const row of this._rows) if (row[0].d > d) return row;
    return null;
  }
  /** index of the first obstacle in `obs` with o.d >= d - EXT (binary search) */
  obstacleIndex(d: number): number { return lowerBound(this.obs, d - EXT); }
  /** index of the first pickup in `pk` with p.d >= d */
  pickupIndex(d: number): number { return lowerBound(this.pk, d); }
  /** bridge of hole `o` that covers x, or null */
  bridgeAt(o: Obstacle, x: number): Bridge | null {
    for (const b of this.bridges) if (b.o === o.id && x >= b.x0 && x <= b.x1) return b;
    return null;
  }
  /** racers sorted by live position (shared array, refreshed every step) */
  standings(): readonly Racer[] { return this._rank; }
  /** race over (player done): give places to racers that haven't finished, by current position; returns the final order */
  settle(): Racer[] {
    for (const r of this._rank) {
      if (r.place) continue;
      r.place = this.order.length + 1;
      r.finishTime = this.time - this.startTime;
      this.order.push(r);
    }
    return this.order;
  }

  // ---------------------------------------------------------------- internals
  private _stepRacer(r: Racer, a: Aux, dt: number, lag: number) {
    r.stateT += dt;
    a.safeT -= dt;
    a.graceT -= dt;
    if (r.boostT > 0) r.boostT = Math.max(0, r.boostT - dt);
    const st = r.state;
    if (st === 'ready') return;
    if (st === 'fall') return this._fall(r, a);

    // ---- forward speed
    if (st === 'stun') {
      r.speed = Math.min(0, r.speed + a.knockDecel * dt);
      if (r.stateT >= a.stunFor) { r.state = 'run'; r.stateT = 0; a.safeT = SAFE_T; }
    } else if (st === 'done') {
      r.speed = Math.max(0, r.speed - 8 * dt);
    } else if (st === 'finished' && !r.isPlayer) {
      // bots: brake to a stop at stopD
      r.speed = Math.min(r.speed, Math.sqrt(Math.max(0, 2 * 6 * (a.stopD - r.d))));
      if (r.d >= a.stopD - 0.05 || r.speed < 0.15) { r.speed = 0; this._done(r); }
    } else if (st === 'finished') {
      r.speed = a.bonusSpeed;
    } else {
      const sizeMul = sizeSpeed(r.size);
      const boost = r.boostT > 0 ? a.boostMul : 1;
      const target = BASE_SPEED * r.stats.speedMul * (SURF_SPEED[r.surf] ?? 1) * sizeMul * boost * r.rubber;
      r.speed = r.speed < target ? Math.min(target, r.speed + ACCEL * dt) : Math.max(target, r.speed - DECEL * dt);
    }

    // ---- steering (no steering while stunned; slippery on ice)
    if (r.state === 'stun') r.vx *= Math.exp(-6 * dt);
    else {
      const tx = r.state === 'finished' && !r.isPlayer ? a.sideX : clamp(r.targetX, -X_LIMIT, X_LIMIT);
      const want = clamp((tx - r.x) * STEER_GAIN, -STEER_SPEED, STEER_SPEED);
      const acc = (this._surf(r.x, r.d) === SURF.ice ? ICE_STEER_ACC : STEER_ACC) * dt;
      r.vx += clamp(want - r.vx, -acc, acc);
    }
    r.x += r.vx * dt;
    if (r.x > X_LIMIT || r.x < -X_LIMIT) { r.x = clamp(r.x, -X_LIMIT, X_LIMIT); r.vx = 0; }
    if (a.gap) {
      // crossing a hole: stay on the bridge (soft while still on the edge, hard over the hole)
      const lo = Math.min(a.gx0 + 0.25, (a.gx0 + a.gx1) / 2), hi = Math.max(a.gx1 - 0.25, (a.gx0 + a.gx1) / 2);
      const c = clamp(r.x, lo, hi);
      if (r.d >= a.gap.d - a.gap.len - 0.2) r.x = c; else r.x += clamp(c - r.x, -10 * dt, 10 * dt);
    }

    // ---- move + ball
    const d0 = r.d;
    r.d = Math.max(0, r.d + r.speed * dt);
    this._ball(r, a, lag, r.d - d0);

    // ---- surface under the ball: growth / melting / boost pads
    r.melting = false;
    const surf = r.size > 0 ? this._surf(r.ballX, r.ballD) : -1;
    if (surf >= 0) r.surf = surf;
    if (r.state === 'run' || r.state === 'finished') {
      if (surf === SURF.snow && r.d > d0) r.size = Math.min(MAX_SIZE, r.size + ((GROW_RATE * r.stats.growMul) / (1 + r.size / GROW_SOFT)) * (r.d - d0));
      else if ((surf === SURF.thaw || surf === SURF.salt) && a.graceT <= 0) {
        r.size -= (surf === SURF.thaw ? THAW_MELT : SALT_MELT) * r.stats.meltMul * dt;
        r.melting = true;
      }
      if (surf === SURF.boost) {
        if (!a.onPad && r.state === 'run') { a.onPad = true; this._boost(a, r, PAD_BOOST_T, PAD_BOOST_MUL); this.events.boostPad?.(r); }
      } else a.onPad = false;
    }
    if (r.state === 'run') {
      this._obstacles(r, a, dt);
      if (r.state === 'run') this._pickups(r, a);
    } else if (r.state === 'finished' && r.isPlayer) this._bonusZone(r, a);
    if (r.size > 0 && r.size < MIN_SIZE) {
      this.events.shatter?.(r, 'melt', null);
      this._newBall(r);
      a.graceT = MELT_GRACE;
    }
    // leaving a hole: a new ball if this racer plugged it
    if (a.gap && r.d > a.gap.d + a.gap.len + 0.3) {
      a.gap = null;
      if (r.size === 0) this._newBall(r);
    }
  }

  private _ball(r: Racer, a: Aux, lag: number, dd: number) {
    if (r.size <= 0) { r.ballX = r.x; r.ballD = r.d + BALL_AHEAD; return; }
    const rad = r.size / 10;
    r.ballD = r.d + rad + BALL_AHEAD;
    const lim = HALF_W - rad * 0.8;
    r.ballX = clamp(r.ballX + (r.x - r.ballX) * lag, -lim, lim);
    if (a.gap) r.ballX = clamp(r.ballX, a.gx0, a.gx1);
    r.ballRot += dd / rad;
  }

  private _newBall(r: Racer) {
    r.size = r.stats.startSize;
    r.ballX = r.x;
    r.ballD = r.d + r.size / 10 + BALL_AHEAD;
  }

  private _boost(a: Aux, r: Racer, t: number, mul: number) {
    a.boostMul = r.boostT > 0 ? Math.max(a.boostMul, mul) : mul;
    r.boostT = Math.max(r.boostT, t);
  }

  private _fall(r: Racer, a: Aux) {
    const o = a.gap!;
    r.speed = 0;
    // walk into the hole and sink
    r.d += (o.d - r.d) * 0.12;
    const t = clamp((r.stateT - 0.1) / 0.6, 0, 1);
    r.y = -FALL_DEPTH * t * t;
    r.ballD = r.d + r.size / 10 + BALL_AHEAD;
    if (r.stateT < FALL_T) return;
    r.d = o.d + o.len + 0.6;
    r.y = 0;
    r.state = 'run';
    r.stateT = 0;
    r.vx = 0;
    a.gap = null;
    a.safeT = SAFE_T;
    this._newBall(r);
    this.events.respawn?.(r);
  }

  private _done(r: Racer) {
    if (r.state === 'done') return;
    r.state = 'done';
    r.stateT = 0;
    this.events.done?.(r);
  }

  /** surface under a point; -1 over a hole or outside */
  private _surf(x: number, d: number): number {
    const L = this.level, row = Math.floor(d);
    if (row < 0 || row >= L.length) return -1;
    for (const o of this._gaps) if (d >= o.d - o.len && d < o.d + o.len) return -1;
    return L.surface[row * TRACK_W + clamp(Math.floor(x + HALF_W), 0, TRACK_W - 1)];
  }

  private _obstacles(r: Racer, a: Aux, dt: number) {
    const obs = this.obs;
    while (a.oc < obs.length && obs[a.oc].d + EXT < r.d - 2) a.oc++;
    const rad = r.size / 10, front = r.ballD + rad;
    let fire = -1;
    for (let i = a.oc; i < obs.length && r.state === 'run'; i++) {
      const o = obs[i];
      if (o.d - EXT > front + 0.5) break;
      if (this.broken.has(o.id)) continue;
      switch (o.kind) {
        case 'wall':
          // sections tile the row: the one under the ball center decides
          if (r.size > 0 && front >= o.d - o.len && r.ballD - rad <= o.d + o.len && Math.abs(r.ballX - o.x) <= o.w) this._hitBreakable(r, a, o);
          break;
        case 'spikes':
        case 'pusher': {
          const ox = this.obstacleX(o), m = o.kind === 'pusher' ? 0.8 : 0.75;
          if (this._boxHit(r, ox, o.d, o.w, o.len, m)) this._hitBreakable(r, a, o);
          break;
        }
        case 'fire': {
          const dx = r.ballX - o.x, dd = r.ballD - o.d, R = o.w + rad * 0.9;
          if (r.size <= 0 || dx * dx + dd * dd >= R * R) break;
          fire = o.id;
          const left = this.strengthLeft(o);
          if (r.size >= left) { this._smash(r, o, left); break; }
          if (a.fireId !== o.id) { a.fireId = o.id; this._chipIt(r, o, left); }
          if (a.graceT <= 0) { r.size -= FIRE_MELT * r.stats.meltMul * dt; r.melting = true; }
          break;
        }
        case 'hammer': {
          if (a.safeT > 0) break;
          const th = this.hammerAngle(o), hx = o.x + o.w * Math.sin(th), hy = HAMMER_PIVOT - o.w * Math.cos(th);
          let hit = false;
          if (r.size > 0) {
            const dx = r.ballX - hx, dy = rad - hy, dd = r.ballD - o.d, R = HAMMER_HEAD + rad * HAMMER_BALL;
            hit = dx * dx + dy * dy + dd * dd < R * R;
          }
          if (!hit) {
            // body box vs head sphere
            const cx = clamp(hx, r.x - BODY_HALF, r.x + BODY_HALF), cy = clamp(hy, 0, BODY_H), cz = clamp(o.d, r.d - BODY_HALF, r.d + BODY_HALF);
            hit = (cx - hx) ** 2 + (cy - hy) ** 2 + (cz - o.d) ** 2 < HAMMER_HEAD * HAMMER_HEAD;
          }
          if (hit) this._hitSolid(r, a, o, (r.x >= hx ? 1 : -1) * HAMMER_KNOCK);
          break;
        }
        case 'plow': {
          if (a.safeT > 0) break;
          const px = this.obstacleX(o);
          if (this._boxHit(r, px, o.d, o.w, o.len, PLOW_BALL)) this._hitSolid(r, a, o, (r.x >= px ? 1 : -1) * 4);
          break;
        }
        case 'icicle': {
          if (a.safeT > 0 || !this.icicleState(o).hit) break;
          const bx = r.ballX - o.x, bd = r.ballD - o.d, R = o.w + rad * ICICLE_BALL, cx = r.x - o.x, cd = r.d - o.d, Rb = o.w + BODY_R;
          if ((r.size > 0 && bx * bx + bd * bd < R * R) || cx * cx + cd * cd < Rb * Rb) this._hitSolid(r, a, o, 0);
          break;
        }
        case 'gap':
          if (a.gap !== o && r.ballD >= o.d - o.len && r.d < o.d + o.len) this._reachGap(r, a, o);
          break;
      }
    }
    if (fire < 0) a.fireId = -1;
  }

  /** ball (circle-ish) or body vs an axis-aligned box centered at (x, d) */
  private _boxHit(r: Racer, x: number, d: number, w: number, len: number, m: number): boolean {
    const rad = r.size / 10;
    if (r.size > 0 && Math.abs(r.ballX - x) < w + rad * m && Math.abs(r.ballD - d) < len + rad * m) return true;
    return Math.abs(r.x - x) < w + BODY_HALF && Math.abs(r.d - d) < len + BODY_HALF;
  }

  private _smash(r: Racer, o: Obstacle, left: number) {
    this.broken.add(o.id);
    r.size = Math.max(Math.min(r.size, MIN_SIZE), r.size - SMASH_COST * left);
    this.events.smash?.(r, o);
  }
  /** a too-small ball chips the obstacle (shared); at 0 it breaks */
  private _chipIt(r: Racer, o: Obstacle, left: number) {
    const v = left - CHIP * r.size;
    this._chip.set(o.id, Math.max(0, v));
    if (v <= 0) { this.broken.add(o.id); this.events.smash?.(r, o); }
  }

  private _hitBreakable(r: Racer, a: Aux, o: Obstacle) {
    const left = this.strengthLeft(o);
    if (r.size >= left) return this._smash(r, o, left);
    if (r.shields > 0) {
      r.shields--;
      this.broken.add(o.id);
      this.events.shield?.(r, o);
      return;
    }
    this.events.shatter?.(r, o.kind, o);
    this._chipIt(r, o, left);
    this._stun(r, a, o, STUN[o.kind] ?? 0.6, 0);
  }

  private _hitSolid(r: Racer, a: Aux, o: Obstacle, knock: number) {
    if (r.shields > 0) {
      r.shields--;
      a.safeT = SAFE_T + 0.4;
      this.events.shield?.(r, o);
      return;
    }
    this.events.shatter?.(r, o.kind, o);
    this._stun(r, a, o, STUN[o.kind] ?? 0.8, knock);
  }

  /** stun + knock back: at least KNOCKBACK, and far enough that the new ball has room to steer before `o` */
  private _stun(r: Racer, a: Aux, o: Obstacle, t: number, knock: number) {
    r.state = 'stun';
    r.stateT = 0;
    a.stunFor = t;
    a.fireId = -1;
    r.vx = knock;
    r.boostT = 0;
    const room = o.d - o.len - KNOCK_ROOM - (2 * r.stats.startSize) / 10 - BALL_AHEAD;
    const back = clamp(r.d - room, KNOCKBACK, KNOCKBACK_MAX);
    // the bounce lasts KNOCK_T: linear deceleration from v0 to 0 covers `back`
    r.speed = (-2 * back) / KNOCK_T;
    a.knockDecel = (2 * back) / (KNOCK_T * KNOCK_T);
    this._newBall(r);
  }

  private _reachGap(r: Racer, a: Aux, o: Obstacle) {
    const b = r.size > 0 ? this.bridgeAt(o, r.ballX) : null;
    if (b) { a.gap = o; a.gx0 = b.x0; a.gx1 = b.x1; return; }
    if (r.size > 0 && r.size >= o.strength) {
      // the ball plugs the hole: a shared bridge; the racer walks across, a new ball after the hole
      const h = Math.max(BRIDGE_HALF, r.size / 10);
      const x0 = clamp(r.ballX - h, -HALF_W, HALF_W - 2 * BRIDGE_HALF), x1 = clamp(r.ballX + h, -HALF_W + 2 * BRIDGE_HALF, HALF_W);
      this.bridges.push({ o: o.id, x0, x1 });
      a.gap = o; a.gx0 = x0; a.gx1 = x1;
      this.events.bridge?.(r, o, x0, x1);
      r.size = 0;
      r.ballX = r.x;
      return;
    }
    a.gap = o;
    r.state = 'fall';
    r.stateT = 0;
    r.boostT = 0;
    this.events.fall?.(r, o);
  }

  private _pickups(r: Racer, a: Aux) {
    const pk = this.pk;
    while (a.pc < pk.length && pk[a.pc].d < r.d - 3) a.pc++;
    const mag = r.stats.magnet, rad = r.size / 10, reach = r.ballD + rad + mag + 0.5, R = rad * 0.8 + 0.35;
    for (let i = a.pc; i < pk.length; i++) {
      const p = pk[i];
      if (p.d > reach) break;
      if (this.taken.has(p.id)) continue;
      const dx = p.x - r.x, dd = p.d - r.d, bx = p.x - r.ballX, bd = p.d - r.ballD;
      if (dx * dx + dd * dd > mag * mag && (r.size <= 0 || bx * bx + bd * bd > R * R)) continue;
      this.taken.add(p.id);
      let power: PowerUp | null = null;
      if (p.kind === 'coin') r.coins++;
      else if (p.kind === 'gem') r.gems++;
      else {
        power = POWERS[Math.floor(a.rnd() * POWERS.length)];
        if (power === 'grow' && r.size <= 0) power = 'boost';
        if (power === 'shield') r.shields = Math.min(MAX_SHIELDS, r.shields + 1);
        else if (power === 'boost') this._boost(a, r, GIFT_BOOST_T, GIFT_BOOST_MUL);
        else r.size = Math.min(MAX_SIZE, r.size + GIFT_GROW);
      }
      this.events.pickup?.(r, p, power);
    }
  }

  /** player after the finish: constant speed, bonus walls (per racer), done after the last one or on a shatter */
  private _bonusZone(r: Racer, a: Aux) {
    const walls = this.bonusWalls;
    if (a.bonusI >= walls.length) {
      if (!walls.length || r.d >= walls[walls.length - 1].d + 2) this._done(r);
      return;
    }
    const o = walls[a.bonusI], rad = r.size / 10;
    if (r.ballD + rad < o.d - o.len) return;
    if (r.size > 0 && r.size >= o.strength) {
      r.size = Math.max(MIN_SIZE, r.size - BONUS_COST * o.strength);
      r.mult = o.mult ?? 1;
      a.bonusI++;
      this.broken.add(o.id);
      this.events.bonus?.(r, o);
    } else {
      this.events.shatter?.(r, 'bonus', o);
      r.size = 0;
      r.ballX = r.x;
      this._done(r);
    }
  }

  /** finish line: places by who crossed first within the step */
  private _finishLine() {
    const fin = this.level.finishD, c = this._cross;
    c.length = 0;
    for (const r of this.racers) if (!r.place && r.d >= fin && (r.state === 'run' || r.state === 'stun')) c.push(r);
    if (!c.length) return;
    c.sort((p, q) => (q.d - fin) / Math.max(0.1, q.speed) - (p.d - fin) / Math.max(0.1, p.speed));
    for (const r of c) {
      const a = this._aux[r.id];
      r.place = this.order.length + 1;
      r.finishTime = this.time - this.startTime;
      this.order.push(r);
      r.state = 'finished';
      r.stateT = 0;
      a.bonusSpeed = clamp(r.speed, BASE_SPEED * 0.9, BASE_SPEED * 1.35);
      a.stopD = fin + BOT_STOP - 1 + r.place * 0.6;
      a.sideX = (r.place % 2 ? -1 : 1) * BOT_SIDE_X;
      this.events.finish?.(r, r.place);
    }
  }

  /** racers push each other apart sideways (balls and bodies are circles; bigger = heavier); no damage */
  private _collide(dt: number) {
    const R = this.racers, N = R.length, maxPush = PUSH_SPEED * dt;
    for (let i = 0; i < N; i++) {
      const p = R[i];
      if ((p.state !== 'run' && p.state !== 'stun') || this._aux[i].gap) continue;
      for (let j = i + 1; j < N; j++) {
        const q = R[j];
        if ((q.state !== 'run' && q.state !== 'stun') || this._aux[j].gap) continue;
        const rp = p.size / 10, rq = q.size / 10;
        let push = 0, bump = false;
        if (p.size > 0 && q.size > 0) { const v = sep(p.ballX, p.ballD, rp * BALL_SOFT, q.ballX, q.ballD, rq * BALL_SOFT); if (v > 0) { push = v; bump = true; } }
        push = Math.max(push, sep(p.x, p.d, BODY_R, q.x, q.d, BODY_R));
        if (p.size > 0) push = Math.max(push, sep(p.ballX, p.ballD, rp, q.x, q.d, BODY_R));
        if (q.size > 0) push = Math.max(push, sep(p.x, p.d, BODY_R, q.ballX, q.ballD, rq));
        if (push <= 0) continue;
        const dir = p.x > q.x || (p.x === q.x && i < j) ? 1 : -1;
        const mp = p.size * p.size + 4, mq = q.size * q.size + 4, k = Math.min(push, maxPush);
        const dp = (dir * k * mq) / (mp + mq), dq = (-dir * k * mp) / (mp + mq);
        p.x = clamp(p.x + dp, -X_LIMIT, X_LIMIT); p.ballX += dp;
        q.x = clamp(q.x + dq, -X_LIMIT, X_LIMIT); q.ballX += dq;
        const key = i * N + j;
        if (bump && this.time - this._lastBump[key] >= BUMP_GAP) { this._lastBump[key] = this.time; this.events.bump?.(p, q); }
      }
    }
  }

  /** live positions: finished racers by place, the rest by distance; overtake events */
  private _updatePos(emit: boolean) {
    const rk = this._rank;
    for (let i = 1; i < rk.length; i++) {
      const r = rk[i];
      let j = i - 1;
      while (j >= 0 && before(r, rk[j])) { rk[j + 1] = rk[j]; j--; }
      rk[j + 1] = r;
    }
    for (let i = 0; i < rk.length; i++) rk[i].pos = i + 1;
    const R = this.racers, N = R.length;
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const key = i * N + j, now = R[i].pos < R[j].pos ? 1 : 0;
        if (now === this._ahead[key]) continue;
        this._ahead[key] = now;
        if (!emit || this.time - this._lastOT[key] < OVERTAKE_GAP) continue;
        this._lastOT[key] = this.time;
        if (now) this.events.overtake?.(R[i], R[j]); else this.events.overtake?.(R[j], R[i]);
      }
    }
  }
}

/** a ranks before b */
function before(a: Racer, b: Racer): boolean {
  if (a.place || b.place) return !!a.place && (!b.place || a.place < b.place);
  return a.d > b.d + 1e-6 || (Math.abs(a.d - b.d) <= 1e-6 && a.id < b.id);
}
/** lateral overlap needed to separate two circles (0 = apart) */
function sep(x1: number, d1: number, r1: number, x2: number, d2: number, r2: number): number {
  const R = r1 + r2, dd = d1 - d2;
  if (dd >= R || dd <= -R) return 0;
  const need = Math.sqrt(R * R - dd * dd), dx = Math.abs(x1 - x2);
  return dx < need ? need - dx : 0;
}
function lowerBound(arr: readonly { d: number }[], d: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].d < d) lo = m + 1; else hi = m; }
  return lo;
}
