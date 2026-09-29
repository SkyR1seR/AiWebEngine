import { createGame, Mesh, DirectionalLight, PointLight, box, sphere, plane, torus, lambert, toon, standard, unlit, every, rand } from 'aiwebengine';
import { Particles, presets, burst, Trail, PostFX, CameraShake, flash, punchScale } from 'aiwebengine/fx';
import { statsOverlay } from 'aiwebengine/debug';
import { OrbitControls } from 'aiwebengine/extras';

const game = await createGame();
const { scene, camera, renderer } = game;
scene.setBackground(0x0d1020).setAmbient(0x39406b, 0x1a1420, 0.35).setFog(0x0d1020, 15, 45);
scene.add(new DirectionalLight({ direction: [-0.4, -1, -0.6], intensity: 0.5, color: 0x8fa8ff }));
statsOverlay(game);
new OrbitControls(game, { target: [0, 1, 0], distance: 13, pitch: 0.35, autoRotate: 0.1 });
const post = (renderer.post = new PostFX({ bloom: { intensity: 0.8, threshold: 0.8 }, vignette: 0.35 }));
const shake = new CameraShake(game);

scene.add(new Mesh(plane(60, 60), lambert(0x2a2d3a))).castShadow = false;

// campfire: fire + smoke + light
const fire = scene.add(new Particles(presets.fire()));
fire.setPosition(0, 0.1, 0);
const smoke = scene.add(new Particles(presets.smoke()));
smoke.setPosition(0, 1.2, 0);
const fireLight = scene.add(new PointLight(0xff9a3c, 4, 9));
fireLight.setPosition(0, 1, 0);
game.onUpdate(() => (fireLight.intensity = 3.5 + Math.sin(game.time.elapsed * 13) * 0.4 + Math.sin(game.time.elapsed * 29) * 0.3));
for (let i = 0; i < 6; i++) {
  const log = scene.add(new Mesh(box(0.15, 0.15, 1.1), lambert(0x5b3a1e)));
  log.setRotation(0.2, (i / 6) * Math.PI, 0);
  log.position[1] = 0.1;
}

// glowing emissive objects (bloom)
const orbs = [0x4dd2ff, 0xff4d9d, 0x9dff4d].map((c, i) => {
  const m = scene.add(new Mesh(sphere(0.35, 24, 16), standard(c, { emissive: c, emissiveIntensity: 2.5, roughness: 0.3 })));
  const trail = scene.add(new Trail(m, camera, { color: c, width: 0.35, time: 0.6, intensity: 2 }));
  m.data.phase = (i / 3) * Math.PI * 2;
  return { m, trail };
});
game.onUpdate(() => {
  const t = game.time.elapsed;
  for (const { m } of orbs) {
    const a = t * 1.3 + m.data.phase;
    m.setPosition(Math.cos(a) * 4, 1.5 + Math.sin(t * 2 + m.data.phase) * 0.8, Math.sin(a) * 4);
  }
});

const ring = scene.add(new Mesh(torus(1.2, 0.08, 48, 8), unlit(0xffd24a)));
ring.material.setColor(0xffd24a);
ring.material.uniforms.set([3, 2.2, 0.6], 0); // HDR color -> bloom
ring.setPosition(6, 1.5, 0);
const magic = scene.add(new Particles(presets.magic()));
magic.setPosition(6, 1.5, 0);
game.onUpdate((dt) => ring.setRotation(game.time.elapsed, game.time.elapsed * 0.7, 0) && void dt);

// targets: tap/click to explode
const crates = [-5, -3, 3].map((x, i) => {
  const c = scene.add(new Mesh(box(1, 1, 1), toon(0xc9853a, { outline: { width: 0.03 } })));
  c.setPosition(x, 0.5, -4 + i);
  return c;
});
function explode(pos: number[]) {
  burst(scene, presets.explosion(), 60, pos);
  burst(scene, presets.sparks(), 40, pos);
  burst(scene, presets.smoke(), 1, pos).emit(12, pos);
  shake.add(0.6);
}
game.onUpdate(() => {
  if (game.input.tap || game.input.wasPressed('Space')) {
    const c = crates[Math.floor(rand(0, crates.length))];
    flash(c, 0xffffff);
    punchScale(c, 0.3);
    explode([c.position[0], 1, c.position[2]]);
  }
  if (game.input.wasPressed('KeyB')) post.enabled = !post.enabled;
  if (game.input.wasPressed('KeyC')) burst(scene, presets.confetti(), 120, [0, 0.5, 3]);
});
every(3, () => burst(scene, presets.confetti(), 80, [rand(-3, 3), 0.2, 3]));

const hint = document.createElement('div');
hint.textContent = 'tap/space: explode · C: confetti · B: toggle post · drag: orbit';
hint.style.cssText = 'position:fixed;bottom:8px;left:0;right:0;text-align:center;font:13px system-ui;color:#fff;text-shadow:0 1px 2px #000;pointer-events:none';
document.body.appendChild(hint);
Object.assign(window, { game, post });
