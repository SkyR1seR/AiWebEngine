import { createGame, Mesh, DirectionalLight, box, plane, torus, lambert, toon, damp, qeuler, rand } from 'aiwebengine';
import { PhysicsWorld, CharacterController, meshShape } from 'aiwebengine/physics';
import { createMannequin, FollowCamera } from 'aiwebengine/extras';
import { Particles, presets, burst, CameraShake, PostFX } from 'aiwebengine/fx';
import { UI, h } from 'aiwebengine/ui';
import { sound } from 'aiwebengine/audio';
import { DebugDraw, statsOverlay } from 'aiwebengine/debug';

const game = await createGame();
const { scene } = game;
scene.setSky({ top: 0x3b7dd8, horizon: 0xd6ecff, bottom: 0x7a8a6a });
scene.setFog(0xd6ecff, 35, 90);
scene.setAmbient(0xcfe3ff, 0x7a6a55, 0.5);
scene.add(new DirectionalLight({ direction: [-0.5, -1, -0.3], intensity: 1.25, shadow: { extent: 16 } }));
game.renderer.post = new PostFX({ bloom: { intensity: 0.3, threshold: 1 }, tonemap: 'none', vignette: 0.2 });

const world = game.addSystem(new PhysicsWorld());
const debug = new DebugDraw(game);
statsOverlay(game);

// ---- level
const mat = { ground: lambert(0x7cc56a), block: toon(0xe8d3a8), dark: toon(0xa77b52), plat: toon(0x5ab0e6) };
const ground = scene.add(new Mesh(box(80, 1, 80), mat.ground));
ground.position[1] = -0.5;
ground.castShadow = false;
world.add(ground, { type: 'static', shape: 'box' });
function block(x: number, y: number, z: number, w: number, hgt: number, d: number, m = mat.block) {
  const b = scene.add(new Mesh(box(w, hgt, d), m));
  b.setPosition(x, y + hgt / 2, z);
  world.add(b, { type: 'static', shape: 'box' });
  return b;
}
// stairs
for (let i = 0; i < 8; i++) block(6, 0, -4 - i * 0.6, 3, (i + 1) * 0.25, 0.6);
block(6, 0, -10, 3, 2, 3, mat.dark);
// walls and pillars
block(-8, 0, -6, 8, 2.5, 0.6, mat.dark);
for (let i = 0; i < 4; i++) block(-12 + i * 3, 0, 4, 0.8, 1 + i * 0.6, 0.8, mat.dark);
// ramp (triangle mesh collider)
const rampGeo = plane(3, 8);
const ramp = scene.add(new Mesh(rampGeo, mat.block));
ramp.setPosition(-3, 1.2, -12);
qeuler(ramp.rotation, 0.32, 0, 0);
world.add(ramp, { type: 'static', shape: meshShape(rampGeo) });
block(-3, 0, -17.5, 3, 2.45, 3, mat.dark);
// moving platform
const plat = scene.add(new Mesh(box(3, 0.4, 3), mat.plat));
plat.setPosition(0, 2, -18);
world.add(plat, { type: 'kinematic', shape: 'box' });
game.onUpdate(() => (plat.position[0] = 4 + Math.sin(game.time.elapsed * 0.7) * 5));
// dynamic crates to push
for (let i = 0; i < 6; i++) {
  const c = scene.add(new Mesh(box(0.8, 0.8, 0.8), toon(0xd9a24a)));
  c.setPosition(2 + (i % 3) * 0.85, 0.4 + Math.floor(i / 3) * 0.8, 4);
  world.add(c, { shape: 'box', mass: 1 });
}
// campfire
const fire = scene.add(new Particles(presets.fire()));
fire.setPosition(-6, 0, 8);

// ---- player
const hero = scene.add(createMannequin({ body: 0xff7043, outline: 0.012 }));
const ctrl = new CharacterController(world, hero, { radius: 0.35, height: 1.8 });
const cam = new FollowCamera(game, hero, { distance: 6, physics: world, ignore: [ctrl.body] });
const shake = new CameraShake(game);
let yaw = 0;
ctrl.onLand = (speed) => {
  burst(scene, presets.dust(), 10, hero.worldPosition());
  if (speed > 12) { shake.add(0.3); sound.sfx('hit', 0.6); }
};
hero.animator!.on('step', () => sound.sfx('step', 0.4));

