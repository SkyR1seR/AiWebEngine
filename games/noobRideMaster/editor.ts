// Part editor (dev tool, not exported): edit the shapes and level colors of the car parts, save to parts.json.
// Open http://localhost:5173/games/noobRideMaster/editor.html while `npm run dev` runs. The game reloads by itself on save.
import { createGame, Node, Mesh, DirectionalLight, box, cylinder, sphere, unlit, lambert, mergeGeometries, m4compose, quat, type Material } from 'aiwebengine';
import { OrbitControls } from 'aiwebengine/extras';
import { h } from 'aiwebengine/ui';
import { createNoob, sit } from './noob';
import { skinList, skinTexture } from './skins';
import { setModels, buildPart, spinTo, shapesFor, modelLevel, noobPose, NOOB_POSE, type Models, type ModelKey, type Shape, type ShapeType, type TexName, type Group, type BuiltPart, type Axis } from './models';
import { make, BLOCK, SEAT, WHEEL, FAN, CELL, MAX_LVL, TIERS, defaultMass, defaultStrength, type Attach } from './parts';

const FILE = 'games/noobRideMaster/parts.json';
const KINDS: [ModelKey, number, string][] = [['block', BLOCK, 'Блок'], ['seat', SEAT, 'Сиденье'], ['wheel', WHEEL, 'Колесо'], ['fan', FAN, 'Вентилятор']];

const game = await createGame({ antialias: true });
const { scene, camera } = game;
scene.setSky({ top: 0x3d4a66, horizon: 0x8fa3c2, bottom: 0x2a2f3a });
scene.setAmbient(0xdfeeff, 0x6a6050, 0.7);
scene.add(new DirectionalLight({ direction: [-0.4, -1, -0.6], intensity: 1.1, shadow: { extent: 3, size: 1024 } }));
camera.near = 0.02;
const orbit = new OrbitControls(game, { target: [0, 0, 0], distance: 2.4, yaw: 0.55, pitch: 0.35, minDistance: 0.5, maxDistance: 12 });

let models: Models = await (await fetch('/' + FILE, { cache: 'no-store' })).json();
setModels(models);
let saved = JSON.stringify(models);

// ---------------------------------------------------------------- state & helpers
let kind: ModelKey = 'fan';
let lvl = 1;
/** side of the fan the frame is on (preview) */
let attach: Attach = 'left';
let spinOn = true, sideView = false, showCell = true, showNeighbor = true, showNoob = true;
let sel = -1;
const history: string[] = [];
let built: BuiltPart | null = null;
const holder = scene.add(new Node('part'));
// the noob sitting on the seat (seat preview), posed from the seat model
const noob = createNoob(await skinTexture(skinList(true)[0]));
sit(noob);
scene.add(noob.root);
function poseNoob() {
  const { pos, rot } = noobPose(), d = Math.PI / 180;
  noob.root.visible = kind === 'seat' && showNoob;
  noob.root.setPosition(pos[0], pos[1], pos[2]).setRotation(rot[0] * d, rot[1] * d, rot[2] * d);
}

