import { Node } from './node';
import { color, v3, v3normalize, type ColorLike, type V3 } from '../core/math';

export interface ShadowOptions {
  /** Shadow map resolution (default 2048; 1024 on mobile is a good choice). */
  size?: number;
  /** Half-size of the shadowed area around the focus point in world units (default 20). */
  extent?: number;
  bias?: number;
  normalBias?: number;
}

/** Sun-like light. `direction` is the direction light travels (e.g. [-1,-2,-1] = from upper right). */
export class DirectionalLight extends Node {
  color: Float32Array;
  intensity: number;
  direction = v3(-0.5, -1, -0.3);
  castShadow: boolean;
  shadow: Required<ShadowOptions>;
  /** World point the shadow map is centered on (default: camera position). */
  shadowFocus: V3 | null = null;

  constructor(o: { color?: ColorLike; intensity?: number; direction?: V3; castShadow?: boolean; shadow?: ShadowOptions } = {}) {
    super('sun');
    this.color = color(o.color ?? 0xffffff);
    this.intensity = o.intensity ?? 1;
    if (o.direction) v3normalize(this.direction, o.direction);
    else v3normalize(this.direction, this.direction);
    this.castShadow = o.castShadow ?? true;
    this.shadow = { size: 2048, extent: 20, bias: 0.0005, normalBias: 0.04, ...o.shadow };
  }
  setDirection(x: number, y: number, z: number) { v3normalize(this.direction, [x, y, z]); return this; }
}

export class PointLight extends Node {
  color: Float32Array;
  constructor(c: ColorLike = 0xffffff, public intensity = 1, public range = 10) {
    super('point');
    this.color = color(c);
  }
}
