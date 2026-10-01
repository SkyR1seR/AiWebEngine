// Side-scrolling terrain: levels are 2D polylines (x,y) extruded along Z into blocky Minecraft-looking ground.
import { Node, Mesh, Geometry, Texture, Instances, box, cylinder, lambert, checker, m4compose, quat, qeuler, mergeGeometries, loadTexture } from 'aiwebengine';
import { meshShape, type PhysicsWorld, type Body } from 'aiwebengine/physics';

export interface Level {
  /** separate ground pieces (gaps between them), flat [x0,y0,x1,y1,...]; the ground goes all the way down */
  pieces: number[][];
  /** floating floors (slabs FLOOR_T thick): upper storeys of buildings, bridges; flat [x0,y0,x1,y1,...] */
  floors?: number[][];
  finishX: number;
  /** height of the surface the finish gate stands on (vertical levels); default: the ground under finishX */
  finishY?: number;
  coins: number[][];
  /** mud strips [x0, x1, y]: y = surface height at x0 (picks the storey) */
  mud?: number[][];
  /** ice strips [x0, x1, y] (like mud): wheels slip - weak forward thrust, hardly any rolling resistance */
  ice?: number[][];
  /** retractable spikes [x, y, width, period (0 = always out), phase 0..1] */
  spikes?: number[][];
  /** levitating platforms [x, y, width, dx, dy, time, pause, phase]: (x, y) = top center at the start; moves by (dx, dy) in
   *  `time` s and back on its own, stopping for `pause` s at each end; phase 0..1 = where in that cycle it starts */
  lifts?: number[][];
  /** slime [x, y0, y1, width]: soft block from y0 to y1, `width` m wide centered at x (default 1): a wall, or lying flat a pad
   *  that softens landings (and a ceiling the noob's head may bump) - nothing breaks on slime */
  slime?: number[][];
  /** pistons [x, y, face]: a 1 m block whose face (center at x, y) looks right (0), up (1), left (2) or down (3); the block is
   *  behind the face. The car touching the face makes it shoot out: a side piston turns the car around, an up one throws it
   *  up, a down one pushes it down. Hitting it fast breaks parts like any wall. */
  pistons?: number[][];
  /** garage grid size [columns, rows] (default 7 x 4) */
  grid?: number[];
  /** frame blocks the player gets on this level (default: grows with the level number) */
  blocks?: number;
}
/** floor slab thickness, lift platform thickness */
export const FLOOR_T = 0.5, LIFT_T = 0.35;
/** piston faces: direction of each face code */
export const PISTON_DIR = [[1, 0], [0, 1], [-1, 0], [0, -1]];
/** default stop of a lift at each end, s */
export const LIFT_PAUSE = 1.5;
/** mud before a lift: the car can stop in it and wait for the platform */
const WAIT_MUD = 6;

