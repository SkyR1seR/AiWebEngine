import type { GpuBuffer, VertexFormat } from '../gpu/device';
import type { Defines } from '../gpu/preprocess';

/** Fixed shader locations for vertex attributes. */
export const ATTR_LOC: Record<string, number> = { position: 0, normal: 1, uv: 2, color: 3, joints: 4, weights: 5 };

export interface Attribute {
  data: Float32Array | Uint8Array;
  size: number;
  format: VertexFormat;
  version: number;
  /** @internal GPU state */
  gpu?: GpuBuffer;
  gpuVersion?: number;
}

export interface Bounds { min: Float32Array; max: Float32Array; center: Float32Array; radius: number }

let geomId = 0;

/** Vertex data. Attributes are stored non-interleaved (one buffer each). */
export class Geometry {
  readonly id = geomId++;
  attributes: Record<string, Attribute> = {};
  index: Uint16Array | Uint32Array | null = null;
  indexVersion = 0;
  topology: 'triangles' | 'lines' = 'triangles';
  /** Limit number of vertices/indices drawn (-1 = all). */
  drawCount = -1;
  bounds: Bounds = { min: new Float32Array(3), max: new Float32Array(3), center: new Float32Array(3), radius: 0 };
  /** @internal */ gpuIndex?: GpuBuffer;
  /** @internal */ gpuIndexVersion = -1;

  setAttribute(name: string, data: Float32Array | Uint8Array | number[], size: number) {
    const arr = Array.isArray(data) ? new Float32Array(data) : data;
    const format: VertexFormat = arr instanceof Uint8Array ? 'unorm8x4' : size === 1 ? 'float32' : (`float32x${size}` as VertexFormat);
    const old = this.attributes[name];
    this.attributes[name] = { data: arr, size, format, version: (old?.version ?? 0) + 1, gpu: old?.gpu, gpuVersion: old?.gpuVersion };
    if (name === 'position') this.computeBounds();
    return this;
  }
  setIndex(data: Uint16Array | Uint32Array | number[]) {
    this.index = Array.isArray(data) ? (data.some((v) => v > 65535) ?new Uint32Array(data) : new Uint16Array(data)) : data;
    this.indexVersion++;
    return this;
  }
  /** Mark attribute data as changed (re-upload next frame). */
  update(name: string) {
    const a = this.attributes[name];
    if (a) a.version++;
    if (name === 'position') this.computeBounds();
  }
  get vertexCount() {
    const p = this.attributes.position;
    return p ? p.data.length / p.size : 0;
  }
  get count() {
    const n = this.index ? this.index.length : this.vertexCount;
    return this.drawCount >= 0 ? Math.min(n, this.drawCount) : n;
  }

