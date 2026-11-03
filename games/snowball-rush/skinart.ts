// Procedural skins (owner: art): 64x64 character skins, UI portraits/figures, voxel ball looks and icons.
// Skin layout = the standard 64x64 box skin (see UV). 'noob' is the author's PNG (64x32, converted at load); every
// other skin is painted here in code. Extra 3D details (hats, antlers, beard volume, staff...) are small boxes
// ("accessories") whose colors live in an unused palette corner of the skin, so a whole body part is one mesh.
import { Material, Texture, lambert, standard, type Geometry } from 'aiwebengine';
import { GLOW, voxelSphere } from './blocks';
import { Pix, hex, jit, mix, shade, tex } from './textures';
import type { BallId, SkinId } from './types';
import { hash, rng } from './util';

type Rnd = () => number;

// ---------------------------------------------------------------- layout

export type PartName = 'head' | 'body' | 'armR' | 'armL' | 'legR' | 'legL';
export type Layer = PartName | 'hat' | 'jacket' | 'sleeveR' | 'sleeveL' | 'pantsR' | 'pantsL';
/** [u, v, w, h, d] of each box in the 64x64 layout (w = width along X, h = height, d = depth) */
export const UV: Record<Layer, [number, number, number, number, number]> = {
  head: [0, 0, 8, 8, 8], hat: [32, 0, 8, 8, 8],
  body: [16, 16, 8, 12, 4], jacket: [16, 32, 8, 12, 4],
  armR: [40, 16, 4, 12, 4], sleeveR: [40, 32, 4, 12, 4],
  armL: [32, 48, 4, 12, 4], sleeveL: [48, 48, 4, 12, 4],
  legR: [0, 16, 4, 12, 4], pantsR: [0, 32, 4, 12, 4],
  legL: [16, 48, 4, 12, 4], pantsL: [0, 48, 4, 12, 4],
};
/** the second (overlay) layer of every part */
export const OVER: Record<PartName, Layer> = { head: 'hat', body: 'jacket', armR: 'sleeveR', armL: 'sleeveL', legR: 'pantsR', legL: 'pantsL' };
export const PARTS: PartName[] = ['head', 'body', 'armR', 'armL', 'legR', 'legL'];
/** face indices of faceRects() */
export const TOP = 0, BOTTOM = 1, RIGHT = 2, FRONT = 3, LEFT = 4, BACK = 5;

/** face rects [x, y, w, h] in the order top, bottom, right side (-X), front, left side (+X), back */
export function faceRects(l: Layer): [number, number, number, number][] {
  const [u, v, w, h, d] = UV[l];
  return [[u + d, v, w, d], [u + d + w, v, w, d], [u, v + d, d, h], [u + d, v + d, w, h], [u + d + w, v + d, d, h], [u + 2 * d + w, v + d, w, h]];
}

/** extra box on a body part (skin pixels). Center relative to the part's box center: +x = character's left, +y up, +z front */
export interface Acc {
  part: PartName;
  x: number; y: number; z: number;
  w: number; h: number; d: number;
  /** solid color (stored in the skin's palette area) */
  c?: number;
  /** texture region [u, v, w, h] of the skin stretched over every face (filled in for `c` after painting) */
  uv?: [number, number, number, number];
  /** rotation around Z (rad) */
  rz?: number;
}

// free texture regions (unused in the 64x64 layout) for textured accessories, and the palette for solid ones
const REG_A: [number, number, number, number] = [0, 0, 8, 8];
const REG_B: [number, number, number, number] = [24, 0, 8, 8];
const PAL_X = 56, PAL_Y = 16;

// ---------------------------------------------------------------- painter

type FaceFn = (f: number, x: number, y: number, s: number) => number;
const DARK = 0x2a2d3a, MOUTH = 0x4a1e18, WHITE = 0xffffff;

/** skin painter: face-aware helpers on a 64x64 Pix (s = coordinate around the box sides, 0 at the right side's back edge) */
class SP {
  constructor(readonly p: Pix, readonly r: Rnd) {}
  paint(l: Layer, fn: FaceFn) {
    const u = UV[l][0];
    faceRects(l).forEach(([rx, ry, rw, rh], f) => {
      for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
        const c = fn(f, x, y, f >= 2 ? rx - u + x : -1);
        if (c >= 0) this.p.set(rx + x, ry + y, c);
      }
    });
    return this;
  }
  /** solid color with subtle noise; side faces darken a little towards the bottom, bottoms are darker */
  fill(l: Layer, c: number, noise = 0.035) {
    const h = UV[l][3];
    return this.paint(l, (f, _x, y) => jit(f === BOTTOM ? shade(c, 0.82) : f >= 2 ? shade(c, 1.03 - (0.1 * y) / h) : c, this.r, noise));
  }
  /** rows y0..y1 of the side faces (and the top/bottom face with `caps`) */
  band(l: Layer, y0: number, y1: number, c: number | ((s: number, y: number, f: number) => number), noise = 0.03) {
    return this.paint(l, (f, _x, y, s) => (f >= 2 && y >= y0 && y <= y1 ? jit(typeof c === 'number' ? c : c(s, y, f), this.r, noise) : -1));
  }
  px(l: Layer, f: number, x: number, y: number, c: number) {
    const [rx, ry, rw, rh] = faceRects(l)[f];
    if (x >= 0 && y >= 0 && x < rw && y < rh) this.p.set(rx + x, ry + y, c);
    return this;
  }
  rect(l: Layer, f: number, x: number, y: number, w: number, h: number, c: number, noise = 0.025) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.px(l, f, i, j, jit(c, this.r, noise));
    return this;
  }
  /** string sprite on a face ('.' / unknown chars = leave) */
  spr(l: Layer, f: number, rows: string[], pal: Record<string, number>, ox = 0, oy = 0) {
    rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const c = pal[row[x]]; if (c !== undefined) this.px(l, f, ox + x, oy + y, c); } });
    return this;
  }
  /** both limbs of a kind with one function; `m` mirrors x on the left limb's front/back so details stay symmetric */
  limbs(kind: 'arm' | 'leg' | 'sleeve' | 'pants', fn: (f: number, x: number, y: number, s: number, left: boolean) => number) {
    const [r, l] = kind === 'arm' ? ['armR', 'armL'] : kind === 'leg' ? ['legR', 'legL'] : kind === 'sleeve' ? ['sleeveR', 'sleeveL'] : ['pantsR', 'pantsL'];
    this.paint(r as Layer, (f, x, y, s) => fn(f, x, y, s, false));
    this.paint(l as Layer, (f, x, y, s) => fn(f, f === FRONT || f === BACK || f < 2 ? 3 - x : x, y, s, true));
    return this;
  }
  region(reg: [number, number, number, number], fn: (x: number, y: number) => number) {
    const [u, v, w, h] = reg;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) this.p.set(u + x, v + y, fn(x, y));
    return this;
  }
}

