// Narrowphase contact generation. All normals point from body A to body B.
import type { Body } from './body';
import type { TriMesh } from './shapes';

export interface CP {
  p: [number, number, number];
  n: [number, number, number];
  /** penetration depth (negative = speculative gap) */
  d: number;
  /** @internal edge/vertex contact against a mesh (for ghost-edge filtering) */
  e?: boolean;
}

type V = number[];
const MARGIN = 0.02;

// ---------------------------------------------------------------- helpers
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const madd = (a: V, b: V, s: number): V => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);

/** Rotation matrix columns (local axes in world) from quaternion. */
export function axes(q: ArrayLike<number>): [V, V, V] {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
    [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
    [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)],
  ];
}
const toLocal = (p: V, c: ArrayLike<number>, ax: V[]): V => { const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]; return [dot(d, ax[0]), dot(d, ax[1]), dot(d, ax[2])]; };
const toWorldDir = (v: V, ax: V[]): V => [ax[0][0] * v[0] + ax[1][0] * v[1] + ax[2][0] * v[2], ax[0][1] * v[0] + ax[1][1] * v[1] + ax[2][1] * v[2], ax[0][2] * v[0] + ax[1][2] * v[1] + ax[2][2] * v[2]];
const toWorld = (v: V, c: ArrayLike<number>, ax: V[]): V => { const w = toWorldDir(v, ax); return [w[0] + c[0], w[1] + c[1], w[2] + c[2]]; };

export function capsuleSeg(b: Body): [V, V] {
  const s = b.shape as { half: number };
  const up = axes(b.rotation)[1];
  const c = b.position as unknown as V;
  return [madd(c, up, -s.half), madd(c, up, s.half)];
}

function closestSegT(p: V, a: V, b: V) {
  const ab = sub(b, a), l2 = dot(ab, ab);
  return l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
}
const lerp3 = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Closest points between segments p1q1 and p2q2 -> [s, t]. (Ericson 5.1.9) */
function segSeg(p1: V, q1: V, p2: V, q2: V): [number, number] {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s: number, t: number;
  if (a <= 1e-12 && e <= 1e-12) return [0, 0];
  if (a <= 1e-12) { s = 0; t = Math.max(0, Math.min(1, f / e)); }
  else {
    const c = dot(d1, r);
    if (e <= 1e-12) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
      else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  return [s, t];
}

/** Closest point on triangle abc to p. Returns [point, isFaceRegion]. (Ericson 5.1.5) */
export function closestTri(p: V, a: V, b: V, c: V): [V, boolean] {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [a, false];
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [b, false];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return [madd(a, ab, d1 / (d1 - d3)), false];
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [c, false];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return [madd(a, ac, d2 / (d2 - d6)), false];
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return [madd(b, sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6))), false];
  const den = 1 / (va + vb + vc);
  return [add(a, add(mul(ab, vb * den), mul(ac, vc * den))), true];
}

/** Closest point on OBB to p (world). Returns [point, inside]. */
function closestBox(p: V, c: ArrayLike<number>, ax: V[], h: ArrayLike<number>): [V, boolean] {
  const l = toLocal(p, c, ax);
  let inside = true;
  for (let i = 0; i < 3; i++) {
    if (l[i] > h[i]) { l[i] = h[i]; inside = false; }
    else if (l[i] < -h[i]) { l[i] = -h[i]; inside = false; }
  }
  return [toWorld(l, c, ax), inside];
}

/** Golden-section search of t in [0,1] minimizing f. */
function minimize(f: (t: number) => number) {
  const g = 0.618034;
  let a = 0, b = 1, c = b - g, d = g, fc = f(c), fd = f(d);
  for (let i = 0; i < 18; i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
  }
  return (a + b) / 2;
}

function push(out: CP[], p: V, n: V, d: number, e = false) {
  out.push({ p: [p[0], p[1], p[2]], n: [n[0], n[1], n[2]], d, e });
}

// ---------------------------------------------------------------- primitive pairs

