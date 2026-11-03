// Snowball Rush core: level generator invariants, sim rules, bot races (balance).
import { describe, it, expect } from 'vitest';
import { difficulty, easeFor, expectedSizes, gapAt, generateLevel, newKinds, surfaceAt, wallRows } from '../games/snowball-rush/level';
import { RaceSim, type RacerSetup } from '../games/snowball-rush/sim';
import { BotBrain, applyRubberBand, botSkills, emoteFor, makeOpponents, onlineCount } from '../games/snowball-rush/bots';
import { BASE_SPEED, BONUS_MULTS, BONUS_STRENGTHS, START_SIZE, baseStats } from '../games/snowball-rush/config';
import { HALF_W, SURF, TRACK_W, type LevelData, type Obstacle, type Racer } from '../games/snowball-rush/types';
import { rng } from '../games/snowball-rush/util';

const EASES = [0, 0.15, 0.3, 0.5];
const LEVELS = Array.from({ length: 61 }, (_, i) => i);
const SOLID = new Set(['hammer', 'plow', 'icicle']);

describe('snowball level generator', () => {
  it('difficulty is monotonic and smooth; ease grows with tries and is capped', () => {
    for (let n = 0; n < 100; n++) {
      expect(difficulty(n + 1)).toBeGreaterThan(difficulty(n));
      expect(difficulty(n + 1) - difficulty(n)).toBeLessThan(0.08);
    }
    expect(difficulty(0)).toBe(0);
    expect(difficulty(10)).toBeCloseTo(0.51, 2);
    expect([0, 1, 2, 3, 4, 9].map(easeFor)).toEqual([0, 0.15, 0.3, 0.45, 0.5, 0.5]);
    expect(easeFor(-1)).toBe(0);
  });

  it('introduces kinds on schedule', () => {
    expect(newKinds(0).sort()).toEqual(['spikes', 'wall']);
    expect(newKinds(1)).toEqual([]);
    expect(newKinds(2)).toEqual(['fire']);
    expect(newKinds(4)).toEqual(['gap']);
    expect(newKinds(6)).toEqual(['pusher']);
    expect(newKinds(8)).toEqual(['hammer']);
    expect(newKinds(12)).toEqual(['icicle']);
    expect(newKinds(14)).toEqual(['plow']);
    // nothing appears before its level; the first appearance is a single instance
    const first: Record<string, number> = { fire: 2, gap: 4, pusher: 6, hammer: 8, icicle: 12, plow: 14 };
    for (const [kind, lvl] of Object.entries(first)) {
      for (let n = 0; n < lvl; n++) expect(generateLevel(n).obstacles.some((o) => o.kind === kind), `${kind} in level ${n}`).toBe(false);
      expect(generateLevel(lvl).obstacles.filter((o) => o.kind === kind).length, `${kind} intro`).toBe(1);
    }
    expect(generateLevel(1).surface.includes(SURF.boost)).toBe(true);
    for (let n = 0; n < 10; n++) {
      const s = generateLevel(n).surface;
      expect(s.includes(SURF.thaw) || s.includes(SURF.salt), `surfaces in level ${n}`).toBe(false);
    }
  });

  it('is deterministic per (n, seed, ease)', () => {
    for (const n of [0, 3, 17, 42]) for (const e of EASES) expect(generateLevel(n, 1234 + n, e)).toEqual(generateLevel(n, 1234 + n, e));
    expect(generateLevel(5, 1)).not.toEqual(generateLevel(5, 2));
  });

  it('levels are well-formed and solvable (n = 0..60, all eases)', () => {
    for (const n of LEVELS) for (const e of EASES) {
      const L = generateLevel(n, undefined, e), tag = `n=${n} ease=${e}`;
      const base = e ? generateLevel(n) : L;
      const E = expectedSizes(L), E0 = expectedSizes(base);
      expect(L.finishD).toBe(Math.min(420, 140 + 9 * n));
      expect(L.surface.length).toBe(L.length * TRACK_W);
      expect(L.theme).toBe(n % 4);
      expect(L.botSkill).toBeCloseTo(n === 0 ? 0.15 : 0.2 + 0.65 * difficulty(n) * (1 - e), 6);
      // unique ids
      const ids = [...L.obstacles, ...L.pickups].map((o) => o.id);
      expect(new Set(ids).size, tag).toBe(ids.length);
      // bonus zone: 6 walls after the finish, length = last + 10
      const bonus = L.obstacles.filter((o) => o.kind === 'bonus');
      expect(bonus.map((o) => o.mult)).toEqual(BONUS_MULTS);
      expect(bonus.map((o) => o.strength)).toEqual(BONUS_STRENGTHS);
      bonus.forEach((o, i) => expect(o.d).toBe(L.finishD + 12 + i * 8));
      expect(L.length).toBe(bonus[5].d + 10);
      // bounds: plain snow for the first 15 m and the last 10 m before the finish
      for (const o of L.obstacles) {
        if (o.kind === 'bonus') continue;
        expect(o.d - o.len, `${tag} ${o.kind} start`).toBeGreaterThanOrEqual(15);
        expect(o.d + o.len, `${tag} ${o.kind} end`).toBeLessThanOrEqual(L.finishD - 10);
        expect(Number.isFinite(o.x) && Number.isFinite(o.d)).toBe(true);
        if (o.kind !== 'hammer') expect(Math.abs(o.x) + (o.kind === 'gap' || o.kind === 'wall' ? o.w : 0)).toBeLessThanOrEqual(HALF_W + 1e-6);
        if (o.kind === 'pusher') expect(Math.abs(o.x) + o.amp! + o.w).toBeLessThanOrEqual(HALF_W);
      }
      for (let r = L.finishD - 10; r < L.finishD; r++) for (let c = 0; c < TRACK_W; c++) expect(L.surface[r * TRACK_W + c]).toBe(SURF.snow);
      for (const p of L.pickups) {
        expect(p.d).toBeGreaterThanOrEqual(5);
        expect(p.d).toBeLessThan(L.finishD);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(6);
      }
      const count = (k: string) => L.pickups.filter((p) => p.kind === k).length;
      expect(count('coin'), tag).toBeGreaterThanOrEqual(40);
      expect(count('coin'), tag).toBeLessThanOrEqual(90);
      expect(count('gift'), tag).toBeGreaterThanOrEqual(1);
      expect(count('gift'), tag).toBeLessThanOrEqual(3);
      expect(count('gem'), tag).toBeLessThanOrEqual(1);
      // every row keeps a snow band (growth always possible)
      for (let r = 0; r < L.finishD; r++) {
        if (gapAt(L, r + 0.5)) continue;
        let snow = 0;
        for (let c = 0; c < TRACK_W; c++) if (L.surface[r * TRACK_W + c] === SURF.snow) snow++;
        expect(snow, `${tag} row ${r}`).toBeGreaterThanOrEqual(4);
      }
      // wall rows: tile the track, one section <= 3, the others relative to the expected size
      const rows = wallRows(L);
      expect(rows.length, tag).toBeGreaterThanOrEqual(1);
      for (const row of rows) {
        const sum = row.reduce((a, o) => a + 2 * o.w, 0);
        expect(sum).toBeCloseTo(2 * HALF_W, 6);
        expect(row.length).toBeGreaterThanOrEqual(2);
        expect(row.length).toBeLessThanOrEqual(4);
        expect(Math.min(...row.map((o) => o.strength)), tag).toBeLessThanOrEqual(3);
        const e0 = E0[Math.floor(row[0].d)];
        for (const o of row) {
          expect(o.strength).toBeLessThanOrEqual(30);
          if (o.strength > 3) expect(o.strength, `${tag} wall ${o.strength} vs E ${e0}`).toBeLessThanOrEqual(Math.min(30, Math.ceil(1.4 * 1.08 * e0) + 1));
        }
      }
      // holes: requirement <= 0.75 x expected size, 25 m clean snow runway before
      for (const g of L.obstacles.filter((o) => o.kind === 'gap')) {
        const start = g.d - g.len;
        expect(g.strength, tag).toBeLessThanOrEqual(0.75 * E[Math.floor(start)] + 1e-6);
        expect(g.strength).toBeGreaterThanOrEqual(START_SIZE);
        for (let r = Math.floor(start) - 25; r < Math.floor(start); r++) for (let c = 0; c < TRACK_W; c++) expect(L.surface[r * TRACK_W + c], `${tag} runway`).toBe(SURF.snow);
        expect(L.obstacles.some((o) => o !== g && o.d + o.len > start - 25 && o.d - o.len < start), `${tag} runway clear`).toBe(false);
      }
      expectNeverBlocked(L, tag);
    }
  });

  it('retries keep the layout and never make a level harder', () => {
    for (const n of LEVELS) {
      const levels = EASES.map((e) => generateLevel(n, undefined, e));
      for (let i = 1; i < levels.length; i++) {
        const a = levels[i - 1], b = levels[i], tag = `n=${n} ease=${EASES[i]}`;
        expect(b.obstacles.length, tag).toBeLessThanOrEqual(a.obstacles.length);
        expect(b.botSkill).toBeLessThanOrEqual(a.botSkill);
        expect(b.pickups.map((p) => [p.id, p.kind, p.d, p.x])).toEqual(a.pickups.map((p) => [p.id, p.kind, p.d, p.x]));
        expect(wallRows(b).map((r) => r.map((o) => [o.id, o.x, o.w]))).toEqual(wallRows(a).map((r) => r.map((o) => [o.id, o.x, o.w])));
        const byId = new Map(a.obstacles.map((o) => [o.id, o]));
        for (const o of b.obstacles) {
          const p = byId.get(o.id)!;
          expect(p, `${tag} ${o.kind} ${o.id} exists before`).toBeTruthy();
          expect([o.kind, o.d, o.x]).toEqual([p.kind, p.d, p.x]);
          expect(o.strength, `${tag} ${o.kind}`).toBeLessThanOrEqual(p.strength);
          if (o.speed !== undefined) expect(o.speed).toBeLessThanOrEqual(p.speed! + 1e-9);
          if (o.period !== undefined) expect(o.period).toBeGreaterThanOrEqual(p.period! - 1e-9);
        }
      }
    }
  });

  it('surfaceAt / gapAt', () => {
    const L = LEVELS.map((n) => generateLevel(n)).find((l) => l.obstacles.some((o) => o.kind === 'gap'))!;
    const g = L.obstacles.find((o) => o.kind === 'gap')!;
    expect(gapAt(L, g.d)).toBe(g);
    expect(gapAt(L, g.d - g.len - 0.01)).toBe(null);
    expect(surfaceAt(L, 0, g.d)).toBe(-1);
    expect(surfaceAt(L, 7, 10)).toBe(-1);
    expect(surfaceAt(L, 0, -1)).toBe(-1);
    expect(surfaceAt(L, 6.5, 3)).toBe(SURF.snow);
    expect(surfaceAt(L, -6.5, 3)).toBe(SURF.snow);
  });
});