interface FaceOpts {
  skin: number;
  eye?: number;
  mouth?: 'smile' | 'open' | 'grin' | 'none';
  blush?: number;
  /** hair color: top, back (rows 0..back), sides (0..side), front fringe rows */
  hair?: number;
  front?: number;
  side?: number;
  back?: number;
}
/** a cute "noob-style" head: eyes (white + iris looking forward), soft nose, mouth, optional hair */
function head(s: SP, o: FaceOpts) {
  s.fill('head', o.skin, 0.025);
  const e = o.eye ?? DARK, H = 'head';
  s.px(H, FRONT, 1, 3, WHITE).px(H, FRONT, 2, 3, e).px(H, FRONT, 5, 3, e).px(H, FRONT, 6, 3, WHITE);
  s.px(H, FRONT, 3, 4, shade(o.skin, 0.9)).px(H, FRONT, 4, 4, shade(o.skin, 0.9));
  if (o.blush !== undefined) s.px(H, FRONT, 1, 5, o.blush).px(H, FRONT, 6, 5, o.blush);
  const m = o.mouth ?? 'smile';
  if (m === 'smile') s.px(H, FRONT, 2, 5, MOUTH).px(H, FRONT, 5, 5, MOUTH).px(H, FRONT, 3, 6, MOUTH).px(H, FRONT, 4, 6, MOUTH);
  if (m === 'open') s.rect(H, FRONT, 2, 5, 4, 1, MOUTH, 0).px(H, FRONT, 3, 6, 0xc53c2a).px(H, FRONT, 4, 6, 0xd84c34);
  if (m === 'grin') s.rect(H, FRONT, 2, 5, 4, 1, WHITE, 0).px(H, FRONT, 1, 5, MOUTH).px(H, FRONT, 6, 5, MOUTH).rect(H, FRONT, 3, 6, 2, 1, MOUTH, 0);
  if (o.hair !== undefined) {
    const c = o.hair, fr = o.front ?? 1, sd = o.side ?? 3, bk = o.back ?? 6;
    s.paint(H, (f, x, y) => {
      if (f === TOP) return jit(c, s.r, 0.07);
      if (f === BOTTOM) return -1;
      const rows = f === FRONT ? fr : f === BACK ? bk : sd;
      // ragged fringe edge
      const edge = f === FRONT ? (x * 5 + 3) % 4 === 0 : (x * 3 + f) % 3 === 0;
      return y < rows || (y === rows && edge) ? jit(c, s.r, 0.07) : -1;
    });
  }
}

/** knitted pattern (V stitches) */
const knit = (c: number) => (x: number, y: number) => ((x + (y % 2)) % 2 ? shade(c, 0.86) : c);

// ---------------------------------------------------------------- skins

interface SkinDef {
  /** signature color (UI markers) */
  col: number;
  paint(s: SP): void;
  acc?: Acc[];
}

const box = (part: PartName, x: number, y: number, z: number, w: number, h: number, d: number, c: number | [number, number, number, number], rz?: number): Acc =>
  typeof c === 'number' ? { part, x, y, z, w, h, d, c, rz } : { part, x, y, z, w, h, d, uv: c, rz };
/** left/right pair of an accessory (mirrored x) */
const pair = (a: Acc, partL?: PartName): Acc[] => [a, { ...a, part: partL ?? a.part, x: -a.x }];

const NOOB_SKIN = 0xb78272;

/** procedural stand-in for the PNG hero (used only until loadSkinAssets() finishes or if the image fails) */
function paintNoob(s: SP) {
  head(s, { skin: NOOB_SKIN, mouth: 'open', hair: 0x2b1e0d, front: 2, side: 3, back: 7 });
  s.fill('body', 0x00a8a8).rect('body', FRONT, 2, 0, 4, 2, NOOB_SKIN);
  s.band('body', 9, 11, 0x463aa5);
  s.limbs('arm', (_f, _x, y) => (y < 5 ? jit(0x00a8a8, s.r, 0.04) : jit(NOOB_SKIN, s.r, 0.03)));
  s.limbs('leg', (_f, _x, y) => (y < 10 ? jit(0x463aa5, s.r, 0.04) : 0x6b6b6b));
}

/** Нубик в шапке: the PNG skin + a red knitted hat (overlay + dome + pompom) and a striped scarf */
function paintWinter(s: SP) {
  const red = 0xd62a2a;
  s.paint('hat', (f, x, y) => {
    if (f === TOP) return knit(red)(x, y);
    if (f === BOTTOM) return -1;
    const rows = f === FRONT ? 2 : f === BACK ? 4 : 3;
    if (y >= rows) return -1;
    // white band with a red snowflake-ish dot pattern on the lowest hat row
    if (y === rows - 1) return (x + (f === FRONT ? 0 : 1)) % 3 === 1 ? red : 0xf4f4f4;
    return knit(red)(x, y);
  });
  s.region(REG_A, knit(red));
  s.region(REG_B, (x, y) => ((x * 3 + y * 5) % 7 === 0 ? 0xe4eaf0 : 0xffffff));
  // scarf: around the neck + a hanging end on the front (base layer and overlay for volume)
  const stripe = (v: number) => (v % 4 < 2 ? red : 0xf4f4f4);
  for (const l of ['body', 'jacket'] as const) {
    s.band(l, 0, 1, (q) => stripe(q >> 1), 0.02);
    s.paint(l, (f, x, y) => (f === TOP ? stripe(x) : f === FRONT && x >= 5 && x <= 6 && y >= 2 && y <= 7 ? (y === 7 ? (x % 2 ? red : 0xf4f4f4) : stripe(y)) : -1));
  }
}