// cell outline (0.5 x 0.5 x 0.9, the space a part takes on the car)
const cellBox = (() => {
  const lines = [], mats = [], hx = CELL / 2, hy = CELL / 2, hz = 0.45, t = 0.006;
  for (const [sx, sy, sz, px, py, pz] of [
    [CELL, t, t, 0, hy, hz], [CELL, t, t, 0, -hy, hz], [CELL, t, t, 0, hy, -hz], [CELL, t, t, 0, -hy, -hz],
    [t, CELL, t, hx, 0, hz], [t, CELL, t, -hx, 0, hz], [t, CELL, t, hx, 0, -hz], [t, CELL, t, -hx, 0, -hz],
    [t, t, 0.9, hx, hy, 0], [t, t, 0.9, -hx, hy, 0], [t, t, 0.9, hx, -hy, 0], [t, t, 0.9, -hx, -hy, 0],
  ]) {
    const m = new Float32Array(16);
    m4compose(m, [px, py, pz], quat(), [1, 1, 1]);
    lines.push(box(sx, sy, sz)); mats.push(m);
  }
  const mesh = scene.add(new Mesh(mergeGeometries(lines, mats), unlit(0x9fe8ff)));
  mesh.castShadow = false;
  return mesh;
})();
// a frame block next to the part, to see how it attaches
const neighbor = scene.add(new Mesh(box(CELL, CELL, 0.9), lambert(0xb8945f, { opacity: 0.35 }) as Material));
neighbor.castShadow = false;
// axis of the selected shape: a colored line through its pivot (x red, y green, z blue), drawn on top
const AXIS_COLOR: Record<Axis, number> = { x: 0xff5a5a, y: 0x5aff7a, z: 0x5a9cff };
const axisMats = Object.fromEntries((['x', 'y', 'z'] as Axis[]).map((a) => [a, unlit(AXIS_COLOR[a], { depthTest: false })])) as Record<Axis, Material>;
const axisGeo = cylinder(0.006, 0.006, 1.4, 6), pivotGeo = sphere(0.025, 10, 8);
const gizmos = [0, 1].map(() => {
  const g = scene.add(new Node('axis'));
  const line = g.add(new Mesh(axisGeo, axisMats.z)), dot = g.add(new Mesh(pivotGeo, axisMats.z));
  line.castShadow = dot.castShadow = false;
  line.renderOrder = dot.renderOrder = 10;
  g.visible = false;
  return { g, line, dot };
});
function updateGizmo() {
  const s = sel >= 0 ? list()[sel] : null;
  gizmos.forEach(({ g, line, dot }, k) => {
    g.visible = !!s && (s.group === 'spin' || (s.radial ?? 1) > 1) && (k === 0 || !!s.mirrorZ);
    if (!s || !g.visible || !built) return;
    // live in the part's own space, so the axis turns with the fan's attachment
    (built.node.find(s.group === 'arrow' ? 'arrow' : 'orient') ?? built.node).add(g);
    const axis = s.axis ?? 'z', pv = s.pivot ?? [0, 0, 0];
    g.setPosition(pv[0], pv[1], pv[2] * (k ? -1 : 1));
    line.setRotation(axis === 'z' ? Math.PI / 2 : 0, 0, axis === 'x' ? -Math.PI / 2 : 0);
    line.material = dot.material = axisMats[axis];
  });
}

const snapshot = () => { const s = JSON.stringify(models); if (history[history.length - 1] !== s) { history.push(s); if (history.length > 200) history.shift(); } };
const model = () => models[kind];
/** shapes of the model shown/edited at the current level (levels without their own model share a lower level's one) */
const list = () => shapesFor(model(), isItemKind() ? lvl : 1);
const isItemKind = () => kind === 'wheel' || kind === 'fan';

function rebuild() {
  for (const c of [...holder.children]) c.destroy();
  const k = KINDS.find((x) => x[0] === kind)![1];
  built = buildPart(make(k, isItemKind() ? lvl : 1), attach, model());
  holder.add(built.node);
  built.meshes.forEach((list, i) => { for (const m of list) m.flash.set(i === sel ? [1, 0.85, 0.2, 0.45] : [0, 0, 0, 0]); });
  updateGizmo();
  cellBox.visible = showCell;
  neighbor.visible = showNeighbor && kind !== 'block';
  poseNoob();
  // wheels and up-fans hang under the frame, forward fans sit next to it, the seat sits on it
  if (kind === 'fan') neighbor.setPosition(attach === 'left' ? -CELL : attach === 'right' ? CELL : 0, attach === 'top' ? CELL : attach === 'bottom' ? -CELL : 0, 0);
  else if (kind === 'seat') neighbor.setPosition(0, -CELL, 0);
  else neighbor.setPosition(0, CELL, 0);
  status();
}
function changed(panel = false) {
  if (panel) renderPanel();
  rebuild();
}