/** indestructible obstacles never block the whole track at once: at least 3 m stays free */
function expectNeverBlocked(L: LevelData, tag: string) {
  const solid = L.obstacles.filter((o) => SOLID.has(o.kind));
  if (!solid.length) return;
  const sim = new RaceSim(L, []);
  for (const o of solid) {
    const group = solid.filter((q) => Math.abs(q.d - o.d) < q.len + o.len + 1);
    for (let t = 0; t < 12; t += 0.2) {
      const iv: [number, number][] = group.map((q) => {
        const x = q.kind === 'icicle' ? q.x : sim.obstacleX(q, t), w = q.kind === 'hammer' ? 0.75 : q.w;
        return [x - w, x + w];
      });
      iv.sort((a, b) => a[0] - b[0]);
      let free = 0, at = -HALF_W;
      for (const [a, b] of iv) { free = Math.max(free, a - at); at = Math.max(at, b); }
      free = Math.max(free, HALF_W - at);
      expect(free, `${tag} blocked at d=${o.d} t=${t}`).toBeGreaterThanOrEqual(3);
    }
  }
}

// ------------------------------------------------------------------------------------------------ sim rules
function profile(i: number) { return { name: 'r' + i, skin: 'noob', ball: 'snow', trophies: 0, level: 1, isBot: i > 0 }; }
function setups(n: number, skill = 0.5): RacerSetup[] {
  return Array.from({ length: n }, (_, i) => ({ profile: profile(i), isPlayer: i === 0, stats: baseStats(), skill }));
}
/** a hand-made level: plain snow + the given obstacles */
function custom(obstacles: Obstacle[], finishD = 120): LevelData {
  const L = generateLevel(0);
  return { ...L, finishD, length: finishD + 62, surface: new Uint8Array((finishD + 62) * TRACK_W), obstacles: [...obstacles, ...L.obstacles.filter((o) => o.kind === 'bonus').map((o) => ({ ...o, d: o.d - 140 + finishD }))], pickups: [] };
}
function runUntil(sim: RaceSim, cond: () => boolean, maxT = 120) {
  for (let t = 0; t < maxT && !cond(); t += 1 / 60) sim.step(1 / 60);
}