/** physics strip half-width (the car lives at z=0) */
const ZP = 3;
const Z_FRONT = 2.2, Z_BACK = -34, BOTTOM = -30;

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export class Builder {
  pieces: number[][] = [];
  cur: number[] = [];
  coins: number[][] = [];
  floors: number[][] = [];
  mud: number[][] = [];
  ice: number[][] = [];
  spikes: number[][] = [];
  lifts: number[][] = [];
  slime: number[][] = [];
  pistons: number[][] = [];
  x = -16;
  y = 0;
  constructor() { this.cur.push(this.x, this.y); }
  to(x: number, y: number) { this.x = x; this.y = y; this.cur.push(x, y); return this; }
  line(dx: number, dy = 0, coins = 0) {
    const x0 = this.x, y0 = this.y;
    this.to(x0 + dx, y0 + dy);
    for (let i = 0; i < coins; i++) {
      const t = (i + 0.5) / coins;
      this.coins.push([x0 + dx * t, y0 + dy * t + 0.9]);
    }
    return this;
  }
  /** steepest climb allowed (tan of the slope): cars are pushed by fans on free-rolling wheels */
  maxSlope = 0.4;
  /** smooth bumps: `count` cosine hills of height `amp` over `len` meters */
  hills(len: number, amp: number, count: number, coins = true) {
    amp = Math.min(amp, (this.maxSlope * len) / (Math.PI * count));
    const x0 = this.x, y0 = this.y, n = Math.ceil(len / 0.6);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      this.to(x0 + len * t, y0 + amp * (1 - Math.cos(t * count * Math.PI * 2)) / 2);
    }
    if (coins) for (let k = 0; k < count; k++) {
      const x = x0 + (len / count) * (k + 0.5);
      for (const d of [-1, 0, 1]) this.coins.push([x + d * 0.9, y0 + amp - Math.abs(d) * 0.15 + 1.1]);
    }
    return this;
  }
  /** step: a short steep slope up (free wheels can't climb vertical edges), a sheer drop down */
  step(h: number) { return h > 0 ? this.line(Math.max(0.4, h / (this.maxSlope * 1.4)), h) : this.to(this.x, this.y + h); }
  stairs(n: number, h: number, w: number) {
    for (let i = 0; i < n; i++) this.step(h).line(w, 0, i % 2 ? 1 : 0);
    return this;
  }
  /** end the current piece and continue after a gap; coins arc over it */
  gap(w: number, dy = 0) {
    const x0 = this.x, y0 = this.y;
    for (let i = 1; i < 6; i++) {
      const t = i / 6;
      this.coins.push([x0 + w * t, y0 + dy * t + 1.6 + Math.sin(t * Math.PI) * 2.2]);
    }
    this.pieces.push(this.cur);
    this.x += w;
    this.y += dy;
    this.cur = [this.x, this.y];
    return this;
  }
  /** jump ramp: up with a lip */
  ramp(len: number, h: number) {
    h = Math.min(h, (this.maxSlope * 1.2 * len) / 1.125);
    return this.line(len * 0.6, h * 0.55).line(len * 0.4, h * 0.45);
  }
  valley(len: number, depth: number) {
    depth = Math.min(depth, (this.maxSlope * len) / Math.PI);
    const x0 = this.x, y0 = this.y, n = Math.ceil(len / 0.6);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      this.to(x0 + len * t, y0 - depth * (1 - Math.cos(t * Math.PI * 2)) / 2);
    }
    this.coins.push([x0 + len / 2, y0 - depth + 1]);
    return this;
  }
  /** rounded humps (logs), `h` high and 1.4 m wide */
  bumps(n: number, h: number, spacing: number) {
    h = Math.min(h, (this.maxSlope * 1.4 * 1.4) / Math.PI);
    for (let i = 0; i < n; i++) {
      this.line(spacing * 0.5);
      const x0 = this.x, y0 = this.y;
      for (let k = 1; k <= 6; k++) this.to(x0 + (1.4 * k) / 6, y0 + h * Math.sin((Math.PI * k) / 6));
    }
    return this;
  }
  /** flat stretch of mud (wheels get stuck: the car needs more thrust) */
  mudLine(len: number) {
    this.mud.push([this.x, this.x + len, this.y]);
    return this.line(len, 0, Math.round(len / 3));
  }
  /** flat stretch of ice (slippery: slow to speed up, slow to stop) */
  iceLine(len: number) {
    this.ice.push([this.x, this.x + len, this.y]);
    return this.line(len, 0, Math.round(len / 3));
  }
  /**
   * Up-facing piston (its face flush with the ground) that throws the car up, and a thin slime pad further on to land on
   * softly (a fast car flies ~2 s, ~20 m); `len` = the whole stretch (at least 28 m).
   */
  launcher(len: number) {
    len = Math.max(28, len);
    const x = this.x + 2, y = this.y;
    this.pistons.push([x, y, 1]);
    this.slime.push([x + 3 + (len - 5) / 2, y, y + 0.2, len - 5]);
    for (let i = 0; i < 5; i++) this.coins.push([x + 1.5 + i * 1.6, y + 3.5 + (2 - Math.abs(i - 2)) * 0.7]);
    return this.line(len);
  }
  /** flat stretch with retractable spikes in the middle */
  spikeLine(len: number, w = 1.6, period = 4, phase = 0) {
    this.spikes.push([this.x + len / 2, this.y, w, period, phase]);
    return this.line(len);
  }
  /** a wall `dy` high with a lift in front of it (mud before it to wait in); a slime pad on the wall face softens the hit */
  liftUp(dy: number, w = 4) {
    // right up to the edge: a car creeping out of the mud would roll into the empty shaft
    this.mudLine(WAIT_MUD);
    const x = this.x, y = this.y, low = y - LIFT_T - 0.05;
    this.lifts.push([x + w / 2, y, w, 0, dy, Math.max(1.5, dy / 1.6), LIFT_PAUSE, 0]);
    this.slime.push([x + w + 0.5, low, y + dy, 1]);
    for (let i = 1; i <= 3; i++) this.coins.push([x + w / 2, y + (dy * i) / 3 + 0.9]);
    this.to(x, low).to(x + w + 1, low).to(x + w + 1, y + dy);
    return this;
  }
  /**
   * A building of `n` storeys (odd: the last one leads on to the right) `w` long and `h` apart. Storeys alternate direction:
   * at each end a lift takes the car up (mud before it to wait in) along a slime wall, and a piston at the top turns it around
   * onto the next storey.
   */
  tower(n: number, w: number, h: number) {
    n = Math.max(3, n | 1);
    h = Math.max(3.8, h);
    w = Math.max(w, WAIT_MUD + 3);
    // lifts are longer than the biggest car (3.5 m + wheels): its back must not stick out under the storey above
    const L = 4.5, x0 = this.x, y0 = this.y, xa = x0 + w, xe = xa + L + 1, lv = (k: number) => y0 + k * h, low = y0 - LIFT_T - 0.05;
    const time = Math.max(1.5, h / 1.6);
    this.line(w - WAIT_MUD, 0, Math.round(w / 4)).mudLine(WAIT_MUD);
    for (let k = 0; k + 1 < n; k++) {
      const right = k % 2 === 0;
      const lx = right ? xa : x0 - L, bottom = k ? lv(k) - LIFT_T - 0.1 : low;
      this.lifts.push([lx + L / 2, lv(k), L, 0, h, time, LIFT_PAUSE, 0]);
      // a soft wall along the shaft, the piston on top of it at the next storey's level (its face looks into the shaft)
      const px = right ? lx + L + 0.5 : lx - 0.5;
      this.slime.push([px, bottom, lv(k + 1), 1]);
      this.pistons.push([right ? lx + L : lx, lv(k + 1) + 0.5, right ? 2 : 0]);
      // storeys between the ground and the top one
      if (k + 1 < n - 1) {
        this.floors.push([x0, lv(k + 1), xa, lv(k + 1)]);
        // the next lift is at the other end: wait in the mud before it
        const m = k % 2 === 0 ? [x0, x0 + WAIT_MUD] : [xa - WAIT_MUD, xa];
        this.mud.push([m[0], m[1], lv(k + 1)]);
        for (let i = 0; i < 4; i++) this.coins.push([x0 + (w * (i + 0.5)) / 4, lv(k + 1) + 0.9]);
      }
    }
    // the top storey runs over the lift shafts and goes on as the ground
    const top = lv(n - 1);
    this.floors.push([x0, top, xe, top]);
    for (let i = 0; i < 4; i++) this.coins.push([x0 + (w * (i + 0.5)) / 4, top + 0.9]);
    this.to(xa, low).to(xe, low).to(xe, top);
    return this;
  }
  finish(): Level {
    this.line(8);
    const finishX = this.x, finishY = this.y;
    this.line(40);
    this.pieces.push(this.cur);
    return {
      pieces: this.pieces, finishX, finishY, coins: this.coins,
      floors: this.floors, mud: this.mud, ice: this.ice, spikes: this.spikes, lifts: this.lifts, slime: this.slime, pistons: this.pistons,
    };
  }
}