// ---------------------------------------------------------------- panel UI
document.head.append(h('style', null, `
body{margin:0;font:13px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e8ecf4}
.ed{position:fixed;left:0;top:0;bottom:0;width:380px;overflow:auto;background:rgba(20,24,34,.94);padding:12px 12px 40px;box-sizing:border-box;z-index:5;border-right:1px solid #2e3548}
.ed h1{font-size:17px;margin:0 0 8px}
.row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0}
.ed button{background:#2d3548;color:#e8ecf4;border:1px solid #414b63;border-radius:6px;padding:5px 9px;cursor:pointer;font:inherit}
.ed button:hover{background:#39435b}
.ed button.on{background:#3b6fd8;border-color:#5b8cf0}
.ed button.save{background:#2f9d49;border-color:#46c064;font-weight:700}
.ed button.del{background:#5a2a2a;border-color:#7a3a3a}
.ed input[type=number]{width:62px;background:#10131b;color:#e8ecf4;border:1px solid #3a4258;border-radius:5px;padding:3px 4px;font:inherit}
.ed input[type=text]{flex:1;min-width:0;background:#10131b;color:#e8ecf4;border:1px solid #3a4258;border-radius:5px;padding:3px 6px;font:inherit}
.ed select{background:#10131b;color:#e8ecf4;border:1px solid #3a4258;border-radius:5px;padding:3px;font:inherit}
.ed input[type=color]{width:34px;height:24px;border:none;background:none;padding:0}
.lbl{color:#9aa6c0;min-width:74px}
.sec{margin-top:12px;padding-top:8px;border-top:1px solid #2e3548;font-weight:700}
.card{background:#1b2130;border:1px solid #2e3548;border-radius:8px;margin:6px 0;padding:6px 8px}
.card.sel{border-color:#e8b93a;box-shadow:0 0 0 1px #e8b93a inset}
.card .hd{display:flex;gap:6px;align-items:center;cursor:pointer}
.card .hd b{flex:1}
.tiers{display:grid;grid-template-columns:repeat(5,1fr);gap:4px}
.tiers label{display:flex;flex-direction:column;align-items:center;font-size:11px;color:#9aa6c0}
.st{font-size:12px;color:#9aa6c0}
.st.dirty{color:#ffcf5a}
.hint{font-size:11px;color:#7f8aa3;margin:4px 0}
`));
const panel = h('div', { class: 'ed' });
document.body.append(panel);
const statusEl = h('span', { class: 'st' });

function status() {
  const dirty = JSON.stringify(models) !== saved;
  statusEl.textContent = dirty ? '● есть несохранённые изменения' : '✔ сохранено';
  statusEl.className = 'st' + (dirty ? ' dirty' : '');
}

/** JSON with short arrays (vectors, colors) kept on one line */
const pretty = (m: Models) => JSON.stringify(m, null, 2).replace(/\[([^[\]{}]*)\]/g, (_, inner: string) => `[${inner.trim().split(/\s*,\s*/).join(', ')}]`) + '\n';

async function save() {
  const body = pretty(models);
  const r = await fetch('/__aiwe/save?file=' + FILE, { method: 'POST', body });
  if (r.ok) { saved = JSON.stringify(models); statusEl.textContent = '✔ сохранено в ' + FILE; statusEl.className = 'st'; }
  else { statusEl.textContent = 'Ошибка сохранения: ' + (await r.text()); statusEl.className = 'st dirty'; }
}
function download() {
  const a = h('a', { href: URL.createObjectURL(new Blob([pretty(models)], { type: 'application/json' })), download: 'parts.json' });
  a.click();
}
function undo() {
  const s = history.pop();
  if (!s) return;
  models = JSON.parse(s);
  setModels(models);
  changed(true);
}

const btn = (label: string, fn: () => void, cls = '') => h('button', { class: cls, onClick: fn }, label);
const row = (...c: (HTMLElement | string)[]) => h('div', { class: 'row' }, ...c);
const lbl = (t: string) => h('span', { class: 'lbl' }, t);

/** number input bound to arr[i]; `before` runs before a new value is written (e.g. attach the array to the shape) */
function num(arr: number[], i: number, step: number, min?: number, before?: () => void) {
  const el = h('input', { type: 'number', step: String(step), value: String(arr[i]), ...(min !== undefined ? { min: String(min) } : {}) });
  el.addEventListener('focus', snapshot);
  el.addEventListener('input', () => { const v = parseFloat(el.value); if (!isNaN(v)) { before?.(); arr[i] = v; changed(); } });
  return el;
}

const SIZE_LABELS: Record<ShapeType, [string, string, string]> = {
  box: ['ширина', 'высота', 'глубина'], cylinder: ['радиус', 'высота', 'сегм.'], cone: ['радиус', 'высота', 'сегм.'], sphere: ['радиус', '—', 'сегм.'],
};

