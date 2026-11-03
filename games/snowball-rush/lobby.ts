// Menu backdrop (owner: world): cozy snowy yard with a decorated tree, the player's character and ball, camera framing.
// Built once far from any track (x = 1000). The camera orbits slowly around Нубик and is aimed so that he sits where the
// menu leaves room (Lobby.framing; the default matches menu.ts: the center column in landscape — offers on the left,
// buttons on the right — the middle band in portrait, lower-center on squares above the Play button).
import { Mesh, Node, m4, m4targetTo, qfromMat4, type Game, type V3 } from 'aiwebengine';
import type { Env } from './world';
import { L_PROP, Mesher, blinkLights, bulb, cabin, candyCane, disposeGeometry, gift, lampPost, layerMeshes, pine, snowman } from './world';
import { animateCharacter, createCharacter, type Character, type Pose } from './character';
import { ballGeometry, ballMaterial } from './skinart';
import { fireworks, pixelBurst } from './fx';
import { blockGeometry, blockMaterial, type Block } from './blocks';
import { rng } from './util';

/** lobby origin */
const OX = 1000, OZ = 0;
/** hero position (on a snow pedestal) */
const HX = OX, HY = 0.5, HZ = OZ;
const UP: V3 = [0, 1, 0];

/** where Нубик (hero + ball) appears on screen: x, y in NDC (-1..1, +y up), camera distance (m), vertical FOV */
export interface Framing { x: number; y: number; dist: number; fov: number }
/** default framing per aspect ratio (width / height) */
export function lobbyFraming(aspect: number): Framing {
  if (aspect > 1.25) return { x: 0.02, y: -0.14, dist: 7.4, fov: 40 };
  if (aspect < 0.8) return { x: 0, y: -0.12, dist: 7.6, fov: 50 };
  return { x: 0, y: -0.3, dist: 8.4, fov: 42 };
}

export class Lobby {
  root: Node;
  /** screen placement of the hero per aspect ratio (replace to fit another menu layout, e.g. right half: x 0.42) */
  framing: (aspect: number) => Framing = lobbyFraming;
  private _game: Game;
  private _env: Env;
  private _ch: Character | null = null;
  private _ball: Mesh;
  private _skin = '';
  private _ballId = '';
  private _t = 0;
  private _cheer = 0;
  private _waveT = 3;
  private _fw = 0;
  private _m = m4();
  private _pos = new Float32Array(3);
  private _look = new Float32Array(3);
  private _at = new Float32Array(3);
  private _active = false;
  private _geos: ReturnType<Mesher['geometries']> = [];

  constructor(game: Game, env: Env) {
    this._game = game;
    this._env = env;
    this.root = game.scene.add(new Node('lobby'));
    this.root.visible = false;
    this._build();
    this._ball = this.root.add(new Mesh(ballGeometry('snow'), ballMaterial('snow')));
    this.setLook('noob', 'snow');
  }

