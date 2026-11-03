// Level generator (owner: core). Pure data, deterministic per (n, seed, ease). DESIGN.md §3.
// A level is a sequence of patterns (18–40 m each, chosen by difficulty) separated by plain snow. Layout decisions use
// only the seeded RNG and the base difficulty k0 = difficulty(n), so a retry (ease > 0) keeps the same layout; numbers
// (requirements, speeds) use the eased k = k0 * (1 - ease), and the hardest optional obstacles are dropped.
import type { LevelData, Obstacle, ObstacleKind, PickupKind } from './types';
import { HALF_W, SURF, TRACK_W } from './types';
import { randInt, randRange, rng } from './util';
import {
  BALL_AHEAD, BONUS_FIRST, BONUS_MULTS, BONUS_STEP, BONUS_STRENGTHS, FINISH_BASE, FINISH_MAX, FINISH_PER_LEVEL,
  GROW_RATE, GROW_SOFT, HAMMER_ARM, HAMMER_HEAD, MAX_SIZE, SMASH_COST, START_D, START_SIZE,
} from './config';

/** smooth difficulty 0..1 of level n (before easing) */
export function difficulty(n: number): number { return 1 - Math.exp(-Math.max(0, n) / 14); }
/** easing 0..0.5 from failed attempts on the level: every retry is a bit easier */
export function easeFor(tries: number): number { return Math.min(0.5, (15 * Math.max(0, Math.floor(tries))) / 100); }

/** level where each obstacle kind appears for the first time */
export const KIND_LEVEL: Record<ObstacleKind, number> = { spikes: 0, wall: 0, bonus: 0, fire: 2, gap: 4, pusher: 6, hammer: 8, icicle: 12, plow: 14 };
/** level where each special surface appears for the first time */
export const SURF_LEVEL = { boost: 1, ice: 10, thaw: 10, salt: 10 } as const;
export type SurfName = keyof typeof SURF_LEVEL;

/** obstacle kinds that appear for the first time in level n (intro cards) */
export function newKinds(n: number): ObstacleKind[] {
  return (['spikes', 'wall', 'fire', 'gap', 'pusher', 'hammer', 'icicle', 'plow'] as const).filter((k) => KIND_LEVEL[k] === n);
}
/** special surfaces first appearing in level n (boost pads at 1; ice/thaw/salt at 10) — for hints */
export function newSurfaces(n: number): SurfName[] {
  return (Object.keys(SURF_LEVEL) as SurfName[]).filter((k) => SURF_LEVEL[k] === n);
}
/** finish distance of level n */
export function finishFor(n: number): number { return Math.min(FINISH_MAX, FINISH_BASE + FINISH_PER_LEVEL * Math.max(0, n)); }

// ------------------------------------------------------------------------------------------------ expected size model
/** realism factor: a typical racer doesn't roll on snow 100% of the time */
const REAL = 0.92;
/** rows whose ball center is ahead of the start line: the model starts here with a start-size ball */
const MODEL_ROW0 = Math.floor(START_D + START_SIZE / 10 + BALL_AHEAD);
const growM = (s: number) => Math.min(MAX_SIZE, s + (GROW_RATE * REAL) / (1 + s / GROW_SOFT));
function snowCells(surf: Uint8Array, r: number): number {
  let n = 0;
  for (let c = 0, i = r * TRACK_W; c < TRACK_W; c++, i++) if (surf[i] === SURF.snow) n++;
  return n;
}
/** one row of the model: `cost` = wall cost in this row, `hole` = the row is a hole (ball consumed / fell) */
function modelRow(s: number, surf: Uint8Array, r: number, cost: number, hole: number): number {
  if (hole) return START_SIZE;
  s = Math.max(START_SIZE, s - cost);
  return snowCells(surf, r) >= 4 ? growM(s) : s;
}
/** wall row cost in the model: the racer takes the second-cheapest section */
function rowCost(strengths: number[]): number {
  const s = strengths.slice().sort((a, b) => a - b);
  return SMASH_COST * (s.length > 1 ? s[1] : s[0]);
}

/**
 * Expected ball size when the ball center enters each row (index = row), for a racer without upgrades rolling on snow:
 * growth on rows with snow, the second-cheapest section of every wall row smashed, a hole resets the ball.
 * The generator sets requirements from this model; tests check solvability with it.
 */
export function expectedSizes(L: LevelData): Float32Array {
  const rows = L.length, cost = new Float32Array(rows + 1), hole = new Uint8Array(rows + 1);
  const walls = new Map<number, number[]>();
  for (const o of L.obstacles) {
    if (o.kind === 'wall') {
      const r = Math.floor(o.d);
      const a = walls.get(r);
      if (a) a.push(o.strength); else walls.set(r, [o.strength]);
    } else if (o.kind === 'gap') {
      for (let r = Math.floor(o.d - o.len); r <= Math.floor(o.d + o.len) && r <= rows; r++) hole[r] = 1;
    }
  }
  for (const [r, s] of walls) if (r <= rows) cost[r] = rowCost(s);
  const E = new Float32Array(rows + 1);
  let s = START_SIZE;
  for (let r = 0; r <= rows; r++) {
    E[r] = s;
    if (r >= MODEL_ROW0 && r < rows) s = modelRow(s, L.surface, r, cost[r], hole[r]);
  }
  return E;
}

