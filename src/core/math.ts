// Minimal gl-matrix style math. Output-first functions on Float32Array; inputs accept any ArrayLike.
export type Vec3 = Float32Array;
export type Vec4 = Float32Array;
export type Quat = Float32Array;
export type Mat4 = Float32Array;
export type V3 = ArrayLike<number>;
export type V4 = ArrayLike<number>;

export const DEG = Math.PI / 180;
export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential smoothing factor. */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));
export const pick = <T>(arr: readonly T[]): T => arr[(Math.random() * arr.length) | 0];

// ---------------- vec3 ----------------
export const v3 = (x = 0, y = 0, z = 0): Vec3 => {
  const o = new Float32Array(3);
  o[0] = x; o[1] = y; o[2] = z;
  return o;
};
export function v3set(o: Vec3, x: number, y: number, z: number) { o[0] = x; o[1] = y; o[2] = z; return o; }
export function v3copy(o: Vec3, a: V3) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; }
export function v3add(o: Vec3, a: V3, b: V3) { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; }
export function v3sub(o: Vec3, a: V3, b: V3) { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; }
export function v3mul(o: Vec3, a: V3, b: V3) { o[0] = a[0] * b[0]; o[1] = a[1] * b[1]; o[2] = a[2] * b[2]; return o; }
export function v3scale(o: Vec3, a: V3, s: number) { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; }
/** o = a + b * s */
export function v3addScaled(o: Vec3, a: V3, b: V3, s: number) { o[0] = a[0] + b[0] * s; o[1] = a[1] + b[1] * s; o[2] = a[2] + b[2] * s; return o; }
export const v3dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function v3cross(o: Vec3, a: V3, b: V3) {
  const ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2];
  o[0] = ay * bz - az * by; o[1] = az * bx - ax * bz; o[2] = ax * by - ay * bx;
  return o;
}
export const v3lenSq = (a: V3) => a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
export const v3len = (a: V3) => Math.sqrt(v3lenSq(a));
export const v3distSq = (a: V3, b: V3) => { const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return x * x + y * y + z * z; };
export const v3dist = (a: V3, b: V3) => Math.sqrt(v3distSq(a, b));
export function v3normalize(o: Vec3, a: V3) {
  const l = v3len(a);
  return v3scale(o, a, l > 1e-12 ? 1 / l : 0);
}
export function v3lerp(o: Vec3, a: V3, b: V3, t: number) {
  o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t;
  return o;
}
export function v3negate(o: Vec3, a: V3) { o[0] = -a[0]; o[1] = -a[1]; o[2] = -a[2]; return o; }
export function v3min(o: Vec3, a: V3, b: V3) { o[0] = Math.min(a[0], b[0]); o[1] = Math.min(a[1], b[1]); o[2] = Math.min(a[2], b[2]); return o; }
export function v3max(o: Vec3, a: V3, b: V3) { o[0] = Math.max(a[0], b[0]); o[1] = Math.max(a[1], b[1]); o[2] = Math.max(a[2], b[2]); return o; }
/** Transform point by mat4 (w=1, with perspective divide). */
export function v3transformMat4(o: Vec3, a: V3, m: ArrayLike<number>) {
  const x = a[0], y = a[1], z = a[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  o[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
  o[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
  o[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
  return o;
}
/** Transform direction by mat4 upper 3x3. */
export function v3transformDir(o: Vec3, a: V3, m: ArrayLike<number>) {
  const x = a[0], y = a[1], z = a[2];
  o[0] = m[0] * x + m[4] * y + m[8] * z;
  o[1] = m[1] * x + m[5] * y + m[9] * z;
  o[2] = m[2] * x + m[6] * y + m[10] * z;
  return o;
}
export function v3transformQuat(o: Vec3, a: V3, q: V4) {
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3], x = a[0], y = a[1], z = a[2];
  const uvx = qy * z - qz * y, uvy = qz * x - qx * z, uvz = qx * y - qy * x;
  const uuvx = qy * uvz - qz * uvy, uuvy = qz * uvx - qx * uvz, uuvz = qx * uvy - qy * uvx;
  o[0] = x + 2 * (qw * uvx + uuvx); o[1] = y + 2 * (qw * uvy + uuvy); o[2] = z + 2 * (qw * uvz + uuvz);
  return o;
}

// ---------------- quat ----------------
export const quat = (x = 0, y = 0, z = 0, w = 1): Quat => {
  const o = new Float32Array(4);
  o[0] = x; o[1] = y; o[2] = z; o[3] = w;
  return o;
};
export function qidentity(o: Quat) { o[0] = o[1] = o[2] = 0; o[3] = 1; return o; }
export function qcopy(o: Quat, a: V4) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; o[3] = a[3]; return o; }
export function qaxisAngle(o: Quat, axis: V3, rad: number) {
  const s = Math.sin(rad / 2);
  o[0] = axis[0] * s; o[1] = axis[1] * s; o[2] = axis[2] * s; o[3] = Math.cos(rad / 2);
  return o;
}
export function qmul(o: Quat, a: V4, b: V4) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3];
  o[0] = ax * bw + aw * bx + ay * bz - az * by;
  o[1] = ay * bw + aw * by + az * bx - ax * bz;
  o[2] = az * bw + aw * bz + ax * by - ay * bx;
  o[3] = aw * bw - ax * bx - ay * by - az * bz;
  return o;
}
export function qconj(o: Quat, a: V4) { o[0] = -a[0]; o[1] = -a[1]; o[2] = -a[2]; o[3] = a[3]; return o; }
export const qdot = (a: V4, b: V4) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
export function qnormalize(o: Quat, a: V4) {
  const l = Math.hypot(a[0], a[1], a[2], a[3]) || 1;
  o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l; o[3] = a[3] / l;
  return o;
}
export function qslerp(o: Quat, a: V4, b: V4, t: number) {
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let c = qdot(a, b);
  if (c < 0) { c = -c; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let s0 = 1 - t, s1 = t;
  if (c < 0.9995) {
    const om = Math.acos(c), so = Math.sin(om);
    s0 = Math.sin((1 - t) * om) / so;
    s1 = Math.sin(t * om) / so;
  }
  o[0] = s0 * a[0] + s1 * bx; o[1] = s0 * a[1] + s1 * by; o[2] = s0 * a[2] + s1 * bz; o[3] = s0 * a[3] + s1 * bw;
  return qnormalize(o, o);
}
/** Euler angles (radians), applied in Y (yaw) -> X (pitch) -> Z (roll) order. */
export function qeuler(o: Quat, x: number, y: number, z: number) {
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2), cy = Math.cos(y / 2), sy = Math.sin(y / 2), cz = Math.cos(z / 2), sz = Math.sin(z / 2);
  o[0] = sx * cy * cz + cx * sy * sz;
  o[1] = cx * sy * cz - sx * cy * sz;
  o[2] = cx * cy * sz - sx * sy * cz;
  o[3] = cx * cy * cz + sx * sy * sz;
  return o;
}
const _qt = new Float32Array(4);
export function qrotateX(o: Quat, a: V4, rad: number) { return qmul(o, a, qaxisAngle(_qt, [1, 0, 0], rad)); }
export function qrotateY(o: Quat, a: V4, rad: number) { return qmul(o, a, qaxisAngle(_qt, [0, 1, 0], rad)); }
export function qrotateZ(o: Quat, a: V4, rad: number) { return qmul(o, a, qaxisAngle(_qt, [0, 0, 1], rad)); }
/** Rotation mapping unit vector a onto unit vector b. */
export function qfromTo(o: Quat, a: V3, b: V3) {
  const d = v3dot(a, b);
  if (d < -0.999999) {
    const ax = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const c = v3normalize(v3(), v3cross(v3(), ax, a));
    return qaxisAngle(o, c, Math.PI);
  }
  o[0] = a[1] * b[2] - a[2] * b[1];
  o[1] = a[2] * b[0] - a[0] * b[2];
  o[2] = a[0] * b[1] - a[1] * b[0];
  o[3] = 1 + d;
  return qnormalize(o, o);
}
/** Rotation whose -Z axis looks along `dir` (object "forward" = -Z like cameras). */
export function qlookDir(o: Quat, dir: V3, up: V3 = UP) {
  return qfromMat4(o, m4targetTo(_m, ZERO, dir, up));
}
export const UP: V3 = [0, 1, 0];
const ZERO: V3 = [0, 0, 0];
export function qfromMat4(o: Quat, m: ArrayLike<number>) {
  const m00 = m[0], m11 = m[5], m22 = m[10], tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    o[3] = 0.25 / s; o[0] = (m[6] - m[9]) * s; o[1] = (m[8] - m[2]) * s; o[2] = (m[1] - m[4]) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    o[3] = (m[6] - m[9]) / s; o[0] = 0.25 * s; o[1] = (m[4] + m[1]) / s; o[2] = (m[8] + m[2]) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    o[3] = (m[8] - m[2]) / s; o[0] = (m[4] + m[1]) / s; o[1] = 0.25 * s; o[2] = (m[9] + m[6]) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    o[3] = (m[1] - m[4]) / s; o[0] = (m[8] + m[2]) / s; o[1] = (m[9] + m[6]) / s; o[2] = 0.25 * s;
  }
  return qnormalize(o, o);
}