/** sphere(A) at ca vs sphere(B) at cb */
function sphereSphere(ca: V, ra: number, cb: V, rb: number, out: CP[], margin = 0) {
  const d = sub(cb, ca), dist = len(d);
  if (dist >= ra + rb + margin) return;
  const n = dist > 1e-9 ? mul(d, 1 / dist) : [0, 1, 0];
  const pen = ra + rb - dist;
  push(out, madd(ca, n, ra - pen / 2), n, pen);
}

/** sphere(A) vs box(B) */
function sphereBox(c: V, r: number, bc: ArrayLike<number>, ax: V[], h: ArrayLike<number>, out: CP[]) {
  const [q, inside] = closestBox(c, bc, ax, h);
  if (inside) {
    const l = toLocal(c, bc, ax);
    let best = 0, bd = Infinity;
    for (let i = 0; i < 3; i++) { const dd = h[i] - Math.abs(l[i]); if (dd < bd) { bd = dd; best = i; } }
    const nl = [0, 0, 0];
    nl[best] = l[best] >= 0 ? -1 : 1; // from sphere into box
    push(out, c, toWorldDir(nl, ax), r + bd);
    return;
  }
  const d = sub(q, c), dist = len(d);
  if (dist >= r + MARGIN) return;
  const n = mul(d, 1 / dist);
  push(out, mul(add(madd(c, n, r), q), 0.5), n, r - dist);
}

/** sphere(A) vs plane(B, normal pn through point pp) */
function spherePlane(c: V, r: number, pn: V, pd: number, out: CP[]) {
  const s = dot(pn, c) - pd;
  if (s >= r + MARGIN) return;
  push(out, madd(c, pn, -(r + s) / 2), mul(pn, -1), r - s);
}

function boxVerts(c: ArrayLike<number>, ax: V[], h: ArrayLike<number>): V[] {
  const v: V[] = [];
  for (let i = 0; i < 8; i++) {
    const sx = i & 1 ? 1 : -1, sy = i & 2 ? 1 : -1, sz = i & 4 ? 1 : -1;
    v.push(toWorld([sx * h[0], sy * h[1], sz * h[2]], c, ax));
  }
  return v;
}

