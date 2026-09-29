// Hypercasual endless runner: swipe / arrow keys to switch lanes, swipe up / space to jump.
// No physics module on purpose: simple AABB checks keep the build tiny.
import { createGame, Mesh, DirectionalLight, Instances, box, plane, torus, cylinder, lambert, toon, m4compose, qeuler, quat, rand, pick, damp } from 'aiwebengine';
import { createMannequin } from 'aiwebengine/extras';
import { presets, burst, CameraShake, flash, punchScale } from 'aiwebengine/fx';
import { UI, h, u } from 'aiwebengine/ui';
import { sound } from 'aiwebengine/audio';
import { yandex } from 'aiwebengine/yandex';

// Yandex Games SDK (no-op when not running on the portal) — init in parallel with the engine
const yaInit = yandex();
const game = await createGame();
const ya = await yaInit;
ya.game = game;
const ru = ya.lang === 'ru' || ya.lang === 'be' || ya.lang === 'kk' || ya.lang === 'uk' || ya.lang === 'uz';
const T = ru
  ? { title: 'РАННЕР', hint1: 'Свайп или ← → — смена полосы', hint2: 'Свайп вверх / пробел — прыжок', play: 'ИГРАТЬ', over: 'КОНЕЦ ИГРЫ', retry: 'ЕЩЁ РАЗ', score: 'Очки', best: 'Рекорд', record: 'НОВЫЙ РЕКОРД!' }
  : { title: 'RUNNER', hint1: 'Swipe or ← → to switch lanes', hint2: 'Swipe up / space to jump', play: 'PLAY', over: 'GAME OVER', retry: 'RETRY', score: 'Score', best: 'Best', record: 'NEW RECORD!' };
const { scene, camera } = game;
camera.fit = 'contain';
camera.designAspect = 9 / 16;
camera.fov = 60;
scene.setSky({ top: 0xff9ec7, horizon: 0xffe3c2, bottom: 0xffe3c2, sun: 0 });
scene.setFog(0xffe3c2, 25, 60);
scene.setAmbient(0xffe0f0, 0x8a6aa0, 0.6);
const sun = scene.add(new DirectionalLight({ direction: [-0.3, -1, -0.5], intensity: 1.1, shadow: { extent: 14, size: 1024 } }));

const LANES = [-2, 0, 2], SEG = 10, SEGS = 8;
// road tiles + instanced lane stripes (one draw call)
const road: Mesh[] = [];
for (let i = 0; i < SEGS; i++) {
  const r = scene.add(new Mesh(plane(7, SEG), lambert(i % 2 ? 0x7d6bd1 : 0x8a78de)));
  r.castShadow = false;
  road.push(r);
}
const stripes = scene.add(new Mesh(box(0.12, 0.02, 1.4), lambert(0xffffff)));
const stripeInst = (stripes.instances = new Instances(SEGS * 8));
stripes.castShadow = false;

// pools
const obstacleMats = [0xff5d73, 0x3ec1d3, 0xffc93c].map((c) => toon(c, { outline: { width: 0.03 } }));
const obstacles: Mesh[] = [];
for (let i = 0; i < 24; i++) { const o = scene.add(new Mesh(box(1.5, 1.2, 1), pick(obstacleMats))); o.visible = false; obstacles.push(o); }
const coinGeo = torus(0.32, 0.1, 18, 6), coinMat = toon(0xffd23f, { emissive: 0xffb000, emissiveIntensity: 0.35 });
const coins: Mesh[] = [];
for (let i = 0; i < 40; i++) { const c = scene.add(new Mesh(coinGeo, coinMat)); c.visible = false; c.castShadow = false; coins.push(c); }
const trees: Mesh[] = [];
const trunk = cylinder(0.12, 0.18, 1, 6), crown = cylinder(0, 0.9, 1.8, 7).flatShade();
const trunkMat = lambert(0x8b5a3c), crownMats = [0x5fd068, 0x44b35a, 0x9be27a].map((c) => toon(c));
for (let i = 0; i < 30; i++) {
  const t = scene.add(new Mesh(trunk, trunkMat));
  t.add(new Mesh(crown, pick(crownMats))).position[1] = 1.3;
  trees.push(t);
}

