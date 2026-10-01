// Level editor (dev tool, not exported): side view of the level - ground, floors (storeys), obstacles, coins, finish;
// saves to levels.json. Open http://localhost:5173/games/noobRideMaster/levels.html while `npm run dev` runs.
import { h } from 'aiwebengine/ui';
import { DEFAULT_GRID, GRID_MIN, GRID_MAX, CELL, blocksForLevel } from './parts';
import { Builder, generateLevel, heightAt, surfaceY, traceSurface, normalize, FLOOR_T, LIFT_T, LIFT_PAUSE, PISTON_DIR, type Level } from './track';

const FILE = 'games/noobRideMaster/levels.json';
interface Data { levels: Level[] }
/** optional level parts: left out of the file when empty */
const OPTIONAL = new Set(['floors', 'mud', 'ice', 'spikes', 'lifts', 'slime', 'pistons']);
/** slime width (older levels have none) */
const slimeW = (a: number[]) => (a[3] > 0 ? a[3] : 1);
/** piston face direction and its block center (the block is behind the face) */
const pDir = (a: number[]) => PISTON_DIR[a[2] & 3] ?? PISTON_DIR[0];
const pCenter = (a: number[]) => { const [fx, fy] = pDir(a); return [a[0] - fx * 0.5, a[1] - fy * 0.5]; };
const P_NAMES = ['вправо →', 'вверх ↑', 'влево ←', 'вниз ↓'];
/** surface strips: mud (soul sand) and ice; same data [x0, x1, y] and editing */
const STRIPS = ['mud', 'ice'] as const;
const STRIP_STYLE = { mud: ['#4a3120', '#7a5234', '#c9a27a'], ice: ['#7fb3ff', '#b9d6ff', '#e4f0ff'] };

let data: Data = await (await fetch('/' + FILE, { cache: 'no-store' })).json();
data.levels.forEach(normalize);
const stringify = () => JSON.stringify(data, (k, v) => (OPTIONAL.has(k) && Array.isArray(v) && !v.length ? undefined : v));
let saved = stringify();
let cur = 0;
const history: string[] = [];
const level = () => data.levels[cur];
const snapshot = () => { const s = JSON.stringify(data); if (history[history.length - 1] !== s) { history.push(s); if (history.length > 200) history.shift(); } };

/** garage / start zone (the car is built here): ground must be flat at y = 0 */
/** the level's garage grid [columns, rows] */
const gridOf = (L: Level) => L.grid ?? DEFAULT_GRID;
/** the car grid's box in the world (bottom center at (0, 0.45)) and the flat start zone under it */
const GRID = () => {
  const [w, h] = gridOf(level());
  return { x0: (-w * CELL) / 2, x1: (w * CELL) / 2, y0: 0.45, y1: 0.45 + h * CELL };
};
const START = () => { const g = GRID(); return [Math.min(-2.5, g.x0 - 0.75), Math.max(2.5, g.x1 + 0.75)]; };
/** the longest car (7 cells + wheels) */
const CAR_LEN = 4;

// ---------------------------------------------------------------- canvas & view
document.head.append(h('style', null, `
body{margin:0;overflow:hidden;font:13px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e8ecf4;background:#1d2230}
canvas{position:fixed;inset:0;display:block}
.ed{position:fixed;left:0;top:0;bottom:0;width:340px;overflow:auto;background:rgba(20,24,34,.95);padding:12px 12px 40px;box-sizing:border-box;z-index:5;border-right:1px solid #2e3548}
.ed h1{font-size:17px;margin:0 0 8px}
.row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0}
.ed button{background:#2d3548;color:#e8ecf4;border:1px solid #414b63;border-radius:6px;padding:5px 9px;cursor:pointer;font:inherit}
.ed button:hover{background:#39435b}
.ed button.on{background:#3b6fd8;border-color:#5b8cf0}
.ed button.save{background:#2f9d49;border-color:#46c064;font-weight:700}
.ed button.del{background:#5a2a2a;border-color:#7a3a3a}
.ed button.play{background:#b8741f;border-color:#e09a3a;font-weight:700}
.ed input[type=number]{width:58px;background:#10131b;color:#e8ecf4;border:1px solid #3a4258;border-radius:5px;padding:3px 4px;font:inherit}
.ed select{background:#10131b;color:#e8ecf4;border:1px solid #3a4258;border-radius:5px;padding:3px;font:inherit}
.ed a{color:#8fb4ff}
.lbl{color:#9aa6c0;min-width:70px}
.sec{margin-top:12px;padding-top:8px;border-top:1px solid #2e3548;font-weight:700}
.lv{min-width:34px}
.st{font-size:12px;color:#9aa6c0}.st.dirty{color:#ffcf5a}
.hint{font-size:11px;color:#7f8aa3;margin:4px 0}
.warn{font-size:12px;color:#ff9a7a;margin:2px 0}
.ok{font-size:12px;color:#7dff8a}
.props{background:#262d3f;border:1px solid #3b4560;border-radius:8px;padding:6px 8px;margin-top:6px}
`));
const cv = h('canvas');
document.body.append(cv);
const g = cv.getContext('2d')!;
const view = { x: 10, y: 1.5, s: 36 };
const PANEL = 340;
function resize() {
  cv.width = innerWidth * devicePixelRatio;
  cv.height = innerHeight * devicePixelRatio;
  cv.style.width = innerWidth + 'px';
  cv.style.height = innerHeight + 'px';
  draw();
}
addEventListener('resize', resize);
const W = () => innerWidth, H = () => innerHeight;
const sx = (x: number) => PANEL + (W() - PANEL) / 2 + (x - view.x) * view.s;
const sy = (y: number) => H() / 2 - (y - view.y) * view.s;
const wx = (px: number) => (px - PANEL - (W() - PANEL) / 2) / view.s + view.x;
const wy = (py: number) => (H() / 2 - py) / view.s + view.y;

// ---------------------------------------------------------------- selection model
type Line = 'pieces' | 'floors';
type Obj = 'spikes' | 'lifts' | 'slime' | 'mud' | 'ice' | 'pistons';
type Hover =
  | { kind: 'pt'; set: Line; p: number; i: number }
  | { kind: 'seg'; set: Line; p: number; i: number; x: number; y: number }
  | { kind: 'coin'; i: number }
  | { kind: 'finish' }
  | { kind: 'obj'; t: Obj; i: number; part: 'body' | 'end' | 'top' | 'bottom' | 'a' | 'b' }
  | null;
let hover: Hover = null;
/** selected obstacle: its properties are shown in the panel */
let sel: { t: Obj; i: number } | null = null;
type Mode = 'points' | 'coins' | 'gap' | 'join' | 'floor' | 'mud' | 'ice' | 'spikes' | 'lifts' | 'slime' | 'pistons';
let mode: Mode = 'points';
let snapOn = true;
const snap = (v: number, e?: MouseEvent) => (snapOn && !e?.shiftKey ? Math.round(v * 4) / 4 : Math.round(v * 100) / 100);
const lines = (L: Level, set: Line) => (set === 'pieces' ? L.pieces : L.floors!);
/** surface right under a point (a little above it counts too), or null */
const under = (L: Level, x: number, y: number) => surfaceY(L, x, y + 0.6);