/** box(A) vs box(B): SAT + face clipping. */
function boxBox(ca: ArrayLike<number>, axA: V[], ha: ArrayLike<number>, cb: ArrayLike<number>, axB: V[], hb: ArrayLike<number>, out: CP[]) {
  const T = [cb[0] - ca[0], cb[1] - ca[1], cb[2] - ca[2]];
  let best = Infinity, bestAxis: V = [0, 1, 0], kind = -1, ei = 0, ej = 0;
  const test = (L: V, k: number, i: number, j: number) => {
    const l = len(L);
    if (l < 1e-6) return true;
    const n = mul(L, 1 / l);
    const ra = ha[0] * Math.abs(dot(axA[0], n)) + ha[1] * Math.abs(dot(axA[1], n)) + ha[2] * Math.abs(dot(axA[2], n));
    const rb = hb[0] * Math.abs(dot(axB[0], n)) + hb[1] * Math.abs(dot(axB[1], n)) + hb[2] * Math.abs(dot(axB[2], n));
    const dist = dot(T, n);
    const o = ra + rb - Math.abs(dist);
    if (o < -MARGIN) return false;
    // prefer face axes (edge axes need to be clearly better)
    const score = k === 2 ? o * 1.05 + 0.005 : k === 1 ? o * 1.01 : o;
    if (score < best) { best = score; bestAxis = dist < 0 ? mul(n, -1) : n; kind = k; ei = i; ej = j; }
    return true;
  };
  for (let i = 0; i < 3; i++) if (!test(axA[i], 0, i, 0)) return;
  for (let i = 0; i < 3; i++) if (!test(axB[i], 1, i, 0)) return;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (!test(cross(axA[i], axB[j]), 2, i, j)) return;
  const n = bestAxis; // from A to B

  if (kind === 2) {
    // edge-edge
    let pa: V = [ca[0], ca[1], ca[2]], pb: V = [cb[0], cb[1], cb[2]];
    for (let k = 0; k < 3; k++) {
      if (k !== ei) pa = madd(pa, axA[k], (dot(axA[k], n) > 0 ? 1 : -1) * ha[k]);
      if (k !== ej) pb = madd(pb, axB[k], (dot(axB[k], n) > 0 ? -1 : 1) * hb[k]);
    }
    const a0 = madd(pa, axA[ei], -ha[ei]), a1 = madd(pa, axA[ei], ha[ei]);
    const b0 = madd(pb, axB[ej], -hb[ej]), b1 = madd(pb, axB[ej], hb[ej]);
    const [s, t] = segSeg(a0, a1, b0, b1);
    const p1 = lerp3(a0, a1, s), p2 = lerp3(b0, b1, t);
    push(out, mul(add(p1, p2), 0.5), n, dot(sub(p1, p2), n));
    return;
  }
  // face contact: reference box R, incident box I
  const refA = kind === 0;
  const rc = refA ? ca : cb, rax = refA ? axA : axB, rh = refA ? ha : hb;
  const ic = refA ? cb : ca, iax = refA ? axB : axA, ih = refA ? hb : ha;
  const rn = refA ? n : mul(n, -1); // reference face normal pointing towards incident
  const ri = ei;
  // incident face: most anti-parallel to rn
  let inc = 0, mind = 0;
  for (let i = 0; i < 3; i++) { const d = dot(iax[i], rn); if (Math.abs(d) > Math.abs(mind)) { mind = d; inc = i; } }
  const isign = mind > 0 ? -1 : 1;
  const fc = madd([ic[0], ic[1], ic[2]], iax[inc], isign * ih[inc]);
  const u = (inc + 1) % 3, w = (inc + 2) % 3;
  let poly: V[] = [
    madd(madd(fc, iax[u], ih[u]), iax[w], ih[w]),
    madd(madd(fc, iax[u], -ih[u]), iax[w], ih[w]),
    madd(madd(fc, iax[u], -ih[u]), iax[w], -ih[w]),
    madd(madd(fc, iax[u], ih[u]), iax[w], -ih[w]),
  ];
  // clip against reference side planes
  const ru = (ri + 1) % 3, rw = (ri + 2) % 3;
  for (const [axis, h] of [[rax[ru], rh[ru]], [rax[rw], rh[rw]]] as [V, number][]) {
    for (const sgn of [1, -1]) {
      const pn = mul(axis, sgn), pd = dot(pn, rc as unknown as V) + h;
      const res: V[] = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const da = dot(pn, a) - pd, db = dot(pn, b) - pd;
        if (da <= 0) res.push(a);
        if (da * db < 0) res.push(lerp3(a, b, da / (da - db)));
      }
      poly = res;
      if (!poly.length) return;
    }
  }
  const refFace = madd([rc[0], rc[1], rc[2]], rn, rh[ri]);
  const pts: [V, number][] = [];
  for (const p of poly) {
    const s = dot(sub(p, refFace), rn);
    if (s < MARGIN) pts.push([madd(p, rn, -s / 2), -s]);
  }
  // reduce to 4 points: deepest, farthest, then max area
  let sel = pts;
  if (pts.length > 4) {
    sel = [];
    let i0 = 0;
    pts.forEach((p, i) => { if (p[1] > pts[i0][1]) i0 = i; });
    sel.push(pts[i0]);
    let i1 = 0, bd = -1;
    pts.forEach((p, i) => { const d = len(sub(p[0], pts[i0][0])); if (d > bd) { bd = d; i1 = i; } });
    sel.push(pts[i1]);
    const rest = pts.filter((_, i) => i !== i0 && i !== i1);
    const e = sub(pts[i1][0], pts[i0][0]);
    rest.sort((p, q) => len(cross(e, sub(q[0], pts[i0][0]))) - len(cross(e, sub(p[0], pts[i0][0]))));
    sel.push(...rest.slice(0, 2));
  }
  for (const [p, d] of sel) push(out, p, n, d);
}

function boxPlane(c: ArrayLike<number>, ax: V[], h: ArrayLike<number>, pn: V, pd: number, out: CP[], flip: boolean) {
  const n = flip ? pn : mul(pn, -1);
  for (const v of boxVerts(c, ax, h)) {
    const s = dot(pn, v) - pd;
    if (s < MARGIN) push(out, madd(v, pn, -s / 2), n, -s);
  }
}