  private _build() {
    const M = new Mesher(), r = rng(2025), big: Block[] = [];
    // yard floor (unit blocks near the hero, a big field beyond)
    for (let x = -14; x <= 14; x++) for (let z = -16; z <= 8; z++) M.unit(L_PROP, OX + x, -0.5, OZ + z + 0.5, ['snow', 'snowSide', 'dirt']);
    big.push({ x: OX, y: -1, z: OZ - 46, sx: 180, sy: 2, sz: 60, t: ['snow', 'snowSide', 'dirt'] });
    big.push({ x: OX, y: -1, z: OZ + 28, sx: 180, sy: 2, sz: 40, t: ['snow', 'snowSide', 'dirt'] });
    for (const sx of [-1, 1]) big.push({ x: OX + sx * 52, y: -1, z: OZ - 4, sx: 76, sy: 2, sz: 24, t: ['snow', 'snowSide', 'dirt'] });
    // snow-brick pedestal with a garland along its front edge
    M.add(L_PROP, HX, 0.25, HZ, 3.4, 0.5, 2.6, ['snow', 'snowBrick', 'snow']);
    for (let i = 0; i < 15; i++) bulb(M, HX - 1.6 + (i / 14) * 3.2, 0.3, HZ + 1.33, i, 0.13);
    candyCane(M, HX + 2.2, HZ - 1.3, -1);
    // the decorated New-Year tree behind-right (visible next to Нубик in every framing), gifts at its foot
    const tx = OX + 4, tz = OZ - 8;
    pine(M, tx, tz, 3, 0, r, true);
    for (let i = 0; i < 40; i++) {
      const y = 3 + r() * 7.2, R = Math.max(0.55, 4.45 - (y - 3) * 0.55), a = r() * Math.PI * 1.2;
      bulb(M, tx + Math.cos(a) * R, y, tz + Math.sin(a) * R, i, 0.28);
    }
    for (let i = 0; i < 8; i++) gift(M, tx - 2.6 + (i % 4) * 1.2, 0, tz + 4.9 + Math.floor(i / 4) * 0.9 + (i % 2) * 0.3, 0.6 + (i % 3) * 0.18, i, i * 0.4);
    // cabin behind-left (front with lit windows toward the yard), lamp, snowman, forest ring
    cabin(M, OX - 9, OZ - 8, 1, r);
    lampPost(M, OX - 3.4, OZ - 2.2);
    snowman(M, OX - 5.2, OZ - 3.6, 0.45, 0);
    for (let i = 0; i < 3; i++) gift(M, OX - 4.2 + i * 0.55, 0, OZ - 1.6 - (i % 2) * 0.6, 0.45 + (i % 2) * 0.15, i + 1, i);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2 + r() * 0.1, R = 17 + r() * 9;
      const x = Math.round(OX + Math.cos(a) * R), z = Math.round(OZ - 5 + Math.sin(a) * R * 0.9);
      if (z > OZ + 4) continue; // keep the camera side open
      pine(M, x, z, r() < 0.4 ? 3 : 2, r() < 0.25 ? 4 : 0, r);
    }
    this._geos = M.geometries();
    layerMeshes(this.root, this._geos);
    for (const { t, geo } of blockGeometry(big, { noBottom: true })) {
      const m = this.root.add(new Mesh(geo, blockMaterial(t)));
      m.castShadow = false;
      this._geos.push(geo);
    }
  }

  /** show the lobby and take over the camera */
  enter(): void {
    this._active = true;
    this.root.visible = true;
    this._env.setTheme(4);
    this._env.focus(HX - 1, 0, HZ - 2);
    this.update(0);
  }

  leave(): void {
    this._active = false;
    this.root.visible = false;
    this._env.followCamera();
  }

  /** dress Нубик (skin id) and his ball (ball skin id) */
  setLook(skin: string, ball: string): void {
    if (skin !== this._skin) {
      this._skin = skin;
      this._ch?.root.parent?.remove(this._ch.root);
      this._ch = createCharacter(skin);
      this.root.add(this._ch.root);
      this._ch.root.setPosition(HX - 0.55, HY, HZ + 0.1);
      this._ch.root.setRotation(0, 0.45, 0);
    }
    if (ball !== this._ballId) {
      this._ballId = ball;
      this._ball.geometry = ballGeometry(ball);
      this._ball.material = ballMaterial(ball);
    }
  }

  update(dt: number): void {
    if (!this._active) return;
    this._t += dt;
    const t = this._t;
    blinkLights(t);
    // Нубик: idle, waves now and then, cheers on demand
    let pose: Pose = 'idle';
    if (this._cheer > 0) { this._cheer -= dt; pose = 'cheer'; }
    else {
      this._waveT -= dt;
      if (this._waveT < 0) pose = 'wave';
      if (this._waveT < -1.6) this._waveT = 5 + Math.random() * 4;
    }
    if (this._ch) animateCharacter(this._ch, pose, t);
    // the ball rests next to him, rocking a little
    const R = 0.62;
    this._ball.setPosition(HX + 0.75, HY + R, HZ + 0.25).setRotation(Math.sin(t * 0.7) * 0.08, t * 0.15, 0).setScale(R);
    if (this._fw > 0) {
      this._fw -= dt;
      if (((this._fw * 10) | 0) % 5 === 0 && Math.random() < dt * 8) {
        this._at[0] = HX - 6 + Math.random() * 12; this._at[1] = 7 + Math.random() * 4; this._at[2] = HZ - 8 - Math.random() * 6;
        fireworks(this.root, this._at);
      }
    }
    this._frame(t);
  }

  /** orbit + framing: aim the camera so the hero lands at the wanted screen spot for this aspect ratio */
  private _frame(t: number) {
    const cam = this._game.camera, s = this._game.screen, a = s.width / Math.max(1, s.height);
    // hero target spot in NDC (x right, y up) and distance
    const { x: fx, y: fy, dist, fov } = this.framing(a);
    const yaw = Math.sin(t * 0.12) * 0.28 - 0.05, pitch = 0.24;
    const cx = HX, cy = HY + 1.0, cz = HZ;
    const P = this._pos, L = this._look;
    P[0] = cx + Math.sin(yaw) * Math.cos(pitch) * dist;
    P[1] = cy + Math.sin(pitch) * dist;
    P[2] = cz + Math.cos(yaw) * Math.cos(pitch) * dist;
    // shift the look target opposite to the wanted screen offset (in the camera's right/up plane)
    const th = Math.tan((fov * Math.PI) / 360), ox = -fx * th * a * dist, oy = -fy * th * dist;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    L[0] = cx + rx * ox;
    L[1] = cy + oy;
    L[2] = cz + rz * ox;
    cam.fov = fov;
    cam.position[0] = P[0]; cam.position[1] = P[1]; cam.position[2] = P[2];
    m4targetTo(this._m, P, L, UP);
    qfromMat4(cam.rotation, this._m);
  }

  /** a little celebration (bought a skin, opened a case) */
  cheer(): void {
    this._cheer = 2.2;
    this._fw = 2.5;
    this._at[0] = HX; this._at[1] = 1.6; this._at[2] = HZ;
    pixelBurst(this.root, 'confetti', this._at, 70, 1.2);
    this._at[1] = 9; this._at[2] = HZ - 6;
    fireworks(this.root, this._at);
  }

  /** free the lobby (normally it lives for the whole session) */
  destroy(): void {
    this.root.parent?.remove(this.root);
    for (const g of this._geos) if (g) disposeGeometry(this._game, g);
    this._geos = [];
  }
}
