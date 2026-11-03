// Dev harness for the art modules (textures, blocks, skins, characters, balls). Not part of the game build.
// Views: ?v=all (default) | chars | back | hero | balls | ui ; ?pose=push|run|... forces a pose ; ?t=1.2 freezes time.
import { createGame, DirectionalLight, Material, Mesh, type Texture } from 'aiwebengine';
import { BALL_IDS, SKIN_IDS } from '../types';
import { ballGeometry, ballIcon, ballMaterial, loadSkinAssets, skinCanvas, skinFigure, skinPortrait } from '../skinart';
import { animateCharacter, createCharacter, type Character, type Pose } from '../character';
import { blockMaterial, boxGeometry, buildBlocks, crossSprite, type Block } from '../blocks';
import { ICON_IDS, TEX_IDS, iconURL, signTexture, texCanvas } from '../textures';

const q = new URLSearchParams(location.search);
const view = q.get('v') ?? 'all';
const forced = q.get('pose') as Pose | null;
const fixedT = q.has('t') ? +q.get('t')! : null;

const game = await createGame({ antialias: true });
await loadSkinAssets();
const { scene, camera } = game;
scene.setSky({ top: 0x4f86d6, horizon: 0xdcecff, bottom: 0xe8f0f8 });
scene.setAmbient(0xdfeaff, 0x9aa2b0, 0.62);
scene.setFog(0xdcecff, 30, 80);
const sun = scene.add(new DirectionalLight({ direction: [-0.45, -1, -0.55], intensity: 1.35, shadow: { size: 2048, extent: 16 } }));
sun.shadowFocus = [0, 0, -2];

// ---------------------------------------------------------------- ground
const floor: Block[] = [];
for (let x = -12; x <= 12; x++) for (let z = -14; z <= 6; z++) floor.push({ x, y: -0.5, z: z - 0.5, t: ['snow', 'snowSide', 'dirt'] });
for (let x = -12; x <= 12; x++) floor.push({ x, y: -1.5, z: 6 - 0.5, t: 'dirt' });
scene.add(buildBlocks(floor, { noBottom: true, chunk: 8 }));

// ---------------------------------------------------------------- characters
const chars: { c: Character; pose: Pose; off: number }[] = [];
const poses: Pose[] = ['push', 'run', 'cheer', 'idle', 'wave', 'stun', 'fall', 'sad'];
function addChar(id: string, x: number, z: number, scale: number, pose: Pose, yaw = 0) {
  const c = createCharacter(id);
  c.root.setPosition(x, 0, z).setRotation(0, yaw, 0).setScale(scale);
  scene.add(c.root);
  chars.push({ c, pose: forced ?? pose, off: chars.length * 0.37 });
  return c;
}
function addBall(id: string, x: number, y: number, z: number, r: number) {
  const m = scene.add(new Mesh(ballGeometry(id), ballMaterial(id)));
  m.setPosition(x, y, z).setScale(r);
  m.data.spin = 1;
  return m;
}
const balls: Mesh[] = [];

