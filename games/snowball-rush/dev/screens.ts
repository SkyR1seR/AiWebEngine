// Dev harness for the ui-core screens (menu, hud, matchmaking, results, tutorial). Not part of the game build.
// ?v=menu (&level=N: save.level, 0 = everything locked) | hud (&t=seconds of race) | mm | results (&place=1..5) |
//   coach (&hand=drag|tap &where=top|bottom|center &modal=1) | intro (&kind=wall|...|boost|ice|thaw|salt) | intros (all arts)
//   | unlock (&f=cases) | pause
// &lang=ru|en|de (de = fake long German dictionary) &ads=0 (no rewarded ads) &tries=N
import { createGame, DirectionalLight, Mesh } from 'aiwebengine';
import { UI, h } from 'aiwebengine/ui';
import type { Playgama } from 'aiwebengine/playgama';
import type { Ctx, Feature, Nav, ObstacleKind, Profile, Racer } from '../types';
import { FONT, applyTheme, fitUI, fontsReady } from '../theme';
import * as W from '../widgets';
import { ballGeometry, ballMaterial, loadSkinAssets } from '../skinart';
import { createCharacter, animateCharacter } from '../character';
import { buildBlocks, type Block } from '../blocks';
import { defaultSave, playerName } from '../save';
import { baseStats } from '../config';
import { generateLevel } from '../level';
import { RaceSim } from '../sim';
import { makeOpponents } from '../bots';
import { setDict, setLang } from '../i18n';
import type { Payments } from '../payments';
import { createMenu } from '../menu';
import { Hud } from '../hud';
import { matchmaking } from '../matchmaking';
import { showResults } from '../results';
import { coach, introArtURL, introCard, unlockPopup, type IntroKind } from '../tutorial';

const q = new URLSearchParams(location.search);
const view = q.get('v') ?? 'menu';
const langQ = q.get('lang') ?? 'ru';

