import { describe, it, expect } from 'vitest';
import { Node } from '../src/index';
import { ICON_IDS, TEX_IDS, paintIcon, paintTex, signPix } from '../games/snowball-rush/textures';
import { blockGeometry, boxGeometry, crossSprite, voxelSphere, type Block } from '../games/snowball-rush/blocks';
import { OVER, PARTS, ballPix, faceRects, legacyTo64, skinAccessories, skinLayers, skinPix } from '../games/snowball-rush/skinart';
import { animateCharacter, partGeometry, type Character, type Pose } from '../games/snowball-rush/character';
import { BALL_IDS, SKIN_IDS } from '../games/snowball-rush/types';

const verts = (g: { attributes: Record<string, { data: ArrayLike<number> }> }) => g.attributes.position.data.length / 3;

describe('snowball art: textures & icons', () => {
  it('paints every block texture deterministically; opaque except cut-out/translucent ones', () => {
    for (const id of TEX_IDS) {
      const a = paintTex(id), b = paintTex(id);
      expect(a.w).toBe(id === 'voxel' ? 8 : 16);
      expect(Array.from(a.d)).toEqual(Array.from(b.d));
      let transparent = 0;
      a.each((x, y) => { if (a.alpha(x, y) < 255) transparent++; });
      if (id === 'fire' || id === 'glass') expect(transparent).toBeGreaterThan(0);
      else expect(transparent).toBe(0);
    }
  });
  it('paints every icon with content and a dark outline', () => {
    for (const id of ICON_IDS) {
      const p = paintIcon(id);
      let n = 0, outline = 0;
      p.each((x, y) => { if (p.alpha(x, y)) { n++; if (p.get(x, y) === 0x1b1d2b) outline++; } });
      expect(n, id).toBeGreaterThan(30);
      expect(outline, id).toBeGreaterThan(8);
    }
  });
  it('draws bitmap sign numbers without a DOM', () => {
    const p = signPix('x1.5', 0xffffff, 0x1d4f91, 0x14182a, 48, 24);
    let fg = 0;
    p.each((x, y) => { if (p.get(x, y) === 0xffffff) fg++; });
    expect(fg).toBeGreaterThan(40);
  });
});

describe('snowball art: blocks', () => {
  it('culls shared faces and merges coplanar faces', () => {
    const two: Block[] = [{ x: 0, y: 0.5, z: -0.5, t: 'snow' }, { x: 1, y: 0.5, z: -0.5, t: 'snow' }];
    const out = blockGeometry(two);
    expect(out.length).toBe(1);
    expect(verts(out[0].geo)).toBe(6 * 4); // 6 merged quads
  });
  it('merges a whole floor into one top quad and honors noBottom / textures per face', () => {
    const floor: Block[] = [];
    for (let x = -6; x <= 6; x++) for (let r = 0; r < 20; r++) floor.push({ x, y: -0.5, z: -(r + 0.5), t: ['snow', 'snowSide', 'dirt'] });
    const out = blockGeometry(floor, { noBottom: true });
    const top = out.find((o) => o.t === 'snow')!, side = out.find((o) => o.t === 'snowSide')!;
    expect(verts(top.geo)).toBe(4);
    expect(verts(side.geo)).toBe(4 * 4);
    expect(out.find((o) => o.t === 'dirt')).toBeUndefined();
    // chunks split the floor
    expect(blockGeometry(floor, { noBottom: true, chunk: 5 }).filter((o) => o.t === 'snow').length).toBe(4);
  });
  it('keeps faces next to see-through blocks and builds non-unit boxes', () => {
    const out = blockGeometry([{ x: 0, y: 0, z: 0, t: 'stone' }, { x: 1, y: 0, z: 0, t: 'glass' }, { x: 5, y: 0, z: 0, t: 'metal', sx: 2, sy: 1, sz: 1 }]);
    expect(verts(out.find((o) => o.t === 'stone')!.geo)).toBe(24);
    expect(verts(out.find((o) => o.t === 'metal')!.geo)).toBe(24);
    const uv = boxGeometry(3, 2, 1).attributes.uv.data;
    expect(Math.max(...Array.from(uv))).toBe(3);
    expect(verts(crossSprite(1, 1))).toBe(8);
  });
  it('builds a low-poly voxel sphere with vertex colors inside the unit sphere', () => {
    const g = voxelSphere(12, () => 0xffffff);
    expect(verts(g)).toBeLessThan(4000);
    expect(g.attributes.color.size).toBe(4);
    expect(g.bounds.radius).toBeLessThan(1.15); // voxel corners stick out a little
    expect(g.bounds.max[1]).toBeGreaterThan(0.95);
  });
});

describe('snowball art: skins & characters', () => {
  it('paints every skin with a fully opaque base layer and placed accessories', () => {
    for (const id of SKIN_IDS) {
      const p = skinPix(id);
      expect(p.w).toBe(64);
      for (const part of PARTS) for (const [x, y, w, h] of faceRects(part)) {
        for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) expect(p.alpha(i, j), `${id} ${part} ${i},${j}`).toBe(255);
      }
      for (const a of skinAccessories(id)) expect(a.uv, id).toBeDefined();
    }
    expect(skinLayers('winter').has(OVER.head)).toBe(true);
    expect(skinLayers('noob').size).toBe(0);
  });
  it('converts a classic 64x32 skin: left limbs are mirrored right limbs', () => {
    const src = new Uint8ClampedArray(64 * 32 * 4);
    const put = (x: number, y: number, v: number) => { const i = (y * 64 + x) * 4; src[i] = v; src[i + 3] = 255; };
    put(4, 20, 200); // right leg front, left column
    put(0, 20, 100); // right leg outer (right) side
    const p = legacyTo64(src, 64, 32);
    expect(p.get(4, 20) >> 16).toBe(200);
    expect(p.get(16 + 4 + 3, 52) >> 16).toBe(200); // front mirrored
    expect(p.get(16 + 8 + 3, 52) >> 16).toBe(100); // outer side becomes the left leg's outer (+X) side
  });
  it('merges base box, overlay and accessories into one geometry per part', () => {
    expect(verts(partGeometry('noob', 'head'))).toBe(24);
    expect(verts(partGeometry('winter', 'head'))).toBe(24 * 5);
    for (const id of SKIN_IDS) for (const part of PARTS) expect(verts(partGeometry(id, part))).toBeGreaterThanOrEqual(24);
  });
  it('poses never produce NaN', () => {
    const n = () => new Node();
    const c: Character = { root: n(), rig: n(), head: n(), body: n(), armR: n(), armL: n(), legR: n(), legL: n(), skin: 'noob' };
    for (const pose of ['idle', 'run', 'push', 'stun', 'fall', 'cheer', 'sad', 'wave'] as Pose[]) {
      for (const t of [0, 0.37, 2.5]) {
        animateCharacter(c, pose, t, 7, 1.2);
        for (const k of ['head', 'body', 'armR', 'armL', 'legR', 'legL', 'rig'] as const) expect(Array.from(c[k].rotation).every(Number.isFinite)).toBe(true);
      }
    }
  });
  it('paints ball icons', () => {
    for (const id of BALL_IDS) {
      const p = ballPix(id);
      let n = 0;
      p.each((x, y) => { if (p.alpha(x, y)) n++; });
      expect(n).toBeGreaterThan(150);
    }
  });
});
