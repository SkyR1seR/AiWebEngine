import { Node } from './node';
import { color, type ColorLike } from '../core/math';

export interface SkyOptions {
  top?: ColorLike;
  horizon?: ColorLike;
  bottom?: ColorLike;
  /** gradient exponents */
  topExp?: number;
  bottomExp?: number;
  /** sun glow strength and sharpness */
  sun?: number;
  sunSharpness?: number;
}

export class Scene extends Node {
  /** Clear color (linear RGBA). Ignored when `sky` is set. */
  background = color(0x87b5e0);
  /** Gradient sky (uniforms in Material layout). */
  sky: Float32Array | null = null;
  /** Hemisphere ambient: sky/ground colors and intensity. */
  ambient = { sky: color(0xbfd8ff), ground: color(0x6b5a4a), intensity: 0.5 };
  fog: { color: Float32Array; near: number; far: number; density: number } | null = null;
  exposure = 1;

  constructor() {
    super('scene');
  }

  setBackground(c: ColorLike) { color(c, 1, this.background); return this; }
  setAmbient(sky: ColorLike, ground: ColorLike = sky, intensity = 0.5) {
    color(sky, 1, this.ambient.sky);
    color(ground, 1, this.ambient.ground);
    this.ambient.intensity = intensity;
    return this;
  }
  /** Linear fog between near and far, or exponential-squared if density > 0. Pass null to disable. */
  setFog(c: ColorLike | null, near = 20, far = 100, density = 0) {
    this.fog = c === null ? null : { color: color(c), near, far, density };
    return this;
  }
  setSky(o: SkyOptions | null) {
    if (!o) { this.sky = null; return this; }
    const u = new Float32Array(24);
    color(o.top ?? 0x3a7bd5, 1, u.subarray(0, 4));
    color(o.horizon ?? 0xcfe3f5, 1, u.subarray(4, 8));
    color(o.bottom ?? 0x8f8a80, 1, u.subarray(8, 12));
    u[12] = o.topExp ?? 0.6;
    u[13] = o.bottomExp ?? 0.4;
    u[14] = o.sun ?? 0.6;
    u[15] = o.sunSharpness ?? 200;
    this.sky = u;
    return this;
  }
}
