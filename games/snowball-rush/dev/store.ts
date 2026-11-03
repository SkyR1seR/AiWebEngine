// Dev harness for the store screens (ui-store): shop, cases + roulette, wardrobe, upgrades, calendar, offers. Not in the build.
// ?v=shop (&tab=offers|gems|coins|cases) | cases | roulette (&case=snow|ice|santa) | odds (&case=) | wardrobe (&tab=skins|balls)
//   | upgrades | daily | offer (&id=starter|newyear|hot|comeback) | banner
// &lang=ru|en  &level=N (default 5)  &fresh=1 (tutorial freebies unused, no coins)  &pay=0 (no payments)  &ads=0 (no rewarded)
// &claimed=1 (calendar already claimed today)  &cool=1 (ad cooldowns running)  &rich=1 (lots of currency)
import { createGame, DirectionalLight, Mesh } from 'aiwebengine';
import { UI, h } from 'aiwebengine/ui';
import type { Playgama } from 'aiwebengine/playgama';
import type { CaseId, Ctx, Nav, ScreenApi } from '../types';
import { FONT, applyTheme, fitUI, fontsReady } from '../theme';
import * as W from '../widgets';
import { ballGeometry, ballMaterial, loadSkinAssets } from '../skinart';
import { createCharacter, animateCharacter } from '../character';
import { buildBlocks, type Block } from '../blocks';
import { defaultSave } from '../save';
import { setLang } from '../i18n';
import { Payments } from '../payments';
import { activeOffers, triggerComeback } from '../offers';
import { dayKey } from '../util';
import { createShop } from '../shop';
import { createCases, openCase, showOdds } from '../casesui';
import { createWardrobe } from '../wardrobe';
import { createUpgrades } from '../upgradesui';
import { createDaily } from '../daily';
import { offerBanner, showOffer } from '../offersui';

const q = new URLSearchParams(location.search);
const view = q.get('v') ?? 'shop';
setLang(q.get('lang') ?? 'ru');

// ---- backdrop
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

// ---- fake context
const ui = new UI(game, { font: FONT });
applyTheme();
fitUI(ui, game);
await fontsReady();
const now0 = Date.now();
const save = defaultSave(now0 - 86400e3 * 3);
const fresh = q.has('fresh');
Object.assign(save, { coins: fresh ? 120 : 12345, gems: fresh ? 0 : 340, level: +(q.get('level') ?? 5), trophies: 420 });
if (q.has('rich')) Object.assign(save, { coins: 999999, gems: 99999 });
save.unlockedAt = { upgrades: now0 - 9e6, wardrobe: now0 - 8e6, daily: now0 - 8e6, cases: now0 - 7e6, shop: now0 - 3600e3 * 5 };
if (!fresh) {
  save.freebies = ['upgrade', 'case', 'skin'];
  save.skins.push('winter', 'penguin');
  save.balls.push('tangerine');
  save.up = { speed: 6, grip: 3, armor: 12, start: 15, magnet: 1 };
  save.keys = { snow: 0, ice: 2, santa: 1 };
  save.daily = { day: 3, last: q.has('claimed') ? dayKey(now0) : '' };
}
if (q.has('cool')) { save.freeCase = now0 + 3 * 3600e3; save.freeUp = now0 + 7 * 60e3; save.adCoins = { day: dayKey(now0), n: 4, next: now0 + 140e3 }; }
save.lossStreak = 2;
const fakeSdk = {
  rewardedSupported: q.get('ads') !== '0', paymentsSupported: false, lang: q.get('lang') ?? 'ru',
  showRewarded: () => new Promise<boolean>((r) => setTimeout(() => r(true), 500)),
} as unknown as Playgama;
const pay = await Payments.init(fakeSdk);
if (q.get('pay') === '0') { pay.available = false; pay.test = false; }
let topbar: W.TopBar;
const screens: Record<string, ScreenApi> = {};
const go = (name: string, arg?: string) => {
  for (const [k, s] of Object.entries(screens)) if (k !== name && k !== 'daily') s.hide();
  screens[name]?.show(arg);
};
const nav: Nav = {
  menu: () => { go(''); W.toast(ctx, 'nav.menu()'); }, play: () => W.toast(ctx, 'nav.play()'),
  shop: (t) => go('shop', t), wardrobe: (t) => go('wardrobe', t), upgrades: () => go('upgrades'), cases: () => go('cases'),
  daily: () => screens.daily.show(), offer: (id) => showOffer(ctx, id),
};
const ctx: Ctx = {
  game, ui, sdk: fakeSdk, pay, save, persist() { (window as unknown as { saved: number }).saved = Date.now(); }, nav,
  refresh: () => { topbar.update(); for (const s of Object.values(screens)) s.refresh(); }, now: () => Date.now(),
};
topbar = new W.TopBar(ctx);
triggerComeback(save, now0);
addEventListener('snowball:preview', (e) => console.log('preview', JSON.stringify((e as CustomEvent).detail)));

screens.shop = createShop(ctx);
screens.cases = createCases(ctx);
screens.wardrobe = createWardrobe(ctx);
screens.upgrades = createUpgrades(ctx);
screens.daily = createDaily(ctx);

const cs = (q.get('case') ?? 'ice') as CaseId;
switch (view) {
  case 'shop': go('shop', q.get('tab') ?? undefined); break;
  case 'cases': go('cases'); break;
  case 'roulette': go('cases'); void openCase(ctx, cs, save.keys[cs] > 0 ? 'key' : 'gems'); break;
  case 'odds': go('cases'); showOdds(ctx, cs); break;
  case 'wardrobe': go('wardrobe', q.get('tab') ?? undefined); break;
  case 'upgrades': go('upgrades'); break;
  case 'daily': screens.daily.show(); break;
  case 'offer': showOffer(ctx, q.get('id') ?? 'starter'); break;
  case 'banner': {
    const col = h('div', { class: 'col', style: 'position:absolute;left:calc(var(--u)*22px);top:calc(var(--u)*120px);width:calc(var(--u)*360px);gap:calc(var(--u)*22px)' },
      ...activeOffers(save, Date.now()).map((o) => offerBanner(ctx, o)));
    col.querySelectorAll('.card').forEach((c) => ((c as HTMLElement).style.width = '100%'));
    W.layer(ctx, 'screen').append(col);
    // the menu's own banner layout rules (menu.ts CSS) are not loaded here: mimic them
    const st = document.createElement('style');
    st.textContent = '.mn-ofb{flex-direction:row!important;gap:12px;padding:10px 12px!important;text-align:left}.mn-ofb>.art{width:calc(var(--u)*84px);height:calc(var(--u)*84px)}.mn-ofb>.col{gap:6px;align-items:flex-start}';
    document.head.append(st);
    break;
  }
}
(window as unknown as { ctx: Ctx; __ready: boolean }).ctx = ctx;
(window as unknown as { __ready: boolean }).__ready = true;
