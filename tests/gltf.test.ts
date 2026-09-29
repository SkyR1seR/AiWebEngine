import { describe, it, expect } from 'vitest';
import { parseGLTF } from '../src/assets/gltf';
import { Mesh } from '../src/scene/mesh';

/** Build a GLB: one triangle skinned to 2 joints + a translation animation on joint 1. */
function makeGLB() {
  const f32 = (a: number[]) => new Float32Array(a);
  const parts: ArrayBufferView[] = [
    f32([0, 0, 0, 1, 0, 0, 0, 1, 0]), // positions
    new Uint16Array([0, 1, 2, 0]), // indices (padded)
    new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), // joints (u8)
    f32([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), // weights
    f32([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1]), // IBMs
    f32([0, 1]), // anim times
    f32([0, 1, 0, 0, 3, 0]), // anim translations
  ];
  const views: any[] = [];
  let off = 0;
  for (const p of parts) { views.push({ buffer: 0, byteOffset: off, byteLength: p.byteLength }); off += p.byteLength; }
  const bin = new Uint8Array(off);
  off = 0;
  for (const p of parts) { bin.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), off); off += p.byteLength; }
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: 'body', mesh: 0, skin: 0 },
      { name: 'root', children: [2] },
      { name: 'bone', translation: [0, 1, 0] },
    ],
    meshes: [{ name: 'tri', primitives: [{ attributes: { POSITION: 0, JOINTS_0: 2, WEIGHTS_0: 3 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1], metallicFactor: 0 } }],
    skins: [{ joints: [1, 2], inverseBindMatrices: 4 }],
    animations: [{ name: 'Lift', channels: [{ sampler: 0, target: { node: 2, path: 'translation' } }], samplers: [{ input: 5, output: 6 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      { bufferView: 2, componentType: 5121, count: 3, type: 'VEC4' },
      { bufferView: 3, componentType: 5126, count: 3, type: 'VEC4' },
      { bufferView: 4, componentType: 5126, count: 2, type: 'MAT4' },
      { bufferView: 5, componentType: 5126, count: 2, type: 'SCALAR' },
      { bufferView: 6, componentType: 5126, count: 2, type: 'VEC3' },
    ],
    bufferViews: views,
    buffers: [{ byteLength: bin.length }],
  };
  let js = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (js.length % 4)) % 4;
  js = new Uint8Array([...js, ...new Array(pad).fill(0x20)]);
  const total = 12 + 8 + js.length + 8 + bin.length;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.length, true); dv.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(out, 20, js.length).set(js);
  dv.setUint32(20 + js.length, bin.length, true); dv.setUint32(24 + js.length, 0x004e4942, true);
  new Uint8Array(out, 28 + js.length).set(bin);
  return out;
}

describe('glTF', () => {
  it('parses GLB with skin, material and animation; instances share GPU data', async () => {
    const asset = await parseGLTF(makeGLB());
    expect(asset.clips.map((c) => c.name)).toEqual(['Lift']);
    const a = asset.instantiate(), b = asset.instantiate();
    expect(a.meshes.length).toBe(1);
    const m = a.meshes[0] as Mesh;
    expect(m.geometry.vertexCount).toBe(3);
    expect(m.geometry.attributes.joints.data[4]).toBe(1);
    expect(m.material.uniforms[0]).toBeCloseTo(1);
    expect(m.material.uniforms[1]).toBeCloseTo(0);
    expect(m.skin!.joints[1]).toBe(a.find('bone'));
    expect(b.meshes[0].geometry).toBe(m.geometry);
    expect(b.meshes[0].skin!.joints[1]).not.toBe(m.skin!.joints[1]);
    a.animator!.play('Lift', { fade: 0 });
    a.updateScripts(0.5);
    expect(a.find('bone')!.position[1]).toBeCloseTo(2);
    expect(b.find('bone')!.position[1]).toBeCloseTo(1);
    a.updateMatrices();
    m.skin!.update(m.worldMatrix);
    // joint 1 moved up by 1 relative to bind pose -> matrix translation y = +1
    expect(m.skin!.matrices[16 + 13]).toBeCloseTo(1);
  });
});
