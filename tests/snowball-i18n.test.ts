import { describe, it, expect } from 'vitest';
import { setLang, setDict, tr, lang } from '../games/snowball-rush/i18n';

describe('snowball i18n', () => {
  it('maps platform codes', () => {
    setLang('be'); expect(lang).toBe('ru');
    setLang('pt-BR'); expect(lang).toBe('pt');
    setLang('xx'); expect(lang).toBe('en');
    setLang(undefined); expect(lang).toBe('en');
  });
  it('translates strings, templates, nested values and functions from English', () => {
    setLang('de');
    setDict({ Play: 'Spielen', 'Level {0}': 'Level {0}!', '{0} of {1}': '{1} von {0}', Coins: 'Münzen' });
    const n = 7;
    expect(tr({ ru: 'Играть', en: 'Play' })).toBe('Spielen');
    expect(tr({ ru: `Уровень ${n}`, en: `Level ${n}` })).toBe('Level 7!');
    expect(tr({ ru: '', en: `${2} of ${5}` })).toBe('5 von 2');
    const o = tr({ ru: { a: 'Монеты', f: (x: number) => `Уровень ${x}` }, en: { a: 'Coins', f: (x: number) => `Level ${x}` } });
    expect(o.a).toBe('Münzen');
    expect(o.f(3)).toBe('Level 3!');
    expect(tr({ ru: 'x', en: 'Untranslated' })).toBe('Untranslated');
    setLang('ru');
    expect(tr({ ru: 'Играть', en: 'Play' })).toBe('Играть');
  });
});
