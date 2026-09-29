import { v3, type V3, type Vec3 } from '../core/math';
import type { Node } from '../scene/node';
import { Body } from './body';
import { capsuleShape } from './shapes';
import type { PhysicsWorld } from './world';

export interface ControllerOptions {
  /** capsule radius (default 0.35) */
  radius?: number;
  /** total height, feet to head (default 1.8) */
  height?: number;
  /** max climbable step (default 0.35) */
  stepHeight?: number;
  /** max walkable slope in degrees (default 50) */
  maxSlope?: number;
  /** gravity multiplier (default 2 — snappier than real gravity) */
  gravityScale?: number;
  /** push force applied to dynamic bodies (default 2) */
  pushPower?: number;
  layer?: number;
  mask?: number;
}

/**
 * Kinematic capsule character: collide-and-slide, stairs, slopes, ground snapping, jumping,
 * pushes dynamic bodies. The node's origin is at the feet.
 *
 *   const ctrl = new CharacterController(world, hero);
 *   game.onUpdate(() => { ctrl.move(vx, vz); if (jumpPressed) ctrl.jump(6); });
 */
export class CharacterController {
  body: Body;
  /** current velocity (y includes gravity/jump) */
  velocity = v3();
  grounded = false;
  groundNormal = v3(0, 1, 0);
  /** ground body under the feet (moving platforms are followed) */
  ground: Body | null = null;
  radius: number;
  height: number;
  stepHeight: number;
  maxSlope: number;
  gravityScale: number;
  pushPower: number;
  enabled = true;
  /** called when landing with the impact speed */
  onLand?: (speed: number) => void;
  private _desired = [0, 0];
  private _jumpV = 0;
  private _cosSlope: number;
  private _off: () => void;
  private _airTime = 0;

  constructor(public world: PhysicsWorld, public node: Node, o: ControllerOptions = {}) {
    this.radius = o.radius ?? 0.35;
    this.height = Math.max(o.height ?? 1.8, this.radius * 2);
    this.stepHeight = o.stepHeight ?? 0.35;
    this.maxSlope = o.maxSlope ?? 50;
    this._cosSlope = Math.cos((this.maxSlope * Math.PI) / 180);
    this.gravityScale = o.gravityScale ?? 2;
    this.pushPower = o.pushPower ?? 2;
    this.body = new Body({
      type: 'kinematic', shape: capsuleShape(this.radius, this.height / 2 - this.radius), layer: o.layer, mask: o.mask,
      position: [node.position[0], node.position[1] + this.height / 2, node.position[2]],
    });
    this.body.data.controller = this;
    this.body.integrate = false;
    world.addBody(this.body);
    this._off = world.onPreStep((dt) => this._step(dt));
  }

  /** Desired horizontal velocity (world units/s). Call every frame. */
  move(vx: number, vz: number) { this._desired[0] = vx; this._desired[1] = vz; }
  /** Jump with upward speed if grounded (or within coyote time). Returns true if jumped. */
  jump(speed = 6) {
    if (!this.grounded && this._airTime > 0.12) return false;
    this._jumpV = speed;
    return true;
  }
  /** Move instantly to a feet position. */
  teleport(p: V3) {
    this.node.position.set(p);
    this.body.teleport([p[0], p[1] + this.height / 2, p[2]]);
    this.velocity.fill(0);
  }
  destroy() { this._off(); this.world.remove(this.body); }