function shapeCard(s: Shape, i: number) {
  const open = i === sel;
  const card = h('div', { class: 'card' + (open ? ' sel' : '') });
  const head = h('div', { class: 'hd' }, h('b', null, `${i + 1}. ${s.name || s.type}`),
    btn('⧉', () => { snapshot(); list().splice(i + 1, 0, JSON.parse(JSON.stringify(s))); sel = i + 1; changed(true); }),
    btn('↑', () => { if (!i) return; snapshot(); const a = list(); [a[i - 1], a[i]] = [a[i], a[i - 1]]; sel = i - 1; changed(true); }),
    btn('↓', () => { const a = list(); if (i >= a.length - 1) return; snapshot(); [a[i + 1], a[i]] = [a[i], a[i + 1]]; sel = i + 1; changed(true); }),
    btn('✕', () => { snapshot(); list().splice(i, 1); sel = -1; changed(true); }, 'del'));
  head.addEventListener('click', (e) => { if ((e.target as HTMLElement).tagName === 'BUTTON') return; sel = open ? -1 : i; changed(true); });
  card.append(head);
  if (!open) return card;

  const name = h('input', { type: 'text', value: s.name ?? '' });
  name.addEventListener('focus', snapshot);
  name.addEventListener('input', () => { s.name = name.value; head.querySelector('b')!.textContent = `${i + 1}. ${s.name || s.type}`; status(); });
  const type = h('select', null, ...(['box', 'cylinder', 'cone', 'sphere'] as ShapeType[]).map((t) =>
    h('option', { value: t, selected: t === s.type }, { box: 'Куб', cylinder: 'Цилиндр', cone: 'Конус', sphere: 'Сфера' }[t])));
  type.addEventListener('change', () => { snapshot(); s.type = type.value as ShapeType; changed(true); });
  const sl = SIZE_LABELS[s.type];
  card.append(
    row(lbl('Название'), name),
    row(lbl('Форма'), type),
    row(lbl('Размер'), ...sl.flatMap((l, k) => (l === '—' ? [] : [h('span', { class: 'st' }, l), num(s.size, k, k === 2 && s.type !== 'box' ? 1 : 0.01, 0)]))),
    row(lbl('Позиция'), ...['x', 'y', 'z'].flatMap((l, k) => [h('span', { class: 'st' }, l), num(s.pos, k, 0.01)])),
    row(lbl('Поворот °'), ...['x', 'y', 'z'].flatMap((l, k) => [h('span', { class: 'st' }, l), num(s.rot, k, 5)])),
  );
  // color: fixed or the level color
  const tier = s.color === 'tier';
  const color = h('input', { type: 'color', value: tier ? '#ffffff' : s.color });
  color.disabled = tier;
  color.addEventListener('focus', snapshot);
  color.addEventListener('input', () => { s.color = color.value; changed(); });
  const tierBox = h('input', { type: 'checkbox', checked: tier });
  tierBox.addEventListener('change', () => { snapshot(); s.color = tierBox.checked ? 'tier' : '#ffffff'; changed(true); });
  card.append(row(lbl('Цвет'), color, h('label', null, tierBox, ' цвет уровня')));
  const tex = h('select', null, ...(['none', 'plank', 'wool', 'stone'] as TexName[]).map((t) =>
    h('option', { value: t, selected: t === (s.tex ?? 'none') }, { none: 'нет', plank: 'доски', wool: 'шерсть', stone: 'камень' }[t])));
  tex.addEventListener('change', () => { snapshot(); s.tex = tex.value as TexName; changed(); });
  const grp = h('select', null, ...(['body', 'spin', 'arrow'] as Group[]).map((g) =>
    h('option', { value: g, selected: g === (s.group ?? 'body') }, { body: 'неподвижна', spin: 'вращается', arrow: 'стрелка (по тяге)' }[g])));
  grp.addEventListener('change', () => { snapshot(); s.group = grp.value as Group; changed(); });
  // tiling: the texture repeats every N meters on each face instead of being stretched over it
  const tileV = [s.tile ?? 0];
  const tile = num(tileV, 0, 0.05, 0);
  tile.addEventListener('input', () => { if (tileV[0] > 0) s.tile = tileV[0]; else delete s.tile; changed(); });
  card.append(row(lbl('Текстура'), tex, lbl('Тайлинг, м'), tile), h('div', { class: 'hint' }, 'Тайлинг: размер одной плитки текстуры в метрах (0.5 = клетка машины); текстура повторяется по граням, а не растягивается. 0 — растянуть один раз.'), row(lbl('Группа'), grp));
  const check = (label: string, get: () => boolean, set: (v: boolean) => void) => {
    const c = h('input', { type: 'checkbox', checked: get() });
    c.addEventListener('change', () => { snapshot(); set(c.checked); changed(); });
    return h('label', null, c, ' ' + label);
  };
  const extra = { radial: [s.radial ?? 1], glow: [s.glow ?? 0] };
  const radial = num(extra.radial, 0, 1, 1);
  radial.addEventListener('input', () => { s.radial = Math.max(1, Math.round(extra.radial[0])); changed(); });
  const glow = num(extra.glow, 0, 0.1, 0);
  glow.addEventListener('input', () => { s.glow = extra.glow[0]; changed(); });
  card.append(
    row(check('зеркально на обе стороны', () => !!s.mirrorZ, (v) => (s.mirrorZ = v)), check('гранёная', () => !!s.flat, (v) => (s.flat = v))),
    row(lbl('Копий по кругу'), radial, lbl('Свечение'), glow),
  );
  // axis: rotation axis of a spinning shape and the axis its radial copies are spread around
  const axis = s.axis ?? 'z';
  const pv: [number, number, number] = s.pivot ? s.pivot : [0, 0, 0];
  const setPivot = (p: [number, number, number]) => { snapshot(); s.pivot = p; changed(true); };
  card.append(
    row(lbl(s.group === 'spin' ? 'Ось вращения' : 'Ось копий'),
      ...(['x', 'y', 'z'] as Axis[]).map((a) => btn(a.toUpperCase(), () => { snapshot(); s.axis = a; changed(true); }, a === axis ? 'on' : ''))),
    row(lbl('Центр оси'), ...['x', 'y', 'z'].flatMap((l, k) => [h('span', { class: 'st' }, l), num(pv, k, 0.01, undefined, () => (s.pivot = pv))])),
    row(btn('центр = позиция фигуры', () => setPivot([...s.pos])), btn('центр = 0, 0, 0', () => setPivot([0, 0, 0]))),
    h('div', { class: 'hint' }, 'Линия на превью показывает ось (X красная, Y зелёная, Z синяя). Ось Z смотрит на камеру игры, X — вперёд по ходу машины, Y — вверх.'),
  );
  return card;
}

