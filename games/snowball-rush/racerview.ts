// Visuals of one racer (owner: world): character, voxel ball, blob shadow, name tag with ball size, emote bubbles, effects.
// The ball is drawn with a visually eased radius (shatter → pops in from 0, smash costs shrink smoothly) and is kept
// touching the racer's hands: center (ballX, r, -(d + r + BALL_AHEAD)) with the eased r. No allocations per frame.
import { Geometry, Material, Mesh, Node, type Game } from 'aiwebengine';
import { h, type UI } from 'aiwebengine/ui';
import type { Racer } from './types';
import { SURF } from './types';
import { animateCharacter, createCharacter, type Character, type Pose } from './character';
import { ballGeometry, ballMaterial } from './skinart';
import { BALL_AHEAD, BODY_H } from './config';
import { voxelSphere } from './blocks';
import { iconURL } from './textures';
import { addCSS } from './theme';
import { tr } from './i18n';
import { pixelBurst } from './fx';
import { blobTexture } from './world';

const CSS = `
.rv-tag{display:flex;flex-direction:column;align-items:center;transition:opacity .25s;font-weight:700}
.rv-tag.off{opacity:0}
.rv-row{display:flex;align-items:center;gap:5u;padding:2u 6u 3u;background:rgba(11,14,26,.58);box-shadow:0 0 0 2u rgba(11,14,26,.85);
font-size:20u;line-height:1.1;color:#fff;text-shadow:2u 2u 0 rgba(0,0,0,.6);white-space:nowrap}
.rv-nm{max-width:150u;overflow:hidden;text-overflow:ellipsis}
.rv-sz{min-width:26u;padding:1u 4u 0;text-align:center;background:#eef6ff;color:#14223a;text-shadow:none;box-shadow:inset -2u -2u 0 #b9cbe0,0 0 0 2u #0b0e1a}
.rv-tag.me .rv-row{font-size:23u;background:#f0a818;box-shadow:inset 0 2u 0 #ffe27a,0 0 0 2u #5a3200;text-shadow:2u 2u 0 #7a4400}
.rv-ic{width:20u;height:20u;image-rendering:pixelated}
.rv-bub{position:relative;max-width:230u;margin-bottom:9u;padding:4u 9u 5u;background:#fff;color:#14182a;font-size:21u;line-height:1.15;
text-shadow:none;box-shadow:0 0 0 3u #0b0e1a;white-space:normal;text-align:center;overflow-wrap:break-word;opacity:0;transform:translateY(6u) scale(.7);
transition:opacity .15s,transform .2s;pointer-events:none}
.rv-bub.on{opacity:1;transform:none}
.rv-bub:after{content:'';position:absolute;left:50%;bottom:-8u;width:8u;height:8u;margin-left:-4u;background:#fff;box-shadow:3u 3u 0 #0b0e1a;clip-path:polygon(0 0,100% 0,0 100%)}
`;