const SKINS: Record<SkinId, SkinDef> = {
  noob: { col: 0x00a8a8, paint: paintNoob },
  winter: {
    col: 0xd62a2a, paint: paintWinter,
    acc: [box('head', 0, 5.1, 0, 7.6, 1.4, 7.6, REG_A), box('head', 0, 6.2, 0, 5.4, 1, 5.4, REG_A), box('head', 0, 7.9, 0, 3, 3, 3, REG_B)],
  },
  skier: {
    col: 0xff7a1a,
    paint: (s) => {
      const or = 0xff7a1a, navy = 0x23305a;
      head(s, { skin: NOOB_SKIN, mouth: 'smile', hair: 0x6b4a2a, front: 1, side: 4, back: 6 });
      // helmet + goggles on the overlay (sticks out → real 3D goggles)
      s.paint('hat', (f, x, y) => {
        if (f === TOP) return x === 3 || x === 4 ? 0x2a7fd6 : jit(0xf2f4f7, s.r, 0.02);
        if (f === BOTTOM) return -1;
        if (y === 2 || y === 3) {
          if (f !== FRONT) return 0x22252b;
          if (x === 0 || x === 7) return 0x22252b;
          if (y === 2 && x === 2) return 0xffffff;
          return y === 2 ? mix(0xffd447, 0xff9a2a, x / 7) : mix(0xff7a1a, 0xd8461a, x / 7);
        }
        const rows = f === BACK ? 5 : 2;
        return y < rows ? (f === BACK && y === 4 ? 0x2a7fd6 : jit(0xf2f4f7, s.r, 0.02)) : -1;
      });
      s.fill('body', or).rect('body', FRONT, 4, 0, 1, 10, 0xe8ecf0, 0).rect('body', FRONT, 3, 2, 1, 1, 0xc8ccd2, 0);
      s.band('body', 0, 1, navy).band('body', 5, 5, 0xffffff).band('body', 10, 11, navy);
      s.spr('body', BACK, ['..ww....', '.w..w...', '.w..w...', '..ww....'], { w: 0xffffff }, 3, 2);
      s.limbs('arm', (_f, _x, y) => jit(y >= 9 ? 0x22252b : y === 5 ? 0xffffff : y === 8 ? navy : or, s.r, 0.03));
      s.limbs('leg', (f, x, y) => jit(y >= 9 ? (y === 10 ? 0x3a3f4a : 0xe8eef4) : f === FRONT && x === 1 && y === 5 ? 0x3a4a7a : navy, s.r, 0.03));
    },
  },
  hockey: {
    col: 0x1f5fbf,
    paint: (s) => {
      const blue = 0x1f5fbf, red = 0xd62a2a;
      head(s, { skin: 0xc8906e, mouth: 'grin', hair: 0x2b1e0d, front: 1, side: 3, back: 6 });
      s.paint('hat', (f, x, y) => {
        if (f === TOP) return jit(blue, s.r, 0.03);
        if (f === BOTTOM) return -1;
        if (f === FRONT) {
          if (y < 2) return y === 1 ? 0xf4f4f4 : jit(blue, s.r, 0.03);
          // the cage: transparent holes between silver bars
          return x === 0 || x === 7 || (y === 4 && x > 0 && x < 7) || (y > 3 && (x === 2 || x === 5)) ? (y === 4 ? 0xc8d0d8 : 0xaab4be) : -1;
        }
        const rows = f === BACK ? 5 : 4;
        return y < rows ? (y === 1 ? 0xf4f4f4 : jit(blue, s.r, 0.03)) : f !== BACK && y === rows ? 0xd8dee6 : -1;
      });
      s.fill('body', red).band('body', 8, 9, 0xf4f4f4).band('body', 10, 11, blue);
      s.rect('body', FRONT, 3, 0, 2, 1, 0xf4f4f4).rect('body', BACK, 0, 0, 8, 1, 0xf4f4f4);
      // jersey number 17 (front and back)
      for (const f of [FRONT, BACK]) s.spr('body', f, ['..w.www.', '.ww...w.', '..w..w..', '..w..w..', '.www.w..'], { w: WHITE }, 0, 2);
      s.limbs('arm', (_f, _x, y) => jit(y >= 8 ? (y === 8 ? 0x8a5a32 : 0x2a2a2a) : y === 5 || y === 6 ? 0xf4f4f4 : red, s.r, 0.03));
      s.limbs('sleeve', (f, _x, y) => (y >= 8 && f !== TOP ? jit(y === 8 ? 0x8a5a32 : 0x2a2a2a, s.r, 0.04) : -1));
      s.limbs('leg', (_f, _x, y) => jit(y < 4 ? 0x1e2a44 : y === 6 ? 0xf4f4f4 : y < 9 ? red : y < 11 ? 0x222222 : 0xd8dee6, s.r, 0.03));
    },
  },
  penguin: {
    col: 0x2b2f3a,
    paint: (s) => {
      const k = 0x23262e, w = 0xf4f6f8, o = 0xffa21a;
      s.fill('head', k, 0.04);
      s.spr('head', FRONT, [
        '........',
        '..wwww..',
        '.wwwwww.',
        '.wkwwkw.',
        'wwwoowww',
        'wpwOOwpw',
        'wwwwwwww',
        '.wwwwww.',
      ], { w, k: 0x101218, o, O: 0xe07a10, p: 0xffa8b8 });
      s.px('head', FRONT, 2, 2, 0xffffff).px('head', FRONT, 5, 2, 0xffffff);
      s.fill('body', k, 0.04).spr('body', FRONT, ['..rrrr..', '.rRrrRr.', '..wwww..', '.wwwwww.', '.wwwwww.', '.wwwwww.', '.wwwwww.', '.wwwwww.', '.wwwwww.', '.wwwwww.', '..wwww..', '..wwww..'],
        { w, r: 0xd62a2a, R: 0xa81c24 });
      s.limbs('arm', (f, x, y, _s, left) => jit(y >= 10 ? 0x3a3f4a : (left ? f === RIGHT : f === LEFT) && y > 1 ? 0xdde2e8 : k, s.r, 0.04));
      s.limbs('leg', (f, _x, y) => jit(y >= 10 ? o : f === FRONT && y < 6 ? w : k, s.r, 0.03));
    },
    acc: [box('head', 0, -0.5, 4.6, 2.2, 1.2, 1.4, 0xffa21a), ...pair(box('legR', 0, -5.5, 2.7, 3.6, 1, 1.6, 0xffa21a), 'legL')],
  },
  elf: {
    col: 0x2f9e44,
    paint: (s) => {
      const g = 0x2f9e44, gd = 0x1f7a35, red = 0xd62a2a, skin = 0xf0c09a;
      head(s, { skin, eye: 0x2e8a3e, mouth: 'smile', blush: 0xf08a8a, hair: 0xd9772a, front: 1, side: 4, back: 6 });
      s.px('head', FRONT, 2, 4, 0xc8885a).px('head', FRONT, 5, 4, 0xc8885a);
      s.paint('hat', (f, x, y) => {
        if (f === TOP) return jit(g, s.r, 0.04);
        if (f === BOTTOM) return -1;
        const rows = f === FRONT ? 2 : 3;
        return y < rows ? (y === rows - 1 ? ((x + f) % 2 ? red : 0xf4f4f4) : jit(g, s.r, 0.04)) : -1;
      });
      s.fill('body', g);
      s.band('body', 0, 0, (q) => (q % 2 ? red : 0xf4f4f4)).band('body', 7, 8, 0x2a2a2a).band('body', 11, 11, (q) => (q % 2 ? red : g));
      s.rect('body', FRONT, 3, 7, 2, 2, 0xf2c230, 0).px('body', FRONT, 3, 3, 0xf2c230).px('body', FRONT, 4, 5, 0xf2c230);
      s.limbs('arm', (_f, _x, y) => jit(y >= 10 ? skin : y >= 8 ? (y === 8 ? red : 0xf4f4f4) : g, s.r, 0.03));
      s.limbs('leg', (_f, _x, y) => jit(y < 2 ? g : y < 9 ? ((y >> 1) % 2 ? red : 0xf4f4f4) : gd, s.r, 0.03));
    },
    acc: [
      ...pair(box('head', 4.4, 0, -0.5, 1, 2, 2, 0xf0c09a)), ...pair(box('head', 4.9, 1.5, -1, 1, 1.4, 1, 0xf0c09a)),
      box('head', 0, 5.2, -0.4, 7, 1.4, 7, 0x2f9e44), box('head', 0, 6.4, -1.4, 5, 1.2, 5, 0x2f9e44),
      box('head', 0, 7.4, -2.8, 3, 1.2, 3, 0x2a8c3c), box('head', 0, 8, -4.4, 2, 1.1, 2.2, 0x2f9e44),
      box('head', 0, 7.3, -5.8, 1.7, 1.7, 1.7, 0xf2c230),
      ...pair(box('legR', 0, -5.5, 2.6, 3, 1, 1.4, 0x1f7a35), 'legL'), ...pair(box('legR', 0, -4.7, 3.3, 1.4, 1, 0.8, 0x1f7a35), 'legL'),
    ],
  },
  gingerbread: {
    col: 0xb06a32,
    paint: (s) => {
      const c = 0xb8702e, ic = 0xfdf8f0, edge = 0xa05e24;
      const cookie = (l: Layer) => s.paint(l, (f, x, y) => {
        const [, , w, h] = faceRects(l)[f];
        return jit(x === 0 || y === 0 || x === w - 1 || y === h - 1 ? edge : c, s.r, 0.05);
      });
      (['head', 'body', 'armR', 'armL', 'legR', 'legL'] as const).forEach(cookie);
      s.spr('head', FRONT, ['........', '.i.i.i.i', 'i.i.i.i.', '..k..k..', '.p....p.', '..i..i..', '...ii...'], { i: ic, k: 0x3a2214, p: 0xff8fa8 });
      s.spr('head', BACK, ['........', '.i.i.i.i', 'i.i.i.i.'], { i: ic });
      s.spr('body', FRONT, ['i.i..i.i', '.i.rr.i.', '...rr...', '........', '...gg...', '...gg...', '........', '...ww...', '...ww...', '........', 'i.i..i.i', '.i.i.i.i'],
        { i: ic, r: 0xe0303a, g: 0x3fae4a, w: 0x5fb4f0 });
      s.spr('body', BACK, ['.i.i.i.i', 'i.i.i.i.', '........', '........', '........', '........', '........', '........', '........', '........', 'i.i.i.i.', '.i.i.i.i'], { i: ic });
      const zig = (q: number, y: number) => (q % 2 ? (y === 8 ? ic : -1) : y === 9 ? ic : -1);
      s.limbs('arm', (f, _x, y, q) => (f >= 2 && (y === 8 || y === 9) && zig(q, y) >= 0 ? ic : -1));
      s.limbs('leg', (f, _x, y, q) => (f >= 2 && (y === 8 || y === 9) && zig(q, y) >= 0 ? ic : -1));
    },
  },
  snowman: {
    col: 0xe8f0f8,
    paint: (s) => {
      const snow = (l: Layer) => s.paint(l, (f) => { const q = s.r(); return f === BOTTOM ? 0xc8d6e6 : q < 0.1 ? 0xd2deec : q < 0.2 ? 0xe2eaf4 : 0xf4f8fc; });
      (['head', 'body', 'armR', 'armL', 'legR', 'legL'] as const).forEach(snow);
      const k = 0x1d1f24, red = 0xd62a2a, grn = 0x2e9b45;
      s.spr('head', FRONT, ['........', '........', '........', '..k..k..', '...oo...', '.k....k.', '..k..k..', '...kk...'], { k, o: 0xff8a1a });
      s.paint('hat', (f, x, y) => (f === TOP ? k : f === BOTTOM ? -1 : y === 0 ? k : -1));
      const stripe = (v: number) => (v % 3 === 2 ? grn : red);
      for (const l of ['body', 'jacket'] as const) {
        s.band(l, 0, 1, (q) => stripe(q >> 1), 0.02);
        s.paint(l, (f, x, y) => (f === TOP ? red : f === FRONT && x >= 1 && x <= 2 && y >= 2 && y <= 7 ? (y === 7 ? (x % 2 ? red : grn) : stripe(y)) : -1));
      }
      s.rect('body', FRONT, 4, 3, 2, 2, k, 0.1).rect('body', FRONT, 4, 7, 2, 2, k, 0.1).rect('body', FRONT, 4, 10, 2, 1, k, 0.1);
      s.limbs('arm', (_f, _x, y) => (y >= 9 ? jit(y === 9 ? 0xf4f4f4 : red, s.r, 0.04) : -1));
    },
    acc: [
      box('head', 0, -0.5, 5.4, 1.2, 1.2, 3, 0xff8a1a), box('head', 0, -0.5, 7.2, 0.8, 0.8, 0.8, 0xffa040),
      box('head', 0, 4.35, 0, 10, 0.7, 10, 0x1d1f24), box('head', 0, 5.4, 0, 6.6, 1.2, 6.6, 0xd62a2a), box('head', 0, 7.6, 0, 6.2, 3.4, 6.2, 0x24262c),
    ],
  },
  reindeer: {
    col: 0x8b5a2b,
    paint: (s) => {
      const b = 0x8b5a2b, l = 0xd9b38c, hoof = 0x3a2614;
      s.fill('head', b, 0.04);
      s.spr('head', FRONT, ['........', '........', '.wk..kw.', '.kk..kk.', '..lrrl..', '.llrrll.', '.lMllMl.', '..llll..'], { w: 0xffffff, k: 0x1d1f24, l, r: 0xe8202a, M: 0x5a2a1a });
      s.px('head', FRONT, 0, 1, 0x3a2614).px('head', FRONT, 7, 1, 0x3a2614);
      s.fill('body', b, 0.04).spr('body', FRONT, ['..llll..', '.llllll.', '.llllll.', '..llll..', '...ll...'], { l }, 0, 1);
      s.band('body', 0, 0, 0xd62a2a);
      s.limbs('arm', (_f, _x, y) => jit(y >= 10 ? hoof : b, s.r, 0.04));
      s.limbs('leg', (f, _x, y) => jit(y >= 10 ? hoof : f === FRONT && y < 3 ? shade(b, 1.1) : b, s.r, 0.04));
      s.spr('body', BACK, ['........', '........', '........', '........', '........', '........', '........', '........', '........', '...ll...', '...ll...'], { l });
    },
    acc: [
      box('head', 0, -0.5, 4.4, 2, 1.6, 1, 0xff2a34), ...pair(box('head', 4.9, 1.5, -1, 1.8, 1, 1.2, 0x7a4a22)),
      ...pair(box('head', 2.5, 6.4, -1, 1, 5, 1, 0xd8b483)), ...pair(box('head', 3.8, 7.6, -1, 2.2, 1, 1, 0xd8b483)),
      ...pair(box('head', 4.6, 9.1, -1, 1, 2.2, 1, 0xd8b483)), ...pair(box('head', 2.5, 8.2, 0.1, 1, 1, 1.4, 0xd8b483)),
      box('body', 0, 4, 2.6, 2, 2, 1.2, 0xf2c230),
    ],
  },
  snowmaiden: {
    col: 0x7cc4f0,
    paint: (s) => {
      const coat = 0x7cc4f0, fur = 0xf6fbff, silver = 0xdff3ff, blond = 0xf2c84a, skin = 0xf3c9a8;
      head(s, { skin, eye: 0x3a7fe0, mouth: 'none', blush: 0xff9fb0, hair: blond, front: 2, side: 6, back: 8 });
      s.px('head', FRONT, 3, 6, 0xe0505a).px('head', FRONT, 4, 6, 0xe0505a).px('head', FRONT, 1, 2, 0x8a5a2a).px('head', FRONT, 6, 2, 0x8a5a2a);
      s.px('head', FRONT, 0, 2, blond).px('head', FRONT, 7, 2, blond).px('head', FRONT, 0, 3, blond).px('head', FRONT, 7, 3, blond);
      s.paint('hat', (f, x, y) => {
        if (f === TOP) return jit(coat, s.r, 0.03);
        if (f === BOTTOM || y > 1) return -1;
        return y === 1 ? jit(fur, s.r, 0.02) : (x + f) % 3 === 0 ? silver : coat;
      });
      const pattern = (f: number, x: number, y: number) => (f === FRONT || f === BACK) && ((x === 1 || x === 6) && (y % 4 === 2)) ? silver : -1;
      s.fill('body', coat, 0.03).band('body', 0, 0, fur).band('body', 11, 11, fur);
      s.paint('body', (f, x, y) => (f === FRONT && (x === 3 || x === 4) ? jit(fur, s.r, 0.02) : pattern(f, x, y)));
      s.spr('body', FRONT, ['........', '........', '.s....s.', 'sss..sss', '.s....s.'], { s: silver }, 0, 3);
      s.limbs('arm', (_f, _x, y) => jit(y >= 10 ? skin : y >= 8 ? fur : y === 4 ? silver : coat, s.r, 0.03));
      s.limbs('leg', (f, x, y, _q, left) => {
        if (y >= 9) return jit(0xd8e8f8, s.r, 0.03);
        if (y >= 7) return jit(fur, s.r, 0.02);
        if (f === FRONT && x === (left ? 3 : 3)) return jit(fur, s.r, 0.02);
        return jit(y === 3 && (f === FRONT || f === BACK) && x % 2 === 0 ? silver : coat, s.r, 0.03);
      });
    },
    acc: [
      box('head', 0, -3, -4.1, 2.4, 2, 1.6, 0xf2c84a), box('head', 0, -5.2, -3.4, 2.2, 2.2, 1.6, 0xd9a832), box('head', 0, -7.4, -2.9, 2.4, 2.2, 1.6, 0xf2c84a),
      box('head', 0, -9.6, -2.9, 2.2, 2.2, 1.6, 0xd9a832), box('head', 0, -11.8, -2.9, 2.4, 2.2, 1.6, 0xf2c84a),
      box('head', 0, -13.3, -2.9, 2.8, 0.9, 2, 0x3d8be0), box('head', 0, -14.5, -2.9, 1.8, 1.6, 1.4, 0xf2c84a),
      box('head', 0, 5.3, 3.6, 2, 2.6, 0.8, 0xe8f4ff), box('head', 0, 5.1, 4.1, 1, 1.2, 0.4, 0x4fd8ff),
      ...pair(box('head', 1.9, 4.9, 3.6, 1.6, 1.8, 0.8, 0xe8f4ff)), ...pair(box('head', 3.3, 4.7, 3.4, 1.2, 1.2, 0.8, 0xc8def2)),
    ],
  },
  iceknight: {
    col: 0x6ff8ff,
    paint: (s) => {
      const ice = 0x9fd6f2, dk = 0x4f8fc8, glow = 0x6ff8ff, steel = 0x3a4f6a;
      s.fill('head', 0x1d2a3a, 0.02);
      s.paint('hat', (f, x, y) => {
        if (f === BOTTOM) return -1;
        if (f === TOP) return x === 3 || x === 4 ? 0xdff6ff : jit(ice, s.r, 0.03);
        if (f === FRONT) {
          if (y === 3 && x > 0 && x < 7) return x === 3 || x === 4 ? 0xe8ffff : glow;
          if (y === 4 && x > 0 && x < 7) return dk;
          if (y >= 5 && (x === 2 || x === 5) && y % 2) return 0x1d2a3a;
          return jit(y === 0 ? 0xc8ecff : ice, s.r, 0.03);
        }
        return jit(y === 3 ? dk : y === 7 ? dk : ice, s.r, 0.03);
      });
      s.fill('body', ice, 0.03).band('body', 4, 4, dk).band('body', 8, 9, steel).band('body', 11, 11, dk);
      s.spr('body', FRONT, ['...ww...', '.w.ww.w.', '..wggw..', 'wwggggww', '..wggw..', '.w.ww.w.', '...ww...'], { w: 0xe8ffff, g: glow }, 0, 0);
      s.rect('body', FRONT, 3, 8, 2, 2, glow, 0);
      s.paint('jacket', (f, x, y) => (f !== BOTTOM && y < 8 ? (f === FRONT && y < 7 ? -1 : f === TOP ? jit(ice, s.r, 0.03) : jit(y === 7 ? dk : ice, s.r, 0.03)) : -1));
      s.limbs('arm', (_f, _x, y) => jit(y >= 8 ? dk : y % 4 === 3 ? dk : ice, s.r, 0.03));
      s.limbs('leg', (f, _x, y) => jit(y >= 9 ? steel : f === FRONT && (y === 5 || y === 6) ? 0xd8f4ff : y === 0 ? dk : ice, s.r, 0.03));
    },
    acc: [box('head', 0, 5.7, -0.5, 1, 2.6, 6, 0xdff6ff), box('armR', -0.6, 5.6, 0, 5.6, 2.4, 5.6, 0xbfe8ff), box('armL', 0.6, 5.6, 0, 5.6, 2.4, 5.6, 0xbfe8ff)],
  },
  santa: {
    col: 0xc8202a,
    paint: (s) => {
      const red = 0xc8202a, fur = 0xf6f6f6, silver = 0xdfe8f2, skin = 0xf0c0a0;
      head(s, { skin, eye: 0x3a5f9a, mouth: 'none', hair: 0xf2f2f2, front: 0, side: 3, back: 6 });
      s.spr('head', FRONT, ['........', '........', '.ww..ww.', '.p....p.', 'wwwnnwww', 'wwwmmwww', 'wwwwwwww', '.wwwwww.'], { w: fur, p: 0xf08a8a, n: 0xe87070, m: 0x8a2a2a });
      s.paint('head', (f, x, y) => ((f === RIGHT && x >= 5) || (f === LEFT && x <= 2)) && y >= 2 ? jit(fur, s.r, 0.03) : -1);
      s.paint('hat', (f, x, y) => {
        if (f === TOP) return jit(red, s.r, 0.03);
        if (f === BOTTOM) return -1;
        const rows = f === FRONT ? 2 : 3;
        return y < rows ? ((x + y) % 4 === 0 ? 0xe2e8ee : jit(fur, s.r, 0.02)) : -1;
      });
      s.region(REG_A, (x, y) => ((x * 3 + y * 5) % 11 === 0 ? silver : jit(red, s.r, 0.04)));
      s.region(REG_B, (x, y) => ((x * 3 + y * 5) % 7 === 0 ? 0xd8dde4 : jit(fur, s.r, 0.02)));
      s.fill('body', red, 0.03).band('body', 0, 0, fur).band('body', 6, 6, 0xeef2f6).band('body', 11, 11, fur);
      s.paint('body', (f, x, y) => (f === FRONT && (x === 3 || x === 4) ? ((y + x) % 3 === 0 ? silver : jit(fur, s.r, 0.02)) : -1));
      s.spr('body', FRONT, ['s.....s.', '.s...s..', 's.....s.'], { s: silver }, 0, 2);
      s.spr('body', BACK, ['..s..s..', '.s.ss.s.', '..s..s..'], { s: silver }, 0, 2);
      s.limbs('arm', (_f, _x, y) => jit(y >= 10 ? (y === 10 ? silver : red) : y >= 8 ? fur : red, s.r, 0.03));
      s.limbs('leg', (f, x, y, q) => {
        if (y >= 8) return jit(y === 8 ? 0x7a141c : 0x8a1a20, s.r, 0.04);
        if (y >= 6) return y === 6 && q % 3 === 0 ? silver : jit(fur, s.r, 0.02);
        if (f === FRONT && x === 3) return jit(fur, s.r, 0.02);
        return jit(red, s.r, 0.03);
      });
    },
    acc: [
      box('head', 0, 5.6, 0, 8, 2.2, 8, REG_A), box('head', 0, 7.1, 0, 6, 1, 6, REG_A),
      box('head', 0, -3.2, 4.5, 7.4, 4.8, 1.4, REG_B), box('head', 0, -6.3, 3.5, 5.4, 2.6, 1.4, REG_B), box('head', 0, -8.2, 2.9, 3, 1.6, 1.2, REG_B),
      box('body', 0.5, 0.5, -2.8, 1.3, 30, 1.3, 0xd8e2ee, 0.42),
      box('body', 0.5 - Math.sin(0.42) * 16.4, 0.5 + Math.cos(0.42) * 16.4, -2.8, 3, 3, 3, 0x7fe0ff, 0.42),
      box('body', 0.5 - Math.sin(0.42) * 14.6, 0.5 + Math.cos(0.42) * 14.6, -2.8, 2, 1, 2, 0xf2c230, 0.42),
    ],
  },
  yeti: {
    col: 0xbcd6f0,
    paint: (s) => {
      const fur = (l: Layer) => s.paint(l, (f, x, y) => { const q = s.r(); return f === BOTTOM ? 0xb0c2d6 : (x * 7 + f + (y >> 2)) % 3 === 0 && q < 0.7 ? 0xc6d4e4 : q < 0.15 ? 0xb8c8dc : 0xf0f5fa; });
      (['head', 'body', 'armR', 'armL', 'legR', 'legL'] as const).forEach(fur);
      s.spr('head', FRONT, ['........', '..bbbb..', '.DDbbDD.', '.byKbKy.', '.bbbbbb.', '.bwmmwb.', '..bmmb..', '..bbbb..'],
        { b: 0x5a9ad8, D: 0x2a4a7a, y: 0xfff6c0, K: 0x14182a, w: 0xffffff, m: 0x1a2a44 });
      // shaggy overlay fur with ragged lower edges
      const shag = (l: Layer, rows: number) => s.paint(l, (f, x, y) => (f === BOTTOM ? -1 : f === TOP || y < rows - ((x * 5 + f) % 3 === 0 ? 1 : 0) ? jit((x * 2 + y) % 4 ? 0xf6f9fc : 0xcfdbe8, s.r, 0.02) : -1));
      s.paint('hat', (f, x, y) => (f === BOTTOM ? -1 : f === TOP || (f !== FRONT && y < 3 - (x % 2)) || (f === FRONT && y === 0 && x % 3 !== 1) ? jit((x + y) % 3 ? 0xf4f8fc : 0xd8e2ee, s.r, 0.02) : -1));
      shag('jacket', 12); shag('sleeveR', 9); shag('sleeveL', 9); shag('pantsR', 10); shag('pantsL', 10);
      s.limbs('arm', (_f, _x, y) => (y >= 10 ? jit(0x6a8fb8, s.r, 0.04) : -1));
      s.limbs('leg', (_f, _x, y) => (y >= 10 ? jit(0x6a8fb8, s.r, 0.04) : -1));
      s.limbs('arm', (f, x, y) => (f === FRONT && y === 11 && x % 2 === 0 ? WHITE : -1));
    },
    acc: [...pair(box('head', 3, 5, 0, 1.2, 2, 1.2, 0xcfeeff)), ...pair(box('head', 3.6, 6.5, 0, 1, 1.2, 1, 0xe8f8ff))],
  },
  nutcracker: {
    col: 0xe0b030,
    paint: (s) => {
      const red = 0xc81e2a, gold = 0xf2c230, navy = 0x20307a, blk = 0x1d1f24, skin = 0xf2c8a8;
      head(s, { skin, eye: DARK, mouth: 'none', hair: 0xf4f4f4, front: 0, side: 7, back: 8 });
      s.spr('head', FRONT, ['........', '........', '.kk..kk.', '.wK..Kw.', '.p.nn.p.', 'kkkkkkkk', 'wwmmmmww', 'wwwwwwww'], { k: blk, w: 0xf4f4f4, K: DARK, p: 0xf08080, n: shade(skin, 0.88), m: 0x8a1a20 });
      s.paint('hat', (f, x, y) => (f === TOP ? blk : f === BOTTOM ? -1 : y === 0 ? gold : y === 1 && f !== FRONT ? blk : -1));
      s.fill('body', red, 0.03).band('body', 0, 0, gold).band('body', 8, 8, 0xf4f4f4).band('body', 11, 11, gold);
      s.paint('body', (f, x, y) => (f === FRONT && (x === 1 || x === 6) && y % 2 === 0 && y > 1 && y < 8 ? gold : f === FRONT && x > 2 && x < 5 && y === 8 ? gold : -1));
      s.limbs('arm', (_f, _x, y) => jit(y >= 10 ? 0xf4f4f4 : y >= 8 ? gold : red, s.r, 0.03));
      s.limbs('leg', (f, x, y, _q, left) => {
        if (y >= 6) return jit(y === 6 ? gold : f === FRONT && x === (left ? 2 : 1) ? 0x4a4f5a : blk, s.r, 0.03);
        return (f === RIGHT || f === LEFT) && x === 1 ? gold : jit(navy, s.r, 0.03);
      });
    },
    acc: [
      box('head', 0, 4.9, 0, 8.6, 1.2, 8.6, 0xf2c230), box('head', 0, 7.9, 0, 8, 5, 8, 0x1d1f24), box('head', 0, 10.5, 0, 8.4, 0.8, 8.4, 0xf2c230),
      box('head', 0, 7.8, 4.2, 2.4, 2.4, 0.6, 0xf2c230), box('head', 0, 12.1, 0.5, 1.6, 2.4, 1.6, 0xffffff),
      box('head', 0, -2.9, 4.3, 6.4, 2.2, 0.8, 0xf4f4f4),
      box('armR', -0.3, 6.4, 0, 5.2, 1.2, 5.2, 0xf2c230), box('armL', 0.3, 6.4, 0, 5.2, 1.2, 5.2, 0xf2c230),
      box('armR', -0.3, 5.3, 0, 5.4, 1, 5.4, 0xd99e24), box('armL', 0.3, 5.3, 0, 5.4, 1, 5.4, 0xd99e24),
    ],
  },
};

