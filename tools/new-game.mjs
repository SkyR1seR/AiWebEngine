// npm run new <name> [-- --template=3d|runner]  -> games/<name>/{index.html,main.ts}
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

const name = process.argv[2];
if (!name || !/^[a-z0-9-]+$/.test(name)) {
  console.error('usage: npm run new <name>   (lowercase letters, digits, dashes)');
  process.exit(1);
}
const dir = `games/${name}`;
if (existsSync(dir)) { console.error(`${dir} already exists`); process.exit(1); }
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/index.html`, `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no" />
  <title>${name}</title>
</head>
<body>
  <script type="module" src="./main.ts"></script>
</body>
</html>
`);
writeFileSync(`${dir}/main.ts`, `import { createGame, Mesh, DirectionalLight, box, lambert, toon, qeuler, damp } from 'aiwebengine';
import { PhysicsWorld, CharacterController } from 'aiwebengine/physics';
import { createMannequin, FollowCamera } from 'aiwebengine/extras';
import { presets, burst } from 'aiwebengine/fx';
import { UI } from 'aiwebengine/ui';
import { sound } from 'aiwebengine/audio';

const game = await createGame();
const { scene } = game;
scene.setSky({ top: 0x3b7dd8, horizon: 0xd6ecff });
scene.setFog(0xd6ecff, 30, 90);
scene.add(new DirectionalLight({ direction: [-0.5, -1, -0.3], intensity: 1.2 }));

const world = game.addSystem(new PhysicsWorld());
const ground = scene.add(new Mesh(box(60, 1, 60), lambert(0x7cc56a)));
ground.position[1] = -0.5;
ground.castShadow = false;
world.add(ground, { type: 'static', shape: 'box' });

for (let i = 0; i < 5; i++) {
  const b = scene.add(new Mesh(box(1, 1, 1), toon(0xffa94d, { outline: { width: 0.03 } })));
  b.setPosition(i * 1.5 - 3, 0.5, -4);
  world.add(b, { shape: 'box' });
}

const hero = scene.add(createMannequin({ body: 0xff7043, outline: 0.012 }));
const ctrl = new CharacterController(world, hero);
const cam = new FollowCamera(game, hero, { physics: world, ignore: [ctrl.body] });
const ui = new UI(game);
const hint = ui.text('WASD / stick to move, Space to jump', 'bottom');
ui.joystick();
ui.touchButton('JUMP', 'jump');
ctrl.onLand = () => burst(scene, presets.dust(), 8, hero.worldPosition());

let yaw = 0;
game.onUpdate((dt) => {
  const [mx, my] = game.input.move();
  const [wx, wz] = cam.toWorld(mx, my);
  ctrl.move(wx * 6, wz * 6);
  if (Math.hypot(wx, wz) > 0.1) {
    const d = Math.atan2(wx, wz) - yaw;
    yaw += Math.atan2(Math.sin(d), Math.cos(d)) * damp(12, dt);
    qeuler(hero.rotation, 0, yaw, 0);
  }
  if (game.input.anyPressed('Space', 'jump') && ctrl.jump(7)) { sound.sfx('jump'); hint.set(''); }
  const moving = Math.hypot(mx, my) > 0.1;
  const next = !ctrl.grounded ? 'jump' : moving ? 'run' : 'idle';
  if (hero.animator!.current?.clip.name !== next) hero.play(next);
});
`);
console.log(`Created ${dir}. Run "npm run dev" and open http://localhost:5173/${dir}/`);
