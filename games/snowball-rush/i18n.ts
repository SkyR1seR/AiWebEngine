// Localization (lead). Source texts live next to the code: `const S = () => tr({ ru: {...}, en: {...} })` — Russian and
// English are written by hand; every other language is a dictionary lang/<code>.json keyed by the ENGLISH source string
// (built by tools/i18n.mjs, translated, lazy-loaded: only the current language is downloaded).
// Template strings: the dictionary key uses {0}, {1}... for the ${...} parts (e.g. "Level {0}" → "Nivel {0}"); at runtime an
// English string that matches no key exactly is matched against these templates.
// Rules: never call tr() at module top level (setLang/loadLang run at startup, after imports); no `lang === 'ru'` checks —
// put every user-visible text (both languages) into a tr() call; keep whole phrases in one string with ${} placeholders
// (no gluing of translated fragments, word order differs between languages).

/** supported UI languages (ISO 639-1) */
export const LANGS = ['en', 'ru', 'uk', 'tr', 'es', 'pt', 'de', 'fr', 'it', 'pl', 'nl', 'ja', 'ko', 'zh', 'id', 'vi', 'hi', 'ar', 'th'] as const;
/** languages whose players usually read Russian; Malay reads Indonesian */
const ALIAS: Record<string, string> = { be: 'ru', kk: 'ru', uz: 'ru', ky: 'ru', tg: 'ru', hy: 'ru', az: 'ru', ms: 'id' };
/** scripts the pixel font can't draw: the theme switches to system fonts for them */
export const SYSTEM_FONT_LANGS = ['ja', 'ko', 'zh', 'hi', 'ar', 'th', 'vi'];

export let lang = 'ru';
let dict: Record<string, string> | null = null;
let patterns: [RegExp, string][] = [];
const cache = new Map<string, string>();

/** portal / browser language code → a supported language (unknown → English) */
export function setLang(code: string | undefined) {
  const c = (code ?? '').slice(0, 2).toLowerCase();
  const l = ALIAS[c] ?? c;
  lang = (LANGS as readonly string[]).includes(l) ? l : 'en';
  dict = null;
  patterns = [];
  cache.clear();
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

const loaders = import.meta.glob<{ default: Record<string, string> }>('./lang/*.json');

/** load the dictionary of the current language (no-op for ru/en); call once after setLang, before building UI */
export async function loadLang(): Promise<void> {
  if (lang === 'ru' || lang === 'en') return;
  const load = loaders[`./lang/${lang}.json`];
  if (!load) return;
  try { setDict((await load()).default); } catch (e) { console.warn('language load failed', e); }
}

/** install a dictionary (tests / loadLang) */
export function setDict(d: Record<string, string> | null) {
  dict = d;
  cache.clear();
  patterns = [];
  if (!d) return;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const k of Object.keys(d)) {
    if (!/\{\d+\}/.test(k)) continue;
    const src = esc(k).replace(/\\\{(\d+)\\\}/g, '([\\s\\S]+?)');
    patterns.push([new RegExp('^' + src + '$'), k]);
  }
  // the most specific (longest) template wins
  patterns.sort((a, b) => b[1].length - a[1].length);
}

/** translate one English string with the loaded dictionary (falls back to English) */
function lookup(s: string): string {
  if (!dict || !s) return s;
  const hit = cache.get(s);
  if (hit !== undefined) return hit;
  let out = dict[s];
  if (out === undefined) {
    out = s;
    for (const [re, key] of patterns) {
      const m = re.exec(s);
      if (!m) continue;
      // placeholders are numbered in the order they appear in the English key
      const order = [...key.matchAll(/\{(\d+)\}/g)].map((x) => +x[1]);
      const vals: Record<number, string> = {};
      order.forEach((n, i) => { vals[n] = m[i + 1]; });
      out = dict[key].replace(/\{(\d+)\}/g, (_, n) => vals[+n] ?? '');
      break;
    }
  }
  if (cache.size > 2000) cache.clear();
  cache.set(s, out);
  return out;
}

/** deep-translate an English value: strings, arrays, plain objects, functions returning strings */
function translate<T>(v: T): T {
  if (typeof v === 'string') return lookup(v) as T;
  if (typeof v === 'function') return ((...a: unknown[]) => translate((v as (...x: unknown[]) => unknown)(...a))) as T;
  if (Array.isArray(v)) return v.map(translate) as T;
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const o: Record<string, unknown> = {};
    for (const k in v) o[k] = translate((v as Record<string, unknown>)[k]);
    return o as T;
  }
  return v;
}

/** pick the current language's variant of a { ru, en } text (other languages: translated from en) */
export function tr<T>(d: { ru: T; en: T }): T {
  if (lang === 'ru') return d.ru;
  if (lang === 'en' || !dict) return d.en;
  return translate(d.en);
}

/** Russian plural: plural(5, ['монета', 'монеты', 'монет']) — use only inside the ru branch of a tr() */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
