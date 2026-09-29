import { v3, quat, type Vec3, type V3 } from '../core/math';
import type { Node } from '../scene/node';
import { unitInertia, type Shape } from './shapes';

export type BodyType = 'dynamic' | 'kinematic' | 'static';

export interface ContactInfo {
  /** world contact point */
  point: Vec3;
  /** normal pointing from this body towards the other */
  normal: Vec3;
  /** approach speed along the normal at first contact (for impact sounds/damage) */
  speed: number;
}

export interface BodyOptions {
  type?: BodyType;
  shape: Shape;
  mass?: number;
  friction?: number;
  restitution?: number;
  linearDamping?: number;
  angularDamping?: number;
  gravityScale?: number;
  /** 0 on an axis locks rotation around it (e.g. [0,1,0] = only yaw; [0,0,0] = no rotation). */
  angularFactor?: V3;
  linearFactor?: V3;
  /** collision layer bits this body is in */
  layer?: number;
  /** which layers this body collides with */
  mask?: number;
  /** sensor: reports overlaps via onTrigger, no collision response */
  isTrigger?: boolean;
  canSleep?: boolean;
  /** shape center offset in body local space (e.g. capsule center above feet) */
  offset?: V3;
  position?: V3;
  rotation?: ArrayLike<number>;
  velocity?: V3;
  /** continuous-ish collision: sub-step fast bodies (default true for spheres) */
  bullet?: boolean;
}

let nextId = 1;

export class Body {
  readonly id = nextId++;
  type: BodyType;
  shape: Shape;
  /** world position of the shape center */
  position = v3();
  rotation = quat();
  velocity = v3();
  angularVelocity = v3();
  force = v3();
  torque = v3();
  mass: number;
  invMass: number;
  invInertia = v3();
  /** world inverse inertia (3x3 column-major) */
  invInertiaWorld = new Float32Array(9);
  friction: number;
  restitution: number;
  linearDamping: number;
  angularDamping: number;
  gravityScale: number;
  angularFactor: Vec3;
  linearFactor: Vec3;
  layer: number;
  mask: number;
  isTrigger: boolean;
  canSleep: boolean;
  sleeping = false;
  sleepTime = 0;
  offset: Vec3;
  node: Node | null = null;
  /** kinematic only: false = position is driven externally (character controllers) */
  integrate = true;
  /** set false to temporarily exclude from simulation */
  enabled = true;
  data: Record<string, any> = {};
  /** @internal */ aabb = new Float32Array(6);
  /** @internal */ prevPos = v3();
  /** @internal */ prevRot = quat();

  /** Called when a contact with another body begins. */
  onCollide?: (other: Body, info: ContactInfo) => void;
  /** Called when a contact ends. */
  onCollideEnd?: (other: Body) => void;
  /** Called when this trigger (or another trigger) starts/stops overlapping. */
  onTrigger?: (other: Body, state: 'enter' | 'exit') => void;

  constructor(o: BodyOptions) {
    this.type = o.type ?? 'dynamic';
    this.shape = o.shape;
    if ((o.shape.type === 'plane' || o.shape.type === 'mesh') && this.type === 'dynamic') this.type = 'static';
    this.mass = o.mass ?? 1;
    this.friction = o.friction ?? 0.5;
    this.restitution = o.restitution ?? 0.1;
    this.linearDamping = o.linearDamping ?? 0.05;
    this.angularDamping = o.angularDamping ?? 0.1;
    this.gravityScale = o.gravityScale ?? 1;
    this.angularFactor = v3(...((o.angularFactor ?? [1, 1, 1]) as [number, number, number]));
    this.linearFactor = v3(...((o.linearFactor ?? [1, 1, 1]) as [number, number, number]));
    this.layer = o.layer ?? 1;
    this.mask = o.mask ?? 0xffffffff;
    this.isTrigger = o.isTrigger ?? false;
    this.canSleep = o.canSleep ?? true;
    this.offset = v3(...((o.offset ?? [0, 0, 0]) as [number, number, number]));
    if (o.position) this.position.set(o.position);
    if (o.rotation) this.rotation.set(o.rotation);
    if (o.velocity) this.velocity.set(o.velocity);
    this.invMass = 0;
    this.setMass(this.mass);
  }

