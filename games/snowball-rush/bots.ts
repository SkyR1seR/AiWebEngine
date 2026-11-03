// Bots that pretend to be online players (owner: core): profiles, AI steering, emotes, fake online counter. DESIGN §4.
import type { LevelData, Obstacle, Profile, Racer, RacerStats } from './types';
import { SURF, TRACK_W } from './types';
import type { RaceSim } from './sim';
import { hash, rng } from './util';
import { tr } from './i18n';
import { BASE_MAGNET, BODY_H, BODY_HALF, HAMMER_BALL, HAMMER_HEAD, HAMMER_PIVOT, ICICLE_BALL, PLOW_BALL, START_SIZE, STEER_SPEED, sizeSpeed } from './config';

export type BotEvent = 'start' | 'overtake' | 'overtaken' | 'shatter' | 'smash' | 'finish1' | 'finish' | 'fall' | 'bridge';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- profiles
/** gamer-style nicknames (international + Russian), no real people, nothing offensive */
const NICKS = (
  'Kirill_2013 СнежныйБарс Dimon_777 LizaSnow xXFrostXx Mateo_GG Yuki☆ Артём_Про Машуля_12 Vanya_Krut Ледышка Котик2014 ' +
  'Sanya_Top Nastya_Fox Егорка Misha_Bear Polina☆ Danya_2012 Тёма_007 Sonya_Snow Lev_Pro Ilya_Speed Varya_W Gleb_777 ' +
  'Alisa_Play Nikitos Vlad_GG Stepa_Win Arina_Cute Морозко Снежок_01 ЗимнийВолк ПельменьПро Ёлочка_Топ Сугроб ' +
  'Нуб_Мастер НеНуб ProNoob NoobMaster99 Noobik_2 Pro100Max IceQueen SnowFlake_x FrostyBoy BlizzardKid Polar_Bear ' +
  'PenguinPlay Snowy_Owl WinterFox Icy_Mia FrostLeo Lucas2012 Emma_Star NoahPlays Olivia_Cat Leo_Pro Mia_Mia ' +
  'ArthurKing Sofia_007 Hugo_FR Chloe_Gamer Luca_IT Giulia☆ Matteo_Win Pablo_ES Lucia_22 Diego_Rapido Valentina_V ' +
  'Santi_GG Joao_BR Ana_Clara Pedrinho Gabi_Snow Felix_DE Lena_Mops Jonas2013 Mila_Blitz Emir_TR Zeynep☆ Kerem_GG ' +
  'Elif_Kar Kuba_PL Zosia_Z Oliwer_777 Hana_JP Sora_GG Riku☆ Minji_M Jiwoo_KR Wei_Snow XiaoLong_8 Arjun_IN Priya☆ ' +
  'Budi_ID Putri_Snow Minh_VN Linh☆ Omar_Pro Layla_Star Somchai_TH Ploy☆ Taras_UA Oksana_Sun Bohdan_GG Mykola_M ' +
  'Daan_NL Sanne☆ Lars_Ice Freya_Snow Oscar_Run Ella_Bella TurboSnail CoolCat_2013 HappyPanda SpeedyTurtle ' +
  'CaptainSnow MegaBall BallRoller SnowRoller Снежный_Ком Пингвинчик Мандаринка ДедМорозик Снегурочка_7 Оливье_Топ ' +
  'Шапка_Ушанка Валенок_3000 Санки_Гонщик Мишка_Топтыжка Лисёнок GamerGirl_11 xX_Snow_Xx NightOwl LuckyDuck ' +
  'Pixel_Pete BlockyBoy Cube_Master VoxelVova Kubik_007 Sasha_Ice Katya☆ Roma_Turbo Fedya_GG Zhenya_Z Lera_Snow ' +
  'Timur_Pro Amir_2012 Dasha_Dash Yarik_Win Kostya_K Masha_Moroz Bogdan_777 Zlata☆ Vika_Vik'
).split(' ');