// ---- coins (triggers)
const ui = new UI(game);
const score = ui.text('Coins: 0', 'top-left', { fontSize: 'calc(var(--u)*32px)' });
ui.joystick({ side: 'left' });
ui.touchButton('JUMP', 'jump');
ui.touchButton('HIT', 'attack', 'bottom-right');
ui.add(h('div', { style: { opacity: '0.8', fontSize: 'calc(var(--u)*16px)' } }, ui.isTouch ? '' : 'WASD move · Space jump · F attack · drag/mouse: camera · P colliders'), 'bottom');
let coins = 0;
const coinGeo = torus(0.3, 0.1, 20, 8);
const coinMat = toon(0xffd23f, { emissive: 0xffa000, emissiveIntensity: 0.4 });
const coinSpots = [[0, 1, 0], [6, 3, -10], [-3, 3.5, -17.5], [4, 3.2, -18], [-12, 2.4, 4], [-3, 3.2, 4], [10, 1, 5], [-8, 1, 10]];
for (const [x, y, z] of coinSpots) {
  const c = scene.add(new Mesh(coinGeo, coinMat));
  c.setPosition(x, y, z);
  c.addScript((dt, n) => { qeuler(n.rotation, Math.PI / 2, game.time.elapsed * 3 + x, 0); n.position[1] = y + Math.sin(game.time.elapsed * 2 + x) * 0.15; void dt; });
  const b = world.add(c, { type: 'kinematic', shape: 'sphere', isTrigger: true });
  b.onTrigger = (other, state) => {
    if (state !== 'enter' || other !== ctrl.body) return;
    world.remove(b);
    c.destroy();
    coins++;
    score.set(`Coins: ${coins}`);
    burst(scene, presets.collect(), 20, c.position);
    ui.floatText('+1', c.position, '#ffd23f');
    sound.sfx('coin');
    if (coins === coinSpots.length) { sound.sfx('win'); burst(scene, presets.confetti(), 150, hero.worldPosition()); ui.toast('All coins collected!', 3); }
  };
}
const tag = ui.worldLabel(hero, h('div', { style: { fontSize: 'calc(var(--u)*16px)', fontWeight: '700' } }, 'Player'), [0, 2.2, 0]);
void tag;

// ---- control loop
game.onUpdate((dt) => {
  const inp = game.input;
  const [mx, my] = inp.move();
  const running = !inp.isDown('ShiftLeft');
  const speed = (running ? 6 : 2.5) * Math.min(1, Math.hypot(mx, my));
  const [wx, wz] = cam.toWorld(mx, my);
  const l = Math.hypot(wx, wz) || 1;
  ctrl.move((wx / l) * speed, (wz / l) * speed);
  if (speed > 0.1) {
    const target = Math.atan2(wx, wz);
    let d = target - yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    yaw += d * damp(12, dt);
    qeuler(hero.rotation, 0, yaw, 0);
  }
  if (inp.anyPressed('Space', 'jump', 'Pad0') && ctrl.jump(7)) sound.sfx('jump');
  const an = hero.animator!;
  const attacking = an.current?.clip.name === 'attack' && an.current.playing;
  if (inp.anyPressed('KeyF', 'attack', 'Pad2') && !attacking) {
    an.playOnce('attack', 'idle', { fade: 0.08 });
    sound.sfx('shoot', 0.5);
  } else if (!attacking) {
    const next = !ctrl.grounded ? (ctrl.velocity[1] > 0 ? 'jump' : 'fall') : speed > 4 ? 'run' : speed > 0.3 ? 'walk' : 'idle';
    if (an.current?.clip.name !== next) an.play(next, { fade: 0.15 });
  }
  if (inp.wasPressed('KeyP')) debug.physics = debug.physics ? null : world;
  if (hero.position[1] < -20) ctrl.teleport([0, 2, 6]);
  void rand;
});
ctrl.teleport([0, 0, 6]);
if (!ui.isTouch) game.canvas.addEventListener('click', () => game.input.lockPointer());
Object.assign(window, { game, world, ctrl, hero });
