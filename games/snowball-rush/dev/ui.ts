// Dev harness for the UI foundation (theme.ts + widgets.ts). Not part of the game build.
// ?v=screen (default; &tab=skins|balls|buttons|misc) | modal | confirm | rewards | toast | menu
// &lang=ru|en|de (de = fake long German dictionary: stress test for long translations) &level=N (save.level; < 4 locks the shop)
import { createGame, DirectionalLight, Mesh } from 'aiwebengine';
import { UI, h } from 'aiwebengine/ui';
import type { Playgama } from 'aiwebengine/playgama';
import type { Ctx, Drop, Nav, Reward } from '../types';
import { BALL_IDS, SKIN_IDS } from '../types';
import { FONT, applyTheme, fitUI, fontsReady } from '../theme';
import * as W from '../widgets';
import { ballGeometry, ballMaterial, loadSkinAssets } from '../skinart';
import { createCharacter, animateCharacter } from '../character';
import { buildBlocks, type Block } from '../blocks';
import { itemDef } from '../catalog';
import { defaultSave } from '../save';
import { setDict, setLang, tr } from '../i18n';
import type { Payments } from '../payments';

const q = new URLSearchParams(location.search);
const view = q.get('v') ?? 'screen';
const langQ = q.get('lang') ?? 'ru';

// ---------------------------------------------------------------- language (de = fake long dictionary)
setLang(langQ);
if (langQ === 'de') {
  setDict({
    'You got!': 'Du hast etwas bekommen!', Collect: 'Belohnungen einsammeln', Common: 'Gewöhnlich', Rare: 'Selten', Epic: 'Episch',
    Legendary: 'Legendär', New: 'Neuheit', Hit: 'Verkaufsschlager', Cancel: 'Abbrechen', 'Already owned': 'Bereits im Besitz',
    '{0}d {1}': '{0} Tg. {1}', 'No ads': 'Keine Werbung', Santa: 'Weihnachtsmann', 'Disco Ball': 'Diskokugel', "Santa's Gift": 'Geschenk vom Weihnachtsmann',
    'Snow Maiden': 'Schneeflöckchenprinzessin', 'Ice Knight': 'Eisritter', Gingerbread: 'Lebkuchenmännchen', 'Hockey Player': 'Eishockeyspieler',
    Nutcracker: 'Nussknacker', 'Winter Noob': 'Winter-Noob', 'Golden Snowball': 'Goldener Schneeball', 'Olivier Salad': 'Olivier-Salat',
    'Tree Ornament': 'Christbaumkugel', 'Ice Crystal': 'Eiskristall', Snowball: 'Schneeball', Tangerine: 'Mandarine', Candy: 'Zuckerstange',
    Garland: 'Lichterkette', Penguin: 'Pinguin', Elf: 'Weihnachtself', Snowman: 'Schneemann', Reindeer: 'Rentier', Skier: 'Skifahrer', Yeti: 'Yeti', Noob: 'Noob',
    'Ice Gift': 'Eisiges Geschenk', 'Snow Gift': 'Schneegeschenk',
    'Equipment and costumes': 'Ausrüstungsgegenstände und Kostümsammlung', Characters: 'Charakterkostüme', Snowballs: 'Schneeballverzierungen',
    Buttons: 'Schaltflächenübersicht', Misc: 'Verschiedenes', Play: 'Spielen', 'Level {0}': 'Spielstufe {0}', 'Double reward': 'Belohnung verdoppeln',
    'Watch an ad': 'Werbevideo ansehen', Equip: 'Ausrüsten', Equipped: 'Ausgerüstet', 'Gifts only': 'Nur aus Geschenken', 'Unlocks at level {0}': 'Wird auf Stufe {0} freigeschaltet',
    'Lv. {0}': 'Stf. {0}', Shop: 'Einkaufsladen', Upgrades: 'Verbesserungen', Wardrobe: 'Kleiderschrank', 'Gift Calendar': 'Geschenkkalender', Gifts: 'Geschenke',
    'Free gift': 'Kostenloses Geschenk', 'Sticky Snow': 'Klebriger Schnee', 'Your snowball grows faster': 'Dein Schneeball wächst schneller',
    'Starter Pack': 'Anfängerpaket', 'Buy for {0}': 'Kaufen für {0}', 'Are you sure you want to spend {0} gems on this gift?': 'Bist du sicher, dass du {0} Kristalle für dieses Geschenk ausgeben möchtest?',
    Open: 'Öffnen', 'New Year sale!': 'Neujahrsschlussverkauf!', 'Saved!': 'Gespeichert!', 'Not enough gems': 'Nicht genügend Kristalle', 'Wardrobe unlocked!': 'Kleiderschrank freigeschaltet!',
    'Try for one race': 'Für ein Rennen ausprobieren', Settings: 'Einstellungen', 'Unlocks soon': 'Bald verfügbar',
  });
}