// ---------------- mat4 (column-major) ----------------
export const m4 = (): Mat4 => m4identity(new Float32Array(16));
const _m = new Float32Array(16);
export function m4identity(o: Mat4) {
  o.fill(0);
  o[0] = o[5] = o[10] = o[15] = 1;
  return o;
}
export function m4copy(o: Mat4, a: ArrayLike<number>) { for (let i = 0; i < 16; i++) o[i] = a[i]; return o; }
export function m4mul(o: Mat4, a: ArrayLike<number>, b: ArrayLike<number>) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let i = 0; i < 16; i += 4) {
    const b0 = b[i], b1 = b[i + 1], b2 = b[i + 2], b3 = b[i + 3];
    o[i] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    o[i + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    o[i + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    o[i + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
  return o;
}
export function m4invert(o: Mat4, a: ArrayLike<number>) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return m4identity(o);
  det = 1 / det;
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return o;
}
export function m4transpose(o: Mat4, a: ArrayLike<number>) {
  if (o === a) {
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) { const t = o[i * 4 + j]; o[i * 4 + j] = o[j * 4 + i]; o[j * 4 + i] = t; }
    return o;
  }
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) o[i * 4 + j] = a[j * 4 + i];
  return o;
}
/** Inverse-transpose of the model matrix (for normals). */
export function m4normal(o: Mat4, a: ArrayLike<number>) {
  m4transpose(o, m4invert(o, a));
  o[3] = o[7] = o[11] = o[12] = o[13] = o[14] = 0;
  o[15] = 1;
  return o;
}
export function m4compose(o: Mat4, t: V3, q: V4, s: V3) {
  const x = q[0], y = q[1], z = q[2], w = q[3], x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  const sx = s[0], sy = s[1], sz = s[2];
  o[0] = (1 - (yy + zz)) * sx; o[1] = (xy + wz) * sx; o[2] = (xz - wy) * sx; o[3] = 0;
  o[4] = (xy - wz) * sy; o[5] = (1 - (xx + zz)) * sy; o[6] = (yz + wx) * sy; o[7] = 0;
  o[8] = (xz + wy) * sz; o[9] = (yz - wx) * sz; o[10] = (1 - (xx + yy)) * sz; o[11] = 0;
  o[12] = t[0]; o[13] = t[1]; o[14] = t[2]; o[15] = 1;
  return o;
}
export function m4decompose(m: ArrayLike<number>, t: Vec3, q: Quat, s: Vec3) {
  t[0] = m[12]; t[1] = m[13]; t[2] = m[14];
  let sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]), sz = Math.hypot(m[8], m[9], m[10]);
  // negative determinant -> flip x
  const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
  if (det < 0) sx = -sx;
  s[0] = sx; s[1] = sy; s[2] = sz;
  for (let i = 0; i < 3; i++) { _m[i] = m[i] / sx; _m[4 + i] = m[4 + i] / sy; _m[8 + i] = m[8 + i] / sz; }
  qfromMat4(q, _m);
}
/** Perspective projection with WebGPU depth range [0,1]. */
export function m4perspective(o: Mat4, fovy: number, aspect: number, near: number, far: number) {
  const f = 1 / Math.tan(fovy / 2);
  o.fill(0);
  o[0] = f / aspect; o[5] = f; o[11] = -1;
  const nf = 1 / (near - far);
  o[10] = far * nf; o[14] = far * near * nf;
  return o;
}
/** Orthographic projection with depth range [0,1]. */
export function m4ortho(o: Mat4, l: number, r: number, b: number, t: number, n: number, f: number) {
  o.fill(0);
  const lr = 1 / (l - r), bt = 1 / (b - t), nf = 1 / (n - f);
  o[0] = -2 * lr; o[5] = -2 * bt; o[10] = nf; o[15] = 1;
  o[12] = (l + r) * lr; o[13] = (t + b) * bt; o[14] = n * nf;
  return o;
}
/** Object matrix at `eye` whose -Z points to `target`. */
export function m4targetTo(o: Mat4, eye: V3, target: V3, up: V3 = [0, 1, 0]) {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let l = zx * zx + zy * zy + zz * zz;
  if (l > 0) { l = 1 / Math.sqrt(l); zx *= l; zy *= l; zz *= l; } else zz = 1;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = xx * xx + xy * xy + xz * xz;
  if (l < 1e-10) { // up parallel to forward
    const u = Math.abs(zy) > 0.99 ? [0, 0, 1] : [0, 1, 0];
    xx = u[1] * zz - u[2] * zy; xy = u[2] * zx - u[0] * zz; xz = u[0] * zy - u[1] * zx;
    l = xx * xx + xy * xy + xz * xz;
  }
  l = 1 / Math.sqrt(l); xx *= l; xy *= l; xz *= l;
  o[0] = xx; o[1] = xy; o[2] = xz; o[3] = 0;
  o[4] = zy * xz - zz * xy; o[5] = zz * xx - zx * xz; o[6] = zx * xy - zy * xx; o[7] = 0;
  o[8] = zx; o[9] = zy; o[10] = zz; o[11] = 0;
  o[12] = eye[0]; o[13] = eye[1]; o[14] = eye[2]; o[15] = 1;
  return o;
}

