import { Node } from './node';
import {
  DEG, m4, m4invert, m4mul, m4ortho, m4perspective, frustumPlanes, v3, v3transformMat4, v3normalize, v3sub,
  type V3, type Vec3,
} from '../core/math';

export type CameraFit = 'height' | 'width' | 'contain';

export class Camera extends Node {
  /** Vertical field of view in degrees (at designAspect when fit != 'height'). */
  fov = 60;
  near = 0.1;
  far = 500;
  ortho = false;
  /** Half of the visible height for orthographic cameras. */
  orthoSize = 10;
  /**
   * How the view adapts to aspect ratio:
   * 'height' keeps vertical FOV; 'width' keeps horizontal FOV of designAspect;
   * 'contain' ensures the designAspect frame is always fully visible (good for portrait/landscape adaptivity).
   */
  fit: CameraFit = 'height';
  designAspect = 16 / 9;
  aspect = 1;

  view = m4();
  proj = m4();
  viewProj = m4();
  invViewProj = m4();
  planes = new Float32Array(24);

  constructor(o: Partial<Pick<Camera, 'fov' | 'near' | 'far' | 'ortho' | 'orthoSize' | 'fit' | 'designAspect'>> = {}) {
    super('camera');
    Object.assign(this, o);
  }

  /** Effective vertical FOV (radians) for the current aspect. */
  get vfov() {
    const f = this.fov * DEG;
    const widthFit = this.fit === 'width' || (this.fit === 'contain' && this.aspect < this.designAspect);
    if (!widthFit) return f;
    const hf = 2 * Math.atan(Math.tan(f / 2) * this.designAspect);
    return 2 * Math.atan(Math.tan(hf / 2) / this.aspect);
  }

  /** Recompute matrices (called by the renderer; world matrix must be current). */
  updateProjection(aspect: number) {
    this.aspect = aspect;
    if (this.ortho) {
      let h = this.orthoSize;
      const widthFit = this.fit === 'width' || (this.fit === 'contain' && aspect < this.designAspect);
      if (widthFit) h = (this.orthoSize * this.designAspect) / aspect;
      m4ortho(this.proj, -h * aspect, h * aspect, -h, h, this.near, this.far);
    } else m4perspective(this.proj, this.vfov, aspect, this.near, this.far);
    m4invert(this.view, this.worldMatrix);
    m4mul(this.viewProj, this.proj, this.view);
    m4invert(this.invViewProj, this.viewProj);
    frustumPlanes(this.planes, this.viewProj);
  }

  /** Project world point to CSS pixels. Returns [x, y, depth]; depth > 1 or < 0 means off-screen/behind. */
  worldToScreen(p: V3, width: number, height: number, out: Vec3 = v3()) {
    const m = this.viewProj;
    const x = p[0], y = p[1], z = p[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    v3transformMat4(out, p, m);
    out[0] = (out[0] * 0.5 + 0.5) * width;
    out[1] = (0.5 - out[1] * 0.5) * height;
    if (w <= 0) out[2] = -1;
    return out;
  }

  /** Ray from camera through a CSS-pixel screen point. */
  screenRay(x: number, y: number, width: number, height: number) {
    const nx = (x / width) * 2 - 1, ny = 1 - (y / height) * 2;
    const a = v3transformMat4(v3(), [nx, ny, 0], this.invViewProj);
    const b = v3transformMat4(v3(), [nx, ny, 1], this.invViewProj);
    return { origin: a, dir: v3normalize(b, v3sub(b, b, a)) };
  }
}
