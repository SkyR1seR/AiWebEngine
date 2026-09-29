import { Geometry } from './geometry';

function build(p: number[], n: number[], uv: number[], idx: number[]) {
  return new Geometry().setAttribute('position', p, 3).setAttribute('normal', n, 3).setAttribute('uv', uv, 2).setIndex(idx);
}

/** Axis-aligned box centered at origin. */
export function box(w = 1, h = 1, d = 1): Geometry {
  const p: number[] = [], n: number[] = [], uv: number[] = [], idx: number[] = [];
  const x = w / 2, y = h / 2, z = d / 2;
  // [normal, u axis, v axis] per face
  const faces = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  for (const [nn, u, v] of faces) {
    const b = p.length / 3;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      p.push((nn[0] + u[0] * su + v[0] * sv) * x, (nn[1] + u[1] * su + v[1] * sv) * y, (nn[2] + u[2] * su + v[2] * sv) * z);
      n.push(...nn);
      uv.push((su + 1) / 2, (1 - sv) / 2);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return build(p, n, uv, idx);
}

/** Flat plane on XZ facing +Y. */
export function plane(w = 1, d = 1, sx = 1, sz = 1): Geometry {
  const p: number[] = [], n: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= sz; j++) for (let i = 0; i <= sx; i++) {
    p.push((i / sx - 0.5) * w, 0, (j / sz - 0.5) * d);
    n.push(0, 1, 0);
    uv.push(i / sx, j / sz);
  }
  for (let j = 0; j < sz; j++) for (let i = 0; i < sx; i++) {
    const a = j * (sx + 1) + i, b = a + 1, c = a + sx + 1, e = c + 1;
    idx.push(a, c, b, b, c, e);
  }
  return build(p, n, uv, idx);
}

/** Quad on XY facing +Z (sprites, particles, UI in world). */
export function quad(w = 1, h = 1): Geometry {
  const x = w / 2, y = h / 2;
  return build([-x, -y, 0, x, -y, 0, x, y, 0, -x, y, 0], [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], [0, 1, 1, 1, 1, 0, 0, 0], [0, 1, 2, 0, 2, 3]);
}

/** UV sphere. */
export function sphere(r = 0.5, ws = 24, hs = 16): Geometry {
  const p: number[] = [], n: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= hs; j++) {
    const v = j / hs, th = v * Math.PI;
    for (let i = 0; i <= ws; i++) {
      const u = i / ws, ph = u * Math.PI * 2;
      const nx = -Math.cos(ph) * Math.sin(th), ny = Math.cos(th), nz = Math.sin(ph) * Math.sin(th);
      p.push(nx * r, ny * r, nz * r);
      n.push(nx, ny, nz);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < hs; j++) for (let i = 0; i < ws; i++) {
    const a = j * (ws + 1) + i, b = a + ws + 1;
    if (j) idx.push(a, b, a + 1);
    if (j < hs - 1) idx.push(a + 1, b, b + 1);
  }
  return build(p, n, uv, idx);
}

/** Icosphere; detail 0 = icosahedron. Great with flatShade() for low-poly rocks. */
export function icosphere(r = 0.5, detail = 1): Geometry {
  const t = (1 + Math.sqrt(5)) / 2;
  let v: number[][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const norm = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
  v = v.map(norm);
  for (let d = 0; d < detail; d++) {
    const cache = new Map<string, number>();
    const mid = (a: number, b: number) => {
      const k = a < b ? a + '_' + b : b + '_' + a;
      let i = cache.get(k);
      if (i === undefined) { i = v.push(norm([(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2])) - 1; cache.set(k, i); }
      return i;
    };
    const nf: number[][] = [];
    for (const [a, b, c] of f) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    f = nf;
  }
  const p = v.flatMap((q) => [q[0] * r, q[1] * r, q[2] * r]);
  const uv = v.flatMap((q) => [0.5 + Math.atan2(q[2], q[0]) / (2 * Math.PI), 0.5 - Math.asin(q[1]) / Math.PI]);
  return build(p, v.flat(), uv, f.flat());
}

/** Cylinder along Y centered at origin (rTop=0 gives a cone). */
export function cylinder(rTop = 0.5, rBot = 0.5, h = 1, seg = 24, caps = true): Geometry {
  const p: number[] = [], n: number[] = [], uv: number[] = [], idx: number[] = [];
  const slope = (rBot - rTop) / h;
  for (let j = 0; j <= 1; j++) {
    const r = j ? rTop : rBot, y = j ? h / 2 : -h / 2;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
      p.push(r * s, y, r * c);
      const l = Math.hypot(1, slope);
      n.push(s / l, slope / l, c / l);
      uv.push(i / seg, 1 - j);
    }
  }
  for (let i = 0; i < seg; i++) idx.push(i, i + 1, i + seg + 2, i, i + seg + 2, i + seg + 1);
  if (caps) for (const top of [0, 1]) {
    const r = top ? rTop : rBot;
    if (r <= 0) continue;
    const y = top ? h / 2 : -h / 2, ny = top ? 1 : -1, c0 = p.length / 3;
    p.push(0, y, 0); n.push(0, ny, 0); uv.push(0.5, 0.5);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      p.push(r * Math.sin(a), y, r * Math.cos(a)); n.push(0, ny, 0); uv.push(0.5 + Math.sin(a) / 2, 0.5 + Math.cos(a) / 2);
    }
    for (let i = 0; i < seg; i++) top ? idx.push(c0, c0 + 1 + i, c0 + 2 + i) : idx.push(c0, c0 + 2 + i, c0 + 1 + i);
  }
  return build(p, n, uv, idx);
}

export const cone = (r = 0.5, h = 1, seg = 24) => cylinder(0, r, h, seg);

/** Capsule along Y: total height = h + 2r. */
export function capsule(r = 0.5, h = 1, seg = 16, rings = 6): Geometry {
  const p: number[] = [], n: number[] = [], uv: number[] = [], idx: number[] = [];
  const rows = rings * 2 + 2;
  let row = 0;
  const addRing = (phi: number, yOff: number) => {
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const nx = Math.sin(phi) * Math.sin(a), ny = Math.cos(phi), nz = Math.sin(phi) * Math.cos(a);
      p.push(nx * r, ny * r + yOff, nz * r); n.push(nx, ny, nz); uv.push(i / seg, row / (rows - 1));
    }
    row++;
  };
  for (let j = 0; j <= rings; j++) addRing((j / rings) * (Math.PI / 2), h / 2);
  for (let j = 0; j <= rings; j++) addRing(Math.PI / 2 + (j / rings) * (Math.PI / 2), -h / 2);
  for (let j = 0; j < row - 1; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + seg + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return build(p, n, uv, idx);
}

/** Torus in XZ plane. */
export function torus(R = 0.5, r = 0.2, seg = 32, tube = 12): Geometry {
  const p: number[] = [], n: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= tube; j++) for (let i = 0; i <= seg; i++) {
    const u = (i / seg) * Math.PI * 2, v = (j / tube) * Math.PI * 2;
    const cx = Math.cos(u), cz = Math.sin(u);
    const nx = Math.cos(v) * cx, ny = Math.sin(v), nz = Math.cos(v) * cz;
    p.push(R * cx + r * nx, r * ny, R * cz + r * nz); n.push(nx, ny, nz); uv.push(i / seg, j / tube);
  }
  for (let j = 0; j < tube; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + seg + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return build(p, n, uv, idx);
}
