import type { ParticleOptions } from './particles';

/** Ready-made particle configurations. Spread and override: `{ ...presets.fire(), rate: 80 }` */
export const presets = {
  /** looping flame (place emitter at the base) */
  fire: (): ParticleOptions => ({
    max: 200, rate: 60, lifetime: [0.5, 0.9], speed: [0.8, 1.6], shape: 'cone', angle: 0.25, radius: 0.15,
    size: [0.55, 0.1], color: [0xffe08a, 0xff7a1a, 0xc2260a], alpha: [0, 1, 0.8, 0], gravity: [0, 1.5, 0], drag: 1, intensity: 1.5,
  }),
  /** looping soft smoke column */
  smoke: (): ParticleOptions => ({
    max: 120, rate: 12, lifetime: [2, 3.5], speed: [0.4, 0.8], shape: 'cone', angle: 0.3, radius: 0.2,
    size: [0.5, 2], color: [0x888888, 0x555555], alpha: [0, 0.45, 0], blend: 'alpha', drag: 0.4, spin: [0.2, 0.6],
  }),
  /** one-shot explosion: emit(~60) */
  explosion: (): ParticleOptions => ({
    max: 300, lifetime: [0.35, 0.8], speed: [3, 9], shape: 'sphere', radius: 0.2, size: [1.2, 0.2],
    color: [0xffffff, 0xffc14a, 0xff4d1a, 0x331100], alpha: [1, 1, 0], drag: 3, intensity: 2,
  }),
  /** one-shot sparks: emit(~30) */
  sparks: (): ParticleOptions => ({
    max: 200, lifetime: [0.3, 0.7], speed: [4, 10], shape: 'sphere', size: [0.12, 0.02],
    color: [0xffffff, 0xffd24a, 0xff8a1a], alpha: [1, 1, 0], gravity: [0, -12, 0], drag: 1.5, intensity: 3,
  }),
  /** one-shot confetti celebration: emit(~80) */
  confetti: (): ParticleOptions => ({
    max: 300, lifetime: [1.8, 3], speed: [5, 10], shape: 'cone', angle: 0.6, size: 0.18, sizeRandom: [0.6, 1.2],
    color: [0xff4d6d, 0xffd23f, 0x3bceac, 0x4d96ff, 0xb15cff], randomColor: true, alpha: [1, 1, 1, 0],
    gravity: [0, -6, 0], drag: 1.8, spin: [4, 10], blend: 'alpha',
  }),
  /** dust puff (landing, footsteps): emit(~10) */
  dust: (): ParticleOptions => ({
    max: 100, lifetime: [0.4, 0.8], speed: [0.8, 2], shape: 'ring', radius: 0.2, direction: [0, 1, 0],
    size: [0.25, 0.7], color: 0xc9b89a, alpha: [0.6, 0], blend: 'alpha', drag: 4, gravity: [0, 0.8, 0],
  }),
  /** sparkles orbiting / pickup shine */
  magic: (): ParticleOptions => ({
    max: 150, rate: 30, lifetime: [0.6, 1.2], speed: [0.2, 0.8], shape: 'sphere', radius: 0.5, size: [0.2, 0],
    color: [0xffffff, 0x9ad0ff, 0xb77dff], alpha: [0, 1, 0], gravity: [0, 0.8, 0], intensity: 2,
  }),
  /** coin/pickup collect burst: emit(~20) */
  collect: (): ParticleOptions => ({
    max: 100, lifetime: [0.3, 0.6], speed: [2, 5], shape: 'sphere', size: [0.25, 0], color: [0xfff3a0, 0xffc300],
    alpha: [1, 0], drag: 2, intensity: 2,
  }),
  /** blood/hit splash: emit(~15) */
  hit: (): ParticleOptions => ({
    max: 100, lifetime: [0.25, 0.5], speed: [2, 6], shape: 'sphere', size: [0.2, 0.05], color: [0xffffff, 0xff3b3b],
    alpha: [1, 0], gravity: [0, -9, 0], drag: 2, intensity: 1.5,
  }),
  /** falling snow/rain area (attach to camera or place above level) */
  snow: (): ParticleOptions => ({
    max: 800, rate: 150, lifetime: [4, 6], speed: [0.5, 1], shape: 'box', box: [15, 0.5, 15], direction: [0, -1, 0],
    size: 0.08, sizeRandom: [0.5, 1.5], color: 0xffffff, alpha: [0, 0.9, 0.9, 0], gravity: [0, -0.5, 0], blend: 'alpha',
  }),
};