describe('snowball sim rules', () => {
  it('a too-small ball chips a wall until it breaks: nobody gets trapped', () => {
    const wall: Obstacle = { id: 1, kind: 'wall', d: 30, x: 0, w: HALF_W, len: 0.5, strength: 30 };
    const L = custom([wall]);
    let shatters = 0, smashed = false;
    const sim = new RaceSim(L, setups(1), { shatter: () => shatters++, smash: () => { smashed = true; } });
    sim.start();
    runUntil(sim, () => sim.player.d > 32, 60);
    expect(smashed).toBe(true);
    expect(shatters).toBeGreaterThan(1);
    expect(sim.player.d).toBeGreaterThan(32);
  });

  it('smashing costs size, the wall stays broken for everybody', () => {
    const wall: Obstacle = { id: 1, kind: 'wall', d: 40, x: 0, w: HALF_W, len: 0.5, strength: 8 };
    const sizes: number[] = [];
    let smashes = 0;
    const sim = new RaceSim(custom([wall]), setups(2), { smash: (r) => { smashes++; sizes.push(r.size); } });
    sim.start();
    let before = 0;
    runUntil(sim, () => { if (sim.broken.has(1)) return true; before = Math.max(...sim.racers.map((r) => r.size)); return false; });
    expect(smashes).toBe(1);
    expect(sizes[0]).toBeLessThan(before);
    runUntil(sim, () => sim.racers.every((r) => r.d > 42));
    expect(smashes).toBe(1);
    expect(sim.racers.every((r) => r.state === 'run')).toBe(true);
  });

  it('holes: a big ball bridges, followers roll over, a small ball falls and respawns', () => {
    const gap: Obstacle = { id: 1, kind: 'gap', d: 50, x: 0, w: HALF_W, len: 1.5, strength: 10 };
    const ev: string[] = [];
    const sim = new RaceSim(custom([gap]), setups(2), { bridge: () => ev.push('bridge'), fall: () => ev.push('fall'), respawn: () => ev.push('respawn') });
    const [a, b] = sim.racers;
    b.x = b.targetX = b.ballX = 0;
    sim.start();
    runUntil(sim, () => a.d > 30);
    b.d = a.d - 8; // b follows on the same line
    runUntil(sim, () => a.size === 0, 10);
    expect(ev).toEqual(['bridge']);
    expect(sim.bridges.length).toBe(1);
    runUntil(sim, () => a.size > 0, 10);
    expect(a.size).toBe(START_SIZE); // a new ball after the hole
    expect(a.d).toBeGreaterThan(gap.d + gap.len);
    runUntil(sim, () => b.d > 53, 10);
    expect(ev).toEqual(['bridge']);
    expect(b.size).toBeGreaterThan(10); // rolled over the bridge keeping its ball
    // a racer with a too-small ball falls in and respawns after the hole with a new ball
    const sim2 = new RaceSim(custom([{ ...gap, strength: 25 }]), setups(1), { fall: () => ev.push('fall2'), respawn: () => ev.push('respawn2') });
    sim2.start();
    runUntil(sim2, () => sim2.player.state === 'fall', 30);
    runUntil(sim2, () => sim2.player.state === 'run', 3);
    expect(ev.slice(1)).toEqual(['fall2', 'respawn2']);
    expect(sim2.player.y).toBe(0);
    expect(sim2.player.size).toBe(START_SIZE);
    expect(sim2.player.d).toBeGreaterThan(gap.d + gap.len);
  });

  it('bonus walls: per racer, mult from the last smashed wall, done on a shatter', () => {
    const sim = new RaceSim(custom([]), setups(1));
    sim.start();
    runUntil(sim, () => sim.player.state === 'finished');
    sim.player.size = 30;
    runUntil(sim, () => sim.player.state === 'done');
    expect(sim.player.mult).toBeGreaterThanOrEqual(3);
    let shattered = false;
    const sim2 = new RaceSim(custom([]), setups(1), { shatter: (r, cause) => { shattered = cause === 'bonus'; } });
    sim2.start();
    const first = sim2.bonusWalls[0];
    runUntil(sim2, () => sim2.player.ballD + sim2.player.size / 10 > first.d - first.len - 0.3);
    sim2.player.size = 3;
    runUntil(sim2, () => sim2.player.state === 'done');
    expect(shattered).toBe(true);
    expect(sim2.player.mult).toBe(1);
    expect(sim2.player.size).toBe(0);
  });

  it('obstacle helpers', () => {
    const sim = new RaceSim(custom([]), setups(1));
    const ice: Obstacle = { id: 9, kind: 'icicle', d: 30, x: 0, w: 0.8, len: 0.8, strength: Infinity, period: 3, phase: 0 };
    let hits = 0, warn = 0;
    for (let t = 0; t < 3; t += 0.01) { const s = sim.icicleState(ice, t); if (s.hit) hits++; if (s.warn > 0 && !s.hit) warn++; }
    expect(hits).toBeGreaterThan(30);
    expect(hits).toBeLessThan(40);
    expect(warn).toBeGreaterThan(90);
    const plow: Obstacle = { id: 8, kind: 'plow', d: 30, x: 0, w: 1.2, len: 0.8, strength: Infinity, speed: 4, phase: 0 };
    let lo = 0, hi = 0;
    for (let t = 0; t < 10; t += 0.05) { lo = Math.min(lo, sim.obstacleX(plow, t)); hi = Math.max(hi, sim.obstacleX(plow, t)); }
    expect(lo).toBeCloseTo(-5, 1);
    expect(hi).toBeCloseTo(5, 1);
    expect(sim.strengthLeft(plow)).toBe(Infinity);
  });
});