  private _step(dt: number) {
    if (!this.enabled) return;
    const b = this.body, v = this.velocity, g = this.world.gravity;
    const start = v3(b.position[0], b.position[1], b.position[2]);
    // follow moving ground
    if (this.grounded && this.ground && this.ground.type === 'kinematic') {
      for (let i = 0; i < 3; i++) b.position[i] += this.ground.velocity[i] * dt;
    }
    v[0] = this._desired[0];
    v[2] = this._desired[1];
    if (this._jumpV) { v[1] = this._jumpV; this._jumpV = 0; this.grounded = false; this._airTime = 1; }
    else if (this.grounded) v[1] = Math.min(v[1], 0);
    for (let i = 0; i < 3; i++) v[i] += g[i] * this.gravityScale * dt * (i === 1 ? 1 : 0);
    if (v[1] < -50) v[1] = -50;
    const wasGrounded = this.grounded;
    const fallSpeed = -v[1];
    this.grounded = false;
    this.ground = null;

    // horizontal move (low obstacles are climbed), then vertical move
    this._slide([v[0] * dt, 0, v[2] * dt], false, wasGrounded || this._airTime < 0.2);
    this._slide([0, v[1] * dt, 0], true);
    // ground snap (walking down slopes/stairs)
    if (!this.grounded && wasGrounded && v[1] <= 0) {
      const before = v3(b.position[0], b.position[1], b.position[2]);
      this._slide([0, -this.stepHeight, 0], true);
      if (!this.grounded) b.position.set(before);
    }
    if (this.grounded) {
      if (!wasGrounded && fallSpeed > 1) this.onLand?.(fallSpeed);
      v[1] = 0;
      this._airTime = 0;
    } else this._airTime += dt;
    // kinematic velocity so dynamic bodies get pushed correctly
    for (let i = 0; i < 3; i++) b.velocity[i] = (b.position[i] - start[i]) / dt;
    b.prevPos.set(start);
    this.node.position[0] = b.position[0];
    this.node.position[1] = b.position[1] - this.height / 2;
    this.node.position[2] = b.position[2];
  }

  /** Move by delta in small sub-steps, resolving penetrations. */
  private _slide(delta: number[], vertical: boolean, canStep = false) {
    const b = this.body, v = this.velocity;
    const feet = () => b.position[1] - this.height / 2;
    const dist = Math.hypot(delta[0], delta[1], delta[2]);
    const n = Math.max(1, Math.ceil(dist / (this.radius * 0.5)));
    for (let s = 0; s < n; s++) {
      for (let i = 0; i < 3; i++) b.position[i] += delta[i] / n;
      for (let it = 0; it < 4; it++) {
        const cs = this.world.contacts(b, { mask: b.mask });
        let moved = false;
        for (const c of cs) {
          if (c.d <= 0.001) continue;
          if (c.body.type === 'dynamic') {
            // push dynamic bodies, don't get blocked much by light ones
            const k = this.pushPower * c.d * 60;
            c.body.applyImpulse([-c.n[0] * k * c.body.mass * 0.1, 0, -c.n[2] * k * c.body.mass * 0.1], c.p);
            if (c.body.mass < 5) continue;
          }
          let nx = c.n[0], ny = c.n[1], nz = c.n[2];
          const walkable = ny > this._cosSlope;
          if (walkable) {
            // walkable: resolve only vertically so we don't slide on slopes or get pushed off ledges
            b.position[1] += c.d / ny;
            this.grounded = true;
            this.ground = c.body;
            this.groundNormal.set([nx, ny, nz]);
          } else if ((canStep || vertical) && ny > 0.02 && c.p[1] - feet() < (vertical ? this.radius : this.stepHeight)) {
            // low edge (stair step): climb it / stand on it instead of being blocked
            b.position[1] += Math.min(c.d / ny, this.stepHeight);
            if (vertical) { this.grounded = true; this.ground = c.body; this.groundNormal.set([0, 1, 0]); }
          } else {
            // walls / steep slopes: push out horizontally-ish
            if (ny < 0 && v[1] > 0 && vertical) v[1] = 0; // head bump
            if (!vertical && ny > 0) { const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l; ny = 0; }
            b.position[0] += nx * c.d; b.position[1] += ny * c.d; b.position[2] += nz * c.d;
          }
          moved = true;
        }
        if (!moved) break;
      }
    }
  }
}

export type { Vec3 };