// ---------------------------------------------------------------- backdrop: snowy ground, Нубик with his ball
const game = await createGame({ antialias: true });
await loadSkinAssets();
const { scene, camera } = game;
scene.setSky({ top: 0x0f2a5c, horizon: 0x6d8fc7, bottom: 0xdfe8f5 });
scene.setAmbient(0xc9d8ff, 0x7a86a0, 0.7);
scene.add(new DirectionalLight({ direction: [-0.4, -1, -0.6], intensity: 1.1 }));
const floor: Block[] = [];
for (let x = -10; x <= 10; x++) for (let z = -16; z <= 4; z++) floor.push({ x, y: -0.5, z: z - 0.5, t: ['snow', 'snowSide', 'dirt'] });
scene.add(buildBlocks(floor, { noBottom: true, chunk: 8 }));
const hero = createCharacter('noob');
hero.root.setPosition(-0.6, 0, 0).setRotation(0, 0.5, 0);
scene.add(hero.root);
scene.add(new Mesh(ballGeometry('snow'), ballMaterial('snow'))).setPosition(0.9, 0.55, 0.6).setScale(0.55);
camera.fov = 50;
camera.setPosition(0, 2.2, 6);
camera.lookAt([0, 0.9, 0]);
game.onUpdate(() => animateCharacter(hero, 'idle', game.time.elapsed));

// ---------------------------------------------------------------- fake context
const ui = new UI(game, { font: FONT });
applyTheme();
fitUI(ui, game);
await fontsReady();
const save = defaultSave(Date.now());
Object.assign(save, { coins: 12345, gems: 250, level: +(q.get('level') ?? 5) });
const sdk = { rewardedSupported: q.get('ads') !== '0', showRewarded: async () => true, lang: langQ } as unknown as Playgama;
let topbar: W.TopBar;
const nav: Nav = {
  menu: () => W.toast(ctx, 'nav.menu()'), play: () => {}, shop: (t) => W.toast(ctx, `nav.shop(${t})`, 'good'), wardrobe: () => {}, upgrades: () => {},
  cases: () => {}, daily: () => {}, offer: () => {},
};
const ctx: Ctx = {
  game, ui, sdk, pay: {} as Payments, save, persist() {}, nav, refresh: () => topbar.update(), now: () => Date.now(),
};
topbar = new W.TopBar(ctx);
const T = (ru: string, en: string) => tr({ ru, en });