  computeBounds() {
    const p = this.attributes.position?.data as Float32Array;
    const b = this.bounds;
    if (!p || !p.length) { b.radius = 0; return this; }
    b.min.fill(Infinity);
    b.max.fill(-Infinity);
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = p[i + k];
        if (v < b.min[k]) b.min[k] = v;
        if (v > b.max[k]) b.max[k] = v;
      }
    }
    for (let k = 0; k < 3; k++) b.center[k] = (b.min[k] + b.max[k]) / 2;
    let r = 0;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i] - b.center[0], y = p[i + 1] - b.center[1], z = p[i + 2] - b.center[2];
      r = Math.max(r, x * x + y * y + z * z);
    }
    b.radius = Math.sqrt(r);
    return this;
  }

  /** Smooth vertex normals from triangles. */
  computeNormals() {
    const p = this.attributes.position.data as Float32Array;
    const n = new Float32Array(p.length);
    const idx = this.index;
    const tri = idx ? idx.length : p.length / 3;
    for (let t = 0; t < tri; t += 3) {
      const a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2;
      const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
      const e1x = p[b * 3] - ax, e1y = p[b * 3 + 1] - ay, e1z = p[b * 3 + 2] - az;
      const e2x = p[c * 3] - ax, e2y = p[c * 3 + 1] - ay, e2z = p[c * 3 + 2] - az;
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      for (const v of [a, b, c]) { n[v * 3] += nx; n[v * 3 + 1] += ny; n[v * 3 + 2] += nz; }
    }
    for (let i = 0; i < n.length; i += 3) {
      const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
      n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
    }
    return this.setAttribute('normal', n, 3);
  }

  /** Convert to non-indexed with per-face normals: faceted low-poly look. */
  flatShade() {
    const idx = this.index;
    if (idx) {
      for (const k in this.attributes) {
        const a = this.attributes[k];
        const src = a.data;
        const dst = new (src.constructor as any)(idx.length * a.size);
        for (let i = 0; i < idx.length; i++) for (let c = 0; c < a.size; c++) dst[i * a.size + c] = src[idx[i] * a.size + c];
        this.setAttribute(k, dst, a.size);
      }
      this.index = null;
      this.indexVersion++;
    }
    const p = this.attributes.position.data as Float32Array;
    const n = new Float32Array(p.length);
    for (let i = 0; i < p.length; i += 9) {
      const e1x = p[i + 3] - p[i], e1y = p[i + 4] - p[i + 1], e1z = p[i + 5] - p[i + 2];
      const e2x = p[i + 6] - p[i], e2y = p[i + 7] - p[i + 1], e2z = p[i + 8] - p[i + 2];
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (let v = 0; v < 9; v += 3) { n[i + v] = nx; n[i + v + 1] = ny; n[i + v + 2] = nz; }
    }
    return this.setAttribute('normal', n, 3);
  }

  /** Fill a per-vertex color attribute (sRGB-free: values are linear 0..1). */
  setColor(r: number, g: number, b: number, a = 1) {
    const n = this.vertexCount, c = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { c[i * 4] = r; c[i * 4 + 1] = g; c[i * 4 + 2] = b; c[i * 4 + 3] = a; }
    return this.setAttribute('color', c, 4);
  }

  /** Apply a mat4 to positions and normals in place. */
  transform(m: ArrayLike<number>) {
    const p = this.attributes.position.data as Float32Array;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      p[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
      p[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      p[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
    const nm = this.attributes.normal?.data as Float32Array | undefined;
    if (nm) for (let i = 0; i < nm.length; i += 3) {
      const x = nm[i], y = nm[i + 1], z = nm[i + 2];
      const nx = m[0] * x + m[4] * y + m[8] * z, ny = m[1] * x + m[5] * y + m[9] * z, nz = m[2] * x + m[6] * y + m[10] * z;
      const l = Math.hypot(nx, ny, nz) || 1;
      nm[i] = nx / l; nm[i + 1] = ny / l; nm[i + 2] = nz / l;
    }
    this.update('position');
    this.update('normal');
    return this;
  }

  clone() {
    const g = new Geometry();
    for (const k in this.attributes) g.setAttribute(k, this.attributes[k].data.slice(), this.attributes[k].size);
    if (this.index) g.setIndex(this.index.slice());
    g.topology = this.topology;
    return g;
  }
}

/** Merge geometries (same attribute sets) into one; optional per-part matrices. */
export function mergeGeometries(parts: Geometry[], matrices?: ArrayLike<number>[]) {
  const out = new Geometry();
  const names = Object.keys(parts[0].attributes);
  const total = parts.reduce((s, g) => s + g.vertexCount, 0);
  const idxTotal = parts.reduce((s, g) => s + (g.index ? g.index.length : g.vertexCount), 0);
  const index = total > 65535 ? new Uint32Array(idxTotal) : new Uint16Array(idxTotal);
  const data: Record<string, Float32Array> = {};
  for (const n of names) data[n] = new Float32Array(total * parts[0].attributes[n].size);
  let vo = 0, io = 0;
  parts.forEach((g0, pi) => {
    const g = matrices?.[pi] ? g0.clone().transform(matrices[pi]) : g0;
    for (const n of names) data[n].set(g.attributes[n].data as Float32Array, vo * g.attributes[n].size);
    const vc = g.vertexCount;
    if (g.index) for (let i = 0; i < g.index.length; i++) index[io++] = g.index[i] + vo;
    else for (let i = 0; i < vc; i++) index[io++] = i + vo;
    vo += vc;
  });
  for (const n of names) out.setAttribute(n, data[n], parts[0].attributes[n].size);
  out.setIndex(index);
  return out;
}

/** Per-instance vertex data (interleaved floats). */
export class InstanceBuffer {
  data: Float32Array;
  count = 0;
  version = 0;
  stride: number;
  /** @internal */ gpu?: GpuBuffer;
  /** @internal */ gpuVersion = -1;
  /** @internal */ gpuSize = 0;
  constructor(public max: number, public attrs: { loc: number; size: number }[], public defines: Defines = {}) {
    this.stride = attrs.reduce((s, a) => s + a.size, 0);
    this.data = new Float32Array(max * this.stride);
  }
  update() { this.version++; }
}

/** Instanced transforms (+ optional per-instance color) for drawing many copies of a mesh in one call. */
export class Instances extends InstanceBuffer {
  constructor(max: number, withColor = false) {
    super(max, withColor ? [{ loc: 6, size: 16 }, { loc: 10, size: 4 }] : [{ loc: 6, size: 16 }],
      withColor ? { INSTANCED: 1, INSTANCE_COLOR: 1 } : { INSTANCED: 1 });
  }
  setMatrix(i: number, m: ArrayLike<number>) {
    const o = i * this.stride;
    for (let k = 0; k < 16; k++) this.data[o + k] = m[k];
    if (i >= this.count) this.count = i + 1;
    this.version++;
  }
  setColor(i: number, c: ArrayLike<number>) {
    const o = i * this.stride + 16;
    this.data[o] = c[0]; this.data[o + 1] = c[1]; this.data[o + 2] = c[2]; this.data[o + 3] = c.length > 3 ? c[3] : 1;
    this.version++;
  }
}