// ---------------------------------------------------------------- drawing
const slopeColor = (x0: number, y0: number, x1: number, y1: number) => {
  if (x1 === x0) return y1 > y0 ? '#ff4d4d' : '#6fd35a'; // an up-step can't be climbed by free wheels
  const s = (y1 - y0) / (x1 - x0);
  return s > 0.7 ? '#ff4d4d' : s > 0.45 ? '#ffb347' : '#6fd35a';
};
const isSel = (t: Obj, i: number) => sel?.t === t && sel.i === i;
const isHov = (t: Obj, i: number, part?: string) => hover?.kind === 'obj' && hover.t === t && hover.i === i && (!part || hover.part === part);
function handle(x: number, y: number, on: boolean, color = '#fff') {
  g.fillStyle = on ? '#fff' : color;
  g.strokeStyle = '#111';
  g.lineWidth = 1.5;
  g.beginPath(); g.arc(sx(x), sy(y), on ? 7 : 5, 0, Math.PI * 2); g.fill(); g.stroke();
  g.lineWidth = 1;
}
/** a lift in front of the wall at x (a slime pad may be between) reaches its top, or a turning piston stands at it */
function liftAt(L: Level, x: number, top: number) {
  if (L.pistons!.some((p) => pDir(p)[0] && Math.abs(p[0] - x) < 1.1)) return true;
  return L.lifts!.some((l) => {
    const edge = l[0] + Math.max(0, l[3]) + l[2] / 2, reach = l[1] + Math.max(0, l[4]);
    return x - edge > -0.1 && x - edge < 1.6 && reach >= top - 0.3;
  });
}
function drawLine(L: Level, set: Line, p: number[], idx: number) {
  g.lineWidth = 4;
  for (let i = 0; i + 3 < p.length; i += 2) {
    g.strokeStyle = p[i] === p[i + 2] && p[i + 3] > p[i + 1] && liftAt(L, p[i], p[i + 3]) ? '#b070ff' : slopeColor(p[i], p[i + 1], p[i + 2], p[i + 3]);
    g.beginPath(); g.moveTo(sx(p[i]), sy(p[i + 1])); g.lineTo(sx(p[i + 2]), sy(p[i + 3])); g.stroke();
  }
  g.lineWidth = 1;
  if (view.s > 14) for (let i = 0; i < p.length; i += 2) {
    const on = hover?.kind === 'pt' && hover.set === set && hover.p === idx && hover.i === i;
    g.fillStyle = on ? '#fff' : set === 'floors' ? '#2a2a2a' : '#20331a';
    g.beginPath(); g.arc(sx(p[i]), sy(p[i + 1]), on ? 6 : 3.5, 0, Math.PI * 2); g.fill();
  }
}
function draw() {
  const L = level();
  g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  g.fillStyle = '#a9ccf5';
  g.fillRect(0, 0, W(), H());
  // grid: 1 m lines, 5 m labelled
  const x0 = Math.floor(wx(PANEL)), x1 = Math.ceil(wx(W())), y0 = Math.floor(wy(H())), y1 = Math.ceil(wy(0));
  g.font = '11px system-ui';
  for (let x = x0; x <= x1; x++) {
    if (view.s < 12 && x % 5 !== 0) continue;
    g.strokeStyle = x % 5 === 0 ? 'rgba(40,60,100,.35)' : 'rgba(40,60,100,.12)';
    g.beginPath(); g.moveTo(sx(x), 0); g.lineTo(sx(x), H()); g.stroke();
    if (x % 5 === 0) { g.fillStyle = 'rgba(20,30,60,.6)'; g.fillText(String(x), sx(x) + 2, H() - 6); }
  }
  for (let y = y0; y <= y1; y++) {
    if (view.s < 12 && y % 5 !== 0) continue;
    g.strokeStyle = y === 0 ? 'rgba(40,60,100,.45)' : 'rgba(40,60,100,.12)';
    g.beginPath(); g.moveTo(PANEL, sy(y)); g.lineTo(W(), sy(y)); g.stroke();
    if (y % (view.s < 20 ? 5 : 1) === 0) { g.fillStyle = 'rgba(20,30,60,.6)'; g.fillText(String(y), PANEL + 4, sy(y) - 2); }
  }
  if (!L) return;
  // start zone and the garage grid (car size reference)
  g.fillStyle = 'rgba(80,140,255,.15)';
  const GB = GRID();
  g.fillRect(sx(GB.x0), sy(GB.y1), (GB.x1 - GB.x0) * view.s, (GB.y1 - GB.y0) * view.s);
  g.strokeStyle = 'rgba(60,110,230,.7)';
  g.strokeRect(sx(GB.x0), sy(GB.y1), (GB.x1 - GB.x0) * view.s, (GB.y1 - GB.y0) * view.s);
  // cell lines
  g.strokeStyle = 'rgba(60,110,230,.25)';
  for (let x = GB.x0 + CELL; x < GB.x1 - 1e-6; x += CELL) { g.beginPath(); g.moveTo(sx(x), sy(GB.y0)); g.lineTo(sx(x), sy(GB.y1)); g.stroke(); }
  for (let y = GB.y0 + CELL; y < GB.y1 - 1e-6; y += CELL) { g.beginPath(); g.moveTo(sx(GB.x0), sy(y)); g.lineTo(sx(GB.x1), sy(y)); g.stroke(); }
  g.fillStyle = 'rgba(30,60,160,.9)'; g.font = 'bold 12px system-ui';
  g.fillText(`старт / гараж ${gridOf(L).join('×')}`, sx(GB.x0) + 4, sy(GB.y1) - 5);
  // ground pieces (filled a few meters deep)
  const bottom = Math.min(...L.pieces.flatMap((p) => p.filter((_, i) => i % 2 === 1))) - 3;
  L.pieces.forEach((p, idx) => {
    g.beginPath();
    g.moveTo(sx(p[0]), sy(bottom));
    for (let i = 0; i < p.length; i += 2) g.lineTo(sx(p[i]), sy(p[i + 1]));
    g.lineTo(sx(p[p.length - 2]), sy(bottom));
    g.closePath();
    g.fillStyle = '#8a5a35';
    g.fill();
    drawLine(L, 'pieces', p, idx);
  });
  // floors: stone slabs
  L.floors!.forEach((p, idx) => {
    g.beginPath();
    for (let i = 0; i < p.length; i += 2) g.lineTo(sx(p[i]), sy(p[i + 1]));
    for (let i = p.length - 2; i >= 0; i -= 2) g.lineTo(sx(p[i]), sy(p[i + 1] - FLOOR_T));
    g.closePath();
    g.fillStyle = '#8b8b8b';
    g.fill();
    g.strokeStyle = '#5a5a5a';
    g.stroke();
    drawLine(L, 'floors', p, idx);
  });
  // mud and ice
  for (const t of STRIPS) L[t]!.forEach((m, i) => {
    const pts = traceSurface(L, Math.min(m[0], m[1]), Math.max(m[0], m[1]), m[2]), st = STRIP_STYLE[t];
    g.strokeStyle = isSel(t, i) || isHov(t, i, 'body') ? st[1] : st[0];
    g.lineWidth = Math.max(4, 0.18 * view.s);
    g.lineCap = 'round';
    g.beginPath();
    for (const [x, y] of pts) g.lineTo(sx(x), sy(y + 0.06));
    g.stroke();
    g.lineWidth = 1;
    g.lineCap = 'butt';
    if (isSel(t, i) || mode === t) {
      handle(pts[0][0], pts[0][1] + 0.06, isHov(t, i, 'a'), st[2]);
      handle(pts[pts.length - 1][0], pts[pts.length - 1][1] + 0.06, isHov(t, i, 'b'), st[2]);
    }
  });
  // spikes
  L.spikes!.forEach((s, i) => {
    const [x, y, w, period] = s, on = isSel('spikes', i) || isHov('spikes', i);
    g.fillStyle = '#55595f';
    g.fillRect(sx(x - w / 2), sy(y + 0.05), w * view.s, 0.1 * view.s);
    const n = Math.max(1, Math.round(w / 0.3));
    g.fillStyle = on ? '#ffffff' : '#c9ced6';
    g.strokeStyle = '#333';
    for (let k = 0; k < n; k++) {
      const cx = x - w / 2 + (w * (k + 0.5)) / n;
      g.beginPath(); g.moveTo(sx(cx - 0.11), sy(y)); g.lineTo(sx(cx), sy(y + 0.6)); g.lineTo(sx(cx + 0.11), sy(y)); g.closePath(); g.fill(); g.stroke();
    }
    g.fillStyle = '#222'; g.font = '11px system-ui';
    g.fillText(period ? `⏱ ${period} с` : 'всегда', sx(x - w / 2), sy(y + 0.75));
  });
  // lifts: solid at the start, ghost at the end, path between
  L.lifts!.forEach((l, i) => {
    const [x, y, w, dx, dy, time, pause] = l, on = isSel('lifts', i) || isHov('lifts', i, 'body');
    g.setLineDash([6, 4]);
    g.strokeStyle = '#8a4fc0';
    g.strokeRect(sx(x + dx - w / 2), sy(y + dy), w * view.s, LIFT_T * view.s);
    g.beginPath(); g.moveTo(sx(x), sy(y - LIFT_T / 2)); g.lineTo(sx(x + dx), sy(y + dy - LIFT_T / 2)); g.stroke();
    g.setLineDash([]);
    g.fillStyle = on ? '#d9a3ff' : '#a77ba7';
    g.fillRect(sx(x - w / 2), sy(y), w * view.s, LIFT_T * view.s);
    g.strokeStyle = on ? '#fff' : '#5e3a5e';
    g.strokeRect(sx(x - w / 2), sy(y), w * view.s, LIFT_T * view.s);
    g.fillStyle = '#3b1f52'; g.font = '11px system-ui';
    g.fillText(`⟳ ${time} с, пауза ${pause} с`, sx(x - w / 2) + 3, sy(y - LIFT_T) + 11);
    handle(x + dx, y + dy, isHov('lifts', i, 'end'), '#c27cff');
  });
  // slime blocks (walls or flat pads)
  L.slime!.forEach((s, i) => {
    const [x, y0s, y1s] = s, w = slimeW(s), on = isSel('slime', i) || isHov('slime', i, 'body');
    g.fillStyle = on ? 'rgba(160,240,130,.95)' : 'rgba(118,201,90,.9)';
    g.fillRect(sx(x - w / 2), sy(y1s), w * view.s, (y1s - y0s) * view.s);
    g.strokeStyle = '#3d7a2e';
    g.strokeRect(sx(x - w / 2), sy(y1s), w * view.s, (y1s - y0s) * view.s);
    if (isSel('slime', i) || mode === 'slime') {
      handle(x, y1s, isHov('slime', i, 'top'), '#bdf5a8');
      handle(x, y0s, isHov('slime', i, 'bottom'), '#bdf5a8');
      handle(x + w / 2, (y0s + y1s) / 2, isHov('slime', i, 'b'), '#bdf5a8');
    }
  });
  // pistons: the block, the plank face and an arrow where it pushes
  L.pistons!.forEach((p, i) => {
    const [cx, cy] = pCenter(p), [fx, fy] = pDir(p), on = isSel('pistons', i) || isHov('pistons', i, 'body');
    g.fillStyle = on ? '#9a9a9a' : '#6f6f6f';
    g.fillRect(sx(cx - 0.5), sy(cy + 0.5), view.s, view.s);
    g.fillStyle = '#a8834f';
    const t = 0.25;
    g.fillRect(sx(fx > 0 ? p[0] - t : fx < 0 ? p[0] : cx - 0.5), sy(fy > 0 ? p[1] : fy < 0 ? p[1] + t : cy + 0.5),
      (fx ? t : 1) * view.s, (fy ? t : 1) * view.s);
    g.strokeStyle = on ? '#fff' : '#2a2a2a';
    g.strokeRect(sx(cx - 0.5), sy(cy + 0.5), view.s, view.s);
    g.strokeStyle = '#ffe14d'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(sx(cx), sy(cy)); g.lineTo(sx(p[0] + fx * 0.6), sy(p[1] + fy * 0.6)); g.stroke();
    g.lineWidth = 1;
  });
  // coins
  for (let i = 0; i < L.coins.length; i++) {
    const c = L.coins[i], on = hover?.kind === 'coin' && hover.i === i;
    g.fillStyle = on ? '#fff3a0' : '#ffd23f';
    g.strokeStyle = '#b8860b';
    g.beginPath(); g.arc(sx(c[0]), sy(c[1]), Math.max(3, 0.28 * view.s), 0, Math.PI * 2); g.fill(); g.stroke();
  }
  // finish
  const fy = L.finishY!, fx = sx(L.finishX);
  for (let k = 0; k < 8; k++) {
    g.fillStyle = k % 2 ? '#111' : '#fff';
    g.fillRect(fx - 3, sy(fy + 4.5) + (k * 4.5 * view.s) / 8, 6, (4.5 * view.s) / 8);
  }
  g.fillStyle = hover?.kind === 'finish' ? '#fff' : '#e8322f';
  g.beginPath(); g.arc(fx, sy(fy + 4.5), 8, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#111'; g.font = 'bold 12px system-ui'; g.fillText('ФИНИШ', fx + 10, sy(fy + 4.5) + 4);
}

// ---------------------------------------------------------------- picking
const near = (px: number, py: number, x: number, y: number, r = 9) => Math.hypot(px - sx(x), py - sy(y)) < r;
const inRect = (px: number, py: number, x0: number, y0: number, x1: number, y1: number) =>
  px >= sx(Math.min(x0, x1)) - 3 && px <= sx(Math.max(x0, x1)) + 3 && py >= sy(Math.max(y0, y1)) - 3 && py <= sy(Math.min(y0, y1)) + 3;

function pick(px: number, py: number): Hover {
  const L = level();
  if (!L) return null;
  if (near(px, py, L.finishX, L.finishY! + 4.5, 10)) return { kind: 'finish' };
  // obstacle handles first, then their bodies
  for (let i = L.lifts!.length - 1; i >= 0; i--) {
    const [x, y, , dx, dy] = L.lifts![i];
    if (near(px, py, x + dx, y + dy)) return { kind: 'obj', t: 'lifts', i, part: 'end' };
  }
  for (let i = L.slime!.length - 1; i >= 0; i--) {
    const [x, y0, y1] = L.slime![i];
    if (isSel('slime', i) || mode === 'slime') {
      if (near(px, py, x, y1)) return { kind: 'obj', t: 'slime', i, part: 'top' };
      if (near(px, py, x, y0)) return { kind: 'obj', t: 'slime', i, part: 'bottom' };
      if (near(px, py, x + slimeW(L.slime![i]) / 2, (y0 + y1) / 2)) return { kind: 'obj', t: 'slime', i, part: 'b' };
    }
  }
  for (const t of STRIPS) for (let i = L[t]!.length - 1; i >= 0; i--) {
    const m = L[t]![i];
    if (!(isSel(t, i) || mode === t)) continue;
    const pts = traceSurface(L, Math.min(m[0], m[1]), Math.max(m[0], m[1]), m[2]);
    const first = m[0] <= m[1];
    if (near(px, py, pts[0][0], pts[0][1])) return { kind: 'obj', t, i, part: first ? 'a' : 'b' };
    const e = pts[pts.length - 1];
    if (near(px, py, e[0], e[1])) return { kind: 'obj', t, i, part: first ? 'b' : 'a' };
  }
  for (let i = L.lifts!.length - 1; i >= 0; i--) {
    const [x, y, w] = L.lifts![i];
    if (inRect(px, py, x - w / 2, y, x + w / 2, y - LIFT_T)) return { kind: 'obj', t: 'lifts', i, part: 'body' };
  }
  for (let i = L.spikes!.length - 1; i >= 0; i--) {
    const [x, y, w] = L.spikes![i];
    if (inRect(px, py, x - w / 2, y - 0.1, x + w / 2, y + 0.65)) return { kind: 'obj', t: 'spikes', i, part: 'body' };
  }
  for (let i = L.pistons!.length - 1; i >= 0; i--) {
    const [cx, cy] = pCenter(L.pistons![i]);
    if (inRect(px, py, cx - 0.5, cy - 0.5, cx + 0.5, cy + 0.5)) return { kind: 'obj', t: 'pistons', i, part: 'body' };
  }
  for (let i = L.slime!.length - 1; i >= 0; i--) {
    const [x, y0, y1] = L.slime![i], w = slimeW(L.slime![i]);
    if (inRect(px, py, x - w / 2, y0, x + w / 2, y1)) return { kind: 'obj', t: 'slime', i, part: 'body' };
  }
  if (mode === 'coins') for (let i = L.coins.length - 1; i >= 0; i--) {
    if (Math.hypot(px - sx(L.coins[i][0]), py - sy(L.coins[i][1])) < Math.max(8, 0.3 * view.s)) return { kind: 'coin', i };
  }
  for (const t of STRIPS) for (let i = L[t]!.length - 1; i >= 0; i--) {
    const m = L[t]![i], xa = Math.min(m[0], m[1]), xb = Math.max(m[0], m[1]), x = wx(px);
    if (x < xa || x > xb) continue;
    const y = surfaceY(L, x, m[2] + Math.abs(x - xa) + 1);
    if (y !== null && Math.abs(py - sy(y + 0.06)) < Math.max(6, 0.12 * view.s)) return { kind: 'obj', t, i, part: 'body' };
  }
  for (const set of ['floors', 'pieces'] as Line[]) {
    const arr = lines(L, set);
    for (let p = 0; p < arr.length; p++) {
      const a = arr[p];
      for (let i = 0; i < a.length; i += 2) if (near(px, py, a[i], a[i + 1], 8)) return { kind: 'pt', set, p, i };
    }
  }
  // segment under the cursor
  for (const set of ['floors', 'pieces'] as Line[]) {
    const arr = lines(L, set);
    for (let p = 0; p < arr.length; p++) {
      const a = arr[p];
      for (let i = 0; i + 3 < a.length; i += 2) {
        const ax = sx(a[i]), ay = sy(a[i + 1]), bx = sx(a[i + 2]), by = sy(a[i + 3]);
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
        if (Math.hypot(px - (ax + dx * t), py - (ay + dy * t)) < 7) {
          return { kind: 'seg', set, p, i, x: a[i] + (a[i + 2] - a[i]) * t, y: a[i + 1] + (a[i + 3] - a[i + 1]) * t };
        }
      }
    }
  }
  return null;
}

/** keep a line a function of x: a point stays between its neighbours */
function clampX(a: number[], i: number, x: number) {
  const lo = i > 0 ? a[i - 2] : -Infinity, hi = i + 2 < a.length ? a[i + 2] : Infinity;
  return Math.min(hi, Math.max(lo, x));
}

// ---------------------------------------------------------------- mouse
interface Drag { kind: 'pt' | 'coin' | 'finish' | 'pan' | 'obj'; set?: Line; p?: number; i?: number; t?: Obj; part?: string; mx: number; my: number; vx: number; vy: number; ox?: number; oy?: number; orig?: number[] }
let drag: Drag | null = null;
cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('mousedown', (e) => {
  const L = level();
  if (!L) return;
  const hv = pick(e.clientX, e.clientY);
  const base = { mx: e.clientX, my: e.clientY, vx: view.x, vy: view.y };
  const x = snap(wx(e.clientX), e), y = snap(wy(e.clientY), e);
  if (e.button === 1) { drag = { kind: 'pan', ...base }; return; }
  if (e.button === 2) {
    // right click: delete a point / coin / obstacle
    if (hv?.kind === 'pt') {
      const arr = lines(L, hv.set);
      snapshot();
      if (arr[hv.p].length > 4) arr[hv.p].splice(hv.i, 2);
      else if (hv.set === 'floors') arr.splice(hv.p, 1);
      changed();
    } else if (hv?.kind === 'coin') { snapshot(); L.coins.splice(hv.i, 1); changed(); }
    else if (hv?.kind === 'obj') { snapshot(); L[hv.t]!.splice(hv.i, 1); sel = null; render(); }
    else drag = { kind: 'pan', ...base };
    return;
  }
  if (hv?.kind === 'finish') { snapshot(); drag = { kind: 'finish', ...base }; return; }
  if (hv?.kind === 'obj') {
    snapshot();
    const a = L[hv.t]![hv.i];
    drag = { kind: 'obj', t: hv.t, i: hv.i, part: hv.part, ...base, ox: wx(e.clientX), oy: wy(e.clientY), orig: a.slice() };
    if (!isSel(hv.t, hv.i)) { sel = { t: hv.t, i: hv.i }; render(); }
    return;
  }
  if (sel) { sel = null; render(); }
  const surf = under(L, x, wy(e.clientY));
  switch (mode) {
    case 'points':
    case 'floor':
      if (hv?.kind === 'pt') { snapshot(); drag = { kind: 'pt', set: hv.set, p: hv.p, i: hv.i, ...base }; }
      else if (hv?.kind === 'seg') {
        // click on a segment: new point there, dragged right away
        snapshot();
        const a = lines(L, hv.set)[hv.p];
        a.splice(hv.i + 2, 0, snap(hv.x, e), snap(hv.y, e));
        drag = { kind: 'pt', set: hv.set, p: hv.p, i: hv.i + 2, ...base };
        changed();
      } else if (mode === 'floor') {
        // new floor: drag its end
        snapshot();
        L.floors!.push([x, y, x, y]);
        drag = { kind: 'pt', set: 'floors', p: L.floors!.length - 1, i: 2, ...base };
        changed();
      } else drag = { kind: 'pan', ...base };
      break;
    case 'coins':
      snapshot();
      if (hv?.kind === 'coin') drag = { kind: 'coin', i: hv.i, ...base };
      else { L.coins.push([x, y]); changed(); }
      break;
    case 'gap':
      if (hv?.kind === 'seg') {
        // remove the clicked segment: the line splits in two with a gap between (a one-segment floor disappears)
        snapshot();
        const arr = lines(L, hv.set), a = arr[hv.p];
        arr.splice(hv.p, 1, ...[a.slice(0, hv.i + 2), a.slice(hv.i + 2)].filter((q) => q.length >= 4));
        changed();
      } else drag = { kind: 'pan', ...base };
      break;
    case 'join':
      if (hv?.kind === 'pt') join(L, hv.set, hv.p, hv.i);
      else drag = { kind: 'pan', ...base };
      break;
    case 'mud':
    case 'ice':
      if (surf === null) { drag = { kind: 'pan', ...base }; break; }
      snapshot();
      L[mode]!.push([x, x, surf]);
      sel = { t: mode, i: L[mode]!.length - 1 };
      drag = { kind: 'obj', t: mode, i: sel.i, part: 'b', ...base };
      render();
      break;
    case 'spikes':
      snapshot();
      L.spikes!.push([x, surf ?? y, 1.6, 4, 0]);
      sel = { t: 'spikes', i: L.spikes!.length - 1 };
      render();
      break;
    case 'lifts':
      snapshot();
      L.lifts!.push([x, surf ?? y, 4.5, 0, 4.5, 2.8, LIFT_PAUSE, 0]);
      sel = { t: 'lifts', i: L.lifts!.length - 1 };
      render();
      break;
    case 'slime':
      snapshot();
      L.slime!.push([x, surf ?? y, (surf ?? y) + 2.5, 1]);
      sel = { t: 'slime', i: L.slime!.length - 1 };
      render();
      break;
    case 'pistons':
      // standing on the ground, face to the left (towards a car coming from the left)
      snapshot();
      L.pistons!.push([x, (surf ?? y) + 0.5, 2]);
      sel = { t: 'pistons', i: L.pistons!.length - 1 };
      render();
      break;
  }
});
/** join the end of a line with the nearest line of the same kind after it (or before it, clicking a start point) */
function join(L: Level, set: Line, p: number, i: number) {
  const arr = lines(L, set), a = arr[p], end = i === a.length - 2, start = i === 0;
  if (!end && !start) return;
  let best = -1, dist = Infinity;
  arr.forEach((b, k) => {
    if (k === p) return;
    const d = end ? b[0] - a[a.length - 2] : a[0] - b[b.length - 2];
    const dy = end ? Math.abs(b[1] - a[a.length - 1]) : Math.abs(a[1] - b[b.length - 1]);
    if (d >= -0.01 && d + dy * 0.5 < dist) { dist = d + dy * 0.5; best = k; }
  });
  if (best < 0) return;
  snapshot();
  const [first, second] = end ? [a, arr[best]] : [arr[best], a];
  const merged = [...first, ...second];
  const keep = Math.min(p, best);
  arr.splice(Math.max(p, best), 1);
  arr.splice(keep, 1, merged);
  changed();
}

function dragObj(d: Drag, x: number, y: number, e: MouseEvent) {
  const L = level(), a = L[d.t!]![d.i!], o = d.orig!;
  const dx = snap(wx(e.clientX) - d.ox!, e), dy = snap(wy(e.clientY) - d.oy!, e);
  switch (d.t) {
    case 'spikes':
      a[0] = snap(o[0] + dx, e);
      a[1] = under(L, a[0], wy(e.clientY)) ?? y;
      break;
    case 'lifts':
      if (d.part === 'end') { a[3] = snap(x - a[0], e); a[4] = snap(y - a[1], e); }
      else { a[0] = snap(o[0] + dx, e); a[1] = snap(o[1] + dy, e); }
      break;
    case 'slime':
      if (d.part === 'top') a[2] = Math.max(a[1] + 0.25, y);
      else if (d.part === 'bottom') a[1] = Math.min(a[2] - 0.25, y);
      else if (d.part === 'b') a[3] = Math.max(0.5, snap(2 * Math.abs(wx(e.clientX) - a[0]), e));
      else { a[0] = snap(o[0] + dx, e); a[1] = o[1] + dy; a[2] = o[2] + dy; }
      break;
    case 'pistons':
      a[0] = snap(o[0] + dx, e);
      a[1] = snap(o[1] + dy, e);
      break;
    case 'mud':
    case 'ice':
      if (d.part === 'a') { a[0] = x; a[2] = under(L, x, wy(e.clientY)) ?? a[2]; }
      else if (d.part === 'b') a[1] = x;
      else {
        a[0] = snap(o[0] + dx, e); a[1] = snap(o[1] + dx, e);
        a[2] = under(L, Math.min(a[0], a[1]), wy(e.clientY)) ?? a[2];
      }
      break;
  }
}
addEventListener('mousemove', (e) => {
  const L = level();
  if (drag && L) {
    if (drag.kind === 'pan') { view.x = drag.vx - (e.clientX - drag.mx) / view.s; view.y = drag.vy + (e.clientY - drag.my) / view.s; draw(); return; }
    const x = snap(wx(e.clientX), e), y = snap(wy(e.clientY), e);
    if (drag.kind === 'pt') { const a = lines(L, drag.set!)[drag.p!]; a[drag.i!] = clampX(a, drag.i!, x); a[drag.i! + 1] = y; }
    else if (drag.kind === 'coin') L.coins[drag.i!] = [x, y];
    else if (drag.kind === 'finish') { L.finishX = x; L.finishY = under(L, x, wy(e.clientY)) ?? y; }
    else if (drag.kind === 'obj') { dragObj(drag, x, y, e); propsEl.dataset.stale = '1'; }
    changed(false);
    return;
  }
  if (e.target !== cv) return;
  const hv = pick(e.clientX, e.clientY);
  if (JSON.stringify(hv) !== JSON.stringify(hover)) { hover = hv; draw(); }
  const creates = mode === 'floor' || mode === 'mud' || mode === 'ice' || mode === 'spikes' || mode === 'lifts' || mode === 'slime' || mode === 'pistons' || mode === 'coins';
  cv.style.cursor = hv && hv.kind !== 'seg' ? 'grab' : hv?.kind === 'seg' && (mode === 'points' || mode === 'floor' || mode === 'gap') ? 'copy' : creates ? 'crosshair' : 'default';
  coordsEl.textContent = `x ${wx(e.clientX).toFixed(2)}  y ${wy(e.clientY).toFixed(2)}`;
});
addEventListener('mouseup', () => {
  const L = level();
  if (drag && drag.kind !== 'pan' && L) {
    // a new floor dragged to zero length is dropped
    L.floors = L.floors!.filter((p) => p[p.length - 2] > p[0]);
    for (const t of STRIPS) L[t] = L[t]!.filter((m) => Math.abs(m[1] - m[0]) > 0.1);
    if (sel && !L[sel.t]![sel.i]) sel = null;
    if (drag.kind === 'obj' || propsEl.dataset.stale) render(); else changed();
  }
  drag = null;
});
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const before = [wx(e.clientX), wy(e.clientY)];
  view.s = Math.min(160, Math.max(4, view.s * Math.pow(1.15, -Math.sign(e.deltaY))));
  view.x += before[0] - wx(e.clientX);
  view.y += before[1] - wy(e.clientY);
  draw();
}, { passive: false });