/** skin / ball pools by rarity tier (the catalog decides prices; here: how often opponents wear them) */
const SKIN_TIERS = [['noob', 'winter', 'skier', 'hockey'], ['penguin', 'elf', 'gingerbread', 'snowman', 'reindeer', 'iceknight', 'nutcracker'], ['santa', 'yeti', 'snowmaiden']];
const BALL_TIERS = [['snow', 'snow', 'snow', 'tangerine'], ['candy', 'ornament', 'garland', 'ice'], ['disco', 'gold', 'olivier']];
const tier = (r: () => number) => { const x = r(); return x < 0.55 ? 0 : x < 0.85 ? 1 : 2; };
const pick = <T>(r: () => number, a: readonly T[]) => a[Math.floor(r() * a.length)];

/** `n` opponent profiles around the player's trophies/level (deterministic per seed, unique nicknames) */
export function makeOpponents(player: { trophies: number; level: number }, n: number, seed: number): Profile[] {
  const r = rng(seed ^ 0xb075);
  const idx = NICKS.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const out: Profile[] = [];
  for (let i = 0; i < n; i++) {
    const st = tier(r), bt = Math.min(2, Math.max(0, st + (r() < 0.3 ? (r() < 0.5 ? -1 : 1) : 0)));
    const t = Math.max(0, Math.round(player.trophies * (0.75 + 0.5 * r()) + (player.trophies < 60 ? r() * 20 : 0)));
    out.push({
      name: NICKS[idx[i % idx.length]],
      skin: pick(r, SKIN_TIERS[st]),
      ball: pick(r, BALL_TIERS[bt]),
      trophies: t,
      level: Math.max(1, Math.round(player.level + (r() * 5 - 2))),
      isBot: true,
      vip: r() < (st === 2 ? 0.3 : 0.07),
    });
  }
  return out;
}

/** skills of the bots of a race: around level.botSkill, spread out (one a bit better, one a bit worse) */
export function botSkills(level: LevelData, n: number, seed: number): number[] {
  const r = rng(seed ^ 0x5c11), base = level.botSkill;
  const top = level.n === 0 ? 0.15 : 0.95;
  return Array.from({ length: n }, (_, i) => clamp(base + (n > 1 ? (i / (n - 1) - 0.5) * 0.2 : 0) + (r() - 0.5) * 0.06, 0.05, top));
}

/**
 * Bot upgrades follow the player's: a share of each upgrade bonus (50% on easy levels … 85% on hard ones), so upgrades
 * still pay off but the races stay close.
 */
export function botStats(player: RacerStats, level: LevelData): RacerStats {
  const f = lerp(0.5, 0.85, clamp((level.botSkill - 0.2) / 0.65, 0, 1));
  return {
    speedMul: 1 + (player.speedMul - 1) * f,
    growMul: 1 + (player.growMul - 1) * f,
    meltMul: 1 - (1 - player.meltMul) * f,
    startSize: START_SIZE + Math.max(0, player.startSize - START_SIZE) * f,
    magnet: BASE_MAGNET + Math.max(0, player.magnet - BASE_MAGNET) * f,
    shields: Math.floor(player.shields * f),
  };
}

// ---------------------------------------------------------------- AI
const LANES = TRACK_W;
const NONE: Obstacle[] = [];
/** lane score per row of each surface code under the lane (snow, ice, thaw, salt, boost) */
const SURF_SCORE = [0.04, 0.012, -0.35, -0.7, 1.2];

/**
 * Bot steering: call update every fixed step; sets racer.targetX.
 * Every reaction period (0.5 s at skill 0 … 0.12 s at skill 1) it scores the 13 lanes over a lookahead window
 * (10–30 m): surfaces, pickups, obstacles (smash if the ball is big enough, avoid otherwise, moving ones predicted at the
 * time of arrival). The lateral position reachable before each obstacle is taken into account, so far lanes don't look
 * safe when a hazard is close. Lower skill: shorter lookahead, slower reactions, noisy targets, more mistakes.
 */
