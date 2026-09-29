import { createGame, Mesh, DirectionalLight, box, sphere, capsule, plane, icosphere, lambert, toon, color, pick, rand, qaxisAngle, quat } from 'aiwebengine';
import { PhysicsWorld, boxShape, meshShape } from 'aiwebengine/physics';
import { DebugDraw, statsOverlay } from 'aiwebengine/debug';
import { OrbitControls } from 'aiwebengine/extras';

const game = await createGame();
const { scene, camera } = game;
scene.setSky({ top: 0x2f6fb5, horizon: 0xbcd9ee });
scene.setFog(0xbcd9ee, 30, 80);
const sun = scene.add(new DirectionalLight({ direction: [-0.5, -1, -0.35], intensity: 1.3, shadow: { extent: 18 } }));
sun.shadowFocus = [0, 0, 0];

const world = game.addSystem(new PhysicsWorld());
const debug = new DebugDraw(game);
statsOverlay(game);
new OrbitControls(game, { target: [0, 2, 0], distance: 22, pitch: 0.45, yaw: 0.6 });

// ground (static box collider)
const ground = scene.add(new Mesh(box(80, 1, 80), lambert(0x6aa84f)));
ground.position[1] = -0.5;
ground.castShadow = false;
world.add(ground, { type: 'static', shape: 'box' });

// ramp from a triangle mesh collider
const rampGeo = plane(6, 10);
const ramp = scene.add(new Mesh(rampGeo, lambert(0xc9a26b, { cull: 'none' })));
ramp.setPosition(-8, 2, 0);
qaxisAngle(ramp.rotation, [0, 0, 1], -0.45);
world.add(ramp, { type: 'static', shape: meshShape(rampGeo) });

const colors = [0xff6b6b, 0xffd93d, 0x6bcB77, 0x4d96ff, 0xc77dff, 0xff9f43];
// pyramid of boxes
const cube = box(1, 1, 1);
for (let y = 0; y < 6; y++) for (let x = 0; x < 6 - y; x++) {
  const m = scene.add(new Mesh(cube, toon(pick(colors))));
  m.setPosition(3 + x * 1.02 - (6 - y) / 2, 0.5 + y * 1.0, 0);
  world.add(m, { shape: 'box', mass: 1 });
}
const ballGeo = sphere(0.5, 20, 14), capGeo = capsule(0.35, 0.6, 12, 4), rockGeo = icosphere(0.6, 0).flatShade();
function spawn(kind: number, pos: number[], vel?: number[]) {
  const geo = kind === 0 ? ballGeo : kind === 1 ? capGeo : kind === 2 ? rockGeo : cube;
  const m = scene.add(new Mesh(geo, toon(pick(colors))));
  m.setPosition(pos[0], pos[1], pos[2]);
  const b = world.add(m, { shape: kind === 0 ? 'sphere' : kind === 1 ? 'capsule' : kind === 2 ? 'sphere' : 'box', restitution: kind === 0 ? 0.5 : 0.1 });
  if (vel) b.velocity.set(vel);
  b.onCollide = (_o, info) => { if (info.speed > 4) { m.flash.set([1, 1, 1, 0.8]); setTimeout(() => (m.flash[3] = 0), 60); } };
  return b;
}
for (let i = 0; i < 20; i++) spawn(i % 4, [rand(-10, -6), 8 + i * 1.2, rand(-3, 3)]);

// tap/click: shoot a ball from the camera
game.onUpdate(() => {
  const tap = game.input.tap;
  if (tap) {
    const r = camera.screenRay(tap.x, tap.y, game.screen.width, game.screen.height);
    spawn(0, [r.origin[0] + r.dir[0], r.origin[1] + r.dir[1], r.origin[2] + r.dir[2]], [r.dir[0] * 30, r.dir[1] * 30, r.dir[2] * 30]);
  }
  if (game.input.wasPressed('KeyP')) debug.physics = debug.physics ? null : world;
  if (game.input.wasPressed('KeyR')) for (let i = 0; i < 10; i++) spawn(i % 4, [rand(-4, 4), 12 + i, rand(-4, 4)]);
});

// kinematic moving platform
const plat = scene.add(new Mesh(box(3, 0.4, 3), lambert(0x999999)));
plat.setPosition(0, 1, 8);
world.add(plat, { type: 'kinematic', shape: 'box' });
game.onUpdate(() => { plat.position[0] = Math.sin(game.time.elapsed * 0.8) * 6; });

const hint = document.createElement('div');
hint.textContent = 'tap: shoot · drag: orbit · P: colliders · R: rain';
hint.style.cssText = 'position:fixed;bottom:8px;left:0;right:0;text-align:center;font:13px system-ui;color:#fff;text-shadow:0 1px 2px #000;pointer-events:none';
document.body.appendChild(hint);
Object.assign(window, { game, world, color, quat, boxShape });