const hero = scene.add(createMannequin({ body: 0xffffff, legs: 0x4a4a8a, outline: 0.015 }));
const shake = new CameraShake(game);

// ---- UI (portrait reference resolution)
const ui = new UI(game, { reference: [720, 1280], match: 0.5 });
const scoreLbl = ui.text('0', 'top', { fontSize: u(72), fontWeight: '900' });
const coinLbl = ui.text('0', 'top-right', { fontSize: u(40), color: '#ffe066' });
ui.screen('start',
  h('div', { class: 'ui-title' }, T.title),
  h('div', { style: { opacity: '0.85', textAlign: 'center' } }, T.hint1, h('br'), T.hint2),
  h('button', { class: 'ui-btn green', onClick: () => start() }, T.play));
const finalLbl = h('div', { class: 'ui-big' }, '');
const bestLbl = h('div', { style: { opacity: '0.8' } }, '');
ui.screen('over', h('div', { class: 'ui-title' }, T.over), finalLbl, bestLbl, h('button', { class: 'ui-btn', onClick: () => retry() }, T.retry));
ui.show('start');

// ---- state
let state: 'menu' | 'play' | 'dead' = 'menu';
let dist = 0, speed = 10, lane = 1, x = 0, y = 0, vy = 0, nCoins = 0, nextSpawn = 0;
let best = 0;
let runs = 0;
ya.load<{ best: number }>().then((d) => (best = Math.max(best, d.best ?? 0)));

function reset() {
  dist = 0; speed = 10; lane = 1; x = 0; y = 0; vy = 0; nCoins = 0; nextSpawn = 25;
  obstacles.forEach((o) => (o.visible = false));
  coins.forEach((c) => (c.visible = false));
  trees.forEach((t, i) => t.setPosition((i % 2 ? 1 : -1) * rand(5, 9), 0, -i * 3.5 + 10).setScale(rand(0.8, 1.4)));
  coinLbl.set(0);
  scoreLbl.set(0);
}
function start() {
  reset();
  state = 'play';
  ui.hide();
  hero.play('run', { fade: 0.1 });
  sound.sfx('click');
  runs++;
  ya.gameplayStart();
}
// fullscreen ad between runs (every 2nd retry); the game is paused and muted while it shows
async function retry() {
  ui.hide();
  if (runs % 2 === 0) await ya.showAd();
  start();
}
function die() {
  state = 'dead';
  ya.gameplayStop();
  hero.play('fall', { fade: 0.1 });
  shake.add(0.8);
  flash(hero.meshes[0], 0xff3355, 0.4);
  sound.sfx('explosion', 0.7);
  const score = Math.floor(dist) + nCoins * 10;
  const record = score > best;
  if (record) { best = score; ya.save({ best }); }
  finalLbl.textContent = `${T.score} ${score}`;
  bestLbl.textContent = record ? T.record : `${T.best} ${best}`;
  setTimeout(() => {
    ui.show('over');
    if (record) { burst(scene, presets.confetti(), 150, [x, 1, -3]); sound.sfx('win'); } else sound.sfx('lose');
  }, 700);
}
function spawnRow(z: number) {
  const free = [0, 1, 2];
  const n = Math.random() < 0.3 ? 2 : 1;
  for (let k = 0; k < n; k++) {
    const li = free.splice(Math.floor(Math.random() * free.length), 1)[0];
    const o = obstacles.find((o) => !o.visible);
    if (!o) break;
    o.visible = true;
    o.setPosition(LANES[li], 0.6, z);
    o.material = pick(obstacleMats);
  }
  const cl = free[Math.floor(Math.random() * free.length)];
  for (let i = 0; i < 5; i++) {
    const c = coins.find((c) => !c.visible);
    if (!c) break;
    c.visible = true;
    c.setPosition(LANES[cl], 0.8, z + 3 + i * 1.6);
  }
}

