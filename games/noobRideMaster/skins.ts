// Noob skins: every PNG dropped into images/Skins/ (classic 64x32 or 64x64 layout); skin.png there is the free default one.
import { loadTexture, type Texture } from 'aiwebengine';
import { skinInfo } from './noob';

export interface Skin { id: string; name: string; url: string; price: number }

const found = import.meta.glob('./images/Skins/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
/** file name of the free default skin */
const DEFAULT = 'skin';

/** Display names for skin files (file name without .png -> [ru, en]); unknown files use the file name. */
const NAMES: Record<string, [string, string]> = {
  skin_GigaChad: ['Гигачад', 'GigaChad'], skin_Herobrine: ['Херобрин', 'Herobrine'], skin_cheater: ['Читер', 'Cheater'], skin_pro: ['Про', 'Pro'],
};
/** Price per file (optional); otherwise 150 x position. */
const PRICES: Record<string, number> = {};

export function skinList(ru: boolean): Skin[] {
  const files = Object.keys(found).sort();
  const idOf = (path: string) => path.split('/').pop()!.replace(/\.png$/i, '');
  // the default skin (or the first file, if skin.png is gone) is free and listed first as the noob
  const def = files.find((p) => idOf(p).toLowerCase() === DEFAULT) ?? files[0];
  const list: Skin[] = def ? [{ id: 'noob', name: ru ? 'Нубик' : 'Noob', url: found[def], price: 0 }] : [];
  files.filter((p) => p !== def).forEach((path, i) => {
    const id = idOf(path);
    const n = NAMES[id];
    list.push({ id, name: n ? n[ru ? 0 : 1] : id.replace(/^skin[_-]/i, '').replace(/[_-]+/g, ' '), url: found[path], price: PRICES[id] ?? 150 * (i + 1) });
  });
  return list;
}

export const skinTexture = (s: Skin): Promise<Texture> => loadTexture(s.url, { filter: 'nearest', mips: false });

/** Flat front view of a skin (head, body, arms, legs + second layer) on a small pixelated canvas. Works for 64x32 and 64x64. */
export function skinPreview(url: string): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 16;
  cv.height = 32;
  cv.style.imageRendering = 'pixelated';
  const img = new Image();
  img.onload = () => {
    const g = cv.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    const { th, slim, layers } = skinInfo(img);
    const k = img.width / 64, aw = slim ? 3 : 4;
    const part = (sx: number, sy: number, w: number, h: number, dx: number, dy: number, mirror = false) => {
      if (!mirror) { g.drawImage(img, sx * k, sy * k, w * k, h * k, dx, dy, w, h); return; }
      g.save(); g.translate(dx + w, dy); g.scale(-1, 1); g.drawImage(img, sx * k, sy * k, w * k, h * k, 0, 0, w, h); g.restore();
    };
    const tall = th === 64;
    part(8, 8, 8, 8, 4, 0); // head
    part(20, 20, 8, 12, 4, 8); // body
    part(44, 20, aw, 12, 4 - aw, 8); // right arm
    if (tall) part(36, 52, aw, 12, 12, 8); else part(44, 20, aw, 12, 12, 8, true); // left arm
    part(4, 20, 4, 12, 4, 20); // right leg
    if (tall) part(20, 52, 4, 12, 8, 20); else part(4, 20, 4, 12, 8, 20, true); // left leg
    // second layer (front faces)
    if (layers.has('hat')) part(40, 8, 8, 8, 4, 0);
    if (layers.has('jacket')) part(20, 36, 8, 12, 4, 8);
    if (layers.has('sleeveR')) part(44, 36, aw, 12, 4 - aw, 8);
    if (layers.has('sleeveL')) part(52, 52, aw, 12, 12, 8);
    if (layers.has('pantsR')) part(4, 36, 4, 12, 4, 20);
    if (layers.has('pantsL')) part(4, 52, 4, 12, 8, 20);
  };
  img.src = url;
  return cv;
}
