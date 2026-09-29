import { m4, m4invert, m4mul } from '../core/math';
import type { Node } from '../scene/node';
import type { GpuBindGroup, GpuBuffer } from '../gpu/device';

export const MAX_JOINTS = 128;
const _inv = m4(), _t = m4();

/** Skeleton binding for a skinned mesh. */
export class Skin {
  matrices: Float32Array;
  /** @internal */ gpu?: { ubo: GpuBuffer; bg: GpuBindGroup; gen: number };
  constructor(public joints: Node[], public inverseBind: Float32Array) {
    if (joints.length > MAX_JOINTS) console.warn(`Skin has ${joints.length} joints, max ${MAX_JOINTS}`);
    this.matrices = new Float32Array(Math.min(joints.length, MAX_JOINTS) * 16);
  }
  /** Compute joint matrices relative to the mesh (world matrices must be current). */
  update(meshWorld: Float32Array) {
    m4invert(_inv, meshWorld);
    const n = Math.min(this.joints.length, MAX_JOINTS);
    for (let i = 0; i < n; i++) {
      m4mul(_t, this.joints[i].worldMatrix, this.inverseBind.subarray(i * 16, i * 16 + 16));
      m4mul(this.matrices.subarray(i * 16, i * 16 + 16), _inv, _t);
    }
  }
  /** Clone with joints remapped (used when instantiating models). */
  remap(map: Map<Node, Node>) {
    return new Skin(this.joints.map((j) => map.get(j) ?? j), this.inverseBind);
  }
}