/** capsule segment (A) vs box (B) */
function capsuleBox(s0: V, s1: V, r: number, bc: ArrayLike<number>, ax: V[], h: ArrayLike<number>, out: CP[]) {
  const f = (t: number) => { const p = lerp3(s0, s1, t); return len(sub(closestBox(p, bc, ax, h)[0], p)); };
  const ts = [0, 1, minimize(f)];
  const start = out.length;
  for (const t of ts) {
    const tmp: CP[] = [];
    sphereBox(lerp3(s0, s1, t), r, bc, ax, h, tmp);
    for (const c of tmp) {
      let dup = false;
      for (let i = start; i < out.length; i++) if (len(sub(out[i].p, c.p)) < 0.05) { dup = true; if (c.d > out[i].d) out[i] = c; }
      if (!dup) out.push(c);
    }
  }
}

// ---------------------------------------------------------------- mesh

function sphereTri(c: V, r: number, a: V, b: V, cc: V, tn: V, out: CP[]) {
  if (dot(sub(c, a), tn) < -r * 0.5) return; // behind one-sided triangle
  const [q, face] = closestTri(c, a, b, cc);
  const d = sub(q, c), dist = len(d);
  if (dist >= r + MARGIN) return;
  const n = dist > 1e-6 ? mul(d, 1 / dist) : mul(tn, -1);
  push(out, mul(add(madd(c, n, r), q), 0.5), n, r - dist, !face);
}

function boxTri(bc: V, ax: V[], h: ArrayLike<number>, a: V, b: V, c: V, tn: V, out: CP[]) {
  if (dot(sub(bc, a), tn) < 0) return;
  // SAT on 13 axes
  const tri = [a, b, c];
  const edges = [sub(b, a), sub(c, b), sub(a, c)];
  const axesList: V[] = [tn, ax[0], ax[1], ax[2]];
  for (const e of edges) for (const x of ax) axesList.push(cross(e, x));
  let bestD = Infinity, bestN: V = tn;
  for (const L0 of axesList) {
    const l = len(L0);
    if (l < 1e-6) continue;
    const L = mul(L0, 1 / l);
    const r = h[0] * Math.abs(dot(ax[0], L)) + h[1] * Math.abs(dot(ax[1], L)) + h[2] * Math.abs(dot(ax[2], L));
    const cp = dot(bc, L);
    let mn = Infinity, mx = -Infinity;
    for (const v of tri) { const p = dot(v, L); mn = Math.min(mn, p); mx = Math.max(mx, p); }
    const o = Math.min(cp + r - mn, mx - (cp - r));
    if (o < -MARGIN) return;
    if (o < bestD) { bestD = o; bestN = cp < (mn + mx) / 2 ? L : mul(L, -1); }
  }
  let found = false;
  for (const v of boxVerts(bc, ax, h)) {
    const s = dot(sub(v, a), tn);
    if (s >= MARGIN || s < -bestD - 0.1) continue;
    const proj = madd(v, tn, -s);
    const [q, face] = closestTri(proj, a, b, c);
    if (!face && len(sub(q, proj)) > 1e-4) continue;
    push(out, madd(v, tn, -s / 2), mul(tn, -1), -s);
    found = true;
  }
  if (!found) {
    const [q] = closestTri(bc, a, b, c);
    push(out, q, bestN, bestD, true);
  }
}

