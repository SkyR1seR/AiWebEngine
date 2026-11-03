// Dev harness for the world part (WorldView, RacerView, RaceCamera, Lobby, fx). Not part of the game build.
// URL: ?lv=0..4 (levels 0, 2, 4, 8, 14) | ?n=<level number> ; &theme=0..3 ; &t=<seconds to fast-forward> ; &view=lobby ;
//      &follow=<racer index> ; &intro=1 ; &lang=en ; &stats=0 ; &pause=1 (freeze the sim after the fast-forward)
// Keys: 1-5 level, T theme, F +5 s, G +20 s, L lobby, C cheer, I intro, B shake, P pause, V next racer, E emote.
import { createGame } from 'aiwebengine';
import { UI } from 'aiwebengine/ui';
import { generateLevel } from '../level';
import { RaceSim, type RacerSetup } from '../sim';
import { BotBrain, applyRubberBand, botSkills, botStats, emoteFor, makeOpponents } from '../bots';
import { baseStats } from '../config';
import { WorldView, setupEnv } from '../world';
import { RacerView } from '../racerview';
import { RaceCamera } from '../camera';
import { Lobby } from '../lobby';
import { loadSkinAssets } from '../skinart';
import { FONT, applyTheme, fitUI } from '../theme';
import { setLang } from '../i18n';
import type { LevelData } from '../types';

const q = new URLSearchParams(location.search);
setLang(q.get('lang') ?? 'ru');
const LEVELS = [0, 2, 4, 8, 14];

const game = await createGame({ antialias: true });
await loadSkinAssets();
const ui = new UI(game, { font: FONT });
applyTheme();
fitUI(ui, game);
const env = setupEnv(game);
const cam = new RaceCamera(game);
cam.env = env;
const lobby = new Lobby(game, env);

let level!: LevelData, sim!: RaceSim, world!: WorldView, views: RacerView[] = [], brains: BotBrain[] = [];
let follow = +(q.get('follow') ?? -1);
let paused = false, inLobby = false;
let themeOverride = q.has('theme') ? +q.get('theme')! : -1;
const rnd = Math.random;

function build(n: number) {
  world?.destroy();
  for (const v of views) v.destroy();
  level = generateLevel(n);
  if (themeOverride >= 0) level.theme = themeOverride;
  env.setTheme(level.theme);
  const stats = baseStats();
  const opp = makeOpponents({ trophies: 120, level: n + 1 }, 4, level.seed);
  const skills = botSkills(level, 4, level.seed);
  const setups: RacerSetup[] = [
    { profile: { name: 'Нубик', skin: 'noob', ball: 'snow', trophies: 120, level: n + 1, isBot: false }, isPlayer: true, stats, skill: 0.7 },
    ...opp.map((p, i) => ({ profile: p, isPlayer: false, stats: botStats(stats, level), skill: skills[i] })),
  ];
  const t0 = performance.now();
  sim = new RaceSim(level, setups, {
    shatter: (r) => { views[r.id]?.shatter(); if (r === target()) cam.shake(0.35); maybeEmote(r.id, 'shatter'); },
    smash: (r, o) => { world.onSmash(o); views[r.id]?.smash(); if (r === target()) cam.shake(0.25); },
    bridge: (r, o, x0, x1) => { world.onBridge(o, x0, x1); maybeEmote(r.id, 'bridge'); },
    fall: (r) => { views[r.id]?.splash(); maybeEmote(r.id, 'fall'); },
    pickup: (r, p, power) => { world.onPickup(p); views[r.id]?.pickup(power ?? p.kind); },
    bonus: (r, o) => { world.onSmash(o); views[r.id]?.smash(); },
    finish: (r, place) => maybeEmote(r.id, place === 1 ? 'finish1' : 'finish'),
    overtake: (a) => maybeEmote(a.id, 'overtake'),
  });
  world = new WorldView(game, level);
  const t1 = performance.now();
  views = sim.racers.map((r) => new RacerView(game, ui, r, { label: true }));
  brains = sim.racers.map((r, i) => new BotBrain(r, level.seed + i * 101));
  sim.racers.forEach((r) => (r.skill = r.isPlayer ? 0.75 : r.skill));
  info.build = `level ${n} built in ${(t1 - t0).toFixed(0)} ms, len ${level.length}, obstacles ${level.obstacles.length}`;
  sim.start();
  cam.reset(target());
}
function target() { return follow >= 0 ? sim.racers[follow % sim.racers.length] : sim.player; }
function maybeEmote(id: number, ev: Parameters<typeof emoteFor>[0]) {
  if (sim.racers[id].isPlayer) return;
  const t = emoteFor(ev, rnd);
  if (t) views[id]?.emote(t);
}
function step(dt: number) {
  for (const b of brains) b.update(sim, dt);
  applyRubberBand(sim, sim.player, level.ease ?? 0);
  sim.step(dt);
}
/** simulate `s` seconds instantly */
function ff(s: number) { for (let i = 0; i < s * 60; i++) step(1 / 60); }

