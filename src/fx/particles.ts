import { Mesh } from '../scene/mesh';
import type { Node } from '../scene/node';
import { InstanceBuffer } from '../geometry/geometry';
import { quad } from '../geometry/primitives';
import { Material } from '../materials/material';
import { softDot, type Texture } from '../render/texture';
import { color, type ColorLike, type V3 } from '../core/math';

type Range = number | [number, number];

export interface ParticleOptions {
  /** max live particles (default 256) */
  max?: number;
  /** continuous emission per second (default 0 = bursts only) */
  rate?: number;
  /** stop continuous emission after this many seconds (default Infinity) */
  duration?: number;
  lifetime?: Range;
  speed?: Range;
  /** emission shape (default 'point') */
  shape?: 'point' | 'sphere' | 'cone' | 'box' | 'ring';
  /** sphere/ring radius or cone base radius (default 0) */
  radius?: number;
  /** cone half-angle in radians (default 0.5) */
  angle?: number;
  /** box half extents */
  box?: V3;
  /** main direction (default up) */
  direction?: V3;
  gravity?: V3;
  /** velocity damping per second */
  drag?: number;
  /** start/end size (or constant) */
  size?: Range;
  /** random size multiplier range (default [1,1]) */
  sizeRandom?: [number, number];
  /** colors over lifetime (sRGB); a single color = constant */
  color?: ColorLike | ColorLike[];
  /** alpha over lifetime (default [1, 0]) */
  alpha?: number | number[];
  /** pick a random color from the list per particle instead of a gradient */
  randomColor?: boolean;
  /** initial rotation range (radians) */
  rotation?: Range;
  /** spin speed range (rad/s) */
  spin?: Range;
  blend?: 'add' | 'alpha';
  texture?: Texture;
  /** sprite sheet: frames play over lifetime (or random frame) */
  sheet?: { cols: number; rows: number; random?: boolean };
  /** particles stay where emitted when the emitter moves (default true) */
  worldSpace?: boolean;
  /** start emitting immediately (default true) */
  autoplay?: boolean;
  /** brightness multiplier (HDR, for bloom) */
  intensity?: number;
}

let defaultTex: Texture | null = null;
const r = (v: Range) => (typeof v === 'number' ? v : v[0] + Math.random() * (v[1] - v[0]));

/**
 * CPU-simulated, GPU-instanced billboard particles.
 *   const fire = scene.add(new Particles(presets.fire()));
 *   sparks.emit(30);
 */
export class Particles extends Mesh {
  o: Required<Omit<ParticleOptions, 'texture' | 'sheet' | 'box'>> & Pick<ParticleOptions, 'texture' | 'sheet' | 'box'>;
  emitting: boolean;
  /** remove from scene when finished and empty */
  autoRemove = false;
  private n = 0;
  private acc = 0;
  private age = 0;
  // SoA particle state
  private p: Float32Array;
  private v: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private rot: Float32Array;
  private spinV: Float32Array;
  private seed: Float32Array;
  private grad: Float32Array[];
  private alphas: number[];
  private ib: InstanceBuffer;

  constructor(opts: ParticleOptions = {}) {
    const o = {
      max: 256, rate: 0, duration: Infinity, lifetime: 1, speed: 2, shape: 'point', radius: 0, angle: 0.5,
      direction: [0, 1, 0], gravity: [0, 0, 0], drag: 0, size: 0.3, sizeRandom: [1, 1], color: 0xffffff, alpha: [1, 0],
      randomColor: false, rotation: [0, Math.PI * 2], spin: 0, blend: 'add', worldSpace: true, autoplay: true, intensity: 1,
      ...opts,
    } as Particles['o'];
    const ib = new InstanceBuffer(o.max, [{ loc: 6, size: 4 }, { loc: 7, size: 4 }, { loc: 8, size: 4 }]);
    defaultTex ??= softDot(64);
    const mat = new Material({
      type: 'unlit', shader: 'particles', blend: o.blend, depthWrite: false, castShadow: false, receiveShadow: false,
      map: o.texture ?? defaultTex, cull: 'none', defines: o.worldSpace ? {} : { LOCAL_SPACE: 1 },
    });
    mat.uniforms[0] = mat.uniforms[1] = mat.uniforms[2] = o.intensity;
    mat.uniforms[8] = o.sheet?.cols ?? 1;
    mat.uniforms[9] = o.sheet?.rows ?? 1;
    super(quad(1, 1), mat, 'particles');
    this.o = o;
    this.ib = ib;
    this.instances = ib;
    this.castShadow = false;
    this.receiveShadow = false;
    this.frustumCulled = false;
    const m = o.max;
    this.p = new Float32Array(m * 3);
    this.v = new Float32Array(m * 3);
    this.life = new Float32Array(m);
    this.maxLife = new Float32Array(m);
    this.size = new Float32Array(m);
    this.rot = new Float32Array(m);
    this.spinV = new Float32Array(m);
    this.seed = new Float32Array(m);
    const cols = Array.isArray(o.color) ? o.color : [o.color];
    this.grad = cols.map((c) => color(c as ColorLike));
    this.alphas = Array.isArray(o.alpha) ? o.alpha : [o.alpha];
    this.emitting = o.autoplay && o.rate > 0;
  }

