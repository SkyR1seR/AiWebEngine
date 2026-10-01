// Noob Ride Master: build a car from blocks, wheels and fans in the garage, hold to blow the fans, bring the noob to the finish.
import {
  createGame, Mesh, Node, Geometry, Texture, unlit, DirectionalLight, Instances, cylinder, lambert, m4compose, m4decompose, qeuler, quat, v3, damp, clamp, rand, after,
} from 'aiwebengine';
import { PhysicsWorld, boxShape, type Body } from 'aiwebengine/physics';
import { presets, burst, CameraShake } from 'aiwebengine/fx';
import { UI, h, u } from 'aiwebengine/ui';
import { sound } from 'aiwebengine/audio';
import { yandex } from 'aiwebengine/yandex';
import { makeLevel, buildTrack, setLevels, loadBlockTextures, blockTex, textureURL, surfaceY, PISTON_DIR, type Track, type Level } from './track';
import { Obstacles } from './obstacles';
import { Car } from './car';
import { FAN, SEAT, GW, GH, CELL, kindOf, connected } from './parts';
import { Garage, readSave, type Save } from './garage';
import { createMenu } from './menu';
import { applyTheme, UI_FONT } from './theme';
import { px, FanHum } from './fx';
import { skinList, skinTexture } from './skins';
import { setModels, type Models } from './models';
import partModels from './parts.json';
import levelData from './levels.json';

// part models (edited in editor.html) must be set before anything builds a car
setModels(partModels as unknown as Models);
// levels made in levels.html (levels past the list are generated)
setLevels((levelData as unknown as { levels: Level[] }).levels);

const yaInit = yandex();
// 120 Hz physics: fast cars move half as far per step (wheels and the frame don't tunnel into the ground)
const game = await createGame({ fixedStep: 1 / 120 });
const ya = await yaInit;
ya.game = game;
const ru = !ya.lang || ['ru', 'be', 'kk', 'uk', 'uz'].includes(ya.lang);
const T = ru ? {
  level: 'Уровень', go: 'ПОЕХАЛИ!', garage: 'Гараж', needFan: 'Поставь на машину вентилятор!', loose: 'Не прикреплено деталей: ',
  hold: 'Держи палец на экране — вентиляторы дуют', holdPc: 'Зажми мышь или Пробел — вентиляторы дуют',
  hint: 'Перетаскивай детали. Два одинаковых = деталь уровнем выше', tutHint: 'Перетащи колёса и вентилятор из инвентаря на машину',
  win: 'ФИНИШ!', crash: 'АВАРИЯ!', stuck: 'ЗАСТРЯЛ!', fell: 'УПАЛ!', passed: 'Пройдено', next: 'ДАЛЬШЕ', retry: 'ЕЩЁ РАЗ', toGarage: 'В ГАРАЖ', x2: 'x2 за рекламу',
  g: {
    ru, inventory: 'Инвентарь', wheel: 'Колесо', fan: 'Вентилятор', full: 'Инвентарь полон', noMoney: 'Не хватает монет',
    frameStays: 'Раму и сиденье нельзя убрать с машины', noRoom: 'Сюда нельзя: там место нубика', merged: 'Улучшено до уровня',
    tut: 'Перетаскивай детали пальцем', level: 'Уровень', radius: 'диаметр', thrust: 'тяга', up: 'вверх', fwd: 'вперёд',
    mass: 'Масса', wheels: 'колёс', fans: 'вентиляторов',
    split: 'Разделить', splitDone: 'Разделено на две детали уровня', splitLow: 'Деталь 1 уровня не разделить',
    splitFull: 'Нет места в инвентаре для двух деталей',
  },
  m: {
    title: 'NOOB\nRIDE MASTER', play: 'ИГРАТЬ', levels: 'УРОВНИ', skins: 'СКИНЫ', back: 'Назад', buy: 'Купить', select: 'Выбрать',
    selected: 'Выбран ✔', noMoney: 'Не хватает монет', level: 'Уровень',
  },
} : {
  level: 'Level', go: 'RIDE!', garage: 'Garage', needFan: 'Put a fan on the car!', loose: 'Loose parts: ',
  hold: 'Hold the screen to blow the fans', holdPc: 'Hold the mouse or Space to blow the fans',
  hint: 'Drag the parts. Two equal parts = a higher level part', tutHint: 'Drag the wheels and the fan from the inventory onto the car',
  win: 'FINISH!', crash: 'CRASH!', stuck: 'STUCK!', fell: 'FELL!', passed: 'Progress', next: 'NEXT', retry: 'RETRY', toGarage: 'GARAGE', x2: 'x2 for an ad',
  g: {
    ru, inventory: 'Inventory', wheel: 'Wheel', fan: 'Fan', full: 'Inventory is full', noMoney: 'Not enough coins',
    frameStays: 'The frame and the seat stay on the car', noRoom: "Can't go there: the noob sits there", merged: 'Upgraded to level',
    tut: 'Drag the parts', level: 'Level', radius: 'diameter', thrust: 'thrust', up: 'up', fwd: 'forward',
    mass: 'Mass', wheels: 'wheels', fans: 'fans',
    split: 'Split', splitDone: 'Split into two parts of level', splitLow: "A level 1 part can't be split",
    splitFull: 'No room in the inventory for two parts',
  },
  m: {
    title: 'NOOB\nRIDE MASTER', play: 'PLAY', levels: 'LEVELS', skins: 'SKINS', back: 'Back', buy: 'Buy', select: 'Select',
    selected: 'Selected ✔', noMoney: 'Not enough coins', level: 'Level',
  },
};