// ---------------------------------------------------------------- panel
const panel = h('div', { class: 'ed' });
document.body.append(panel);
const statusEl = h('span', { class: 'st' });
const coordsEl = h('span', { class: 'st' });
const infoEl = h('div');
const propsEl = h('div');

function status() {
  const dirty = stringify() !== saved;
  statusEl.textContent = dirty ? '● есть несохранённые изменения' : '✔ сохранено';
  statusEl.className = 'st' + (dirty ? ' dirty' : '');
}
/** checks shown under the level: flat start, climbable slopes, finish on a surface, lifts big enough */
function validate() {
  const L = level();
  infoEl.replaceChildren();
  if (!L) return;
  const warn: string[] = [];
  const ST = START();
  for (let x = ST[0]; x <= ST[1]; x += 0.25) {
    const y = heightAt(L, x);
    if (y === null || Math.abs(y) > 0.01) { warn.push(`Под гаражом (x от ${ST[0]} до ${ST[1]}) земля должна быть ровной на высоте 0.`); break; }
  }
  let steep = 0, walls = 0;
  const served = (x: number, top: number) => liftAt(L, x, top);
  for (const p of [...L.pieces, ...L.floors!]) for (let i = 0; i + 3 < p.length; i += 2) {
    if (p[i + 2] === p[i]) { if (p[i + 3] > p[i + 1] && !served(p[i], p[i + 3])) walls++; continue; }
    if ((p[i + 3] - p[i + 1]) / (p[i + 2] - p[i]) > 0.7) steep++;
  }
  if (walls) warn.push(`Вертикальных стенок вверх: ${walls} — свободные колёса на них не заедут (красные). Нужен лифт.`);
  if (steep) warn.push(`Очень крутых подъёмов (> 35°): ${steep} — красные участки.`);
  const fs = surfaceY(L, L.finishX, L.finishY! + 0.05);
  if (fs === null || Math.abs(fs - L.finishY!) > 0.3) warn.push('Финиш висит в воздухе — перетащите флажок на землю или этаж.');
  else {
    // run-out: the surface under the finish goes on for a while at least to one side
    const line = [...L.pieces, ...L.floors!].find((p) => L.finishX >= p[0] && L.finishX <= p[p.length - 2] && Math.abs((surfaceY({ pieces: [p], finishX: 0, coins: [] }, L.finishX, fs + 0.05) ?? -1e9) - fs) < 0.05);
    if (line && line[line.length - 2] - L.finishX < 4 && L.finishX - line[0] < 4) warn.push('За финишем мало места (машина вылетит за край).');
  }
  L.lifts!.forEach((l, i) => { if (l[2] < CAR_LEN) warn.push(`Платформа ${i + 1}: уже ${CAR_LEN} м — длинная машина может свеситься и зацепиться.`); });
  const turns = L.pistons!.filter((p) => pDir(p)[0]).length;
  infoEl.append(
    h('div', { class: 'st' }, `Длина до финиша: ${(L.finishX - GRID().x0).toFixed(0)} м по X · финиш на высоте ${L.finishY!.toFixed(1)} м`),
    h('div', { class: 'st' }, `Земля: ${L.pieces.length} · этажи: ${L.floors!.length} · монеты: ${L.coins.length} · грязь: ${L.mud!.length} · лёд: ${L.ice!.length} · шипы: ${L.spikes!.length} · платформы: ${L.lifts!.length} · слизь: ${L.slime!.length} · поршни: ${L.pistons!.length} (разворотов ${turns})`),
  );
  if (!warn.length) infoEl.append(h('div', { class: 'ok' }, '✔ проблем не найдено'));
  for (const w of warn) infoEl.append(h('div', { class: 'warn' }, '⚠ ' + w));
}
function changed(panelToo = true) {
  draw();
  status();
  if (panelToo) validate();
}