export class BotBrain {
  private _rnd: () => number;
  private _t = 0;
  private _goal: number;
  private _greed: number;
  private _score = new Float32Array(LANES);
  /** racer x at planning time; timing error of this plan for moving obstacles (weak bots misjudge timing) */
  private _x = 0;
  private _tErr = 0;

  constructor(public racer: Racer, seed: number) {
    this._rnd = rng(seed);
    this._goal = racer.x;
    this._greed = 0.5 + this._rnd() * 1.2;
    this._t = this._rnd() * 0.3;
  }

  update(sim: RaceSim, dt: number): void {
    const r = this.racer;
    if (r.state === 'finished' || r.state === 'done' || r.state === 'ready' || r.state === 'fall') return;
    const sk = clamp(r.skill, 0, 1);
    this._t -= dt;
    if (this._t <= 0) {
      this._t = lerp(0.5, 0.12, sk) * (0.75 + 0.5 * this._rnd());
      this._plan(sim, sk);
    }
    const rate = lerp(5, 10, sk) * dt;
    r.targetX += clamp(this._goal - r.targetX, -rate, rate);
  }

  private _plan(sim: RaceSim, sk: number) {
    const r = this.racer, L = sim.level, S = this._score, rnd = this._rnd;
    const size = r.size > 0 ? r.size : r.stats.startSize, rad = size / 10;
    const v = Math.max(3, r.speed), look = lerp(10, 30, sk);
    const d0 = r.ballD + rad, dEnd = d0 + look;
    // a mistake: believes the ball is bigger than it is (tries a wall it can't break)
    const judge = size + (rnd() < 0.2 * (1 - sk) ? 2 + 5 * rnd() : 0);
    const greed = this._greed * (rnd() < 0.2 ? 2.5 : 1);
    this._tErr = (rnd() - 0.5) * 0.9 * (1 - sk);
    for (let c = 0; c < LANES; c++) S[c] = -0.12 * Math.abs(c - 6 - r.x) + (Math.abs(c - 6 - this._goal) < 0.6 ? 0.6 : 0);

    // surfaces under each lane (growth matters more while the ball is small)
    const grow = size < 18 ? 1 : 0.35;
    for (let row = Math.max(0, Math.floor(d0)); row < Math.min(L.length, dEnd); row++) {
      for (let c = 0, i = row * TRACK_W; c < LANES; c++, i++) {
        const code = L.surface[i];
        S[c] += code === SURF.snow ? SURF_SCORE[0] * grow : SURF_SCORE[code] ?? 0;
      }
    }

    // obstacles: each lane is a path (steering at max rate toward the lane), checked while the ball/body pass
    this._x = r.x;
    for (let i = sim.obstacleIndex(r.d); i < sim.obs.length; i++) {
      const o = sim.obs[i];
      if (o.d - o.len > dEnd) break;
      if (o.d + o.len < r.ballD - rad) continue;
      // a wall row is scored once, from its first section (sections can be broken individually)
      if (o.kind === 'wall' ? o !== sim.nextWallRow(o.d - 0.01)?.[0] : sim.broken.has(o.id)) continue;
      const tA = Math.max(0, o.d - o.len - d0) / v, tB = Math.max(tA, (o.d + o.len - r.ballD + rad) / v), tC = Math.max(tB, (o.d + o.len + BODY_HALF - r.d) / v);
      // near obstacles dominate: far ones can still be dodged later (replanning), and their timing is uncertain
      const wgt = clamp(1 - (o.d - o.len - d0 - 6) / 10, 0.2, 1);
      for (let c = 0; c < LANES; c++) S[c] += wgt * this._cost(sim, o, c - 6, size, judge, rad, tA, tB, tC, sk);
    }

    // keep out of the way of racers alongside (they push each other)
    for (const q of sim.racers) {
      if (q === r || (q.state !== 'run' && q.state !== 'stun') || Math.abs(q.d - r.d) > 3 + rad + q.size / 10) continue;
      const room = (rad + q.size / 10) * 0.8 + 0.6;
      for (let c = 0; c < LANES; c++) { const dx = Math.abs(c - 6 - q.x); if (dx < room) S[c] -= 3 * (1 - dx / room); }
    }

    // pickups
    for (let i = sim.pickupIndex(r.d); i < sim.pk.length; i++) {
      const p = sim.pk[i];
      if (p.d > dEnd) break;
      if (p.d < r.d || sim.taken.has(p.id)) continue;
      const tArr = Math.max(0, p.d - r.ballD) / v, val = p.kind === 'coin' ? 0.45 * greed : p.kind === 'gem' ? 5 : 4;
      for (let c = 0; c < LANES; c++) if (Math.abs(this._at(c - 6, tArr) - p.x) < rad * 0.8 + 0.6) S[c] += val;
    }

    // pick the best lane (sometimes a mistake)
    let best = 0;
    for (let c = 1; c < LANES; c++) if (S[c] > S[best]) best = c;
    if (rnd() < 0.2 * Math.pow(1 - sk, 1.5)) {
      // a mistake: a random nearby lane that doesn't look terrible
      const c = clamp(best + Math.round((rnd() - 0.5) * 6), 0, LANES - 1);
      if (S[c] > S[best] - 8) best = c;
    }
    let goal = best - 6 + (rnd() - 0.5) * 1.4 * (1 - sk);
    // aim at the middle of the chosen wall section: the ball center decides which section it hits
    const row = sim.nextWallRow(r.ballD - rad - 0.6);
    if (row && row[0].d - d0 < look) {
      for (const o of row) {
        if (Math.abs(best - 6 - o.x) > o.w) continue;
        const m = Math.min(0.5, o.w * 0.5);
        goal = clamp(goal, o.x - o.w + m, o.x + o.w - m);
        break;
      }
    }
    this._goal = clamp(goal, -6.1, 6.1);
  }

