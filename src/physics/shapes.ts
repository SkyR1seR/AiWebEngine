import type { Geometry } from '../geometry/geometry';

export interface SphereShape { type: 'sphere'; radius: number }
export interface BoxShape { type: 'box'; half: Float32Array }
/** Capsule along local Y: segment of half-length `half` plus radius. */
export interface CapsuleShape { type: 'capsule'; radius: number; half: number }
/** Infinite plane through body position with normal = body local +Y. Static only. */
export interface PlaneShape { type: 'plane' }
/** Static triangle mesh (with BVH). */
export interface MeshShape { type: 'mesh'; tri: TriMesh }
export type Shape = SphereShape | BoxShape | CapsuleShape | PlaneShape | MeshShape;

export const sphereShape = (radius = 0.5): SphereShape => ({ type: 'sphere', radius });
export const boxShape = (hx = 0.5, hy = hx, hz = hx): BoxShape => ({ type: 'box', half: new Float32Array([hx, hy, hz]) });
/** halfHeight = half length of the inner segment (total height = 2*halfHeight + 2*radius). */
export const capsuleShape = (radius = 0.5, halfHeight = 0.5): CapsuleShape => ({ type: 'capsule', radius, half: halfHeight });
export const planeShape = (): PlaneShape => ({ type: 'plane' });
/** Static mesh collider from a geometry (optionally scaled). */
export const meshShape = (g: Geometry | { positions: ArrayLike<number>; indices?: ArrayLike<number> }, scale: ArrayLike<number> = [1, 1, 1]): MeshShape => {
  const pos = 'attributes' in g ? (g.attributes.position.data as Float32Array) : g.positions;
  const idx = 'attributes' in g ? g.index : g.indices;
  return { type: 'mesh', tri: new TriMesh(pos, idx ?? null, scale) };
};

/** Diagonal local inertia for a unit-mass shape (multiply by mass). */
export function unitInertia(s: Shape): [number, number, number] {
  switch (s.type) {
    case 'sphere': { const i = 0.4 * s.radius * s.radius; return [i, i, i]; }
    case 'box': {
      const x = 2 * s.half[0], y = 2 * s.half[1], z = 2 * s.half[2];
      return [(y * y + z * z) / 12, (x * x + z * z) / 12, (x * x + y * y) / 12];
    }
    case 'capsule': {
      const r = s.radius, h = 2 * s.half + 2 * r;
      const ix = (3 * r * r + h * h) / 12;
      return [ix, 0.5 * r * r, ix];
    }
    default: return [1, 1, 1];
  }
}

/** Static triangle mesh with a bounding volume hierarchy. */
export class TriMesh {
  v: Float32Array;
  /** triangle vertex indices */
  t: Uint32Array;
  /** per-triangle normal */
  n: Float32Array;
  /** BVH nodes: [minx,miny,minz,maxx,maxy,maxz] */
  nodeBox: Float32Array;
  /** node: left child index or -1 for leaf; leaf: start,count into order */
  nodeL: Int32Array;
  nodeR: Int32Array;
  order: Uint32Array;
  min = new Float32Array(3);
  max = new Float32Array(3);