// ---------------------------------------------------------------- skin cache

let noobImg: Pix | null = null;
const pixes = new Map<string, Pix>();
const canvases = new Map<string, HTMLCanvasElement>();
const texs = new Map<string, Texture>();
const accs = new Map<string, Acc[]>();
const layerSets = new Map<string, Set<Layer>>();

const known = (id: string): SkinId => (id in SKINS ? (id as SkinId) : 'noob');

/** load image-based skins (the hero 'noob' from images/noob.png, 64x32 → converted to 64x64); await once at startup */
export async function loadSkinAssets(): Promise<void> {
  if (noobImg) return;
  try {
    const img = new Image();
    img.src = new URL('./images/noob.png', import.meta.url).href;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0);
    noobImg = legacyTo64(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  } catch (e) {
    console.warn('noob skin failed to load, using the painted stand-in', e);
    return;
  }
  // repaint the image-based skins in place (canvases/textures may already be in use)
  for (const id of ['noob', 'winter']) {
    pixes.delete(id);
    layerSets.delete(id);
    const cv = canvases.get(id);
    if (!cv) continue;
    const p = skinPix(id), img = cv.getContext('2d')!.createImageData(64, 64);
    img.data.set(p.d);
    cv.getContext('2d')!.putImageData(img, 0, 0);
    texs.get(id)?.update();
  }
}