async function save() {
  // coordinates rounded to millimetres, short arrays on one line
  const body = JSON.stringify(JSON.parse(stringify()), (_, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v), 2)
    .replace(/\[([^[\]{}]*)\]/g, (_, inner: string) => `[${inner.trim().split(/\s*,\s*/).join(', ')}]`) + '\n';
  const r = await fetch('/__aiwe/save?file=' + FILE, { method: 'POST', body });
  if (r.ok) { saved = stringify(); statusEl.textContent = '✔ сохранено в ' + FILE; statusEl.className = 'st'; }
  else { statusEl.textContent = 'Ошибка сохранения: ' + (await r.text()); statusEl.className = 'st dirty'; }
  return r.ok;
}
function undo() {
  const s = history.pop();
  if (!s) return;
  data = JSON.parse(s);
  cur = Math.min(cur, data.levels.length - 1);
  sel = null;
  render();
}

const btn = (label: string, fn: () => void, cls = '') => h('button', { class: cls, onClick: fn }, label);
const row = (...c: (HTMLElement | string)[]) => h('div', { class: 'row' }, ...c);
const lbl = (t: string) => h('span', { class: 'lbl' }, t);
const numIn = (v: number, step = 0.5) => h('input', { type: 'number', step: String(step), value: String(v) });

