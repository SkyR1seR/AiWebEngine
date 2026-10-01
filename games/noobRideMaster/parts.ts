// Part model: 4 kinds (block, wheel, fan, seat), wheels/fans have merge levels 1..10.
// A cell value packs kind and level: kind | (level << 3).

export const CELL = 0.5;
/** car grid size (columns, rows): set per level with setGrid(); a design is an array of GW * GH cells */
export let GW = 7, GH = 4;
export const DEFAULT_GRID = [7, 4];
/** limits of the grid size (the seat needs 2 free cells above it) */
export const GRID_MIN = [2, 2], GRID_MAX = [14, 8];
export function setGrid(w: number, h: number) {
  GW = Math.max(GRID_MIN[0], Math.min(GRID_MAX[0], Math.round(w) || DEFAULT_GRID[0]));
  GH = Math.max(GRID_MIN[1], Math.min(GRID_MAX[1], Math.round(h) || DEFAULT_GRID[1]));
}
/** inventory slots */
export const INV = 12;
export const MAX_LVL = 10;
export const EMPTY = 0, BLOCK = 1, WHEEL = 2, FAN = 3, SEAT = 4;

export type Design = number[];

export const kindOf = (v: number) => v & 7;
export const lvlOf = (v: number) => Math.max(1, v >> 3);
export const make = (kind: number, lvl = 1) => kind | (lvl << 3);
/** wheels and fans: bought, merged, stored in the inventory; blocks and the seat stay on the car */
export const isItem = (v: number) => kindOf(v) === WHEEL || kindOf(v) === FAN;
export const isFrame = (v: number) => kindOf(v) === BLOCK || kindOf(v) === SEAT;
export const canMerge = (a: number, b: number) => !!a && a === b && isItem(a) && lvlOf(a) < MAX_LVL;

// ---------------------------------------------------------------- stats

/** Minecraft-like material tiers by level: color and name */
export const TIERS: [number, string, string][] = [
  [0xb8945f, 'Дерево', 'Wood'], [0x8f8f8f, 'Камень', 'Stone'], [0xe3e3e3, 'Железо', 'Iron'], [0xf2c83a, 'Золото', 'Gold'],
  [0x4fe0d8, 'Алмаз', 'Diamond'], [0x3ad162, 'Изумруд', 'Emerald'], [0xd8322f, 'Редстоун', 'Redstone'], [0x2f5fd8, 'Лазурит', 'Lapis'],
  [0xa45bdc, 'Аметист', 'Amethyst'], [0x4a3f45, 'Незерит', 'Netherite'],
];
export const tierColor = (lvl: number) => TIERS[lvl - 1][0];

export const wheelRadius = (lvl: number) => 0.3 + 0.025 * (lvl - 1);
export const wheelGrip = (lvl: number) => 0.9 + 0.06 * lvl;
/** thrust in newtons */
export const fanThrust = (lvl: number) => 900 * Math.pow(1.35, lvl - 1);
/** top speed along the fan axis (thrust fades to 0 there) */
export const fanSpeed = (lvl: number) => 8 + 1.2 * lvl;
export const NOOB_MASS = 45;

/** default mass (kg) when parts.json has no value */
export function defaultMass(kind: number, l: number) {
  return kind === BLOCK ? 30 : kind === SEAT ? 25 : kind === WHEEL ? 14 + 2 * l : kind === FAN ? 16 + 2 * l : 0;
}
/** default strength when parts.json has no value */
export function defaultStrength(kind: number, l: number) {
  return kind === BLOCK ? 7.5 : kind === SEAT ? 7 : kind === WHEEL ? 10 + l : kind === FAN ? 6.5 + 0.5 * l : 99;
}
/** per-kind values from parts.json ("stats" of each model; one value for blocks/seat, one per level for wheels/fans) */
export interface PartStats { strength?: number[]; mass?: number[] }
let stats: Record<number, PartStats> = {};
export function setPartStats(s: Record<number, PartStats>) { stats = s; }
const pickStat = (arr: number[] | undefined, l: number) => (arr && arr.length ? arr[Math.min(l, arr.length) - 1] : undefined);

export function partMass(v: number) {
  const k = kindOf(v), l = lvlOf(v);
  return pickStat(stats[k]?.mass, l) ?? defaultMass(k, l);
}
/** impact speed (m/s into the ground) that knocks the part off */
export function partStrength(v: number) {
  const k = kindOf(v), l = lvlOf(v);
  return pickStat(stats[k]?.strength, l) ?? defaultStrength(k, l);
}

/** frame blocks the player gets on a level (0-based) */
export const blocksForLevel = (n: number) => Math.min(14, 3 + Math.floor(n / 2));

// ---------------------------------------------------------------- grid

export const idx = (c: number, r: number) => r * GW + c;
export const cellX = (c: number) => (c + 0.5 - GW / 2) * CELL;
export const cellY = (r: number) => (r + 0.5) * CELL;

export function seatOf(d: Design): [number, number] {
  const i = d.findIndex((v) => kindOf(v) === SEAT);
  return [i % GW, Math.floor(i / GW)];
}
/** Cells taken by the seated noob: the one above the seat (the noob is 2 cells high with its seat; the cells beside are free). */
export function noobCells(d: Design): number[] {
  const [c, r] = seatOf(d);
  return r + 1 < GH ? [idx(c, r + 1)] : [];
}
/** exactly one seat, room for the noob above it, nothing in the noob's cells */
export function validDesign(d: Design) {
  if (d.filter((v) => kindOf(v) === SEAT).length !== 1) return false;
  const [, r] = seatOf(d);
  return r + 1 < GH && noobCells(d).every((i) => d[i] === EMPTY);
}

