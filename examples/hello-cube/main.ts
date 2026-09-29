import { createGame, Mesh, DirectionalLight, box, plane, sphere, toon, lambert, standard, qeuler } from 'aiwebengine';

const game = await createGame();
const { scene, camera } = game;

scene.setSky({ top: 0x4a90d9, horizon: 0xdcecf7, bottom: 0x6d7b5a });
scene.setAmbient(0xcfe3ff, 0x5b4a3a, 0.45);
scene.add(new DirectionalLight({ direction: [-0.6, -1, -0.4], intensity: 1.2 }));

const ground = scene.add(new Mesh(plane(20, 20), lambert(0x7fbf5f)));
ground.castShadow = false;

const cube = scene.add(new Mesh(box(), toon(0xff7a3d, { outline: { width: 0.03 }, rim: 0xffffff })));
cube.position[1] = 1.2;

const ball = scene.add(new Mesh(sphere(0.6, 32, 20), standard(0x3d8bff, { metalness: 0.2, roughness: 0.35 })));
ball.setPosition(-2, 0.6, 0);

camera.setPosition(0, 3, 6);
camera.lookAt([0, 0.8, 0]);

game.onUpdate((dt) => {
  const t = game.time.elapsed;
  qeuler(cube.rotation, t * 0.7, t, 0);
  ball.position[1] = 0.6 + Math.abs(Math.sin(t * 2)) * 1.2;
});

(window as any).game = game;