/** empty level: flat start, finish, run-out */
function emptyLevel(): Level {
  const b = new Builder();
  b.line(22);
  return normalize(b.finish());
}
/** Insert a generated feature right before the finish; everything after the finish moves along. */
function insertFeature(fn: (b: Builder) => void, maxSlope: number) {
  const L = level();
  const fx = L.finishX, fy = heightAt(L, fx);
  if (fy === null || Math.abs(fy - L.finishY!) > 0.05) { alert('Вставка работает, когда финиш стоит на земле (не на этаже и не над пропастью).'); return; }
  snapshot();
  // split the track at the finish: [pieces before] + [head of the finish piece] | [tail after the finish]
  const idx = L.pieces.findIndex((p) => fx >= p[0] && fx <= p[p.length - 2]);
  const piece = L.pieces[idx], head: number[] = [], tail: number[] = [];
  for (let i = 0; i < piece.length; i += 2) (piece[i] <= fx ? head : tail).push(piece[i], piece[i + 1]);
  if (head[head.length - 2] !== fx) head.push(fx, fy);
  const b = new Builder();
  b.maxSlope = maxSlope;
  b.pieces = L.pieces.slice(0, idx);
  b.cur = head;
  b.x = fx; b.y = fy;
  b.coins = [];
  fn(b);
  b.line(3);
  const dx = b.x - fx, dy = b.y - fy;
  const after = (x: number) => x > fx;
  const move = (a: number[], ix = [0], iy = [1]) => { const c = a.slice(); for (const i of ix) c[i] += dx; for (const i of iy) c[i] += dy; return c; };
  // shift everything after the old finish
  for (let i = 0; i < tail.length; i += 2) b.cur.push(tail[i] + dx, tail[i + 1] + dy);
  const later = L.pieces.slice(idx + 1).map((p) => p.map((v, i) => v + (i % 2 ? dy : dx)));
  L.pieces = [...b.pieces, b.cur, ...later];
  L.floors = [...L.floors!.map((p) => (after(p[0]) ? p.map((v, i) => v + (i % 2 ? dy : dx)) : p)), ...b.floors];
  L.coins = [...L.coins.map((c) => (after(c[0]) ? move(c) : c)), ...b.coins];
  L.mud = [...L.mud!.map((m) => (after(Math.min(m[0], m[1])) ? move(m, [0, 1], [2]) : m)), ...b.mud];
  L.ice = [...L.ice!.map((m) => (after(Math.min(m[0], m[1])) ? move(m, [0, 1], [2]) : m)), ...b.ice];
  L.spikes = [...L.spikes!.map((s) => (after(s[0]) ? move(s) : s)), ...b.spikes];
  L.lifts = [...L.lifts!.map((l) => (after(l[0]) ? move(l) : l)), ...b.lifts];
  L.slime = [...L.slime!.map((s) => (after(s[0]) ? move(s, [0], [1, 2]) : s)), ...b.slime];
  L.pistons = [...L.pistons!.map((p) => (after(p[0]) ? move(p) : p)), ...b.pistons];
  L.finishX = b.x;
  L.finishY = b.y;
  render();
}

