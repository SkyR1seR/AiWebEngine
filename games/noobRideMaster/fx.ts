// Minecraft-like effects: square pixel particles, and the generated whirr of the fans.
import { Texture } from 'aiwebengine';
import type { ParticleOptions } from 'aiwebengine/fx';
import { sound } from 'aiwebengine/audio';

let square: Texture | null = null;
/**
 * Particle options turned into Minecraft particles: hard-edged squares (no soft dots), not spinning, a bit smaller.
 * `scale` multiplies the sizes.
 */
export function px(o: ParticleOptions, scale = 0.6): ParticleOptions {
  square ??= Texture.fromPixels(new Uint8Array(4 * 4 * 4).fill(255), 4, 4, { filter: 'nearest', mips: false });
  const sz = o.size ?? 0.2;
  return {
    ...o, texture: square, sheet: undefined, rotation: 0, spin: 0,
    size: typeof sz === 'number' ? sz * scale : [sz[0] * scale, sz[1] * scale],
  };
}

/** one second of fan noise: rumbling filtered noise chopped by the blades (a whole number of chops: it loops seamlessly) */
function fanBuffer(ctx: AudioContext) {
  const sr = ctx.sampleRate, n = sr, buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
  let lo = 0, lo2 = 0, s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  for (let i = 0; i < n; i++) {
    lo += (rnd() - lo) * 0.08;
    lo2 += (lo - lo2) * 0.15;
    const t = i / sr, chop = 0.55 + 0.45 * Math.abs(Math.sin(Math.PI * 28 * t));
    d[i] = (lo2 * 3.2 + 0.08 * Math.sin(2 * Math.PI * 56 * t)) * chop;
  }
  // fade the loop seam over 10 ms
  const f = Math.floor(sr * 0.01);
  for (let i = 0; i < f; i++) { const k = i / f; d[n - 1 - i] = d[n - 1 - i] * k + d[i] * (1 - k); }
  return buf;
}

/**
 * Loudness of the fans' sound: 1 = full (as generated), 0.5 = half, 0 = silent. The other sounds don't depend on it.
 * (It still grows a little with more and stronger fans: see FanHum.update.)
 */
export const FAN_VOLUME = 0.1;

/** The fans' sound: spins up while the player holds, winds down when released; louder with more and stronger fans. */
export class FanHum {
  private _v: ReturnType<typeof sound.play> = null;
  private _ctx: AudioContext | null = null;
  private _buf: AudioBuffer | null = null;
  private _level = 0;

  /** on: fans blowing; power 0..1 (how many / how strong) */
  update(dt: number, on: boolean, power: number) {
    this._level += ((on ? 1 : 0) - this._level) * Math.min(1, dt * (on ? 5 : 2.5));
    if (this._level < 0.01 && !on) { this.stop(); return; }
    const ctx = sound.ctx;
    // a new audio context (phones recreate it after a lock) needs a new voice
    if (!this._v || this._ctx !== ctx) {
      this._buf ??= fanBuffer(ctx);
      this._v = sound.play(this._buf, { loop: true, volume: 0 });
      this._ctx = ctx;
    }
    const v = this._v!;
    v.gain.gain.value = FAN_VOLUME * this._level * (0.25 + 0.35 * power);
    v.source.playbackRate.value = 0.55 + 0.6 * this._level + 0.25 * power;
  }

  stop() {
    this._v?.stop(0.1);
    this._v = null;
    this._level = 0;
  }
}