/** Levels from levels.json (edited in levels.html); levels past the list are generated. */
let custom: Level[] = [];
export function setLevels(list: Level[]) { custom = list; }
export const customLevelCount = () => custom.length;

/** Level n (0-based): from levels.json if it has one, otherwise generated. */
export function makeLevel(n: number): Level {
  const c = custom[n];
  return normalize(c ? JSON.parse(JSON.stringify(c)) : generateLevel(n));
}
/** fill the optional parts of a level */
export function normalize(L: Level): Level {
  L.floors ??= [];
  L.mud ??= [];
  L.ice ??= [];
  L.spikes ??= [];
  L.lifts ??= [];
  L.slime ??= [];
  L.pistons ??= [];
  L.finishY ??= surfaceY(L, L.finishX, 1e9) ?? 0;
  return L;
}

/** Built-in levels: hand-made first ones, then generated with growing difficulty. */
export function generateLevel(n: number): Level {
  const b = new Builder();
  // slopes get steeper with the level (stronger fans are needed)
  b.maxSlope = [0.28, 0.33, 0.38, 0.42][n] ?? 0.4 + 0.3 * Math.min(1, (n - 4) / 10);
  b.line(22); // start area / garage
  switch (n) {
    // fans do the driving: early levels keep slopes gentle enough for one level-1 fan
    case 0:
      b.line(6, 0, 3).hills(28, 0.7, 3).line(8, 0, 4).hills(18, 0.9, 2).line(6);
      break;
    case 1:
      b.line(4, 0, 2).ramp(10, 1.3).line(6, 0, 3).line(8, -1.3).step(0.18).line(5, 0, 3).step(0.2).line(5).hills(24, 1.1, 3).line(4)
        .bumps(3, 0.25, 3).line(4);
      break;
    case 2:
      b.line(4).stairs(4, 0.25, 3).line(5, 0, 3).line(10, -1).valley(12, 1.6).line(3).hills(20, 1.5, 2).bumps(4, 0.35, 2.6).line(5);
      break;
    case 3:
      b.line(6, 0, 3).ramp(10, 1.6).gap(4.5, -1.2).line(8, 0, 3).hills(20, 1.2, 2).line(6).ramp(12, 2).gap(6, -1.5).line(6, 0, 3)
        .stairs(3, 0.3, 2.5).line(6);
      break;
    default: {
      const r = rng(n * 7919 + 13), d = Math.min(1, (n - 4) / 10);
      const len = 90 + d * 120;
      b.line(4, 0, 2);
      // one building on the way from level 9 on
      let tower = n >= 8;
      while (b.x < len) {
        if (tower && b.x > len * 0.4) { tower = false; b.line(4).tower(3, 12 + r() * 6, 4.5).line(6, 0, 2); continue; }
        // obstacles join in one by one: mud (level 5+), lifts (6+), spikes (7+)
        const o = r();
        if (o < 0.12) { b.line(3).mudLine(5 + r() * 4 * (1 + d)).line(3); continue; }
        if (n >= 7 && o > 0.94) { b.line(2).iceLine(6 + r() * 6).line(2); continue; }
        if (n >= 5 && o < 0.2) { b.line(3).liftUp(2.5 + r() * 2 * (1 + d)).line(5, 0, 2); continue; }
        if (n >= 6 && o < 0.28) { b.line(2).spikeLine(6, 1.4 + r() * 0.6, 4, r()).line(2); continue; }
        const k = Math.floor(r() * 7);
        if (k === 0) b.hills(14 + r() * 16, 0.7 + r() * (0.8 + d * 1.5), 1 + Math.floor(r() * 3));
        else if (k === 1) b.stairs(2 + Math.floor(r() * 3), Math.min(0.45, 0.2 + r() * 0.25 * (0.5 + d)), 2 + r() * 2).line(3).line(6, -(0.6 + r()));
        else if (k === 2) b.ramp(9 + r() * 4, 1.4 + r() * 1.2).gap(3.5 + r() * (3 + d * 6), -1 - r()).line(4);
        else if (k === 3) b.valley(10 + r() * 6, 1.3 + r() * (1 + d * 2)).line(2);
        else if (k === 4) b.bumps(2 + Math.floor(r() * 3), 0.2 + r() * 0.15 * (1 + d), 2 + r());
        else if (k === 5) b.line(6 + r() * 4, (r() - 0.5) * 3, 3);
        else b.line(5, 0, 3);
      }
      b.line(4);
    }
  }
  return b.finish();
}

