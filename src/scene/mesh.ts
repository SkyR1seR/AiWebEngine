import { Node } from './node';
import type { Geometry, InstanceBuffer } from '../geometry/geometry';
import type { Material } from '../materials/material';
import type { Skin } from '../anim/skin';

export class Mesh extends Node {
  castShadow = true;
  receiveShadow = true;
  frustumCulled = true;
  /** Higher draws later within its queue. */
  renderOrder = 0;
  /** Per-object color multiplier (linear RGBA). */
  tint = new Float32Array([1, 1, 1, 1]);
  /** Per-object flash overlay: rgb color, a = amount (0..1). */
  flash = new Float32Array(4);
  skin: Skin | null = null;
  instances: InstanceBuffer | null = null;

  constructor(public geometry: Geometry = null as any, public material: Material = null as any, name = '') {
    super(name);
  }

  protected override copyFrom(src: Mesh) {
    super.copyFrom(src);
    this.geometry = src.geometry;
    this.material = src.material;
    this.castShadow = src.castShadow;
    this.receiveShadow = src.receiveShadow;
    this.frustumCulled = src.frustumCulled;
    this.renderOrder = src.renderOrder;
    this.tint.set(src.tint);
    this.skin = src.skin;
    this.instances = src.instances;
  }
}
