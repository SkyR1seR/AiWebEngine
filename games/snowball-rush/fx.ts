// Pixel particles and festive effects (owner: world).
// Every burst kind is ONE pooled Particles system per parent node (square "pixel" sprites, no spin), so effects cost one
// draw call per kind no matter how many bursts are alive, and nothing is allocated per burst.
import { Texture, after, type Game, type Node, type V3 } from 'aiwebengine';
import { Particles, type ParticleOptions } from 'aiwebengine/fx';

export type BurstKind =
  | 'snow' | 'ice' | 'wood' | 'fire' | 'steam' | 'coin' | 'gem' | 'confetti' | 'splash' | 'spark' | 'gift'
  // extras: boost streak squares, smoke puff (vanish), firework shells (3 color sets)
  | 'boost' | 'puff' | 'fw0' | 'fw1' | 'fw2';

let square: Texture | null = null;
/** hard-edged white square sprite (pixel particles) */
function sq(): Texture {
  return (square ??= Texture.fromPixels(new Uint8Array(4 * 4 * 4).fill(255), 4, 4, { filter: 'nearest', mips: false }));
}

type Def = ParticleOptions & { n: number };
/** per kind: particle options + default count (sizes in meters, before `scale`) */
function def(kind: BurstKind): Def {
  switch (kind) {
    case 'snow': return { n: 14, lifetime: [0.45, 0.85], speed: [1.6, 4.2], shape: 'cone', angle: 0.95, size: [0.16, 0.07], color: [0xffffff, 0xe3eefa, 0xc9dcf0], randomColor: true, alpha: [1, 1, 0], gravity: [0, -13, 0], drag: 1.2, blend: 'alpha' };
    case 'ice': return { n: 18, lifetime: [0.5, 0.95], speed: [2.5, 6], shape: 'sphere', radius: 0.3, size: [0.2, 0.08], color: [0xeafcff, 0xa8ecff, 0x6fcff4], randomColor: true, alpha: [1, 1, 0], gravity: [0, -15, 0], drag: 1, blend: 'alpha' };
    case 'wood': return { n: 12, lifetime: [0.5, 0.9], speed: [2, 5], shape: 'sphere', radius: 0.2, size: [0.15, 0.07], color: [0x8a5a32, 0x6b4426, 0xb07a44], randomColor: true, alpha: [1, 1, 0], gravity: [0, -14, 0], drag: 1, blend: 'alpha' };
    case 'fire': return { n: 6, lifetime: [0.35, 0.75], speed: [0.6, 1.5], shape: 'cone', angle: 0.35, radius: 0.35, size: [0.2, 0.05], color: [0xfff1a0, 0xffa22a, 0xe0401a], alpha: [1, 1, 0], gravity: [0, 2.5, 0], drag: 0.8, intensity: 1.8 };
    case 'steam': return { n: 6, lifetime: [0.7, 1.3], speed: [0.5, 1.4], shape: 'cone', angle: 0.6, radius: 0.25, size: [0.14, 0.34], color: [0xffffff, 0xdfe8f2], alpha: [0.75, 0.45, 0], gravity: [0, 1.6, 0], drag: 1.5, blend: 'alpha' };
    case 'coin': return { n: 10, lifetime: [0.3, 0.6], speed: [1.8, 4], shape: 'sphere', radius: 0.1, size: [0.14, 0.03], color: [0xfff6b0, 0xffd447, 0xf0a020], randomColor: true, alpha: [1, 1, 0], drag: 2.5, intensity: 1.6 };
    case 'gem': return { n: 18, lifetime: [0.4, 0.9], speed: [1, 3.5], shape: 'sphere', radius: 0.15, size: [0.13, 0.02], color: [0xffffff, 0xff7ae6, 0x7ae8ff], randomColor: true, alpha: [1, 1, 0], gravity: [0, 1, 0], drag: 2, intensity: 2.2 };
    case 'confetti': return { n: 40, lifetime: [1.2, 2.2], speed: [4, 8], shape: 'cone', angle: 0.7, size: 0.13, sizeRandom: [0.7, 1.3], color: [0xff4d6d, 0xffd23f, 0x3bceac, 0x4d96ff, 0xb15cff, 0xffffff], randomColor: true, alpha: [1, 1, 1, 0], gravity: [0, -7, 0], drag: 1.8, blend: 'alpha' };
    case 'splash': return { n: 24, lifetime: [0.4, 0.8], speed: [2.5, 5.5], shape: 'cone', angle: 0.5, radius: 0.4, size: [0.17, 0.07], color: [0xe6f6ff, 0x7cc4ec, 0x3a86c8], randomColor: true, alpha: [1, 1, 0], gravity: [0, -14, 0], drag: 0.6, blend: 'alpha' };
    case 'spark': return { n: 12, lifetime: [0.25, 0.55], speed: [3, 7], shape: 'sphere', size: [0.11, 0.02], color: [0xffffff, 0xffe680, 0xffa030], alpha: [1, 1, 0], gravity: [0, -9, 0], drag: 2, intensity: 2.5 };
    case 'gift': return { n: 26, lifetime: [0.5, 1.1], speed: [3, 6.5], shape: 'sphere', radius: 0.3, size: [0.16, 0.06], color: [0xe0303a, 0x2fa84a, 0xffd447, 0x3f8cff, 0xffffff], randomColor: true, alpha: [1, 1, 0], gravity: [0, -11, 0], drag: 1.2, blend: 'alpha' };
    case 'boost': return { n: 3, lifetime: [0.25, 0.45], speed: [0.2, 0.8], shape: 'sphere', radius: 0.35, size: [0.14, 0.02], color: [0xfff4a0, 0xffb030, 0x7ae8ff], randomColor: true, alpha: [1, 0.8, 0], drag: 2, intensity: 2 };
    case 'puff': return { n: 22, lifetime: [0.5, 1], speed: [0.8, 2.6], shape: 'sphere', radius: 0.45, size: [0.24, 0.1], color: [0xffffff, 0xe8f0fa], randomColor: true, alpha: [0.95, 0.7, 0], gravity: [0, 1.2, 0], drag: 2.2, blend: 'alpha' };
    case 'fw0': return fw([0xff4d6d, 0xffd23f, 0xffffff]);
    case 'fw1': return fw([0x4d96ff, 0x7ae8ff, 0xffffff]);
    case 'fw2': return fw([0x3bceac, 0xb15cff, 0xfff1a0]);
  }
}
const fw = (color: number[]): Def => ({
  n: 70, lifetime: [0.9, 1.5], speed: [5, 7.5], shape: 'sphere', size: [0.26, 0.06], color, randomColor: true,
  alpha: [1, 1, 0.8, 0], gravity: [0, -3.2, 0], drag: 1.7, intensity: 2.4,
});

