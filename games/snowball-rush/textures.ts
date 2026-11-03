// Procedural pixel art (owner: art): 16x16 block textures, UI icons and sign textures. Our own art, generic voxel style.
// Everything is deterministic (seeded by the id) and drawn lazily on first use. The painters work on a plain pixel buffer
// (Pix, no DOM) so they are testable; only canvas()/tex()/iconURL() touch the DOM.
import { Texture } from 'aiwebengine';
import { hash, rng } from './util';

type Rnd = () => number;

// ---------------------------------------------------------------- pixel buffer & colors

/** RGBA pixel buffer for procedural pixel art. Colors are 0xRRGGBB; `tile` wraps coordinates (seamless textures). */
export class Pix {
  readonly d: Uint8ClampedArray;
  constructor(readonly w: number, readonly h: number, readonly tile = false) { this.d = new Uint8ClampedArray(w * h * 4); }
  private _i(x: number, y: number): number {
    x = Math.floor(x); y = Math.floor(y);
    if (this.tile) { x = ((x % this.w) + this.w) % this.w; y = ((y % this.h) + this.h) % this.h; }
    else if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    return (y * this.w + x) * 4;
  }
  set(x: number, y: number, c: number, a = 255) {
    const i = this._i(x, y);
    if (i >= 0) { const d = this.d; d[i] = (c >> 16) & 255; d[i + 1] = (c >> 8) & 255; d[i + 2] = c & 255; d[i + 3] = a; }
    return this;
  }
  get(x: number, y: number): number {
    const i = this._i(x, y), d = this.d;
    return i < 0 ? 0 : (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
  }
  alpha(x: number, y: number): number { const i = this._i(x, y); return i < 0 ? 0 : this.d[i + 3]; }
  each(fn: (x: number, y: number) => void) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) fn(x, y); return this; }
  rect(x: number, y: number, w: number, h: number, c: number, a = 255) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c, a);
    return this;
  }
  /** pixels whose centers lie within r0 <= dist <= r1 of (cx, cy); `fn` may pick the color per pixel */
  ring(cx: number, cy: number, r0: number, r1: number, c: number | ((x: number, y: number) => number)) {
    for (let y = Math.floor(cy - r1); y <= cy + r1; y++) for (let x = Math.floor(cx - r1); x <= cx + r1; x++) {
      const q = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (q >= r0 && q <= r1) { const k = typeof c === 'number' ? c : c(x, y); if (k >= 0) this.set(x, y, k); }
    }
    return this;
  }
  disc(cx: number, cy: number, r: number, c: number | ((x: number, y: number) => number)) { return this.ring(cx, cy, -1, r, c); }
  /** polygon [x0,y0,x1,y1,...] (even-odd rule at pixel centers) */
  poly(pts: number[], c: number | ((x: number, y: number) => number)) {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); }
    for (let y = Math.floor(y0); y <= y1; y++) for (let x = Math.floor(x0); x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
        const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) { const k = typeof c === 'number' ? c : c(x, y); if (k >= 0) this.set(x, y, k); }
    }
    return this;
  }
  line(x0: number, y0: number, x1: number, y1: number, c: number) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
    return this;
  }
  /** rows of characters → colors (pal maps a char to 0xRRGGBB; unknown chars are skipped) */
  sprite(rows: string[], pal: Record<string, number>, ox = 0, oy = 0) {
    rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const c = pal[row[x]]; if (c !== undefined) this.set(ox + x, oy + y, c); } });
    return this;
  }
  /** transparent pixels next to opaque ones (4-neighborhood) get color c: a 1 px outline */
  outline(c: number) {
    const add: number[] = [];
    this.each((x, y) => {
      if (this.alpha(x, y)) return;
      if (this.alpha(x - 1, y) || this.alpha(x + 1, y) || this.alpha(x, y - 1) || this.alpha(x, y + 1)) add.push(x, y);
    });
    for (let i = 0; i < add.length; i += 2) this.set(add[i], add[i + 1], c);
    return this;
  }
  /** copy into a new canvas, optionally upscaled (nearest) */
  canvas(scale = 1): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.w * scale; c.height = this.h * scale;
    const g = c.getContext('2d')!;
    const img = g.createImageData(this.w, this.h);
    img.data.set(this.d);
    if (scale === 1) { g.putImageData(img, 0, 0); return c; }
    const s = document.createElement('canvas');
    s.width = this.w; s.height = this.h;
    s.getContext('2d')!.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(s, 0, 0, c.width, c.height);
    return c;
  }
}

const ch = (v: number, k: number) => Math.max(0, Math.min(255, Math.round((v & 255) * k)));
/** brightness multiply (k > 1 lightens) */
export const shade = (c: number, k: number) => (ch(c >> 16, k) << 16) | (ch(c >> 8, k) << 8) | ch(c, k);
/** linear mix of two colors */
export function mix(a: number, b: number, t: number): number {
  const m = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}
/** random brightness jitter ±amt */
export const jit = (c: number, r: Rnd, amt: number) => shade(c, 1 + (r() * 2 - 1) * amt);
/** '#rrggbb' */
export const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** tileable smooth value noise on a size x size texture with n x n random lattice values → (x, y) => 0..1 */
export function vnoise(r: Rnd, n = 4, size = 16) {
  const g = Array.from({ length: n * n }, r);
  const v = (i: number, j: number) => g[(((j % n) + n) % n) * n + (((i % n) + n) % n)];
  const s = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const fx = ((x + 0.5) / size) * n, fy = ((y + 0.5) / size) * n;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = s(fx - x0), ty = s(fy - y0);
    const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * tx, b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
}

/** tileable Voronoi cells: (x, y) → [cell index, nearest distance, second nearest distance] */
function cells(r: Rnd, n: number, size = 16) {
  const pts = Array.from({ length: n }, () => [r() * size, r() * size]);
  const out = [0, 0, 0];
  return (x: number, y: number) => {
    let d1 = 1e9, d2 = 1e9, id = 0;
    pts.forEach(([px, py], i) => {
      let dx = Math.abs(x + 0.5 - px), dy = Math.abs(y + 0.5 - py);
      dx = Math.min(dx, size - dx); dy = Math.min(dy, size - dy);
      const d = Math.hypot(dx, dy);
      if (d < d1) { d2 = d1; d1 = d; id = i; } else if (d < d2) d2 = d;
    });
    out[0] = id; out[1] = d1; out[2] = d2;
    return out;
  };
}

// ---------------------------------------------------------------- block textures (16x16)

export type TexId =
  | 'snow' | 'snowSide' | 'dirt' | 'ice' | 'packedIce' | 'thaw' | 'salt' | 'boost' | 'planks' | 'log' | 'logTop'
  | 'leaves' | 'snowLeaves' | 'stone' | 'cobble' | 'brick' | 'wool' | 'giftRed' | 'giftGreen' | 'giftBlue' | 'giftGold'
  | 'coal' | 'fire' | 'water' | 'gold' | 'glass' | 'lamp' | 'candy' | 'iceWall' | 'spike' | 'metal' | 'redWool' | 'window'
  // extras: finish-line checker, igloo snow bricks, yellow/black hazard stripes (plow), 8x8 voxel bevel (ball faces)
  | 'finish' | 'snowBrick' | 'hazard' | 'voxel';