if (view === 'all' || view === 'chars' || view === 'back') {
  const back = view === 'back', yaw = back ? Math.PI : 0;
  // Нубик first and biggest, pushing his snowball
  addChar('noob', -0.2, 2.2, 1.35, 'push', yaw);
  balls.push(addBall('snow', -0.2, 0.62, 2.2 + (back ? -1 : 1) * (0.62 + 0.45 * 1.35), 0.62));
  SKIN_IDS.slice(1).forEach((id, i) => {
    const row = i < 7 ? 0 : 1, k = row ? i - 7 : i;
    addChar(id, -6.3 + k * 2.1 + row * 1.05, row ? -2.6 : -0.4, 1, poses[(i + 3) % poses.length], yaw);
  });
}
if (view === 'gallery') {
  const yaw = +(q.get('yaw') ?? 0.3);
  SKIN_IDS.forEach((id, i) => addChar(id, -4.5 + (i % 7) * 1.5, i < 7 ? 0.8 : -1.6, 1, forced ?? 'idle', yaw));
}
const pushers: { c: Character; r: number }[] = [];
if (view === 'race') {
  // DESIGN §1: racers face -Z, ball rolls 0.45 m in front, camera behind & above the player
  const lanes: [string, string, number, number, number][] = [['noob', 'snow', 0, 0, 0.35], ['santa', 'gold', -2.4, -2, 0.9], ['elf', 'candy', 2.4, 1.5, 0.6], ['snowmaiden', 'ice', -4.8, -4, 1.4], ['hockey', 'garland', 4.8, -3, 0.5]];
  for (const [skin, ball, x, d, r] of lanes) {
    const c = addChar(skin, x, -d, 1, 'push', Math.PI);
    pushers.push({ c, r });
    balls.push(addBall(ball, x, r, -(d + r + 0.45), r));
  }
}
if (view === 'side') {
  // push pose vs ball size, seen from the side
  [0.3, 0.6, 1.0, 1.6].forEach((r, i) => {
    const x = -7 + i * 3.6;
    pushers.push({ c: addChar(i % 2 ? 'santa' : 'noob', x, 0, 1, 'push', Math.PI / 2), r });
    balls.push(addBall('snow', x + r + 0.45, r, 0, r));
  });
}
if (view === 'hero') {
  addChar('noob', -1.3, 0, 1, forced ?? 'idle', 0.35);
  addChar('winter', 1.3, 0, 1, forced ?? 'wave', -0.35);
  balls.push(addBall('snow', 0, 0.5, 1.3, 0.5));
}
if (view === 'all' || view === 'balls') {
  BALL_IDS.forEach((id, i) => balls.push(addBall(id, -8 + i * 2, 0.75, view === 'balls' ? 1 : -5, 0.75)));
}
const signMat = (map: Texture, cut = false) => new Material({ type: 'unlit', map, alphaTest: cut ? 0.5 : 0 });
if (view === 'all' || view === 'balls' || view === 'blocks') {
  // every texture as a block, plus a tiny decorated corner
  const z0 = view === 'all' ? -9 : -3;
  const blocks: Block[] = TEX_IDS.filter((t) => t !== 'fire' && t !== 'voxel').map((t, i) => ({ x: -9 + (i % 18), y: 0.5 + Math.floor(i / 18), z: z0 - Math.floor(i / 18) * 0.0, t }));
  blocks.push({ x: 10, y: 1.5, z: z0, t: ['logTop', 'log', 'logTop'] }, { x: 10, y: 2.5, z: z0, t: ['logTop', 'log', 'logTop'] });
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) blocks.push({ x: 10 + dx, y: 3.5, z: z0 + dz, t: 'snowLeaves' });
  blocks.push({ x: 10, y: 4.5, z: z0, t: 'snowLeaves' }, { x: 12, y: 0.75, z: z0, t: 'giftRed', sx: 1.5, sy: 1.5, sz: 1.5 });
  scene.add(buildBlocks(blocks));
  const fire = scene.add(new Mesh(crossSprite(1, 1.2), blockMaterial('fire')));
  fire.setPosition(-10.5, 0, z0);
  // an ice wall with a strength sign
  const wall = scene.add(new Mesh(boxGeometry(3, 3, 1), blockMaterial('iceWall')));
  wall.setPosition(-6, 1.5, z0 - 3);
  const sign = scene.add(new Mesh(boxGeometry(2.4, 1.2, 0.05, true), signMat(signTexture('15', '#ffffff', 'none'), true)));
  sign.setPosition(-6, 1.7, z0 - 2.47);
  const ban = scene.add(new Mesh(boxGeometry(6, 1, 0.1, true), signMat(signTexture('ФИНИШ', '#ffffff', '#c81e2a', { w: 96, h: 16 }))));
  ban.setPosition(0, 2.6, z0 - 3);
  const ban2 = scene.add(new Mesh(boxGeometry(3, 1.5, 0.1, true), signMat(signTexture('x2', '#ffe14a', '#2a7f3a'))));
  ban2.setPosition(5, 1.5, z0 - 3);
}

