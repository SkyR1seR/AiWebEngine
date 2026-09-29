import type { Game } from '../core/game';
import type { Mesh } from '../scene/mesh';
import type { Node } from '../scene/node';
import { color, qeuler, qmul, qconj, quat, type ColorLike } from '../core/math';
import { tween, tweens } from '../anim/tween';

/**
 * Trauma-based camera shake. `shake.add(0.5)` on hits/explosions. Works with any camera script.
 */
export class CameraShake {
  trauma = 0;
  /** trauma lost per second */
  decay = 1.6;
  maxOffset = 0.35;
  maxAngle = 0.06;
  frequency = 22;
  private t = Math.random() * 100;
  private off = [0, 0, 0];
  private q = quat();

  constructor(public game: Game, public camera: Node = game.camera) {
    game.onUpdate(() => this.restore());
    game.onLateUpdate((dt) => this.apply(dt));
  }
  add(amount: number) { this.trauma = Math.min(1, this.trauma + amount); }

  private restore() {
    const c = this.camera;
    for (let i = 0; i < 3; i++) c.position[i] -= this.off[i];
    qmul(c.rotation, c.rotation, qconj(quat(), this.q));
    this.off = [0, 0, 0];
    this.q = quat();
  }
  private apply(dt: number) {
    this.restore();
    this.trauma = Math.max(0, this.trauma - this.decay * dt);
    if (this.trauma <= 0) return;
    this.t += dt * this.frequency;
    const s = this.trauma * this.trauma, t = this.t;
    const n = (k: number) => Math.sin(t * 1.0 + k) * 0.6 + Math.sin(t * 2.3 + k * 3.1) * 0.3 + Math.sin(t * 4.7 + k * 7.3) * 0.1;
    this.off = [n(1) * this.maxOffset * s, n(2) * this.maxOffset * s, n(3) * this.maxOffset * s * 0.5];
    qeuler(this.q, n(4) * this.maxAngle * s, n(5) * this.maxAngle * s, n(6) * this.maxAngle * s);
    const c = this.camera;
    for (let i = 0; i < 3; i++) c.position[i] += this.off[i];
    qmul(c.rotation, c.rotation, this.q);
  }
}

/** Flash a mesh with a color (hit feedback). */
export function flash(mesh: Mesh, c: ColorLike = 0xffffff, duration = 0.12, amount = 0.85) {
  const col = color(c);
  mesh.flash[0] = col[0]; mesh.flash[1] = col[1]; mesh.flash[2] = col[2]; mesh.flash[3] = amount;
  tweens.kill(mesh.flash);
  return tween(mesh.flash, { 3: 0 }, duration, { ease: 'quadIn' });
}

/** Squash & stretch pop (pickups, UI-like feedback on 3D objects). */
export function punchScale(node: Node, amount = 0.25, duration = 0.3) {
  const base = [node.scale[0], node.scale[1], node.scale[2]];
  tweens.kill(node.scale);
  node.scale.set(base.map((v) => v * (1 + amount)));
  return tween(node.scale, base, duration, { ease: 'elasticOut' });
}

/** Temporarily slow down game time (hit-stop / bullet time). */
export async function slowMotion(game: Game, scale = 0.2, duration = 0.3) {
  game.time.scale = scale;
  await new Promise((r) => setTimeout(r, duration * 1000));
  game.time.scale = 1;
}
