import { Mesh } from '../scene/mesh';
import type { Node } from '../scene/node';
import { Geometry } from '../geometry/geometry';
import { Material } from '../materials/material';
import { color, type ColorLike } from '../core/math';

export interface TrailOptions {
  /** number of stored points (default 32) */
  length?: number;
  /** ribbon width at the head (default 0.3) */
  width?: number;
  /** minimum distance between points (default 0.1) */
  minDistance?: number;
  /** seconds a point lives (default 0.5) */
  time?: number;
  color?: ColorLike;
  /** color at the tail (default = color) */
  endColor?: ColorLike;
  blend?: 'add' | 'alpha';
  intensity?: number;
  /** clear the trail if the target jumps farther than this in one frame (teleport) */
  maxJump?: number;
}

/**
 * Camera-facing ribbon that follows a target node (sword swings, dashes, projectiles).
 * Add to the scene (not as a child of the target): `scene.add(new Trail(sword, camera))`.
 */
export class Trail extends Mesh {
  o: Required<TrailOptions>;
  private pts: { p: number[]; t: number }[] = [];
  private c0: Float32Array;
  private c1: Float32Array;
  private time = 0;
  emitting = true;

  constructor(public target: Node, public camera: Node, opts: TrailOptions = {}) {
    const o = { length: 32, width: 0.3, minDistance: 0.1, time: 0.5, color: 0xffffff, endColor: opts.color ?? 0xffffff, blend: 'add', intensity: 1, maxJump: 3, ...opts } as Required<TrailOptions>;
    const g = new Geometry();
    const n = o.length;
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setAttribute('position', new Float32Array(n * 6), 3);
    g.setAttribute('color', new Float32Array(n * 8), 4);
    g.setIndex(idx);
    super(g, new Material({ type: 'unlit', blend: o.blend, depthWrite: false, cull: 'none', castShadow: false, fog: false }), 'trail');
    this.o = o;
    this.c0 = color(o.color);
    this.c1 = color(o.endColor);
    this.material.uniforms[0] = this.material.uniforms[1] = this.material.uniforms[2] = o.intensity;
    this.castShadow = this.receiveShadow = false;
    this.frustumCulled = false;
  }

  clear() { this.pts.length = 0; }

  override onUpdate(dt: number) {
    this.time += dt;
    const o = this.o, pts = this.pts;
    const p = this.target.worldPosition();
    let last = pts[0];
    if (last && Math.hypot(p[0] - last.p[0], p[1] - last.p[1], p[2] - last.p[2]) > o.maxJump) { pts.length = 0; last = undefined as any; }
    if (this.emitting && (!last || Math.hypot(p[0] - last.p[0], p[1] - last.p[1], p[2] - last.p[2]) > o.minDistance)) {
      pts.unshift({ p: [p[0], p[1], p[2]], t: this.time });
      if (pts.length > o.length) pts.pop();
    } else if (last && this.emitting) { last.p = [p[0], p[1], p[2]]; }
    while (pts.length && this.time - pts[pts.length - 1].t > o.time) pts.pop();
    const g = this.geometry;
    const pos = g.attributes.position.data as Float32Array, col = g.attributes.color.data as Float32Array;
    const cam = this.camera.worldPosition();
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)].p, b = pts[Math.min(n - 1, i + 1)].p, c = pts[i].p;
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const vx = cam[0] - c[0], vy = cam[1] - c[1], vz = cam[2] - c[2];
      let sx = dy * vz - dz * vy, sy = dz * vx - dx * vz, sz = dx * vy - dy * vx;
      const l = Math.hypot(sx, sy, sz) || 1;
      const k = 1 - i / Math.max(1, n - 1);
      const age = Math.min(1, (this.time - pts[i].t) / o.time);
      const w = (o.width * k) / 2 / l;
      sx *= w; sy *= w; sz *= w;
      pos.set([c[0] + sx, c[1] + sy, c[2] + sz, c[0] - sx, c[1] - sy, c[2] - sz], i * 6);
      const alpha = k * (1 - age);
      for (let j = 0; j < 2; j++) {
        const q = i * 8 + j * 4;
        for (let ch = 0; ch < 3; ch++) col[q + ch] = this.c0[ch] + (this.c1[ch] - this.c0[ch]) * (1 - k);
        col[q + 3] = alpha;
      }
    }
    g.drawCount = Math.max(0, (n - 1) * 6);
    g.update('position');
    g.update('color');
  }
}
