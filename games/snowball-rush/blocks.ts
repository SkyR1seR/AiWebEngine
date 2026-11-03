// Voxel geometry helpers (owner: art): merged block meshes grouped by texture, boxes, voxel spheres, sprites.
// UV conventions (texture row 0 = image top):
// - top faces: u along +X, v along +Z → image top at the -Z edge (the race direction; 'boost' chevrons point to -Z);
// - side faces: u to the right as seen from outside, v downwards → image top at the block top (snow caps stay on top);
// - textures repeat once per meter on every face (merged faces get UVs > 1, textures use repeat wrap).
import { Geometry, Material, Mesh, Node, color, type MaterialOptions } from 'aiwebengine';
import { tex, type TexId } from './textures';

/** one texture for all faces, or [top, side, bottom] */
export type Faces = TexId | [TexId, TexId, TexId];
/** block centered at (x, y, z), size 1 unless sx/sy/sz given */
export interface Block { x: number; y: number; z: number; t: Faces; sx?: number; sy?: number; sz?: number }

// ---------------------------------------------------------------- materials

/** default per-texture options: glowing textures are unlit, fire is a cut-out, glass is translucent */
const DEF: Partial<Record<TexId, MaterialOptions>> = {
  fire: { type: 'unlit', alphaTest: 0.5, cull: 'none', castShadow: false },
  lamp: { type: 'unlit' },
  window: { type: 'unlit' },
  glass: { blend: 'alpha' },
};
/** textures that never hide the faces of their neighbors */
const SEE_THROUGH = new Set<TexId>(['fire', 'glass']);
const mats = new Map<string, Material>();

/**
 * cached lambert material with the pixel texture (opts change the cache key; lamp/window/fire default to unlit).
 * opts.map is ignored (the texture is always tex(id)); build your own Material for custom maps such as signs.
 */
export function blockMaterial(id: TexId, opts?: MaterialOptions): Material {
  const key = id + (opts ? JSON.stringify(opts, (k, v) => (k === 'map' ? undefined : v)) : '');
  let m = mats.get(key);
  if (!m) {
    m = new Material({ type: 'lambert', ...DEF[id], ...opts, map: tex(id) });
    mats.set(key, m);
  }
  return m;
}

// ---------------------------------------------------------------- quad accumulator

/** face directions: normal N, texture u axis U (right), texture v axis V (down) */
const DIRS: { n: number[]; u: number[]; v: number[] }[] = [
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] }, // top
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1] }, // bottom
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, -1, 0] }, // +X
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, -1, 0] }, // -X
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, -1, 0] }, // +Z
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, -1, 0] }, // -Z
];
const dot = (a: number[], x: number, y: number, z: number) => a[0] * x + a[1] * y + a[2] * z;

class Quads {
  p: number[] = [];
  n: number[] = [];
  uv: number[] = [];
  c: number[] = [];
  idx: number[] = [];
  /** quad centered at (cx,cy,cz) on face dir `d`, size su x sv meters, uv scale (us, vs) */
  add(d: number, cx: number, cy: number, cz: number, su: number, sv: number, us = su, vs = sv, col?: ArrayLike<number>) {
    const { n, u, v } = DIRS[d], b = this.p.length / 3;
    // TL, BL, BR, TR (texture space) → counter-clockwise seen from outside
    for (const [s, t] of [[0, 0], [0, 1], [1, 1], [1, 0]]) {
      const a = (s - 0.5) * su, e = (t - 0.5) * sv;
      this.p.push(cx + u[0] * a + v[0] * e, cy + u[1] * a + v[1] * e, cz + u[2] * a + v[2] * e);
      this.n.push(n[0], n[1], n[2]);
      this.uv.push(s * us, t * vs);
      if (col) this.c.push(col[0], col[1], col[2], col[3]);
    }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  /** axis-aligned box of size (sx, sy, sz) at a center; uv per meter or 0..1 per face */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, perFace = false, skip?: (d: number) => boolean) {
    const sz3 = [sx, sy, sz];
    for (let d = 0; d < 6; d++) {
      if (skip?.(d)) continue;
      const { n, u, v } = DIRS[d];
      const su = Math.abs(dot(u, sx, sy, sz)), sv = Math.abs(dot(v, sx, sy, sz)), h = Math.abs(dot(n, sz3[0], sz3[1], sz3[2])) / 2;
      this.add(d, cx + n[0] * h, cy + n[1] * h, cz + n[2] * h, su, sv, perFace ? 1 : su, perFace ? 1 : sv);
    }
  }
  geometry(): Geometry {
    const g = new Geometry().setAttribute('position', this.p, 3).setAttribute('normal', this.n, 3).setAttribute('uv', this.uv, 2);
    if (this.c.length) g.setAttribute('color', this.c, 4);
    const nv = this.p.length / 3;
    return g.setIndex(nv > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx));
  }
}