/** Height of the highest surface (ground or floor) at x not above yMax, or null. */
export function surfaceY(level: Level, x: number, yMax: number): number | null {
  let best: number | null = null;
  for (const p of [...level.pieces, ...(level.floors ?? [])]) {
    if (x < p[0] || x > p[p.length - 2]) continue;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const x0 = p[i], x1 = p[i + 2];
      if (x < x0 || x > x1 || x1 === x0) continue;
      const y = p[i + 1] + ((p[i + 3] - p[i + 1]) * (x - x0)) / (x1 - x0);
      if (y <= yMax + 1e-6 && (best === null || y > best)) best = y;
    }
  }
  return best;
}
/** Follow the surface from (x0, y0) to x1: points every ~0.25 m (mud strips). */
export function traceSurface(level: Level, x0: number, x1: number, y0: number): number[][] {
  const out: number[][] = [];
  const n = Math.max(1, Math.ceil((x1 - x0) / 0.25));
  let y = y0;
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n, s = surfaceY(level, x, y + 0.7);
    if (s !== null) y = s;
    out.push([x, y]);
  }
  return out;
}

/** Ground height under x (for placing decorations), or null over a gap. */
export function heightAt(level: Level, x: number): number | null {
  for (const p of level.pieces) {
    if (x < p[0] || x > p[p.length - 2]) continue;
    let best: number | null = null;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const x0 = p[i], x1 = p[i + 2];
      if (x >= x0 && x <= x1) {
        const y = x1 === x0 ? Math.max(p[i + 1], p[i + 3]) : p[i + 1] + ((p[i + 3] - p[i + 1]) * (x - x0)) / (x1 - x0);
        best = best === null ? y : Math.max(best, y);
      }
    }
    return best;
  }
  return null;
}

// ---------------------------------------------------------------- textures

/** Small nearest-filtered pixel-art texture from a per-pixel color function (r = random 0..1). */
export function pixelTex(w: number, h: number, fn: (x: number, y: number, r: number) => number) {
  const d = new Uint8Array(w * h * 4);
  let s = 12345;
  const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = fn(x, y, r()), i = (y * w + x) * 4;
    d[i] = c >> 16; d[i + 1] = (c >> 8) & 255; d[i + 2] = c & 255; d[i + 3] = 255;
  }
  return Texture.fromPixels(d, w, h, { srgb: true, filter: 'nearest', wrap: 'repeat', mips: false });
}
const GRASS = [0x5fa83a, 0x6cbb45, 0x559a33, 0x79c64e];
const DIRT = [0x8a5a35, 0x7a4e2d, 0x996840, 0x6d4527, 0x8f6a4a];
export const pickC = (a: number[], r: number) => a[Math.floor(r * a.length)];