function snowFill(p: Pix, r: Rnd, y1 = p.h) {
  const n = vnoise(r, 4, p.w);
  for (let y = 0; y < y1; y++) for (let x = 0; x < p.w; x++) {
    const q = r();
    p.set(x, y, q < 0.06 ? 0xc6d8ec : q < 0.15 ? 0xdae5f2 : q > 0.975 ? 0xffffff : mix(0xf6f9fd, 0xe5edf7, n(x, y)));
  }
}
function dirtFill(p: Pix, r: Rnd) {
  const n = vnoise(r, 4);
  p.each((x, y) => {
    const q = r();
    p.set(x, y, q < 0.1 ? 0x5a3a25 : q < 0.2 ? 0x8f6444 : q < 0.23 ? 0x8d8781 : mix(0x7c5438, 0x664229, n(x, y)));
  });
}
function woolFill(p: Pix, r: Rnd, c: number) {
  p.each((x, y) => {
    const wave = (x + y * 2 + Math.round(Math.sin(y * 1.7) * 1.5)) % 5 === 0;
    p.set(x, y, jit(wave ? shade(c, 0.88) : c, r, 0.035));
  });
}
function leafFill(p: Pix, r: Rnd) {
  const n = vnoise(r, 4);
  p.each((x, y) => {
    const q = r();
    p.set(x, y, q < 0.12 ? 0x123a22 : q < 0.27 ? 0x2f7a46 : q < 0.31 ? 0x3d8f52 : mix(0x25603a, 0x1a4b2c, n(x, y)));
  });
}
function giftFill(p: Pix, r: Rnd, base: number, ribbon: number) {
  const lo = shade(base, 0.82), rd = shade(ribbon, 0.75), rh = shade(ribbon, 1.15);
  p.each((x, y) => {
    // little dot pattern on the wrapping paper
    let c = (x % 4 === 1 && y % 4 === 1) || (x % 4 === 3 && y % 4 === 3) ? shade(base, 1.18) : jit(base, r, 0.03);
    if (x === 15 || y === 15) c = lo;
    const bx = x >= 6 && x <= 9, by = y >= 6 && y <= 9;
    if (bx || by) {
      const e = bx ? x : y;
      c = e === 6 || e === 9 ? rd : e === 7 ? rh : ribbon;
      if (bx && by) c = (x + y) % 2 ? ribbon : rh;
    }
    p.set(x, y, c);
  });
}
/** bevelled square: light top/left edge, dark bottom/right edge */
function bevel(p: Pix, hi: number, lo: number, w = 1) {
  p.each((x, y) => {
    if (x < w || y < w) p.set(x, y, hi);
    if (x >= p.w - w || y >= p.h - w) p.set(x, y, lo);
  });
}

