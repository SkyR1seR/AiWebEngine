import { describe, it, expect } from 'vitest';
import { SFX_NAMES, SONGS, below, midi, parseChords, parseScore, rollData, synthSfx } from '../games/snowball-rush/audio';

const peak = (d: Float32Array) => d.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
const rms = (d: Float32Array) => Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length);

describe('snowball audio: scores', () => {
  it('note names', () => {
    expect(midi('A4')).toBe(69);
    expect(midi('C4')).toBe(60);
    expect(midi('F#4')).toBe(66);
    expect(midi('Bb3')).toBe(58);
  });

  for (const [id, s] of Object.entries(SONGS)) {
    it(`${id}: every bar of the melody and the chords fills the meter`, () => {
      const bars = s.mel.split('|');
      expect(bars.length).toBe(32);
      bars.forEach((bar, i) => {
        const sum = parseScore(bar).reduce((a, n) => a + n[1], 0);
        expect(sum, `${id} bar ${i + 1}: ${bar}`).toBeCloseTo(s.bpb, 6);
      });
      const ch = parseChords(s.ch, s.bpb);
      expect(ch[ch.length - 1][0] + ch[ch.length - 1][1]).toBe(bars.length * s.bpb);
      // melody notes stay in a singable range (D4..E5) - catches octave typos
      for (const n of parseScore(s.mel)) if (n[2] >= 0) expect(n[2]).toBeGreaterThanOrEqual(62), expect(n[2]).toBeLessThanOrEqual(76);
    });
  }

  it('Jingle Bells chorus opens with the famous hook', () => {
    const n = parseScore(SONGS.race.mel).slice(0, 12).map((x) => x[2]);
    // B B B, B B B, B D G A B
    expect(n).toEqual([71, 71, 71, 71, 71, 71, 71, 74, 67, 69, 71, 72]);
  });

  it('harmony sits a third..fourth under the melody', () => {
    const G = [7, 11, 2];
    expect(below(71, G)).toBe(67); // B over G → G
    expect(below(74, G)).toBe(71); // D → B
    expect(below(69, G)).toBe(66); // passing A → diatonic F#
    for (let m = 60; m < 80; m++) { const h = below(m, [0, 4, 7]); expect(m - h).toBeGreaterThanOrEqual(3); expect(m - h).toBeLessThanOrEqual(5); }
  });
});

describe('snowball audio: synthesis', () => {
  it('every sfx renders finite, deterministic, normalized samples without long silence at the start', () => {
    for (const name of SFX_NAMES) {
      const a = synthSfx(name), b = synthSfx(name);
      expect(a.length, name).toBeGreaterThan(1000);
      expect(a.every(Number.isFinite), name).toBe(true);
      expect(peak(a), name).toBeCloseTo(0.9, 5);
      expect(Array.from(a.subarray(0, 64))).toEqual(Array.from(b.subarray(0, 64)));
      // audible within the first 20 ms (instant feedback)
      expect(peak(a.subarray(0, 882)), name).toBeGreaterThan(0.05);
      // ends quietly (no click when the buffer stops)
      expect(Math.abs(a[a.length - 1]), name).toBeLessThan(0.02);
    }
  });

  it('rolling loops are seamless and steady', () => {
    for (const ice of [false, true]) {
      const d = rollData(ice);
      expect(d.length).toBe(88200);
      expect(d.every(Number.isFinite)).toBe(true);
      // the jump across the loop seam is no bigger than typical neighbour steps
      let step = 0;
      for (let i = 1; i < d.length; i++) step = Math.max(step, Math.abs(d[i] - d[i - 1]));
      expect(Math.abs(d[0] - d[d.length - 1])).toBeLessThanOrEqual(step);
      // no dropouts: every 100 ms window has sound
      for (let i = 0; i < d.length; i += 4410) expect(rms(d.subarray(i, i + 4410))).toBeGreaterThan(0.01);
    }
  });
});

describe('snowball audio: outside a browser', () => {
  it('the public API is a safe no-op without Web Audio (node)', async () => {
    const { music, sfx, RollSound, prepareAudio } = await import('../games/snowball-rush/audio');
    expect(() => {
      sfx('coin');
      music.play('race');
      music.setEnabled(false);
      music.setEnabled(true);
      music.stop();
      const r = new RollSound();
      r.update(0.016, 1, 1, true, true);
      r.stop();
      prepareAudio();
    }).not.toThrow();
    expect(music.enabled).toBe(true);
  });
});
