export interface PlayOptions {
  volume?: number;
  /** playback rate (1 = normal) */
  pitch?: number;
  /** random pitch variation, e.g. 0.1 = ±10% */
  pitchRandom?: number;
  loop?: boolean;
  /** stereo pan -1..1 */
  pan?: number;
  /** 'sfx' (default) or 'music' bus */
  bus?: 'sfx' | 'music';
}

export interface Voice { stop(fade?: number): void; source: AudioBufferSourceNode; gain: GainNode }

export type SfxName = 'jump' | 'coin' | 'hit' | 'explosion' | 'click' | 'powerup' | 'lose' | 'win' | 'shoot' | 'step';

/**
 * WebAudio wrapper: buffers, buses (sfx/music), unlock on first gesture, and procedural sound effects
 * so prototypes need zero audio assets: `sound.sfx('coin')`.
 */
export class Sound {
  private _ctx: AudioContext | null = null;
  private _buses: Record<string, GainNode> = {};
  private master!: GainNode;
  private _cache = new Map<string, Promise<AudioBuffer>>();
  private _music: Voice | null = null;
  private _noiseBuf: AudioBuffer | null = null;
  private _vol = { master: 1, sfx: 1, music: 0.6 };
  muted = false;
  private _listening = false;
  /**
   * The context can't be trusted any more: a resume() from a gesture failed, or (phones) the page was hidden - iOS
   * keeps a context "running" but silent after the screen was locked. The next user gesture replaces it.
   */
  private _broken = false;
  private _musicArgs: [string, number] | null = null;

  /** AudioContext (created lazily; resumes on first user gesture). */
  get ctx() { return this._open(); }
  /**
   * The context, created if needed. A method, not the getter: the build compresses with pure_getters, so a getter
   * read only for its side effect (`void this.ctx`) would be dropped.
   */
  private _open(): AudioContext {
    if (!this._ctx) {
      const c = (this._ctx = new AudioContext());
      this.master = c.createGain();
      this.master.connect(c.destination);
      for (const b of ['sfx', 'music'] as const) { const g = c.createGain(); g.gain.value = this._vol[b]; g.connect(this.master); this._buses[b] = g; }
      this._applyVolume();
      this._listen();
      // iOS: an interruption (call, Siri, locked screen) leaves the context unusable even after it's resumed
      c.addEventListener('statechange', () => { if ((c.state as string) === 'interrupted' && c === this._ctx) this._broken = true; });
    }
    return this._ctx;
  }

  /**
   * Keep the context running: resume on user gestures and when the page is shown again, suspend while hidden.
   * Browsers (iOS Safari above all) reject resume() outside a gesture and after an interruption (locked phone, call,
   * another app) - such rejections are expected and swallowed; the next tap retries, and a context that still can't
   * start is replaced by a new one.
   */
  private _listen() {
    if (this._listening) return;
    this._listening = true;
    const gesture = () => {
      if (!this._ctx || document.hidden) return;
      const fresh = this._broken;
      if (fresh) this._recreate();
      if (!fresh && this._ctx.state === 'running') return;
      this._resume(true);
      // a tiny silent sound inside the gesture: iOS starts the audio output only for sound started by the user
      const c = this._ctx!, b = c.createBufferSource();
      b.buffer = c.createBuffer(1, 1, c.sampleRate);
      b.connect(c.destination);
      b.start();
    };
    for (const ev of ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click']) addEventListener(ev, gesture, { passive: true, capture: true });
    document.addEventListener('visibilitychange', () => {
      const c = this._ctx;
      if (!c) return;
      if (document.hidden) {
        if (c.state === 'running') c.suspend().catch(() => {});
        // phones: start with a fresh context on the first tap after coming back
        if (navigator.maxTouchPoints > 0) this._broken = true;
      } else this._resume(false);
    });
  }
  private _resume(fromGesture: boolean) {
    const c = this._ctx;
    if (!c || c.state === 'running' || c.state === 'closed') return;
    // (a successful resume doesn't clear _broken: on iOS it succeeds and stays silent)
    // iOS only accepts some events of a tap (touchend/click, not pointerdown): a rejection counts only if nothing started it
    c.resume().catch(() => { if (fromGesture && c === this._ctx && c.state !== 'running') this._broken = true; });
  }
  /** replace a broken context: same volumes, music restarted (decoded buffers work in any context) */
  private _recreate() {
    const old = this._ctx;
    this._broken = false;
    this._ctx = null;
    this._music = null;
    old?.close().catch(() => {});
    this._open();
    if (this._musicArgs) this.playMusic(this._musicArgs[0], this._musicArgs[1], 0.3).catch(() => {});
  }

  setVolume(bus: 'master' | 'sfx' | 'music', v: number) { this._vol[bus] = v; if (this._ctx) this._applyVolume(); }
  mute(m = !this.muted) { this.muted = m; if (this._ctx) this._applyVolume(); return m; }
  private _applyVolume() {
    this.master.gain.value = this.muted ? 0 : this._vol.master;
    this._buses.sfx.gain.value = this._vol.sfx;
    this._buses.music.gain.value = this._vol.music;
  }

  /** Load and decode an audio file (cached). */
  load(url: string): Promise<AudioBuffer> {
    let p = this._cache.get(url);
    if (!p) {
      p = fetch(url).then((r) => r.arrayBuffer()).then((b) => this.ctx.decodeAudioData(b));
      this._cache.set(url, p);
    }
    return p;
  }

  /** Play a buffer or URL. */
  play(src: AudioBuffer | string, o: PlayOptions = {}): Voice | null {
    if (typeof src === 'string') {
      const p = this.load(src);
      let v: Voice | null = null, stopped = false;
      p.then((b) => { if (!stopped) v = this.play(b, o); });
      return { stop: (f) => { stopped = true; v?.stop(f); }, get source() { return v!.source; }, get gain() { return v!.gain; } } as Voice;
    }
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = src;
    s.loop = !!o.loop;
    s.playbackRate.value = (o.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * (o.pitchRandom ?? 0));
    const g = c.createGain();
    g.gain.value = o.volume ?? 1;
    let node: AudioNode = s;
    if (o.pan) { const p = c.createStereoPanner(); p.pan.value = o.pan; s.connect(p); node = p; }
    node.connect(g);
    g.connect(this._buses[o.bus ?? 'sfx']);
    s.start();
    return {
      source: s,
      gain: g,
      stop(fade = 0) {
        if (fade > 0) { g.gain.setTargetAtTime(0, c.currentTime, fade / 3); s.stop(c.currentTime + fade); } else s.stop();
      },
    };
  }

  /** Play looping music, crossfading from the current track. */
  async playMusic(url: string, volume = 1, fade = 1) {
    this._musicArgs = [url, volume];
    const buf = await this.load(url);
    this._music?.stop(fade);
    const v = this.play(buf, { loop: true, bus: 'music', volume: 0 })!;
    v.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, fade / 3);
    this._music = v;
  }
  stopMusic(fade = 1) { this._music?.stop(fade); this._music = null; this._musicArgs = null; }