  get isDynamic() { return this.type === 'dynamic'; }

  setMass(m: number) {
    this.mass = m;
    if (this.type !== 'dynamic' || m <= 0) { this.invMass = 0; this.invInertia.fill(0); return; }
    this.invMass = 1 / m;
    const I = unitInertia(this.shape);
    for (let i = 0; i < 3; i++) this.invInertia[i] = 1 / (I[i] * m) * this.angularFactor[i];
  }

  wake() { this.sleeping = false; this.sleepTime = 0; }

  /** Instant velocity change at a world point (default: center of mass). */
  applyImpulse(imp: V3, point?: V3) {
    if (this.invMass === 0) return;
    this.wake();
    const lf = this.linearFactor;
    for (let i = 0; i < 3; i++) this.velocity[i] += imp[i] * this.invMass * lf[i];
    if (point) {
      const rx = point[0] - this.position[0], ry = point[1] - this.position[1], rz = point[2] - this.position[2];
      const tx = ry * imp[2] - rz * imp[1], ty = rz * imp[0] - rx * imp[2], tz = rx * imp[1] - ry * imp[0];
      this.applyAngularImpulse([tx, ty, tz]);
    }
  }
  applyAngularImpulse(t: V3) {
    const I = this.invInertiaWorld, w = this.angularVelocity;
    w[0] += I[0] * t[0] + I[3] * t[1] + I[6] * t[2];
    w[1] += I[1] * t[0] + I[4] * t[1] + I[7] * t[2];
    w[2] += I[2] * t[0] + I[5] * t[1] + I[8] * t[2];
    this.wake();
  }
  /** Continuous force for this step (cleared after each step). */
  applyForce(f: V3, point?: V3) {
    this.wake();
    for (let i = 0; i < 3; i++) this.force[i] += f[i];
    if (point) {
      const rx = point[0] - this.position[0], ry = point[1] - this.position[1], rz = point[2] - this.position[2];
      this.torque[0] += ry * f[2] - rz * f[1];
      this.torque[1] += rz * f[0] - rx * f[2];
      this.torque[2] += rx * f[1] - ry * f[0];
    }
  }
  setVelocity(x: number, y: number, z: number) { this.velocity[0] = x; this.velocity[1] = y; this.velocity[2] = z; this.wake(); return this; }
  /** Move instantly (no interpolation / no tunneling checks). */
  teleport(pos: V3, rot?: ArrayLike<number>) {
    this.position.set(pos);
    this.prevPos.set(pos);
    if (rot) { this.rotation.set(rot); this.prevRot.set(rot); }
    this.wake();
  }

  /** @internal */
  updateInertiaWorld() {
    const q = this.rotation, x = q[0], y = q[1], z = q[2], w = q[3];
    const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - z * w), r02 = 2 * (x * z + y * w);
    const r10 = 2 * (x * y + z * w), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - x * w);
    const r20 = 2 * (x * z - y * w), r21 = 2 * (y * z + x * w), r22 = 1 - 2 * (x * x + y * y);
    const a = this.invInertia[0], b = this.invInertia[1], c = this.invInertia[2];
    const I = this.invInertiaWorld;
    // I = R * diag * R^T (column-major)
    I[0] = r00 * r00 * a + r01 * r01 * b + r02 * r02 * c;
    I[1] = r10 * r00 * a + r11 * r01 * b + r12 * r02 * c;
    I[2] = r20 * r00 * a + r21 * r01 * b + r22 * r02 * c;
    I[3] = I[1];
    I[4] = r10 * r10 * a + r11 * r11 * b + r12 * r12 * c;
    I[5] = r20 * r10 * a + r21 * r11 * b + r22 * r12 * c;
    I[6] = I[2];
    I[7] = I[5];
    I[8] = r20 * r20 * a + r21 * r21 * b + r22 * r22 * c;
  }
}