/**
 * Classic 64x32 skin → 64x64: the top half is copied, the left arm/leg are the right ones mirrored (each face flipped
 * horizontally, outer/inner side faces swapped — the usual legacy conversion). A 64x64 image is used as is.
 */
export function legacyTo64(src: Uint8ClampedArray, w: number, h: number): Pix {
  const p = new Pix(64, 64);
  const k = w / 64;
  const get = (x: number, y: number) => (Math.floor(y * k) * w + Math.floor(x * k)) * 4;
  const copy = (sx: number, sy: number, dx: number, dy: number, cw: number, chh: number, flip: boolean) => {
    for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
      const i = get(sx + (flip ? cw - 1 - x : x), sy + y);
      p.set(dx + x, dy + y, (src[i] << 16) | (src[i + 1] << 8) | src[i + 2], src[i + 3]);
    }
  };
  copy(0, 0, 0, 0, 64, h >= w ? 64 : 32, false);
  if (h >= w) return p;
  for (const [su, sv, du, dv] of [[0, 16, 16, 48], [40, 16, 32, 48]]) {
    copy(su + 4, sv, du + 4, dv, 4, 4, true); // top
    copy(su + 8, sv, du + 8, dv, 4, 4, true); // bottom
    copy(su, sv + 4, du + 8, dv + 4, 4, 12, true); // right side → left side
    copy(su + 4, sv + 4, du + 4, dv + 4, 4, 12, true); // front
    copy(su + 8, sv + 4, du, dv + 4, 4, 12, true); // left side → right side
    copy(su + 12, sv + 4, du + 12, dv + 4, 4, 12, true); // back
  }
  return p;
}