  /** lateral position reached by time t when steering at full rate toward lane x */
  private _at(lx: number, t: number): number {
    const reach = STEER_SPEED * 0.85 * Math.max(0, t - 0.05);
    return this._x + clamp(lx - this._x, -reach, reach);
  }

  /**
   * score contribution of obstacle `o` for the path toward lane lx: the ball overlaps it during tA..tB, the body passes
   * it until tC (seconds from now)
   */
  private _cost(sim: RaceSim, o: Obstacle, lx: number, size: number, judge: number, rad: number, tA: number, tB: number, tC: number, sk: number): number {
    const m = 0.15 + 0.35 * sk, xa = this._at(lx, tA), xb = this._at(lx, tB), xc = this._at(lx, tC);
    // lateral range swept by the ball while it overlaps the obstacle (lo..hi), and until the body has passed (loC..hiC)
    const lo = Math.min(xa, xb), hi = Math.max(xa, xb), loC = Math.min(xa, xc), hiC = Math.max(xa, xc);
    switch (o.kind) {
      case 'wall': {
        // the ball center decides the section: smashable sections on the path cost size, others are fatal
        let cost = 0;
        for (const w of sim.nextWallRow(o.d - 0.01) ?? NONE) {
          if (sim.broken.has(w.id)) continue;
          const left = sim.strengthLeft(w), x0 = w.x - w.w, x1 = w.x + w.w;
          if (judge >= left) { if (hi >= x0 && lo <= x1) cost -= 0.12 * left; }
          else if (hi >= x0 - m && lo <= x1 + m) return -60;
        }
        return cost;
      }
      case 'spikes': {
        const R = o.w + Math.max(rad * 0.75, BODY_HALF) + m;
        if (o.x < loC - R || o.x > hiC + R) return 0;
        const left = sim.strengthLeft(o);
        return judge >= left ? -0.12 * left : -60;
      }
      case 'fire': {
        const R = o.w + rad * 0.9 + m;
        if (o.x < loC - R || o.x > hiC + R) return 0;
        const left = sim.strengthLeft(o);
        return judge >= left ? -0.12 * left : size < 8 ? -40 : -12;
      }
      case 'gap':
        if (sim.bridgeAt(o, xa)) return 6;
        return judge >= o.strength ? -0.15 * size : -35;
      case 'pusher': {
        const left = sim.strengthLeft(o), R = (o.amp ?? 0) + o.w + rad;
        if (judge >= left) return o.x < loC - R || o.x > hiC + R ? 0 : -0.12 * left;
      }
      // falls through: moving obstacles are checked along the path over the pass window
      case 'plow':
      case 'hammer':
      case 'icicle':
        for (let t = tA - 0.15; t <= tC + 0.1; t += 0.15) if (this._hits(sim, o, sim.time + t + this._tErr, this._at(lx, t), rad, m)) return -60;
        return 0;
      default:
        return 0;
    }
  }

