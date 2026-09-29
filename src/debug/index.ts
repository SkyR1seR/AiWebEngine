import type { Game, System } from '../core/game';
import { Mesh } from '../scene/mesh';
import { Geometry } from '../geometry/geometry';
import { Material } from '../materials/material';
import { color, type ColorLike, type V3 } from '../core/math';
import type { PhysicsWorld } from '../physics/world';
import type { Body } from '../physics/body';
import { axes } from '../physics/collide';

/** Immediate-mode debug lines (cleared every frame). */
export class DebugDraw implements System {
  mesh: Mesh;
  private pos: number[] = [];
  private col: number[] = [];
  private c = new Float32Array(4);
  /** physics world to visualize (bodies + contacts) */
  physics: PhysicsWorld | null = null;
  showContacts = true;

  constructor(public game: Game) {
    const g = new Geometry();
    g.topology = 'lines';
    this.mesh = new Mesh(g, new Material({ type: 'unlit', fog: false, cull: 'none', castShadow: false }), 'debug');
    this.mesh.castShadow = false;
    game.renderer.overlays.push(this.mesh);
    game.addSystem(this);
  }

  line(a: V3, b: V3, c: ColorLike = 0x00ff00) {
    color(c, 1, this.c);
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    this.col.push(...this.c, ...this.c);
  }
  /** Oriented box; rot = quaternion. */
  box(center: V3, half: V3, rot: ArrayLike<number> = [0, 0, 0, 1], c: ColorLike = 0x00ff00) {
    const ax = axes(rot);
    const v = (i: number) => [0, 1, 2].map((k) => center[k] + ax[0][k] * half[0] * (i & 1 ? 1 : -1) + ax[1][k] * half[1] * (i & 2 ? 1 : -1) + ax[2][k] * half[2] * (i & 4 ? 1 : -1));
    for (const [a, b] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) this.line(v(a), v(b), c);
  }
  /** Circle in plane spanned by u,v axes. */
  circle(center: V3, r: number, u: number[] = [1, 0, 0], v: number[] = [0, 0, 1], c: ColorLike = 0x00ff00, seg = 24) {
    let prev: number[] | null = null;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, s = Math.sin(a) * r, co = Math.cos(a) * r;
      const p = [0, 1, 2].map((k) => center[k] + u[k] * co + v[k] * s);
      if (prev) this.line(prev, p, c);
      prev = p;
    }
  }
  sphere(center: V3, r: number, c: ColorLike = 0x00ff00) {
    this.circle(center, r, [1, 0, 0], [0, 0, 1], c);
    this.circle(center, r, [1, 0, 0], [0, 1, 0], c);
    this.circle(center, r, [0, 1, 0], [0, 0, 1], c);
  }
  /** Axis gizmo. */
  axes(p: V3, size = 1) {
    this.line(p, [p[0] + size, p[1], p[2]], 0xff0000);
    this.line(p, [p[0], p[1] + size, p[2]], 0x00ff00);
    this.line(p, [p[0], p[1], p[2] + size], 0x0000ff);
  }
  ray(o: V3, d: V3, len = 10, c: ColorLike = 0xffff00) { this.line(o, [o[0] + d[0] * len, o[1] + d[1] * len, o[2] + d[2] * len], c); }

  body(b: Body) {
    const s = b.shape, p = b.position;
    const c = b.isTrigger ? 0xffaa00 : b.type === 'static' ? 0x888888 : b.sleeping ? 0x3366ff : b.type === 'kinematic' ? 0xff44ff : 0x44ff44;
    const ax = axes(b.rotation);
    switch (s.type) {
      case 'sphere': this.sphere(p, s.radius, c); break;
      case 'box': this.box(p, s.half, b.rotation, c); break;
      case 'capsule': {
        const top = [0, 1, 2].map((k) => p[k] + ax[1][k] * s.half), bot = [0, 1, 2].map((k) => p[k] - ax[1][k] * s.half);
        this.circle(top, s.radius, ax[0], ax[2], c);
        this.circle(bot, s.radius, ax[0], ax[2], c);
        this.circle(top, s.radius, ax[0], ax[1], c, 24);
        this.circle(bot, s.radius, ax[0], ax[1], c, 24);
        for (const a of [ax[0], ax[2]]) for (const sg of [1, -1]) {
          this.line([0, 1, 2].map((k) => top[k] + a[k] * s.radius * sg), [0, 1, 2].map((k) => bot[k] + a[k] * s.radius * sg), c);
        }
        break;
      }
      case 'plane': this.circle(p, 5, ax[0], ax[2], c, 8); break;
      case 'mesh': {
        const t = s.tri;
        const n = Math.min(t.t.length / 3, 3000);
        for (let i = 0; i < n; i++) {
          const v = [0, 1, 2].map((j) => {
            const vi = t.t[i * 3 + j] * 3;
            const l = [t.v[vi], t.v[vi + 1], t.v[vi + 2]];
            return [0, 1, 2].map((k) => p[k] + ax[0][k] * l[0] + ax[1][k] * l[1] + ax[2][k] * l[2]);
          });
          this.line(v[0], v[1], c); this.line(v[1], v[2], c); this.line(v[2], v[0], c);
        }
      }
    }
  }

  preRender() {
    const w = this.physics;
    if (w) {
      for (const b of w.bodies) if (b.enabled) this.body(b);
      if (this.showContacts) for (const m of w.manifolds) for (const p of m.pts) {
        this.line(p.p, [p.p[0] + p.n[0] * 0.3, p.p[1] + p.n[1] * 0.3, p.p[2] + p.n[2] * 0.3], 0xff2222);
      }
    }
    const g = this.mesh.geometry;
    if (this.pos.length) {
      g.setAttribute('position', new Float32Array(this.pos), 3);
      g.setAttribute('color', new Float32Array(this.col), 4);
      g.drawCount = -1;
    } else g.drawCount = 0;
    this.pos.length = 0;
    this.col.length = 0;
  }
}

/** FPS / draw calls / resolution overlay (top-left). Returns the element. */
export function statsOverlay(game: Game) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;right:calc(env(safe-area-inset-right) + 4px);top:calc(env(safe-area-inset-top) + 4px);z-index:99;font:11px/1.35 monospace;color:#fff;background:rgba(0,0,0,.55);padding:4px 6px;border-radius:4px;pointer-events:none;white-space:pre';
  document.body.appendChild(el);
  let t = 0;
  game.onRender((dt) => {
    t += dt;
    if (t < 0.25) return;
    t = 0;
    const s = game.renderer.stats, sc = game.screen;
    el.textContent = `${game.time.fps.toFixed(0)} fps  ${game.device.kind}\n${s.draws} draws  ${(s.triangles / 1000).toFixed(1)}k tris\n${sc.pixelWidth}x${sc.pixelHeight} @${(sc.dpr * sc.scale).toFixed(2)}x`;
  });
  return el;
}
