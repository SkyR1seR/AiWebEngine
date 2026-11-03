import { describe, it, expect } from 'vitest';
import { Camera } from '../src/index';
import { Mesher, L_FLOOR, L_PROP, L_GLOW, tileUV } from '../games/snowball-rush/world';
import { RaceCamera } from '../games/snowball-rush/camera';
import type { Racer } from '../games/snowball-rush/types';
import type { RaceSim } from '../games/snowball-rush/sim';

const quads = (g: { attributes: Record<string, { data: ArrayLike<number> }> }) => g.attributes.position.data.length / 12;

describe('snowball world: atlas mesher', () => {
  it('culls the faces between touching unit blocks', () => {
    const g = new Mesher().unit(L_PROP, 0, 5.5, 0, 'snow').unit(L_PROP, 1, 5.5, 0, 'snow').geometries()[L_PROP];
    expect(quads(g)).toBe(10);
  });
  it('drops downward faces at ground level and below (never visible)', () => {
    const g = new Mesher().unit(L_PROP, 0, 0.5, 0, 'snow').unit(L_FLOOR, 3, -0.5, 0, 'snow').geometries();
    expect(quads(g[L_PROP]) + quads(g[L_FLOOR])).toBe(10);
  });
  it('keeps the first block of a cell (occupancy)', () => {
    const M = new Mesher().unit(L_PROP, 0, 0.5, 0, 'log').unit(L_PROP, 0, 0.5, 0, 'snow');
    expect(M.count).toBe(1);
  });
  it('see-through blocks do not hide their neighbors', () => {
    const g = new Mesher().unit(L_PROP, 0, 5.5, 0, 'snow').unit(L_PROP, 1, 5.5, 0, 'glass').geometries()[L_PROP];
    expect(quads(g)).toBe(11);
  });
  it('splits faces per meter so textures repeat like blocks (2.5 x 1 x 1 box)', () => {
    const g = new Mesher().add(L_PROP, 0, 5, 0, 2.5, 1, 1, 'iceWall').geometries()[L_PROP];
    // top, bottom, +Z, -Z: 3 cells each; ±X: 1 each
    expect(quads(g)).toBe(14);
  });
  it('fit stretches the whole tile over each face', () => {
    const g = new Mesher().add(L_PROP, 0, 5, 0, 1.6, 1.6, 1.6, 'giftRed', 0xffffff, 0, true).geometries()[L_PROP];
    expect(quads(g)).toBe(6);
    const [u0, v0, u1, v1] = tileUV('giftRed'), uv = g.attributes.uv.data;
    for (let i = 0; i < uv.length; i += 2) {
      expect(uv[i]).toBeGreaterThanOrEqual(u0); expect(uv[i]).toBeLessThanOrEqual(u1);
      expect(uv[i + 1]).toBeGreaterThanOrEqual(v0); expect(uv[i + 1]).toBeLessThanOrEqual(v1);
    }
  });
  it('keeps every uv inside its own tile (no atlas bleeding)', () => {
    const M = new Mesher();
    M.add(L_PROP, 0, 0, 0, 3.3, 0.4, 1.7, ['snow', 'snowSide', 'dirt']).add(L_PROP, 4, 0, 0, 0.2, 2, 0.2, 'log', 0xffffff, 0.7);
    const g = M.geometries()[L_PROP], uv = g.attributes.uv.data, tiles = (['snow', 'snowSide', 'dirt', 'log'] as const).map(tileUV);
    for (let i = 0; i < uv.length; i += 2) {
      expect(tiles.some(([u0, v0, u1, v1]) => uv[i] >= u0 && uv[i] <= u1 && uv[i + 1] >= v0 && uv[i + 1] <= v1)).toBe(true);
    }
  });
  it('groups by layer and track chunk', () => {
    const M = new Mesher(32);
    M.unit(L_FLOOR, 0, -0.5, -1.5, 'snow').unit(L_FLOOR, 0, -0.5, -40.5, 'snow').unit(L_GLOW, 0, 1, -2, 'lamp');
    const out = M.build().map((e) => `${e.layer}:${e.chunk}`).sort();
    expect(out).toEqual(['0:-1', '0:-2', '2:-1']);
  });
  it('vertex colors carry the tint (linear)', () => {
    const g = new Mesher().add(L_PROP, 0, 5, 0, 1, 1, 1, 'voxel', 0xff0000, 0.3).geometries(0.5)[L_PROP];
    const c = g.attributes.color.data;
    expect(c).toBeInstanceOf(Uint8Array); // unorm8 RGBA
    expect(c[0]).toBe(255); expect(c[1]).toBe(0); expect(c[3]).toBe(255);
    expect(quads(g)).toBe(6);
    // scaled to half size, rotated about Y: x/z within ±0.5 * sqrt(2) / 2, y around 2.5
    const p = g.attributes.position.data;
    for (let i = 0; i < p.length; i += 3) { expect(Math.abs(p[i])).toBeLessThan(0.36); expect(Math.abs(p[i + 1] - 2.5)).toBeLessThan(0.26); }
  });
});

