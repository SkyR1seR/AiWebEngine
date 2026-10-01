// Garage: car grid (3D, orthographic) + inventory grid (DOM), buying wheels/fans, drag & drop and merging.
import { Node, Mesh, box, unlit, mergeGeometries, m4compose, quat, type Game, type Texture } from 'aiwebengine';
import { presets, burst, punchScale } from 'aiwebengine/fx';
import { h, u, type UI } from 'aiwebengine/ui';
import { sound } from 'aiwebengine/audio';
import { buildCarVisual, type CarVisual } from './car';
import { iconURL } from './models';
import { px } from './fx';
import {
  GW, GH, CELL, INV, EMPTY, WHEEL, FAN, SEAT, kindOf, lvlOf, make, isItem, canMerge, idx, cellX, cellY, connected, validDesign,
  fitBlocks, blocksForLevel, startDesign, partMass, wheelRadius, fanThrust, TIERS, setGrid, regrid, DEFAULT_GRID, type Design,
} from './parts';

export interface Save {
  v: 2;
  coins: number;
  /** highest level reached (0-based) */
  maxLevel: number;
  /** level being played (0-based) */
  level: number;
  design: Design;
  /** grid size the design was made on [columns, rows] */
  grid: number[];
  inv: number[];
  buys: { wheel: number; fan: number };
  skins: string[];
  skin: string;
  /** tutorial done */
  tut: boolean;
  /** sound switched off */
  muted?: boolean;
}

export function newSave(): Save {
  const inv = new Array(INV).fill(EMPTY);
  inv[0] = make(WHEEL); inv[1] = make(WHEEL); inv[2] = make(FAN);
  return {
    v: 2, coins: 20, maxLevel: 0, level: 0, design: startDesign(0), grid: [GW, GH], inv, buys: { wheel: 0, fan: 0 }, skins: ['noob'], skin: 'noob', tut: false,
  };
}
/** Validate a loaded save; anything from an older version starts fresh. */
export function readSave(d: Partial<Save>): Save {
  const s = newSave();
  if (d.v !== 2) return s;
  if (typeof d.coins === 'number') s.coins = d.coins;
  if (typeof d.maxLevel === 'number') s.maxLevel = d.maxLevel;
  if (typeof d.level === 'number') s.level = Math.min(d.level, s.maxLevel);
  // the design is checked against its own grid when a level is entered (Garage.fitLevel)
  const g = Array.isArray(d.grid) && d.grid.length === 2 ? d.grid : DEFAULT_GRID;
  if (Array.isArray(d.design) && d.design.length === g[0] * g[1]) { s.design = d.design; s.grid = g.slice(); }
  if (Array.isArray(d.inv) && d.inv.length === INV) s.inv = d.inv;
  if (d.buys) s.buys = { ...s.buys, ...d.buys };
  if (Array.isArray(d.skins)) s.skins = d.skins;
  if (typeof d.skin === 'string') s.skin = d.skin;
  s.tut = !!d.tut;
  s.muted = !!d.muted;
  return s;
}

export const price = (kind: number, bought: number) => Math.round((kind === WHEEL ? 10 : 15) * Math.pow(1.3, bought));

export interface GarageTexts {
  inventory: string; wheel: string; fan: string; full: string; noMoney: string; frameStays: string; noRoom: string; merged: string;
  split: string; splitDone: string; splitLow: string; splitFull: string;
  ru: boolean; tut: string; level: string; radius: string; thrust: string; up: string; fwd: string; mass: string; wheels: string; fans: string;
}

/** a place a part can be dragged from / to; 'split' = the un-merge slot */
type Loc = { at: 'grid' | 'inv' | 'split'; i: number };

export class Garage {
  root: Node;
  preview: CarVisual | null = null;
  panel: HTMLElement;
  private _hover: Mesh;
  private _hoverMat = unlit(0xffe14d, { opacity: 0.35, depthWrite: false });
  private _slots: HTMLElement[] = [];
  private _buy: HTMLButtonElement[] = [];
  private _drag: { v: number; src: Loc; ghost: HTMLImageElement; sx: number; sy: number; moved: boolean } | null = null;
  private _hand: HTMLElement;
  private _t = 0;
  private _split: HTMLElement;
  private _gridMesh: Node | null = null;
  private _gridSize = '';