  /** would a moving obstacle touch a ball/racer at lateral position x at time t (when they pass it)? */
  private _hits(sim: RaceSim, o: Obstacle, t: number, x: number, rad: number, m: number): boolean {
    switch (o.kind) {
      case 'hammer': {
        const th = sim.hammerAngle(o, t), hx = o.x + o.w * Math.sin(th), hy = HAMMER_PIVOT - o.w * Math.cos(th), R = HAMMER_HEAD + rad * HAMMER_BALL + m;
        return (x - hx) ** 2 + (rad - hy) ** 2 < R * R || (hy - HAMMER_HEAD < BODY_H + m && Math.abs(x - hx) < HAMMER_HEAD + BODY_HALF + m);
      }
      case 'icicle':
        return sim.icicleState(o, t).hit && Math.abs(x - o.x) < o.w + Math.max(rad * ICICLE_BALL, BODY_HALF) + m;
      default:
        return Math.abs(x - sim.obstacleX(o, t)) < o.w + Math.max(rad * (o.kind === 'plow' ? PLOW_BALL : 0.8), BODY_HALF) + m;
    }
  }
}

/**
 * Rubber band: set racer.rubber of bots each step from their distance to the player (0.9..1.1). Bots far ahead slow
 * down, bots far behind speed up; easy levels and retries (ease) favor the player more. Finished racers are skipped.
 */
export function applyRubberBand(sim: RaceSim, player: Racer, ease = 0): void {
  const L = sim.level, tut = L.n === 0;
  // eased difficulty of the level (botSkill = 0.2 + 0.65 k)
  const k = clamp((L.botSkill - 0.2) / 0.65, 0, 1);
  const slow = lerp(0.1, 0.06, k) + 0.05 * ease, fast = lerp(0.015, 0.03, k) * (1 - 1.2 * ease);
  const base = 1 - 0.012 * (1 - k) - 0.03 * ease;
  for (const r of sim.racers) {
    if (r.isPlayer || r === player || r.state === 'finished' || r.state === 'done') continue;
    // weaker bots run a bit slower than a decent player, strong ones a bit faster; easy levels are slower overall
    let target = base + PACE * (r.skill - 0.45);
    if (!player.place) {
      const gap = r.d - player.d;
      target *= gap > 0 ? 1 - slow * smooth(gap / 14) : 1 + fast * smooth(-gap / 18);
      // the first race: near the player bots are clearly slower (big balls are slow: compare the size factors too)
      if (tut && gap > -4) target = Math.min(target, (0.95 * sizeSpeed(player.size)) / sizeSpeed(r.size) - 0.06 * smooth((gap + 4) / 10));
    }
    r.rubber += (clamp(target, 0.9, 1.1) - r.rubber) * 0.05;
  }
}
/** how much bot skill changes its pace */
const PACE = 0.04;