function renderPanel() {
  const m = model();
  panel.replaceChildren(
    h('h1', null, 'Редактор деталей'),
    row(h('a', { href: './levels.html', style: 'color:#8fb4ff' }, '→ редактор уровней'), h('a', { href: './index.html', target: '_blank', style: 'color:#8fb4ff' }, '→ игра')),
    row(btn('💾 Сохранить (Ctrl+S)', save, 'save'), btn('⬇ JSON', download), btn('↶ Отменить', undo)),
    row(statusEl),
    h('div', { class: 'sec' }, 'Деталь'),
    row(...KINDS.map(([k, , name]) => btn(name, () => { kind = k; sel = -1; changed(true); }, k === kind ? 'on' : ''))),
    h('div', { class: 'sec' }, 'Просмотр'),
  );
  if (isItemKind()) {
    const slider = h('input', { type: 'range', min: '1', max: String(MAX_LVL), value: String(lvl) });
    const lv = h('b', null, String(lvl));
    slider.addEventListener('input', () => { lvl = +slider.value; lv.textContent = slider.value; rebuild(); });
    // the shape list below changes with the level: re-render once the slider is released
    slider.addEventListener('change', () => { sel = -1; changed(true); });
    panel.append(row(lbl('Уровень'), slider, lv, h('span', { class: 'st' }, TIERS[lvl - 1][1])));
    // own model per level
    const m = model(), src = modelLevel(m, lvl);
    let upTo = MAX_LVL;
    for (let l = lvl + 1; l <= MAX_LVL; l++) if (m.levels?.[l]) { upTo = l - 1; break; }
    const range = src === upTo ? `ур. ${src}` : `ур. ${src}–${upTo}`;
    panel.append(
      row(lbl('Модель'), h('b', null, src === lvl ? `своя у уровня ${lvl}` : `как у уровня ${src}`), h('span', { class: 'st' }, `(используется: ${range})`)),
      row(
        src !== lvl ? btn(`＋ своя модель для ур. ${lvl} (копия)`, () => {
          snapshot();
          m.levels ??= {};
          m.levels[lvl] = JSON.parse(JSON.stringify(shapesFor(m, lvl)));
          sel = -1;
          changed(true);
        }) : '',
        src === lvl && lvl > 1 ? btn(`✕ убрать модель ур. ${lvl}`, () => {
          snapshot();
          delete m.levels![lvl];
          if (!Object.keys(m.levels!).length) delete m.levels;
          sel = -1;
          changed(true);
        }, 'del') : '',
      ),
    );
  }
  if (kind === 'fan') {
    const sides: [Attach, string][] = [['left', 'слева'], ['right', 'справа'], ['top', 'сверху'], ['bottom', 'снизу']];
    panel.append(row(lbl('Рама'), ...sides.map(([a, n]) => btn(n, () => { attach = a; changed(true); }, a === attach ? 'on' : ''))),
      h('div', { class: 'hint' }, 'Модель рисуется для рамы слева (со стороны -X); в игре вентилятор сам поворачивается к раме. Рама сверху/снизу — тяга вверх, слева/справа — вперёд.'));
  }
  const toggle = (label: string, get: () => boolean, set: (v: boolean) => void) => btn(label, () => { set(!get()); changed(true); }, get() ? 'on' : '');
  panel.append(row(
    toggle('вращение', () => spinOn, (v) => (spinOn = v)),
    toggle('вид сбоку', () => sideView, (v) => (sideView = v)),
    toggle('клетка', () => showCell, (v) => (showCell = v)),
    toggle('сосед', () => showNeighbor, (v) => (showNeighbor = v)),
    ...(kind === 'seat' ? [toggle('нубик', () => showNoob, (v) => (showNoob = v))] : []),
  ));
  if (isItemKind()) {
    m.tiers ??= TIERS.map((t) => '#' + t[0].toString(16).padStart(6, '0'));
    const grid = h('div', { class: 'tiers' });
    m.tiers.forEach((c, i) => {
      const inp = h('input', { type: 'color', value: c });
      inp.addEventListener('focus', snapshot);
      inp.addEventListener('input', () => { m.tiers![i] = inp.value; changed(); });
      grid.append(h('label', null, inp, `${i + 1}`));
    });
    panel.append(h('div', { class: 'sec' }, 'Цвета уровней'), h('div', { class: 'hint' }, 'Используются фигурами с галочкой «цвет уровня» и в иконках инвентаря.'), grid);
  }
  if (kind === 'seat') panel.append(...noobSection());
  panel.append(...physicsSection());
  const shapes = list();
  panel.append(h('div', { class: 'sec' }, `Фигуры (${shapes.length})`));
  shapes.forEach((s, i) => panel.append(shapeCard(s, i)));
  panel.append(
    row(btn('+ Куб', () => add('box')), btn('+ Цилиндр', () => add('cylinder')), btn('+ Конус', () => add('cone')), btn('+ Сфера', () => add('sphere'))),
    h('div', { class: 'hint' },
      'Клетка машины 0.5 × 0.5 × 0.9 м, центр детали в (0,0,0), машина едет по +X, камера игры смотрит с +Z. ',
      'Группа «вращается» крутится вокруг оси Z (шины, лопасти); у колеса она растёт с уровнем. ',
      '«Стрелка» у вентилятора не поворачивается вместе с моделью, а показывает направление тяги (рисуйте её для тяги вверх); видна только в гараже. ',
      'Радиус колеса и тяга для физики задаются в parts.ts — здесь только внешний вид.'),
  );
  status();
}
/** where the noob sits on the seat: position (m, from the cell center) and rotation (degrees) */
function noobSection(): HTMLElement[] {
  const m = model();
  const vec = (key: 'pos' | 'rot', step: number) => [0, 1, 2].map((i) => {
    const el = h('input', { type: 'number', step: String(step), value: String(noobPose()[key][i]) });
    el.addEventListener('focus', snapshot);
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      if (isNaN(v)) return;
      const p = noobPose();
      m.noob = { pos: p.pos.slice(), rot: p.rot.slice() };
      m.noob[key][i] = v;
      rebuild();
    });
    return el;
  });
  return [
    h('div', { class: 'sec' }, 'Нубик на сиденье'),
    row(h('span', { class: 'lbl' }, 'Позиция X Y Z'), ...vec('pos', 0.01)),
    row(h('span', { class: 'lbl' }, 'Поворот X Y Z'), ...vec('rot', 5)),
    row(btn('Сбросить', () => { snapshot(); delete m.noob; changed(true); })),
    h('div', { class: 'hint' }, `Позиция — в метрах от центра клетки сиденья (X — вперёд по ходу машины, Y — вверх, Z — к камере игры); поворот в градусах, Y = 90 — лицом вперёд. По умолчанию: ${NOOB_POSE.pos.join(', ')} / ${NOOB_POSE.rot.join(', ')}. Меняет и то, где у нубика голова (удар головой = авария).`),
  ];
}

