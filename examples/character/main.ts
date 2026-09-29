import { createGame, Mesh, DirectionalLight, plane, lambert } from 'aiwebengine';
import { createMannequin } from '../../src/extras/mannequin';

const game = await createGame();
const { scene, camera } = game;
scene.setSky({});
scene.add(new DirectionalLight({ direction: [-0.6, -1, -0.4], intensity: 1.2 }));
scene.add(new Mesh(plane(20, 20), lambert(0x88aa66))).castShadow = false;

const names = ['idle', 'walk', 'run', 'jump', 'fall', 'attack', 'wave'];
const guys = names.map((n, i) => {
  const m = scene.add(createMannequin({ body: [0x3d7bd9, 0xd94f3d, 0x3dd97b, 0xd9c23d, 0x9b3dd9, 0x3dc8d9, 0xd93d9b][i], outline: 0.015 }));
  m.setPosition((i - 3) * 1.1, 0, 0);
  m.play(n);
  return m;
});
camera.setPosition(0, 1.6, 6);
camera.lookAt([0, 1, 0]);
(window as any).game = game;
(window as any).guys = guys;