// ---------------------------------------------------------------- emotes
const CHANCE: Record<BotEvent, number> = { start: 0.3, overtake: 0.3, overtaken: 0.25, shatter: 0.35, smash: 0.1, finish1: 0.75, finish: 0.35, fall: 0.45, bridge: 0.25 };

function lines(ev: BotEvent): string[] {
  switch (ev) {
    case 'start': return tr({ ru: ['Погнали!', 'Всем удачи!', 'Го!', 'Я первый 😎', '🎄', 'Всем привет!', 'Ну держитесь!'], en: ["Let's go!", 'Good luck all!', 'Go go go!', "I'm winning this 😎", '🎄', 'Hi everyone!', 'Watch out!'] });
    case 'overtake': return tr({ ru: ['Пока-пока! 👋', 'Хе-хе', '😎', 'Слишком медленно!', 'Догоняй!', 'ахах'], en: ['Bye-bye! 👋', 'Hehe', '😎', 'Too slow!', 'Catch me!', 'lol'] });
    case 'overtaken': return tr({ ru: ['Эй!', 'Нечестно!', '😤', 'Ещё догоню!', 'Ого, быстро', 'Ну ладно...'], en: ['Hey!', 'Not fair!', '😤', "I'll catch up!", 'Whoa, fast', 'Oh well...'] });
    case 'shatter': return tr({ ru: ['Ой!', 'Мой ком!', '😭', 'Нееет!', 'Лаги!', 'Да как так?!'], en: ['Oops!', 'My snowball!', '😭', 'Nooo!', 'Lag!', 'How?!'] });
    case 'smash': return tr({ ru: ['Бум!', '💪', 'Изи!', 'Сила!', '❄️'], en: ['Boom!', '💪', 'Easy!', 'Power!', '❄️'] });
    case 'finish1': return tr({ ru: ['GG', 'Я первый! 🏆', 'Изи катка', 'GG WP', '🥇'], en: ['GG', 'First place! 🏆', 'Easy win', 'GG WP', '🥇'] });
    case 'finish': return tr({ ru: ['GG', 'gg', 'Хорошая гонка!', '👍', 'Почти...', 'С Новым годом! 🎄'], en: ['GG', 'gg', 'Nice race!', '👍', 'So close...', 'Happy New Year! 🎄'] });
    case 'fall': return tr({ ru: ['Бульк!', 'Холодно! 🥶', 'Ааа!', '😱', 'Ну вот...'], en: ['Splash!', 'So cold! 🥶', 'Aaah!', '😱', 'Oh no...'] });
    case 'bridge': return tr({ ru: ['Мост готов!', 'Пользуйтесь 😉', 'Держите мост!', '🌉'], en: ['Bridge is ready!', "You're welcome 😉", 'Built a bridge!', '🌉'] });
  }
}

/** maybe an emote/chat text for a bot event (null = stay silent) */
export function emoteFor(ev: BotEvent, rnd: () => number): string | null {
  if (rnd() >= (CHANCE[ev] ?? 0)) return null;
  const l = lines(ev);
  return l[Math.floor(rnd() * l.length)] ?? null;
}

/** fake "players online" number for a timestamp (smooth day/night curve + jitter by minute), 8 000–25 000 */
export function onlineCount(now: number): number {
  const t = new Date(now), h = t.getHours() + t.getMinutes() / 60;
  const f = 0.5 + 0.5 * Math.cos(((h - 19.5) / 24) * 2 * Math.PI);
  const week = t.getDay() === 0 || t.getDay() === 6 ? 1.06 : 1;
  const jitter = (hash('m' + Math.floor(now / 60000)) % 601) - 300;
  return Math.round(clamp((8600 + 15000 * f) * week + jitter, 8000, 25000));
}