// ---------------------------------------------------------------- screen with tabs
function buildScreen() {
  const p = W.makeScreen(ctx, T('Гардероб и снаряжение', 'Equipment and costumes'));
  p.bar.lastElementChild!.replaceWith(W.btn(W.icon('info'), () => W.toast(ctx, 'info'), 'icon blue'));
  const grid = (els: HTMLElement[]) => h('div', { class: 'grid' }, ...els);
  const pages: Record<string, () => HTMLElement[]> = {
    skins: () => [grid(SKIN_IDS.map((id, i) => skinCard('skin', id, i)))],
    balls: () => [grid(BALL_IDS.map((id, i) => skinCard('ball', id, i)))],
    buttons: buttonsPage,
    misc: miscPage,
  };
  const t = W.tabs([
    { id: 'skins', label: T('Персонажи', 'Characters'), icon: 'shirt' },
    { id: 'balls', label: T('Комья', 'Snowballs'), icon: 'ball' },
    { id: 'buttons', label: T('Кнопки', 'Buttons') },
    { id: 'misc', label: T('Разное', 'Misc') },
  ], (id) => { p.body.replaceChildren(...pages[id]()); p.body.scrollTop = 0; });
  t.setDot('balls', true);
  t.setDot('misc', 3);
  p.head.append(t.el);
  t.select((q.get('tab') ?? 'skins') as 'skins');
  p.show();
  return p;
}

function skinCard(kind: 'skin' | 'ball', id: string, i: number): HTMLElement {
  const def = itemDef(kind, id);
  const owned = i < 2, sel = i === 0;
  let foot: W.Child | W.Child[];
  if (sel) foot = h('span', { class: 'c-good b t-s' }, T('Надето', 'Equipped'));
  else if (owned) foot = W.btn(T('Надеть', 'Equip'), () => {}, 'small blue');
  else if (def.price) foot = W.btn(W.money(def.price.cur, def.price.n), () => W.toast(ctx, T('Недостаточно кристаллов', 'Not enough gems'), 'bad'), `small ${def.price.cur === 'gems' ? 'blue' : 'gold'}`);
  else foot = h('span', { class: 'c-dim t-xs' }, T('Только из подарков', 'Gifts only'));
  const badge = i === 4 ? W.saleBadge(50) : i === 11 ? W.hitBadge() : i === 12 ? W.newBadge(true) : undefined;
  return W.itemCard(kind, id, { foot, sel, badge, locked: !owned && !def.price, dim: !owned && !def.price, onClick: () => {} });
}

function buttonsPage(): HTMLElement[] {
  const row = (...c: HTMLElement[]) => h('div', { class: 'row wrap', style: 'gap:calc(var(--u)*20px);margin-bottom:calc(var(--u)*26px)' }, ...c);
  const n = () => {};
  const locked = W.btn([W.icon('cart'), W.lines(T('Магазин', 'Shop'), T('Ур. 5', 'Lv. 5'))], () => W.toast(ctx, T('Откроется на уровне 5', 'Unlocks at level 5')), 'locked');
  const busy = W.btn(T('Загрузка', 'Loading'), n, 'blue busy');
  const dis = W.btn(T('Недоступно', 'Unavailable'), n, 'green');
  dis.disabled = true;
  const withDot = W.btn([W.icon('calendar'), T('Календарь', 'Gift Calendar')], n, 'blue');
  W.dot(withDot, true);
  const attn = W.btn([W.icon('up'), T('Улучшения', 'Upgrades')], n, 'green');
  W.attention(attn, true);
  const t = W.tabs([{ id: 'a', label: T('Предложения', 'Offers') }, { id: 'b', label: T('Кристаллы', 'Gems') }, { id: 'c', label: T('Монеты', 'Coins') }], n);
  t.select('a');
  return [
    row(W.btn(T('Каменная', 'Stone'), n), W.btn([W.icon('play'), T('Играть', 'Play')], n, 'green'), W.btn(T('Синяя', 'Blue'), n, 'blue'),
      W.btn(T('Золотая', 'Gold'), n, 'gold'), W.btn(T('Красная', 'Red'), n, 'red'), W.adBtn(T('x2 за рекламу', 'Double reward'), n)),
    row(W.btn(T('Маленькая', 'Small'), n, 'small'), W.btn(W.money('gems', 120), n, 'small blue'), W.btn(W.money('coins', 1500), n, 'small gold'),
      W.adBtn(T('Бесплатно', 'Free'), n, 'small'), W.btn(W.icon('gear'), n, 'icon'), W.btn(W.icon('sound'), n, 'icon blue'), W.btn(W.icon('close'), n, 'icon small red')),
    row(W.btn([W.icon('play'), W.lines(T('ИГРАТЬ', 'PLAY'), tr({ ru: 'Уровень 6', en: 'Level 6' }))], n, 'green big'),
      W.rewardedBtn(ctx, T('Посмотреть рекламу', 'Watch an ad'), 'test', () => W.toast(ctx, 'reward!', 'good'), 'big')),
    row(locked, dis, busy, withDot, attn),
    t.el,
  ];
}

