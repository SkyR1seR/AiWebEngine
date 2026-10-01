// Minecraft-style look of the game's DOM UI: the Minecraft font, stone buttons (bevel, black outline, blue-ish hover) and the
// inventory as a Minecraft container (light gray window with a raised frame, sunken slots). Overrides the engine's default
// UI styles; only the game imports it (the part / level editors keep the standard font).
import { h, u } from 'aiwebengine/ui';

/** small gray noise tile (a stone-ish button face) as a data URL, drawn once */
function noise(base: number[], spread: number) {
  const n = 16, c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!, img = g.createImageData(n, n);
  let s = 7;
  const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < n * n; i++) {
    const k = (r() - 0.5) * spread;
    img.data[i * 4] = base[0] + k; img.data[i * 4 + 1] = base[1] + k; img.data[i * 4 + 2] = base[2] + k; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}

/** font of the game UI (the face is declared by applyTheme) */
export const UI_FONT = "'Minecraft',system-ui,sans-serif";

/** negative UI size: a minus in front of u(n) would make an invalid "-calc(...)" */
const neg = (n: number) => `calc(var(--u)*-${n}px)`;

export function applyTheme() {
  const font = new URL('./Fonts/minecraft.ttf', import.meta.url).href;
  const tile = u(32);
  const face = (rgb: number[]) => `url(${noise(rgb, 22)}) 0 0/${tile} ${tile}`;
  // one button look: outline, light bevel top-left, dark bevel bottom-right; pressed = bevel swapped
  const bevel = (light: string, dark: string) =>
    `0 0 0 ${u(3)} #000,inset ${u(3)} ${u(3)} 0 ${light},inset ${neg(3)} ${neg(4)} 0 ${dark}`;
  document.head.append(h('style', null, `
@font-face{font-family:'Minecraft';src:url(${font}) format('truetype');font-display:swap}
/* the UI uses it via UI's font option (see UI_FONT); one weight only: no faked bold / italic smearing the pixels */
.ui-root{font-synthesis:none}
.ui-root *{font-weight:400!important}
.ui-root .ui-btn{border-radius:0;background:${face([112, 112, 112])};image-rendering:pixelated;color:#fff;font-weight:600;letter-spacing:.04em;
  text-shadow:${u(2)} ${u(2)} 0 #3f3f3f;box-shadow:${bevel('#a9a9a9', '#4a4a4a')};transition:none}
.ui-root .ui-btn.green{background:${face([78, 128, 60])};box-shadow:${bevel('#8fc777', '#2f5222')}}
.ui-root .ui-btn.red{background:${face([140, 58, 54])};box-shadow:${bevel('#cc7a74', '#5a1f1c')}}
@media (hover:hover){.ui-root .ui-btn:hover{background:${face([122, 134, 196])};box-shadow:0 0 0 ${u(3)} #fff,inset ${u(3)} ${u(3)} 0 #b4bce8,inset ${neg(3)} ${neg(4)} 0 #4d568c;color:#ffffa0}}
.ui-root .ui-btn:active{transform:none;box-shadow:0 0 0 ${u(3)} #000,inset ${u(3)} ${u(4)} 0 #3a3a3a,inset ${neg(3)} ${neg(3)} 0 #8a8a8a}
.ui-root .ui-btn.off,.ui-root .buy.off{filter:grayscale(.85) brightness(.75)}

.ui-root .ui-panel{border-radius:0;background:rgba(0,0,0,.5);backdrop-filter:none;box-shadow:none}

.ui-root .inv-wrap{background:#c6c6c6;border-radius:${u(6)};padding:${u(14)};gap:${u(10)};text-shadow:none;
  box-shadow:0 0 0 ${u(3)} #000,inset ${u(4)} ${u(4)} 0 #fff,inset ${neg(4)} ${neg(4)} 0 #555}
.ui-root .inv-title{color:#3f3f3f;font-weight:700;text-align:left;padding-left:${u(4)}}
.ui-root .inv{gap:${u(4)}}
.ui-root .slot{border-radius:0;background:#8b8b8b;box-shadow:inset ${u(3)} ${u(3)} 0 #373737,inset ${neg(3)} ${neg(3)} 0 #fff}
.ui-root .slot.split{background:#8b8b8b;color:#3f3f3f;text-shadow:none;box-shadow:inset ${u(3)} ${u(3)} 0 #373737,inset ${neg(3)} ${neg(3)} 0 #fff}
.ui-root .slot.split.hot{background:#a0a0b8}
@media (hover:hover){.ui-root .slot:hover{background:#a0a0b8}}
`));
}