const FEATURES: [string, string, (b: Builder, len: number, hgt: number, n: number) => void][] = [
  ['flat', 'Ровный участок', (b, len) => b.line(len, 0, Math.round(len / 2))],
  ['hills', 'Холмы', (b, len, hgt, n) => b.hills(len, hgt, n)],
  ['ramp', 'Трамплин', (b, len, hgt) => b.ramp(len, hgt)],
  ['gap', 'Трамплин + пропасть', (b, len, hgt, n) => b.ramp(len, hgt).gap(n, -1)],
  ['stairs', 'Ступени', (b, len, hgt, n) => b.stairs(n, hgt, len / n)],
  ['valley', 'Яма', (b, len, hgt) => b.valley(len, hgt)],
  ['bumps', 'Кочки', (b, len, hgt, n) => b.bumps(n, hgt, len / n)],
  ['up', 'Подъём', (b, len, hgt) => b.line(len, hgt, Math.round(len / 3))],
  ['down', 'Спуск', (b, len, hgt) => b.line(len, -hgt, Math.round(len / 3))],
  ['mud', 'Грязь', (b, len) => b.line(2).mudLine(len).line(2)],
  ['ice', 'Лёд', (b, len) => b.line(2).iceLine(len).line(2)],
  ['spikes', 'Шипы (ширина = высота)', (b, len, hgt, n) => b.line(1).spikeLine(len, Math.max(0.5, hgt), Math.max(0, n), 0).line(1)],
  ['launch', 'Поршень-подкидыш', (b, len) => b.line(1).launcher(Math.max(28, len)).line(1)],
  ['lift', 'Лифт на стену', (b, _len, hgt) => b.line(2).liftUp(Math.max(0.5, hgt)).line(4, 0, 2)],
  ['tower', 'Башня (этажи)', (b, len, hgt, n) => b.line(2).tower(n, len, Math.max(4, hgt)).line(4, 0, 2)],
];