/** Shape A (non-mesh) vs static TriMesh B. */
function vsMesh(A: Body, B: Body, tri: TriMesh, out: CP[]) {
  const bax = axes(B.rotation), bc = B.position;
  const sa = A.shape;
  // A in mesh-local space
  const lc = toLocal(A.position as unknown as V, bc, bax);
  const qa = localRot(A.rotation, B.rotation);
  const la = axes(qa);
  const ext = sa.type === 'sphere' ? [sa.radius, sa.radius, sa.radius]
    : sa.type === 'capsule' ? [0, 1, 2].map((i) => Math.abs(la[1][i]) * sa.half + sa.radius)
      : sa.type === 'box' ? [0, 1, 2].map((i) => Math.abs(la[0][i]) * sa.half[0] + Math.abs(la[1][i]) * sa.half[1] + Math.abs(la[2][i]) * sa.half[2]) : [0, 0, 0];
  const mn = [lc[0] - ext[0] - MARGIN, lc[1] - ext[1] - MARGIN, lc[2] - ext[2] - MARGIN];
  const mx = [lc[0] + ext[0] + MARGIN, lc[1] + ext[1] + MARGIN, lc[2] + ext[2] + MARGIN];
  const tmp: CP[] = [];
  const v = tri.v;
  tri.query(mn, mx, (t) => {
    const a = [v[tri.t[t * 3] * 3], v[tri.t[t * 3] * 3 + 1], v[tri.t[t * 3] * 3 + 2]];
    const b = [v[tri.t[t * 3 + 1] * 3], v[tri.t[t * 3 + 1] * 3 + 1], v[tri.t[t * 3 + 1] * 3 + 2]];
    const c = [v[tri.t[t * 3 + 2] * 3], v[tri.t[t * 3 + 2] * 3 + 1], v[tri.t[t * 3 + 2] * 3 + 2]];
    const tn = [tri.n[t * 3], tri.n[t * 3 + 1], tri.n[t * 3 + 2]];
    if (sa.type === 'sphere') sphereTri(lc, sa.radius, a, b, c, tn, tmp);
    else if (sa.type === 'capsule') {
      const s0 = madd(lc, la[1], -sa.half), s1 = madd(lc, la[1], sa.half);
      const f = (k: number) => { const p = lerp3(s0, s1, k); return len(sub(closestTri(p, a, b, c)[0], p)); };
      const start = tmp.length;
      for (const k of [0, 1, minimize(f)]) {
        const one: CP[] = [];
        sphereTri(lerp3(s0, s1, k), sa.radius, a, b, c, tn, one);
        for (const cp of one) {
          let dup = false;
          for (let i = start; i < tmp.length; i++) if (len(sub(tmp[i].p, cp.p)) < 0.05) { dup = true; if (cp.d > tmp[i].d) tmp[i] = cp; }
          if (!dup) tmp.push(cp);
        }
      }
    } else if (sa.type === 'box') boxTri(lc, la, sa.half, a, b, c, tn, tmp);
  });
  // ghost-edge filter: drop edge contacts that agree with a face contact
  for (const c of tmp) {
    if (c.e && tmp.some((f) => !f.e && dot(f.n, c.n) > 0.9)) continue;
    push(out, toWorld(c.p, bc, bax), toWorldDir(c.n, bax), c.d);
  }
}

function localRot(q: ArrayLike<number>, parent: ArrayLike<number>) {
  // conj(parent) * q
  const x = -parent[0], y = -parent[1], z = -parent[2], w = parent[3];
  return [
    x * q[3] + w * q[0] + y * q[2] - z * q[1],
    y * q[3] + w * q[1] + z * q[0] - x * q[2],
    z * q[3] + w * q[2] + x * q[1] - y * q[0],
    w * q[3] - x * q[0] - y * q[1] - z * q[2],
  ];
}

// ---------------------------------------------------------------- dispatch

const ORDER = { sphere: 0, capsule: 1, box: 2, plane: 3, mesh: 4 };

