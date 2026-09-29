import { describe, it, expect } from 'vitest';
import { PhysicsWorld, Body, sphereShape, boxShape, capsuleShape, planeShape, meshShape, CharacterController } from '../src/physics';
import { Node } from '../src/scene/node';
import { plane, box } from '../src/geometry/primitives';
import { qaxisAngle, quat } from '../src/core/math';

const run = (w: PhysicsWorld, sec: number) => { for (let i = 0; i < sec * 60; i++) w.fixedUpdate(1 / 60); };
const ground = (w: PhysicsWorld) => w.addBody(new Body({ type: 'static', shape: planeShape() }));

describe('physics', () => {
  it('sphere rests on plane', () => {
    const w = new PhysicsWorld();
    ground(w);
    const s = w.addBody(new Body({ shape: sphereShape(0.5), position: [0, 5, 0] }));
    run(w, 3);
    expect(s.position[1]).toBeCloseTo(0.5, 1);
    expect(Math.abs(s.velocity[1])).toBeLessThan(0.05);
  });

  it('box rests flat on plane and sleeps', () => {
    const w = new PhysicsWorld();
    ground(w);
    const b = w.addBody(new Body({ shape: boxShape(0.5, 0.5, 0.5), position: [0, 3, 0], rotation: qaxisAngle(quat(), [1, 0, 0], 0.3) }));
    run(w, 5);
    expect(b.position[1]).toBeCloseTo(0.5, 1);
    expect(b.sleeping).toBe(true);
  });

  it('stack of 5 boxes stays stable', () => {
    const w = new PhysicsWorld();
    ground(w);
    const boxes = [0, 1, 2, 3, 4].map((i) => w.addBody(new Body({ shape: boxShape(0.5, 0.5, 0.5), position: [0, 0.5 + i * 1.001, 0] })));
    run(w, 5);
    boxes.forEach((b, i) => {
      expect(b.position[1]).toBeCloseTo(0.5 + i, 1);
      expect(Math.abs(b.position[0])).toBeLessThan(0.05);
    });
  });

  it('box on box (SAT face contact) and box on static box', () => {
    const w = new PhysicsWorld();
    w.addBody(new Body({ type: 'static', shape: boxShape(5, 0.5, 5), position: [0, -0.5, 0] }));
    const b = w.addBody(new Body({ shape: boxShape(0.3, 0.3, 0.3), position: [0.2, 2, 0.1], rotation: qaxisAngle(quat(), [0, 1, 0], 0.5) }));
    run(w, 4);
    expect(b.position[1]).toBeCloseTo(0.3, 1);
  });

  it('capsule stands on plane', () => {
    const w = new PhysicsWorld();
    ground(w);
    const c = w.addBody(new Body({ shape: capsuleShape(0.3, 0.5), position: [0, 3, 0], angularFactor: [0, 0, 0] }));
    run(w, 3);
    expect(c.position[1]).toBeCloseTo(0.8, 1);
  });

  it('sphere rolls down and rests on a triangle mesh', () => {
    const w = new PhysicsWorld();
    w.addBody(new Body({ type: 'static', shape: meshShape(plane(20, 20, 4, 4)) }));
    const s = w.addBody(new Body({ shape: sphereShape(0.5), position: [1, 3, 1] }));
    run(w, 3);
    expect(s.position[1]).toBeCloseTo(0.5, 1);
    expect(Math.abs(s.position[0] - 1)).toBeLessThan(0.05);
  });

  it('box on triangle mesh', () => {
    const w = new PhysicsWorld();
    w.addBody(new Body({ type: 'static', shape: meshShape(plane(20, 20, 2, 2)) }));
    const b = w.addBody(new Body({ shape: boxShape(0.5, 0.5, 0.5), position: [0.3, 2, 0.2] }));
    run(w, 4);
    expect(b.position[1]).toBeCloseTo(0.5, 1);
  });

  it('raycast hits closest body with correct normal', () => {
    const w = new PhysicsWorld();
    ground(w);
    const b = w.addBody(new Body({ type: 'static', shape: boxShape(1, 1, 1), position: [0, 1, 0] }));
    w.addBody(new Body({ type: 'static', shape: sphereShape(1), position: [0, 1, -5] }));
    const h = w.raycast([0, 1, 10], [0, 0, -1]);
    expect(h?.body).toBe(b);
    expect(h!.distance).toBeCloseTo(9, 3);
    expect(h!.normal[2]).toBeCloseTo(1, 3);
    const g = w.raycast([3, 5, 0], [0, -1, 0]);
    expect(g!.point[1]).toBeCloseTo(0, 3);
    const m = new PhysicsWorld();
    m.addBody(new Body({ type: 'static', shape: meshShape(box(2, 2, 2)) }));
    expect(m.raycast([0, 10, 0], [0, -1, 0])!.distance).toBeCloseTo(9, 3);
  });

  it('collision and trigger events fire', () => {
    const w = new PhysicsWorld();
    ground(w);
    const s = w.addBody(new Body({ shape: sphereShape(0.5), position: [0, 4, 0] }));
    const trig = w.addBody(new Body({ type: 'static', shape: boxShape(1, 0.2, 1), position: [0, 2.5, 0], isTrigger: true }));
    let hits = 0, speed = 0, enter = 0, exit = 0;
    s.onCollide = (_o, info) => { hits++; speed = info.speed; };
    trig.onTrigger = (_o, st) => (st === 'enter' ? enter++ : exit++);
    run(w, 2);
    expect(hits).toBeGreaterThanOrEqual(1);
    expect(speed).toBeGreaterThan(3);
    expect(enter).toBe(1);
    expect(exit).toBe(1);
  });

  it('dynamic body with node syncs transform', () => {
    const w = new PhysicsWorld();
    ground(w);
    const n = new Node().setPosition(0, 4, 0);
    w.add(n, { shape: 'sphere' });
    run(w, 3);
    w.update(0, 1);
    expect(n.position[1]).toBeGreaterThan(0.3);
    expect(n.position[1]).toBeLessThan(0.7);
  });

  it('character controller walks, climbs step, blocked by wall', () => {
    const w = new PhysicsWorld();
    ground(w);
    w.addBody(new Body({ type: 'static', shape: boxShape(1, 0.15, 1), position: [3, 0.15, 0] })); // 0.3 step
    w.addBody(new Body({ type: 'static', shape: boxShape(0.5, 2, 3), position: [8, 2, 0] })); // wall
    const n = new Node().setPosition(0, 0, 0);
    const c = new CharacterController(w, n);
    run(w, 0.5);
    expect(c.grounded).toBe(true);
    expect(n.position[1]).toBeCloseTo(0, 1);
    c.move(3, 0);
    run(w, 1);
    expect(n.position[0]).toBeGreaterThan(2.5);
    expect(n.position[1]).toBeCloseTo(0.3, 1);
    run(w, 3);
    expect(n.position[0]).toBeLessThan(8 - 0.5 - 0.3);
    expect(c.grounded).toBe(true);
    c.move(0, 0);
    expect(c.jump(6)).toBe(true);
    run(w, 0.3);
    expect(n.position[1]).toBeGreaterThan(0.5);
    run(w, 2);
    expect(n.position[1]).toBeCloseTo(0, 1);
  });

  it('controller walks up a slope mesh', () => {
    const w = new PhysicsWorld();
    ground(w);
    const ramp = plane(4, 4);
    const q = qaxisAngle(quat(), [0, 0, 1], 0.4);
    w.addBody(new Body({ type: 'static', shape: meshShape(ramp), position: [4, 0.6, 0], rotation: q }));
    const n = new Node();
    const c = new CharacterController(w, n);
    c.move(2, 0);
    run(w, 2.5);
    expect(n.position[1]).toBeGreaterThan(0.5);
    expect(c.grounded).toBe(true);
  });
});