/** paint (or fetch) a skin's 64x64 pixels incl. the accessory palette (pure; no DOM) */
export function skinPix(id: string): Pix {
  const sid = known(id);
  let p = pixes.get(sid);
  if (p) return p;
  const def = SKINS[sid];
  if ((sid === 'noob' || sid === 'winter') && noobImg) {
    p = new Pix(64, 64);
    p.d.set(noobImg.d);
  } else {
    p = new Pix(64, 64);
    if (sid === 'winter') paintNoob(new SP(p, rng(hash('noob'))));
  }
  if (sid !== 'noob' || !noobImg) def.paint(new SP(p, rng(hash(sid))));
  // palette for solid-colored accessories
  const list = def.acc ?? [];
  const pal: number[] = [];
  for (const a of list) {
    if (a.c === undefined) continue;
    let i = pal.indexOf(a.c);
    if (i < 0) { i = pal.length; pal.push(a.c); p.set(PAL_X + (i % 8), PAL_Y + (i >> 3), a.c); }
    a.uv = [PAL_X + (i % 8), PAL_Y + (i >> 3), 1, 1];
  }
  accs.set(sid, list);
  pixes.set(sid, p);
  return p;
}
/** the accessory boxes of a skin (uv filled in; do not modify) */
export function skinAccessories(id: string): Acc[] {
  skinPix(id);
  return accs.get(known(id)) ?? [];
}
/** overlay layers that have visible pixels (only those get geometry) */
export function skinLayers(id: string): Set<Layer> {
  const sid = known(id);
  let out = layerSets.get(sid);
  if (out) return out;
  const p = skinPix(sid);
  out = new Set<Layer>();
  for (const part of PARTS) {
    const l = OVER[part];
    if (faceRects(l).some(([x, y, w, h]) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (p.alpha(i, j) > 127) return true; return false; })) out.add(l);
  }
  layerSets.set(sid, out);
  return out;
}

