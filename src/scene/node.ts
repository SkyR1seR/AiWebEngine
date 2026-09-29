import {
  m4, m4compose, m4mul, m4copy, m4targetTo, m4invert, m4decompose, qeuler, qfromMat4, v3, quat,
  v3transformMat4, v3transformDir, v3normalize, v3set, v3copy, qmul, qconj, type Vec3, type V3, type Mat4,
} from '../core/math';

export interface Script {
  start?(node: Node): void;
  update?(dt: number, node: Node): void;
  destroy?(node: Node): void;
}

const _m = m4();

/** Transform hierarchy node. Forward = -Z (like cameras); +Y up. */
export class Node {
  name: string;
  parent: Node | null = null;
  children: Node[] = [];
  position = v3();
  rotation = quat();
  scale = v3(1, 1, 1);
  /** Local matrix (composed from TRS each frame unless matrixAuto=false). */
  matrix = m4();
  worldMatrix = m4();
  matrixAuto = true;
  visible = true;
  /** Free-form data for game logic. */
  data: Record<string, any> = {};
  scripts: Script[] = [];
  private _started?: boolean;

  constructor(name = '') {
    this.name = name;
  }

  add<T extends Node>(child: T): T {
    child.parent?.remove(child);
    child.parent = this;
    this.children.push(child);
    return child;
  }
  remove(child: Node) {
    const i = this.children.indexOf(child);
    if (i >= 0) { this.children.splice(i, 1); child.parent = null; }
    return child;
  }
  /** Detach from parent and call script destroy hooks (recursively). */
  destroy() {
    this.parent?.remove(this);
    this.traverse((n) => { for (const s of n.scripts) s.destroy?.(n); });
  }

  setPosition(x: number, y: number, z: number) { v3set(this.position, x, y, z); return this; }
  /** Euler angles in radians (Y->X->Z order). */
  setRotation(x: number, y: number, z: number) { qeuler(this.rotation, x, y, z); return this; }
  setScale(x: number, y = x, z = x) { v3set(this.scale, x, y, z); return this; }

  /** Rotate so -Z points at target (world space). Pass modelForwardZ=true for glTF models that face +Z. */
  lookAt(target: V3, modelForwardZ = false, up: V3 = [0, 1, 0]) {
    this.updateWorld();
    const p = this.worldPosition();
    if (modelForwardZ) m4targetTo(_m, target, p, up);
    else m4targetTo(_m, p, target, up);
    qfromMat4(this.rotation, _m);
    if (this.parent) {
      // local = inverse(parentWorldRot) * worldRot
      const pq = quat();
      m4decompose(this.parent.worldMatrix, v3(), pq, v3());
      qmul(this.rotation, qconj(pq, pq), this.rotation);
    }
    return this;
  }

  worldPosition(out: Vec3 = v3()) {
    const m = this.worldMatrix;
    return v3set(out, m[12], m[13], m[14]);
  }
  /** World-space direction of local -Z. */
  forward(out: Vec3 = v3()) { return v3normalize(out, v3transformDir(out, [0, 0, -1], this.worldMatrix)); }
  right(out: Vec3 = v3()) { return v3normalize(out, v3transformDir(out, [1, 0, 0], this.worldMatrix)); }
  up(out: Vec3 = v3()) { return v3normalize(out, v3transformDir(out, [0, 1, 0], this.worldMatrix)); }
  localToWorld(p: V3, out: Vec3 = v3()) { return v3transformMat4(out, p, this.worldMatrix); }
  worldToLocal(p: V3, out: Vec3 = v3()) { return v3transformMat4(out, p, m4invert(_m, this.worldMatrix)); }

  /** Set world position (handles parent transforms). */
  setWorldPosition(p: V3) {
    if (this.parent) v3transformMat4(this.position, p, m4invert(_m, this.parent.worldMatrix));
    else v3copy(this.position, p);
    return this;
  }

  /** Recompute world matrix of this node from ancestors' current world matrices. */
  updateWorld() {
    if (this.matrixAuto) m4compose(this.matrix, this.position, this.rotation, this.scale);
    if (this.parent) m4mul(this.worldMatrix, this.parent.worldMatrix, this.matrix);
    else m4copy(this.worldMatrix, this.matrix);
  }

  /** Recursively update world matrices. */
  updateMatrices(parentWorld?: Mat4) {
    if (this.matrixAuto) m4compose(this.matrix, this.position, this.rotation, this.scale);
    if (parentWorld) m4mul(this.worldMatrix, parentWorld, this.matrix);
    else m4copy(this.worldMatrix, this.matrix);
    const c = this.children;
    for (let i = 0; i < c.length; i++) c[i].updateMatrices(this.worldMatrix);
  }

  /** Run scripts recursively. */
  updateScripts(dt: number) {
    const s = this.scripts;
    for (let i = 0; i < s.length; i++) {
      const sc = s[i];
      if (!this._started) sc.start?.(this);
      sc.update?.(dt, this);
    }
    this._started = true;
    this.onUpdate?.(dt);
    const c = this.children;
    for (let i = 0; i < c.length; i++) c[i].updateScripts(dt);
  }

  /** Optional per-frame hook (override or assign). */
  onUpdate?(dt: number): void;

  addScript(s: Script | ((dt: number, node: Node) => void)) {
    const sc = typeof s === 'function' ? { update: s } : s;
    this.scripts.push(sc);
    if (this._started) sc.start?.(this);
    return sc;
  }
  removeScript(s: Script) {
    const i = this.scripts.indexOf(s);
    if (i >= 0) this.scripts.splice(i, 1);
  }

  traverse(fn: (n: Node) => void | boolean) {
    if (fn(this) === false) return;
    for (let i = 0; i < this.children.length; i++) this.children[i].traverse(fn);
  }
  find(name: string): Node | undefined {
    let r: Node | undefined;
    this.traverse((n) => { if (!r && n.name === name) r = n; return !r; });
    return r;
  }
  findAll(pred: (n: Node) => boolean): Node[] {
    const r: Node[] = [];
    this.traverse((n) => { if (pred(n)) r.push(n); });
    return r;
  }

  /** Deep clone. Meshes share geometry/material. */
  clone(): this {
    const n = new (this.constructor as any)() as this;
    n.copyFrom(this);
    for (const c of this.children) n.add(c.clone());
    return n;
  }
  protected copyFrom(src: Node) {
    this.name = src.name;
    this.position.set(src.position);
    this.rotation.set(src.rotation);
    this.scale.set(src.scale);
    this.matrix.set(src.matrix);
    this.matrixAuto = src.matrixAuto;
    this.visible = src.visible;
    this.data = { ...src.data };
  }
}