  constructor(
    private game: Game, private ui: UI, private save: () => Save, private persist: () => void, private skin: () => Texture,
    private T: GarageTexts, private active: () => boolean, private onCoins: () => void, private G: number[],
  ) {
    const root = (this.root = game.scene.add(new Node('garage')));
    root.setPosition(G[0], G[1], G[2]);
    this._buildGrid();
    this._hover = root.add(new Mesh(box(CELL * 0.98, CELL * 0.98, 1.0), this._hoverMat));
    this._hover.castShadow = false;
    this._hover.visible = false;

    // inventory panel
    document.head.append(h('style', null, `
.inv-wrap{pointer-events:auto;display:flex;flex-direction:column;gap:${u(10)};background:rgba(18,24,44,.8);padding:${u(12)};border-radius:${u(18)};touch-action:none}
.inv-title{font-weight:900;font-size:${u(20)};text-align:center}
.inv{display:grid;grid-template-columns:repeat(3,${u(66)});gap:${u(6)}}
.inv.wide{grid-template-columns:repeat(6,${u(66)})}
.slot{width:${u(66)};height:${u(66)};border-radius:${u(12)};background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 ${u(2)} rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;touch-action:none;cursor:grab}
.slot img{width:88%;height:88%;image-rendering:pixelated;pointer-events:none}
.slot.lifted img{opacity:.25}
.slot.pop{animation:pop .35s ease-out}
@keyframes pop{0%{transform:scale(1)}40%{transform:scale(1.25)}100%{transform:scale(1)}}
.buy-row{display:flex;flex-direction:column;gap:${u(6)}}
.inv.wide~.buy-row{flex-direction:row}
.buy{flex:1;display:flex;align-items:center;justify-content:center;gap:${u(6)};padding:${u(6)} ${u(10)};font-size:${u(18)}}
.buy img{width:${u(34)};height:${u(34)}}
.buy.off{filter:grayscale(.8) brightness(.8)}
.slot.split{background:rgba(255,190,60,.16);box-shadow:inset 0 0 0 ${u(2)} rgba(255,200,80,.6);flex-direction:column;font-size:${u(12)};font-weight:800;gap:${u(2)};cursor:default;text-align:center;line-height:1.05}
.slot.split b{font-size:${u(26)};line-height:1}
.slot.split.hot{background:rgba(255,200,80,.45)}
.ghost{position:absolute;left:0;top:0;width:${u(80)};height:${u(80)};pointer-events:none;z-index:50;transform:translate(-50%,-50%) scale(1.1);filter:drop-shadow(0 ${u(6)} ${u(6)} rgba(0,0,0,.45))}
.hand{position:absolute;left:0;top:0;font-size:${u(56)};pointer-events:none;z-index:40;animation:tut 1.8s ease-in-out infinite}
@keyframes tut{0%{transform:translate(var(--x0),var(--y0));opacity:0}15%{opacity:1}70%{transform:translate(var(--x1),var(--y1));opacity:1}100%{transform:translate(var(--x1),var(--y1));opacity:0}}
`));
    const inv = h('div', { class: 'inv' });
    for (let i = 0; i < INV; i++) {
      const s = h('div', { class: 'slot' });
      s.dataset.slot = String(i);
      s.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (this.save().inv[i]) this._begin({ at: 'inv', i }, e);
      });
      this._slots.push(s);
      inv.append(s);
    }
    // un-merge slot: drop a level-N wheel/fan here to get two level-(N-1) ones in the inventory
    this._split = h('div', { class: 'slot split', title: T.split }, h('b', null, '✂'));
    this._split.dataset.split = '1';
    const buyRow = h('div', { class: 'buy-row' });
    for (const kind of [WHEEL, FAN]) {
      const b = h('button', { class: 'ui-btn green buy' });
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => { e.stopPropagation(); this._purchase(kind); });
      this._buy.push(b);
      buyRow.append(b);
    }
    buyRow.prepend(this._split);
    this.panel = h('div', { class: 'inv-wrap' }, h('div', { class: 'inv-title' }, T.inventory), inv, buyRow);
    this._hand = h('div', { class: 'hand' }, '👆');
    this._hand.style.display = 'none';
    ui.root.append(this._hand);

    // drag from the car grid
    const cv = game.canvas;
    cv.addEventListener('pointerdown', (e) => {
      if (!this.active() || this._drag) return;
      const cell = this._cellAtClient(e.clientX, e.clientY);
      if (cell >= 0 && this.save().design[cell]) this._begin({ at: 'grid', i: cell }, e);
    });
    addEventListener('pointermove', (e) => this._move(e));
    addEventListener('pointerup', (e) => this._end(e));
    addEventListener('pointercancel', () => this._cancel());
  }

  /** Portrait: inventory under the car, 6 columns. */
  layout(portrait: boolean) {
    this.ui.add(this.panel, portrait ? 'bottom' : 'bottom-left');
    this.panel.querySelector('.inv')!.classList.toggle('wide', portrait);
  }

  setVisible(on: boolean) {
    this.root.visible = on;
    this.panel.style.display = on ? '' : 'none';
    if (!on) { this._cancel(); this._hand.style.display = 'none'; }
  }

  /** Car grid lines (in front of the parts, so cells stay visible in the side view) + dark back panel, for GW x GH. */
  private _buildGrid() {
    const key = GW + 'x' + GH;
    if (key === this._gridSize) return;
    this._gridSize = key;
    this._gridMesh?.destroy();
    const node = (this._gridMesh = this.root.add(new Node('grid')));
    const lines = [], mats = [];
    for (let c = 0; c <= GW; c++) {
      const mm = new Float32Array(16);
      m4compose(mm, [(c - GW / 2) * CELL, (GH * CELL) / 2, 0], quat(), [1, 1, 1]);
      lines.push(box(0.025, GH * CELL + 0.025, 0.025)); mats.push(mm);
    }
    for (let r = 0; r <= GH; r++) {
      const mm = new Float32Array(16);
      m4compose(mm, [0, r * CELL, 0], quat(), [1, 1, 1]);
      lines.push(box(GW * CELL + 0.025, 0.025, 0.025)); mats.push(mm);
    }
    const grid = node.add(new Mesh(mergeGeometries(lines, mats), unlit(0xffffff, { opacity: 0.45 })));
    grid.position[2] = 0.8;
    grid.castShadow = false;
    const back = node.add(new Mesh(box(GW * CELL, GH * CELL, 0.02), unlit(0x16305a, { opacity: 0.55 })));
    back.setPosition(0, (GH * CELL) / 2, -0.55);
    back.castShadow = false;
  }

  /**
   * Enter a level: switch to its grid size (the car keeps its layout, what doesn't fit comes off), fit the frame to its
   * block count; wheels/fans that come off or hang loose go back to the inventory (if there's room).
   */
  fitLevel(level: number, opts: { grid?: number[]; blocks?: number } = {}) {
    const s = this.save();
    const g = opts.grid ?? DEFAULT_GRID;
    setGrid(g[0], g[1]);
    this._buildGrid();
    const toInv = (v: number) => { const slot = s.inv.indexOf(EMPTY); if (slot >= 0) s.inv[slot] = v; };
    const moved = regrid(s.design, s.grid[0], s.grid[1]);
    let d = moved.d;
    moved.items.forEach(toInv);
    if (!validDesign(d)) { d.forEach((v) => isItem(v) && toInv(v)); d = startDesign(level); }
    s.design = d;
    s.grid = [GW, GH];
    fitBlocks(d, opts.blocks ?? blocksForLevel(level));
    const keep = connected(d);
    d.forEach((v, i) => {
      if (!v || keep.has(i) || !isItem(v)) return;
      const slot = s.inv.indexOf(EMPTY);
      if (slot < 0) return;
      s.inv[slot] = v;
      d[i] = EMPTY;
    });
    this.persist();
    this.refresh();
  }

  /** Rebuild the preview car and the inventory UI. */
  refresh() {
    const s = this.save();
    this.preview?.root.destroy();
    this.preview = buildCarVisual(s.design, this.skin());
    this.root.add(this.preview.root);
    const keep = connected(s.design);
    for (const [i, n] of this.preview.parts) {
      if (keep.has(i)) continue;
      n.traverse((m) => { if (m instanceof Mesh) m.flash.set([1, 0.1, 0.1, 0.55]); });
    }
    this._slots.forEach((el, i) => {
      const v = s.inv[i];
      el.replaceChildren(...(v ? [h('img', { src: iconURL(v), alt: '' })] : []));
    });
    [WHEEL, FAN].forEach((kind, k) => {
      const cost = price(kind, kind === WHEEL ? s.buys.wheel : s.buys.fan);
      const b = this._buy[k];
      b.replaceChildren(h('img', { src: iconURL(make(kind)), alt: '' }), h('span', null, `${kind === WHEEL ? this.T.wheel : this.T.fan} `, h('span', { class: 'gi' }, String(cost))));
      b.classList.toggle('off', s.coins < cost);
    });
  }

  /** mass / wheels / fans summary of the connected car */
  info() {
    const d = this.save().design, keep = connected(d);
    let mass = 45, wh = 0, fn = 0;
    for (const i of keep) { mass += partMass(d[i]); if (kindOf(d[i]) === WHEEL) wh++; if (kindOf(d[i]) === FAN) fn++; }
    const T = this.T;
    return `${T.mass} ${mass} · ${T.wheels} ${wh} · ${T.fans} ${fn}`;
  }

  update(dt: number) {
    this._t += dt;
    if (!this.preview) return;
    this.preview.noob.head.setRotation(Math.sin(this._t * 0.9) * 0.15, Math.sin(this._t * 0.6) * 0.35, 0);
    // tutorial: a hand drags from the first inventory item to a free cell under the frame
    const s = this.save(), showHand = !s.tut && this.active() && !this._drag && s.inv.some((v) => v);
    this._hand.style.display = showHand ? '' : 'none';
    if (showHand) {
      const from = this._slots[s.inv.findIndex((v) => v)].getBoundingClientRect();
      const target = this._suggestCell();
      if (target >= 0) {
        const p = this.game.camera.worldToScreen([this.G[0] + cellX(target % GW), this.G[1] + cellY(Math.floor(target / GW)), 0], this.game.screen.width, this.game.screen.height);
        const r = this.game.canvas.getBoundingClientRect();
        this._hand.style.setProperty('--x0', `${from.left + from.width / 2}px`);
        this._hand.style.setProperty('--y0', `${from.top + from.height / 2}px`);
        this._hand.style.setProperty('--x1', `${r.left + p[0]}px`);
        this._hand.style.setProperty('--y1', `${r.top + p[1]}px`);
      }
    }
  }

  /** empty cell right under the frame, for the tutorial */
  private _suggestCell() {
    const d = this.save().design;
    for (let r = 0; r < GH - 1; r++) for (let c = 0; c < GW; c++) {
      const i = idx(c, r), up = d[idx(c, r + 1)];
      if (!d[i] && up && !isItem(up)) return i;
    }
    return -1;
  }

  // ---------------------------------------------------------------- buying

  private _purchase(kind: number) {
    const s = this.save(), key = kind === WHEEL ? 'wheel' : 'fan', cost = price(kind, s.buys[key]);
    const slot = s.inv.indexOf(EMPTY);
    if (slot < 0) { this.ui.toast(this.T.full); sound.sfx('hit', 0.4); return; }
    if (s.coins < cost) { this.ui.toast(this.T.noMoney); sound.sfx('hit', 0.4); return; }
    s.coins -= cost;
    s.buys[key]++;
    s.inv[slot] = make(kind);
    sound.sfx('coin', 0.6);
    this.persist();
    this.refresh();
    this.onCoins();
    this._pop(slot);
  }

  private _pop(slot: number) {
    const el = this._slots[slot];
    el.classList.remove('pop');
    // restart the animation on the next frame (a bare `el.offsetWidth` reflow is dropped by the build's pure_getters)
    requestAnimationFrame(() => el.classList.add('pop'));
  }

  // ---------------------------------------------------------------- drag & drop

  private _cellAtClient(x: number, y: number) {
    const r = this.game.canvas.getBoundingClientRect();
    const cam = this.game.camera, ray = cam.screenRay(x - r.left, y - r.top, this.game.screen.width, this.game.screen.height);
    if (Math.abs(ray.dir[2]) < 1e-4) return -1;
    const t = (this.G[2] - ray.origin[2]) / ray.dir[2];
    const px = ray.origin[0] + ray.dir[0] * t - this.G[0], py = ray.origin[1] + ray.dir[1] * t - this.G[1];
    const c = Math.floor(px / CELL + GW / 2), rr = Math.floor(py / CELL);
    return c >= 0 && rr >= 0 && c < GW && rr < GH ? idx(c, rr) : -1;
  }

  private _begin(src: Loc, e: PointerEvent) {
    const s = this.save(), v = src.at === 'grid' ? s.design[src.i] : s.inv[src.i];
    const ghost = h('img', { class: 'ghost', src: iconURL(v), alt: '' });
    ghost.style.display = 'none';
    this.ui.root.append(ghost);
    this._drag = { v, src, ghost, sx: e.clientX, sy: e.clientY, moved: false };
    this._move(e);
  }

  private _lift(on: boolean) {
    const d = this._drag!;
    if (d.src.at === 'grid') { const n = this.preview?.parts.get(d.src.i); if (n) n.visible = !on; }
    else this._slots[d.src.i].classList.toggle('lifted', on);
  }

  private _move(e: PointerEvent) {
    const d = this._drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6) {
      d.moved = true;
      d.ghost.style.display = '';
      this._lift(true);
    }
    if (!d.moved) return;
    d.ghost.style.left = e.clientX + 'px';
    d.ghost.style.top = e.clientY + 'px';
    // highlight the target cell: yellow = ok, green = merge, red = not allowed
    const dst = this._target(e);
    this._split.classList.toggle('hot', dst?.at === 'split');
    this._hover.visible = dst?.at === 'grid';
    if (dst?.at === 'grid') {
      this._hover.setPosition(cellX(dst.i % GW), cellY(Math.floor(dst.i / GW)), 0);
      const r = this._apply(d.src, dst, false);
      this._hoverMat.setColor(typeof r === 'string' && r !== 'merge' ? 0xff4040 : r === 'merge' ? 0x5dff6a : 0xffe14d);
    }
  }

  private _target(e: PointerEvent): Loc | null {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const slot = (el as HTMLElement | null)?.closest?.('[data-slot]') as HTMLElement | null;
    if (slot) return { at: 'inv', i: +slot.dataset.slot! };
    if ((el as HTMLElement | null)?.closest?.('[data-split]')) return { at: 'split', i: 0 };
    if (el !== this.game.canvas) return null;
    const cell = this._cellAtClient(e.clientX, e.clientY);
    return cell >= 0 ? { at: 'grid', i: cell } : null;
  }

  private _end(e: PointerEvent) {
    const d = this._drag;
    if (!d) return;
    this._cancel();
    if (!d.moved) { this._describe(d.v); return; }
    const dst = this._target(e);
    if (!dst) return;
    if (dst.at === 'split') { this._unmerge(d.src); return; }
    const r = this._apply(d.src, dst, true);
    if (typeof r === 'string' && r !== 'merge') {
      if (r) { this.ui.toast(r); sound.sfx('hit', 0.35); }
      return;
    }
    const s = this.save();
    if (dst.at === 'grid' && !s.tut) s.tut = true;
    this.persist();
    this.refresh();
    this.onCoins();
    if (r === 'merge') {
      const v = dst.at === 'grid' ? s.design[dst.i] : s.inv[dst.i];
      sound.sfx('powerup', 0.7);
      this.ui.toast(`${this.T.merged} ${lvlOf(v)} — ${TIERS[lvlOf(v) - 1][this.T.ru ? 1 : 2]}`, 1.2);
      if (dst.at === 'inv') this._pop(dst.i);
      else {
        const n = this.preview!.parts.get(dst.i);
        if (n) punchScale(n, 0.35, 0.35);
        burst(this.root, px(presets.magic()), 24, [cellX(dst.i % GW), cellY(Math.floor(dst.i / GW)), 0.5]);
      }
    } else sound.sfx('click', 0.5);
  }

  private _cancel() {
    const d = this._drag;
    if (!d) return;
    if (d.moved) this._lift(false);
    d.ghost.remove();
    this._hover.visible = false;
    this._split.classList.remove('hot');
    this._drag = null;
  }

  /**
   * Move / merge / swap `src` onto `dst`. Returns 'merge', true (moved/swapped), '' (no-op) or a reason why not.
   * Only writes to the save when `commit`.
   */
  private _apply(src: Loc, dst: Loc, commit: boolean): string | true {
    if (src.at === dst.at && src.i === dst.i) return '';
    const s = this.save(), d = s.design.slice(), inv = s.inv.slice();
    const get = (l: Loc) => (l.at === 'grid' ? d[l.i] : inv[l.i]);
    const set = (l: Loc, v: number) => { if (l.at === 'grid') d[l.i] = v; else inv[l.i] = v; };
    const a = get(src), b = get(dst);
    let res: string | true = true;
    if (canMerge(a, b)) { set(dst, make(kindOf(a), lvlOf(a) + 1)); set(src, EMPTY); res = 'merge'; }
    else {
      if ((dst.at === 'inv' && !isItem(a)) || (src.at === 'inv' && b && !isItem(b))) return this.T.frameStays;
      set(dst, a);
      set(src, b);
    }
    if (!validDesign(d)) return this.T.noRoom;
    if (commit) { s.design = d; s.inv = inv; }
    return res;
  }

  /** reverse merge: a level-N wheel/fan becomes two level-(N-1) ones in the inventory; needs the room for both */
  private _unmerge(src: Loc) {
    const s = this.save(), v = src.at === 'grid' ? s.design[src.i] : s.inv[src.i], T = this.T;
    const fail = (msg: string) => { this.ui.toast(msg); sound.sfx('hit', 0.35); };
    if (!isItem(v)) return fail(T.frameStays);
    if (lvlOf(v) < 2) return fail(T.splitLow);
    const inv = s.inv.slice();
    if (src.at === 'inv') inv[src.i] = EMPTY;
    const free = inv.map((x, i) => (x ? -1 : i)).filter((i) => i >= 0);
    if (free.length < 2) return fail(T.splitFull);
    const half = make(kindOf(v), lvlOf(v) - 1);
    // the freed slot first, so a split from the inventory stays where it was
    const slots = src.at === 'inv' ? [src.i, ...free.filter((i) => i !== src.i)] : free;
    inv[slots[0]] = inv[slots[1]] = half;
    if (src.at === 'grid') s.design[src.i] = EMPTY;
    s.inv = inv;
    this.persist();
    this.refresh();
    this._pop(slots[0]);
    this._pop(slots[1]);
    sound.sfx('powerup', 0.5);
    this.ui.toast(`${T.splitDone} ${lvlOf(half)}`, 1.2);
  }

  /** tap on a part: show its stats */
  private _describe(v: number) {
    const k = kindOf(v), l = lvlOf(v), T = this.T;
    if (k === WHEEL) this.ui.toast(`${T.wheel} ${l}: ${T.radius} ${Math.round(wheelRadius(l) * 200)} см`, 1.4);
    else if (k === FAN) this.ui.toast(`${T.fan} ${l}: ${T.thrust} ${Math.round(fanThrust(l))}`, 1.4);
    else if (k === SEAT) this.ui.toast(T.tut, 1.4);
  }
}