const { scene, camera } = game;
camera.fov = 45;
camera.fit = 'contain';
camera.designAspect = 16 / 9;
scene.setSky({ top: 0x5a9cff, horizon: 0xcfe6ff, bottom: 0xcfe6ff });
scene.setFog(0xcfe6ff, 40, 110);
scene.setAmbient(0xdfeeff, 0x7a6a50, 0.65);
const sun = scene.add(new DirectionalLight({ direction: [-0.4, -1, -0.45], intensity: 1.15, shadow: { extent: 30, size: 2048 } }));
/**
 * Shadow distance: the first step covers the background trees (z down to -30); on a slow device it steps down to the area
 * around the car (and a smaller map), and back up once the frame rate has been fine for a while.
 */
const SHADOW = [{ extent: 30, size: 4096 }, { extent: 30, size: 2048 }, { extent: 20, size: 2048 }, { extent: 12, size: 1024 }];
// phones start without the 4096 map
const minStep = matchMedia('(pointer: coarse)').matches ? 1 : 0;
let shadowStep = minStep, frameAvg = 1 / 60, slowFor = 0, fastFor = 0, lastFrame = performance.now();
function setShadow(step: number) {
  shadowStep = step;
  sun.shadow.extent = SHADOW[step].extent;
  sun.shadow.size = SHADOW[step].size;
}
setShadow(shadowStep);
/** real frame time -> shadow step (called every frame) */
function adaptShadows() {
  const now = performance.now(), dt = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
  if (document.hidden) return;
  frameAvg += (dt - frameAvg) * 0.05;
  // below ~45 fps for 2 s -> less shadow; above ~57 fps for 10 s -> more (never above the device's starting step)
  slowFor = frameAvg > 1 / 45 ? slowFor + dt : 0;
  fastFor = frameAvg < 1 / 57 ? fastFor + dt : 0;
  if (slowFor > 2 && shadowStep < SHADOW.length - 1) { setShadow(shadowStep + 1); slowFor = 0; frameAvg = 1 / 50; }
  else if (fastFor > 10 && shadowStep > minStep) { setShadow(shadowStep - 1); fastFor = 0; }
}
const world = game.addSystem(new PhysicsWorld());
const shake = new CameraShake(game);

// ---------------------------------------------------------------- save & skins
let save: Save = readSave(await ya.load<Save>());
const persist = () => ya.save(save);
const skins = skinList(ru);
const skinOf = () => skins.find((s) => s.id === save.skin) ?? skins[0];
let skinTex: Texture = await skinTexture(skinOf());
// block textures before the first level is built
await loadBlockTextures();