// ---------------------------------------------------------------- merged blocks

export interface BuildOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** skip every downward face (floors seen only from above) */
  noBottom?: boolean;
  /** split meshes every N meters along Z so off-screen parts are frustum-culled (default: one mesh per texture) */
  chunk?: number;
}

/**
 * Geometry of many blocks grouped by texture (and Z chunk). Faces between touching unit blocks (centers exactly 1 m
 * apart) are culled; the remaining coplanar unit faces with the same texture are greedily merged into big quads.
 * Non-unit blocks are plain boxes (no culling). Pure (no GPU/DOM): returns [texture, chunk, geometry] entries.
 */
export function blockGeometry(blocks: Block[], opts: BuildOptions = {}): { t: TexId; chunk: number; geo: Geometry }[] {
  const K = (x: number, y: number, z: number) => `${Math.round(x * 2)},${Math.round(y * 2)},${Math.round(z * 2)}`;
  const isUnit = (b: Block) => (b.sx ?? 1) === 1 && (b.sy ?? 1) === 1 && (b.sz ?? 1) === 1;
  const faceTex = (b: Block, d: number): TexId => (typeof b.t === 'string' ? b.t : b.t[d === 0 ? 0 : d === 1 ? 2 : 1]);
  const solid = new Map<string, Block>();
  for (const b of blocks) if (isUnit(b)) solid.set(K(b.x, b.y, b.z), b);
  const chunkOf = (z: number) => (opts.chunk ? Math.floor(z / opts.chunk) : 0);
  const quads = new Map<string, Quads>();
  const q = (t: TexId, chunk: number) => {
    const k = t + '|' + chunk;
    let a = quads.get(k);
    if (!a) quads.set(k, (a = new Quads()));
    return a;
  };
  // unit faces grouped per (dir, texture, plane, chunk); cells on a doubled integer grid
  const groups = new Map<string, { d: number; t: TexId; plane: number; chunk: number; cells: Set<string>; list: number[] }>();
  for (const b of blocks) {
    if (!isUnit(b)) {
      for (let d = 0; d < 6; d++) {
        if (d === 1 && opts.noBottom) continue;
        q(faceTex(b, d), chunkOf(b.z)).box(b.x, b.y, b.z, b.sx ?? 1, b.sy ?? 1, b.sz ?? 1, false, (k) => k !== d);
      }
      continue;
    }
    const see = SEE_THROUGH.has(faceTex(b, 2));
    for (let d = 0; d < 6; d++) {
      if (d === 1 && opts.noBottom) continue;
      const { n, u, v } = DIRS[d];
      const nb = solid.get(K(b.x + n[0], b.y + n[1], b.z + n[2]));
      if (nb && (!SEE_THROUGH.has(faceTex(nb, 2)) || see)) continue;
      const t = faceTex(b, d), plane = Math.round(dot(n, b.x, b.y, b.z) * 2), chunk = chunkOf(b.z);
      const gk = `${d}|${t}|${plane}|${chunk}`;
      let g = groups.get(gk);
      if (!g) groups.set(gk, (g = { d, t, plane, chunk, cells: new Set(), list: [] }));
      const a = Math.round(dot(u, b.x, b.y, b.z) * 2), e = Math.round(dot(v, b.x, b.y, b.z) * 2);
      const ck = a + ',' + e;
      if (!g.cells.has(ck)) { g.cells.add(ck); g.list.push(a, e); }
    }
  }
  // greedy merge: grow each rectangle along u, then along v
  for (const g of groups.values()) {
    const { n, u, v } = DIRS[g.d], out = q(g.t, g.chunk), used = new Set<string>();
    const order: number[] = [];
    for (let i = 0; i < g.list.length; i += 2) order.push(i);
    order.sort((i, j) => g.list[i + 1] - g.list[j + 1] || g.list[i] - g.list[j]);
    const free = (a: number, e: number) => g.cells.has(a + ',' + e) && !used.has(a + ',' + e);
    for (const i of order) {
      const a0 = g.list[i], e0 = g.list[i + 1];
      if (!free(a0, e0)) continue;
      let a1 = a0;
      while (free(a1 + 2, e0)) a1 += 2;
      let e1 = e0;
      for (;;) {
        let ok = true;
        for (let a = a0; a <= a1 && ok; a += 2) ok = free(a, e1 + 2);
        if (!ok) break;
        e1 += 2;
      }
      for (let e = e0; e <= e1; e += 2) for (let a = a0; a <= a1; a += 2) used.add(a + ',' + e);
      const pn = g.plane / 2 + 0.5, pu = (a0 + a1) / 4, pv = (e0 + e1) / 4;
      out.add(g.d, n[0] * pn + u[0] * pu + v[0] * pv, n[1] * pn + u[1] * pu + v[1] * pv, n[2] * pn + u[2] * pu + v[2] * pv, (a1 - a0) / 2 + 1, (e1 - e0) / 2 + 1);
    }
  }
  return [...quads].map(([k, a]) => ({ t: k.split('|')[0] as TexId, chunk: +k.split('|')[1], geo: a.geometry() }));
}