/** Extract 6 normalized frustum planes (a,b,c,d) from a view-projection matrix (depth [0,1]). */
export function frustumPlanes(out: Float32Array, m: ArrayLike<number>) {
  const r = (i: number, a: number, b: number, c: number, d: number) => {
    const l = Math.hypot(a, b, c) || 1;
    out[i] = a / l; out[i + 1] = b / l; out[i + 2] = c / l; out[i + 3] = d / l;
  };
  r(0, m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]);
  r(4, m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
  r(8, m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]);
  r(12, m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
  r(16, m[2], m[6], m[10], m[14]);
  r(20, m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);
  return out;
}
export function sphereInFrustum(planes: Float32Array, c: V3, r: number) {
  for (let i = 0; i < 24; i += 4) if (planes[i] * c[0] + planes[i + 1] * c[1] + planes[i + 2] * c[2] + planes[i + 3] < -r) return false;
  return true;
}

// ---------------- color ----------------
export type ColorLike = number | string | ArrayLike<number>;
const s2l = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
/** Parse sRGB color (0xRRGGBB, '#rrggbb', [r,g,b(,a)] in 0..1) into linear RGBA. */
export function color(c: ColorLike, alpha = 1, out: Float32Array = new Float32Array(4)): Float32Array {
  if (typeof c === 'string') c = parseInt(c.replace('#', ''), 16);
  if (typeof c === 'number') {
    out[0] = s2l(((c >> 16) & 255) / 255); out[1] = s2l(((c >> 8) & 255) / 255); out[2] = s2l((c & 255) / 255); out[3] = alpha;
  } else {
    out[0] = s2l(c[0]); out[1] = s2l(c[1]); out[2] = s2l(c[2]); out[3] = c.length > 3 ? c[3] : alpha;
  }
  return out;
}