// shared resources (lazily created; never per racer)
let blobMat: Material | null = null;
let blobGeo: Geometry | null = null;
let shieldGeo: Geometry | null = null;
let shieldMat: Material | null = null;
function shared() {
  if (!blobMat) {
    blobMat = new Material({ type: 'unlit', color: 0x0a1028, opacity: 0.32, map: blobTexture(), blend: 'alpha', depthWrite: false, castShadow: false, receiveShadow: false });
    blobGeo = new Geometry().setAttribute('position', [-1, 0, -1, -1, 0, 1, 1, 0, 1, 1, 0, -1], 3).setAttribute('normal', [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3)
      .setAttribute('uv', [0, 0, 0, 1, 1, 1, 1, 0], 2).setIndex([0, 1, 2, 0, 2, 3]);
    // voxel bubble shell (additive glow)
    shieldGeo = voxelSphere(9, (x, y, z) => (Math.abs(x + y * 0.5 - z * 0.3) % 0.5 < 0.12 ? 0xffffff : 0x9fe6ff));
    shieldMat = new Material({ type: 'unlit', color: 0x2f6f96, blend: 'add', depthWrite: false, castShadow: false, receiveShadow: false });
  }
  return { blobMat: blobMat!, blobGeo: blobGeo!, shieldGeo: shieldGeo!, shieldMat: shieldMat! };
}

const SKIN_PARTS = ['head', 'body', 'armR', 'armL', 'legR', 'legL'] as const;
/** phones: only the player casts a sun shadow (7 shadow draws per racer); others use blob shadows */
let phone: boolean | null = null;
const isPhone = () => (phone ??= typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches);

export class RacerView {
  root!: Node;
  private _game: Game;
  private _ch: Character;
  private _parts: Mesh[];
  private _ball: Mesh;
  private _blob: Mesh;
  private _ballBlob: Mesh;
  private _shield: Mesh;
  private _tag: HTMLElement | null = null;
  private _row: HTMLElement | null = null;
  private _sz: HTMLElement | null = null;
  private _bub: HTMLElement | null = null;
  private _tagPos = new Float32Array(3);
  private _at = new Float32Array(3);
  /** state shown in the DOM (update on change only) */
  private _shownSize = -1;
  private _tagOn = true;
  /** eased ball radius, squash/punch, clocks */
  private _vr: number;
  private _punch = 0;
  private _t: number;
  private _fxT = 0;
  private _boostT = 0;
  private _emoteT = 0;
  private _yaw = Math.PI;
  private _van = 0;
  private _cast = true;
  private _first = true;

  constructor(game: Game, ui: UI, public racer: Racer, opts: { label: boolean }) {
    this._game = game;
    const sh = shared();
    this.root = game.scene.add(new Node('racer'));
    this._ch = createCharacter(racer.profile.skin);
    this.root.add(this._ch.root);
    this._parts = SKIN_PARTS.map((k) => this._ch[k] as Mesh);
    this._ball = this.root.add(new Mesh(ballGeometry(racer.profile.ball), ballMaterial(racer.profile.ball)));
    this._blob = this.root.add(new Mesh(sh.blobGeo, sh.blobMat));
    this._ballBlob = this.root.add(new Mesh(sh.blobGeo, sh.blobMat));
    this._blob.castShadow = this._ballBlob.castShadow = false;
    this._blob.renderOrder = this._ballBlob.renderOrder = 1;
    this._shield = this.root.add(new Mesh(sh.shieldGeo, sh.shieldMat));
    this._shield.castShadow = false;
    this._shield.visible = false;
    this._shield.renderOrder = 2;
    this._vr = racer.size / 10;
    this._t = racer.id * 0.37;
    if (opts.label) this._makeTag(ui);
    this.update(0);
  }

  private _makeTag(ui: UI) {
    addCSS('racerview', CSS);
    const r = this.racer, me = r.isPlayer;
    this._sz = h('span', { class: 'rv-sz' }, '0');
    this._bub = h('div', { class: 'rv-bub' });
    this._row = h('div', { class: 'rv-row' },
      r.profile.vip && !me ? h('img', { class: 'rv-ic', src: iconURL('crown'), alt: '' }) : null,
      h('span', { class: 'rv-nm' }, me ? tr({ ru: 'ВЫ', en: 'YOU' }) : r.profile.name),
      this._sz);
    const tag = h('div', { class: 'rv-tag' + (me ? ' me' : '') }, this._bub, this._row);
    this._tag = ui.worldLabel(() => this._tagPos, tag, [0, 0, 0]);
  }

  /** sync with racer state (pose, ball size/rotation, visibility) */
  update(dt: number): void {
    const r = this.racer, c = this._ch, cam = this._game.camera;
    this._t += dt;
    // ---- ball radius (eased), position, rolling
    const target = r.size / 10;
    this._vr += (target - this._vr) * (1 - Math.exp(-(target > this._vr ? 9 : 6) * dt));
    if (this._punch > 0) this._punch = Math.max(0, this._punch - dt * 3);
    const vr = this._vr, van = this._van > 0 ? Math.min(1, this._van / 0.8) : 0;
    if (this._van > 0) this._van += dt;
    const bz = -(r.d + vr + BALL_AHEAD), hasBall = r.size > 0 && vr > 0.03 && van < 1;
    const ball = this._ball;
    ball.visible = hasBall;
    if (hasBall) {
      ball.setPosition(r.ballX, vr * (1 - van) + r.y, bz);
      ball.setRotation(-r.ballRot, 0, 0);
      const k = vr * (1 + 0.18 * Math.sin(this._punch * Math.PI)) * (1 - van);
      ball.setScale(k, vr * (1 - 0.12 * Math.sin(this._punch * Math.PI)) * (1 - van), k);
      // boost: warm pulsing glow on the ball
      const f = ball.flash;
      if (r.boostT > 0) { f[0] = 1; f[1] = 0.75; f[2] = 0.3; f[3] = 0.18 + 0.12 * Math.sin(this._t * 18); } else f[3] = 0;
    }
    // ---- character: position, heading, pose
    const done = r.state === 'done' || (r.state === 'finished' && !r.isPlayer && r.speed < 0.3);
    const wantYaw = done ? (r.x > 0 ? -0.5 : 0.5) : Math.PI + Math.max(-0.3, Math.min(0.3, -r.vx * 0.045));
    this._yaw += (wantYaw - this._yaw) * (1 - Math.exp(-(done ? 4 : 12) * dt));
    c.root.setPosition(r.x, r.y - van * 0.6, -r.d);
    c.root.setRotation(0, this._yaw, 0);
    c.root.setScale(1 - van * 0.9);
    let pose: Pose = 'push';
    switch (r.state) {
      case 'stun': pose = 'stun'; break;
      case 'fall': pose = 'fall'; break;
      case 'done': pose = r.place > 0 && r.place <= 3 ? 'cheer' : 'sad'; break;
      case 'finished': pose = done ? (r.place <= 3 ? 'cheer' : 'sad') : r.size > 0 ? 'push' : 'run'; break;
      default: pose = r.size > 0 ? 'push' : 'run';
    }
    animateCharacter(c, pose, this._t, r.state === 'ready' ? 0 : r.speed, vr);
    // ---- sun shadows near the camera only (the shadow pass is not culled), blob shadows otherwise
    const camD = -cam.position[2];
    const cast = Math.abs(r.d - camD) < (r.isPlayer ? 40 : isPhone() ? -1 : 26);
    if (cast !== this._cast) {
      this._cast = cast;
      for (const p of this._parts) p.castShadow = cast;
      ball.castShadow = cast;
    }
    const ground = r.y > -0.05 && van < 1 && !cast;
    this._blob.visible = ground;
    this._ballBlob.visible = ground && hasBall;
    if (ground) {
      this._blob.setPosition(r.x, 0.02, -r.d).setScale(0.42);
      if (hasBall) this._ballBlob.setPosition(r.ballX, 0.025, bz + vr * 0.15).setScale(vr * 1.05);
    }
    // ---- shield bubble
    const sh = this._shield;
    sh.visible = r.shields > 0 && van < 1;
    if (sh.visible) {
      sh.setPosition(r.x, 0.85 + r.y, -r.d).setRotation(0, this._t * 0.8, 0).setScale(0.95 + 0.04 * Math.sin(this._t * 5));
    }
    // ---- effects near the camera only (throttled)
    const near = Math.abs(r.d - camD) < 40;
    this._fxT -= dt;
    this._boostT -= dt;
    if (near && van === 0) {
      const at = this._at;
      if (r.boostT > 0 && this._boostT <= 0 && r.state !== 'ready') {
        this._boostT = 0.035;
        at[0] = r.x; at[1] = 0.5 + Math.random() * 0.6; at[2] = -r.d + 0.4;
        pixelBurst(this._game.scene, 'boost', at, 2, 1);
      }
      if (this._fxT <= 0 && hasBall && r.speed > 1.5 && (r.state === 'run' || r.state === 'finished')) {
        this._fxT = 0.09;
        if (r.melting) {
          at[0] = r.ballX; at[1] = vr * 1.6; at[2] = bz;
          pixelBurst(this._game.scene, 'steam', at, 3, Math.max(0.8, vr * 1.4));
        } else if (r.surf === SURF.snow) {
          at[0] = r.ballX + (Math.random() - 0.5) * vr * 1.4; at[1] = 0.08; at[2] = bz + vr * 0.4;
          pixelBurst(this._game.scene, 'snow', at, 2, Math.min(1.6, 0.6 + vr));
        }
      }
    }
    // ---- name tag + emote bubble
    if (this._tag) {
      // the player's tag goes last in the DOM: drawn above the bots' tags (all tags stay below the UI layers)
      if (this._first && dt > 0) {
        this._first = false;
        if (r.isPlayer) this._tag.parentElement?.appendChild(this._tag);
      }
      const tp = this._tagPos;
      tp[0] = r.x; tp[1] = Math.max(BODY_H + 0.42, 2 * vr + 0.3) + r.y; tp[2] = -(r.d + Math.min(vr, 0.6));
      const on = van === 0 && r.d - camD < 60 && r.d - camD > -6;
      if (on !== this._tagOn) { this._tagOn = on; this._tag.firstElementChild!.classList.toggle('off', !on); }
      const n = Math.round(r.size);
      if (n !== this._shownSize) { this._shownSize = n; this._sz!.textContent = String(n); this._sz!.style.display = n > 0 ? '' : 'none'; }
      if (this._emoteT > 0) {
        this._emoteT -= dt;
        if (this._emoteT <= 0) this._bub!.classList.remove('on');
      }
    }
  }

  /** the ball broke (obstacle / melted): snow chunks fly, the next ball pops in from nothing */
  shatter(): void {
    const r = this.racer, vr = Math.max(0.25, this._vr), at = this._at;
    at[0] = r.ballX; at[1] = vr; at[2] = -(r.d + vr + BALL_AHEAD);
    pixelBurst(this._game.scene, 'snow', at, Math.round(16 + vr * 18), Math.min(2.4, 0.8 + vr * 1.2));
    pixelBurst(this._game.scene, 'ice', at, 8, 1);
    this._vr = 0;
  }

  /** fell into an ice hole */
  splash(): void {
    const r = this.racer, at = this._at;
    at[0] = r.x; at[1] = -0.35; at[2] = -(r.d + 0.6);
    pixelBurst(this._game.scene, 'splash', at, 30, 1.3);
  }

  /** smashed an obstacle with the ball */
  smash(): void {
    const r = this.racer, vr = Math.max(0.25, this._vr), at = this._at;
    at[0] = r.ballX; at[1] = vr; at[2] = -(r.d + vr * 2 + BALL_AHEAD);
    pixelBurst(this._game.scene, 'snow', at, 14, 1 + vr);
    this._punch = 1;
  }

  /** picked up: 'coin' | 'gem' | 'gift' | power-up ('shield' | 'boost' | 'grow') */
  pickup(kind: string): void {
    const r = this.racer, at = this._at;
    at[0] = r.x; at[1] = 1.1; at[2] = -r.d;
    if (kind === 'coin') pixelBurst(this._game.scene, 'coin', at, 6, 0.8);
    else if (kind === 'gem') pixelBurst(this._game.scene, 'gem', at, 16, 1);
    else if (kind === 'grow') { this._punch = 1; pixelBurst(this._game.scene, 'snow', at, 20, 1.3); }
    else if (kind === 'shield') pixelBurst(this._game.scene, 'ice', at, 18, 1);
    else if (kind === 'boost') pixelBurst(this._game.scene, 'spark', at, 16, 1.2);
    else pixelBurst(this._game.scene, 'gift', at, 18, 1);
  }

  /** speech bubble above the name tag for ~2.2 s */
  emote(text: string): void {
    if (!this._bub || this._van > 0) return;
    this._bub.textContent = text;
    this._bub.classList.add('on');
    this._emoteT = 2.2;
  }

  /** the racer left (fake disconnect): poof into snow and fade out */
  vanish(): void {
    if (this._van > 0) return;
    this._van = 1e-4;
    const r = this.racer, at = this._at;
    at[0] = r.x; at[1] = 0.9; at[2] = -r.d;
    pixelBurst(this._game.scene, 'puff', at, 26, 1.4);
    for (const p of this._parts) { p.flash[0] = p.flash[1] = p.flash[2] = 1; p.flash[3] = 0.6; }
    this._bub?.classList.remove('on');
  }

  destroy(): void {
    this.root.parent?.remove(this.root);
    this._tag?.remove();
    this._tag = this._row = this._sz = this._bub = null;
  }
}