// ------------------------------------------------------------------------------------------------ bot races
interface RaceResult { L: LevelData; player: Racer; racers: Racer[]; finishSize: number; time: number; nan: boolean; doneAll: boolean; bonusEvents: number }
function botRace(n: number, seed: number, ease: number, pskill: number): RaceResult {
  const L = generateLevel(n, seed, ease);
  const sk = botSkills(L, 4, seed);
  const opp = makeOpponents({ trophies: 200, level: n + 1 }, 4, seed);
  const S: RacerSetup[] = [{ profile: profile(0), isPlayer: true, stats: baseStats(), skill: pskill }, ...opp.map((p, i) => ({ profile: p, isPlayer: false, stats: baseStats(), skill: sk[i] }))];
  let bonusEvents = 0;
  const sim = new RaceSim(L, S, { bonus: () => bonusEvents++ });
  const brains = sim.racers.map((r, i) => new BotBrain(r, seed * 31 + i));
  const player = sim.player;
  sim.start();
  const ideal = (L.length + 10) / BASE_SPEED;
  let finishSize = 0, nan = false;
  for (let i = 0; i < ideal * 3 * 60 && !sim.racers.every((r) => r.state === 'done'); i++) {
    for (const b of brains) b.update(sim, 1 / 60);
    applyRubberBand(sim, player, ease);
    sim.step(1 / 60);
    if (!finishSize && player.place) finishSize = player.size;
    if (i % 30 === 0) for (const r of sim.racers) for (const k of ['x', 'd', 'y', 'speed', 'size', 'ballX', 'ballD', 'ballRot', 'rubber', 'targetX'] as const) if (!Number.isFinite(r[k])) nan = true;
  }
  return { L, player, racers: sim.racers, finishSize, time: player.finishTime, nan, doneAll: sim.racers.every((r) => r.state === 'done'), bonusEvents };
}