/** strength (impact speed that knocks the part off) and mass; one value for block/seat, one per level for wheel/fan */
function physicsSection(): HTMLElement[] {
  const m = model(), k = KINDS.find((x) => x[0] === kind)![1], levels = isItemKind() ? MAX_LVL : 1;
  const value = (key: 'strength' | 'mass', l: number) => {
    const arr = m.stats?.[key];
    return arr && arr.length ? arr[Math.min(l, arr.length) - 1] : key === 'mass' ? defaultMass(k, l) : defaultStrength(k, l);
  };
  const input = (key: 'strength' | 'mass', l: number) => {
    const el = h('input', { type: 'number', step: key === 'mass' ? '1' : '0.5', min: '0', value: String(value(key, l)) });
    el.addEventListener('focus', snapshot);
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      if (isNaN(v)) return;
      m.stats ??= {};
      // write the whole row so the file shows every level explicitly
      const arr = m.stats[key] ?? [];
      for (let i = 1; i <= levels; i++) arr[i - 1] = i === l ? v : value(key, i);
      m.stats[key] = arr.slice(0, levels);
      setModels(models);
      status();
      hint.textContent = fallText();
    });
    return el;
  };
  const fallText = () => `Уровень ${isItemKind() ? lvl : 1}: отваливается при ударе ${value('strength', lvl)} м/с ≈ падение с ${(value('strength', lvl) ** 2 / (2 * 9.81)).toFixed(1)} м`;
  const hint = h('div', { class: 'hint' }, fallText());
  const grid = h('div', { style: 'display:grid;grid-template-columns:auto 1fr 1fr;gap:4px 8px;align-items:center' },
    h('span', { class: 'st' }, isItemKind() ? 'ур.' : ''), h('span', { class: 'st' }, 'прочность, м/с'), h('span', { class: 'st' }, 'масса, кг'));
  for (let l = 1; l <= levels; l++) {
    grid.append(h('b', { style: l === lvl && isItemKind() ? 'color:#ffcf5a' : '' }, isItemKind() ? String(l) : ''), input('strength', l), input('mass', l));
  }
  return [
    h('div', { class: 'sec' }, 'Физика'),
    h('div', { class: 'hint' }, 'Прочность — скорость удара о землю (м/с), при которой деталь отваливается. Больше = крепче. Масса влияет на разгон, прыжки и баланс машины.'),
    grid, hint,
  ];
}