/** 64x64 skin canvas (cached; do not modify) */
export function skinCanvas(id: string): HTMLCanvasElement {
  const sid = known(id);
  let c = canvases.get(sid);
  if (!c) { c = skinPix(sid).canvas(); canvases.set(sid, c); }
  return c;
}
/** nearest-filtered skin texture without mips (accessory palette texels must not bleed) */
export function skinTexture(id: string): Texture {
  const sid = known(id);
  let t = texs.get(sid);
  if (!t) { t = Texture.fromCanvas(skinCanvas(sid), { filter: 'nearest', wrap: 'clamp', mips: false }); texs.set(sid, t); }
  return t;
}
/** signature color of a skin (markers on the progress bar) */
export function skinColor(id: string): string { return hex(SKINS[known(id)].col); }

// ---------------------------------------------------------------- 2D front views

const OUTLINE = 0x1b1d2b;
/** part box centers in a front view (x right = character's left, y down), relative to the head center */
const FRONT_POS: Record<PartName, [number, number, number]> = {
  head: [0, 0, 4], body: [0, 10, 2], armR: [-6, 10, 2], armL: [6, 10, 2], legR: [-2, 22, 2], legL: [2, 22, 2],
};

/** draw parts (+ overlays + accessories) of a skin front-on into p, head center at (hx, hy), back-to-front by z */
function drawFront(p: Pix, id: string, parts: PartName[], hx: number, hy: number) {
  const sk = skinPix(id), layers = skinLayers(id);
  const items: { z: number; draw: () => void }[] = [];
  for (const part of parts) {
    const [ox, oy, z] = FRONT_POS[part];
    for (const l of [part, OVER[part]] as Layer[]) {
      if (l !== part && !layers.has(l)) continue;
      const [x0, y0, w, h] = faceRects(l)[FRONT];
      items.push({
        z: z + (l === part ? 0 : 0.5),
        draw: () => {
          for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
            if (sk.alpha(x0 + i, y0 + j) > 127) p.set(hx + ox - w / 2 + i, hy + oy - h / 2 + j, sk.get(x0 + i, y0 + j));
          }
        },
      });
    }
  }
  for (const a of skinAccessories(id)) {
    if (!parts.includes(a.part)) continue;
    const [ox, oy] = FRONT_POS[a.part], [u, v, rw, rh] = a.uv!;
    const cx = hx + ox + a.x, cy = hy + oy - a.y, cs = Math.cos(a.rz ?? 0), sn = Math.sin(a.rz ?? 0);
    const ext = Math.hypot(a.w, a.h) / 2 + 1;
    items.push({
      z: a.z + a.d / 2 + 0.01,
      draw: () => {
        for (let y = Math.floor(cy - ext); y <= cy + ext; y++) for (let x = Math.floor(cx - ext); x <= cx + ext; x++) {
          const dx = x + 0.5 - cx, dy = cy - (y + 0.5);
          const lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
          if (Math.abs(lx) > a.w / 2 || Math.abs(ly) > a.h / 2) continue;
          const tu = u + Math.min(rw - 1, Math.floor(((lx / a.w) + 0.5) * rw)), tv = v + Math.min(rh - 1, Math.floor((0.5 - ly / a.h) * rh));
          p.set(x, y, sk.get(tu, tv));
        }
      },
    });
  }
  items.sort((a, b) => a.z - b.z).forEach((it) => it.draw());
  return p.outline(OUTLINE);
}

/** scale a small Pix into a canvas of (cw x ch) with the largest integer factor that fits (centered, crisp) */
function fitCanvas(p: Pix, cw: number, ch: number): HTMLCanvasElement {
  const src = p.canvas(), c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const k = Math.max(1, Math.floor(Math.min(cw / p.w, ch / p.h))), g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(src, Math.floor((cw - p.w * k) / 2), Math.floor((ch - p.h * k) / 2), p.w * k, p.h * k);
  return c;
}

/** NEW canvas each call: head front (avatar) incl. hat/antlers/beard, px = output size */
export function skinPortrait(id: string, px = 48): HTMLCanvasElement {
  return fitCanvas(drawFront(new Pix(14, 14), id, ['head'], 7, 9), px, px);
}
/** NEW canvas each call: full body front view (cards), px = output height (width = 0.6 * px) */
export function skinFigure(id: string, px = 128): HTMLCanvasElement {
  return fitCanvas(drawFront(new Pix(26, 44), id, PARTS, 13, 14), Math.round((px * 26) / 44), px);
}

// ---------------------------------------------------------------- balls

/** cheap position hash → 0..1 (voxel centers are on a fixed grid, so this is stable) */
const h3 = (x: number, y: number, z: number) => { const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return n - Math.floor(n); };
const TAU = Math.PI * 2;

