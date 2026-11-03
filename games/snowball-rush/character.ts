// Blocky character from a 64x64 skin + accessories (owner: art). Feet at y=0, faces +Z, 1.44 m tall.
// Hierarchy: root (free for the caller: position / yaw / scale) → rig (pose bob & tilt) → legR, legL, body (pivot at the
// hips) → head (neck), armR, armL (shoulders). Every part is ONE mesh (base box + overlay layer + accessories merged,
// all textured by the skin), its geometry is built around the joint, so the part node itself is the pivot.
import { Geometry, Material, Mesh, Node, lambert } from 'aiwebengine';
import { PX } from './config';
import { OVER, faceRects, skinAccessories, skinLayers, skinTexture, UV, type Layer, type PartName } from './skinart';

export interface Character {
  root: Node; head: Node; body: Node; armR: Node; armL: Node; legR: Node; legL: Node; skin: string;
  /** inner node animated by poses (vertical bob, tilt); keep your own transforms on root */
  rig: Node;
}
export type Pose = 'idle' | 'run' | 'push' | 'stun' | 'fall' | 'cheer' | 'sad' | 'wave';

/** joint position (relative to the parent part's joint) and box center (relative to the joint), skin pixels */
const SPEC: Record<PartName, { pivot: [number, number, number]; center: [number, number, number] }> = {
  body: { pivot: [0, 12, 0], center: [0, 6, 0] },
  head: { pivot: [0, 12, 0], center: [0, 4, 0] },
  armR: { pivot: [-6, 10, 0], center: [0, -4, 0] },
  armL: { pivot: [6, 10, 0], center: [0, -4, 0] },
  legR: { pivot: [-2, 12, 0], center: [0, -6, 0] },
  legL: { pivot: [2, 12, 0], center: [0, -6, 0] },
};

/** face frames [normal, right, up] in faceRects() order: top, bottom, right side (-X), front, left side (+X), back */
const FR: [number[], number[], number[]][] = [
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
];
/** UV inset (texels) so nearest sampling never picks a neighboring rect at face edges */
const EPS = 0.04;