// ------------------------------------------------------------------------------------------------ helpers for others
const gapCache = /* @__PURE__ */ new WeakMap<LevelData, Obstacle[]>();
function gapsOf(L: LevelData): Obstacle[] {
  let g = gapCache.get(L);
  if (!g) { g = L.obstacles.filter((o) => o.kind === 'gap'); gapCache.set(L, g); }
  return g;
}
/** the hole (kind 'gap') covering distance d, if any */
export function gapAt(L: LevelData, d: number): Obstacle | null {
  for (const o of gapsOf(L)) if (d >= o.d - o.len && d < o.d + o.len) return o;
  return null;
}
/** surface code (SURF) at a world point, -1 outside the track / over a hole */
export function surfaceAt(L: LevelData, x: number, d: number): number {
  if (d < 0 || d >= L.length || x < -HALF_W || x > HALF_W || gapAt(L, d)) return -1;
  return L.surface[Math.floor(d) * TRACK_W + Math.min(TRACK_W - 1, Math.floor(x + HALF_W))];
}
/** wall rows (sections sharing the same d) in track order, sections sorted by x */
export function wallRows(L: LevelData): Obstacle[][] {
  const rows: Obstacle[][] = [];
  const walls = L.obstacles.filter((o) => o.kind === 'wall').sort((a, b) => a.d - b.d || a.x - b.x);
  for (const o of walls) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0].d - o.d) < 0.01) last.push(o); else rows.push([o]);
  }
  return rows;
}