/** Generate contacts between A and B (normals A->B). Returns false if the pair type is unsupported. */
export function collide(A: Body, B: Body, out: CP[]): void {
  if (ORDER[A.shape.type] > ORDER[B.shape.type]) {
    const start = out.length;
    collide(B, A, out);
    for (let i = start; i < out.length; i++) { const n = out[i].n; n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; }
    return;
  }
  const sa = A.shape, sb = B.shape;
  const ca = A.position as unknown as V, cb = B.position as unknown as V;
  switch (sa.type) {
    case 'sphere':
      switch (sb.type) {
        case 'sphere': return sphereSphere(ca, sa.radius, cb, sb.radius, out, MARGIN);
        case 'capsule': {
          const [s0, s1] = capsuleSeg(B);
          const q = lerp3(s0, s1, closestSegT(ca, s0, s1));
          return sphereSphere(ca, sa.radius, q, sb.radius, out, MARGIN);
        }
        case 'box': return sphereBox(ca, sa.radius, cb, axes(B.rotation), sb.half, out);
        case 'plane': { const n = axes(B.rotation)[1]; return spherePlane(ca, sa.radius, n, dot(n, cb), out); }
        case 'mesh': return vsMesh(A, B, sb.tri, out);
      }
      return;
    case 'capsule': {
      const [a0, a1] = capsuleSeg(A);
      switch (sb.type) {
        case 'capsule': {
          const [b0, b1] = capsuleSeg(B);
          const [s, t] = segSeg(a0, a1, b0, b1);
          sphereSphere(lerp3(a0, a1, s), sa.radius, lerp3(b0, b1, t), sb.radius, out, MARGIN);
          const da = sub(a1, a0), db = sub(b1, b0);
          const la = len(da), lb = len(db);
          if (la > 1e-6 && lb > 1e-6 && Math.abs(dot(da, db)) / (la * lb) > 0.98) {
            for (const e of [a0, a1]) {
              const tmp: CP[] = [];
              sphereSphere(e, sa.radius, lerp3(b0, b1, closestSegT(e, b0, b1)), sb.radius, tmp, MARGIN);
              for (const c of tmp) if (!out.some((o) => len(sub(o.p, c.p)) < 0.05)) out.push(c);
            }
          }
          return;
        }
        case 'box': return capsuleBox(a0, a1, sa.radius, cb, axes(B.rotation), sb.half, out);
        case 'plane': {
          const n = axes(B.rotation)[1], d = dot(n, cb);
          spherePlane(a0, sa.radius, n, d, out);
          spherePlane(a1, sa.radius, n, d, out);
          return;
        }
        case 'mesh': return vsMesh(A, B, sb.tri, out);
      }
      return;
    }
    case 'box':
      switch (sb.type) {
        case 'box': return boxBox(ca, axes(A.rotation), sa.half, cb, axes(B.rotation), sb.half, out);
        case 'plane': { const n = axes(B.rotation)[1]; return boxPlane(ca, axes(A.rotation), sa.half, n, dot(n, cb), out, false); }
        case 'mesh': return vsMesh(A, B, sb.tri, out);
      }
      return;
  }
}

/** World AABB of a body into b.aabb. */
export function computeAABB(b: Body) {
  const s = b.shape, p = b.position, o = b.aabb;
  let ex: number[];
  switch (s.type) {
    case 'sphere': ex = [s.radius, s.radius, s.radius]; break;
    case 'capsule': { const up = axes(b.rotation)[1]; ex = [0, 1, 2].map((i) => Math.abs(up[i]) * s.half + s.radius); break; }
    case 'box': { const a = axes(b.rotation); ex = [0, 1, 2].map((i) => Math.abs(a[0][i]) * s.half[0] + Math.abs(a[1][i]) * s.half[1] + Math.abs(a[2][i]) * s.half[2]); break; }
    case 'mesh': {
      const a = axes(b.rotation), t = s.tri;
      const c = [(t.min[0] + t.max[0]) / 2, (t.min[1] + t.max[1]) / 2, (t.min[2] + t.max[2]) / 2];
      const h = [(t.max[0] - t.min[0]) / 2, (t.max[1] - t.min[1]) / 2, (t.max[2] - t.min[2]) / 2];
      const wc = toWorld(c, p, a);
      for (let i = 0; i < 3; i++) {
        const e = Math.abs(a[0][i]) * h[0] + Math.abs(a[1][i]) * h[1] + Math.abs(a[2][i]) * h[2];
        o[i] = wc[i] - e; o[i + 3] = wc[i] + e;
      }
      return;
    }
    default: o[0] = o[1] = o[2] = -Infinity; o[3] = o[4] = o[5] = Infinity; return;
  }
  for (let i = 0; i < 3; i++) { o[i] = p[i] - ex[i]; o[i + 3] = p[i] + ex[i]; }
}