describe('snowball world: race camera', () => {
  function fakeGame(w: number, h: number) {
    const late: ((dt: number) => void)[] = [];
    const g = {
      camera: new Camera(), screen: { width: w, height: h }, time: { dt: 1 / 60 },
      onLateUpdate: (f: (dt: number) => void) => { late.push(f); return () => late.splice(late.indexOf(f), 1); },
    };
    return { g, late };
  }
  const racer = (d: number, x = 0, size = 5) => ({ x, d, size, targetX: x, y: 0 }) as unknown as Racer;

  it('chases behind and above the racer, looking down the track (-Z)', () => {
    const { g } = fakeGame(1280, 720);
    const cam = new RaceCamera(g as never), r = racer(50, 2);
    cam.reset(r);
    const c = g.camera;
    expect(c.position[2]).toBeGreaterThan(-50);   // behind (track runs along -Z)
    expect(c.position[1]).toBeGreaterThan(4);
    expect(c.position[0]).toBeCloseTo(1.2);        // x * 0.6
    c.updateWorld();
    const f = c.forward();
    expect(f[2]).toBeLessThan(-0.8);
    expect(f[1]).toBeLessThan(0);
    expect(c.fov).toBeCloseTo(58);
  });
  it('portrait screens get a wider FOV, a higher camera and a bigger ball lifts it more', () => {
    const a = fakeGame(1280, 720), b = fakeGame(390, 844);
    const ca = new RaceCamera(a.g as never), cb = new RaceCamera(b.g as never);
    ca.reset(racer(20)); cb.reset(racer(20));
    expect(b.g.camera.fov).toBeGreaterThan(a.g.camera.fov + 8);
    expect(b.g.camera.position[1]).toBeGreaterThan(a.g.camera.position[1]);
    const y0 = a.g.camera.position[1];
    ca.reset(racer(20, 0, 25));
    expect(a.g.camera.position[1]).toBeGreaterThan(y0 + 2);
  });
  it('intro flies from the finish to the start and resolves; update is ignored meanwhile', async () => {
    const { g, late } = fakeGame(1280, 720);
    const cam = new RaceCamera(g as never), p = racer(1.5);
    const sim = { player: p, level: { finishD: 200 } } as unknown as RaceSim;
    let done = false;
    const pr = cam.intro(sim, 2).then(() => { done = true; });
    expect(cam.flying).toBe(true);
    expect(-g.camera.position[2]).toBeGreaterThan(150);
    for (let i = 0; i < 60; i++) for (const f of late.slice()) f(1 / 60);
    cam.update(p, 1 / 60);
    expect(-g.camera.position[2]).toBeGreaterThan(5);
    for (let i = 0; i < 70; i++) for (const f of late.slice()) f(1 / 60);
    await pr;
    expect(done).toBe(true);
    expect(cam.flying).toBe(false);
    expect(late.length).toBe(0);
    expect(-g.camera.position[2]).toBeLessThan(0); // back behind the start line
  });
});