  constructor(pos: ArrayLike<number>, idx: ArrayLike<number> | null, scale: ArrayLike<number>) {
    const nv = pos.length / 3;
    this.v = new Float32Array(pos.length);
    for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) this.v[i * 3 + k] = pos[i * 3 + k] * scale[k];
    const t = idx ? Uint32Array.from(idx as ArrayLike<number>) : Uint32Array.from({ length: nv }, (_, i) => i);
    this.t = t;
    const nt = t.length / 3;
    this.n = new Float32Array(nt * 3);
    const v = this.v;
    const cent = new Float32Array(nt * 3);
    for (let i = 0; i < nt; i++) {
      const a = t[i * 3] * 3, b = t[i * 3 + 1] * 3, c = t[i * 3 + 2] * 3;
      const e1x = v[b] - v[a], e1y = v[b + 1] - v[a + 1], e1z = v[b + 2] - v[a + 2];
      const e2x = v[c] - v[a], e2y = v[c + 1] - v[a + 1], e2z = v[c + 2] - v[a + 2];
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const l = Math.hypot(nx, ny, nz) || 1;
      this.n[i * 3] = nx / l; this.n[i * 3 + 1] = ny / l; this.n[i * 3 + 2] = nz / l;
      for (let k = 0; k < 3; k++) cent[i * 3 + k] = (v[a + k] + v[b + k] + v[c + k]) / 3;
    }
    // build BVH
    const maxNodes = Math.max(1, nt * 2);
    this.nodeBox = new Float32Array(maxNodes * 6);
    this.nodeL = new Int32Array(maxNodes);
    this.nodeR = new Int32Array(maxNodes);
    this.order = Uint32Array.from({ length: nt }, (_, i) => i);
    let count = 0;
    const order = this.order;
    const build = (start: number, n: number): number => {
      const id = count++;
      const b = this.nodeBox;
      b[id * 6] = b[id * 6 + 1] = b[id * 6 + 2] = Infinity;
      b[id * 6 + 3] = b[id * 6 + 4] = b[id * 6 + 5] = -Infinity;
      for (let i = start; i < start + n; i++) {
        const tr = order[i];
        for (let j = 0; j < 3; j++) {
          const vi = t[tr * 3 + j] * 3;
          for (let k = 0; k < 3; k++) {
            b[id * 6 + k] = Math.min(b[id * 6 + k], v[vi + k]);
            b[id * 6 + 3 + k] = Math.max(b[id * 6 + 3 + k], v[vi + k]);
          }
        }
      }
      if (n <= 4) { this.nodeL[id] = -1; this.nodeR[id] = start | (n << 24); return id; }
      // split along longest axis at median centroid
      const ext = [b[id * 6 + 3] - b[id * 6], b[id * 6 + 4] - b[id * 6 + 1], b[id * 6 + 5] - b[id * 6 + 2]];
      const ax = ext[0] > ext[1] ? (ext[0] > ext[2] ? 0 : 2) : ext[1] > ext[2] ? 1 : 2;
      const sub = Array.from(order.subarray(start, start + n)).sort((p, q) => cent[p * 3 + ax] - cent[q * 3 + ax]);
      order.set(sub, start);
      const h = n >> 1;
      this.nodeL[id] = build(start, h);
      this.nodeR[id] = build(start + h, n - h);
      return id;
    };
    if (nt) build(0, nt);
    for (let k = 0; k < 3; k++) { this.min[k] = this.nodeBox[k]; this.max[k] = this.nodeBox[3 + k]; }
    if (nt > (1 << 24)) throw new Error('TriMesh too large');
  }

  /** Call fn(triangleIndex) for triangles whose node AABB overlaps [min,max] (local space). */
  query(min: ArrayLike<number>, max: ArrayLike<number>, fn: (tri: number) => void) {
    if (!this.t.length) return;
    const b = this.nodeBox, stack = [0];
    while (stack.length) {
      const id = stack.pop()!, o = id * 6;
      if (b[o] > max[0] || b[o + 3] < min[0] || b[o + 1] > max[1] || b[o + 4] < min[1] || b[o + 2] > max[2] || b[o + 5] < min[2]) continue;
      if (this.nodeL[id] < 0) {
        const r = this.nodeR[id], s = r & 0xffffff, n = r >>> 24;
        for (let i = s; i < s + n; i++) fn(this.order[i]);
      } else stack.push(this.nodeL[id], this.nodeR[id]);
    }
  }

  /** Ray (local space) vs mesh: returns [t, triIndex] or null. */
  raycast(o: ArrayLike<number>, d: ArrayLike<number>, maxT: number): [number, number] | null {
    if (!this.t.length) return null;
    const b = this.nodeBox, v = this.v, t = this.t;
    const inv = [1 / d[0], 1 / d[1], 1 / d[2]];
    let best = maxT, bestTri = -1;
    const stack = [0];
    while (stack.length) {
      const id = stack.pop()!, q = id * 6;
      let t0 = 0, t1 = best;
      for (let k = 0; k < 3; k++) {
        let a = (b[q + k] - o[k]) * inv[k], c = (b[q + 3 + k] - o[k]) * inv[k];
        if (a > c) { const s = a; a = c; c = s; }
        t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      }
      if (t0 > t1) continue;
      if (this.nodeL[id] < 0) {
        const r = this.nodeR[id], s = r & 0xffffff, n = r >>> 24;
        for (let i = s; i < s + n; i++) {
          const tr = this.order[i];
          const hit = rayTri(o, d, v, t[tr * 3] * 3, t[tr * 3 + 1] * 3, t[tr * 3 + 2] * 3);
          if (hit >= 0 && hit < best) { best = hit; bestTri = tr; }
        }
      } else stack.push(this.nodeL[id], this.nodeR[id]);
    }
    return bestTri >= 0 ? [best, bestTri] : null;
  }
}

/** Möller–Trumbore (double-sided). Returns t or -1. */
export function rayTri(o: ArrayLike<number>, d: ArrayLike<number>, v: ArrayLike<number>, a: number, b: number, c: number) {
  const e1x = v[b] - v[a], e1y = v[b + 1] - v[a + 1], e1z = v[b + 2] - v[a + 2];
  const e2x = v[c] - v[a], e2y = v[c + 1] - v[a + 1], e2z = v[c + 2] - v[a + 2];
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det;
  const tx = o[0] - v[a], ty = o[1] - v[a + 1], tz = o[2] - v[a + 2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const w = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (w < 0 || u + w > 1) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t >= 0 ? t : -1;
}