reset();
hero.play('idle');
const m = new Float32Array(16), q = quat();
game.onUpdate((dt) => {
  const inp = game.input;
  if (state === 'play') {
    speed = Math.min(26, speed + dt * 0.25);
    const dz = speed * dt;
    dist += dz;
    if ((inp.swipe === 'left' || inp.anyPressed('ArrowLeft', 'KeyA')) && lane > 0) { lane--; sound.sfx('click', 0.5); }
    if ((inp.swipe === 'right' || inp.anyPressed('ArrowRight', 'KeyD')) && lane < 2) { lane++; sound.sfx('click', 0.5); }
    if ((inp.swipe === 'up' || inp.anyPressed('ArrowUp', 'Space', 'KeyW')) && y <= 0.001) { vy = 9; sound.sfx('jump'); hero.play('jump', { fade: 0.05 }); }
    vy -= 28 * dt;
    y = Math.max(0, y + vy * dt);
    if (y === 0 && vy < 0) { if (hero.animator!.current?.clip.name === 'jump') hero.play('run', { fade: 0.1 }); vy = 0; }
    // the world moves towards the player (+z)
    for (const o of obstacles) if (o.visible) { o.position[2] += dz; if (o.position[2] > 8) o.visible = false; }
    for (const c of coins) if (c.visible) { c.position[2] += dz; if (c.position[2] > 8) c.visible = false; }
    for (const t of trees) { t.position[2] += dz; if (t.position[2] > 10) t.position[2] -= trees.length * 3.5; }
    nextSpawn -= dz;
    if (nextSpawn <= 0) { spawnRow(-45); nextSpawn = rand(9, 14) * (speed / 12); }
    // collisions (simple AABB)
    for (const o of obstacles) {
      if (o.visible && Math.abs(o.position[2]) < 0.8 && Math.abs(o.position[0] - x) < 1.1 && y < 1.1) { die(); break; }
    }
    for (const c of coins) {
      if (c.visible && Math.abs(c.position[2]) < 0.7 && Math.abs(c.position[0] - x) < 0.9 && Math.abs(c.position[1] - (y + 0.9)) < 1.2) {
        c.visible = false;
        nCoins++;
        coinLbl.set(nCoins);
        sound.sfx('coin', 0.6);
        burst(scene, presets.collect(), 14, [c.position[0], c.position[1], c.position[2]]);
        punchScale(hero, 0.12, 0.25);
      }
    }
    scoreLbl.set(Math.floor(dist) + nCoins * 10);
  }
  // hero
  x += (LANES[lane] - x) * damp(14, dt);
  hero.setPosition(x, y, 0);
  qeuler(hero.rotation, 0, Math.PI + (LANES[lane] - x) * -0.25, 0);
  // road scroll
  const off = dist % SEG;
  road.forEach((r, i) => r.setPosition(0, 0, -i * SEG + off + SEG / 2 - 2));
  let k = 0;
  for (let i = 0; i < SEGS; i++) for (let j = 0; j < 4; j++) for (const sx of [-1, 1]) {
    m4compose(m, [sx, 0.01, -i * SEG - j * 2.5 + off], q, [1, 1, 1]);
    stripeInst.setMatrix(k++, m);
  }
  for (const c of coins) if (c.visible) qeuler(c.rotation, Math.PI / 2, game.time.elapsed * 4, 0);
  // camera
  camera.setPosition(x * 0.5, 4.2, 6.5);
  camera.lookAt([x * 0.3, 0.8, -4]);
  sun.shadowFocus = [0, 0, -4];
});
Object.assign(window, { game });
// everything is created and the menu is interactive -> tell the portal
ya.ready();
