// Dev harness for audio.ts (not part of the game build): play every sfx, both music tracks, the rolling loop;
// window.audioReport() renders everything and returns timings/levels/pitch checks (used by the Playwright check).
import { sound } from 'aiwebengine/audio';
import { music, prepareAudio, renderMusic, RollSound, sfx, SFX_NAMES, SONGS, parseScore, synthSfx, type Track } from '../audio';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement, text = '') => {
  const e = document.createElement(tag);
  e.textContent = text;
  parent.appendChild(e);
  return e;
};
const section = (title: string) => { el('h3', document.body, title); return el('div', document.body) as HTMLDivElement; };
const btn = (row: HTMLElement, text: string, fn: () => void) => { const b = el('button', row, text); b.onclick = fn; return b; };

const sx = section('Sound effects');
sx.className = 'row';
for (const n of SFX_NAMES) btn(sx, n, () => sfx(n));
btn(sx, 'coin x8 streak', () => { for (let i = 0; i < 8; i++) setTimeout(() => sfx('coin'), i * 160); });

const mu = section('Music');
mu.className = 'row';
btn(mu, '▶ menu', () => music.play('menu'));
btn(mu, '▶ race', () => music.play('race'));
btn(mu, '■ stop', () => music.stop());
const en = btn(mu, 'music: on', () => { music.setEnabled(!music.enabled); en.textContent = `music: ${music.enabled ? 'on' : 'off'}`; });
btn(mu, 'mute all', () => sound.mute());
btn(mu, 'prepareAudio()', () => prepareAudio());

const ro = section('Rolling ball');
ro.className = 'row';
const state = { speed: 0.7, size: 0.3, snow: true, active: false };
const slider = (name: 'speed' | 'size') => {
  const l = el('label', ro, name), i = el('input', l) as HTMLInputElement;
  Object.assign(i, { type: 'range', min: '0', max: '1', step: '0.01', value: String(state[name]) });
  i.oninput = () => (state[name] = +i.value);
};
slider('speed');
slider('size');
const sb = btn(ro, 'surface: snow', () => { state.snow = !state.snow; sb.textContent = `surface: ${state.snow ? 'snow' : 'ice'}`; });
const ab = btn(ro, 'rolling: off', () => { state.active = !state.active; ab.textContent = `rolling: ${state.active ? 'on' : 'off'}`; });
let roll: RollSound | null = null;

// output level meter (taps the engine's master gain; dev only)
const cv = el('canvas', document.body) as HTMLCanvasElement;
const out = el('pre', document.body, 'click anywhere to unlock audio');
let an: AnalyserNode | null = null, buf = new Float32Array(2048);
const levels: number[] = [];
function meter(): number {
  const c = sound.ctx;
  if (!an || an.context !== c) { an = c.createAnalyser(); an.fftSize = 2048; (sound as unknown as { master: GainNode }).master.connect(an); }
  an.getFloatTimeDomainData(buf);
  let s = 0;
  for (const x of buf) s += x * x;
  return Math.sqrt(s / buf.length);
}
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (navigator.userActivation?.hasBeenActive) {
    roll ??= new RollSound();
    roll.update(dt, state.speed, state.size, state.snow, state.active);
    levels.push(meter());
    if (levels.length > 300) levels.shift();
    const g = cv.getContext('2d')!, w = (cv.width = cv.clientWidth), h = (cv.height = 80);
    g.fillStyle = '#7fd1ff';
    levels.forEach((v, i) => g.fillRect((i * w) / 300, h - v * h * 3, w / 300 + 1, v * h * 3));
    out.textContent = `ctx ${sound.ctx.state}  level ${levels[levels.length - 1].toFixed(3)}  music enabled ${music.enabled}`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ------------------------------------------------------------- automated report
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
/** normalized autocorrelation of x at a fractional lag */
function ac(x: Float32Array, i0: number, n: number, lag: number): number {
  const l0 = Math.floor(lag), fr = lag - l0;
  let s = 0, e1 = 0, e2 = 0;
  for (let i = i0; i < i0 + n; i++) {
    const y = x[i + l0] * (1 - fr) + x[i + l0 + 1] * fr;
    s += x[i] * y; e1 += x[i] * x[i]; e2 += y * y;
  }
  return s / Math.sqrt(e1 * e2 + 1e-12);
}
/** check that the solo lead plays the scored pitches: the expected note correlates best among ±2 semitones */
function pitchCheck(b: AudioBuffer, id: Track) {
  const S = SONGS[id], spb = 60 / S.bpm, d = b.getChannelData(0), sr = b.sampleRate;
  let ok = 0, bad: string[] = [];
  for (const [beat, len, m] of parseScore(S.mel)) {
    if (m < 0) continue;
    const want = m + 12, i0 = Math.round((beat * spb + Math.min(0.05, len * spb * 0.3)) * sr), n = Math.round(0.025 * sr);
    const score = (x: number) => ac(d, i0, n, sr / hz(x));
    const s0 = score(want), others = [-2, -1, 1, 2].map((k) => score(want + k));
    if (s0 > 0.8 && others.every((s) => s < s0)) ok++;
    else bad.push(`beat ${beat}: midi ${want} ac ${s0.toFixed(2)} vs ${others.map((s) => s.toFixed(2)).join(',')}`);
  }
  return { ok, bad: bad.slice(0, 8), nBad: bad.length };
}
function stats(d: Float32Array) {
  let p = 0, s = 0, step = 0;
  for (let i = 0; i < d.length; i++) { p = Math.max(p, Math.abs(d[i])); s += d[i] * d[i]; if (i) step = Math.max(step, Math.abs(d[i] - d[i - 1])); }
  return { peak: +p.toFixed(3), rms: +Math.sqrt(s / d.length).toFixed(3), seam: +Math.abs(d[0] - d[d.length - 1]).toFixed(4), maxStep: +step.toFixed(3) };
}

declare global { interface Window { audioReport: () => Promise<unknown>; audioWav: (what: string) => string; audioLevel: () => number; dev: unknown } }
window.audioLevel = () => levels[levels.length - 1] ?? 0;
window.dev = { music, sfx, sound, state, prepareAudio };
window.audioReport = async () => {
  const rep: Record<string, unknown> = {};
  const t0 = performance.now();
  const sfxs: Record<string, unknown> = {};
  for (const n of SFX_NAMES) { const t = performance.now(), d = synthSfx(n); sfxs[n] = { ms: +(performance.now() - t).toFixed(1), sec: +(d.length / 44100).toFixed(2), ...stats(d) }; }
  rep.sfx = sfxs;
  rep.sfxTotalMs = +(performance.now() - t0).toFixed(1);
  for (const id of ['menu', 'race'] as Track[]) {
    const t = performance.now(), b = await renderMusic(id), ms = performance.now() - t;
    const lead = await renderMusic(id, 'lead');
    rep[id] = { renderMs: Math.round(ms), sec: +b.duration.toFixed(2), sr: b.sampleRate, ...stats(b.getChannelData(0)), pitch: pitchCheck(lead, id) };
    for (const part of ['harm', 'stab', 'bass', 'drums', 'bells']) (rep[id] as Record<string, unknown>)[part] = stats((await renderMusic(id, part)).getChannelData(0)).rms;
  }
  return rep;
};
/** 16-bit WAV (base64) of a sfx name or 'music:menu' / 'music:race' (for offline inspection) */
const wavs = new Map<string, Float32Array>();
window.audioWav = (what) => {
  const d = wavs.get(what) ?? synthSfx(what as never), sr = what.startsWith('music:') ? 32000 : 44100;
  const b = new DataView(new ArrayBuffer(44 + d.length * 2));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) b.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); b.setUint32(4, 36 + d.length * 2, true); str(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true);
  b.setUint16(22, 1, true); b.setUint32(24, sr, true); b.setUint32(28, sr * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true);
  str(36, 'data'); b.setUint32(40, d.length * 2, true);
  for (let i = 0; i < d.length; i++) b.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 32767, true);
  let s = '';
  const u = new Uint8Array(b.buffer);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