describe('snowball bot races', () => {
  it('races finish for everybody, places are unique, no NaN (levels 0..60)', () => {
    for (const n of LEVELS) for (let s = 0; s < 2; s++) {
      const R = botRace(n, n * 7919 + 13 + s * 101, s ? 0.3 : 0, 0.6), tag = `n=${n} s=${s}`;
      expect(R.nan, tag).toBe(false);
      expect(R.doneAll, `${tag} everybody done within 3x the ideal time`).toBe(true);
      expect(R.racers.map((r) => r.place).sort()).toEqual([1, 2, 3, 4, 5]);
      for (const r of R.racers) expect(r.finishTime, tag).toBeLessThan((R.L.finishD / BASE_SPEED) * 3);
      // bonus walls: the multiplier matches the walls smashed
      expect(R.player.mult).toBe(R.bonusEvents ? BONUS_MULTS[R.bonusEvents - 1] : 1);
      if (R.finishSize >= 6) expect(R.player.mult, tag).toBeGreaterThan(1);
    }
  }, 120_000);

  it('the first race (level 0) is won by a weak player (skill 0.4) >= 90%', () => {
    let wins = 0;
    const N = 40;
    for (let s = 0; s < N; s++) if (botRace(0, 13 + s * 977, 0, 0.4).player.place === 1) wins++;
    expect(wins / N).toBeGreaterThanOrEqual(0.9);
  }, 60_000);

  it('balance table (skill-0.6 player): early levels mostly top-3, retries help', () => {
    const groups: [number, number][] = [[1, 5], [6, 15], [16, 30], [31, 60]];
    const rows: string[] = ['ease  levels  avg time  size@finish  avg place  top-3  wins'];
    const top3: Record<string, number> = {};
    for (const ease of [0, 0.3]) for (const [a, b] of groups) {
      let k = 0, time = 0, size = 0, place = 0, t3 = 0, win = 0;
      for (let n = a; n <= b; n += b - a > 10 ? 3 : 1) for (let s = 0; s < 6; s++) {
        const R = botRace(n, n * 7919 + 13 + s * 101, ease, 0.6);
        k++; time += R.time; size += R.finishSize; place += R.player.place; t3 += R.player.place <= 3 ? 1 : 0; win += R.player.place === 1 ? 1 : 0;
      }
      top3[`${ease}:${a}`] = t3 / k;
      rows.push(`${ease.toFixed(1).padEnd(5)} ${`${a}-${b}`.padEnd(7)} ${(time / k).toFixed(1).padStart(7)}s ${(size / k).toFixed(1).padStart(11)} ${(place / k).toFixed(2).padStart(10)} ${((t3 / k) * 100).toFixed(0).padStart(5)}% ${((win / k) * 100).toFixed(0).padStart(4)}%`);
    }
    console.log(rows.join('\n'));
    expect(top3['0:1']).toBeGreaterThanOrEqual(0.7);
    for (const [a] of groups) expect(top3[`0.3:${a}`]).toBeGreaterThanOrEqual(top3[`0:${a}`]);
  }, 120_000);
});

