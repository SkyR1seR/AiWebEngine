import { afterEach, describe, expect, it } from 'vitest';
import { fmtRace, resultTitle } from '../games/snowball-rush/results';
import { FEATURE_ICON, introInfo, paintIntro, type IntroKind } from '../games/snowball-rush/tutorial';
import { ICON_IDS } from '../games/snowball-rush/textures';
import { FEATURES } from '../games/snowball-rush/unlocks';
import { setLang } from '../games/snowball-rush/i18n';

const KINDS: IntroKind[] = ['wall', 'spikes', 'fire', 'hammer', 'pusher', 'plow', 'icicle', 'gap', 'bonus', 'boost', 'ice', 'thaw', 'salt'];

describe('snowball ui-core: results', () => {
  afterEach(() => setLang('ru'));
  it('fmtRace formats m:ss.d', () => {
    expect(fmtRace(31.44)).toBe('0:31.4');
    expect(fmtRace(65.3)).toBe('1:05.3');
    expect(fmtRace(5)).toBe('0:05.0');
  });
  it('headline by place: win / top-3 / lose with an "easier next time" hint', () => {
    setLang('en');
    expect(resultTitle(1)).toMatchObject({ cls: 'win', text: 'VICTORY!' });
    expect(resultTitle(2).cls).toBe('top');
    expect(resultTitle(3).cls).toBe('top');
    for (const p of [4, 5]) {
      const t = resultTitle(p);
      expect(t.cls).toBe('lose');
      expect(t.hint).toBeTruthy();
    }
    setLang('ru');
    expect(resultTitle(1).text).toBe('ПОБЕДА!');
  });
});

describe('snowball ui-core: tutorial', () => {
  afterEach(() => setLang('ru'));
  it('every intro kind has a name and a rule in ru and en, all different', () => {
    for (const l of ['ru', 'en']) {
      setLang(l);
      const names = new Set<string>();
      for (const k of KINDS) {
        const t = introInfo(k);
        expect(t.name.length, k).toBeGreaterThan(2);
        expect(t.rule.length, k).toBeGreaterThan(15);
        names.add(t.name);
      }
      expect(names.size).toBe(KINDS.length);
    }
  });
  it('every intro picture is painted (opaque 40x30 scene with distinct art)', () => {
    const sigs = new Set<string>();
    for (const k of KINDS) {
      const p = paintIntro(k);
      expect(p.w).toBe(40);
      expect(p.h).toBe(30);
      let opaque = 0, sum = 0;
      for (let i = 0; i < p.d.length; i += 4) { if (p.d[i + 3]) opaque++; sum = (sum * 31 + p.d[i] + p.d[i + 1] * 7 + p.d[i + 2] * 13) >>> 0; }
      expect(opaque, k).toBe(40 * 30);
      sigs.add(String(sum));
    }
    expect(sigs.size).toBe(KINDS.length);
  });
  it('every feature has an existing icon', () => {
    for (const f of FEATURES) expect(ICON_IDS).toContain(FEATURE_ICON[f]);
  });
});
