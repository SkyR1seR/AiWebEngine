import { afterEach, describe, expect, it } from 'vitest';
import { cssU, uiScale } from '../games/snowball-rush/theme';
import { fmtLeft, rarityName, rewardLabel } from '../games/snowball-rush/widgets';
import { setLang } from '../games/snowball-rush/i18n';
import { fmtNum } from '../games/snowball-rush/util';

describe('snowball ui-base: theme helpers', () => {
  it('uiScale = clamp(min(W, H) / 720, 0.4, 2.5)', () => {
    expect(uiScale(1280, 720)).toBe(1);
    expect(uiScale(390, 844)).toBeCloseTo(390 / 720);
    expect(uiScale(844, 390)).toBeCloseTo(390 / 720);
    expect(uiScale(200, 200)).toBe(0.4);
    expect(uiScale(4000, 3000)).toBe(2.5);
  });
  it('cssU converts the u unit only where it is a number + u', () => {
    expect(cssU('padding:12u 3.5u;margin:-3u .5u')).toBe('padding:calc(var(--u)*12px) calc(var(--u)*3.5px);margin:calc(var(--u)*-3px) calc(var(--u)*.5px)');
    expect(cssU('width:calc(100% - 9u)')).toBe('width:calc(100% - calc(var(--u)*9px))');
    expect(cssU('transform:translateY(3u) rotate(1turn)')).toBe('transform:translateY(calc(var(--u)*3px)) rotate(1turn)');
    const keep = 'font-size:var(--u);unicode-range:U+0400-045F;color:#1b1d2b;animation:pop .2s';
    expect(cssU(keep)).toBe(keep);
  });
});

describe('snowball ui-base: texts', () => {
  afterEach(() => setLang('ru'));
  it('fmtLeft: localized days, hh:mm:ss with days, mm:ss under an hour, never negative', () => {
    setLang('en');
    expect(fmtLeft(3 * 864e5 + 5000)).toBe('3d 00:00:05');
    expect(fmtLeft(864e5 + 3600e3 + 61e3)).toBe('1d 01:01:01');
    expect(fmtLeft(754e3)).toBe('12:34');
    expect(fmtLeft(2 * 3600e3)).toBe('02:00:00');
    expect(fmtLeft(-5)).toBe('00:00');
    setLang('ru');
    expect(fmtLeft(2 * 864e5)).toBe('2д 00:00:00');
  });
  it('rewardLabel / rarityName', () => {
    setLang('en');
    expect(rewardLabel({ kind: 'coins', n: 1500 })).toBe(`+${fmtNum(1500)}`);
    expect(rewardLabel({ kind: 'gems', n: 60 })).toBe('+60');
    expect(rewardLabel({ kind: 'key', id: 'ice', n: 3 })).toBe('Ice Gift x3');
    expect(rewardLabel({ kind: 'key', id: 'snow', n: 1 })).toBe('Snow Gift');
    expect(rewardLabel({ kind: 'noAds' })).toBe('No ads');
    expect(rewardLabel({ kind: 'skin', id: 'santa', rarity: 'legendary', dup: true, comp: 2500 })).toBe('Santa');
    expect(rarityName('epic')).toBe('Epic');
    setLang('ru');
    expect(rewardLabel({ kind: 'ball', id: 'disco' })).toBe('Диско-шар');
    expect(rarityName('legendary')).toBe('Легендарный');
  });
});