describe('snowball fake online', () => {
  it('opponents: >= 120 nicknames, unique per race, deterministic', () => {
    const all = new Set<string>();
    for (let s = 0; s < 400; s++) for (const p of makeOpponents({ trophies: 100, level: 5 }, 4, s)) all.add(p.name);
    expect(all.size).toBeGreaterThanOrEqual(120);
    for (let s = 0; s < 50; s++) {
      const o = makeOpponents({ trophies: 400, level: 10 }, 4, s);
      expect(new Set(o.map((p) => p.name)).size).toBe(4);
      expect(o).toEqual(makeOpponents({ trophies: 400, level: 10 }, 4, s));
      for (const p of o) {
        expect(p.isBot).toBe(true);
        expect(p.trophies).toBeGreaterThanOrEqual(300);
        expect(p.trophies).toBeLessThanOrEqual(500);
      }
    }
    expect(makeOpponents({ trophies: 0, level: 1 }, 4, 1).every((p) => p.trophies >= 0)).toBe(true);
  });

  it('online counter and emotes', () => {
    const t0 = new Date(2026, 11, 20, 0, 0).getTime();
    let prev = onlineCount(t0);
    for (let m = 0; m < 24 * 60; m += 7) {
      const v = onlineCount(t0 + m * 60000);
      expect(v).toBeGreaterThanOrEqual(8000);
      expect(v).toBeLessThanOrEqual(25000);
      expect(Math.abs(v - prev)).toBeLessThan(1500);
      prev = v;
    }
    const r = rng(5);
    let said = 0;
    for (let i = 0; i < 200; i++) { const e = emoteFor('finish1', r); if (e) { said++; expect(typeof e).toBe('string'); } }
    expect(said).toBeGreaterThan(100);
  });
});