function miscPage(): HTMLElement[] {
  const now = Date.now();
  const bars = [W.progress(0.35, { seg: 5, label: '7 / 20' }), W.progress(0.8, { seg: 12, color: '#3f8cff' }), W.progress(1, { seg: 20, color: '#ffb31a', label: 'MAX' })];
  const up = h('div', { class: 'li' }, W.icon('grip', 64),
    h('div', { class: 'col grow gap-s' }, h('div', { class: 'b' }, T('Липкий снег', 'Sticky Snow')), h('div', { class: 'sub' }, T('Ком растёт быстрее', 'Your snowball grows faster')), W.progress(0.35, { seg: 20 }).el),
    W.btn(W.money('coins', 1250), () => {}, 'gold'));
  const offer = h('div', { class: 'card r-legendary', style: 'flex:1 1 calc(var(--u)*260px);max-width:calc(var(--u)*360px)' },
    W.saleBadge(90), W.itemArt('skin', 'iceknight', 120), h('div', { class: 'nm' }, T('Стартовый набор', 'Starter Pack')), W.timerChip(ctx, now + 47 * 3600e3 + 125e3),
    h('div', { class: 'foot' }, W.btn(T('Купить за 99 ₽', 'Buy for $1.99'), () => {}, 'green small')));
  const gift = h('div', { class: 'card r-rare', style: 'flex:1 1 calc(var(--u)*260px);max-width:calc(var(--u)*360px)' },
    W.itemArt('key', 'ice', 110), h('div', { class: 'nm' }, T('Бесплатный подарок', 'Free gift')), W.timerChip(ctx, now + 95e3),
    h('div', { class: 'foot' }, W.rewardedBtn(ctx, T('Открыть', 'Open'), 'free_case', () => {}, 'small')));
  return [
    h('div', { class: 'row wrap', style: 'gap:calc(var(--u)*22px)' }, h('span', { class: 'chip' }, W.money('coins', 3000)), h('span', { class: 'chip' }, W.money('gems', 45)),
      W.timerChip(ctx, now + 3 * 864e5 + 5000), W.timerChip(ctx, now + 754e3), ...(['common', 'rare', 'epic', 'legendary'] as const).map(W.rarityBadge)),
    h('div', { class: 'sep' }),
    h('div', { class: 'col' }, ...bars.map((b) => b.el)),
    h('div', { class: 'sep' }),
    up,
    h('div', { class: 'row wrap center', style: 'gap:calc(var(--u)*30px);margin:calc(var(--u)*30px) 0' }, offer, gift),
    h('div', { class: 'row wrap' }, ...['noob', 'santa', 'yeti', 'elf', 'penguin'].map((s) => W.avatar(s)), W.avatar('reindeer', 96)),
    h('div', { class: 'well', style: 'margin-top:calc(var(--u)*24px);position:relative;padding-top:calc(var(--u)*44px)' }, W.garland(),
      h('p', { class: 'txt' }, T('Длинный текст в колодце: переносится по словам и не вылезает за рамки панели при любой ширине экрана.',
        'A long text inside a well: it wraps by words and never leaves the panel on any screen width.'))),
  ];
}