class PartBuilder {
  p: number[] = [];
  n: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  /**
   * box of half extents (hx,hy,hz) px at center c (px), faces textured from rects (one rect per face, or one for all;
   * a 1x1 rect = a solid palette color), optional rotation rz around Z
   */
  box(c: number[], hx: number, hy: number, hz: number, rects: number[][], rz = 0) {
    const half = [hx, hy, hz], cs = Math.cos(rz), sn = Math.sin(rz);
    FR.forEach(([N, R, U], f) => {
      const [rx, ry, rw, rh] = rects.length === 1 ? rects[0] : rects[f];
      const solid = rw === 1 && rh === 1;
      const u0 = (solid ? rx + 0.5 : rx + EPS) / 64, u1 = (solid ? rx + 0.5 : rx + rw - EPS) / 64;
      const v0 = (solid ? ry + 0.5 : ry + EPS) / 64, v1 = (solid ? ry + 0.5 : ry + rh - EPS) / 64;
      const b = this.p.length / 3;
      for (const [s, t] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        let x = 0, y = 0, z = 0;
        for (let k = 0; k < 3; k++) {
          const v = (N[k] + R[k] * s + U[k] * t) * half[k];
          if (k === 0) x = v; else if (k === 1) y = v; else z = v;
        }
        this.p.push((c[0] + x * cs - y * sn) * PX, (c[1] + x * sn + y * cs) * PX, (c[2] + z) * PX);
        this.n.push(N[0] * cs - N[1] * sn, N[0] * sn + N[1] * cs, N[2]);
        this.uv.push(s < 0 ? u0 : u1, t > 0 ? v0 : v1);
      }
      this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
  }
  geometry() {
    return new Geometry().setAttribute('position', this.p, 3).setAttribute('normal', this.n, 3).setAttribute('uv', this.uv, 2).setIndex(this.idx);
  }
}

const geos = new Map<string, Geometry>();
/** merged geometry of one body part of a skin, in the part's joint space (meters; cached) */
export function partGeometry(skin: string, part: PartName): Geometry {
  const key = skin + '|' + part;
  let g = geos.get(key);
  if (g) return g;
  const b = new PartBuilder(), c = SPEC[part].center, [, , w, h, d] = UV[part];
  b.box(c, w / 2, h / 2, d / 2, faceRects(part));
  const over: Layer = OVER[part];
  if (skinLayers(skin).has(over)) {
    const grow = part === 'head' ? 0.5 : 0.25;
    b.box(c, w / 2 + grow, h / 2 + grow, d / 2 + grow, faceRects(over));
  }
  for (const a of skinAccessories(skin)) {
    if (a.part !== part) continue;
    b.box([c[0] + a.x, c[1] + a.y, c[2] + a.z], a.w / 2, a.h / 2, a.d / 2, [a.uv!], a.rz);
  }
  g = b.geometry();
  geos.set(key, g);
  return g;
}

const mats = new Map<string, Material>();
/** the skin material (cached): lambert with the skin texture, alpha cut-out for the overlay layer */
export function characterMaterial(skin: string): Material {
  let m = mats.get(skin);
  if (!m) {
    m = lambert(0xffffff, { map: skinTexture(skin), alphaTest: 0.5 });
    mats.set(skin, m);
  }
  return m;
}

/** blocky character: 6 meshes (one draw call per part), feet at y=0, facing +Z */
export function createCharacter(skinId: string): Character {
  const mat = characterMaterial(skinId);
  const root = new Node('character'), rig = root.add(new Node('rig'));
  const mk = (parent: Node, part: PartName) => {
    const m = parent.add(new Mesh(partGeometry(skinId, part), mat, part));
    const [x, y, z] = SPEC[part].pivot;
    m.setPosition(x * PX, y * PX, z * PX);
    return m;
  };
  const legR = mk(rig, 'legR'), legL = mk(rig, 'legL'), body = mk(rig, 'body');
  const head = mk(body, 'head'), armR = mk(body, 'armR'), armL = mk(body, 'armL');
  return { root, rig, head, body, armR, armL, legR, legL, skin: skinId };
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const HALF_PI = Math.PI / 2;

/**
 * Procedural pose at time t (s); speed scales the run cycle (m/s). Only rotations of the parts + the rig's bob/tilt
 * are touched (no allocations). `ballR` (m) aims the arms of the 'push' pose at the ball (small ball → arms down).
 * Poses: idle (breathing), run, push (main race pose: lean, arms forward, legs running), stun (dizzy wobble),
 * fall (arms up flailing), cheer (jumping, arms up), sad (head down), wave.
 */
export function animateCharacter(c: Character, pose: Pose, t: number, speed = 6, ballR = 0.5): void {
  let bx = 0, hx = 0, hz = 0, arx = 0, arz = -0.04, alx = 0, alz = 0.04, lrx = 0, llx = 0, y = 0, tilt = 0;
  switch (pose) {
    case 'idle': {
      const b = Math.sin(t * 2.2);
      arz = -0.05 - b * 0.03; alz = 0.05 + b * 0.03; hx = b * 0.03; y = (b + 1) * 0.004;
      break;
    }
    case 'run':
    case 'push': {
      const k = clamp(speed / 6, 0, 1.3), ph = t * (5 + speed * 1.15), sw = Math.sin(ph) * (0.2 + 0.6 * Math.min(k, 1));
      lrx = sw; llx = -sw; y = Math.abs(Math.cos(ph)) * 0.05 * Math.min(k, 1);
      if (pose === 'run') { arx = -sw * 0.9; alx = sw * 0.9; bx = 0.1 * k; hx = -0.05 * k; }
      else {
        bx = 0.32;
        // world angle of the arms below horizontal: small ball → reach down, big ball → slightly up
        const down = clamp(0.9 - (ballR - 0.3) * 0.85, -0.15, 0.9), a = -HALF_PI + down - bx;
        arx = a + Math.sin(ph) * 0.07; alx = a - Math.sin(ph) * 0.07; arz = -0.1; alz = 0.1; hx = -0.26;
      }
      break;
    }
    case 'stun': {
      tilt = Math.sin(t * 7) * 0.12; hx = Math.sin(t * 9) * 0.2; hz = Math.cos(t * 9) * 0.25;
      arz = -0.6 - Math.sin(t * 8) * 0.2; alz = 0.6 + Math.sin(t * 8 + 1) * 0.2; lrx = Math.sin(t * 7) * 0.15; llx = -lrx;
      break;
    }
    case 'fall': {
      arx = -Math.PI + Math.sin(t * 16) * 0.5; alx = -Math.PI + Math.sin(t * 16 + 2) * 0.5; arz = -0.35; alz = 0.35;
      lrx = Math.sin(t * 14) * 0.6; llx = -lrx; hx = -0.3; bx = -0.12;
      break;
    }
    case 'cheer': {
      const ph = t * 5.5, j = Math.abs(Math.sin(ph));
      y = j * 0.28; arx = -Math.PI + 0.25 + Math.sin(ph * 2) * 0.15; alx = -Math.PI + 0.25 - Math.sin(ph * 2) * 0.15;
      arz = -0.35; alz = 0.35; lrx = llx = -0.35 * j; hx = -0.15;
      break;
    }
    case 'sad': {
      hx = 0.5; bx = 0.12; arx = alx = -0.12; arz = -0.02; alz = 0.02; tilt = Math.sin(t * 1.2) * 0.04;
      break;
    }
    case 'wave': {
      const b = Math.sin(t * 2.2);
      arz = -2.5 + Math.sin(t * 9) * 0.35; alz = 0.05 + b * 0.03; hz = 0.08; hx = b * 0.03;
      break;
    }
  }
  c.rig.position[1] = y;
  c.rig.setRotation(0, 0, tilt);
  c.body.setRotation(bx, 0, 0);
  c.head.setRotation(hx, 0, hz);
  c.armR.setRotation(arx, 0, arz);
  c.armL.setRotation(alx, 0, alz);
  c.legR.setRotation(lrx, 0, 0);
  c.legL.setRotation(llx, 0, 0);
}