// ---------------------------------------------------------------- world
/** garage / start position (grid bottom center) */
const G = [0, 0.45, 0];
const startX = G[0];
let track: Track | null = null;
let trackLevel = -1;
let obs: Obstacles | null = null;
/** estimated route length to the finish (progress bar), lowest ground (falling off) */
let routeLen = 1, lowY = 0;
// money: gold ingots - a flat sprite spinning around Y, like a dropped item in Minecraft (a gold disc without the texture)
const coinGeo = blockTex.gold
  ? new Geometry().setAttribute('position', [-0.4, -0.4, 0, 0.4, -0.4, 0, 0.4, 0.4, 0, -0.4, 0.4, 0], 3)
    .setAttribute('normal', [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3).setAttribute('uv', [0, 1, 1, 1, 1, 0, 0, 0], 2).setIndex([0, 1, 2, 0, 2, 3])
  : cylinder(0.28, 0.28, 0.08, 10).flatShade().transform(m4compose(new Float32Array(16), [0, 0, 0], qeuler(quat(), Math.PI / 2, 0, 0), [1, 1, 1]));
const coinMesh = scene.add(new Mesh(coinGeo, blockTex.gold
  ? lambert(0xffffff, { map: blockTex.gold, alphaTest: 0.5, cull: 'none', emissive: 0xffd040, emissiveIntensity: 0.35 })
  : lambert(0xffd23f, { emissive: 0xffb000, emissiveIntensity: 0.4 })));
// no real shadow (a spinning sprite casts a flickering one): a soft dark circle on the surface under each ingot
coinMesh.castShadow = false;
const coinInst = (coinMesh.instances = new Instances(256));
const blobTex = (() => {
  const n = 32, d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
    d[(y * n + x) * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, (1 - r) * 2.5)));
  }
  return Texture.fromPixels(d, n, n);
})();
const blob = scene.add(new Mesh(
  new Geometry().setAttribute('position', [-0.35, 0, 0.35, 0.35, 0, 0.35, 0.35, 0, -0.35, -0.35, 0, -0.35], 3)
    .setAttribute('normal', [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3).setAttribute('uv', [0, 1, 1, 1, 1, 0, 0, 0], 2).setIndex([0, 1, 2, 0, 2, 3]),
  unlit(0x000000, { map: blobTex, opacity: 0.35, depthWrite: false, fog: false }),
));
blob.castShadow = false;
const blobInst = (blob.instances = new Instances(256));
// menu and garage: the level stays hidden behind a wall of dirt blocks (tiled, one block per car cell) and a vignette
const backdrop = (() => {
  const S = 60, T = S / 0.5;
  const m = scene.add(new Mesh(
    new Geometry().setAttribute('position', [-S, -S, 0, S, -S, 0, S, S, 0, -S, S, 0], 3)
      .setAttribute('normal', [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3).setAttribute('uv', [0, T, T, T, T, 0, 0, 0], 2).setIndex([0, 1, 2, 0, 2, 3]),
    unlit(0x8c8c8c, { map: blockTex.dirt, fog: false }),
  ));
  m.castShadow = false;
  m.setPosition(G[0], G[1], -6);
  return m;
})();
const vignette = h('div', { style: { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '5', background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 50%, rgba(0,0,0,.6) 100%)' } });
document.body.append(vignette);
/** garage / menu look (dirt wall, vignette, no level) or the ride (the level) */
function garageView(on: boolean) {
  backdrop.visible = on;
  vignette.style.display = on ? '' : 'none';
  if (track) track.root.visible = !on;
  coinMesh.visible = blob.visible = !on;
}
/** surface height under each coin (null over a gap) */
let coinGround: (number | null)[] = [];
let coinTaken: boolean[] = [];

function loadLevel(n: number) {
  if (track && trackLevel === n) return;
  track?.destroy();
  track = buildTrack(makeLevel(n), world, scene);
  trackLevel = n;
  routeLen = route(track.level);
  lowY = Math.min(...track.level.pieces.flatMap((p) => p.filter((_, i) => i % 2)));
  resetObstacles();
}
/** lifts back to their start, spikes from the beginning of their cycle */
function resetObstacles() {
  obs?.destroy();
  obs = new Obstacles(track!.level, world, track!.root);
}
/**
 * Rough length of the way to the finish: from the start to the right, and at each turn pad on the way (the one closest in
 * height to where the car is) back the other way, until the finish is ahead.
 */
function route(L: Level) {
  // side pistons turn the car: their face x, the level of the block's bottom
  const turns = (L.pistons ?? []).filter((p) => PISTON_DIR[p[2] & 3]?.[0]).map((p) => [p[0], p[1] - 0.5]);
  let x = startX, y = 0, dir = 1, len = 0;
  for (let k = 0; k < 50; k++) {
    const ahead = turns.filter((t) => dir * (t[0] - x) > 0).sort((a, b) => Math.abs(a[1] - y) - Math.abs(b[1] - y) || Math.abs(a[0] - x) - Math.abs(b[0] - x));
    const fin = dir * (L.finishX - x) > 0 ? Math.abs(L.finishY! - y) : Infinity;
    if (!ahead.length || fin <= Math.abs(ahead[0][1] - y)) { len += Math.abs(L.finishX - x); break; }
    const t = ahead[0];
    len += Math.abs(t[0] - x);
    x = t[0]; y = t[1]; dir = -dir;
    turns.splice(turns.indexOf(t), 1);
  }
  return Math.max(1, len);
}
function resetCoins() {
  const L = track!.level;
  coinTaken = L.coins.map(() => false);
  coinGround = L.coins.map((c) => surfaceY(L, c[0], c[1]));
  coinInst.count = blobInst.count = Math.min(256, coinTaken.length);
}

// ---------------------------------------------------------------- UI
const ui = new UI(game, { reference: [1280, 720], match: 0.5, font: UI_FONT });
applyTheme();
// money icon in the UI: class "gi" puts a gold ingot before the text ("gi-after" after it)
{
  const url = textureURL('gold_ingot');
  const icon = url ? `background:url(${url}) center/contain no-repeat;image-rendering:pixelated` : 'background:radial-gradient(#ffe066 55%,#b8860b 60%,transparent 62%)';
  const box = `content:'';display:inline-block;width:1.15em;height:1.15em;vertical-align:-0.22em;${icon}`;
  document.head.append(h('style', null, `.gi,.gi-after{white-space:nowrap}.gi::before{${box};margin-right:.2em}.gi-after::after{${box};margin-left:.2em}`));
}
document.head.append(h('style', null, `.ui-a>div{pointer-events:none}.ui-a>div.inv-wrap{pointer-events:auto}`));
type State = 'menu' | 'build' | 'ride' | 'end';
let state: State = 'menu';

const garage = new Garage(game, ui, () => save, persist, () => skinTex, T.g, () => state === 'build', () => updateTop(), G);

const buildUI: HTMLElement[] = [];
const menuBtn = ui.button('☰', () => openMenu(), 'top-left');
menuBtn.style.padding = `${u(10)} ${u(20)}`;
buildUI.push(menuBtn);
const levelLbl = ui.text('', 'top-left', { fontSize: u(30), fontWeight: '900' });
// sound on/off: top-right corner, above everything (menus and the result screen too); remembered in the save
sound.mute(!!save.muted);
const soundBtn = ui.button('', () => {
  sound.mute(!sound.muted);
  save.muted = sound.muted;
  persist();
  showSound();
  if (!sound.muted) sound.sfx('click', 0.5);
}, 'top-right');
Object.assign(soundBtn.style, { position: 'relative', zIndex: '20', padding: `${u(10)} ${u(16)}`, fontSize: u(36), lineHeight: '1' });
const showSound = () => { soundBtn.textContent = sound.muted ? '🔇' : '🔊'; };
showSound();
const coinLbl = ui.text('', 'top-left', { fontSize: u(26), color: '#ffe066' });
/** coin counter text (the ingot icon only when there's a number) */
const setCoins = (s: string) => { coinLbl.set(s); coinLbl.el.classList.toggle('gi', !!s); };
const hintLbl = ui.text('', 'top', { fontSize: u(20), textAlign: 'center' });
const infoLbl = ui.text('', 'top', { fontSize: u(17), opacity: '0.85' });
buildUI.push(hintLbl.el, infoLbl.el);
const goBtn = ui.button(T.go, () => startRide(), 'right', 'green');
goBtn.style.fontSize = u(34);
goBtn.style.padding = `${u(22)} ${u(40)}`;
buildUI.push(goBtn);

const rideUI: HTMLElement[] = [];
const progress = ui.bar(0, 'top', 'linear-gradient(#ffe066,#ffb000)', 460);
rideUI.push(progress.el);
rideUI.push(ui.button('⟲ ' + T.garage, () => { if (state === 'ride') { ya.gameplayStop(); toGarage(); } }, 'top-right'));
const holdLbl = ui.text(ui.isTouch ? T.hold : T.holdPc, 'bottom', { fontSize: u(22) });
rideUI.push(holdLbl.el);

// result screen
const resTitle = h('div', { class: 'ui-title' });
const resSub = h('div', { class: 'ui-big' });
const resCoins = h('div', { class: 'gi-after', style: { fontSize: u(30), color: '#ffe066', fontWeight: '800' } });
const resBtns = h('div', { style: { display: 'flex', gap: u(16), flexWrap: 'wrap', justifyContent: 'center' } });
ui.screen('result', resTitle, resSub, resCoins, resBtns);

const menu = createMenu(ui, () => save, persist, skins, T.m, {
  play: () => toGarage(),
  pickLevel: (n) => { save.level = n; persist(); toGarage(); },
  pickSkin: async (s) => { skinTex = await skinTexture(s); garage.refresh(); },
});

const showAll = (els: HTMLElement[], on: boolean) => { for (const e of els) e.style.display = on ? '' : 'none'; };

function layout() {
  const portrait = game.screen.portrait;
  camera.designAspect = portrait ? 0.95 : 16 / 9;
  garage.layout(portrait);
  ui.add(goBtn, portrait ? 'right' : 'bottom-right');
  progress.el.style.width = u(portrait ? 240 : 460);
  infoLbl.el.style.visibility = portrait ? 'hidden' : '';
  // portrait: the hint sits right above the inventory
  if (portrait) ui.anchor('bottom').prepend(hintLbl.el);
  else ui.anchor('top').prepend(hintLbl.el);
}
game.screen.onResize(layout);
layout();

function updateTop() {
  levelLbl.set(`${T.level} ${save.level + 1}`);
  setCoins(`${save.coins}`);
  hintLbl.set(save.tut ? T.hint : T.tutHint);
  infoLbl.set(garage.info());
}

// ---------------------------------------------------------------- game flow
let car: Car | null = null;
let ragdoll: Body | null = null;
let ragNode: Node | null = null;
let stuckTime = 0, runCoins = 0, rides = 0;
/** odometer along the route: `base` + distance driven in the current direction since `legX`; best = furthest so far */
let odo = { base: 0, legX: 0, dir: 1, best: 0, top: 0 };
let prevX = 0, mudT = 0;
/** bumps on every ride start/end: delayed end-of-ride callbacks of an older ride are ignored */
let rideId = 0;

function cleanupRide() {
  fanHum.stop();
  rideId++;
  car?.destroy();
  car = null;
  if (obs) { obs.touch = null; obs.car = null; obs.onCrush = obs.onPiston = undefined; }
  if (ragdoll) { world.remove(ragdoll); ragdoll = null; }
  ragNode?.destroy();
  ragNode = null;
  game.input.virtualButtons.clear();
}

function toGarage() {
  cleanupRide();
  state = 'build';
  ui.hide();
  loadLevel(save.level);
  resetCoins();
  garage.fitLevel(save.level, track!.level);
  garage.setVisible(true);
  garageView(true);
  showAll(buildUI, true);
  showAll(rideUI, false);
  updateTop();
}

function openMenu() {
  if (state === 'ride' || state === 'end') return;
  state = 'menu';
  loadLevel(save.level);
  resetCoins();
  // the level's grid size and frame blocks (applied to the saved car); the menu shows only the dirt backdrop, no car
  garage.fitLevel(save.level, track!.level);
  garage.setVisible(false);
  garageView(true);
  showAll(buildUI, false);
  showAll(rideUI, false);
  // the menu screens show their own coin counter
  levelLbl.set('');
  setCoins('');
  menu.show();
}

function startRide() {
  const d = save.design, keep = connected(d);
  let loose = 0, fans = 0;
  d.forEach((v, i) => { if (v && !keep.has(i)) loose++; if (keep.has(i) && kindOf(v) === FAN) fans++; });
  if (!fans) { ui.toast(T.needFan); sound.sfx('hit', 0.5); return; }
  if (loose) ui.toast(T.loose + loose);
  sound.sfx('powerup', 0.6);
  garage.setVisible(false);
  garageView(false);
  resetObstacles();
  car = new Car(world, d, skinTex, scene, G);
  car.hazards = obs;
  obs!.touch = car.touch;
  obs!.car = car;
  obs!.onPiston = () => sound.sfx('jump', 0.8);
  obs!.onCrush = () => { if (car && state === 'ride') { car.crush(); shake.add(0.8); sound.sfx('explosion', 0.6); } };
  car.onCrash = () => crash();
  car.onFlip = () => {
    // slime pad: new leg of the route
    const x = car!.body.position[0];
    odo.base += odo.dir * (x - odo.legX);
    odo.legX = x;
    odo.dir = car!.facing;
    sound.sfx('jump', 0.7);
    burst(scene, px({ ...presets.hit(), color: [0xa8834f, 0x7a5a33] }), 16, [x + odo.dir * -1.2, car!.body.position[1], 0]);
  };
  car.onBreak = (at, part) => {
    sound.sfx('hit', 0.8);
    burst(scene, px(presets.dust(), 0.35), 14, at);
    burst(scene, px({ ...presets.hit(), color: kindOf(part) === SEAT ? [0xc0302a, 0x7a1a16] : [0xc29d66, 0x6e5230] }), 12, at);
    shake.add(0.35);
  };
  state = 'ride';
  stuckTime = runCoins = 0;
  odo = { base: 0, legX: G[0], dir: 1, best: 0, top: G[1] };
  prevX = G[0];
  setCoins('+0');
  resetCoins();
  showAll(buildUI, false);
  showAll(rideUI, true);
  rides++;
  rideId++;
  ya.gameplayStart();
}

function crash() {
  if (state !== 'ride' || !car) return;
  state = 'end';
  const n = car.vis.noob, nr = n.root;
  // throw the noob out of the car as a tumbling ragdoll box
  nr.updateWorld();
  const p = v3(), q = quat(), s = v3();
  m4decompose(nr.worldMatrix, p, q, s);
  scene.add(nr);
  nr.position.set(p);
  nr.rotation.set(q);
  n.armR.setRotation(-2.8, 0, 0.3);
  n.armL.setRotation(-2.8, 0, -0.3);
  ragNode = nr;
  const v = car.body.velocity;
  ragdoll = world.add(nr, { shape: boxShape(0.16, 0.42, 0.16), offset: [0, 0.45, 0], mass: 45, friction: 0.8, restitution: 0.25, linearFactor: [1, 1, 0] });
  ragdoll.setVelocity(v[0] * 0.7, Math.max(3, v[1] + 4), 0);
  ragdoll.angularVelocity[2] = rand(-7, 7);
  ragdoll.angularVelocity[0] = rand(-3, 3);
  car.thrust = false;
  shake.add(0.7);
  sound.sfx('hit');
  sound.sfx('explosion', 0.5);
  burst(scene, px(presets.hit()), 24, [p[0], p[1] + 0.6, p[2]]);
  const id = rideId;
  after(1.6, () => { if (id === rideId) finish('crash'); });
}

function finish(kind: 'win' | 'crash' | 'stuck' | 'fell') {
  state = 'end';
  ya.gameplayStop();
  game.input.virtualButtons.clear();
  if (car) car.thrust = false;
  const lvl = track!.level;
  const dist = odo.best;
  const prog = kind === 'win' ? 1 : clamp(dist / routeLen, 0, 0.99);
  void lvl;
  // coins picked up + money for the distance (so a failed ride still pays) + finish bonus
  let reward = runCoins + Math.floor(dist * 0.5 * (1 + save.level * 0.1));
  if (kind === 'win') reward += 20 + save.level * 8;
  save.coins += reward;
  const played = save.level;
  if (kind === 'win') {
    save.level++;
    save.maxLevel = Math.max(save.maxLevel, save.level);
  }
  persist();
  resTitle.textContent = T[kind];
  resTitle.style.color = kind === 'win' ? '#7dff8a' : '#ff6b6b';
  resSub.textContent = kind === 'win' ? `${T.level} ${played + 1} ✔` : `${T.passed} ${Math.round(prog * 100)}%`;
  resCoins.textContent = `+${reward}`;
  resBtns.replaceChildren();
  const btn = (label: string, cls: string, fn: () => void) => {
    const b = h('button', { class: 'ui-btn ' + cls }, label);
    b.addEventListener('click', () => { sound.sfx('click', 0.5); fn(); });
    resBtns.append(b);
    return b;
  };
  if (reward > 0) {
    const x2 = btn('🎬 ' + T.x2, '', async () => {
      x2.remove();
      if (await ya.showRewarded()) { save.coins += reward; persist(); resCoins.textContent = `+${reward * 2}`; sound.sfx('coin'); }
    });
  }
  if (kind === 'win') btn(T.next, 'green', () => afterRound(toGarage));
  else {
    btn(T.toGarage, '', () => afterRound(toGarage));
    btn(T.retry, 'green', () => afterRound(() => { toGarage(); startRide(); }));
  }
  showAll(rideUI, false);
  ui.show('result');
  sound.sfx(kind === 'win' ? 'win' : 'lose');
}
/** interstitial every 3rd ride */
async function afterRound(fn: () => void) {
  ui.hide();
  if (rides % 3 === 0) await ya.showAd();
  fn();
}

function win() {
  if (state !== 'ride' || !car) return;
  state = 'end';
  car.thrust = false;
  const lvl = track!.level;
  const fy = lvl.finishY ?? car.body.position[1];
  for (const z of [-2, 2]) burst(scene, px(presets.confetti(), 1), 90, [lvl.finishX, fy + 3, z]);
  const id = rideId;
  after(1.4, () => { if (id === rideId) finish('win'); });
}

// ---------------------------------------------------------------- loop
const mtx = new Float32Array(16), cq = quat(), q0 = quat();
const camPos = v3(), camLook = v3();
const tgtPos = v3(), tgtLook = v3();

const fanHum = new FanHum();
// picking up an ingot: small gold nuggets flying apart, each turned its own way (square pixels without the texture)
const nuggets = blockTex.nugget
  ? { ...presets.collect(), texture: blockTex.nugget, color: 0xffffff, blend: 'alpha' as const, intensity: 1, size: [0.45, 0.2] as [number, number], rotation: [0, Math.PI * 2] as [number, number], spin: 0 }
  : px(presets.collect(), 0.8);
game.onUpdate((dt) => {
  const inp = game.input;
  track?.update(dt);
  // the fans' whirr while they blow (more / stronger fans: louder, higher)
  const fans = car && state === 'ride' && !car.crashed ? car.fans : [];
  fanHum.update(dt, !!car?.thrust && fans.length > 0, Math.min(1, fans.reduce((s, f) => s + f.lvl, 0) / 8));
  if (state === 'build' || state === 'menu') garage.update(dt);
  if (car && state === 'ride') {
    car.thrust = inp.pointer.down || inp.isDown('Space') || inp.isDown('ArrowUp') || inp.isDown('KeyW') || inp.isDown('thrust');
    const bp = car.body.position;
    const lvl = track!.level;
    const now = odo.base + odo.dir * (bp[0] - odo.legX);
    progress.set(Math.max(odo.best, now) / routeLen);
    // finish: crossing the gate line at its height (from either side)
    const crossed = (prevX - lvl.finishX) * (bp[0] - lvl.finishX) <= 0 && prevX !== bp[0];
    prevX = bp[0];
    if (crossed && bp[1] > lvl.finishY! - 1.5 && bp[1] < lvl.finishY! + 5) { odo.best = Math.max(odo.best, now); win(); }
    else if (bp[1] < lowY - 14) finish('fell');
    else {
      // stuck = no progress along the route for a while (riding a lift counts as moving)
      // climbing higher than ever (riding a lift up) counts too; going up and down on it doesn't
      if (now > odo.best + 0.5) { odo.best = now; stuckTime = 0; }
      else if (bp[1] > odo.top + 0.5) { odo.top = bp[1]; stuckTime = 0; }
      else stuckTime += dt;
      // a car with a wheel and a forward fan can still get going: no "stuck" for it (the player can go back to the garage)
      const canDrive = car.wheels.length > 0 && car.fans.some((f) => f.dir === 'fwd');
      if (stuckTime > 6 && !canDrive) finish('stuck');
    }
    // mud splashes
    mudT -= dt;
    if (mudT <= 0 && Math.abs(car.body.velocity[0]) > 0.4) for (const w of car.wheels) if (w.mud) {
      mudT = 0.08;
      const p = car.toWorld(w.vis.x, w.vis.y - w.vis.r);
      burst(scene, px({ ...presets.dust(), color: [0x563a25, 0x2e1d10] }, 0.3), 3, [p[0], p[1] + 0.05, 0]);
    }
  }
  if (car) car.update(dt);
  obs?.update(dt);
  // coins: spin + pickup
  if (track) {
    const coins = track.level.coins, t = game.time.elapsed;
    const cp = car && state === 'ride' ? car.body.position : null;
    for (let i = 0; i < coinInst.count; i++) {
      const c = coins[i];
      if (!coinTaken[i] && cp && (c[0] - cp[0]) ** 2 + (c[1] - cp[1]) ** 2 < 1.4 * 1.4) {
        coinTaken[i] = true;
        runCoins++;
        setCoins(`+${runCoins}`);
        sound.sfx('coin', 0.45);
        burst(scene, nuggets, 10, [c[0], c[1], 0]);
        ui.floatText('+1', [c[0], c[1] + 0.4, 0], '#ffe066');
      }
      qeuler(cq, 0, t * 3 + c[0] * 0.3, 0);
      const s = coinTaken[i] ? 0 : 1;
      m4compose(mtx, [c[0], c[1] + Math.sin(t * 3 + c[0]) * 0.08, 0], cq, [s, s, s]);
      coinInst.setMatrix(i, mtx);
      const gy = coinGround[i], bs = gy === null ? 0 : s;
      m4compose(mtx, [c[0], (gy ?? 0) + 0.06, 0], q0, [bs, bs, bs]);
      blobInst.setMatrix(i, mtx);
    }
  }
});

game.onLateUpdate((dt) => {
  const building = (state !== 'ride' && state !== 'end') || !car;
  if (building !== camera.ortho) {
    // orthographic straight side view in the garage, perspective chase cam on the road
    camera.ortho = building;
    if (!building) {
      camLook.set([G[0] + 2, G[1] + 0.6, 0]);
      camPos.set([camLook[0] - 3, camLook[1] + 2.4, 11.5]);
    }
  }
  if (building || !car) {
    const portrait = game.screen.portrait;
    // landscape: inventory on the left -> grid right of center; portrait: inventory below -> grid higher
    // framing made for the 7 x 4 grid, scaled up for bigger grids of a level
    const k = Math.max(1, GW / 7, GH / 4), mid = (GH * CELL) / 2;
    camera.orthoSize = (portrait ? 2.3 : 1.95) * k;
    tgtLook.set([G[0] - (portrait ? 0 : 0.95 * k), G[1] + mid + (portrait ? -1.5 * k : -0.1), 0]);
    tgtPos.set([tgtLook[0], tgtLook[1], 30]);
    camPos.set(tgtPos);
    camLook.set(tgtLook);
  } else {
    const p = ragNode ? ragNode.position : car.body.position;
    const vx = car.body.velocity[0], f = car.facing;
    tgtLook.set([p[0] + 2.2 * f + clamp(vx * f, -4, 12) * 0.22 * f, p[1] + 0.6, 0]);
    tgtPos.set([tgtLook[0] - 3 * f, tgtLook[1] + 2.4, 11.5 + Math.min(Math.abs(vx), 16) * 0.3]);
    const k = damp(4, dt);
    for (let i = 0; i < 3; i++) { camPos[i] += (tgtPos[i] - camPos[i]) * k; camLook[i] += (tgtLook[i] - camLook[i]) * k; }
  }
  camera.setPosition(camPos[0], camPos[1], camPos[2]);
  camera.lookAt(camLook);
  // centered a bit behind the track so the far trees get shadows too
  const ext = sun.shadow.extent;
  sun.shadowFocus = [camLook[0] + ext * 0.2, camLook[1], -Math.max(0, ext - 12) * 0.6];
  adaptShadows();
});

// dev: levels.html "Play" opens the game with ?level=N (1-based) straight in that level's garage
const testLevel = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('level')) : 0;
if (testLevel > 0) {
  save.level = testLevel - 1;
  save.maxLevel = Math.max(save.maxLevel, save.level);
  toGarage();
} else openMenu();
// debug handles (console / automated checks)
Object.assign(window, {
  game, world,
  dbg: {
    get save() { return save; }, set save(s: Save) { save = s; }, toGarage, startRide, openMenu, garage,
    get car() { return car; }, get state() { return state; }, get obs() { return obs; }, get track() { return track; },
  },
});
ya.ready();