  get alive() { return this.n; }
  play() { this.emitting = true; this.age = 0; return this; }
  stop() { this.emitting = false; return this; }
  clear() { this.n = 0; this.ib.count = 0; this.ib.update(); return this; }

  /** Emit a burst of n particles (optionally at a world position). */
  emit(count: number, at?: V3) {
    const o = this.o;
    const wm = this.worldMatrix;
    const base = at ?? (o.worldSpace ? [wm[12], wm[13], wm[14]] : [0, 0, 0]);
    const dir = o.direction;
    const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const d = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
    // basis around direction
    const t = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(t, d)), w = cross(d, u);
    for (let k = 0; k < count && this.n < o.max; k++) {
      const i = this.n++;
      let px = 0, py = 0, pz = 0, vx = d[0], vy = d[1], vz = d[2];
      switch (o.shape) {
        case 'sphere': {
          const rv = randDir();
          vx = rv[0]; vy = rv[1]; vz = rv[2];
          const rr = o.radius * Math.cbrt(Math.random());
          px = rv[0] * rr; py = rv[1] * rr; pz = rv[2] * rr;
          break;
        }
        case 'cone': {
          const a = Math.random() * Math.PI * 2, c = Math.cos(o.angle), z = c + Math.random() * (1 - c), s = Math.sqrt(1 - z * z);
          const ca = Math.cos(a) * s, sa = Math.sin(a) * s;
          vx = u[0] * ca + w[0] * sa + d[0] * z; vy = u[1] * ca + w[1] * sa + d[1] * z; vz = u[2] * ca + w[2] * sa + d[2] * z;
          const rr = o.radius * Math.sqrt(Math.random());
          px = (u[0] * Math.cos(a) + w[0] * Math.sin(a)) * rr; py = (u[1] * Math.cos(a) + w[1] * Math.sin(a)) * rr; pz = (u[2] * Math.cos(a) + w[2] * Math.sin(a)) * rr;
          break;
        }
        case 'ring': {
          const a = Math.random() * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
          px = (u[0] * ca + w[0] * sa) * o.radius; py = (u[1] * ca + w[1] * sa) * o.radius; pz = (u[2] * ca + w[2] * sa) * o.radius;
          const l = Math.hypot(px, py, pz) || 1;
          vx = px / l; vy = py / l; vz = pz / l;
          break;
        }
        case 'box': {
          const b = o.box ?? [0.5, 0.5, 0.5];
          px = (Math.random() * 2 - 1) * b[0]; py = (Math.random() * 2 - 1) * b[1]; pz = (Math.random() * 2 - 1) * b[2];
          break;
        }
      }
      const sp = r(o.speed);
      this.p[i * 3] = base[0] + px; this.p[i * 3 + 1] = base[1] + py; this.p[i * 3 + 2] = base[2] + pz;
      this.v[i * 3] = vx * sp; this.v[i * 3 + 1] = vy * sp; this.v[i * 3 + 2] = vz * sp;
      this.life[i] = 0;
      this.maxLife[i] = Math.max(0.01, r(o.lifetime));
      this.size[i] = o.sizeRandom[0] + Math.random() * (o.sizeRandom[1] - o.sizeRandom[0]);
      this.rot[i] = r(o.rotation);
      this.spinV[i] = r(o.spin) * (Math.random() < 0.5 ? -1 : 1);
      this.seed[i] = Math.random();
    }
    return this;
  }

  override onUpdate(dt: number) {
    const o = this.o;
    this.age += dt;
    if (this.emitting) {
      if (this.age > o.duration) this.emitting = false;
      else {
        this.acc += o.rate * dt;
        const k = Math.floor(this.acc);
        if (k > 0) { this.acc -= k; this.emit(k); }
      }
    }
    const g = o.gravity, drag = Math.max(0, 1 - o.drag * dt);
    const P = this.p, V = this.v, L = this.life, M = this.maxLife;
    const out = this.ib.data;
    const s0 = typeof o.size === 'number' ? o.size : o.size[0], s1 = typeof o.size === 'number' ? o.size : o.size[1];
    const grad = this.grad, al = this.alphas;
    const frames = o.sheet ? o.sheet.cols * o.sheet.rows : 1;
    let n = this.n;
    for (let i = 0; i < n; i++) {
      L[i] += dt;
      if (L[i] >= M[i]) {
        // swap-remove
        n--;
        this.copy(n, i);
        i--;
        continue;
      }
      const i3 = i * 3;
      V[i3] = (V[i3] + g[0] * dt) * drag; V[i3 + 1] = (V[i3 + 1] + g[1] * dt) * drag; V[i3 + 2] = (V[i3 + 2] + g[2] * dt) * drag;
      P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
      this.rot[i] += this.spinV[i] * dt;
      const t = L[i] / M[i];
      const o12 = i * 12;
      out[o12] = P[i3]; out[o12 + 1] = P[i3 + 1]; out[o12 + 2] = P[i3 + 2];
      out[o12 + 3] = (s0 + (s1 - s0) * t) * this.size[i];
      if (o.randomColor) {
        const c = grad[Math.floor(this.seed[i] * grad.length) % grad.length];
        out[o12 + 4] = c[0]; out[o12 + 5] = c[1]; out[o12 + 6] = c[2];
      } else sampleGrad(grad, t, out, o12 + 4);
      out[o12 + 7] = sampleArr(al, t);
      out[o12 + 8] = this.rot[i];
      out[o12 + 9] = o.sheet?.random ? Math.floor(this.seed[i] * frames) : Math.floor(t * frames);
    }
    this.n = n;
    this.ib.count = n;
    this.ib.update();
    if (this.autoRemove && !this.emitting && n === 0 && this.age > 0.1) (this.parent as Node | null)?.remove(this);
  }

  private copy(from: number, to: number) {
    if (from === to) return;
    for (let k = 0; k < 3; k++) { this.p[to * 3 + k] = this.p[from * 3 + k]; this.v[to * 3 + k] = this.v[from * 3 + k]; }
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.size[to] = this.size[from];
    this.rot[to] = this.rot[from];
    this.spinV[to] = this.spinV[from];
    this.seed[to] = this.seed[from];
  }
}

function sampleGrad(g: Float32Array[], t: number, out: Float32Array, o: number) {
  if (g.length === 1) { out[o] = g[0][0]; out[o + 1] = g[0][1]; out[o + 2] = g[0][2]; return; }
  const f = t * (g.length - 1), i = Math.min(g.length - 2, Math.floor(f)), k = f - i;
  for (let c = 0; c < 3; c++) out[o + c] = g[i][c] + (g[i + 1][c] - g[i][c]) * k;
}
function sampleArr(a: number[], t: number) {
  if (a.length === 1) return a[0];
  const f = t * (a.length - 1), i = Math.min(a.length - 2, Math.floor(f)), k = f - i;
  return a[i] + (a[i + 1] - a[i]) * k;
}
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function randDir() {
  const z = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - z * z);
  return [Math.cos(a) * s, Math.sin(a) * s, z];
}

/** Spawn a one-shot burst into `parent` at a position; removes itself when done. */
export function burst(parent: Node, opts: ParticleOptions, count: number, at: V3) {
  const p = parent.add(new Particles({ ...opts, autoplay: false }));
  p.autoRemove = true;
  p.emit(count, at);
  return p;
}