// ------------------------------------------------------------------------------------------------ generator
interface Spot { d: number; x: number; risk: number; wall: Obstacle | null }
interface Gen {
  L: LevelData;
  n: number;
  /** base difficulty (layout decisions) and eased difficulty (numbers) */
  k0: number;
  k: number;
  rnd: () => number;
  id: number;
  finishD: number;
  /** cells blocked by static obstacles (no coins there) */
  occ: Uint8Array;
  /** expected-size model state: wall cost / hole per row, integrated up to eRow */
  cost: Float32Array;
  hole: Uint8Array;
  eRow: number;
  eVal: number;
  /** obstacle id → hardness (ease drops the hardest optional obstacles first); `keep` = never dropped */
  hard: Map<number, number>;
  keep: Set<number>;
  spots: Spot[];
  /** plain stretches between patterns [d0, d1] (coin fill) */
  free: number[];
  /** obstacle kind introduced in this level (single calm instance only) */
  intro: string | null;
  /** wall rows placed so far */
  rows: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** eased value: numbers that make the level harder interpolate on k */
const kv = (g: Gen, a: number, b: number) => lerp(a, b, g.k);

/** expected ball size when the ball center reaches distance d (base layout) */
function eAt(g: Gen, d: number): number {
  const row = Math.floor(d);
  while (g.eRow < row) {
    if (g.eRow >= MODEL_ROW0) g.eVal = modelRow(g.eVal, g.L.surface, g.eRow, g.cost[g.eRow], g.hole[g.eRow]);
    g.eRow++;
  }
  return g.eVal;
}

function addObs(g: Gen, kind: ObstacleKind, d: number, x: number, w: number, len: number, strength: number, extra?: Partial<Obstacle>, hardness = 0): Obstacle {
  const o: Obstacle = { id: g.id++, kind, d, x, w, len, strength, ...extra };
  g.L.obstacles.push(o);
  if (hardness > 0) g.hard.set(o.id, hardness);
  if (g.intro === kind) g.keep.add(o.id);
  return o;
}
/** mark cells covered by a static obstacle (+ margin) as blocked for coins */
function block(g: Gen, d0: number, d1: number, x0: number, x1: number) {
  const L = g.L;
  for (let r = Math.max(0, Math.floor(d0)); r <= Math.min(L.length - 1, Math.floor(d1)); r++)
    for (let c = Math.max(0, Math.floor(x0 + HALF_W)); c <= Math.min(TRACK_W - 1, Math.floor(x1 + HALF_W)); c++) g.occ[r * TRACK_W + c] = 1;
}
function setSurf(g: Gen, d0: number, d1: number, c0: number, c1: number, code: number) {
  for (let r = Math.max(0, Math.floor(d0)); r < Math.min(g.L.length, Math.floor(d1)); r++)
    for (let c = Math.max(0, c0); c <= Math.min(TRACK_W - 1, c1); c++) g.L.surface[r * TRACK_W + c] = code;
}
function pickup(g: Gen, kind: PickupKind, d: number, x: number): boolean {
  x = clamp(x, -5.8, 5.8);
  if (d < 5 || d > g.finishD - 1) return false;
  const i = Math.floor(d) * TRACK_W + Math.floor(x + HALF_W);
  if (g.occ[i]) return false;
  if (kind !== 'coin') {
    // gifts/gems replace coins right next to them
    g.L.pickups = g.L.pickups.filter((p) => p.kind !== 'coin' || Math.abs(p.d - d) > 0.9 || Math.abs(p.x - x) > 0.9);
    g.occ[i] = 1;
  }
  g.L.pickups.push({ id: g.id++, kind, d, x });
  return true;
}
/** straight coin line from (x0, d0) to (x1, d1) */
function coinLine(g: Gen, d0: number, x0: number, d1: number, x1: number, step = 1.5) {
  const n = Math.max(1, Math.round((d1 - d0) / step));
  for (let i = 0; i <= n; i++) pickup(g, 'coin', d0 + ((d1 - d0) * i) / n, x0 + ((x1 - x0) * i) / n);
}
/** coin arc: from (x, d0) bulging sideways by `bulge` in the middle, back to x at d1 */
function coinArc(g: Gen, d0: number, d1: number, x: number, bulge: number, step = 1.4) {
  const n = Math.max(2, Math.round((d1 - d0) / step));
  for (let i = 0; i <= n; i++) { const t = i / n; pickup(g, 'coin', d0 + (d1 - d0) * t, x + bulge * Math.sin(Math.PI * t)); }
}
function spot(g: Gen, d: number, x: number, risk: number, wall: Obstacle | null = null) { g.spots.push({ d, x, risk, wall }); }
/** coin risk: share of coin lines placed on risky lines grows with difficulty */
const risky = (g: Gen) => g.rnd() < lerp(0.3, 0.7, g.k0);
const side = (g: Gen) => (g.rnd() < 0.5 ? -1 : 1);

// ---------------------------------------------------------------- patterns: (g, d0, calm, room) → length used
type Pattern = (g: Gen, d0: number, calm: boolean, room: number) => number;

function boostPad(g: Gen, d: number, x: number) {
  const c = clamp(Math.round(x + HALF_W - 1), 0, TRACK_W - 2);
  setSurf(g, d, d + 2, c, c + 1, SURF.boost);
  coinLine(g, d - 6, c - 6 + 0.5, d - 1.5, c - 6 + 0.5);
}

const snowfield: Pattern = (g, d0) => {
  const len = randInt(g.rnd, 18, 26);
  const x = randRange(g.rnd, -4.5, 4.5), shape = g.rnd();
  if (shape < 0.35) coinLine(g, d0 + 3, x, d0 + len - 3, x);
  else if (shape < 0.75) coinArc(g, d0 + 2, d0 + len - 2, clamp(x, -2, 2), side(g) * randRange(g.rnd, 2, 3.5));
  else { coinLine(g, d0 + 2, x, d0 + 10, -x * 0.5); coinLine(g, d0 + 12, -x, d0 + len - 2, -x); }
  if (g.n >= 1 && (g.rnd() < 0.45 || g.n === 1)) boostPad(g, d0 + len - 6, randRange(g.rnd, -4, 4));
  if (g.rnd() < 0.15) spot(g, d0 + len * 0.5, randRange(g.rnd, -5, 5), 0.1);
  return len;
};

const spikes: Pattern = (g, d0, calm) => {
  const gap = calm ? 8 : lerp(7, 4.2, g.k0) + g.rnd();
  const cnt = calm ? 3 : Math.min(Math.floor(32 / gap) + 1, clamp(Math.round(lerp(3, 7, g.k0) + g.rnd() * 1.5), 3, 8));
  const E = eAt(g, d0);
  let s = side(g);
  const coinRisk = risky(g);
  // harder levels: a sliding gift box replaces the middle spike
  const mid = !calm && g.n >= KIND_LEVEL.pusher + 2 && g.rnd() < 0.4 * g.k0 ? cnt >> 1 : -1;
  for (let i = 0; i < cnt; i++) {
    const d = d0 + 4 + i * gap, w = randRange(g.rnd, 0.7, 1.0), jit = g.rnd();
    if (i === mid) {
      const amp = randRange(g.rnd, 2.5, 4), sj = randRange(g.rnd, 0.9, 1.1), phase = g.rnd() * Math.PI * 2;
      addObs(g, 'pusher', d, 0, 0.8, 0.8, Math.round(kv(g, 14, 20)), { amp, speed: kv(g, 0.9, 1.8) * sj, phase }, lerp(0.9, 1.8, g.k0) * sj * amp * 1.6);
      continue;
    }
    const pair = !calm && g.k0 > 0.3 && g.rnd() < 0.55 * g.k0;
    // strength: 8..16 by difficulty, more on later (bigger-ball) stretches of hard levels
    const str = (kk: number) => Math.round(clamp(Math.max(lerp(8, 16, kk), E * lerp(0.35, 0.75, kk)) + jit * 3 - 1, 5, 26));
    const st = calm ? 6 : str(g.k), hard = str(g.k0) + (pair ? 4 : 0);
    if (pair) {
      const a = randRange(g.rnd, 3.2, 4.6);
      for (const sx of [-1, 1]) { addObs(g, 'spikes', d, sx * a, w, 0.5, st, undefined, hard); block(g, d - 1, d + 1, sx * a - w - 0.4, sx * a + w + 0.4); }
      pickup(g, 'coin', d, 0);
    } else {
      const x = s * randRange(g.rnd, 1.2, 4.2);
      addObs(g, 'spikes', d, x, w, 0.5, st, undefined, hard);
      block(g, d - 1, d + 1, x - w - 0.4, x + w + 0.4);
      // coins: right next to the spikes (risky) or on the open side
      const cx = coinRisk ? x - s * (w + 0.9) : -s * randRange(g.rnd, 2, 4.5);
      coinLine(g, d - 1.5, cx, d + 1.5, cx);
      if (coinRisk && i === cnt - 1) spot(g, d + 2, x, 0.5);
    }
    if (g.rnd() < 0.8) s = -s;
  }
  return 4 + (cnt - 1) * gap + 5;
};

/** harder levels mix mechanics: an ice stripe or a thaw patch along one side of a hazard pattern (a snow band stays) */
function overlay(g: Gen, d0: number, len: number) {
  if (g.n < SURF_LEVEL.ice || g.rnd() >= 0.45 * g.k0) return;
  const left = g.rnd() < 0.5, c0 = left ? 0 : 8, c1 = left ? 4 : 12;
  if (g.rnd() < 0.7) setSurf(g, d0 + 2, d0 + len - 2, c0, c1, SURF.ice);
  else { const a = d0 + 3 + Math.floor(g.rnd() * Math.max(1, len - 12)); setSurf(g, a, a + 5, c0 + 1, c1 - 1, SURF.thaw); }
}

/** one row of wall sections across the track: a weak one (≤ 3, at an inconvenient spot) + 0.6x/1.0x/1.4x of the expected size */
function wallRow(g: Gen, d: number, calm: boolean) {
  const E = eAt(g, d);
  const four = !calm && g.k0 > 0.25 && g.rnd() < 0.35 + 0.5 * g.k0;
  const rels = four ? [0.6, 1.0, 1.4] : calm || g.rnd() < 0.7 - 0.4 * g.k0 ? [0.6, 1.0] : [0.6, 1.4];
  const m = rels.length + 1;
  // weak section: usually at an edge, sometimes squeezed between strong ones
  const weakI = g.rnd() < 0.7 ? (g.rnd() < 0.5 ? 0 : m - 1) : 1 + Math.floor(g.rnd() * (m - 2));
  const order = rels.slice();
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(g.rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  order.splice(weakI, 0, 0);
  const weakW = lerp(3.0, 2.2, g.k0) + g.rnd() * 0.4;
  const ws = order.map((r) => (r === 0 ? 0 : 0.85 + 0.3 * g.rnd()));
  const sum = ws.reduce((a, b) => a + b, 0);
  const weakStr = calm ? 3 : 2 + (g.rnd() < 0.5 ? 1 : 0);
  const sc0 = 0.72 + 0.28 * g.k0, sc = 0.72 + 0.28 * g.k;
  let x = -HALF_W;
  const base: number[] = [], made: Obstacle[] = [];
  for (let i = 0; i < m; i++) {
    const rel = order[i], wd = rel === 0 ? weakW : ((2 * HALF_W - weakW) * ws[i]) / sum;
    const jit = 0.92 + 0.16 * g.rnd();
    const s0 = rel === 0 ? weakStr : clamp(Math.round(E * rel * sc0 * jit), 4, 30);
    const s = rel === 0 ? weakStr : clamp(Math.round(E * rel * sc * jit), 4, 30);
    base.push(s0);
    made.push(addObs(g, 'wall', d, x + wd / 2, wd / 2, 0.5, s));
    x += wd;
  }
  g.cost[Math.floor(d)] = rowCost(base);
  g.rows++;
  block(g, d - 1, d + 1, -HALF_W, HALF_W);
  // rewards: coins right behind the strongest section (+ gift/gem spot), a coin trail into the comfortable one
  // (chosen by the base strengths: the layout must not depend on ease)
  let si = 0, ci = 0;
  for (let i = 0; i < m; i++) { if (base[i] > base[si]) si = i; if (order[i] === 0.6) ci = i; }
  const strong = made[si], comfy = made[ci];
  coinLine(g, d + 2, strong.x, d + 5, strong.x, 1);
  spot(g, d + 2.5, strong.x, 0.9, strong);
  if (g.rnd() < 0.6) coinLine(g, d - 7, comfy.x + randRange(g.rnd, -1, 1), d - 2.5, comfy.x);
}

const gates: Pattern = (g, d0, calm, room) => {
  const two = !calm && g.k0 > 0.4 && g.rnd() < g.k0 * 0.6 && room >= 32;
  wallRow(g, d0 + 6, calm);
  if (two) wallRow(g, d0 + 22, false);
  return two ? 32 : 16;
};

const fire: Pattern = (g, d0, calm) => {
  const cnt = calm ? 1 : clamp(1 + Math.floor(g.rnd() * (1 + 2 * g.k0)), 1, 3);
  const E = eAt(g, d0);
  const slots = [-4, 0, 4];
  for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(g.rnd() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
  for (let i = 0; i < cnt; i++) {
    const d = d0 + 5 + i * 5.5, x = calm ? randRange(g.rnd, -1.5, 1.5) : slots[i] + randRange(g.rnd, -0.8, 0.8), w = randRange(g.rnd, 0.9, 1.25);
    const jit = g.rnd();
    const str = (kk: number) => Math.round(clamp(Math.max(lerp(18, 26, kk), E * lerp(0.75, 1.05, kk)) + jit * 2, 14, 29));
    addObs(g, 'fire', d, x, w, w, calm ? 16 : str(g.k), undefined, str(g.k0) * 0.5 + 3);
    block(g, d - w - 0.6, d + w + 0.6, x - w - 0.6, x + w + 0.6);
    if (risky(g)) { coinArc(g, d - 3, d + 3, x + (x > 0 ? -1 : 1) * (w + 0.4), (x > 0 ? -1 : 1) * 0.8, 1.2); spot(g, d + w + 1.5, x, 0.6); }
    else coinLine(g, d - 2, x > 0 ? x - 4 : x + 4, d + 2, x > 0 ? x - 4 : x + 4);
  }
  return 5 + (cnt - 1) * 5.5 + 7;
};

/** ice hole across the track after a 25+ m snow runway; requirement ≤ 0.75 × expected size */
const gap: Pattern = (g, d0, calm) => {
  const runway = 25 + Math.floor(g.rnd() * 4);
  const len = calm ? 1 : Math.round(lerp(1.0, 1.5, g.k0) * 2) / 2;
  const start = d0 + runway, d = start + len;
  coinLine(g, d0 + 4, randRange(g.rnd, -3, 3), start - 4, randRange(g.rnd, -3, 3));
  const E = eAt(g, start);
  const need = (kk: number) => clamp(Math.round(E * lerp(0.45, 0.72, kk)), 3, Math.floor(0.75 * E));
  addObs(g, 'gap', d, 0, HALF_W, len, calm ? Math.min(need(0), Math.floor(0.75 * E)) : need(g.k));
  for (let r = Math.floor(start); r <= Math.floor(d + len); r++) g.hole[r] = 1;
  block(g, start - 0.5, d + len + 0.5, -HALF_W, HALF_W);
  coinLine(g, d + len + 1.5, randRange(g.rnd, -2, 2), d + len + 4.5, 0);
  return runway + 2 * len + 6;
};

const pusher: Pattern = (g, d0, calm) => {
  const cnt = calm ? 1 : clamp(1 + Math.floor(g.rnd() * (1 + 2.2 * g.k0)), 1, 3);
  for (let i = 0; i < cnt; i++) {
    const d = d0 + 5 + i * 8, x = calm ? 0 : randRange(g.rnd, -2, 2);
    const amp = calm ? 2.5 : Math.min(5.2 - Math.abs(x), randRange(g.rnd, 2.2, 4));
    const sj = randRange(g.rnd, 0.9, 1.1), phase = g.rnd() * Math.PI * 2;
    addObs(g, 'pusher', d, x, 0.8, 0.8, Math.round(calm ? 14 : kv(g, 14, 20)), { amp, speed: (calm ? 0.9 : kv(g, 0.9, 2.0)) * sj, phase }, lerp(0.9, 2.0, g.k0) * sj * amp * 1.6);
    if (risky(g)) { coinLine(g, d, x - amp, d, x + amp, 1.3); spot(g, d + 2, x, 0.5); }
    else { const cx = x > 0 ? x - amp - 1.6 : x + amp + 1.6; coinLine(g, d - 2, cx, d + 2, cx); }
  }
  return 5 + (cnt - 1) * 8 + 6;
};

const hammer: Pattern = (g, d0, calm) => {
  const cnt = calm ? 1 : clamp(1 + Math.floor(g.rnd() * (1 + 2 * g.k0)), 1, 3);
  let s = side(g);
  for (let i = 0; i < cnt; i++) {
    const d = d0 + 6 + i * 9, x = s * (calm ? 3 : randRange(g.rnd, 2.8, 3.4)); // the far side always stays free
    const sj = randRange(g.rnd, 0.9, 1.1), phase = g.rnd() * Math.PI * 2;
    addObs(g, 'hammer', d, x, HAMMER_ARM, HAMMER_HEAD, Infinity, { speed: (calm ? 1.3 : kv(g, 1.4, 2.4)) * sj, phase }, lerp(1.4, 2.4, g.k0) * sj * 4);
    if (risky(g)) { coinLine(g, d - 1.5, x, d + 1.5, x, 1); spot(g, d, x, 0.7); }
    else coinLine(g, d - 2, -s * 5, d + 2, -s * 5);
    s = -s;
  }
  return 6 + (cnt - 1) * 9 + 5;
};

const plow: Pattern = (g, d0, calm) => {
  // two plows only far apart: a big ball needs the plow on the other side while it passes
  const two = !calm && g.k0 > 0.6 && g.rnd() < 0.4;
  const cnt = two ? 2 : 1;
  for (let i = 0; i < cnt; i++) {
    const d = d0 + 6 + i * 18, sj = randRange(g.rnd, 0.9, 1.1), phase = g.rnd() * 2;
    addObs(g, 'plow', d, 0, 1.2, 0.8, Infinity, { speed: (calm ? 2.2 : kv(g, 2.2, 3.6)) * sj, phase }, lerp(2.2, 3.6, g.k0) * sj * 3);
    if (risky(g)) { coinLine(g, d - 1, -3, d + 1, 3, 0.8); spot(g, d + 1.8, randRange(g.rnd, -3, 3), 0.6); }
    else coinLine(g, d - 3, side(g) * 5.5, d + 3, side(g) * 5.5);
  }
  return 6 + (cnt - 1) * 18 + 5;
};

const icicle: Pattern = (g, d0, calm) => {
  const cnt = calm ? 1 : clamp(Math.round(lerp(2, 4.5, g.k0) + g.rnd()), 2, 5);
  const period = (kk: number) => lerp(3.4, 2.2, kk);
  let d = d0 + 4, px = 99;
  for (let i = 0; i < cnt; i++) {
    let x = randRange(g.rnd, -5, 5);
    if (Math.abs(x - px) < 3.5) x = x > 0 ? x - 5.5 : x + 5.5;
    const ph = g.rnd();
    const P = calm ? 3.4 : period(g.k);
    addObs(g, 'icicle', d, x, 0.8, 0.8, Infinity, { period: P, phase: ((i * 0.37 + ph * 0.3) % 1) * P }, 10 / period(g.k0));
    if (risky(g)) { pickup(g, 'coin', d, x); spot(g, d, x, 0.5); }
    px = x;
    d += randRange(g.rnd, 3, 5);
  }
  coinLine(g, d0 + 3, side(g) * randRange(g.rnd, 3, 5.5), d - 1, 0);
  return d - d0 + 4;
};

/** ice lane + thaw/salt patches (+ boost pad); one 4-cell band always stays snow */
const surface: Pattern = (g, d0, calm) => {
  const len = calm ? 20 : randInt(g.rnd, 22, 30);
  const bands = [[0, 3], [4, 8], [9, 12]];
  const snowB = Math.floor(g.rnd() * 3);
  const others = [0, 1, 2].filter((b) => b !== snowB);
  if (g.rnd() < 0.5) others.reverse();
  // ice lane in one band
  const [i0, i1] = bands[others[0]];
  const iceA = d0 + 2, iceB = d0 + 2 + (calm ? 10 : randInt(g.rnd, 10, 18));
  setSurf(g, iceA, iceB, i0, i1, SURF.ice);
  coinLine(g, iceA + 1, (i0 + i1) / 2 - 6, iceB - 1, (i0 + i1) / 2 - 6);
  // thaw patch (+ salt patch) in the other band
  const [t0, t1] = bands[others[1]];
  const tA = d0 + 4 + Math.floor(g.rnd() * 6), tB = tA + (calm ? 4 : randInt(g.rnd, 4, 6));
  setSurf(g, tA, tB, t0, t1, SURF.thaw);
  if (!calm && g.rnd() < 0.4 + 0.5 * g.k0) {
    const sA = tB + 3, sB = sA + randInt(g.rnd, 2, 4), c = t0 + Math.floor(g.rnd() * 2);
    setSurf(g, sA, sB, c, Math.min(t1, c + 2), SURF.salt);
    if (risky(g)) { pickup(g, 'coin', (sA + sB) / 2, c + 1 - 6); spot(g, sB + 1, c + 1 - 6, 0.4); }
  }
  // boost pad after the patches (a snow band must stay ≥ 4 cells in every row)
  const [b0, b1] = bands[snowB], endD = Math.max(iceB, tB + 9);
  if (g.rnd() < 0.6) boostPad(g, endD + 2, (b0 + b1) / 2 - 6 + (g.rnd() - 0.5) * 2);
  else coinArc(g, d0 + 3, endD, (b0 + b1) / 2 - 6, 0);
  return Math.max(len, endD + 6 - d0);
};

interface PatDef { f: Pattern; kind: string; min: number; max: number; w: (k: number) => number }
const PATS: PatDef[] = [
  { f: snowfield, kind: 'snow', min: 0, max: 26, w: (k) => 2.2 - 1.9 * k },
  { f: spikes, kind: 'spikes', min: 0, max: 40, w: () => 1.2 },
  { f: gates, kind: 'wall', min: 0, max: 16, w: (k) => 1.2 + 0.3 * k },
  { f: fire, kind: 'fire', min: KIND_LEVEL.fire, max: 23, w: () => 1 },
  { f: gap, kind: 'gap', min: KIND_LEVEL.gap, max: 38, w: (k) => 0.6 + 0.4 * k },
  { f: pusher, kind: 'pusher', min: KIND_LEVEL.pusher, max: 27, w: () => 1 },
  { f: hammer, kind: 'hammer', min: KIND_LEVEL.hammer, max: 29, w: () => 1 },
  { f: surface, kind: 'surface', min: SURF_LEVEL.ice, max: 30, w: () => 0.8 },
  { f: icicle, kind: 'icicle', min: KIND_LEVEL.icicle, max: 34, w: () => 0.9 },
  { f: plow, kind: 'plow', min: KIND_LEVEL.plow, max: 29, w: (k) => 0.6 + 0.4 * k },
];

function track(g: Gen) {
  const end = g.finishD - 10;
  const wantRows = 1 + Math.floor((g.finishD - 30) / 75);
  let d = 15 + Math.floor(g.rnd() * 4), last = '', lastGap = -1e9, introDone = !g.intro;
  for (;;) {
    const left = end - d;
    if (left < 18) break;
    let def: PatDef | undefined;
    const t = (d - 15) / (end - 15);
    if (!introDone && t >= 0.3) def = PATS.find((p) => p.kind === g.intro);
    else if (g.rows < Math.round(wantRows * t) && last !== 'wall') def = PATS[2]; // wall rows spread evenly
    if (!def) {
      const ahead = g.rows > wantRows * t + 0.5; // ahead of the wall-row schedule: no gates now
      const cands = PATS.filter((p) => p.min <= g.n && p.max <= left && p.kind !== last && p.kind !== g.intro && (p.kind !== 'gap' || d - lastGap > 60) && (p.kind !== 'wall' || !ahead));
      let total = 0;
      const ws = cands.map((p) => {
        const age = g.n - p.min;
        const w = Math.max(0.1, p.w(g.k0)) * (age >= 1 && age <= 4 ? 1.6 : 1);
        total += w;
        return w;
      });
      let x = g.rnd() * total, i = 0;
      while (i < cands.length - 1 && (x -= ws[i]) >= 0) i++;
      def = cands[i] ?? PATS[0];
    }
    const calm = def.kind === g.intro && !introDone;
    if (calm) { introDone = true; d += 6; } // a relaxed stretch around the first appearance
    if (def.kind === 'gap') lastGap = d;
    const len = def.f(g, d, calm, end - d);
    if (!calm && 'spikes fire pusher hammer icicle'.includes(def.kind)) overlay(g, d, len);
    last = def.kind;
    const space = lerp(8, 2, g.k0) + g.rnd() * 3 + (calm ? 6 : 0);
    g.free.push(d + len, d + len + space);
    d += len + space;
  }
}

/** level 0: the tutorial race — lots of snow and coins, an easy slalom, one wall row [3, 9, 14], a boost pad */
function tutorial(g: Gen) {
  coinLine(g, 8, 0, 16, 0);
  coinArc(g, 22, 34, -1.5, -2);
  const s = side(g);
  const sp: [number, number, number][] = [[42, -2.6, 5], [50, 2.4, 6], [58, -2.2, 7]];
  for (const [d, x, st] of sp) {
    addObs(g, 'spikes', d, x * s, 0.9, 0.5, st, undefined, st);
    block(g, d - 1, d + 1, x * s - 1.3, x * s + 1.3);
    coinLine(g, d - 1.5, -x * s * 0.8, d + 1.5, -x * s * 0.8);
  }
  // the wall row: the 3 at an edge, 9 and 14 share the rest; coins behind the 14
  const d = 74, ws = [2.6, 5.0, 5.4], st = [3, 9, 14], dir = side(g);
  let x = -HALF_W;
  const made: Obstacle[] = [];
  for (let i = 0; i < 3; i++) {
    const j = dir > 0 ? i : 2 - i;
    made.push(addObs(g, 'wall', d, x + ws[j] / 2, ws[j] / 2, 0.5, st[j]));
    x += ws[j];
  }
  g.cost[d] = rowCost(st);
  block(g, d - 1, d + 1, -HALF_W, HALF_W);
  const strong = made.find((o) => o.strength === 14)!;
  coinLine(g, d + 2, strong.x, d + 6, strong.x, 1);
  coinArc(g, 86, 104, 0, s * 3);
  spot(g, 96, -s * 3, 0.3);
  coinLine(g, 106, -s * 2, 113, 0);
  boostPad(g, 120, 0);
  coinLine(g, 124, 0, 129, 0);
  g.free.push(64, 72, 108, 118);
}

/** Build level `n` (0-based). Same (n, seed, ease) → same level. A retry (ease > 0) keeps the layout but removes some of
 * the hardest obstacles and lowers requirements and speeds. */
export function generateLevel(n: number, seed = n * 7919 + 13, ease = 0): LevelData {
  n = Math.max(0, Math.floor(n));
  ease = clamp(ease, 0, 0.5);
  const finishD = finishFor(n), length = finishD + BONUS_FIRST + (BONUS_MULTS.length - 1) * BONUS_STEP + 10;
  const k0 = difficulty(n), k = k0 * (1 - ease);
  const L: LevelData = {
    n, seed, length, startD: 0, finishD, surface: new Uint8Array(length * TRACK_W), obstacles: [], pickups: [],
    theme: n % 4, botSkill: n === 0 ? 0.15 : 0.2 + 0.65 * k, ease,
  };
  const g: Gen = {
    L, n, k0, k, rnd: rng(seed ^ 0x5eed), id: 1, finishD, occ: new Uint8Array(length * TRACK_W),
    cost: new Float32Array(length + 1), hole: new Uint8Array(length + 1), eRow: 0, eVal: START_SIZE,
    hard: new Map(), keep: new Set(), spots: [], free: [6, 14], rows: 0, intro: n > 0 ? newKinds(n)[0] ?? (n === SURF_LEVEL.ice ? 'surface' : null) : null,
  };
  if (n === 0) tutorial(g); else track(g);
  g.free.push(finishD - 9, finishD - 2);

  // gifts (1–3) and a gem (35%) on reward spots: the riskiest spot gets the gem; a spot behind a wall marks the section
  const spots = g.spots.sort((a, b) => b.risk - a.risk || a.d - b.d);
  const used: number[] = [];
  const place = (kind: 'gift' | 'gem', sp: Spot) => {
    if (used.some((d) => Math.abs(d - sp.d) < 12)) return false;
    if (!pickup(g, kind, sp.d, sp.x)) return false;
    used.push(sp.d);
    if (sp.wall) sp.wall.reward = kind;
    return true;
  };
  if (n > 0 && g.rnd() < 0.35) for (const sp of spots) if (place('gem', sp)) break;
  const gifts = n === 0 ? 1 : clamp(1 + Math.floor(g.rnd() * (1.5 + 1.5 * k0)), 1, 3);
  let placed = 0;
  for (let tries = 0; placed < gifts && tries < 30 && spots.length; tries++) if (place('gift', spots[Math.floor(g.rnd() * spots.length)])) placed++;
  // not enough spots: a gift on a plain stretch
  for (let tries = 0; placed < gifts && tries < 60; tries++) {
    const i = 2 * Math.floor((g.rnd() * g.free.length) / 2), a = g.free[i], b = g.free[i + 1];
    if (place('gift', { d: a + (b - a) * g.rnd(), x: randRange(g.rnd, -4.5, 4.5), risk: 0, wall: null })) placed++;
  }
  for (const o of L.obstacles) if (o.kind === 'wall' && !o.reward && L.pickups.some((p) => p.kind === 'coin' && Math.abs(p.d - o.d - 2.5) < 2.5 && Math.abs(p.x - o.x) < o.w)) o.reward = 'coins';

  // coins: 40–90 per level
  const coins = () => L.pickups.reduce((a, p) => a + (p.kind === 'coin' ? 1 : 0), 0);
  for (let i = 0; coins() < 40 && i < g.free.length; i += 2) {
    const a = g.free[i] + 1, b = g.free[i + 1] - 1;
    if (b - a >= 3) coinLine(g, a, randRange(g.rnd, -4, 4), b, randRange(g.rnd, -4, 4));
  }
  for (let extra = 0; coins() < 40 && extra < 60; extra++) pickup(g, 'coin', randRange(g.rnd, 8, finishD - 3), randRange(g.rnd, -5, 5));
  const c = coins();
  if (c > 90) {
    // thin out evenly: drop coin #floor((j + 0.5) * c / extra) for j < extra
    const extra = c - 90, drop = new Set<number>();
    for (let j = 0; j < extra; j++) drop.add(Math.floor(((j + 0.5) * c) / extra));
    let i = 0;
    L.pickups = L.pickups.filter((p) => p.kind !== 'coin' || !drop.has(i++));
  }

  // bonus zone after the finish
  for (let i = 0; i < BONUS_MULTS.length; i++)
    addObs(g, 'bonus', finishD + BONUS_FIRST + i * BONUS_STEP, 0, HALF_W, 0.5, BONUS_STRENGTHS[i], { mult: BONUS_MULTS[i] });

  // retries: drop the hardest optional obstacles first (walls, holes and the intro instance stay)
  if (ease > 0) {
    const opt = L.obstacles.filter((o) => g.hard.has(o.id) && !g.keep.has(o.id));
    opt.sort((a, b) => g.hard.get(b.id)! - g.hard.get(a.id)! || a.id - b.id);
    const drop = new Set(opt.slice(0, Math.floor(opt.length * ease * 0.8)).map((o) => o.id));
    L.obstacles = L.obstacles.filter((o) => !drop.has(o.id));
  }
  L.obstacles.sort((a, b) => a.d - b.d || a.id - b.id);
  L.pickups.sort((a, b) => a.d - b.d || a.id - b.id);
  return L;
}