interface BallDef { paint(x: number, y: number, z: number): number; mat?: { metalness: number; roughness: number } }
/** ice facet directions (deterministic) */
const FACETS = /* @__PURE__ */ (() => { const r = rng(7); return Array.from({ length: 16 }, () => { const a = r() * TAU, z = r() * 2 - 1, q = Math.sqrt(1 - z * z); return [Math.cos(a) * q, z, Math.sin(a) * q]; }); })();

const BALLS: Record<BallId, BallDef> = {
  snow: { paint: (x, y, z) => { const q = h3(x, y, z); return q < 0.16 ? 0xdbe5f0 : q < 0.24 ? 0xc6d5e7 : q > 0.95 ? 0xffffff : 0xf1f5fa; } },
  tangerine: {
    paint: (x, y, z) => {
      if (y > 0.8 && Math.abs(x) < 0.2 && Math.abs(z) < 0.2) return 0x6b4423;
      if (y > 0.62 && x > 0.1 && x < 0.62 && Math.abs(z - x * 0.25) < 0.2) return x > 0.4 ? 0x3c9a48 : 0x4fb85a;
      const q = h3(x, y, z);
      return q < 0.2 ? 0xe46f0c : q < 0.3 ? 0xffa53e : 0xff8c1a;
    },
  },
  candy: {
    paint: (x, y, z) => {
      const a = Math.atan2(z, x) / TAU + y * 0.45;
      const k = (((a * 6) % 2) + 2) % 2;
      return k < 1 ? (k < 0.18 ? 0xff5a64 : 0xe0202e) : 0xfafafa;
    },
  },
  ornament: {
    paint: (x, y, z) => {
      if (y > 0.78) return Math.abs(x) < 0.2 && Math.abs(z) < 0.2 && y > 0.9 ? 0xb8bcc4 : 0xe0e2e8;
      if (Math.abs(y) < 0.17) return h3(x, y, z) < 0.25 ? 0xfff0a0 : 0xf2c230;
      if (Math.abs(y - 0.42) < 0.08 || Math.abs(y + 0.42) < 0.08) return 0xf2c230;
      return h3(x, y, z) < 0.12 ? 0xf04050 : 0xd81e2e;
    },
    mat: { metalness: 0.15, roughness: 0.25 },
  },
  garland: {
    paint: (x, y, z) => {
      const a = Math.atan2(z, x);
      const t = (((y * 2.2 + a / Math.PI) % 2) + 2) % 2;
      if (t < 0.42) {
        const bulb = Math.floor(((a + Math.PI) / TAU) * 10);
        if ((bulb + Math.floor(y * 4)) % 2 === 0) return [0xff4050, 0xffd447, 0x40e070, 0x40a0ff, 0xff80ff][((bulb % 5) + 5) % 5] | GLOW;
        return 0x2c5a2c;
      }
      const q = h3(x, y, z);
      return q < 0.15 ? 0xdbe5f0 : 0xf1f5fa;
    },
  },
  ice: {
    paint: (x, y, z) => {
      let b1 = -2, b2 = -2, id = 0;
      FACETS.forEach(([fx, fy, fz], i) => { const d = fx * x + fy * y + fz * z; if (d > b1) { b2 = b1; b1 = d; id = i; } else if (d > b2) b2 = d; });
      if (b1 - b2 < 0.045) return 0xeafcff;
      return [0xa8ecff, 0x7fd8f8, 0xc8f6ff, 0x5ec4ee, 0x9ae4fc, 0x6fcff4][id % 6];
    },
    mat: { metalness: 0.05, roughness: 0.18 },
  },
  disco: {
    paint: (x, y, z) => {
      const q = h3(x, y, z);
      if (q < 0.1) return [0xffb0e0, 0xb0f0ff, 0xfff0a0, 0xffffff][Math.floor(q * 40)] | GLOW;
      return [0xc0c8d2, 0xe8eef4, 0x9aa4b0, 0xffffff, 0xd2d8e0][Math.floor(q * 5)];
    },
    mat: { metalness: 0.3, roughness: 0.12 },
  },
  gold: {
    paint: (x, y, z) => { const q = h3(x, y, z); return q < 0.06 ? 0xfff4c0 | GLOW : q < 0.25 ? 0xffe680 : q < 0.5 ? 0xf5c030 : q < 0.6 ? 0xe0a820 : 0xffd84a; },
    mat: { metalness: 0.3, roughness: 0.3 },
  },
  olivier: {
    paint: (x, y, z) => {
      const q = h3(x, y, z), big = h3(Math.round(x * 3), Math.round(y * 3), Math.round(z * 3));
      if (q < 0.1) return 0x5aa832; // peas
      if (q < 0.16) return 0xf08a2a; // carrot
      if (big < 0.26) return 0xe9d595; // potato
      if (big < 0.36) return 0xe8a6a0; // sausage
      if (big < 0.44) return q < 0.5 ? 0xffd34a : 0xfbfbf3; // egg
      if (big < 0.5) return 0x7c9a3a; // pickles
      return q < 0.6 ? 0xf3ead2 : 0xebe0c2; // mayonnaise
    },
  },
};

const known2 = (id: string): BallId => (id in BALLS ? (id as BallId) : 'snow');
const ballGeos = new Map<string, Geometry>();
const ballMats = new Map<string, Material>();

/** voxel ball of radius 1 for a ball skin (cached; 12^3 grid) */
export function ballGeometry(id: string): Geometry {
  const b = known2(id);
  let g = ballGeos.get(b);
  if (!g) { g = voxelSphere(12, BALLS[b].paint); ballGeos.set(b, g); }
  return g;
}
/** material for a ball skin (cached): lambert, or standard (metallic/glossy) for ornament/ice/disco/gold */
export function ballMaterial(id: string): Material {
  const b = known2(id);
  let m = ballMats.get(b);
  if (!m) {
    const o = BALLS[b].mat;
    m = o ? standard(0xffffff, { map: tex('voxel'), ...o }) : lambert(0xffffff, { map: tex('voxel') });
    ballMats.set(b, m);
  }
  return m;
}
/** the ball as a 16x16 pixel disc (seen slightly from above, lit from the top-left; pure) */
export function ballPix(id: string): Pix {
  const paint = BALLS[known2(id)].paint, p = new Pix(16, 16), tilt = 0.45, ct = Math.cos(tilt), st = Math.sin(tilt);
  p.each((x, y) => {
    const nx = (x + 0.5 - 8) / 7, ny = (8 - (y + 0.5)) / 7, q = nx * nx + ny * ny;
    if (q > 1) return;
    const nz = Math.sqrt(1 - q);
    // tilt the ball towards the viewer so the top (leaf, cap) shows; snap to the voxel grid like the 3D ball
    const sy = ny * ct + nz * st, sz = -ny * st + nz * ct, g = (v: number) => (Math.floor((v * 0.97 + 1) * 6) + 0.5) / 6 - 1;
    const c = paint(g(nx), g(sy), g(sz)) & 0xffffff;
    const l = nx * -0.5 + ny * 0.6 + nz * 0.62;
    p.set(x, y, shade(c, l > 0.62 ? 1.08 : l > 0.2 ? 0.96 : l > -0.1 ? 0.84 : 0.72));
  });
  return p.outline(OUTLINE);
}
/** NEW canvas each call: 2D pixel ball icon */
export function ballIcon(id: string, px = 64): HTMLCanvasElement { return fitCanvas(ballPix(id), px, px); }