/** property editor of the selected obstacle */
function props() {
  const L = level();
  propsEl.replaceChildren();
  delete propsEl.dataset.stale;
  if (!L || !sel || !L[sel.t]![sel.i]) return;
  const a = L[sel.t]![sel.i], t = sel.t;
  const field = (name: string, k: number, step = 0.25, min = -1e9) => {
    const inp = numIn(+a[k].toFixed(3), step);
    inp.addEventListener('change', () => { snapshot(); a[k] = Math.max(min, +inp.value || 0); changed(); });
    return [lbl(name), inp];
  };
  const title = { spikes: 'Шипы', lifts: 'Левитирующая платформа', slime: 'Блок слизи', mud: 'Грязь', ice: 'Лёд', pistons: 'Поршень' }[t];
  const box = h('div', { class: 'props' }, h('b', null, `${title} №${sel.i + 1}`));
  if (t === 'spikes') {
    box.append(
      row(...field('X', 0), ...field('Y (низ)', 1)),
      row(...field('Ширина, м', 2, 0.1, 0.3), ...field('Период, с', 3, 0.5, 0)),
      row(...field('Фаза 0..1', 4, 0.05, 0)),
      h('div', { class: 'hint' }, 'Период: шипы полпериода спрятаны, полпериода выдвинуты (0 — выдвинуты всегда). Фаза сдвигает цикл — у соседних шипов можно сделать «волну».'),
    );
  } else if (t === 'lifts') {
    box.append(
      row(...field('X центра', 0), ...field('Y верха', 1)),
      row(...field('Ширина, м', 2, 0.5, 1), ...field('Время, с', 5, 0.25, 0.3)),
      row(...field('Сдвиг X', 3), ...field('Сдвиг Y', 4)),
      row(...field('Пауза, с', 6, 0.1, 0), ...field('Фаза 0..1', 7, 0.05, 0)),
      h('div', { class: 'hint' }, 'Ездит сама туда-обратно за «Время» секунд и стоит «Паузу» на каждом конце. Фаза сдвигает цикл (0 — стартует снизу/с начала пути, 0.5 — с конца). Платформа всегда доезжает до своей точки: если она опустится на машину, машину раздавит. Фиолетовый кружок — точка назначения, его можно тянуть.'),
    );
  } else if (t === 'slime') {
    if (!(a[3] > 0)) a[3] = 1;
    box.append(
      row(...field('X центра', 0), ...field('Ширина', 3, 0.25, 0.25)),
      row(...field('Низ', 1), ...field('Верх', 2)),
      row(
        btn('Стенкой', () => { snapshot(); a[3] = 1; a[2] = a[1] + 2.5; render(); }),
        btn('Плитой', () => { snapshot(); a[3] = 3; a[2] = a[1] + 0.5; render(); }),
      ),
      h('div', { class: 'hint' }, 'Мягкий блок: об него ничего не ломается. Стенкой — смягчает удар; плитой на земле — мягкое приземление, под потолком — нубик не разобьёт голову. Кружки: верх, низ и ширина.'),
    );
  } else if (t === 'pistons') {
    const dirSel = h('select', null, ...P_NAMES.map((n, k) => h('option', { value: String(k) }, n)));
    dirSel.value = String(a[2] & 3);
    dirSel.addEventListener('change', () => { snapshot(); a[2] = +dirSel.value; changed(); render(); });
    box.append(
      row(...field('X лица', 0), ...field('Y лица', 1)),
      row(lbl('Смотрит'), dirSel, btn('⟳', () => { snapshot(); a[2] = ((a[2] & 3) + 1) % 4; render(); })),
      h('div', { class: 'hint' }, 'Блок 1×1 м, (X, Y) — центр лица (досок), сам блок позади. Когда машина касается лица, поршень выдвигается на 0.5 с: вбок — разворачивает машину назад (она должна стоять не ниже низа блока — лифт довозит её), вверх — подкидывает (поставьте лицом вровень с землёй), вниз — толкает вниз. Удар о поршень на скорости ломает детали, как о стену.'),
    );
  } else {
    box.append(
      row(...field('От X', 0), ...field('До X', 1)),
      h('div', { class: 'hint' }, t === 'mud' ? 'Колёса вязнут: машина сильно замедляется, нужна тяга побольше.'
        : 'Колёса скользят: машина плохо разгоняется (вентиляторы вперёд толкают слабее) и почти не тормозит.'),
    );
  }
  box.append(row(btn('✕ Удалить', () => { snapshot(); L[t]!.splice(sel!.i, 1); sel = null; render(); }, 'del')));
  propsEl.append(box);
}