/** merge many blocks into few meshes (one per texture); faces between touching unit blocks are culled */
export function buildBlocks(blocks: Block[], opts?: BuildOptions): Node {
  const root = new Node('blocks');
  for (const { t, geo } of blockGeometry(blocks, opts)) {
    const m = root.add(new Mesh(geo, blockMaterial(t)));
    m.castShadow = opts?.castShadow ?? true;
    m.receiveShadow = opts?.receiveShadow ?? true;
  }
  return root;
}

/** box with per-meter tiled UVs (or 0..1 per face with perFace), centered at origin */
export function boxGeometry(sx: number, sy: number, sz: number, perFace = false): Geometry {
  const q = new Quads();
  q.box(0, 0, 0, sx, sy, sz, perFace);
  return q.geometry();
}

// ---------------------------------------------------------------- voxel sphere

/** paint() may return a color with this flag: the voxel glows (HDR vertex color x3, blooms with PostFX) */
export const GLOW = 0x1000000;
const tmpColor = new Float32Array(4);

/**
 * Sphere of radius 1 made of voxels on a res^3 grid (exposed faces only), vertex colors from paint(x,y,z in -1..1) → hex
 * (sRGB, converted to linear; `| GLOW` = emissive-looking), uv 0..1 per voxel face (pair with tex('voxel') for a bevel).
 */
export function voxelSphere(res: number, paint: (x: number, y: number, z: number) => number): Geometry {
  const s = 2 / res, c = (i: number) => -1 + (i + 0.5) * s;
  const inside = (i: number, j: number, k: number) =>
    i >= 0 && j >= 0 && k >= 0 && i < res && j < res && k < res && c(i) ** 2 + c(j) ** 2 + c(k) ** 2 <= 1.02;
  const q = new Quads();
  for (let i = 0; i < res; i++) for (let j = 0; j < res; j++) for (let k = 0; k < res; k++) {
    if (!inside(i, j, k)) continue;
    const x = c(i), y = c(j), z = c(k), hex = paint(x, y, z);
    color(hex & 0xffffff, 1, tmpColor);
    if (hex & GLOW) for (let m = 0; m < 3; m++) tmpColor[m] *= 3;
    for (let d = 0; d < 6; d++) {
      const { n } = DIRS[d];
      if (inside(i + n[0], j + n[1], k + n[2])) continue;
      q.add(d, x + (n[0] * s) / 2, y + (n[1] * s) / 2, z + (n[2] * s) / 2, s, s, 1, 1, tmpColor);
    }
  }
  return q.geometry();
}

/** two crossed vertical quads (fire, plants), bottom at y=0, uv v=0 at the top; normals point up (even lighting) */
export function crossSprite(w: number, h: number): Geometry {
  const x = w / 2;
  const p = [-x, h, 0, -x, 0, 0, x, 0, 0, x, h, 0, 0, h, -x, 0, 0, -x, 0, 0, x, 0, h, x];
  const uv = [0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0];
  const n: number[] = [];
  for (let i = 0; i < 8; i++) n.push(0, 1, 0);
  return new Geometry().setAttribute('position', p, 3).setAttribute('normal', n, 3).setAttribute('uv', uv, 2)
    .setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
}