const TEX: Record<TexId, (p: Pix, r: Rnd) => void> = {
  snow: (p, r) => snowFill(p, r),
  snowSide: (p, r) => {
    dirtFill(p, r);
    snowFill(p, r, 3);
    for (let x = 0; x < 16; x++) {
      // irregular snow edge with a blue shadow line and a dark line of earth below it
      const depth = 3 + (r() < 0.55 ? 1 : 0) + (r() < 0.25 ? 1 : 0);
      for (let y = 3; y < depth; y++) p.set(x, y, jit(0xe9f0f8, r, 0.02));
      p.set(x, depth - 1, 0xc9d9ec);
      p.set(x, depth, 0x553621);
    }
  },
  dirt: dirtFill,
  ice: (p, r) => {
    const n = vnoise(r, 4);
    p.each((x, y) => p.set(x, y, r() < 0.06 ? 0x86c4e4 : mix(0xb6e5f7, 0x92cfec, n(x, y))));
    // glossy diagonal streaks
    for (let k = 0; k < 4; k++) {
      const sx = Math.floor(r() * 16), sy = Math.floor(r() * 16), len = 3 + Math.floor(r() * 5);
      for (let i = 0; i < len; i++) { p.set(sx + i, sy - i, 0xeaf9ff); if (i % 3 !== 2) p.set(sx + i + 1, sy - i, 0xd2f1fd); }
    }
  },
  packedIce: (p, r) => {
    const v = cells(r, 6), tints = [0x7fb6e3, 0x8cc0ea, 0x74acdc, 0x86bbe6, 0x7ab2e0, 0x91c4ec];
    p.each((x, y) => {
      const [id, d1, d2] = v(x, y);
      p.set(x, y, d2 - d1 < 1 ? 0x6496c8 : r() < 0.08 ? 0xb4daf5 : jit(tints[id], r, 0.02));
    });
  },
  thaw: (p, r) => {
    const n = vnoise(r, 4), m = vnoise(r, 3);
    p.each((x, y) => {
      const q = r(), wet = m(x, y);
      let c = mix(0x6f5e4c, 0x8b8a86, n(x, y));
      if (q < 0.1) c = 0xc8d1da; else if (q < 0.18) c = 0x4f4235;
      if (wet > 0.6) c = wet > 0.68 ? mix(0x34475e, 0x283a50, n(x, y)) : 0x4d5c6c;
      p.set(x, y, c);
    });
    // glints on the puddles
    p.each((x, y) => { if (m(x, y) > 0.68 && m(x, y - 1) <= 0.68 && r() < 0.7) p.set(x, y, 0x9cb6d2); });
  },
  salt: (p, r) => {
    const n = vnoise(r, 4);
    p.each((x, y) => p.set(x, y, mix(0x6d7783, 0x5d6772, n(x, y))));
    for (let k = 0; k < 22; k++) {
      const x = Math.floor(r() * 16), y = Math.floor(r() * 16), c = r() < 0.15 ? 0xe9cfd8 : r() < 0.5 ? 0xf6f8fa : 0xdde3ea;
      p.set(x, y, c);
      if (r() < 0.35) p.set(x + 1, y, shade(c, 0.9));
    }
  },
  // chevrons point to the texture top (row 0). Block top faces map row 0 to the -Z edge, i.e. "up" = race direction.
  boost: (p, r) => {
    const n = vnoise(r, 4);
    p.each((x, y) => {
      const dy = (((y + 0.5 - Math.abs(x + 0.5 - 8)) % 8) + 8) % 8;
      let c = mix(0x4fc0f0, 0x37a6e0, n(x, y));
      if (dy < 3) c = dy < 1 ? 0xfff6b0 : dy < 2 ? 0xffd93a : 0xffa21a;
      else if (dy < 4) c = 0x2a7fc0;
      p.set(x, y, c);
    });
  },
  planks: (p, r) => {
    const cols = [0xb8844c, 0xab7843, 0xbb8a52, 0xa9763f];
    for (let b = 0; b < 4; b++) {
      const joint = Math.floor(r() * 12) + 2;
      for (let y = b * 4; y < b * 4 + 4; y++) for (let x = 0; x < 16; x++) {
        let c = jit(cols[b], r, 0.04);
        const q = r();
        if (q < 0.14) c = shade(cols[b], 0.85); else if (q < 0.2) c = shade(cols[b], 1.1);
        if (y === b * 4) c = shade(c, 1.07);
        if (y === b * 4 + 3 || x === joint) c = 0x6c4628;
        p.set(x, y, c);
      }
      p.set(joint - 1, b * 4 + 1, 0x4a3426).set(joint + 1, b * 4 + 1, 0x4a3426);
    }
  },
  log: (p, r) => {
    const cols = [0x5f3f24, 0x6b4729, 0x553820, 0x4a301b];
    const colOf = Array.from({ length: 16 }, () => cols[Math.floor(r() * 4)]);
    p.each((x, y) => p.set(x, y, jit(colOf[x], r, 0.05)));
    for (let k = 0; k < 5; k++) {
      const x = Math.floor(r() * 16), y = Math.floor(r() * 16), len = 3 + Math.floor(r() * 6);
      for (let i = 0; i < len; i++) p.set(x, y + i, 0x38230f);
    }
  },
  logTop: (p, r) => p.each((x, y) => {
    const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    p.set(x, y, edge ? jit(0x5f3f24, r, 0.08) : d < 1.5 ? 0x9a7040 : jit(Math.floor(d * 0.8 + r() * 0.3) % 2 ? 0xc49a62 : 0xae8450, r, 0.03));
  }),
  leaves: leafFill,
  snowLeaves: (p, r) => {
    leafFill(p, r);
    const n = vnoise(r, 4);
    p.each((x, y) => {
      if (n(x, y) + (1 - y / 16) * 0.55 > 0.78 || y < 2) p.set(x, y, r() < 0.2 ? 0xdbe7f3 : 0xf2f7fc);
    });
    // a soft shadow under the snow clumps
    for (let y = 15; y > 0; y--) for (let x = 0; x < 16; x++) {
      const above = p.get(x, y - 1), here = p.get(x, y);
      if ((above === 0xf2f7fc || above === 0xdbe7f3) && here !== 0xf2f7fc && here !== 0xdbe7f3) p.set(x, y, 0x0f3320);
    }
  },
  stone: (p, r) => {
    const n = vnoise(r, 4);
    p.each((x, y) => { const q = r(); p.set(x, y, q < 0.1 ? 0x6c7179 : q < 0.2 ? 0xa3a8af : mix(0x8c9198, 0x7a7f86, n(x, y))); });
  },
  cobble: (p, r) => {
    const v = cells(r, 7), tints = [0x8a8f96, 0x7d8289, 0x979ca3, 0x858a91, 0x9095a0, 0x7b8188, 0x8e939a];
    const edge = (x: number, y: number) => { const [, a, b] = v(x, y); return b - a < 1.2; };
    p.each((x, y) => {
      const id = v(x, y)[0];
      let c = edge(x, y) ? 0x4f535a : jit(tints[id], r, 0.03);
      if (!edge(x, y) && (edge(x - 1, y) || edge(x, y - 1))) c = shade(c, 1.14);
      else if (!edge(x, y) && (edge(x + 1, y) || edge(x, y + 1))) c = shade(c, 0.86);
      p.set(x, y, c);
    });
  },
  brick: (p, r) => {
    const tint: number[] = [];
    for (let i = 0; i < 16; i++) tint.push(jit(0xa64538, r, 0.08));
    p.each((x, y) => {
      const row = y >> 2, bx = (x + (row % 2) * 4) % 16;
      if (y % 4 === 3 || bx % 8 === 7) { p.set(x, y, jit(0xdcd6cc, r, 0.03)); return; }
      const c = tint[row * 2 + (bx >> 3)];
      p.set(x, y, y % 4 === 0 ? shade(c, 1.12) : r() < 0.12 ? shade(c, 0.88) : c);
    });
  },
  wool: (p, r) => woolFill(p, r, 0xeeeeee),
  redWool: (p, r) => woolFill(p, r, 0xc8302c),
  giftRed: (p, r) => giftFill(p, r, 0xd3262f, 0xf7c948),
  giftGreen: (p, r) => giftFill(p, r, 0x2e9b45, 0xf3f3f3),
  giftBlue: (p, r) => giftFill(p, r, 0x2f6fd6, 0xf7c948),
  giftGold: (p, r) => giftFill(p, r, 0xf2c230, 0xd3262f),
  coal: (p, r) => p.each((x, y) => { const q = r(); p.set(x, y, q < 0.08 ? 0x5a6068 : q < 0.11 ? 0x8c949e : jit(0x2a2d32, r, 0.08)); }),
  fire: (p, r) => {
    // flame silhouette: a top height per column, then colors by distance to the silhouette edge (red rim → white core)
    const top = Array.from({ length: 16 }, (_, x) => {
      const c = Math.abs(x + 0.5 - 8);
      return c > 7 ? 16 : Math.round(1 + c * 1.4 + (r() * 2 - 1) * 1.6 + ((x % 4) === 1 ? 2.5 : 0));
    });
    const inside = (x: number, y: number) => x >= 0 && x < 16 && (y >= 16 || (y >= 0 && y >= top[x]));
    p.each((x, y) => {
      if (!inside(x, y)) return;
      let e = 0;
      while (e < 4 && inside(x - e - 1, y) && inside(x + e + 1, y) && inside(x, y - e - 1)) e++;
      p.set(x, y, [0xd8361a, 0xff7a1a, 0xffb52e, 0xffdf6a, 0xfff5c0][e]);
    });
  },
  water: (p, r) => {
    const n = vnoise(r, 4);
    p.each((x, y) => p.set(x, y, mix(0x1e486e, 0x163857, n(x, y))));
    for (let k = 0; k < 6; k++) {
      const x = Math.floor(r() * 16), y = Math.floor(r() * 16), len = 2 + Math.floor(r() * 3);
      for (let i = 0; i < len; i++) p.set(x + i, y, 0x3c79a8);
      if (r() < 0.5) p.set(x + 1, y, 0xbfe6ff);
    }
  },
  gold: (p, r) => {
    const n = vnoise(r, 4);
    p.each((x, y) => p.set(x, y, r() < 0.07 ? 0xd99e24 : mix(0xf7c63c, 0xeab22c, n(x, y))));
    bevel(p, 0xffe58a, 0xc58d1c);
    for (let i = 0; i < 4; i++) { p.set(3 + i, 6 - i, 0xfff6c8); p.set(4 + i, 6 - i, 0xfff0a8); }
  },
  glass: (p, r) => {
    p.each((x, y) => p.set(x, y, jit(0xbfe6f6, r, 0.02), 80));
    for (let i = 0; i < 5; i++) p.set(4 + i, 9 - i, 0xffffff, 210).set(9 + i, 12 - i, 0xffffff, 150);
    p.each((x, y) => { if (x === 0 || y === 0 || x === 15 || y === 15) p.set(x, y, 0xe2f4fc); });
  },
  lamp: (p) => p.each((x, y) => {
    const frame = x === 0 || y === 0 || x === 15 || y === 15 || x === 7 || x === 8 || y === 7 || y === 8;
    const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
    p.set(x, y, frame ? (x === 0 || y === 0 ? 0x5a4636 : 0x2f2620) : d < 4.2 ? 0xfff0b8 : d < 6.4 ? 0xffd36a : 0xf2a33a);
  }),
  candy: (p) => p.each((x, y) => {
    const k = (x + y) % 8;
    p.set(x, y, k < 4 ? (k === 0 ? 0xf2626a : 0xd9252f) : k === 7 ? 0xe2e2e2 : 0xf8f8f8);
  }),
  iceWall: (p, r) => {
    p.each((x, y) => p.set(x, y, jit(mix(0xa8def5, 0x84c8ec, y / 15), r, 0.02)));
    for (let i = 0; i < 7; i++) { p.set(3 + i, 11 - i, 0xeefaff); p.set(4 + i, 11 - i, 0xd8f3fe); p.set(8 + i, 13 - i, 0xe0f6ff); }
    p.set(11, 11, 0xffffff).set(12, 4, 0xffffff).set(4, 13, 0xf0fbff);
    bevel(p, 0xe2f7ff, 0x67aedb);
  },
  spike: (p, r) => p.each((x, y) => {
    const c = mix(0xeafaff, 0x8ccdec, y / 15);
    p.set(x, y, x % 5 === 3 ? shade(c, 1.08) : x % 5 === 0 ? shade(c, 0.88) : jit(c, r, 0.02));
  }),
  metal: (p, r) => {
    p.each((x, y) => p.set(x, y, y % 3 === 0 ? 0x88919b : jit(0x939ca5, r, 0.02)));
    bevel(p, 0xc6ced6, 0x5c646c);
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) p.set(x, y, 0xdce2e8).set(x + 1, y + 1, 0x5c646c);
  },
  window: (p) => p.each((x, y) => {
    const frame = x < 2 || y < 2 || x > 13 || y > 13 || x === 7 || x === 8 || y === 7 || y === 8;
    if (frame) { p.set(x, y, x === 0 || y === 0 || x === 15 || y === 15 ? 0x4a2e18 : 0x7a5232); return; }
    const lx = x > 8 ? x - 9 : x - 2, ly = y > 8 ? y - 9 : y - 2;
    p.set(x, y, lx + ly < 2 ? 0xfff4cc : mix(0xffe39a, 0xffb046, (lx + ly) / 8));
  }),
  finish: (p) => p.each((x, y) => p.set(x, y, ((x >> 2) + (y >> 2)) & 1 ? 0x1d1f24 : 0xf6f6f6)),
  snowBrick: (p, r) => p.each((x, y) => {
    const row = y >> 2, bx = (x + (row % 2) * 4) % 8;
    p.set(x, y, y % 4 === 3 || bx === 7 ? 0xb8cde3 : y % 4 === 0 ? 0xffffff : jit(0xeef4fa, r, 0.015));
  }),
  hazard: (p) => p.each((x, y) => p.set(x, y, (x + y) % 8 < 4 ? 0xf6c625 : 0x26282c)),
  voxel: (p, r) => {
    p.each((x, y) => { const v = Math.round(240 + r() * 15); p.set(x, y, (v << 16) | (v << 8) | v); });
    bevel(p, 0xffffff, 0xd6d6d6);
  },
};

