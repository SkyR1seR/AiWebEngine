import type { Game } from '../core/game';
import type { Node, Script } from '../scene/node';
import { clamp, damp, v3, v3lerp, type V3, type Vec3 } from '../core/math';
import type { PhysicsWorld } from '../physics/world';
import type { Body } from '../physics/body';

export interface OrbitOptions {
  target?: V3;
  distance?: number;
  minDistance?: number;
  maxDistance?: number;
  yaw?: number;
  pitch?: number;
  minPitch?: number;
  maxPitch?: number;
  /** radians per pixel */
  sensitivity?: number;
  /** smoothing rate (0 = none) */
  smooth?: number;
  /** auto-rotate speed rad/s */
  autoRotate?: number;
}

/** Orbit camera around a point: drag to rotate, wheel/pinch to zoom. */
export class OrbitControls implements Script {
  target: Vec3;
  distance: number;
  yaw: number;
  pitch: number;
  o: Required<Omit<OrbitOptions, 'target' | 'distance' | 'yaw' | 'pitch'>>;
  private _cy: number;
  private _cp: number;
  private _cd: number;
  private _pinch = 0;

  constructor(public game: Game, o: OrbitOptions = {}) {
    this.target = v3(...((o.target ?? [0, 0, 0]) as [number, number, number]));
    this.distance = this._cd = o.distance ?? 10;
    this.yaw = this._cy = o.yaw ?? 0;
    this.pitch = this._cp = o.pitch ?? 0.5;
    this.o = { minDistance: 2, maxDistance: 100, minPitch: -1.4, maxPitch: 1.4, sensitivity: 0.006, smooth: 12, autoRotate: 0, ...o } as any;
    game.camera.addScript(this);
  }

  update(dt: number, cam: Node) {
    const inp = this.game.input, o = this.o;
    if (inp.touches.size === 2) {
      const [a, b] = [...inp.touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this._pinch) this.distance *= this._pinch / d;
      this._pinch = d;
    } else {
      this._pinch = 0;
      if (inp.pointer.down) {
        this.yaw -= inp.pointer.dx * o.sensitivity;
        this.pitch += inp.pointer.dy * o.sensitivity;
      }
    }
    if (inp.pointer.wheel) this.distance *= Math.pow(1.12, inp.pointer.wheel);
    this.yaw += o.autoRotate * dt;
    this.distance = clamp(this.distance, o.minDistance, o.maxDistance);
    this.pitch = clamp(this.pitch, o.minPitch, o.maxPitch);
    const k = o.smooth ? damp(o.smooth, dt) : 1;
    this._cy += (this.yaw - this._cy) * k;
    this._cp += (this.pitch - this._cp) * k;
    this._cd += (this.distance - this._cd) * k;
    const t = this.target, cp = Math.cos(this._cp);
    cam.setPosition(t[0] + Math.sin(this._cy) * cp * this._cd, t[1] + Math.sin(this._cp) * this._cd, t[2] + Math.cos(this._cy) * cp * this._cd);
    cam.lookAt(t);
  }
}

export interface FollowOptions {
  distance?: number;
  /** height of the look-at point above the target origin */
  lookHeight?: number;
  yaw?: number;
  pitch?: number;
  minPitch?: number;
  maxPitch?: number;
  sensitivity?: number;
  /** position follow smoothing rate */
  smooth?: number;
  /** physics world for camera collision (keeps camera in front of walls) */
  physics?: PhysicsWorld;
  /** bodies to ignore for camera collision (e.g. the player) */
  ignore?: Body[];
  /** rotate with mouse movement when pointer is locked or dragging (default true) */
  mouseLook?: boolean;
  /** on touch devices only drags starting on the right half rotate the camera (default true) */
  touchRightHalf?: boolean;
}

/**
 * Third-person follow camera with orbit input and wall collision.
 * `yaw` can be used to make movement camera-relative:
 *   const fwd = [-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw)]
 */
export class FollowCamera implements Script {
  yaw: number;
  pitch: number;
  distance: number;
  o: FollowOptions;
  private _pos = v3();
  private _look = v3();
  private _cur: number;
  private _dragId = -1;

  constructor(public game: Game, public target: Node, o: FollowOptions = {}) {
    this.o = o;
    this.yaw = o.yaw ?? 0;
    this.pitch = o.pitch ?? 0.35;
    this.distance = this._cur = o.distance ?? 5;
    target.updateWorld();
    target.worldPosition(this._look);
    this._look[1] += o.lookHeight ?? 1.5;
    this._pos.set(this._look);
    game.camera.addScript(this);
    game.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || !(o.touchRightHalf ?? true) || e.offsetX > game.screen.width / 2) this._dragId = e.pointerId;
    });
    const up = (e: PointerEvent) => { if (e.pointerId === this._dragId) this._dragId = -1; };
    game.canvas.addEventListener('pointerup', up);
    game.canvas.addEventListener('pointercancel', up);
    game.canvas.addEventListener('pointermove', (e) => {
      if (!(o.mouseLook ?? true)) return;
      if (e.pointerId === this._dragId || document.pointerLockElement === game.canvas) {
        const s = o.sensitivity ?? 0.005;
        this.yaw -= e.movementX * s;
        this.pitch += e.movementY * s;
      }
    });
  }

  /** Camera-relative movement: converts input (x right, y forward) to world XZ. */
  toWorld(x: number, y: number): [number, number] {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    return [x * c - y * s, -x * s - y * c];
  }

  update(dt: number, cam: Node) {
    const o = this.o, inp = this.game.input;
    const [lx, ly] = inp.look();
    this.yaw -= lx * 3 * dt;
    this.pitch += ly * 2 * dt;
    if (inp.pointer.wheel) this.distance = clamp(this.distance * Math.pow(1.1, inp.pointer.wheel), 1.5, 20);
    this.pitch = clamp(this.pitch, o.minPitch ?? -0.6, o.maxPitch ?? 1.3);
    const t = this.target.worldPosition(v3());
    t[1] += o.lookHeight ?? 1.5;
    v3lerp(this._look, this._look, t, damp(o.smooth ?? 15, dt));
    const cp = Math.cos(this.pitch);
    const dir = [Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp];
    let d = this.distance;
    if (o.physics) {
      const hit = o.physics.raycast(this._look, dir, d + 0.3, { ignore: o.ignore });
      if (hit) d = Math.max(0.5, hit.distance - 0.3);
    }
    // zoom in fast, out smoothly
    this._cur = d < this._cur ? d : this._cur + (d - this._cur) * damp(4, dt);
    for (let i = 0; i < 3; i++) this._pos[i] = this._look[i] + dir[i] * this._cur;
    cam.setPosition(this._pos[0], this._pos[1], this._pos[2]);
    cam.lookAt(this._look);
  }
}
