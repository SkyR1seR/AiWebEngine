// Race camera (owner: world): chase cam behind the player, intro flyover, shake.
// DESIGN §1: pos (x*0.6, 4.5 + r*1.2, -(d - 6.5 - r*1.4)), looks at (x*0.8, 0.8, -(d + 7)), FOV 58 (portrait 68).
// Tuned: big balls (r > 0.6) lift the camera more and push the look point ahead so the view passes over the ball;
// narrow screens get a wider FOV and a higher, farther camera so the whole 13 m track width (wall rows!) stays visible.
// Allocation-free per frame: the rotation comes from m4targetTo into a scratch matrix (Node.lookAt allocates).
import { clamp, m4, m4targetTo, qfromMat4, type Camera, type Game, type V3 } from 'aiwebengine';
import type { Racer } from './types';
import type { RaceSim } from './sim';
import type { Env } from './world';

const UP: V3 = [0, 1, 0];
const smooth = (t: number) => t * t * (3 - 2 * t);

export class RaceCamera {
  /** optional: keeps the sun's shadow map centered just ahead of the followed racer */
  env: Env | null = null;
  private _game: Game;
  private _cam: Camera;
  private _m = m4();
  private _pos = new Float32Array(3);
  private _look = new Float32Array(3);
  /** smoothed follow state: lateral x, ball radius, distance, look-ahead x */
  private _x = 0;
  private _r = 0.3;
  private _d = 0;
  private _lx = 0;
  private _trauma = 0;
  private _st = 0;
  private _intro: { t: number; T: number; sim: RaceSim; done: () => void; off: () => void } | null = null;

  constructor(game: Game) {
    this._game = game;
    this._cam = game.camera;
    this._cam.near = 0.2;
    this._cam.far = 260;
  }

  /** 0 = landscape .. 1 = tall portrait */
  private _narrow(): number {
    const s = this._game.screen, a = s.width / Math.max(1, s.height);
    return clamp((1.3 - a) / (1.3 - 0.5), 0, 1);
  }

  /** chase pose for the smoothed state → _pos / _look, returns the FOV */
  private _chase(): number {
    const p = this._narrow(), r = this._r, d = this._d, big = Math.max(0, r - 0.6);
    this._pos[0] = this._x * 0.6;
    this._pos[1] = 4.5 + r * 1.2 + big * 1.3 + 2.6 * p;
    this._pos[2] = -(d - 6.5 - r * 1.4 - big * 0.6 - 2.6 * p);
    this._look[0] = this._x * 0.8 + this._lx;
    this._look[1] = 0.8;
    this._look[2] = -(d + 7 + big * 3.5 + 7 * p);
    return 58 + 14 * p;
  }

  private _snapTo(r: Racer) {
    this._x = r.x;
    this._r = Math.max(0.2, r.size / 10);
    this._d = r.d;
    this._lx = 0;
  }

  /** jump to the chase position of racer r (race start) */
  reset(r: Racer): void {
    this._snapTo(r);
    this._trauma = 0;
    this._apply(this._chase());
  }

  update(r: Racer, dt: number): void {
    if (this._intro) return;
    this._follow(r, dt);
    this._apply(this._chase());
  }

  private _follow(r: Racer, dt: number) {
    const k = (rate: number) => 1 - Math.exp(-rate * dt);
    this._x += (r.x - this._x) * k(4);
    // shattered / smashed / used-up balls change size at once: the camera rises quickly and comes down slowly
    const tr = Math.max(0.2, r.size / 10);
    this._r += (tr - this._r) * k(tr > this._r ? 2.2 : 0.7);
    // follow distance tightly (fast runs), but soften knock-backs and respawn jumps
    const dd = r.d - this._d;
    this._d += Math.abs(dd) > 25 ? dd : dd * k(Math.abs(dd) > 2 ? 4 : 14);
    // slight look-ahead toward where the player is steering
    this._lx += (clamp(r.targetX - r.x, -3, 3) * 0.35 - this._lx) * k(3);
    this.env?.focus(r.x * 0.5, 0, -(r.d + 9));
  }

  /** place the camera at _pos looking at _look (+ shake) */
  private _apply(fov: number) {
    const c = this._cam, dt = this._game.time.dt;
    let sx = 0, sy = 0;
    if (this._trauma > 0) {
      this._trauma = Math.max(0, this._trauma - 1.8 * dt);
      this._st += dt * 24;
      const a = this._trauma * this._trauma * 0.35, t = this._st;
      sx = (Math.sin(t * 1.1) * 0.6 + Math.sin(t * 2.9 + 1) * 0.4) * a;
      sy = (Math.sin(t * 1.7 + 2) * 0.6 + Math.sin(t * 3.7) * 0.4) * a;
    }
    c.position[0] = this._pos[0] + sx;
    c.position[1] = this._pos[1] + sy;
    c.position[2] = this._pos[2];
    this._look[0] += sx * 0.5;
    this._look[1] += sy * 0.5;
    m4targetTo(this._m, c.position, this._look, UP);
    qfromMat4(c.rotation, this._m);
    c.fov = fov;
  }

  /** trauma-style shake (0..1 adds up, decays in ~0.5 s) */
  shake(amount: number): void { this._trauma = Math.min(1, this._trauma + amount); }

  /** true while the intro flyover runs */
  get flying(): boolean { return !!this._intro; }

  /** fly from the finish to the start line over `seconds` (drives itself; update() is ignored meanwhile) */
  intro(sim: RaceSim, seconds: number): Promise<void> {
    this.skip();
    return new Promise((resolve) => {
      const off = this._game.onLateUpdate((dt) => this._introStep(dt));
      this._intro = { t: 0, T: Math.max(0.3, seconds), sim, done: resolve, off };
      this._snapTo(sim.player);
      this._introStep(0);
    });
  }

  /** finish the intro now (tap to skip) */
  skip(): void {
    const it = this._intro;
    if (!it) return;
    this._intro = null;
    it.off();
    this._snapTo(it.sim.player);
    this._apply(this._chase());
    it.done();
  }

  private _introStep(dt: number) {
    const it = this._intro;
    if (!it) return;
    it.t += dt;
    const u = Math.min(1, it.t / it.T), e = smooth(u), L = it.sim.level, p = it.sim.player;
    this._snapTo(p);
    const fov = this._chase();
    // flyover pose: from in front of the finish arch, high up, back along the track to the chase pose
    const fd = L.finishD - 14, pd = -this._pos[2], cd = fd + (pd - fd) * e;
    const hi = 9 + 6 * Math.sin(Math.PI * Math.min(1, e * 1.2));
    const b = smooth(clamp((u - 0.7) / 0.3, 0, 1));
    const fx = Math.sin(e * Math.PI) * 3.5;
    this._pos[0] = fx + (this._pos[0] - fx) * b;
    this._pos[1] = hi + (this._pos[1] - hi) * b;
    this._pos[2] = -cd;
    const lx = this._look[0], ly = this._look[1], lz = this._look[2];
    this._look[0] = lx * b;
    this._look[1] = 1.5 + (ly - 1.5) * b;
    this._look[2] = -(cd + 16) + (lz + (cd + 16)) * b;
    this.env?.focus(0, 0, -(cd + 12));
    this._apply(fov + 6 * (1 - b));
    if (u >= 1) this.skip();
  }
}