const texSize = (id: TexId) => (id === 'voxel' ? 8 : 16);
/** paint a block texture into a new pixel buffer (pure; used by texCanvas and tests) */
export function paintTex(id: TexId): Pix {
  const p = new Pix(texSize(id), texSize(id), true);
  TEX[id](p, rng(hash(id)));
  return p;
}

const canvases = new Map<TexId, HTMLCanvasElement>();
const textures = new Map<TexId, Texture>();
/** all texture ids (for previews) */
export const TEX_IDS = /* @__PURE__ */ Object.keys(TEX) as TexId[];

/**
 * Cached nearest-filtered repeating texture. Mipmaps on (nearest-mipmap-nearest): crisp pixels up close, no shimmer far away.
 * 'fire' has no mips (alpha cut-out keeps its edges).
 */
export function tex(id: TexId): Texture {
  let t = textures.get(id);
  if (!t) {
    t = Texture.fromCanvas(texCanvas(id), { filter: 'nearest', wrap: 'repeat', mips: id !== 'fire' });
    textures.set(id, t);
  }
  return t;
}
/** the 16x16 source canvas (do not modify) */
export function texCanvas(id: TexId): HTMLCanvasElement {
  let c = canvases.get(id);
  if (!c) { c = paintTex(id).canvas(); canvases.set(id, c); }
  return c;
}

// ---------------------------------------------------------------- tiny bitmap fonts

/** 3x5 digits (rows of 3 bits, bit 2 = left) for skins and medals */
export const FONT3: Record<string, number[]> = {
  '0': [7, 5, 5, 5, 7], '1': [2, 6, 2, 2, 7], '2': [7, 1, 7, 4, 7], '3': [7, 1, 3, 1, 7], '4': [5, 5, 7, 1, 1],
  '5': [7, 4, 7, 1, 7], '6': [7, 4, 7, 5, 7], '7': [7, 1, 2, 2, 2], '8': [7, 5, 7, 5, 7], '9': [7, 5, 7, 1, 7],
  A: [2, 5, 7, 5, 5], D: [6, 5, 5, 5, 6],
};
/** draw 3x5 text; returns the width */
export function text3(p: Pix, s: string, x: number, y: number, c: number): number {
  let ox = x;
  for (const chr of s) {
    const g = FONT3[chr];
    if (!g) { ox += 2; continue; }
    g.forEach((row, j) => { for (let i = 0; i < 3; i++) if (row & (4 >> i)) p.set(ox + i, y + j, c); });
    ox += 4;
  }
  return ox - x - 1;
}

/** 5x7 glyphs for sign numbers ("15", "x2", "x1.5", "+3") */
const FONT5: Record<string, number[]> = {
  '0': [14, 17, 17, 17, 17, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31], '3': [31, 2, 4, 2, 1, 17, 14],
  '4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 30, 1, 1, 17, 14], '6': [6, 8, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14], '9': [14, 17, 17, 15, 1, 2, 12], x: [0, 0, 17, 10, 4, 10, 17], '+': [0, 4, 4, 31, 4, 4, 0],
  '.': [0, 0, 0, 0, 0, 12, 12], '-': [0, 0, 0, 14, 0, 0, 0], '%': [24, 25, 2, 4, 8, 19, 3], ' ': [0, 0, 0, 0, 0, 0, 0],
};

// ---------------------------------------------------------------- icons (16x16, outlined)

export type IconId =
  | 'coin' | 'gem' | 'trophy' | 'gift' | 'ad' | 'lock' | 'star' | 'speed' | 'grip' | 'armor' | 'start' | 'magnet'
  | 'snowflake' | 'tree' | 'bell' | 'shield' | 'boost' | 'grow' | 'case_snow' | 'case_ice' | 'case_santa' | 'key'
  | 'clock' | 'crown' | 'sound' | 'mute' | 'music' | 'cart' | 'shirt' | 'up' | 'calendar' | 'back' | 'close' | 'check'
  | 'play' | 'noads' | 'fire' | 'flag'
  // extras
  | 'hand' | 'gamepad' | 'globe' | 'gear' | 'home' | 'next' | 'plus' | 'info' | 'ball' | 'coins' | 'gems'
  | 'medal1' | 'medal2' | 'medal3' | 'arrows' | 'heart' | 'user' | 'wifi';

const OUT = 0x1b1d2b;
const GOLD: [number, number, number] = [0xfff0a0, 0xffd447, 0xe39b22];
const SNOWB: [number, number, number] = [0xffffff, 0xe6eef8, 0xa9c2de];