// ---------------------------------------------------------------- a menu-like layout (garland, big play, feature buttons)
function buildMenu() {
  const lay = W.layer(ctx, 'screen');
  const side = (ic: Parameters<typeof W.icon>[0], ru: string, en: string, locked = false) => {
    const b = W.btn([W.icon(ic), locked ? W.lines(T(ru, en), T('Ур. 5', 'Lv. 5')) : T(ru, en)], () => {}, locked ? 'locked' : 'blue');
    b.style.width = '100%';
    return b;
  };
  const cal = side('calendar', 'Календарь', 'Gift Calendar');
  W.dot(cal, true);
  const upg = side('up', 'Улучшения', 'Upgrades');
  W.attention(upg, true);
  lay.append(h('div', { style: 'position:absolute;inset:0' },
    W.garland(),
    h('div', { style: 'position:absolute;left:calc(var(--u)*24px);top:calc(var(--u)*30px)' },
      h('div', { class: 'ttl', style: 'font-size:calc(var(--u)*40px)' }, T('Нубик: Снежная гонка', 'Noob: Snowball Rush')), h('div', { class: 'c-ice b' }, tr({ ru: 'Уровень 6', en: 'Level 6' }))),
    h('div', { class: 'col', style: 'position:absolute;left:calc(var(--u)*24px);top:50%;transform:translateY(-40%);width:calc(var(--u)*270px)' },
      upg, side('shirt', 'Гардероб', 'Wardrobe'), cal, side('gift', 'Подарки', 'Gifts', true), side('cart', 'Магазин', 'Shop', true)),
    h('div', { style: 'position:absolute;left:50%;bottom:calc(var(--u)*40px);transform:translateX(-50%)' },
      W.btn([W.icon('play'), W.lines(T('ИГРАТЬ', 'PLAY'), tr({ ru: 'Уровень 6', en: 'Level 6' }))], () => {}, 'green big'))));
}

// ---------------------------------------------------------------- views
const drops: (Drop | Reward)[] = [
  { kind: 'skin', id: 'santa', rarity: 'legendary', dup: false, comp: 0 },
  { kind: 'ball', id: 'disco', rarity: 'epic', dup: true, comp: 1000 },
  { kind: 'coins', n: 3000 },
  { kind: 'gems', n: 300 },
  { kind: 'key', id: 'ice', n: 3 },
];
if (view === 'menu') buildMenu();
else buildScreen();
if (view === 'modal') {
  const m = W.modal(ctx, [
    W.itemArt('key', 'santa', 150),
    h('p', { class: 'txt' }, T('Подарок Деда Мороза: эпические и легендарные костюмы. Шанс легендарного предмета — 28%.', "Santa's Gift: epic and legendary costumes. Legendary chance: 28%.")),
    W.timerChip(ctx, Date.now() + 5 * 3600e3),
    h('div', { class: 'row wrap center' }, W.btn(W.money('gems', 250), () => {}, 'blue'), W.rewardedBtn(ctx, T('Попробовать на одну гонку', 'Try for one race'), 'try_skin', () => {})),
  ], { title: T('Подарок Деда Мороза', "Santa's Gift") });
  void m;
}
if (view === 'confirm') void W.confirmBox(ctx, tr({ ru: 'Точно потратить 250 кристаллов на этот подарок?', en: 'Are you sure you want to spend 250 gems on this gift?' }), T('Открыть', 'Open'));
if (view === 'rewards') void W.showRewards(ctx, q.get('n') === '1' ? drops.slice(0, 1) : drops);
if (view === 'toast') {
  W.toast(ctx, T('Сохранено!', 'Saved!'), 'good');
  W.toast(ctx, T('Недостаточно кристаллов', 'Not enough gems'), 'bad');
  W.toast(ctx, T('Гардероб открыт! Загляни туда — там тебя ждёт подарок.', 'Wardrobe unlocked!'));
}
if (q.has('fly')) setTimeout(() => { save.coins += 500; void W.flyCurrency(ctx, 'coins', { x: innerWidth / 2, y: innerHeight / 2 }); topbar.update(); }, 500);
(window as unknown as { ctx: Ctx; W: typeof W; __ready: boolean }).ctx = ctx;
(window as unknown as { W: typeof W }).W = W;
(window as unknown as { __ready: boolean }).__ready = true;
