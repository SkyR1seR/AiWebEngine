// Minecraft-style "noob" built from textured boxes. Supports the classic 64x32 skin layout and the modern 64x64 one
// (separate left arm/leg, slim 3px "Alex" arms, second layer: hat, jacket, sleeves, pants). HD skins (128x128...) work too.
import { Node, Mesh, Geometry, lambert, type Texture, type Material } from 'aiwebengine';

/** meters per skin pixel */
export const PX = 0.035;

// face frames seen from outside: [normal, right, up]
const FACES: [number[], number[], number[]][] = [
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]], // front
  [[0, 0, -1], [-1, 0, 0], [0, 1, 0]], // back
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], // character's right side
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]], // character's left side
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]], // top
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]], // bottom
];

const geoCache = new Map<string, Geometry>();
/**
 * Box of w*h*d skin pixels with Minecraft UVs at texture origin (u,v) in a 64 x `th` layout.
 * `mirror` = left limb of an old 64x32 skin (reuses the right one), `grow` = second-layer inflation in pixels.
 */
function skinBox(w: number, h: number, d: number, u: number, v: number, th: number, mirror = false, grow = 0) {
  const key = [w, h, d, u, v, th, mirror, grow].join();
  let g = geoCache.get(key);
  if (g) return g;
  // [x, y, w, h] per face in FACES order
  let rects = [
    [u + d, v + d, w, h], [u + 2 * d + w, v + d, w, h], [u, v + d, d, h], [u + d + w, v + d, d, h],
    [u + d, v, w, d], [u + d + w, v, w, d],
  ];
  if (mirror) rects = [rects[0], rects[1], rects[3], rects[2], rects[4], rects[5]];
  const half = [(w / 2 + grow) * PX, (h / 2 + grow) * PX, (d / 2 + grow) * PX];
  const p: number[] = [], n: number[] = [], uv: number[] = [], idx: number[] = [];
  FACES.forEach(([N, R, U], f) => {
    const [rx, ry, rw, rh] = rects[f];
    let u0 = rx / 64, u1 = (rx + rw) / 64;
    if (mirror) [u0, u1] = [u1, u0];
    const v0 = ry / th, v1 = (ry + rh) / th;
    const b = p.length / 3;
    // BL, BR, TR, TL (counter-clockwise from outside)
    for (const [s, t, cu, cv] of [[-1, -1, u0, v1], [1, -1, u1, v1], [1, 1, u1, v0], [-1, 1, u0, v0]]) {
      for (let k = 0; k < 3; k++) p.push((N[k] + R[k] * s + U[k] * t) * half[k]);
      n.push(...N);
      uv.push(cu, cv);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  g = new Geometry().setAttribute('position', p, 3).setAttribute('normal', n, 3).setAttribute('uv', uv, 2).setIndex(idx);
  geoCache.set(key, g);
  return g;
}

// ---------------------------------------------------------------- skin analysis

/** Second-layer regions: [name, u, v, w, h, d] (w of arms is fixed up for slim skins). */
const LAYERS: [string, number, number, number, number, number][] = [
  ['hat', 32, 0, 8, 8, 8], ['jacket', 16, 32, 8, 12, 4], ['sleeveR', 40, 32, 4, 12, 4], ['sleeveL', 48, 48, 4, 12, 4],
  ['pantsR', 0, 32, 4, 12, 4], ['pantsL', 0, 48, 4, 12, 4],
];

export interface SkinInfo {
  /** layout height in skin pixels: 32 (classic) or 64 (modern) */
  th: number;
  /** 3px arms */
  slim: boolean;
  /** second-layer parts that have visible pixels */
  layers: Set<string>;
}

/** Read the skin's pixels (layout, slim arms, which overlay parts are used). */
export function skinInfo(src: CanvasImageSource & { width: number; height: number }): SkinInfo {
  const W = src.width, H = src.height, th = H >= W ? 64 : 32;
  const info: SkinInfo = { th, slim: false, layers: new Set() };
  let data: Uint8ClampedArray;
  try {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(src, 0, 0);
    data = g.getImageData(0, 0, W, H).data;
  } catch { return info; }
  const k = W / 64;
  const alpha = (x: number, y: number) => data[(Math.floor(y * k) * W + Math.floor(x * k)) * 4 + 3];
  if (th === 64) info.slim = alpha(54, 20) === 0 && alpha(55, 31) === 0;
  for (const [name, u, v, w0, h, d] of LAYERS) {
    if (th === 32 && name !== 'hat') continue;
    const w = info.slim && name.startsWith('sleeve') ? 3 : w0;
    let seen = 0, opaque = 0, total = 0;
    const first: number[] = [];
    let uniform = true;
    // only the actual faces of the unfolded box (the corners of the region are unused)
    const rects = [[u + d, v, 2 * w, d], [u, v + d, 2 * d + 2 * w, h]];
    for (const [rx, ry, rw, rh] of rects) for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) {
      const i = (Math.floor(y * k) * W + Math.floor(x * k)) * 4;
      total++;
      if (data[i + 3] > 0) seen++;
      if (data[i + 3] === 255) {
        opaque++;
        if (!first.length) first.push(data[i], data[i + 1], data[i + 2]);
        else if (data[i] !== first[0] || data[i + 1] !== first[1] || data[i + 2] !== first[2]) uniform = false;
      }
    }
    // old skins often fill the unused hat area with one solid color: Minecraft ignores that too
    if (seen && !(opaque === total && uniform)) info.layers.add(name);
  }
  return info;
}

const texData = new WeakMap<Texture, { info: SkinInfo; base: Material; over: Material }>();
function prepare(skin: Texture) {
  let t = texData.get(skin);
  if (!t) {
    const src = skin.source;
    const info = src && !(src instanceof Uint8Array)
      ? skinInfo(src as CanvasImageSource & { width: number; height: number })
      : { th: skin.height >= skin.width ? 64 : 32, slim: false, layers: new Set<string>() };
    t = {
      info,
      base: lambert(0xffffff, { map: skin }),
      over: lambert(0xffffff, { map: skin, alphaTest: 0.5, castShadow: false, cull: 'none' }),
    };
    texData.set(skin, t);
  }
  return t;
}

// ---------------------------------------------------------------- model

export interface Noob {
  root: Node;
  head: Node;
  armR: Node;
  armL: Node;
  legR: Node;
  legL: Node;
}

/** Standing noob, feet at y=0, facing +Z. Limb pivots sit at the joints. */
export function createNoob(skin: Texture): Noob {
  const { info, base, over } = prepare(skin);
  const th = info.th, tall = th === 64, aw = info.slim ? 3 : 4;
  const root = new Node('noob');
  /** base box + optional second layer, in a pivot node at (px,py) with the box center `oy` pixels below/above it */
  const part = (parent: Node, px: number, py: number, oy: number, g: Geometry, layer?: string, lg?: Geometry) => {
    const pivot = parent.add(new Node());
    pivot.setPosition(px * PX, py * PX, 0);
    pivot.add(new Mesh(g, base)).setPosition(0, oy * PX, 0);
    if (layer && lg && info.layers.has(layer)) {
      const m = pivot.add(new Mesh(lg, over));
      m.setPosition(0, oy * PX, 0);
      m.castShadow = false;
    }
    return pivot;
  };
  part(root, 0, 18, 0, skinBox(8, 12, 4, 16, 16, th), 'jacket', skinBox(8, 12, 4, 16, 32, th, false, 0.25));
  const head = part(root, 0, 24, 4, skinBox(8, 8, 8, 0, 0, th), 'hat', skinBox(8, 8, 8, 32, 0, th, false, 0.5));
  // the character's right side is -X when facing +Z
  const ax = 4 + aw / 2;
  const armR = part(root, -ax, 22, -4, skinBox(aw, 12, 4, 40, 16, th), 'sleeveR', skinBox(aw, 12, 4, 40, 32, th, false, 0.25));
  const armL = tall
    ? part(root, ax, 22, -4, skinBox(aw, 12, 4, 32, 48, th), 'sleeveL', skinBox(aw, 12, 4, 48, 48, th, false, 0.25))
    : part(root, ax, 22, -4, skinBox(aw, 12, 4, 40, 16, th, true));
  const legR = part(root, -2, 12, -6, skinBox(4, 12, 4, 0, 16, th), 'pantsR', skinBox(4, 12, 4, 0, 32, th, false, 0.25));
  const legL = tall
    ? part(root, 2, 12, -6, skinBox(4, 12, 4, 16, 48, th), 'pantsL', skinBox(4, 12, 4, 0, 48, th, false, 0.25))
    : part(root, 2, 12, -6, skinBox(4, 12, 4, 0, 16, th, true));
  return { root, head, armR, armL, legR, legL };
}

/** Sitting pose: legs and arms forward. */
export function sit(n: Noob) {
  n.legR.setRotation(-Math.PI / 2, 0.08, 0);
  n.legL.setRotation(-Math.PI / 2, -0.08, 0);
  n.armR.setRotation(-1.25, 0, 0);
  n.armL.setRotation(-1.25, 0, 0);
  n.head.setRotation(0, 0, 0);
}