/** sphere-shaded disc lit from the top-left: [highlight, mid, shadow] */
function orb(p: Pix, cx: number, cy: number, r: number, [hi, mid, lo]: [number, number, number]) {
  return p.disc(cx, cy, r, (x, y) => {
    const l = -((x + 0.5 - cx) * 0.65 + (y + 0.5 - cy) * 0.76) / r;
    return l > 0.42 ? hi : l < -0.4 ? lo : mid;
  });
}
/** shade a filled shape: pixels whose left/top neighbor is empty get `hi`, right/bottom → `lo` */
function rim(p: Pix, hi: number, lo: number, only?: number) {
  const pts: [number, number, number][] = [];
  p.each((x, y) => {
    if (!p.alpha(x, y) || (only !== undefined && p.get(x, y) !== only)) return;
    if (!p.alpha(x + 1, y) || !p.alpha(x, y + 1)) pts.push([x, y, lo]);
    else if (!p.alpha(x - 1, y) || !p.alpha(x, y - 1)) pts.push([x, y, hi]);
  });
  for (const [x, y, c] of pts) if (c >= 0) p.set(x, y, c);
}
function star(p: Pix, cx: number, cy: number, ro: number, ri: number, c: number) {
  const pts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? ri : ro;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return p.poly(pts, c);
}
function giftBox(p: Pix, box: number, ribbon: number, lid = shade(box, 1.12)) {
  p.rect(2, 8, 12, 7, box).rect(1, 5, 14, 3, lid);
  rim(p, shade(lid, 1.1), shade(box, 0.78));
  p.rect(7, 5, 2, 10, ribbon).rect(7, 5, 1, 10, shade(ribbon, 1.12));
  p.rect(1, 7, 14, 1, shade(box, 0.75)).rect(7, 7, 2, 1, shade(ribbon, 0.8));
  // bow
  p.ring(5, 3, 0.6, 2.3, ribbon).ring(11, 3, 0.6, 2.3, ribbon).rect(7, 3, 2, 2, shade(ribbon, 0.85));
}
function snowflake(p: Pix, cx: number, cy: number, c: number, c2: number, n = 6) {
  // 8 arms with little V branches (pixel friendly); n = arm length
  for (let i = -n; i <= n; i++) { p.set(cx + i, cy, c); p.set(cx, cy + i, c); }
  for (let i = 1 - n; i < n; i++) { p.set(cx + i, cy + i, c2); p.set(cx + i, cy - i, c2); }
  const b = Math.round(n * 0.6);
  for (const [a, e] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = cx + a * b, y = cy + e * b;
    p.set(x + a + e, y + e + a, c).set(x + a - e, y + e - a, c);
  }
  p.set(cx, cy, 0xffffff);
}
/** gold coin with an engraved rim and an embossed snowflake */
function coin(p: Pix, cx: number, cy: number, r: number) {
  orb(p, cx, cy, r, GOLD);
  p.ring(cx, cy, r * 0.68, r * 0.8, 0xe39b22);
  const x = Math.round(cx) - 1, y = Math.round(cy) - 1, n = r > 5 ? 2 : 1;
  for (let i = -n; i <= n; i++) p.set(x + i, y, 0xfff3c0).set(x, y + i, 0xfff3c0);
  if (n > 1) p.set(x - 1, y - 1, 0xffe9a0).set(x + 1, y - 1, 0xffe9a0).set(x - 1, y + 1, 0xffe9a0).set(x + 1, y + 1, 0xffe9a0);
  p.set(x + n + 1, y + 1, 0xd08a1c).set(x + 1, y + n + 1, 0xd08a1c);
}
function arrow(p: Pix, flip: boolean) {
  const pts = [1, 8, 8, 1, 8, 5, 15, 5, 15, 11, 8, 11, 8, 15];
  p.poly(flip ? pts.map((v, i) => (i % 2 ? v : 16 - v)) : pts, 0xffffff);
  rim(p, 0xffffff, 0xb9c4d0);
}
function speaker(p: Pix) {
  p.rect(1, 6, 4, 5, 0x8a94a0).poly([5, 6, 10, 1.5, 10, 15.5, 5, 11], 0xe6ebf0);
  rim(p, 0xffffff, 0xaab4be);
}
function medal(p: Pix, c: [number, number, number], n: string) {
  p.poly([3, 0, 7, 0, 9, 6, 6, 7], 0xd62a2a).poly([13, 0, 9, 0, 7, 6, 10, 7], 0x2f6fd6);
  orb(p, 8, 10.5, 5.2, c);
  text3(p, n, 7, 8, shade(c[2], 0.7));
}