  /** Simple synth tone. */
  tone(o: { freq?: number; to?: number; type?: OscillatorType; duration?: number; volume?: number; attack?: number; delay?: number } = {}) {
    const c = this.ctx, t = c.currentTime + (o.delay ?? 0), d = o.duration ?? 0.15;
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type ?? 'square';
    osc.frequency.setValueAtTime(o.freq ?? 440, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + d);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime((o.volume ?? 0.3), t + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.001, t + d);
    osc.connect(g);
    g.connect(this._buses.sfx);
    osc.start(t);
    osc.stop(t + d + 0.02);
  }

  /** Filtered noise burst (explosions, hits, whooshes). */
  noise(o: { duration?: number; volume?: number; freq?: number; to?: number; q?: number; delay?: number } = {}) {
    const c = this.ctx, t = c.currentTime + (o.delay ?? 0), d = o.duration ?? 0.3;
    if (!this._noiseBuf) {
      const b = (this._noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate));
      const ch = b.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    }
    const s = c.createBufferSource();
    s.buffer = this._noiseBuf;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(o.freq ?? 3000, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + d);
    const g = c.createGain();
    g.gain.setValueAtTime(o.volume ?? 0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + d);
    s.connect(f); f.connect(g); g.connect(this._buses.sfx);
    s.start(t);
    s.stop(t + d + 0.02);
  }

  /** Built-in procedural sound effects (no assets needed). */
  sfx(name: SfxName, volume = 1) {
    const v = volume, r = 1 + (Math.random() - 0.5) * 0.08;
    switch (name) {
      case 'jump': return this.tone({ freq: 260 * r, to: 620 * r, duration: 0.16, volume: 0.18 * v });
      case 'coin':
        this.tone({ freq: 988 * r, duration: 0.08, volume: 0.15 * v });
        return this.tone({ freq: 1319 * r, duration: 0.25, volume: 0.15 * v, delay: 0.07 });
      case 'hit':
        this.noise({ duration: 0.12, freq: 2500, to: 400, volume: 0.35 * v });
        return this.tone({ freq: 180 * r, to: 60, type: 'sine', duration: 0.15, volume: 0.35 * v });
      case 'explosion':
        this.noise({ duration: 0.8, freq: 1800, to: 80, volume: 0.6 * v });
        return this.tone({ freq: 90, to: 30, type: 'sine', duration: 0.5, volume: 0.5 * v });
      case 'click': return this.tone({ freq: 1200, type: 'sine', duration: 0.04, volume: 0.15 * v });
      case 'shoot':
        this.noise({ duration: 0.1, freq: 5000, to: 800, volume: 0.25 * v });
        return this.tone({ freq: 880 * r, to: 220, type: 'sawtooth', duration: 0.1, volume: 0.1 * v });
      case 'step': return this.noise({ duration: 0.06, freq: 900 * r, to: 300, volume: 0.12 * v });
      case 'powerup':
        [523, 659, 784, 1047].forEach((f, i) => this.tone({ freq: f, duration: 0.12, volume: 0.13 * v, delay: i * 0.06 }));
        return;
      case 'win':
        [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone({ freq: f, type: 'triangle', duration: 0.18, volume: 0.2 * v, delay: i * 0.09 }));
        return;
      case 'lose':
        [392, 330, 262, 196].forEach((f, i) => this.tone({ freq: f, type: 'sawtooth', duration: 0.25, volume: 0.1 * v, delay: i * 0.15 }));
        return;
    }
  }
}

/** Shared sound manager. */
export const sound = /* @__PURE__ */ new Sound();
