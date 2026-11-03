// Music & sound effects (owner: audio): procedural chiptune of public-domain carols, festive sfx, rolling snow loop.
// No audio files. Sfx and the rolling loops are synthesized in JS (once, lazily, cached as AudioBuffers); the two music
// loops are arranged below and rendered once each with an OfflineAudioContext (off the main thread):
//   'race' — "Jingle Bells" (J. Pierpont, 1857): chorus + verse, 150 bpm, G major, pulse/triangle/noise + sleigh bells
//   'menu' — "We Wish You a Merry Christmas" (traditional English carol): 3/4, 112 bpm, music box, then chiptune
// Nothing touches the AudioContext before the first user gesture (the engine resumes it on gestures). Muting belongs
// to the platform wrapper (playgama → sound.mute); this module only skips work while muted.
// Usage: boot → music.setEnabled(save.music); music.play('menu'); prepareAudio() (renders ahead). Race: new RollSound()
// while loading, music.play('race') at GO, roll.update(...) every frame, roll.stop() at the end. Buttons: sfx('click').
import { sound, type Voice } from 'aiwebengine/audio';
import { hash, rng } from './util';

export type Sfx =
  | 'click' | 'coin' | 'gem' | 'smash' | 'shatter' | 'splash' | 'bridge' | 'boost' | 'shield' | 'count' | 'go' | 'finish'
  | 'win' | 'lose' | 'bell' | 'tick' | 'reveal' | 'buy' | 'whoosh' | 'crunch' | 'sizzle' | 'error' | 'levelup' | 'pop'
  | 'gift' | 'bump' | 'fall';
export type Track = 'menu' | 'race';

/** audio may start: the page is visible and got a user gesture (unknown on old browsers → let the engine handle it) */
function canPlay(): boolean {
  if (typeof document === 'undefined' || document.hidden) return false;
  const ua = (navigator as { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return ua ? ua.hasBeenActive : true;
}

/** a browser with Web Audio (not node tests) */
const hasAudio = () => typeof AudioBuffer !== 'undefined';

function toBuffer(d: Float32Array<ArrayBuffer>, sr: number): AudioBuffer {
  let b: AudioBuffer;
  try { b = new AudioBuffer({ length: d.length, sampleRate: sr, numberOfChannels: 1 }); }
  catch { b = sound.ctx.createBuffer(1, d.length, sr); }
  b.copyToChannel(d, 0);
  return b;
}

/** scale to a peak of `to` */
function normalize(d: Float32Array, to: number) {
  let p = 0;
  for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i]));
  if (p > 0) for (let i = 0; i < d.length; i++) d[i] *= to / p;
}

// ============================================================================ synthesis toolkit (JS, mono)
const SR = 44100;
const TAU = Math.PI * 2;
type Rnd = () => number;
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** waves: 0 sine, 1 triangle, 2 square, 3 pulse 25%, 4 pulse 12.5%, 5 saw */
type Wave = 0 | 1 | 2 | 3 | 4 | 5;
const DUTY = [0, 0, 0.5, 0.25, 0.125, 0];