const ICON: Record<IconId, (p: Pix) => void> = {
  coin: (p) => coin(p, 8, 8, 6.6),
  gem: (p) => {
    p.poly([4, 2, 12, 2, 15, 6.5, 8, 14.5, 1, 6.5], (x, y) => {
      if (y < 6) return x < 5 ? 0x8af0ff : x < 11 ? 0xc8faff : 0x5fd8f8;
      const t = (x + 0.5 - 8) / (14.5 - y + 0.01);
      return t < -0.35 ? 0x2fb6ec : t > 0.35 ? 0x1c84cc : 0x48cff5;
    });
    p.set(5, 3, 0xffffff).set(4, 4, 0xffffff).set(8, 7, 0xe6fcff);
  },
  trophy: (p) => {
    p.ring(3, 5.5, 1.3, 2.6, (x) => (x < 4 ? 0xf0a92a : -1)).ring(13, 5.5, 1.3, 2.6, (x) => (x > 11 ? 0xf0a92a : -1));
    p.poly([3, 2, 13, 2, 12.5, 6.5, 10, 9.5, 6, 9.5, 3.5, 6.5], 0xffd447);
    rim(p, 0xfff0a0, 0xe39b22, 0xffd447);
    p.rect(7, 9, 2, 3, 0xe39b22).rect(5, 12, 6, 1, 0xffd447).rect(4, 13, 8, 2, 0xd08a1c).rect(4, 13, 8, 1, 0xf0a92a);
    star(p, 8, 5.4, 2.6, 1.1, 0xfff6c8);
  },
  gift: (p) => giftBox(p, 0xe0303a, 0xffd447),
  ad: (p) => {
    p.line(6, 4, 4, 1, 0x6a7080).line(10, 4, 12, 1, 0x6a7080);
    p.rect(1, 4, 14, 10, 0xeef0f6).set(1, 4, -1, 0).set(14, 4, -1, 0).set(1, 13, -1, 0).set(14, 13, -1, 0);
    p.rect(3, 6, 10, 6, 0x7b3fe4).rect(3, 6, 10, 1, 0x9a66f0);
    p.poly([6.5, 6.6, 10.6, 9, 6.5, 11.4], 0xffffff);
    p.rect(3, 14, 2, 1, 0x6a7080).rect(11, 14, 2, 1, 0x6a7080);
  },
  lock: (p) => {
    p.ring(8, 6.5, 2.4, 4.4, (x, y) => (y < 7 ? (x < 6 ? 0xe2e8ee : 0xaab4be) : -1));
    p.rect(4, 6, 2, 2, 0xc8d0d8).rect(10, 6, 2, 2, 0xaab4be);
    p.rect(2, 8, 12, 7, 0xffc93a);
    rim(p, 0xfff0a0, 0xd08a1c, 0xffc93a);
    p.disc(8, 10.5, 1.2, 0x5a3a10).rect(7, 11, 2, 2, 0x5a3a10);
  },
  star: (p) => {
    star(p, 8, 8.6, 7.6, 3.2, 0xffd447);
    rim(p, 0xfff0a0, 0xe39b22);
    p.set(7, 6, 0xfff6c8).set(6, 7, 0xfff6c8);
  },
  speed: (p) => {
    p.poly([10, 0.5, 2.5, 9, 7.5, 9, 5, 15.5, 13.5, 6.5, 8.5, 6.5, 11.5, 0.5], 0xffe14a);
    rim(p, 0xfff6b0, 0xffa21a);
  },
  grip: (p) => p.sprite([
    '.....rrrr.......',
    '....rRRrrr......',
    '...rRrrrrrr.....',
    '...rRrrrrrr.....',
    '...rrrrrrrr.....',
    '...rrrrrrrr.rr..',
    '...rrwrrwrrrRr..',
    '...rwrwwrwrrrr..',
    '...rrrrrrrrrr...',
    '...rrrrrrrrr....',
    '...rrrrrrrrr....',
    '..ccccccccccc...',
    '..cCcCcCcCcCc...',
    '..ccccccccccc...',
  ], { r: 0xd62a2a, R: 0xf05a5a, w: 0xffffff, c: 0xf2f2f2, C: 0xc8ccd2 }, 0, 1),
  armor: (p) => {
    p.poly([1.5, 3, 5.5, 1.5, 8, 4, 10.5, 1.5, 14.5, 3, 13, 8, 12.5, 14.5, 3.5, 14.5, 3, 8], 0xb9c8d8);
    rim(p, 0xe8f0f8, 0x7f90a4);
    p.rect(7, 5, 2, 9, 0x5fb4f0).rect(4, 10, 8, 1, 0x7f90a4).set(5, 6, 0xffffff);
  },
  start: (p) => {
    orb(p, 7, 9.5, 5.6, SNOWB);
    p.disc(12, 4, 3.8, 0x3fc85a).rect(11, 2, 2, 4, 0xffffff).rect(10, 3, 4, 2, 0xffffff);
  },
  magnet: (p) => {
    p.ring(8, 8, 2.6, 6.5, (_, y) => (y >= 8 ? 0xe0303a : -1));
    p.rect(2, 3, 4, 5, 0xe0303a).rect(10, 3, 4, 5, 0xe0303a);
    rim(p, 0xff7a7a, 0xa81c24);
    p.rect(2, 1, 4, 2, 0xe8edf2).rect(10, 1, 4, 2, 0xe8edf2).rect(5, 1, 1, 2, 0xaab4be).rect(13, 1, 1, 2, 0xaab4be);
  },
  snowflake: (p) => snowflake(p, 7, 7, 0xffffff, 0xbfe6ff),
  tree: (p) => {
    p.poly([8, 1.5, 12.5, 6.5, 10.5, 6.5, 14.5, 12, 1.5, 12, 5.5, 6.5, 3.5, 6.5], 0x2e9b45);
    rim(p, 0x4cc265, 0x1d7034);
    p.rect(7, 12, 2, 3, 0x7a4a2a);
    p.set(6, 9, 0xff4a4a).set(10, 10, 0xffd447).set(8, 6, 0x5fb4f0).set(5, 11, 0x5fb4f0).set(11, 8, 0xff4a4a);
    star(p, 8, 2, 2.4, 1, 0xffd447);
  },
  bell: (p) => {
    p.poly([5.5, 3, 10.5, 3, 12, 8, 14, 12, 2, 12, 4, 8], 0xffd447);
    rim(p, 0xfff0a0, 0xe39b22);
    p.rect(7, 12, 2, 2, 0xb5761a).rect(2, 11, 12, 1, 0xe39b22);
    p.rect(4, 1, 3, 2, 0xd62a2a).rect(9, 1, 3, 2, 0xd62a2a).rect(7, 1, 2, 2, 0xa81c24);
  },
  shield: (p) => {
    p.poly([1.5, 1.5, 14.5, 1.5, 14.5, 8, 8, 15, 1.5, 8], 0xd8e0e8);
    p.poly([3.5, 3.5, 12.5, 3.5, 12.5, 8, 8, 12.8, 3.5, 8], 0x3d7fe0);
    p.rect(7, 4, 2, 8, 0xffffff).rect(4, 6, 8, 2, 0xffffff);
    p.set(3, 2, 0xffffff).set(2, 3, 0xffffff);
  },
  boost: (p) => {
    p.poly([8, 0.5, 14.5, 7, 11, 7, 8, 4, 5, 7, 1.5, 7], 0xffe14a);
    p.poly([8, 7, 14.5, 13.5, 11, 13.5, 8, 10.5, 5, 13.5, 1.5, 13.5], 0xffa21a);
    p.set(7, 2, 0xfff6c8).set(7, 8, 0xffd447);
  },
  grow: (p) => {
    orb(p, 7, 9.5, 5.6, SNOWB);
    p.poly([12, 0.5, 15.5, 5, 13.5, 5, 13.5, 9, 10.5, 9, 10.5, 5, 8.5, 5], 0x3fc85a);
    p.set(11, 3, 0x9cf2a8);
  },
  case_snow: (p) => giftBox(p, 0xeef3f9, 0x3d8be0),
  case_ice: (p) => { giftBox(p, 0x6fd0f2, 0xffffff); p.set(3, 10, 0xd8f6ff).set(4, 9, 0xd8f6ff).set(11, 12, 0xd8f6ff); },
  case_santa: (p) => { giftBox(p, 0xd8262f, 0xffd447); p.set(4, 11, 0xffd447).set(11, 10, 0xffd447).set(10, 13, 0xffffff); },
  key: (p) => {
    p.ring(4.5, 8, 1.4, 3.8, 0xffd447);
    p.rect(8, 7, 7, 2, 0xffd447).rect(11, 9, 1, 3, 0xffd447).rect(13, 9, 2, 2, 0xffd447);
    rim(p, 0xfff0a0, 0xe39b22);
  },
  clock: (p) => {
    p.disc(3, 3, 2, 0xe0303a).disc(13, 3, 2, 0xe0303a);
    p.disc(8, 8.5, 6.5, 0xe0303a).disc(8, 8.5, 5, 0xffffff);
    p.rect(7, 4, 2, 5, 0x2a2d3a).rect(8, 8, 3, 1, 0x2a2d3a).rect(4, 14, 2, 2, 0x8a94a0).rect(10, 14, 2, 2, 0x8a94a0);
  },
  crown: (p) => {
    p.poly([1.5, 4.5, 5, 8, 8, 2.5, 11, 8, 14.5, 4.5, 13.5, 13.5, 2.5, 13.5], 0xffd447);
    rim(p, 0xfff0a0, 0xe39b22);
    p.rect(3, 11, 10, 1, 0xe39b22).set(8, 9, 0xe0303a).set(5, 10, 0x3d8be0).set(11, 10, 0x3fc85a);
    p.disc(2, 3.5, 1.2, 0xffffff).disc(8, 1.6, 1.2, 0xffffff).disc(14, 3.5, 1.2, 0xffffff);
  },
  sound: (p) => {
    speaker(p);
    p.ring(8, 8.5, 4.1, 5, (x) => (x > 11 ? 0xffffff : -1)).ring(8, 8.5, 6.2, 7.1, (x) => (x > 12 ? 0xffffff : -1));
  },
  mute: (p) => {
    speaker(p);
    for (let i = 0; i < 5; i++) p.rect(11 + i, 6 + i, 1, 1, 0xff4a4a).rect(15 - i, 6 + i, 1, 1, 0xff4a4a).rect(11 + i, 7 + i, 1, 1, 0xd82a2a).rect(15 - i, 7 + i, 1, 1, 0xd82a2a);
  },
  music: (p) => p.sprite([
    '.....wwwwwwwwww.',
    '.....wWWWWWWWWw.',
    '.....ww.....ww..',
    '.....ww.....ww..',
    '.....ww.....ww..',
    '.....ww.....ww..',
    '.....ww.....ww..',
    '.....ww...wwww..',
    '.....ww..wwwwww.',
    '...wwww..wwwwww.',
    '..wwwwww..wwww..',
    '..wwwwww........',
    '...wwww.........',
  ], { w: 0xffffff, W: 0xbfe6ff }, 0, 1),
  cart: (p) => p.sprite([
    'kk..............',
    '.k..............',
    '.kkwwwwwwwwwwww.',
    '..kwgwwgwwgwwgk.',
    '..kwwwwwwwwwwwk.',
    '..kwgwwgwwgwwk..',
    '...kwwwwwwwwwk..',
    '...kkkkkkkkkk...',
    '....k......k....',
    '...kkkkkkkkkkk..',
    '................',
    '...dd......dd...',
    '...dd......dd...',
  ], { k: 0x8a94a0, w: 0xffffff, g: 0xc8d0d8, d: 0x3a3f4a }, 0, 1),
  shirt: (p) => {
    p.poly([5, 1.5, 11, 1.5, 15, 5, 13, 8, 12, 7, 12, 14.5, 4, 14.5, 4, 7, 3, 8, 1, 5], 0x18b4b4);
    p.rect(6, 1, 4, 2, -1, 0).rect(7, 3, 2, 1, -1, 0);
    rim(p, 0x48d8d8, 0x0f8a8a);
    p.rect(4, 10, 8, 1, 0x0f8a8a);
  },
  up: (p) => {
    p.poly([8, 0.5, 15.5, 8, 11, 8, 11, 15.5, 5, 15.5, 5, 8, 0.5, 8], 0x3fd65a);
    rim(p, 0x9cf2a8, 0x24a03c);
  },
  calendar: (p) => {
    p.rect(1, 3, 14, 12, 0xffffff).rect(1, 3, 14, 4, 0xe0303a).rect(1, 3, 14, 1, 0xff5a5a);
    p.rect(4, 1, 2, 4, 0x8a94a0).rect(10, 1, 2, 4, 0x8a94a0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) p.rect(3 + i * 4, 9 + j * 3, 2, 2, i === 2 && j === 1 ? 0xe0303a : 0xb4bcc6);
  },
  back: (p) => arrow(p, false),
  next: (p) => arrow(p, true),
  close: (p) => p.each((x, y) => {
    if (x < 2 || y < 2 || x > 13 || y > 13) return;
    const a = Math.abs(x - y), b = Math.abs(x + y - 15);
    if (a <= 1 || b <= 1) p.set(x, y, a === 0 || b === 0 ? 0xffffff : 0xe8ecf0);
  }),
  check: (p) => {
    p.poly([0.5, 8.5, 3.5, 5.5, 6.5, 8.5, 12.5, 2, 15.5, 5, 6.5, 14], 0x3fd65a);
    rim(p, 0x9cf2a8, 0x24a03c);
  },
  play: (p) => {
    p.poly([3, 1, 14.5, 8, 3, 15], 0xffffff);
    rim(p, 0xffffff, 0xb9c4d0);
  },
  noads: (p) => {
    p.rect(1, 3, 14, 10, 0xffffff);
    text3(p, 'A', 4, 5, 0x2a2d3a); text3(p, 'D', 9, 5, 0x2a2d3a);
    for (let i = 0; i < 14; i++) p.set(1 + i, 14 - i, 0xe0303a).set(2 + i, 14 - i, 0xe0303a);
  },
  fire: (p) => {
    p.poly([8, 0.5, 11, 4.5, 12.5, 3, 14, 9, 12, 14.5, 4, 14.5, 2, 9.5, 3, 5, 5, 7], 0xff6a1a);
    p.poly([8, 5.5, 10.5, 9.5, 10.5, 13, 5.5, 13, 5.5, 9.5], 0xffc83a);
    p.rect(7, 10, 2, 3, 0xfff3b0);
    rim(p, 0xff8a3a, 0xd8361a, 0xff6a1a);
  },
  flag: (p) => {
    p.rect(2, 1, 2, 15, 0x8a6a4a).rect(2, 1, 1, 15, 0xb08a60);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) p.rect(4 + x * 2, 2 + y * 2, 2, 2, (x + y) % 2 ? 0x2a2d3a : 0xffffff);
  },
  hand: (p) => p.sprite([
    '.....ww.........',
    '....wWWw........',
    '....wWWw........',
    '....wWWw........',
    '....wWWwww......',
    '....wWWwWWww....',
    '.ww.wWWwWWwWww..',
    'wWWwwWWwWWwWWw..',
    'wWWwwWWWWWWWWw..',
    '.wWWwWWWWWWWWw..',
    '..wWWWWWWWWWWw..',
    '..wWWWWWWWWWww..',
    '...wWWWWWWWWw...',
    '....wWWWWWWw....',
    '....bbbbbbbb....',
    '....bbbbbbbb....',
  ], { w: 0xc9d2dc, W: 0xffffff, b: 0x3d8be0 }),
  gamepad: (p) => {
    p.rect(1, 5, 14, 7, 0x4a5060).rect(2, 4, 12, 1, 0x4a5060).rect(1, 12, 4, 2, 0x4a5060).rect(11, 12, 4, 2, 0x4a5060);
    rim(p, 0x6a7284, 0x30343e);
    p.rect(3, 8, 5, 1, 0xffffff).rect(5, 6, 1, 5, 0xffffff);
    p.set(11, 7, 0xff4a4a).set(13, 8, 0x3fd65a).set(11, 9, 0x5fb4f0).set(9, 8, 0xffd447);
  },
  globe: (p) => {
    orb(p, 8, 8, 6.8, [0x7fc8ff, 0x3d8be0, 0x2a64b4]);
    p.sprite([
      '....gg......',
      '...gggg..gg.',
      '..ggggg.ggg.',
      '...ggg...g..',
      '....g.....g.',
      '.......gg...',
      '......gggg..',
      '.......gg...',
    ], { g: 0x4cc265 }, 2, 3);
    p.set(5, 3, 0xffffff).set(4, 4, 0xffffff);
  },
  gear: (p) => {
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      p.disc(8 + Math.cos(a) * 5.6, 8 + Math.sin(a) * 5.6, 1.7, 0xaab4be);
    }
    p.disc(8, 8, 5.2, 0xc8d0d8);
    rim(p, 0xe8edf2, 0x7f8a96);
    p.each((x, y) => { if (Math.hypot(x + 0.5 - 8, y + 0.5 - 8) <= 2) p.set(x, y, 0, 0); });
  },
  home: (p) => {
    p.rect(3, 8, 10, 7, 0xf2ead8);
    rim(p, 0xfffaf0, 0xc8bca4);
    p.poly([8, 1, 15.5, 8.5, 0.5, 8.5], 0xe0303a);
    p.rect(7, 10, 3, 5, 0x8a5a32).rect(11, 3, 2, 3, 0x8a6a5a);
  },
  plus: (p) => { p.rect(6, 1, 4, 14, 0x3fd65a).rect(1, 6, 14, 4, 0x3fd65a); rim(p, 0x9cf2a8, 0x24a03c); },
  info: (p) => { orb(p, 8, 8, 7, [0x7fc8ff, 0x3d8be0, 0x2a64b4]); p.rect(7, 3, 2, 2, 0xffffff).rect(7, 6, 2, 7, 0xffffff); },
  ball: (p) => { orb(p, 8, 8, 6.8, SNOWB); p.set(10, 11, 0xc6d8ec).set(6, 12, 0xc6d8ec).set(12, 7, 0xd8e4f0); },
  coins: (p) => {
    coin(p, 8, 5, 4.6);
    p.outline(OUT);
    coin(p, 4.6, 10.8, 4.6);
    p.outline(OUT);
    coin(p, 11.4, 10.8, 4.6);
  },
  gems: (p) => {
    p.poly([9.5, 1, 14, 1, 15.5, 3.5, 11.8, 8, 8, 3.5], 0xc77dff).poly([2, 2, 6, 2, 7.5, 4.5, 4, 9, 0.5, 4.5], 0x4cd96a);
    p.outline(OUT);
    p.poly([4.5, 5, 11.5, 5, 14, 8.5, 8, 15, 2, 8.5], (x, y) => (y < 8 ? (x < 6 ? 0x8af0ff : x < 10 ? 0xc8faff : 0x5fd8f8) : x < 7 ? 0x2fb6ec : x > 8 ? 0x1c84cc : 0x48cff5));
    p.set(10, 2, 0xffffff).set(3, 3, 0xffffff).set(6, 6, 0xffffff);
  },
  medal1: (p) => medal(p, GOLD, '1'),
  medal2: (p) => medal(p, [0xffffff, 0xd2dae2, 0x9aa6b2], '2'),
  medal3: (p) => medal(p, [0xffc89a, 0xd88a4a, 0xa05a2a], '3'),
  arrows: (p) => {
    p.poly([0.5, 8, 5.5, 3, 5.5, 13], 0xffffff).poly([15.5, 8, 10.5, 3, 10.5, 13], 0xffffff).rect(5, 7, 6, 2, 0xffffff);
    rim(p, 0xffffff, 0xb9c4d0);
  },
  heart: (p) => {
    p.disc(5, 5.5, 3.6, 0xff4a5a).disc(11, 5.5, 3.6, 0xff4a5a).poly([1.6, 7, 14.4, 7, 8, 14.5], 0xff4a5a);
    rim(p, 0xff9aa4, 0xc81e32);
    p.set(4, 4, 0xffffff);
  },
  user: (p) => {
    p.rect(4, 1, 8, 8, 0xb78272).rect(4, 1, 8, 2, 0x3a2716).rect(5, 4, 1, 1, 0xffffff).rect(10, 4, 1, 1, 0xffffff);
    p.rect(6, 6, 4, 1, 0x3a1a14).rect(2, 9, 12, 6, 0x18b4b4);
    rim(p, -1, 0x0f8a8a, 0x18b4b4);
  },
  wifi: (p) => {
    for (const [r0, r1] of [[0, 1.6], [3, 4.6], [6, 7.6]]) p.ring(8, 13.5, r0, r1, (x, y) => (y < 14 && Math.abs(x + 0.5 - 8) < (13.5 - y) * 1.15 + 1 ? 0xffffff : -1));
  },
};