/** Minecraft block textures (images/Textures), loaded once before the first level is built; 1 block = 1 m */
export const blockTex: {
  top?: Texture; side?: Texture; dirt?: Texture; log?: Texture; leaves?: Texture; soul?: Texture; slime?: Texture;
  bricks?: Texture; ice?: Texture; bamboo?: Texture; smooth?: Texture;
  pistonTop?: Texture; pistonSide?: Texture; pistonBottom?: Texture; pistonInner?: Texture; gold?: Texture; purpur?: Texture; nugget?: Texture;
} = {};
/** texture -> file names it may have in images/Textures (first found wins); missing ones get generated pixel art */
const TEX_FILES: Record<keyof typeof blockTex, string[]> = {
  // the file names don't match the faces: "grassblock" is the side of a grass block, "grassblockside" its top
  top: ['grassblockside'], side: ['grassblock'], dirt: ['dirt-block'], slime: ['slime_block'], bricks: ['stone_bricks'],
  ice: ['ice'], bamboo: ['bamboo_stage0'], smooth: ['smooth_stone'], log: ['oak_log'], leaves: ['oak-leaves-normal-original-default'],
  soul: ['soulsand'], gold: ['gold_ingot'], purpur: ['purpur_block'], nugget: ['gold_nugget'],
  pistonTop: ['piston_top', 'piston_top_normal'], pistonSide: ['piston_side'], pistonBottom: ['piston_bottom'], pistonInner: ['piston_inner'],
};
const texFiles = import.meta.glob('./images/Textures/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const byName = new Map(Object.entries(texFiles).map(([path, url]) => [path.split('/').pop()!.replace(/\.png$/i, '').toLowerCase(), url]));
/** URL of a texture in images/Textures by file name (without .png), e.g. for UI icons */
export const textureURL = (name: string) => byName.get(name.toLowerCase());
export async function loadBlockTextures() {
  const urls = Object.entries(TEX_FILES)
    .map(([k, names]) => [k, names.map((n) => byName.get(n)).find(Boolean)] as const)
    .filter(([, url]) => url) as [string, string][];
  await Promise.all(urls.map(async ([k, url]) => {
    // a texture that fails to load falls back to the generated pixel-art one
    try { blockTex[k as keyof typeof blockTex] = await loadTexture(url, { filter: 'nearest', mips: false, wrap: 'repeat', srgb: true }); } catch {}
  }));
}

const STONE = [0x8b8b8b, 0x7f7f7f, 0x969696, 0x747474];
let mats: { top: any; side: any; dirt: any; stone: any } | null = null;
function materials() {
  if (mats) return mats;
  const top = pixelTex(16, 16, (_x, _y, r) => pickC(GRASS, r));
  // 16x8 grass side: grass on top with ragged drips, dirt below
  const drip = Array.from({ length: 16 }, (_, i) => 2 + ((i * 7) % 5 === 0 ? 2 : (i * 3) % 4 === 1 ? 1 : 0));
  const side = pixelTex(16, 8, (x, y, r) => (y < drip[x] ? pickC(GRASS, r) : pickC(DIRT, r)));
  const dirt = pixelTex(16, 16, (_x, _y, r) => (r < 0.04 ? 0x9a9a9a : pickC(DIRT, r)));
  const T = blockTex;
  mats = {
    top: lambert(0xffffff, { map: T.top ?? top }),
    side: lambert(0xffffff, { map: T.side ?? side }),
    dirt: lambert(0xffffff, { map: T.dirt ?? dirt }),
    // floors / buildings: stone bricks (2 rows per block, mortar lines, every other row offset)
    stone: lambert(0xffffff, {
      map: T.bricks ?? pixelTex(16, 16, (x, y, r) => (y % 8 === 7 || (x + (y < 8 ? 0 : 8)) % 16 === 15 ? 0x5a5a5a : pickC(STONE, r))),
    }),
  };
  return mats;
}

// ---------------------------------------------------------------- building

class GeoBuf {
  p: number[] = [];
  n: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  /** quad from 4 corners (CCW from outside) with matching uvs */
  quad(c: number[][], uv: number[][], normal: number[]) {
    const b = this.p.length / 3;
    for (let i = 0; i < 4; i++) { this.p.push(...c[i]); this.n.push(...normal); this.uv.push(...uv[i]); }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  geometry() {
    return new Geometry().setAttribute('position', this.p, 3).setAttribute('normal', this.n, 3).setAttribute('uv', this.uv, 2).setIndex(this.idx);
  }
}

export interface Track {
  root: Node;
  bodies: Body[];
  level: Level;
  /** per frame: clouds drift */
  update(dt: number): void;
  destroy(): void;
}

/** Create meshes, physics and decorations of a level. */
export function buildTrack(level: Level, world: PhysicsWorld, parent: Node): Track {
  const m = materials();
  const root = parent.add(new Node('track'));
  const bodies: Body[] = [];
  // the grass-block side texture covers one block (1 m) under the surface, dirt below
  const BAND = blockTex.side ? 1 : 0.35;
  for (const p of level.pieces) {
    const top = new GeoBuf(), side = new GeoBuf(), dirt = new GeoBuf(), phys = new GeoBuf();
    const n = p.length / 2;
    /**
     * Wall across the strip at x from y0 up to the surface at y1, facing -X (f = -1) or +X: like a cut-open grass block,
     * a band of grass-block side under the surface and dirt below it.
     */
    const xwall = (x: number, y0: number, y1: number, f: number) => {
      const quad = (buf: GeoBuf, ya: number, yb: number, va: number, vb: number) => {
        if (yb - ya < 1e-4) return;
        const zs = f < 0 ? [Z_BACK, Z_FRONT] : [Z_FRONT, Z_BACK];
        buf.quad([[x, ya, zs[0]], [x, ya, zs[1]], [x, yb, zs[1]], [x, yb, zs[0]]],
          [[zs[0], va], [zs[1], va], [zs[1], vb], [zs[0], vb]], [f, 0, 0]);
      };
      const band = Math.max(y0, y1 - BAND);
      quad(side, band, y1, (y1 - band) / BAND, 0);
      quad(dirt, y0, band, -y0, -band);
    };
    for (let i = 0; i + 1 < n; i++) {
      const x0 = p[i * 2], y0 = p[i * 2 + 1], x1 = p[i * 2 + 2], y1 = p[i * 2 + 3];
      const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
      const nn = [-dy / l, dx / l, 0];
      if (dx === 0) {
        // vertical step: a wall across the whole strip, dirt-textured
        const up = dy > 0, xs = x0;
        const ya = Math.min(y0, y1), yb = Math.max(y0, y1);
        // CCW from outside: an up-step faces -X, a down-step faces +X
        xwall(xs, ya, yb, up ? -1 : 1);
        const pw = up
          ? [[xs, ya, -ZP], [xs, ya, ZP], [xs, yb, ZP], [xs, yb, -ZP]]
          : [[xs, ya, ZP], [xs, ya, -ZP], [xs, yb, -ZP], [xs, yb, ZP]];
        phys.quad(pw, [[0, 0], [0, 0], [0, 0], [0, 0]], [up ? -1 : 1, 0, 0]);
        continue;
      }
      top.quad([[x0, y0, Z_FRONT], [x1, y1, Z_FRONT], [x1, y1, Z_BACK], [x0, y0, Z_BACK]],
        [[x0, -Z_FRONT], [x1, -Z_FRONT], [x1, -Z_BACK], [x0, -Z_BACK]], nn);
      phys.quad([[x0, y0, ZP], [x1, y1, ZP], [x1, y1, -ZP], [x0, y0, -ZP]], [[0, 0], [0, 0], [0, 0], [0, 0]], nn);
      side.quad([[x0, y0 - BAND, Z_FRONT], [x1, y1 - BAND, Z_FRONT], [x1, y1, Z_FRONT], [x0, y0, Z_FRONT]],
        [[x0, 1], [x1, 1], [x1, 0], [x0, 0]], [0, 0, 1]);
      dirt.quad([[x0, BOTTOM, Z_FRONT], [x1, BOTTOM, Z_FRONT], [x1, y1 - BAND, Z_FRONT], [x0, y0 - BAND, Z_FRONT]],
        [[x0, -BOTTOM], [x1, -BOTTOM], [x1, -(y1 - BAND)], [x0, -(y0 - BAND)]], [0, 0, 1]);
    }
    // cliff walls at both ends of the piece
    const xa = p[0], ya = p[1], xb = p[p.length - 2], yb = p[p.length - 1];
    xwall(xa, BOTTOM, ya, -1);
    xwall(xb, BOTTOM, yb, 1);
    phys.quad([[xa, BOTTOM, -ZP], [xa, BOTTOM, ZP], [xa, ya, ZP], [xa, ya, -ZP]], [[0, 0], [0, 0], [0, 0], [0, 0]], [-1, 0, 0]);
    phys.quad([[xb, BOTTOM, ZP], [xb, BOTTOM, -ZP], [xb, yb, -ZP], [xb, yb, ZP]], [[0, 0], [0, 0], [0, 0], [0, 0]], [1, 0, 0]);

    for (const [g, mat] of [[top, m.top], [side, m.side], [dirt, m.dirt]] as const) {
      const mesh = root.add(new Mesh(g.geometry(), mat));
      mesh.castShadow = false;
    }
    const body = world.add(null, { type: 'static', shape: meshShape({ positions: phys.p, indices: phys.idx }), friction: 0.8 });
    body.data.ground = true;
    bodies.push(body);
  }

  for (const p of level.floors ?? []) bodies.push(buildFloor(p, world, root, m.stone));
  const drift = decorate(level, root);
  return {
    root, bodies, level, update: drift,
    destroy() {
      for (const b of bodies) world.remove(b);
      root.destroy();
    },
  };
}

/** floors are shallower than the ground so the background stays visible */
const FZ_BACK = -3.6;
const NONE = [[0, 0], [0, 0], [0, 0], [0, 0]];
/** a floating slab along a polyline: closed physics shell, stone-brick visual */
function buildFloor(p: number[], world: PhysicsWorld, root: Node, mat: any): Body {
  const vis = new GeoBuf(), phys = new GeoBuf(), T = FLOOR_T;
  const uvf = (c: number[][]) => c.map((v) => [v[0], -v[1]]);
  const n = p.length / 2;
  const uvx = (c: number[][]) => c.map((v) => [v[0], -v[2]]);
  const uvz = (c: number[][]) => c.map((v) => [v[2], -v[1]]);
  const ph = (c: number[][]) => c.map((v) => [v[0], v[1], Math.sign(v[2]) * ZP]);
  for (let i = 0; i + 1 < n; i++) {
    const x0 = p[i * 2], y0 = p[i * 2 + 1], x1 = p[i * 2 + 2], y1 = p[i * 2 + 3];
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
    if (dx === 0) {
      // step in the slab: the upper wall faces the side it's climbed from, the lower one the other way
      const up = dy > 0, ya = Math.min(y0, y1), yb = Math.max(y0, y1), f = up ? -1 : 1;
      const back = (y: number, z: number) => [[x0, y, FZ_BACK], [x0, y, Z_FRONT], [x0, z, Z_FRONT], [x0, z, FZ_BACK]];
      const fwd = (y: number, z: number) => [[x0, y, Z_FRONT], [x0, y, FZ_BACK], [x0, z, FZ_BACK], [x0, z, Z_FRONT]];
      const a = f < 0 ? back(ya, yb) : fwd(ya, yb), b = f > 0 ? back(ya - T, yb - T) : fwd(ya - T, yb - T);
      vis.quad(a, uvz(a), [f, 0, 0]);
      vis.quad(b, uvz(b), [-f, 0, 0]);
      phys.quad(ph(a), NONE, [f, 0, 0]);
      phys.quad(ph(b), NONE, [-f, 0, 0]);
      continue;
    }
    const nn = [-dy / l, dx / l, 0], nd = [dy / l, -dx / l, 0];
    const top = [[x0, y0, Z_FRONT], [x1, y1, Z_FRONT], [x1, y1, FZ_BACK], [x0, y0, FZ_BACK]];
    const bot = [[x0, y0 - T, FZ_BACK], [x1, y1 - T, FZ_BACK], [x1, y1 - T, Z_FRONT], [x0, y0 - T, Z_FRONT]];
    const front = [[x0, y0 - T, Z_FRONT], [x1, y1 - T, Z_FRONT], [x1, y1, Z_FRONT], [x0, y0, Z_FRONT]];
    vis.quad(top, uvx(top), nn);
    vis.quad(bot, uvx(bot), nd);
    vis.quad(front, uvf(front), [0, 0, 1]);
    phys.quad(ph(top), NONE, nn);
    phys.quad(ph(bot), NONE, nd);
  }
  // end caps
  const xa = p[0], ya = p[1], xb = p[p.length - 2], yb = p[p.length - 1];
  const ca = [[xa, ya - T, FZ_BACK], [xa, ya - T, Z_FRONT], [xa, ya, Z_FRONT], [xa, ya, FZ_BACK]];
  const cb = [[xb, yb - T, Z_FRONT], [xb, yb - T, FZ_BACK], [xb, yb, FZ_BACK], [xb, yb, Z_FRONT]];
  vis.quad(ca, uvz(ca), [-1, 0, 0]);
  vis.quad(cb, uvz(cb), [1, 0, 0]);
  phys.quad(ph(ca), NONE, [-1, 0, 0]);
  phys.quad(ph(cb), NONE, [1, 0, 0]);
  // floors cast shadows on the storeys / ground below
  root.add(new Mesh(vis.geometry(), mat));
  const body = world.add(null, { type: 'static', shape: meshShape({ positions: phys.p, indices: phys.idx }), friction: 0.8 });
  body.data.ground = true;
  return body;
}

const q0 = quat(), mtx = new Float32Array(16);

/** Minecraft tree block size, m */
const TB = 0.7;
/**
 * Boxes in block units [x, y, z, w, h, d] (min corner + size) merged into one geometry; uvs are projected along each
 * face's axis in block units, so a 16 px texture covers exactly one block like in Minecraft.
 */
function blocks(list: number[][]): Geometry {
  const parts = list.map(([x, y, z, w, h, d]) => {
    const g = box(w * TB, h * TB, d * TB);
    const m = new Float32Array(16);
    m4compose(m, [(x + w / 2) * TB, (y + h / 2) * TB, (z + d / 2) * TB], q0, [1, 1, 1]);
    g.transform(m);
    const p = g.attributes.position.data, n = g.attributes.normal.data, uv = g.attributes.uv.data as Float32Array;
    for (let i = 0; i < p.length / 3; i++) {
      const ax = Math.abs(n[i * 3]), ay = Math.abs(n[i * 3 + 1]);
      const u = ax > 0.5 ? p[i * 3 + 2] : p[i * 3], v = ay > 0.5 ? p[i * 3 + 2] : p[i * 3 + 1];
      uv[i * 2] = u / TB;
      uv[i * 2 + 1] = -v / TB;
    }
    return g.setAttribute('uv', uv, 2);
  });
  return mergeGeometries(parts);
}
/** oak like in Minecraft: a 5-block log, leaves 5x2x5, then 3x1x3, then a plus on top (origin = trunk base) */
function oak() {
  const trunk = blocks([[-0.5, 0, -0.5, 1, 5, 1]]);
  const leaves = blocks([
    [-2.5, 3, -2.5, 5, 2, 5],
    [-1.5, 5, -1.5, 3, 1, 3],
    [-1.5, 6, -0.5, 3, 1, 1],
    [-0.5, 6, -1.5, 1, 1, 3],
  ]);
  // oak bark: vertical streaks; leaves: mottled greens with dark gaps
  const col = Array.from({ length: 16 }, (_, i) => (i * 7) % 5);
  const bark = pixelTex(16, 16, (x, y, r) => (col[x] === 0 || (col[x] === 3 && (y + x) % 5 < 2) ? 0x4a3520 : pickC([0x6b5033, 0x5f4630, 0x76593a], r)));
  const leaf = pixelTex(16, 16, (_x, _y, r) => (r < 0.18 ? 0x14300c : pickC([0x2f6b1f, 0x3a7d26, 0x48902f, 0x285c1a], (r - 0.18) / 0.82)));
  const T = blockTex;
  return {
    trunk, leaves, trunkMat: lambert(0xffffff, { map: T.log ?? bark }),
    // real leaves have see-through gaps: cut out, both sides drawn (the inside shows through like in Minecraft)
    leafMat: T.leaves ? lambert(0xffffff, { map: T.leaves, alphaTest: 0.5, cull: 'none' }) : lambert(0xffffff, { map: leaf }),
  };
}
let deco: { trunk: Geometry; leaves: Geometry; trunkMat: any; leafMat: any; cloud: Geometry; cloudMat: any; pole: Geometry; poleMat: any; flagMat: any } | null = null;

const qt = quat();
/** trees, clouds, the finish gate; returns the clouds' per-frame drift */
function decorate(level: Level, root: Node): (dt: number) => void {
  deco ??= {
    ...oak(),
    cloud: box(1, 1, 1), cloudMat: lambert(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.35, fog: false }),
    pole: cylinder(0.12, 0.12, 4.5, 8), poleMat: lambert(0xeeeeee),
    flagMat: lambert(0xffffff, { map: checker(64, 8, 0x111111, 0xffffff), cull: 'none' }),
  };
  const r = rng(level.pieces.length * 31 + Math.round(level.finishX));
  const x0 = level.pieces[0][0], x1 = level.finishX + 36;
  const trunks = root.add(new Mesh(deco.trunk, deco.trunkMat));
  const leaves = root.add(new Mesh(deco.leaves, deco.leafMat));
  const ti = (trunks.instances = new Instances(200)), li = (leaves.instances = new Instances(200, true));
  let k = 0;
  for (let x = x0 + 2; x < x1 && k < 200; x += 2.5 + r() * 4) {
    const z = -5 - r() * 22, y = heightAt(level, x);
    if (y === null) continue;
    // whole trees scale a little (blocks stay square); turned by 90° steps like placed blocks
    const s = 0.9 + r() * 0.25;
    qeuler(qt, 0, Math.floor(r() * 4) * (Math.PI / 2), 0);
    m4compose(mtx, [x, y - 0.05, z], qt, [s, s, s]);
    ti.setMatrix(k, mtx);
    li.setMatrix(k, mtx);
    const g = 0.7 + r() * 0.25;
    li.setColor(k, [g, g * (0.95 + r() * 0.1), g, 1]);
    k++;
  }
  // clouds: flat blocky slabs
  const clouds = root.add(new Mesh(deco.cloud, deco.cloudMat));
  clouds.castShadow = false;
  const ci = (clouds.instances = new Instances(60));
  // [x, y, z, sx, sz, speed]: they drift slowly to the right and come back in on the left
  const cl = Array.from({ length: 60 }, (_, i) => [x0 + ((x1 - x0) * i) / 60 + r() * 6, 12 + r() * 8, -30 - r() * 25, 4 + r() * 6, 2 + r() * 4, 0.5 + r() * 0.5]);
  const span = x1 - x0 + 30;
  const placeClouds = (dt: number) => {
    for (let i = 0; i < cl.length; i++) {
      const c = cl[i];
      c[0] += c[5] * dt;
      if (c[0] > x1 + 15) c[0] -= span;
      m4compose(mtx, [c[0], c[1], c[2]], q0, [c[3], 1, c[4]]);
      ci.setMatrix(i, mtx);
    }
  };
  placeClouds(0);
  // finish gate
  const fy = level.finishY ?? heightAt(level, level.finishX) ?? 0;
  for (const z of [-2.2, 2.2]) root.add(new Mesh(deco.pole, deco.poleMat)).setPosition(level.finishX, fy + 2.25, z);
  const banner = root.add(new Mesh(box(0.1, 0.9, 4.4), deco.flagMat));
  banner.setPosition(level.finishX, fy + 4.2, 0);
  qeuler(banner.rotation, 0, 0, 0);
  return placeClouds;
}