setLang(langQ);
if (langQ === 'de') {
  // deliberately long German: stress test for wrapping / shrinking
  setDict({
    NOOB: 'NOOBI', 'SNOWBALL RUSH': 'SCHNEEBALL-WETTRENNEN', PLAY: 'SPIELEN', 'Level {0}': 'Spielstufe {0}', Upgrades: 'Verbesserungen',
    Wardrobe: 'Kleiderschrank', 'Gift Calendar': 'Geschenkkalender', Gifts: 'Geschenke', Shop: 'Einkaufsladen', 'Lv. {0}': 'Stf. {0}',
    'Unlocks at level {0}': 'Wird auf Spielstufe {0} freigeschaltet', Snowflake: 'Schneeflöckchen', Icicle: 'Eiszapfen', Snowstorm: 'Schneegestöber',
    'Northern Lights': 'Nordlichter am Himmel', 'Sound off': 'Ton aus', 'Music off': 'Musik aus',
    'Finding opponents…': 'Gegnersuche läuft gerade…', 'Opponents found!': 'Alle Gegner wurden gefunden!', 'Playing now: {0}': 'Spielen gerade online: {0}',
    'Attempt {0}: the level got easier!': 'Versuch {0}: Die Spielstufe ist jetzt etwas leichter geworden!', You: 'Du',
    'VICTORY!': 'SIEG!', 'TOP 3! Level complete': 'UNTER DEN BESTEN DREI! Spielstufe geschafft', "Don't give up!": 'Gib bloß nicht auf!',
    'It will be a little easier next time': 'Beim nächsten Versuch wird es ein kleines bisschen leichter', 'Picked up: {0}': 'Unterwegs eingesammelt: {0}',
    'Bonus ×{0}': 'Bonusmultiplikator ×{0}', 'New league: {0}!': 'Neue Liga erreicht: {0}!', '×2 for an ad': 'Verdoppeln für ein Werbevideo',
    'Reward doubled!': 'Belohnung wurde verdoppelt!', Next: 'Weiter geht’s', 'Try again': 'Nochmal versuchen', Menu: 'Hauptmenü',
    Noob: 'Noob', 'Got it!': 'Alles klar, verstanden!', 'New obstacle!': 'Ein neues Hindernis!', 'New on the track!': 'Neu auf der Strecke!',
    'Ice wall': 'Massive Eiswand', 'The number shows the snowball size you need. A bigger snowball smashes through!': 'Die Zahl zeigt, wie groß dein Schneeball sein muss. Ein größerer Schneeball durchbricht die Wand mühelos!',
    'Unlocked: {0}!': 'Freigeschaltet: {0}!', Later: 'Später vielleicht', 'Take a look': 'Jetzt ansehen',
    'Open gifts with costumes and snowballs. The first one is free!': 'Öffne Geschenke mit Kostümen und Schneebällen. Das allererste Geschenk ist komplett kostenlos!',
    'Drag your finger left and right to steer!': 'Ziehe deinen Finger nach links und rechts, um deinen Schneeball zu lenken!',
    Paused: 'Spiel pausiert', 'Leave race': 'Rennen verlassen', Continue: 'Weiterspielen', 'GO!': 'LOS GEHT’S!', 'WALL SMASHED!': 'WAND ZERTRÜMMERT!',
    'Collect coins: they pay for upgrades!': 'Sammle Münzen ein: Damit bezahlst du später deine Verbesserungen!',
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
for (let x = -12; x <= 12; x++) for (let z = -16; z <= 4; z++) floor.push({ x, y: -0.5, z: z - 0.5, t: ['snow', 'snowSide', 'dirt'] });
scene.add(buildBlocks(floor, { noBottom: true, chunk: 8 }));
const hero = createCharacter('noob');
hero.root.setPosition(0.3, 0, 0).setRotation(0, 0.4, 0);
scene.add(hero.root);
scene.add(new Mesh(ballGeometry('snow'), ballMaterial('snow'))).setPosition(1.6, 0.55, 0.6).setScale(0.55);
camera.fov = 50;
camera.setPosition(0, 2.2, 6.5);
camera.lookAt([0.6, 0.9, 0]);
game.onUpdate(() => animateCharacter(hero, 'idle', game.time.elapsed));

// ---------------------------------------------------------------- fake context
const ui = new UI(game, { font: FONT });
applyTheme();
fitUI(ui, game);
await fontsReady();
const now0 = Date.now();
const save = defaultSave(now0 - 3 * 864e5);
Object.assign(save, { coins: 12345, gems: 250, level: +(q.get('level') ?? 5), trophies: +(q.get('trophies') ?? 236), tries: +(q.get('tries') ?? 0) });
save.keys.snow = +(q.get('keys') ?? 0);
for (const f of ['upgrades', 'wardrobe', 'daily', 'cases', 'shop'] as Feature[]) save.unlockedAt[f] = now0 - 3600e3;
save.freebies = ['upgrade', 'skin'];
const sdk = {
  rewardedSupported: q.get('ads') !== '0', lang: langQ, muted: false,
  showRewarded: async (p: string) => { console.log('showRewarded', p); await new Promise((r) => setTimeout(r, 300)); return true; },
  mute: (on: boolean) => console.log('sdk.mute', on),
} as unknown as Playgama;
const log = (s: string) => () => { console.log(s); W.toast(ctx, s, 'good'); };
const nav: Nav = {
  menu: log('nav.menu()'), play: log('nav.play()'), shop: (t) => log(`nav.shop(${t ?? ''})`)(), wardrobe: log('nav.wardrobe()'),
  upgrades: log('nav.upgrades()'), cases: log('nav.cases()'), daily: log('nav.daily()'), offer: (id) => log(`nav.offer(${id})`)(),
};
const ctx: Ctx = {
  game, ui, sdk, pay: {} as Payments, save, persist: () => console.log('persist'), nav, refresh: () => topbar.update(), now: () => Date.now(),
};
const topbar = new W.TopBar(ctx);

// ---------------------------------------------------------------- race data (real level + sim)
const player: Profile = { name: playerName(save), skin: 'noob', ball: 'snow', trophies: save.trophies, level: save.level + 1, isBot: false };
const opponents = makeOpponents({ trophies: save.trophies, level: save.level }, 4, 77);
function makeSim(): RaceSim {
  const L = generateLevel(save.level);
  return new RaceSim(L, [player, ...opponents].map((p, i) => ({ profile: p, isPlayer: i === 0, stats: baseStats(), skill: 0.5 })));
}

// ---------------------------------------------------------------- views
const T = (s: string) => s;
async function run() {
  switch (view) {
    case 'menu': case 'coach': {
      const menu = createMenu(ctx);
      menu.show();
      (window as unknown as { menu: unknown }).menu = menu;
      if (view === 'coach') {
        const hand = (q.get('hand') ?? 'tap') as 'drag' | 'tap';
        if (hand === 'tap') topbar.show(true);
        coach(ctx, hand === 'drag'
          ? (langQ === 'de' ? 'Drag your finger left and right to steer!' : T('Веди пальцем влево-вправо, чтобы рулить комом!'))
          : T('Открыты Подарки! Нажми сюда — первый подарок бесплатно.'), {
          hand, target: menu.button((q.get('f') ?? 'cases') as Feature), modal: q.get('modal') === '1',
          where: (q.get('where') ?? undefined) as 'top' | undefined, okLabel: q.get('ok') ? 'OK' : undefined,
        });
        if (hand === 'drag') { menu.hide(); topbar.show(false); }
      }
      break;
    }
    case 'hud': {
      topbar.show(false);
      const hud = new Hud(ctx);
      hud.onQuit = log('onQuit');
      const sim = makeSim();
      hud.bind(sim, sim.player);
      hud.show(true);
      sim.start();
      sim.racers.forEach((r, k) => { r.rubber = [1, 1.06, 0.9, 1.02, 0.95][k]; });
      const secs = +(q.get('t') ?? 8);
      for (let i = 0; i < secs * 60; i++) {
        sim.racers.forEach((r, k) => { r.targetX = Math.sin(i / 90 + k) * 4; });
        sim.step(1 / 60);
      }
      sim.player.shields = 2;
      sim.player.boostT = 1.2;
      hud.update(0);
      if (q.get('melt')) { sim.player.melting = true; hud.update(0); }
      const ev = q.get('ev') ?? 'hint';
      if (ev === 'go') hud.countdown('go');
      else if (ev === 'cd') hud.countdown(2);
      else if (ev === 'flash') hud.flash(langQ === 'de' ? 'WALL SMASHED!' : 'СТЕНА ПРОБИТА!', '#9fe0ff');
      else hud.hint(langQ === 'de' ? 'Collect coins: they pay for upgrades!' : 'Собирай монеты — на них покупаются улучшения!');
      if (ev === 'pause') hud.pause();
      game.onUpdate((dt) => { if (q.get('live')) { sim.step(dt); hud.update(dt); } });
      (window as unknown as { hud: unknown; sim: unknown }).hud = hud;
      (window as unknown as { sim: unknown }).sim = sim;
      break;
    }
    case 'mm':
      topbar.show(false);
      await matchmaking(ctx, player, opponents);
      W.toast(ctx, 'matchmaking resolved', 'good');
      break;
    case 'results': {
      const place = +(q.get('place') ?? 1);
      const sim = makeSim();
      sim.start();
      for (let i = 0; i < 60 * 60 && sim.order.length < 4; i++) { sim.racers.forEach((r, k) => { r.targetX = Math.sin(i / 90 + k) * 4; }); sim.step(1 / 60); }
      // fake a finish order with the player at `place`
      const others = sim.racers.filter((r) => !r.isPlayer);
      const order: Racer[] = [...others.slice(0, place - 1), sim.player, ...others.slice(place - 1)];
      order.forEach((r, i) => { r.place = i < 4 || place === 5 ? i + 1 : 0; r.finishTime = r.place ? 31.4 + i * 1.7 : 0; });
      if (place === 5) order[4].finishTime = 0;
      sim.player.place = place;
      const passed = place <= 3;
      const choice = await showResults(ctx, {
        level: save.level, place, passed, racers: order, player: sim.player, coins: passed ? 186 : 34, collected: 41, mult: place === 1 ? 2 : 1,
        trophies: [30, 18, 8, -6, -12][place - 1], gems: place === 1 ? 5 : 0, leagueUp: place === 1 ? 1 : -1,
      });
      W.toast(ctx, `results → ${choice}`, 'good');
      break;
    }
    case 'intro':
      await introCard(ctx, (q.get('kind') ?? 'wall') as ObstacleKind);
      W.toast(ctx, 'intro closed', 'good');
      break;
    case 'intros': {
      const kinds: IntroKind[] = ['wall', 'spikes', 'fire', 'hammer', 'pusher', 'plow', 'icicle', 'gap', 'bonus', 'boost', 'ice', 'thaw', 'salt'];
      W.layer(ctx, 'screen').append(h('div', { class: 'row wrap', style: 'position:absolute;inset:20px;gap:12px;pointer-events:auto;overflow:auto' },
        ...kinds.map((k) => h('div', { class: 'col center' }, h('img', { src: introArtURL(k), style: 'width:240px;image-rendering:pixelated' }), k))));
      break;
    }
    case 'unlock': {
      const menu = createMenu(ctx);
      menu.show();
      const f = (q.get('f') ?? 'cases') as Feature;
      const go = await unlockPopup(ctx, f);
      if (go) coach(ctx, T('Нажми сюда!'), { hand: 'tap', target: menu.button(f) });
      break;
    }
  }
}
(window as unknown as { ctx: Ctx }).ctx = ctx;
void run();
(window as unknown as { __ready: boolean }).__ready = true;