/** paint an icon into a new 16x16 pixel buffer (pure; used by iconURL and tests) */
export function paintIcon(id: IconId): Pix {
  const p = new Pix(16, 16);
  ICON[id](p);
  return p.outline(OUT);
}
export const ICON_IDS = /* @__PURE__ */ Object.keys(ICON) as IconId[];

const icons = new Map<IconId, string>();
/** pixel-art icon as a PNG data URL (cached; 64x64, upscaled 4x so it stays crisp even with smoothing) */
export function iconURL(id: IconId): string {
  let u = icons.get(id);
  if (!u) { u = paintIcon(id).canvas(4).toDataURL(); icons.set(id, u); }
  return u;
}

// ---------------------------------------------------------------- signs

export interface SignOptions {
  /** low-res sign size in pixels (aspect = the face it is put on). Default 48x24 (2:1) */
  w?: number;
  h?: number;
  /** text outline color (default dark) */
  outline?: string;
}
const signs = new Map<string, Texture>();
/** '#rgb' / '#rrggbb' → 0xRRGGBB */
function parseColor(s: string): number {
  let h = s.replace('#', '');
  if (h.length < 6) h = [...h.slice(0, 3)].map((c) => c + c).join('');
  return parseInt(h.slice(0, 6), 16) || 0;
}