// ---------------------------------------------------------------- camera
const cams: Record<string, [number[], number[], number]> = {
  all: [[0, 5.5, 11], [0, 0.6, -3], 55],
  chars: [[0, 2.4, 8.2], [0, 1.0, -0.8], 50],
  back: [[0, 3.0, 8.2], [0, 1.0, -0.8], 50],
  hero: [[0, 1.3, 4.2], [0, 0.85, 0], 40],
  gallery: [[0, 2.6, 7.4], [0, 0.6, -0.5], 50],
  race: [[0, 4.92, 6.99], [0, 0.8, -7], 58],
  side: [[-1, 1.4, 13], [-1, 1, 0], 40],
  balls: [[0, 3.6, 9.5], [0, 0.8, -1], 55],
  blocks: [[-1, 3.2, 5], [-1, 1, -4], 60],
  ui: [[0, 3, 10], [0, 0, 0], 50],
};
const [cp, ct, fov] = cams[view] ?? cams.all;
camera.fov = fov;
camera.setPosition(cp[0], cp[1], cp[2]);
camera.lookAt(ct as [number, number, number]);

game.onUpdate((dt) => {
  const t = fixedT ?? game.time.elapsed;
  for (const { c, pose, off } of chars) animateCharacter(c, pose, t + off, 6.4, pushers.find((p) => p.c === c)?.r ?? 0.62);
  for (const b of balls) if (fixedT === null) b.setRotation(-t * 1.5, 0.4, 0);
  void dt;
});

// ---------------------------------------------------------------- DOM strip
const strip = document.createElement('div');
strip.id = 'strip';
if (view === 'ui') strip.className = 'full';
if (view === 'all' || view === 'ui') document.body.appendChild(strip);
const sec = (title: string) => {
  const h = document.createElement('h4');
  h.textContent = title;
  const r = document.createElement('div');
  r.className = 'row';
  strip.append(h, r);
  return r;
};
const cell = (row: HTMLElement, el: HTMLElement, label: string, size?: number, h?: number) => {
  const c = document.createElement('div');
  c.className = 'cell';
  if (size) { el.style.width = size + 'px'; el.style.height = (h ?? size) + 'px'; }
  const s = document.createElement('span');
  s.textContent = label;
  c.append(el, s);
  row.appendChild(c);
};
const big = view === 'ui';
let r = sec('icons');
for (const id of ICON_IDS) { const im = new Image(); im.src = iconURL(id); cell(r, im, id, big ? 48 : 32); }
if (big) { r = sec('icons 24px'); for (const id of ICON_IDS) { const im = new Image(); im.src = iconURL(id); cell(r, im, '', 24); } }
r = sec('portraits');
for (const id of SKIN_IDS) cell(r, skinPortrait(id, big ? 64 : 48), id);
r = sec('figures');
for (const id of SKIN_IDS) cell(r, skinFigure(id, big ? 160 : 96), id);
r = sec('balls');
for (const id of BALL_IDS) cell(r, ballIcon(id, big ? 64 : 48), id);
r = sec('signs');
for (const [t, fg, bg, o] of [['15', '#fff', '#1d4f91'], ['x2', '#ffe14a', '#2a7f3a'], ['x1.5', '#fff', '#7b3fe4'], ['+3', '#fff', 'none'], ['ФИНИШ', '#fff', '#c81e2a', { w: 96, h: 16 }], ['FINISH', '#fff', '#c81e2a', { w: 96, h: 16 }], ['ゴール', '#fff', '#c81e2a', { w: 96, h: 16 }], ['انطلق', '#fff', '#2a7f3a', { w: 96, h: 16 }], ['ज़िंदगी', '#fff', '#1d4f91', { w: 96, h: 16 }], ['ชนะ', '#fff', '#1d4f91'], ['30', '#fff', '#b00']] as [string, string, string, object?][]) {
  const c = signTexture(t, fg, bg, o).source as HTMLCanvasElement;
  cell(r, c, t, c.width * 2, c.height * 2);
}
r = sec('textures');
for (const id of TEX_IDS) cell(r, texCanvas(id), id, big ? 48 : 32);
r = sec('skins');
for (const id of SKIN_IDS) cell(r, skinCanvas(id), id, big ? 128 : 64);

(window as any).game = game;
(window as any).artReady = true;