const info = { build: '' };
game.onFixedUpdate((dt) => { if (!paused && !inLobby && !cam.flying) step(dt); });
game.onUpdate((dt) => {
  if (inLobby) { lobby.update(dt); return; }
  world.update(sim, dt);
  for (const v of views) v.update(dt);
});
// &camd=NN: fixed chase camera at distance NN (inspect obstacles), &camx / &cams = its x / ball size
const camd = q.has('camd') ? { x: +(q.get('camx') ?? 0), d: +q.get('camd')!, size: +(q.get('cams') ?? 6), targetX: +(q.get('camx') ?? 0) } as unknown as import('../types').Racer : null;
game.onLateUpdate((dt) => { if (!inLobby) { if (camd) cam.reset(camd); else cam.update(target(), dt); } });
const statsEl = document.getElementById('stats')!;
if (q.get('stats') === '0') statsEl.style.display = 'none';
let acc = 0;
game.onRender((dt) => {
  acc += dt;
  if (acc < 0.25) return;
  acc = 0;
  const s = game.renderer.stats, p = target();
  statsEl.textContent = `${game.renderer.device.kind} fps ${game.time.fps.toFixed(0)} draws ${s.draws} (shadow ${s.shadowDraws}) tris ${(s.triangles / 1000).toFixed(0)}k meshes ${s.meshes}\n` +
    (inLobby ? 'lobby' : `lv ${level.n} theme ${level.theme} t ${sim.time.toFixed(1)} d ${p.d.toFixed(0)}/${level.finishD} size ${p.size.toFixed(1)} ${p.state}`) + `\n${info.build}`;
});

function setLobby(on: boolean) {
  inLobby = on;
  if (on) { world.root.visible = false; for (const v of views) v.root.visible = false; lobby.enter(); document.querySelectorAll<HTMLElement>('.ui-wl').forEach((e) => (e.style.visibility = 'hidden')); }
  else { lobby.leave(); world.root.visible = true; for (const v of views) v.root.visible = true; env.setTheme(level.theme); document.querySelectorAll<HTMLElement>('.ui-wl').forEach((e) => (e.style.visibility = '')); }
}

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k >= '1' && k <= '5') build(LEVELS[+k - 1]);
  else if (k === 't') { themeOverride = (level.theme + 1) % 4; level.theme = themeOverride; env.setTheme(themeOverride); }
  else if (k === 'f') ff(5);
  else if (k === 'g') ff(20);
  else if (k === 'l') setLobby(!inLobby);
  else if (k === 'c') lobby.cheer();
  else if (k === 'i') void cam.intro(sim, 2.5);
  else if (k === 'b') cam.shake(0.6);
  else if (k === 'p') paused = !paused;
  else if (k === 'v') follow = (Math.max(0, follow) + 1) % 5;
  else if (k === 'e') views[1].emote('GG 😎');
});

build(q.has('n') ? +q.get('n')! : LEVELS[+(q.get('lv') ?? 0)] ?? 0);
if (q.has('t')) ff(+q.get('t')!);
if (q.get('pause') === '1') paused = true;
if (q.get('view') === 'lobby') setLobby(true);
if (q.get('intro') === '1') void cam.intro(sim, 2.5);
Object.assign(window, { dev: { game, get sim() { return sim; }, get world() { return world; }, cam, lobby, env, ff, build, setLobby, views: () => views } });
(window as any).devReady = true;