/** Cells reachable from `root` through `has` cells (4-neighbourhood; wheels and fans don't carry other parts). */
export function reach(d: Design, root: number, has: (i: number) => boolean = (i) => d[i] !== EMPTY): Set<number> {
  const seen = new Set<number>([root]), stack = [root];
  while (stack.length) {
    const i0 = stack.pop()!, c = i0 % GW, r = Math.floor(i0 / GW);
    if (isItem(d[i0]) && i0 !== root) continue;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr, i = idx(nc, nr);
      if (nc < 0 || nr < 0 || nc >= GW || nr >= GH || seen.has(i) || !has(i)) continue;
      seen.add(i);
      stack.push(i);
    }
  }
  return seen;
}
/** Parts connected to the seat. */
export function connected(d: Design): Set<number> {
  const [sc, sr] = seatOf(d);
  return reach(d, idx(sc, sr));
}

/** Which side of a fan the frame is on (the fan model turns to face it); frame beside it beats frame above / below. */
export type Attach = 'top' | 'bottom' | 'left' | 'right';
export function fanAttach(d: Design, i: number): Attach {
  const c = i % GW, r = Math.floor(i / GW);
  const frame = (cc: number, rr: number) => cc >= 0 && rr >= 0 && cc < GW && rr < GH && isFrame(d[idx(cc, rr)]);
  // a side neighbour wins: forward thrust is preferred over lift
  return frame(c - 1, r) ? 'left' : frame(c + 1, r) ? 'right' : frame(c, r + 1) ? 'top' : frame(c, r - 1) ? 'bottom' : 'right';
}
/** Thrust direction from the attachment: frame above/below -> 'up', frame in front/behind -> 'fwd'. */
export const attachDir = (a: Attach): 'up' | 'fwd' => (a === 'top' || a === 'bottom' ? 'up' : 'fwd');
export const fanDir = (d: Design, i: number) => attachDir(fanAttach(d, i));

/** Add or remove frame blocks until there are exactly `n` (new ones grow next to the frame, near the seat's row). */
export function fitBlocks(d: Design, n: number) {
  const [sc, sr] = seatOf(d);
  let count = d.filter((v) => kindOf(v) === BLOCK).length;
  while (count < n) {
    const noob = noobCells(d);
    let best = -1, score = Infinity;
    for (let i = 0; i < d.length; i++) {
      if (d[i] !== EMPTY || noob.includes(i)) continue;
      const c = i % GW, r = Math.floor(i / GW);
      const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => {
        const nc = c + dc, nr = r + dr;
        return nc >= 0 && nr >= 0 && nc < GW && nr < GH && isFrame(d[idx(nc, nr)]);
      });
      if (!touches) continue;
      const s = Math.abs(r - sr) * 10 + Math.abs(c - sc) + (c < sc ? 0.5 : 0);
      if (s < score) { score = s; best = i; }
    }
    if (best < 0) break;
    d[best] = make(BLOCK);
    count++;
  }
  while (count > n) {
    let far = -1, dist = -1;
    d.forEach((v, i) => {
      if (kindOf(v) !== BLOCK) return;
      const dd = Math.abs((i % GW) - sc) + Math.abs(Math.floor(i / GW) - sr);
      if (dd > dist) { dist = dd; far = i; }
    });
    d[far] = EMPTY;
    count--;
  }
}

/** where a new car's seat goes: column 2 (or the last), row 1 (lower if the grid is low) */
const seatHome = () => idx(Math.min(2, GW - 1), Math.max(0, Math.min(1, GH - 2)));

export function startDesign(level: number, blocks = blocksForLevel(level)): Design {
  const d: Design = new Array(GW * GH).fill(EMPTY);
  d[seatHome()] = make(SEAT);
  fitBlocks(d, blocks);
  return d;
}

/**
 * A design made on a w x h grid, moved onto the current grid (same column/row of each cell). Wheels and fans that don't
 * fit come back in `items`; if the seat doesn't fit (or has no room for the noob), it goes to its home cell.
 */
export function regrid(d: Design, w: number, h: number): { d: Design; items: number[] } {
  const out: Design = new Array(GW * GH).fill(EMPTY), items: number[] = [];
  let seat = -1;
  for (let i = 0; i < d.length; i++) {
    const v = d[i];
    if (!v) continue;
    const c = i % w, r = Math.floor(i / w);
    const inside = c < GW && r < GH;
    if (kindOf(v) === SEAT) { seat = inside && r + 1 < GH ? idx(c, r) : -2; continue; }
    if (inside) out[idx(c, r)] = v;
    else if (isItem(v)) items.push(v);
  }
  if (seat < 0) seat = seatHome();
  // the seat and the noob's cells must be free of other parts
  for (const i of [seat, seat + GW]) {
    if (out[i] && isItem(out[i])) items.push(out[i]);
    out[i] = EMPTY;
  }
  out[seat] = make(SEAT);
  return { d: out, items };
}