/**
 * Sign texture with big crisp pixel text: numbers ("15", "x2", "x1.5", "+3") use a built-in 5x7 pixel font scaled up as
 * much as fits; any other text (any language: comes from tr()) is drawn with the system font and thresholded to pixels.
 * fg/bg are CSS hex colors; bg 'none' = transparent background (decal), otherwise a plate with a darker border.
 * Texture: nearest filter + mips, clamp. Row 0 is the top of the text (use uv v=0 at the top edge of the face).
 */
export function signTexture(text: string, fg = '#ffffff', bg = '#1d4f91', opts: SignOptions = {}): Texture {
  const w = opts.w ?? 48, h = opts.h ?? 24, ol = opts.outline ?? '#14182a';
  const key = [text, fg, bg, w, h, ol].join('|');
  let t = signs.get(key);
  if (t) return t;
  const p = signPix(text, parseColor(fg), bg === 'none' ? -1 : parseColor(bg), parseColor(ol), w, h);
  t = Texture.fromCanvas(p.canvas(), { filter: 'nearest', wrap: 'clamp', mips: true });
  signs.set(key, t);
  return t;
}

/** the sign as a pixel buffer (bitmap glyphs need no DOM; other text uses a canvas) */
export function signPix(text: string, fg: number, bg: number, ol: number, w: number, h: number): Pix {
  const p = new Pix(w, h);
  if (bg >= 0) {
    p.rect(0, 0, w, h, bg);
    p.each((x, y) => { if (x === 0 || y === 0 || x === w - 1 || y === h - 1) p.set(x, y, shade(bg, 0.6)); else if (y === 1) p.set(x, y, shade(bg, 1.2)); });
  }
  const mask = new Uint8Array(w * h);
  const pad = 3;
  if ([...text].every((c) => FONT5[c])) {
    // bitmap glyphs, proportional (trimmed to used columns), integer scale
    const glyphs = [...text].map((c) => {
      const g = FONT5[c];
      let l = 5, r = -1;
      g.forEach((row) => { for (let i = 0; i < 5; i++) if (row & (16 >> i)) { l = Math.min(l, i); r = Math.max(r, i); } });
      return r < 0 ? { g, l: 0, n: 2 } : { g, l, n: r - l + 1 };
    });
    const unit = glyphs.reduce((s, q) => s + q.n, 0) + glyphs.length - 1;
    const k = Math.max(1, Math.min(Math.floor((w - pad * 2) / unit), Math.floor((h - pad * 2) / 7)));
    let x = Math.floor((w - unit * k) / 2);
    const y = Math.floor((h - 7 * k) / 2);
    for (const q of glyphs) {
      q.g.forEach((row, j) => {
        for (let i = 0; i < q.n; i++) if (row & (16 >> (i + q.l))) for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) mask[(y + j * k + b) * w + x + i * k + a] = 1;
      });
      x += (q.n + 1) * k;
    }
  } else {
    // system font at 2x, auto-fit (width and real glyph height) to the sign, then 2x2 coverage → hard pixels
    const c = document.createElement('canvas');
    c.width = w * 2; c.height = h * 2;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    const font = (s: number) => `bold ${s}px 'Pixelify Sans', system-ui, 'Segoe UI', 'Noto Sans', sans-serif`;
    let size = 40;
    g.font = font(size);
    g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = '#fff';
    let m = g.measureText(text);
    const mh = (h - 4) * 2, mw = (w - pad * 2) * 2;
    size *= Math.min(mw / Math.max(1, m.width), mh / Math.max(1, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent));
    g.font = font(size);
    m = g.measureText(text);
    g.fillText(text, w, h + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
    const a = g.getImageData(0, 0, w * 2, h * 2).data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * 2 * w * 2 + x * 2) * 4 + 3, row = w * 2 * 4;
      if (a[i] + a[i + 4] + a[i + row] + a[i + row + 4] > 360) mask[y * w + x] = 1;
    }
  }
  // outline (8-neighborhood) then text with a lighter top row per glyph stroke
  const m = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  p.each((x, y) => {
    if (m(x, y)) return;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (m(x + i, y + j)) { p.set(x, y, ol); return; }
  });
  p.each((x, y) => { if (m(x, y)) p.set(x, y, m(x, y + 1) || !m(x, y - 1) ? fg : shade(fg, 0.78)); });
  return p;
}