function add(type: ShapeType) {
  snapshot();
  const size: [number, number, number] = type === 'box' ? [0.2, 0.2, 0.2] : type === 'sphere' ? [0.1, 0, 12] : [0.1, 0.2, 12];
  list().push({ name: '', type, size, pos: [0, 0, 0], rot: [0, 0, 0], color: '#cccccc' });
  sel = list().length - 1;
  changed(true);
}

addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { e.preventDefault(); save(); }
  else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !(e.target instanceof HTMLInputElement && e.target.type === 'text')) { e.preventDefault(); undo(); }
});
addEventListener('beforeunload', (e) => { if (JSON.stringify(models) !== saved) e.preventDefault(); });

// ---------------------------------------------------------------- loop
let angle = 0;
game.onUpdate((dt) => {
  if (built && spinOn) {
    angle += dt * (kind === 'fan' ? 8 : 3);
    for (const s of built.spins) spinTo(s, -angle);
  }
});
game.onLateUpdate(() => {
  // side view = what the garage shows (orthographic, looking along -Z); the orbit camera is paused meanwhile
  camera.ortho = sideView;
  if (sideView) {
    camera.orthoSize = 0.75;
    camera.setPosition(0, 0, 10);
    camera.lookAt([0, 0, 0]);
  }
  orbit.o.smooth = sideView ? 0 : 12;
});
// the orbit camera script runs before onLateUpdate; in side view it's overridden right after
renderPanel();
rebuild();
Object.assign(window, { game, get models() { return models; } });
