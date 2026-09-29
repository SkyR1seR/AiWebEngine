import { Node } from './node';
import { Mesh } from './mesh';
import type { Material } from '../materials/material';
import type { Animator } from '../anim/animator';

/** An instantiated model: node tree + its node list + animator. */
export class Model extends Node {
  nodes: Node[] = [];
  meshes: Mesh[] = [];
  animator: Animator | null = null;
  /** Replace materials of all meshes. */
  setMaterial(fn: (m: Material, mesh: Mesh) => Material) { for (const m of this.meshes) m.material = fn(m.material, m); return this; }
  setShadows(cast: boolean, receive = cast) { for (const m of this.meshes) { m.castShadow = cast; m.receiveShadow = receive; } return this; }
  /** Play an animation (shortcut for animator.play). */
  play(name: string, o?: Parameters<Animator['play']>[1]) { return this.animator?.play(name, o); }
}