(window as unknown as { loadMusicWav: (id: Track) => Promise<void> }).loadMusicWav = async (id) => { wavs.set('music:' + id, (await renderMusic(id)).getChannelData(0)); };

/** piano roll (Goertzel per semitone, MIDI 36..108) of a rendered track; scored melody (+12) outlined in red */
(window as unknown as { roll: (id: Track, t0: number, t1: number, part?: string) => Promise<void> }).roll = async (id, t0, t1, part) => {
  const b = await renderMusic(id, part), d = b.getChannelData(0), sr = b.sampleRate, hop = 0.02, N = 1024;
  const cvs = document.createElement('canvas'), lo = 36, hi = 108, frames = Math.round((t1 - t0) / hop);
  cvs.width = frames * 2; cvs.height = (hi - lo) * 6;
  Object.assign(cvs.style, { position: 'fixed', left: '0', top: '0', width: cvs.width + 'px', height: cvs.height + 'px', zIndex: '9', background: '#000' });
  document.body.appendChild(cvs);
  const g = cvs.getContext('2d')!, mags: number[] = [];
  for (let f = 0; f < frames; f++) {
    const i0 = Math.round((t0 + f * hop) * sr);
    for (let m = lo; m < hi; m++) {
      const w = (2 * Math.PI * hz(m)) / sr, c = 2 * Math.cos(w);
      let s1 = 0, s2 = 0;
      for (let i = 0; i < N; i++) { const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N); const s = d[i0 + i] * win + c * s1 - s2; s2 = s1; s1 = s; }
      mags.push(20 * Math.log10(Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / N + 1e-9));
    }
  }
  const top = Math.max(...mags);
  mags.forEach((db, k) => {
    const f = Math.floor(k / (hi - lo)), m = lo + (k % (hi - lo)), v = Math.round(Math.min(1, Math.max(0, (db - top + 50) / 50)) * 255);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(f * 2, (hi - 1 - m) * 6, 2, 6);
  });
  const S = SONGS[id], spb = 60 / S.bpm;
  g.strokeStyle = 'red';
  for (const [beat, len, m] of parseScore(S.mel)) {
    if (m < 0) continue;
    const x0 = ((beat * spb - t0) / hop) * 2, x1 = (((beat + len) * spb - t0) / hop) * 2;
    if (x1 < 0 || x0 > cvs.width) continue;
    g.strokeRect(x0, (hi - 1 - (m + 12)) * 6, x1 - x0, 6);
  }
  // octave grid (C notes)
  g.fillStyle = 'rgba(0,160,255,.6)';
  for (let m = lo; m < hi; m += 12) g.fillRect(0, (hi - m) * 6 - 1, cvs.width, 1);
};