/** PolyBLEP: smooths a unit step at phase 0 (keeps square/pulse/saw edges from aliasing) */
function blep(t: number, dt: number): number {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
function wave(w: Wave, ph: number, dt: number): number {
  if (w === 0) return Math.sin(TAU * ph);
  if (w === 1) return 4 * Math.abs(ph - 0.5) - 1;
  if (w === 5) return 2 * ph - 1 - blep(ph, dt);
  const d = DUTY[w];
  // pulse: +1 below the duty, -1 above, band-limited edges, DC removed
  return (ph < d ? 1 : -1) + blep(ph, dt) - blep(ph < d ? ph - d + 1 : ph - d, dt) + 1 - 2 * d;
}

interface ToneP { t?: number; d: number; f: number; to?: number; w?: Wave; v?: number; a?: number; k?: number; vib?: number }
/** add a note: pitch glides f→to (exponential) over d, attack a, exponential decay with time constant k, vibrato depth */
function tone(o: Float32Array, p: ToneP) {
  const n0 = Math.round((p.t ?? 0) * SR), n = Math.min(Math.round(p.d * SR), o.length - n0);
  const att = Math.max(1, (p.a ?? 0.003) * SR), fade = Math.min(n, 0.004 * SR), w = p.w ?? 0, v = p.v ?? 0.5;
  const glide = p.to ? (p.to / p.f) ** (1 / n) : 1, dk = p.k ? Math.exp(-1 / (p.k * SR)) : 1, vib = p.vib ?? 0;
  // steady sines (bells, partials) use a cheap rotation recurrence instead of Math.sin per sample
  const steady = w === 0 && glide === 1 && !vib, c = 2 * Math.cos((TAU * p.f) / SR);
  let f = p.f, ph = 0, e = 1, y0 = 0, y1 = Math.sin((TAU * p.f) / SR);
  for (let i = 0; i < n; i++) {
    let s: number;
    if (steady) { s = y1; const y2 = c * y1 - y0; y0 = y1; y1 = y2; }
    else {
      const dt = (vib ? f * (1 + vib * Math.sin(i * (TAU * 5.5 / SR))) : f) / SR;
      ph += dt;
      if (ph >= 1) ph -= 1;
      s = wave(w, ph, dt);
      f *= glide;
    }
    let g = i < att ? i / att : (e *= dk);
    if (n - i < fade) g *= (n - i) / fade;
    o[n0 + i] += s * g * v;
  }
}

interface NoiseP { t?: number; d: number; f: number; to?: number; q?: number; m?: 0 | 1 | 2; v?: number; a?: number; k?: number }
/** add filtered white noise (TPT state-variable filter; m: 0 lowpass, 1 bandpass, 2 highpass), cutoff glides f→to */
function noise(o: Float32Array, r: Rnd, p: NoiseP) {
  const n0 = Math.round((p.t ?? 0) * SR), n = Math.min(Math.round(p.d * SR), o.length - n0);
  const att = Math.max(1, (p.a ?? 0.003) * SR), fade = Math.min(n, 0.004 * SR), m = p.m ?? 0, v = p.v ?? 0.5;
  const kq = 1 / (p.q ?? 0.7), glide = p.to ? (p.to / p.f) ** (1 / n) : 1, dk = p.k ? Math.exp(-1 / (p.k * SR)) : 1;
  let f = p.f, e = 1, s1 = 0, s2 = 0, a1 = 0, a2 = 0, a3 = 0, seed = (r() * 4294967296) | 0;
  for (let i = 0; i < n; i++) {
    if ((i & 15) === 0) {
      const g = Math.tan(Math.PI * Math.min(f, SR * 0.45) / SR);
      a1 = 1 / (1 + g * (g + kq)); a2 = g * a1; a3 = g * a2;
    }
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0; // inline LCG: much cheaper than a closure call per sample
    const x = seed / 2147483648, v3 = x - s2, v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3;
    s1 = 2 * v1 - s1; s2 = 2 * v2 - s2;
    let g = i < att ? i / att : (e *= dk);
    if (n - i < fade) g *= (n - i) / fade;
    o[n0 + i] += (m === 0 ? v2 : m === 1 ? kq * v1 : x - kq * v1 - v2) * g * v;
    f *= glide;
  }
}

/** struck metal/glass: sine partials [ratio, amp, ...]; higher partials die faster */
const GLASS = [1, 1, 2.76, 0.35, 5.4, 0.18, 8.93, 0.08];
const SHARD = [1, 1, 2.41, 0.45];
const CHURCH = [0.5, 0.25, 1, 1, 1.19, 0.4, 1.5, 0.3, 2, 0.35, 2.52, 0.2, 3, 0.15];
function bell(o: Float32Array, t: number, f: number, v: number, k: number, parts = GLASS) {
  for (let i = 0; i < parts.length; i += 2) {
    const kk = k / (1 + i * 0.35);
    if (f * parts[i] < SR * 0.45) tone(o, { t, d: kk * 6, f: f * parts[i], v: v * parts[i + 1], k: kk, a: 0.0015 });
  }
}
/** one shake of sleigh bells: a cluster of tiny bright bells + a metallic rattle */
function jingle(o: Float32Array, r: Rnd, t: number, v: number) {
  for (let i = 0; i < 12; i++) {
    const tt = t + r() * r() * 0.06, f = 2300 + r() * 4200, k = 0.02 + r() * 0.05, a = v * (0.3 + 0.7 * r()) * 0.3;
    tone(o, { t: tt, d: k * 5, f, v: a, k, a: 0.0004 });
    tone(o, { t: tt, d: k * 4, f: f * 2.37, v: a * 0.4, k: k * 0.6, a: 0.0004 });
  }
  noise(o, r, { t, d: 0.09, f: 6500, m: 2, v: v * 0.35, a: 0.001, k: 0.025 });
}
/** random high pings (twinkles) between t0 and t1 */
function sparkle(o: Float32Array, r: Rnd, t0: number, t1: number, n: number, v: number) {
  for (let i = 0; i < n; i++) tone(o, { t: t0 + r() * (t1 - t0), d: 0.12, f: 4000 + r() * 5000, v: v * (0.4 + 0.6 * r()), k: 0.025, a: 0.001 });
}
/** crunchy grains (snow, ice debris) */
function grains(o: Float32Array, r: Rnd, t0: number, t1: number, n: number, f: number, v: number) {
  for (let i = 0; i < n; i++) {
    noise(o, r, { t: t0 + r() * (t1 - t0), d: 0.006 + r() * 0.02, f: f * (0.6 + 0.8 * r()), q: 1.2, m: 1, v: v * (0.3 + 0.7 * r()), a: 0.0005, k: 0.006 });
  }
}
/** bubbles: short upward chirps */
function bubbles(o: Float32Array, r: Rnd, t0: number, t1: number, n: number, v: number) {
  for (let i = 0; i < n; i++) {
    const t = t0 + r() * (t1 - t0), f = 350 + r() * 700;
    tone(o, { t, d: 0.06, f, to: f * 1.9, v: v * (0.5 + 0.5 * r()), a: 0.002, k: 0.025 });
  }
}
/** loop seam: crossfade the continuation after `len` into the start (equal power) */
function fold(o: Float32Array<ArrayBuffer>, len: number): Float32Array<ArrayBuffer> {
  const n = o.length - len;
  for (let i = 0; i < n; i++) { const k = i / n; o[i] = o[i] * Math.sqrt(k) + o[len + i] * Math.sqrt(1 - k); }
  return o.subarray(0, len);
}

// ============================================================================ sound effects
type Build = (o: Float32Array, r: Rnd) => void;
/** name → [seconds, playback volume, random pitch ±, synth] */
const SFX: Record<Sfx, [number, number, number, Build]> = {
  click: [0.06, 0.3, 0.04, (o, r) => {
    tone(o, { d: 0.05, f: 1900, to: 1300, v: 0.7, a: 0.0008, k: 0.009 });
    noise(o, r, { d: 0.02, f: 5000, m: 2, v: 0.2, a: 0.0005, k: 0.003 });
  }],
  tick: [0.045, 0.32, 0.05, (o, r) => {
    tone(o, { d: 0.04, f: 2700, to: 2100, w: 1, v: 0.6, a: 0.0005, k: 0.005 });
    noise(o, r, { d: 0.02, f: 3200, q: 2, m: 1, v: 0.6, a: 0.0003, k: 0.003 });
  }],
  coin: [0.45, 0.4, 0.012, (o) => {
    tone(o, { d: 0.075, f: hz(83), w: 3, v: 0.45, a: 0.002 });
    tone(o, { t: 0.07, d: 0.38, f: hz(88), w: 3, v: 0.45, a: 0.002, k: 0.12 });
    tone(o, { t: 0.07, d: 0.3, f: hz(100), v: 0.18, a: 0.002, k: 0.08 });
  }],
  gem: [1, 0.55, 0.02, (o, r) => {
    [88, 92, 95, 100, 104].forEach((m, i) => bell(o, i * 0.045, hz(m), 0.32, 0.22));
    sparkle(o, r, 0.12, 0.75, 14, 0.06);
  }],
  smash: [0.9, 0.7, 0.06, (o, r) => {
    noise(o, r, { d: 0.5, f: 3200, to: 900, q: 0.6, m: 1, v: 0.9, a: 0.001, k: 0.09 });
    noise(o, r, { d: 0.3, f: 700, v: 0.6, a: 0.001, k: 0.06 });
    tone(o, { d: 0.25, f: 120, to: 45, v: 0.8, a: 0.001, k: 0.07 });
    for (let i = 0; i < 20; i++) { const t = r() * r() * 0.4; bell(o, t, 2200 + r() * 5500, (0.06 + r() * 0.16) * (1 - t * 1.5), 0.015 + r() * 0.05, SHARD); }
  }],
  shatter: [0.5, 0.6, 0.08, (o, r) => {
    noise(o, r, { d: 0.45, f: 1400, to: 250, q: 0.8, v: 0.9, a: 0.006, k: 0.08 });
    tone(o, { d: 0.25, f: 150, to: 55, v: 0.8, a: 0.002, k: 0.06 });
    grains(o, r, 0, 0.12, 8, 1800, 0.25);
  }],
  splash: [0.7, 0.55, 0.06, (o, r) => {
    noise(o, r, { d: 0.6, f: 2200, to: 600, q: 0.7, m: 1, v: 0.8, a: 0.004, k: 0.13 });
    noise(o, r, { d: 0.25, f: 4000, m: 2, v: 0.3, a: 0.002, k: 0.05 });
    bubbles(o, r, 0.04, 0.5, 9, 0.22);
  }],
  bridge: [0.8, 0.7, 0.04, (o, r) => {
    tone(o, { d: 0.5, f: 95, to: 38, v: 1, a: 0.002, k: 0.14 });
    tone(o, { d: 0.3, f: 190, to: 70, w: 1, v: 0.3, a: 0.002, k: 0.06 });
    noise(o, r, { d: 0.4, f: 500, to: 200, v: 0.6, a: 0.002, k: 0.08 });
    grains(o, r, 0.01, 0.35, 26, 1500, 0.45);
  }],
  boost: [0.7, 0.5, 0.03, (o, r) => {
    noise(o, r, { d: 0.65, f: 350, to: 5000, q: 1.4, m: 1, v: 0.7, a: 0.2, k: 0.25 });
    tone(o, { d: 0.6, f: 220, to: 880, w: 3, v: 0.22, a: 0.03, k: 0.35, vib: 0.02 });
    tone(o, { d: 0.6, f: 330, to: 1320, w: 4, v: 0.1, a: 0.03, k: 0.35 });
  }],
  shield: [1.1, 0.5, 0, (o) => {
    [81, 85, 88, 93, 97].forEach((m, i) => bell(o, i * 0.055, hz(m), 0.28, 0.35));
    tone(o, { d: 1.1, f: 1760, v: 0.07, a: 0.25, k: 0.35 });
    tone(o, { d: 1.1, f: 1767, v: 0.07, a: 0.25, k: 0.35 });
  }],
  count: [0.22, 0.3, 0, (o) => {
    tone(o, { d: 0.2, f: hz(74), w: 2, v: 0.4, a: 0.002, k: 0.12 });
    tone(o, { d: 0.2, f: hz(86), v: 0.15, a: 0.002, k: 0.08 });
  }],
  go: [0.65, 0.55, 0, (o) => {
    for (const m of [79, 83, 86]) tone(o, { d: 0.62, f: hz(m), w: 3, v: 0.22, a: 0.003, k: 0.3, vib: 0.006 });
    tone(o, { d: 0.6, f: hz(91), v: 0.15, k: 0.25 });
  }],
  finish: [1.5, 0.6, 0, (o, r) => {
    bell(o, 0, hz(79), 0.45, 0.5, CHURCH);
    [79, 83, 86].forEach((m, i) => tone(o, { t: i * 0.1, d: 0.09, f: hz(m), w: 3, v: 0.25 }));
    tone(o, { t: 0.3, d: 1.1, f: hz(91), w: 3, v: 0.25, k: 0.4, vib: 0.008 });
    for (const m of [83, 86]) tone(o, { t: 0.3, d: 1, f: hz(m), w: 4, v: 0.12, k: 0.4 });
    jingle(o, r, 0.3, 0.4);
  }],
  win: [2.3, 0.7, 0, (o, r) => {
    const seq = [0, 74, 0.1, 0.11, 79, 0.1, 0.22, 83, 0.1, 0.33, 86, 0.3, 0.66, 83, 0.14, 0.82, 86, 0.14, 0.98, 91, 1.2];
    for (let i = 0; i < seq.length; i += 3) {
      const [t, m, d] = [seq[i], seq[i + 1], seq[i + 2]], held = d > 0.5;
      tone(o, { t, d, f: hz(m), w: 3, v: 0.26, k: held ? 0.5 : 0, vib: held ? 0.008 : 0 });
      tone(o, { t, d, f: hz(m - 12), w: 1, v: 0.18, k: held ? 0.5 : 0 });
    }
    for (const m of [83, 86]) tone(o, { t: 0.98, d: 1.2, f: hz(m), w: 4, v: 0.1, k: 0.5 });
    tone(o, { t: 0.98, d: 1, f: hz(55), w: 1, v: 0.35, k: 0.45 });
    for (let t = 0; t < 0.3; t += 0.04) noise(o, r, { t, d: 0.05, f: 1800, q: 0.8, m: 1, v: 0.15 + t, a: 0.001, k: 0.02 });
    noise(o, r, { t: 0.98, d: 1.2, f: 5000, m: 2, v: 0.35, a: 0.002, k: 0.35 });
    jingle(o, r, 0.98, 0.5);
  }],
  lose: [1.6, 0.5, 0, (o) => {
    [67, 66, 65, 64].forEach((m, i) => {
      const last = i === 3, d = last ? 0.7 : 0.28;
      tone(o, { t: i * 0.3, d, f: hz(m), w: 3, v: 0.22, a: 0.01, k: last ? 0.45 : 0, vib: last ? 0.03 : 0 });
      tone(o, { t: i * 0.3, d, f: hz(m - 12), w: 1, v: 0.25, a: 0.01, k: last ? 0.45 : 0 });
    });
  }],
  bell: [0.7, 0.5, 0.03, (o, r) => { jingle(o, r, 0, 0.8); jingle(o, r, 0.13, 0.55); jingle(o, r, 0.26, 0.3); }],
  reveal: [1.3, 0.55, 0, (o, r) => {
    [79, 83, 86, 91, 95, 98, 103].forEach((m, i) => bell(o, i * 0.06, hz(m), 0.25, 0.28));
    noise(o, r, { d: 0.5, f: 2000, to: 9000, q: 0.9, m: 1, v: 0.15, a: 0.4, k: 0.08 });
    sparkle(o, r, 0.3, 1.1, 16, 0.07);
  }],
  buy: [0.7, 0.55, 0.02, (o, r) => {
    noise(o, r, { d: 0.06, f: 2500, q: 1, m: 1, v: 0.5, a: 0.001, k: 0.015 });
    bell(o, 0.05, hz(95), 0.4, 0.2);
    bell(o, 0.11, hz(100), 0.4, 0.3);
    jingle(o, r, 0.05, 0.3);
  }],
  whoosh: [0.45, 0.45, 0.1, (o, r) => noise(o, r, { d: 0.45, f: 500, to: 2600, q: 1.1, m: 1, v: 0.8, a: 0.17, k: 0.09 })],
  crunch: [0.3, 0.45, 0.12, (o, r) => {
    grains(o, r, 0, 0.2, 22, 2000, 0.6);
    noise(o, r, { d: 0.25, f: 600, v: 0.35, a: 0.003, k: 0.05 });
  }],
  sizzle: [0.8, 0.4, 0.05, (o, r) => {
    noise(o, r, { d: 0.8, f: 4500, m: 2, v: 0.4, a: 0.06, k: 0.35 });
    for (let i = 0; i < 14; i++) noise(o, r, { t: r() * 0.6, d: 0.01, f: 2500 + r() * 3000, q: 1.5, m: 1, v: 0.5 * r(), a: 0.0003, k: 0.002 });
  }],
  error: [0.32, 0.32, 0, (o) => {
    for (const [t, f] of [[0, 200], [0.15, 190]]) {
      tone(o, { t, d: 0.13, f, to: f * 0.92, w: 2, v: 0.28, a: 0.003 });
      tone(o, { t, d: 0.13, f: f / 2, w: 1, v: 0.3, a: 0.003 });
    }
  }],
  levelup: [1.1, 0.6, 0, (o, r) => {
    [79, 83, 86, 91].forEach((m, i) => tone(o, { t: i * 0.07, d: 0.08, f: hz(m), w: 3, v: 0.25 }));
    for (const m of [91, 95, 98]) tone(o, { t: 0.28, d: 0.75, f: hz(m), w: 4, v: 0.14, k: 0.35, vib: 0.006 });
    tone(o, { t: 0.28, d: 0.6, f: hz(55), w: 1, v: 0.35, k: 0.3 });
    sparkle(o, r, 0.3, 0.9, 10, 0.06);
  }],
  pop: [0.12, 0.45, 0.15, (o, r) => {
    tone(o, { d: 0.09, f: 380, to: 1400, v: 0.8, a: 0.001, k: 0.03 });
    noise(o, r, { d: 0.01, f: 3000, q: 1, m: 1, v: 0.3, a: 0.0002, k: 0.002 });
  }],
  gift: [0.8, 0.6, 0, (o, r) => {
    noise(o, r, { d: 0.14, f: 3200, q: 0.6, m: 1, v: 0.45, a: 0.015, k: 0.04 });
    tone(o, { t: 0.1, d: 0.1, f: hz(86), w: 3, v: 0.28 });
    tone(o, { t: 0.2, d: 0.55, f: hz(91), w: 3, v: 0.28, k: 0.22, vib: 0.006 });
    tone(o, { t: 0.2, d: 0.55, f: hz(95), w: 4, v: 0.1, k: 0.22 });
    jingle(o, r, 0.2, 0.35);
    sparkle(o, r, 0.22, 0.75, 8, 0.06);
  }],
  bump: [0.18, 0.4, 0.1, (o, r) => {
    tone(o, { d: 0.16, f: 150, to: 75, v: 0.9, a: 0.002, k: 0.05 });
    noise(o, r, { d: 0.06, f: 900, v: 0.4, a: 0.001, k: 0.015 });
  }],
  fall: [1.25, 0.5, 0.03, (o, r) => {
    tone(o, { d: 0.78, f: 1000, to: 190, v: 0.35, a: 0.01, vib: 0.02 });
    tone(o, { d: 0.78, f: 500, to: 95, w: 1, v: 0.18, a: 0.01 });
    noise(o, r, { t: 0.76, d: 0.48, f: 1800, to: 500, q: 0.7, m: 1, v: 0.75, a: 0.004, k: 0.12 });
    bubbles(o, r, 0.8, 1.15, 6, 0.2);
  }],
};
export const SFX_NAMES = /* @__PURE__ */ Object.keys(SFX) as Sfx[];

/** the samples of one sound effect (deterministic; peak 0.9) */
export function synthSfx(name: Sfx): Float32Array<ArrayBuffer> {
  const [sec, , , build] = SFX[name], o = new Float32Array(Math.ceil(sec * SR));
  build(o, rng(hash(name)));
  normalize(o, 0.9);
  return o;
}

const sfxBufs = new Map<Sfx, AudioBuffer>();
function sfxBuffer(name: Sfx): AudioBuffer {
  let b = sfxBufs.get(name);
  if (!b) sfxBufs.set(name, (b = toBuffer(synthSfx(name), SR)));
  return b;
}

const lastPlay = new Map<Sfx, number>();
/** quick coin streaks climb a major scale */
const COIN_STEPS = [0, 2, 4, 5, 7, 9, 11, 12];
let coinRun = 0, coinT = -1e9;

/** play a sound effect; vol 0..1 (relative to its designed loudness) */
export function sfx(name: Sfx, vol = 1): void {
  if (vol <= 0 || sound.muted || !canPlay()) return;
  const now = performance.now();
  // the same sound twice within a frame or two would only get louder
  if (now - (lastPlay.get(name) ?? -1e9) < 40) return;
  lastPlay.set(name, now);
  let pitch = 1;
  if (name === 'coin') {
    coinRun = now - coinT < 450 ? Math.min(coinRun + 1, COIN_STEPS.length - 1) : 0;
    coinT = now;
    pitch = 2 ** (COIN_STEPS[coinRun] / 12);
  }
  const d = SFX[name];
  sound.play(sfxBuffer(name), { volume: d[1] * vol, pitch, pitchRandom: d[2] });
  // jingles sit on top of the music
  if (name === 'finish' || name === 'win' || name === 'lose' || name === 'levelup') music.duck(d[0]);
}

// ============================================================================ music: scores
// Melody: bars split by '|', tokens "B4" (a quarter), "G4:1.5" (beats), "r:2" (rest). Chords: one per bar, or "C:1 D7:2".
const JB_CHORUS =
  'B4 B4 B4:2|B4 B4 B4:2|B4 D5 G4:1.5 A4:.5|B4:4|C5 C5 C5:1.5 C5:.5|C5 B4 B4 B4:.5 B4:.5|B4 A4 A4 B4|A4:2 D5:2|' +
  'B4 B4 B4:2|B4 B4 B4:2|B4 D5 G4:1.5 A4:.5|B4:4|C5 C5 C5:1.5 C5:.5|C5 B4 B4 B4:.5 B4:.5|D5 D5 C5 A4|G4:4';
const JB_VERSE =
  'D4 B4 A4 G4|D4:3 D4:.5 D4:.5|D4 B4 A4 G4|E4:4|E4 C5 B4 A4|F#4:4|D5 D5 C5 A4|B4:4|' +
  'D4 B4 A4 G4|D4:4|D4 B4 A4 G4|E4:4|E4 C5 B4 A4|D5 D5 D5 D5|E5 D5 C5 A4|G4:2 r:2';
const WW =
  'G4 G4:.5 A4:.5 G4:.5 F#4:.5|E4 E4 E4|A4 A4:.5 B4:.5 A4:.5 G4:.5|F#4 D4 D4|B4 B4:.5 C5:.5 B4:.5 A4:.5|G4 E4 D4:.5 D4:.5|E4 A4 F#4|G4:2 D4|' +
  'G4 G4 G4|F#4:2 F#4|G4 F#4 E4|D4:2 A4|B4 A4 G4|D5 D4 D4:.5 D4:.5|E4 A4 F#4|G4:2 D4';
const WW_CH = 'G|C|A7|D|B7|Em|C:1 D7:2|G|G|D|Em|D|G|D|C:1 D7:2|G';

/** bpm, beats per bar, melody, chords, echo [beats, feedback, wet] */
export const SONGS: Record<Track, { bpm: number; bpb: number; mel: string; ch: string; echo: number[] }> = {
  race: {
    bpm: 150, bpb: 4, mel: JB_CHORUS + '|' + JB_VERSE, echo: [0.75, 0.28, 0.16],
    ch: 'G|G|G|G|C|G|A7|D7|G|G|G|G|C|G|D7|G|' + 'G|G|G|C|Am|D|D7|G|G|G|G|C|Am|G|D7|G',
  },
  menu: { bpm: 112, bpb: 3, mel: WW + '|' + WW, ch: WW_CH + '|' + WW_CH, echo: [0.75, 0.35, 0.25] },
};

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** "F#4" → MIDI note number */
export function midi(n: string): number {
  const m = /^([A-G])([#b]?)(\d)$/.exec(n);
  if (!m) throw new Error('bad note ' + n);
  return PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12 * (+m[3] + 1);
}
/** melody → [start beat, beats, midi (-1 = rest)] */
export function parseScore(s: string): [number, number, number][] {
  const out: [number, number, number][] = [];
  let b = 0;
  for (const tok of s.split(/[\s|]+/)) {
    if (!tok) continue;
    const [p, l] = tok.split(':'), len = l ? +l : 1;
    out.push([b, len, p === 'r' ? -1 : midi(p)]);
    b += len;
  }
  return out;
}
const QUAL: Record<string, number[]> = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10] };
/** chords → [start beat, beats, pitch classes (root, third, fifth[, seventh])] */
export function parseChords(s: string, bpb: number): [number, number, number[]][] {
  const out: [number, number, number[]][] = [];
  s.split('|').forEach((bar, i) => {
    let b = i * bpb;
    for (const tok of bar.trim().split(/\s+/)) {
      const [sym, l] = tok.split(':'), m = /^([A-G][#b]?)(m|7)?$/.exec(sym);
      if (!m) throw new Error('bad chord ' + sym);
      const root = midi(m[1] + '4') % 12, len = l ? +l : bpb;
      out.push([b, len, QUAL[m[2] ?? ''].map((x) => (root + x) % 12)]);
      b += len;
    }
  });
  return out;
}
/** lowest note >= lo with pitch class pc */
const near = (pc: number, lo: number) => lo + ((((pc - lo) % 12) + 12) % 12);
const G_MAJOR = [7, 9, 11, 0, 2, 4, 6];
/** harmony under a melody note: the closest chord tone 3–5 semitones below, else the diatonic third below (G major) */
export function below(m: number, ch: number[]): number {
  for (let d = 3; d <= 5; d++) if (ch.includes((m - d + 120) % 12)) return m - d;
  const i = G_MAJOR.indexOf(m % 12);
  return i < 0 ? m - 3 : m - ((m % 12) - G_MAJOR[(i + 5) % 7] + 12) % 12;
}

// ============================================================================ music: rendering
const MSR = 32000;

let bellTex: AudioBuffer | null = null;
/** a continuous texture of tiny sleigh bells (0.6 s loop, seamless); the music shapes it into shakes */
function bellTexture(): Float32Array<ArrayBuffer> {
  const len = Math.round(0.6 * SR), o = new Float32Array(len + Math.round(0.08 * SR)), r = rng(77);
  const pitches = [2650, 3120, 3570, 4010, 4580, 5230, 6110];
  for (let i = 0; i < 90; i++) {
    const f = pitches[Math.floor(r() * pitches.length)] * (0.99 + r() * 0.02), k = 0.02 + r() * 0.04, t = r() * (o.length / SR - 0.05);
    tone(o, { t, d: k * 5, f, v: 0.3 + 0.7 * r(), k, a: 0.0004 });
    tone(o, { t, d: k * 3, f: f * 2.37, v: 0.3 * r(), k: k * 0.6, a: 0.0004 });
  }
  noise(o, r, { d: o.length / SR, f: 7000, m: 2, v: 0.25 });
  const d = fold(o, len);
  normalize(d, 0.9);
  return d;
}

interface Ch { o: OscillatorNode; g: AudioParam }
/** piecewise-linear envelope [time, level, ...] from t, cut (with a 12 ms release) to fit `len` seconds */
function shape(p: AudioParam, t: number, len: number, env: number[], v: number) {
  p.setValueAtTime(0, t);
  const end = len - 0.012;
  let pt = 0, pv = 0;
  for (let i = 0; i < env.length; i += 2) {
    let et = env[i], ev = env[i + 1];
    if (et >= end) { ev = pv + ((ev - pv) * (end - pt)) / (et - pt || 1); et = end; }
    p.linearRampToValueAtTime(ev * v, t + et);
    if (et === end) { p.linearRampToValueAtTime(0, t + len); return; }
    pt = et; pv = ev;
  }
}
/** sustained note envelope (lead/bass) for a note of `len` seconds */
function hold(len: number): number[] {
  const g = Math.max(0.03, len * 0.88);
  return [0.005, 1, Math.min(0.08, g / 2), 0.8, g, 0.65, Math.min(len, g + 0.03), 0];
}
const PLUCK = [0.003, 1, 0.08, 0.5, 0.4, 0.18, 1.2, 0];
const HIT = [0.002, 1, 0.04, 0.55, 0.14, 0.18, 0.28, 0];

/**
 * Render a music loop (seamless: the tails past the end are added onto the start) with an OfflineAudioContext.
 * `solo` keeps one part only: lead | harm | stab | bass | drums | bells (tests).
 */
export async function renderMusic(id: Track, solo?: string): Promise<AudioBuffer> {
  const S = SONGS[id], spb = 60 / S.bpm, mel = parseScore(S.mel), chords = parseChords(S.ch, S.bpb);
  const beats = mel[mel.length - 1][0] + mel[mel.length - 1][1], bars = beats / S.bpb;
  const len = Math.round(beats * spb * MSR), tail = 2 * MSR;
  const oc = new OfflineAudioContext(1, len + tail, MSR);
  const mix = oc.createGain();
  mix.connect(oc.destination);
  const bus = (name: string, v: number) => {
    const g = oc.createGain();
    g.gain.value = solo && solo !== name ? 0 : v;
    g.connect(mix);
    return g;
  };
  const leadBus = bus('lead', 1), harmBus = bus('harm', 1), stabBus = bus('stab', 1), bassBus = bus('bass', 1);
  const drumBus = bus('drums', 1), bellBus = bus('bells', 1);
  // echo on the melody
  const dl = oc.createDelay(1), fb = oc.createGain(), wet = oc.createGain();
  dl.delayTime.value = S.echo[0] * spb; fb.gain.value = S.echo[1]; wet.gain.value = solo ? 0 : S.echo[2];
  leadBus.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(mix);

  const pulse = (duty: number) => {
    const n = 32, re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) re[k] = Math.sin(Math.PI * k * duty) / k;
    return oc.createPeriodicWave(re, im);
  };
  const voice = (w: PeriodicWave | OscillatorType, out: AudioNode): Ch => {
    const o = oc.createOscillator(), g = oc.createGain();
    if (typeof w === 'string') o.type = w as OscillatorType; else o.setPeriodicWave(w);
    g.gain.value = 0;
    o.connect(g); g.connect(out);
    o.start();
    return { o, g: g.gain };
  };
  const note = (c: Ch, t: number, l: number, m: number, env: number[], v: number) => {
    c.o.frequency.setValueAtTime(hz(m), t);
    shape(c.g, t, l, env, v);
  };
  const lead = voice(pulse(0.25), leadBus), harm = voice(pulse(0.125), harmBus), stabC = voice(pulse(0.5), stabBus);
  const box = voice(oc.createPeriodicWave(new Float32Array(5), new Float32Array([0, 1, 0.25, 0.08, 0.04])), leadBus);
  const bass = voice('triangle', bassBus), kick = voice('sine', drumBus);
  // delayed vibrato on long lead notes (detune in cents)
  const lfo = oc.createOscillator(), depth = oc.createGain();
  lfo.frequency.value = 5.6; depth.gain.value = 0;
  lfo.connect(depth); depth.connect(lead.o.detune); lfo.start();
  const vib = (t: number, l: number) => {
    depth.gain.setValueAtTime(0, t);
    if (l > 0.5) { depth.gain.setValueAtTime(0, t + 0.22); depth.gain.linearRampToValueAtTime(14, t + 0.5); }
  };
  // noise drums & sleigh bells: shared looping sources, one gain per instrument
  const nb = oc.createBuffer(1, MSR, MSR), nd = nb.getChannelData(0), r = rng(hash(id));
  for (let i = 0; i < nd.length; i++) nd[i] = r() * 2 - 1;
  const loopSrc = (b: AudioBuffer) => { const s = oc.createBufferSource(); s.buffer = b; s.loop = true; s.start(); return s; };
  const ns = loopSrc(nb), bs = loopSrc((bellTex ??= toBuffer(bellTexture(), SR)));
  const filtered = (src: AudioNode, type: BiquadFilterType, f: number, q: number, out: AudioNode) => {
    const fl = oc.createBiquadFilter(), g = oc.createGain();
    fl.type = type; fl.frequency.value = f; fl.Q.value = q; g.gain.value = 0;
    src.connect(fl); fl.connect(g); g.connect(out);
    return g.gain;
  };
  const hatG = filtered(ns, 'highpass', 7000, 0.7, drumBus), snareG = filtered(ns, 'bandpass', 1900, 0.8, drumBus);
  const bellG = filtered(bs, 'highpass', 2500, 0.7, bellBus);
  const hats: number[][] = [], snares: number[][] = [], bells: number[][] = [];
  /** hits: [time, level, natural length]; each one is cut at the next */
  const hits = (p: AudioParam, list: number[][], env: (l: number) => number[]) => {
    list.sort((a, b) => a[0] - b[0]);
    list.forEach(([t, v, l], i) => shape(p, t, Math.min(l, (list[i + 1]?.[0] ?? 1e9) - t), env(l), v));
  };
  const decay = (l: number) => [0.001, 1, l * 0.3, 0.3, l, 0];
  const chordAt = (b: number) => { let c = chords[0][2]; for (const x of chords) if (x[0] <= b + 1e-6) c = x[2]; return c; };
  /** a chord stab on the mono stab channel: a fast arpeggio of its tones */
  const stab = (t: number, l: number, ch: number[], v: number) => {
    const tones = ch.slice(0, 3).map((pc) => near(pc, 62)).sort((a, b) => a - b);
    shape(stabC.g, t, l, PLUCK, v);
    for (let i = 0; i * 0.045 < l - 0.01; i++) stabC.o.frequency.setValueAtTime(hz(tones[i % 3]), t + i * 0.045);
  };

  if (id === 'race') {
    for (const [b, l, m] of mel) {
      if (m < 0) continue;
      const t = b * spb, d = l * spb;
      note(lead, t, d, m + 12, hold(d), 0.2);
      vib(t, d);
      if (b < 64) note(harm, t, d, below(m, chordAt(b)) + 12, hold(d), 0.11); // chorus: harmony line
    }
    for (let bar = 0; bar < bars; bar++) {
      const b0 = bar * 4, t0 = b0 * spb, chorus = bar < 16, ch = chordAt(b0);
      // oom-pah: bass root / fifth on 1 and 3, chord stabs on 2 and 4
      note(bass, t0, spb * 0.8, near(ch[0], 45), hold(spb * 0.8), 0.3);
      note(bass, t0 + 2 * spb, spb * 0.8, near(ch[2], 45), hold(spb * 0.8), 0.26);
      stab(t0 + spb, spb * 0.6, chordAt(b0 + 1), 0.07);
      stab(t0 + 3 * spb, spb * 0.6, chordAt(b0 + 3), 0.07);
      for (const k of [t0, t0 + 2 * spb]) {
        kick.o.frequency.setValueAtTime(190, k);
        kick.o.frequency.exponentialRampToValueAtTime(52, k + 0.08);
        shape(kick.g, k, 0.16, [0.002, 1, 0.05, 0.45, 0.14, 0], 0.3);
      }
      snares.push([t0 + spb, 0.2, 0.16]);
      if (bar === bars - 1) [2, 2.5, 3, 3.5].forEach((x, i) => snares.push([t0 + x * spb, 0.1 + i * 0.04, 0.16])); // fill
      else snares.push([t0 + 3 * spb, 0.2, 0.16]);
      for (let e = 0; e < 8; e++) {
        const t = t0 + (e * spb) / 2, off = e & 1;
        if (bar % 16 === 0 && e === 0) hats.push([t, 0.09, 1]); // crash at the section start
        else if (chorus || off) hats.push([t, off ? 0.06 : 0.04, 0.05]);
        bells.push([t, (chorus ? 0.32 : 0.22) * (e % 4 === 2 ? 1 : off ? 0.55 : 0.8), 0.28]);
      }
    }
  } else {
    const half = beats / 2;
    for (const [b, l, m] of mel) {
      if (m < 0) continue;
      const t = b * spb, d = l * spb;
      if (b < half) note(box, t, d, m + 12, PLUCK, 0.26); // music box
      else {
        note(lead, t, d, m + 12, hold(d), 0.17);
        vib(t, d);
        note(harm, t, d, below(m, chordAt(b)) + 12, hold(d), 0.07);
      }
    }
    for (let bar = 0; bar < bars; bar++) {
      const b0 = bar * 3, t0 = b0 * spb, second = b0 >= half;
      note(bass, t0, spb * 1.6, near(chordAt(b0)[0], 43), hold(spb * 1.6), 0.25);
      if (!second) for (const x of [1, 2]) stab(t0 + x * spb, spb * 0.5, chordAt(b0 + x), 0.045); // waltz: oom-pah-pah
      else {
        // broken chord in eighths: root third fifth octave fifth third
        for (let e = 0; e < 6; e++) {
          const ch = chordAt(b0 + e / 2), m = near(ch[[0, 1, 2, 0, 2, 1][e]], 60) + (e === 3 ? 12 : 0);
          note(stabC, t0 + (e * spb) / 2, spb / 2, m, PLUCK, 0.05);
        }
        hats.push([t0 + spb, 0.04, 0.05], [t0 + 2 * spb, 0.04, 0.05]);
      }
      if (second || bar === 0) bells.push([t0, second ? 0.2 : 0.12, 0.28]);
    }
  }
  hits(hatG, hats, decay);
  hits(snareG, snares, decay);
  hits(bellG, bells, () => HIT);

  const out = await oc.startRendering(), d = out.getChannelData(0);
  for (let i = 0; i < tail; i++) d[i] += d[len + i]; // as if the loop had been playing before
  const loop = d.subarray(0, len);
  if (!solo) normalize(loop, 0.9); // (solo parts keep their mix level)
  return toBuffer(loop, MSR);
}

const tracks = new Map<Track, Promise<AudioBuffer>>();
/** render (once; cached) a music track; call early so the first play() starts without a delay */
export function preloadMusic(id: Track): Promise<AudioBuffer> {
  let p = tracks.get(id);
  if (!p) {
    tracks.set(id, (p = renderMusic(id)));
    p.catch(() => tracks.delete(id)); // retry on the next play
  }
  return p;
}

// ============================================================================ music: player
export interface Music {
  /** start / switch track (fades) */
  play(track: 'menu' | 'race'): void;
  stop(): void;
  /** music on/off setting (sfx are controlled by sound.mute) */
  setEnabled(on: boolean): void;
  readonly enabled: boolean;
}

/** per track: the race mix has more transient peaks, so it is quieter after peak normalization */
const MUSIC_VOL: Record<Track, number> = { menu: 0.45, race: 0.56 };
const noop = () => {};

class MusicPlayer implements Music {
  private _on = true;
  /** requested track (kept while disabled) */
  private _want: Track | null = null;
  /** track of the current (or starting) voice */
  private _cur: Track | null = null;
  private _voice: Voice | null = null;
  private _duck: GainNode | null = null;
  private _ctx: AudioContext | null = null;
  private _req = 0;
  private _hooked = false;

  get enabled() { return this._on; }
  /** fade: crossfade seconds */
  play(track: Track, fade = 1) { this._want = track; this._sync(fade); }
  stop(fade = 1) { this._want = null; this._sync(fade); }
  setEnabled(on: boolean) { this._on = on; this._sync(0.5); }

  /** dip the music for `sec` seconds (under jingles) */
  duck(sec: number, level = 0.3) {
    const g = this._duck?.gain;
    if (!g) return;
    const t = this._duck!.context.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(level, t, 0.05);
    g.setTargetAtTime(1, t + sec, 0.4);
  }

  private _sync(fade: number) {
    this._hook();
    const want = this._on ? this._want : null;
    if (want) preloadMusic(want).catch(noop);
    // the engine replaced its AudioContext (phones, after a lock): the old voice is gone
    if (this._voice && this._ctx !== sound.ctx) this._drop(0);
    if (want === this._cur) return;
    this._drop(fade);
    if (!want || !canPlay()) return; // the gesture hook retries
    this._cur = want;
    const req = ++this._req;
    preloadMusic(want).then((buf) => {
      if (req !== this._req) return;
      const v = sound.play(buf, { loop: true, bus: 'music', volume: 0 })!, c = v.gain.context, d = c.createGain();
      // source → duck → voice gain → music bus
      v.source.disconnect();
      v.source.connect(d);
      d.connect(v.gain);
      v.gain.gain.setTargetAtTime(MUSIC_VOL[want], c.currentTime, Math.max(0.01, fade / 3));
      this._voice = v;
      this._duck = d;
      this._ctx = sound.ctx;
    }, () => { if (req === this._req) this._cur = null; });
  }

  private _drop(fade: number) {
    this._req++;
    try { this._voice?.stop(fade); } catch { /* context closed */ }
    this._voice = this._duck = null;
    this._cur = null;
  }

  /** start the music after the first gesture, and again after the engine had to replace its context */
  private _hook() {
    if (this._hooked || typeof addEventListener === 'undefined') return;
    this._hooked = true;
    const on = () => {
      if (!this._on || !this._want || !canPlay()) return;
      // still inside the gesture: create / resume the context now (iOS only unlocks audio here)
      if (!this._voice) { const c = sound.ctx; if (c.state === 'suspended') c.resume().catch(noop); }
      setTimeout(() => this._sync(1)); // after the engine's own gesture handler
    };
    for (const ev of ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click']) addEventListener(ev, on, { passive: true, capture: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(() => this._sync(1)); });
  }
}

export const music = /* @__PURE__ */ new MusicPlayer();

// ============================================================================ rolling snowball
/** 2 s seamless loop: crunchy granular snow, or a smooth hiss + rumble for ice */
export function rollData(ice: boolean): Float32Array<ArrayBuffer> {
  const len = 2 * SR, o = new Float32Array(len + Math.round(0.05 * SR)), r = rng(ice ? 7 : 3), d = o.length / SR;
  if (ice) {
    noise(o, r, { d, f: 1600, q: 0.45, m: 1, v: 0.35 });
    noise(o, r, { d, f: 220, v: 0.5 });
    // slow wobble of the rolling ball (6 cycles per loop: periodic)
    for (let i = 0; i < o.length; i++) o[i] *= 0.85 + 0.15 * Math.sin((TAU * 3 * i) / SR);
  } else {
    noise(o, r, { d, f: 1300, q: 0.5, m: 1, v: 0.22 });
    noise(o, r, { d, f: 180, v: 0.45 });
    grains(o, r, 0, d - 0.03, 220, 2200, 0.9);
  }
  const out = fold(o, len);
  normalize(out, 0.9);
  return out;
}
const rollBufs: AudioBuffer[] = [];
const rollBuffer = (ice: boolean) => (rollBufs[+ice] ??= toBuffer(rollData(ice), SR));
const ROLL_VOL = 0.45;

/** looping snow crunch of the player's rolling ball */
export class RollSound {
  private _snow: Voice | null = null;
  private _ice: Voice | null = null;
  private _f: BiquadFilterNode | null = null;
  private _ctx: AudioContext | null = null;
  private _lvl = 0;
  /** 1 = snow, 0 = ice */
  private _mix = 1;

  /** synthesizes the loops now (create it while the race loads, not at the start line) */
  constructor() {
    if (hasAudio()) { rollBuffer(false); rollBuffer(true); }
  }

  /** every frame: speed01/size01 in 0..1, onSnow = the ball grows here (else ice/slush), active = rolling at all */
  update(dt: number, speed01: number, size01: number, onSnow: boolean, active: boolean): void {
    const s = Math.min(1, Math.max(0, size01));
    this._lvl += ((active ? Math.min(1, Math.max(0, speed01)) : 0) - this._lvl) * Math.min(1, dt * 10);
    this._mix += ((onSnow ? 1 : 0) - this._mix) * Math.min(1, dt * 7);
    if (this._lvl < 0.004 || sound.muted || !canPlay()) { this._release(); return; }
    const ctx = sound.ctx;
    if (!this._snow || this._ctx !== ctx) this._start(ctx);
    const loud = ROLL_VOL * this._lvl * (0.35 + 0.65 * s), rate = (0.7 + 0.5 * this._lvl) * (1.15 - 0.35 * s);
    this._snow!.gain.gain.value = loud * this._mix;
    this._ice!.gain.gain.value = loud * 0.45 * (1 - this._mix);
    this._snow!.source.playbackRate.value = rate;
    this._ice!.source.playbackRate.value = rate;
    // faster = brighter, bigger = duller
    this._f!.frequency.value = 700 + 4300 * this._lvl * (1 - 0.45 * s);
  }

  stop(): void {
    this._lvl = 0;
    this._release();
  }

  private _start(ctx: AudioContext) {
    this._release(0);
    const snow = sound.play(rollBuffer(false), { loop: true, volume: 0 })!, f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    snow.source.disconnect();
    snow.source.connect(f);
    f.connect(snow.gain);
    this._snow = snow;
    this._ice = sound.play(rollBuffer(true), { loop: true, volume: 0 });
    this._f = f;
    this._ctx = ctx;
  }

  private _release(fade = 0.08) {
    if (!this._snow) return;
    try { this._snow.stop(fade); this._ice?.stop(fade); } catch { /* context closed */ }
    this._snow = this._ice = null;
    this._f = null;
  }
}

// ============================================================================ warm-up
/**
 * Synthesize everything ahead of time so nothing renders mid-race: both music tracks (off-thread) and all sfx (in
 * small main-thread slices). Optional; call once after the menu is up.
 */
export function prepareAudio(): void {
  if (!hasAudio()) return;
  preloadMusic('menu').catch(noop);
  preloadMusic('race').catch(noop);
  const jobs: (() => unknown)[] = SFX_NAMES.map((n) => () => sfxBuffer(n));
  jobs.push(() => rollBuffer(false), () => rollBuffer(true));
  let i = 0;
  const step = () => {
    const t = performance.now();
    while (i < jobs.length && performance.now() - t < 6) jobs[i++]();
    if (i < jobs.length) setTimeout(step, 40);
  };
  setTimeout(step, 40);
}
