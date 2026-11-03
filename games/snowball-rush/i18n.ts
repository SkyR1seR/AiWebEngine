// Language selection (lead). Texts live next to the code that uses them: `const S = () => tr({ ru: {...}, en: {...} })`.
// Never call tr() at module top level: setLang() runs at startup, after all modules were imported.
import type { Lang } from './types';

export let lang: Lang = 'ru';

/** portal / browser language code → 'ru' for CIS languages, 'en' otherwise */
export function setLang(code: string | undefined) {
  lang = !code || ['ru', 'be', 'kk', 'uk', 'uz', 'ky', 'tg', 'hy', 'az'].includes(code.slice(0, 2).toLowerCase()) ? 'ru' : 'en';
  document.documentElement.lang = lang;
}

/** pick the current language's variant */
export function tr<T>(d: { ru: T; en: T }): T {
  return d[lang];
}

/** Russian plural: plural(5, ['монета', 'монеты', 'монет']) */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