interface Pool { p: Particles; n: number; spd: [number, number]; sr: [number, number]; s0: [number, number] }
const pools = /* @__PURE__ */ new WeakMap<Node, Map<BurstKind, Pool>>();

function pool(parent: Node, kind: BurstKind): Pool {
  let m = pools.get(parent);
  if (!m) pools.set(parent, (m = new Map()));
  let q = m.get(kind);
  if (!q) {
    const d = def(kind), s = d.speed ?? 2;
    const s0: [number, number] = typeof s === 'number' ? [s, s] : [s[0], s[1]];
    const spd: [number, number] = [s0[0], s0[1]], sr: [number, number] = [1, 1];
    // sizeRandom / speed arrays are kept by reference: pixelBurst rescales them in place before each emit
    const p = new Particles({
      max: kind === 'confetti' || kind.startsWith('fw') ? 320 : 220, blend: 'add', ...d, speed: spd, sizeRandom: sr,
      texture: sq(), sheet: undefined, rotation: 0, spin: 0, autoplay: false, worldSpace: true,
    });
    q = { p, n: d.n, spd, sr, s0 };
    m.set(kind, q);
  }
  if (q.p.parent !== parent) parent.add(q.p);
  return q;
}

/** one-shot burst of square pixel particles at world point `at` (count defaults per kind; scale = size & spread) */
export function pixelBurst(parent: Node, kind: BurstKind, at: V3, count?: number, scale = 1): void {
  const q = pool(parent, kind), k = Math.sqrt(Math.max(0.2, scale));
  q.sr[0] = 0.75 * scale; q.sr[1] = 1.25 * scale;
  q.spd[0] = q.s0[0] * k; q.spd[1] = q.s0[1] * k;
  q.p.emit(Math.round(count ?? q.n), at);
}

/** drop the pooled systems of a parent (call before discarding a node tree that received bursts) */
export function clearBursts(parent: Node): void {
  const m = pools.get(parent);
  if (!m) return;
  for (const q of m.values()) parent.remove(q.p);
  pools.delete(parent);
}

/** falling snow around the camera (one particle system; follows the camera by itself after each frame's camera move) */
export class Snowfall {
  private _p: Particles;
  private _game: Game;
  private _off: () => void;
  private _fw = new Float32Array(3);
  private _d = 0;
  /** gravity (kept by reference by the particle system: setWind edits it) */
  private _g = [0.3, -0.5, 0];

  constructor(game: Game, density = 1) {
    this._game = game;
    this._p = game.scene.add(new Particles({
      max: 1100, rate: 0, lifetime: [2.6, 3.6], speed: [0.7, 1.3], shape: 'box', box: [15, 4, 10], direction: [0, -1, 0],
      size: 0.075, sizeRandom: [0.6, 1.45], color: [0xffffff, 0xeaf2ff], randomColor: true, alpha: [0, 0.95, 0.95, 0],
      gravity: this._g, blend: 'alpha', texture: sq(), rotation: 0, spin: 0, autoplay: false, worldSpace: true,
    }));
    this._p.castShadow = false;
    this.setDensity(density);
    this._off = game.onLateUpdate(() => this.update(0));
  }

  get density(): number { return this._d; }
  /** 0 = off, 1 = light snow (~150 flakes/s), 3 = blizzard */
  setDensity(v: number): void {
    this._d = v;
    this._p.o.rate = 150 * v;
    this._p.emitting = v > 0;
  }
  /** sideways wind (m/s²) */
  setWind(x: number): void { this._g[0] = x; }
  /** keep the emitter box in front of the camera (runs automatically after the camera moved) */
  update(dt: number): void {
    void dt;
    const c = this._game.camera, f = c.forward(this._fw), p = this._p.position;
    p[0] = c.position[0] + f[0] * 12;
    p[1] = c.position[1] + 3.5;
    p[2] = c.position[2] + f[2] * 12;
  }
  destroy(): void {
    this._off();
    this._p.parent?.remove(this._p);
  }
}

/** festive firework burst in the sky: a colored shell + a white spark core, a smaller echo shell a moment later */
export function fireworks(parent: Node, at: V3): void {
  const kinds: BurstKind[] = ['fw0', 'fw1', 'fw2'];
  const k = kinds[Math.floor(Math.random() * 3)];
  const p: V3 = [at[0], at[1], at[2]];
  pixelBurst(parent, k, p);
  pixelBurst(parent, 'spark', p, 14, 1.4);
  after(0.35, () => pixelBurst(parent, kinds[(kinds.indexOf(k) + 1) % 3], [p[0], p[1] + 0.6, p[2]], 34, 0.8));
}
