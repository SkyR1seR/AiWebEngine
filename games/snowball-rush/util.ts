// Small shared helpers (lead). Pure, no DOM.

/** seeded PRNG (mulberry32) → () => [0, 1) */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** string → 32-bit hash (seeds) */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const randRange = (r: () => number, a: number, b: number) => a + (b - a) * r();
export const randInt = (r: () => number, a: number, b: number) => Math.floor(a + (b - a + 1) * r());
export const pickR = <T>(r: () => number, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
export function shuffleR<T>(r: () => number, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
/** weighted pick: items with `w` weights */
export function weighted<T extends { w: number }>(r: () => number, items: readonly T[]): T {
  let total = 0;
  for (const it of items) total += it.w;
  let x = r() * total;
  for (const it of items) { x -= it.w; if (x < 0) return it; }
  return items[items.length - 1];
}

/** local calendar date 'YYYY-MM-DD' of a timestamp */
export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "1 234 567" */
export function fmtNum(n: number): string {
  return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** remaining time: "2д 05:12:09" / "05:12:09" / "12:09" (days suffix localized by caller via `dayWord`) */
export function fmtTime(ms: number, dayWord = 'd'): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (v: number) => String(v).padStart(2, '0');
  if (d > 0) return `${d}${dayWord} ${p(h)}:${p(m)}:${p(sec)}`;
  if (h > 0) return `${p(h)}:${p(m)}:${p(sec)}`;
  return `${p(m)}:${p(sec)}`;
}