function render() {
  const n = data.levels.length;
  panel.replaceChildren(
    h('h1', null, 'Редактор уровней'),
    row(h('a', { href: './editor.html' }, '→ редактор деталей'), h('a', { href: './index.html', target: '_blank' }, '→ игра')),
    row(btn('💾 Сохранить (Ctrl+S)', save, 'save'), btn('↶ Отменить', undo), btn('▶ Играть', async () => { if (await save()) open(`./index.html?level=${cur + 1}`, '_blank'); }, 'play')),
    row(statusEl),
    h('div', { class: 'sec' }, `Уровни (${n})`),
    h('div', { class: 'hint' }, 'Уровни из этого списка идут в игре первыми; дальше игра генерирует уровни сама.'),
    row(...data.levels.map((_, i) => btn(String(i + 1), () => { cur = i; sel = null; render(); fit(); }, 'lv' + (i === cur ? ' on' : '')))),
    row(
      btn('+ Новый', () => { snapshot(); data.levels.push(emptyLevel()); cur = data.levels.length - 1; render(); fit(); }),
      n ? btn('⧉ Копия', () => { snapshot(); data.levels.splice(cur + 1, 0, JSON.parse(JSON.stringify(level()))); cur++; render(); }) : '',
      n ? btn('←', () => { if (!cur) return; snapshot(); const a = data.levels; [a[cur - 1], a[cur]] = [a[cur], a[cur - 1]]; cur--; render(); }) : '',
      n ? btn('→', () => { const a = data.levels; if (cur >= a.length - 1) return; snapshot(); [a[cur + 1], a[cur]] = [a[cur], a[cur + 1]]; cur++; render(); }) : '',
      n ? btn('✕ Удалить', () => { if (!confirm(`Удалить уровень ${cur + 1}?`)) return; snapshot(); data.levels.splice(cur, 1); cur = Math.max(0, cur - 1); sel = null; render(); fit(); }, 'del') : '',
    ),
  );
  const genN = numIn(cur + 1, 1);
  panel.append(row(btn('Взять из генератора, уровень №', () => {
    const k = Math.max(1, Math.round(+genN.value || 1));
    snapshot();
    const L = normalize(generateLevel(k - 1));
    if (!data.levels.length) data.levels.push(L); else data.levels[cur] = L;
    sel = null;
    render(); fit();
  }), genN));
  if (!level()) { panel.append(h('div', { class: 'hint' }, 'Нет уровней — нажмите «+ Новый» или «Взять из генератора».')); draw(); status(); return; }

  const TOOLS: [Mode, string][] = [
    ['points', 'Точки'], ['coins', 'Монеты'], ['gap', 'Пропасть'], ['join', 'Соединить'],
    ['floor', '▭ Этаж'], ['mud', '🟫 Грязь'], ['ice', '🧊 Лёд'], ['spikes', '▲ Шипы'], ['lifts', '⬍ Платформа'], ['slime', '🟩 Слизь'], ['pistons', '⏏ Поршень'],
  ];
  panel.append(...garageSection());
  panel.append(
    h('div', { class: 'sec' }, 'Инструмент'),
    row(...TOOLS.map(([m, t]) => btn(t, () => { mode = m; render(); }, m === mode ? 'on' : ''))),
    h('div', { class: 'hint' }, {
      points: 'Тяните точки земли и этажей. Клик по линии — новая точка. Правый клик по точке — удалить. Тяните пустое место — сдвиг вида, колесо мыши — масштаб.',
      coins: 'Клик — поставить монету, тяните монету — переместить, правый клик — удалить.',
      gap: 'Клик по участку земли или этажа — убрать его: получится пропасть (этаж из одного участка исчезнет).',
      join: 'Клик по крайней точке куска — соединить его с ближайшим куском того же типа (убрать пропасть).',
      floor: `Этаж — висящая плита толщиной ${FLOOR_T} м (под ней можно ездить). Нажмите на пустом месте и тяните — новый этаж. Точки и линии этажей редактируются как у земли. Подняться на этаж: лифт или горка; развернуться: слизь с разворотом.`,
      mud: 'Нажмите на землю/этаж и тяните вдоль — полоса грязи (песок душ). Концы можно двигать.',
      ice: 'Нажмите на землю/этаж и тяните вдоль — полоса льда: машина плохо разгоняется и долго катится. Концы можно двигать.',
      spikes: 'Клик по земле — выдвижные шипы. Любая деталь (и голова нубика), задевшая выдвинутые шипы, отваливается.',
      lifts: 'Клик — левитирующая платформа. Тяните платформу или её точку назначения (кружок). Свойства — ниже.',
      slime: 'Клик по земле — блок слизи (мягкая стенка). Свойства: стенкой или плитой, ширина. Тяните блок или кружки верха, низа и ширины.',
      pistons: 'Клик по земле — поршень лицом влево (разворачивает машину, едущую вправо). Направление — в свойствах (⟳ — повернуть).',
    }[mode]),
    row(h('label', null, (() => { const c = h('input', { type: 'checkbox', checked: snapOn }); c.addEventListener('change', () => (snapOn = c.checked)); return c; })(), ' привязка к сетке 0.25 м (Shift — без привязки)')),
    row(coordsEl),
    propsEl,
  );
  props();

  // generated features inserted before the finish
  const sel2 = h('select', null, ...FEATURES.map(([id, t]) => h('option', { value: id }, t)));
  const len = numIn(16), hgt = numIn(1.2, 0.1), cnt = numIn(3, 1), slope = numIn(0.45, 0.05);
  panel.append(
    h('div', { class: 'sec' }, 'Вставить перед финишем'),
    row(sel2),
    row(lbl('Длина, м'), len, lbl('Высота, м'), hgt),
    row(lbl('Кол-во'), cnt, lbl('Макс. уклон'), slope),
    h('div', { class: 'hint' }, 'Кол-во: холмов / ступеней / кочек / этажей башни (нечётное), у пропасти — её ширина в метрах, у шипов — период в секундах. У башни длина — длина этажа, высота — расстояние между этажами (от 4 м). Макс. уклон ограничивает крутизну (0.45 ≈ 24°).'),
    row(btn('Вставить', () => {
      const f = FEATURES.find((x) => x[0] === sel2.value)!;
      insertFeature((b) => f[2](b, +len.value || 10, +hgt.value || 1, Math.max(0, +cnt.value || 1)), +slope.value || 0.45);
    })),
    h('div', { class: 'sec' }, 'Проверка'),
    infoEl,
    h('div', { class: 'hint' }, 'Цвет линии: зелёный — легко, оранжевый — круто, красный — очень круто или стенка вверх, фиолетовый — стенка с лифтом.'),
  );
  status();
  validate();
  draw();
}
/** garage grid size and the frame blocks of the level */
function garageSection(): HTMLElement[] {
  const L = level(), [w, hgt] = gridOf(L), auto = blocksForLevel(cur);
  const field = (v: number | string, min: number, max: number, set: (v: number | undefined) => void, placeholder = '') => {
    const el = h('input', { type: 'number', step: '1', min: String(min), max: String(max), value: String(v), placeholder });
    el.addEventListener('change', () => {
      snapshot();
      set(el.value === '' ? undefined : Math.max(min, Math.min(max, Math.round(+el.value))));
      render();
    });
    return el;
  };
  const setGrid = (i: number, v: number | undefined) => {
    const g = gridOf(L).slice();
    g[i] = v ?? DEFAULT_GRID[i];
    L.grid = g[0] === DEFAULT_GRID[0] && g[1] === DEFAULT_GRID[1] ? undefined : g;
  };
  const cells = w * hgt, maxBlocks = cells - 3;
  return [
    h('div', { class: 'sec' }, 'Гараж (постройка)'),
    row(
      lbl('Сетка'), field(w, GRID_MIN[0], GRID_MAX[0], (v) => setGrid(0, v)), '×', field(hgt, GRID_MIN[1], GRID_MAX[1], (v) => setGrid(1, v)),
    ),
    row(lbl('Блоков рамы'), field(L.blocks ?? '', 1, maxBlocks, (v) => { L.blocks = v; }, String(auto)),
      h('span', { class: 'st' }, L.blocks === undefined ? `авто: ${auto}` : '')),
    h('div', { class: 'hint' },
      `Ширина ${GRID_MIN[0]}–${GRID_MAX[0]}, высота ${GRID_MIN[1]}–${GRID_MAX[1]} клеток (по умолчанию ${DEFAULT_GRID.join('×')}). `,
      `Блоки рамы ставятся в гараже сами; пусто — по номеру уровня (сейчас ${auto}), максимум ${maxBlocks}. `,
      'Сиденье с нубиком занимает столбец из 2 клеток. Шире сетка — шире ровная площадка под гаражом.'),
  ];
}

/** show the whole level */
function fit() {
  const L = level();
  if (!L) return;
  const xs: number[] = [], ys: number[] = [];
  for (const p of [...L.pieces, ...L.floors!]) for (let i = 0; i < p.length; i += 2) { xs.push(p[i]); ys.push(p[i + 1]); }
  for (const l of L.lifts!) { xs.push(l[0], l[0] + l[3]); ys.push(l[1], l[1] + l[4]); }
  for (const s of L.slime!) ys.push(s[2]);
  for (const p of L.pistons!) ys.push(p[1] + 1);
  ys.push(L.finishY! + 5);
  const x0 = Math.min(...xs), x1 = Math.min(Math.max(...xs), L.finishX + 10), y0 = Math.min(...ys), y1 = Math.max(...ys) + 2;
  view.s = Math.max(6, Math.min(60, (W() - PANEL - 60) / (x1 - x0), (H() - 80) / (y1 - y0)));
  view.x = (x0 + x1) / 2;
  view.y = (y0 + y1) / 2;
  draw();
}

addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { e.preventDefault(); save(); }
  else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); undo(); }
  else if (e.code === 'KeyF' && !typing) fit();
  else if ((e.code === 'Delete' || e.code === 'Backspace') && !typing && sel) { snapshot(); level()[sel.t]!.splice(sel.i, 1); sel = null; render(); }
});
addEventListener('beforeunload', (e) => { if (stringify() !== saved) e.preventDefault(); });

render();
resize();
fit();
// debug handles (Object.assign would copy the getters' current values)
Object.defineProperties(window, { data: { get: () => data }, sel: { get: () => sel } });
Object.assign(window, { save, render, view, sx, sy, setMode: (m: Mode) => { mode = m; render(); } });
