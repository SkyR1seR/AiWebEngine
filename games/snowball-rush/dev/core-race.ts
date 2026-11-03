// dev harness (core): headless bot races. Run: npx vite-node games/snowball-rush/dev/core-race.ts -- <fromN> <toN> [seeds] [ease] [playerSkill]
import { generateLevel } from '../level';
import { RaceSim, type RacerSetup } from '../sim';
import { BotBrain, applyRubberBand, botSkills, makeOpponents } from '../bots';
import { baseStats } from '../config';
import type { Racer } from '../types';

export function race(n: number, seed: number, ease: number, pskill: number, log = false) {
  const L = generateLevel(n, seed, ease);
  const profs = makeOpponents({ trophies: 100, level: n + 1 }, 4, seed);
  const sk = botSkills(L, 4, seed);
  const setups: RacerSetup[] = [{ profile: { name: 'P', skin: 'noob', ball: 'snow', trophies: 100, level: 1, isBot: false }, isPlayer: true, stats: baseStats(), skill: pskill }];
  profs.forEach((p, i) => setups.push({ profile: p, isPlayer: false, stats: baseStats(), skill: sk[i] }));
  const ev = { shatter: 0, fall: 0, smash: 0, bridge: 0, overtake: 0, pshatter: 0, pfall: 0, bonus: 0, melt: 0 };
  const sim = new RaceSim(L, setups, {
    shatter: (r, c) => { if (c === 'melt') ev.melt++; else ev.shatter++; if (r.isPlayer && c !== 'melt' && c !== 'bonus') ev.pshatter++; },
    fall: (r) => { ev.fall++; if (r.isPlayer) ev.pfall++; }, smash: () => ev.smash++, bridge: () => ev.bridge++, overtake: () => ev.overtake++,
    bonus: (r) => { if (r.isPlayer) ev.bonus++; },
  });
  const brains = sim.racers.map((r, i) => new BotBrain(r, seed * 13 + i));
  const player = sim.player;
  sim.start();
  const dt = 1 / 60;
  let finishSize = 0, steps = 0;
  const maxSteps = 60 * 400;
  while (steps++ < maxSteps) {
    for (const b of brains) b.update(sim, dt);
    applyRubberBand(sim, player, ease);
    sim.step(dt);
    if (!finishSize && player.place) finishSize = player.size;
    if (sim.racers.every((r: Racer) => r.state === 'done')) break;
  }
  return { L, sim, player, ev, finishSize, steps, done: sim.racers.every((r) => r.state === 'done') };
}

const args = process.argv.slice(2).filter((a) => a !== '--');
if (args.length) {
  const [a = '0', b = '10', seeds = '10', ease = '0', ps = '0.6'] = args;
  for (let n = +a; n <= +b; n++) {
    let place = 0, top3 = 0, win = 0, time = 0, size = 0, ps_ = 0, pf = 0, mult = 0, fails = 0, ideal = 0, minBot = 1e9, maxBot = 0;
    for (let s = 0; s < +seeds; s++) {
      const R = race(n, n * 7919 + 13 + s * 101, +ease, +ps);
      if (!R.done) fails++;
      place += R.player.place; top3 += R.player.place <= 3 ? 1 : 0; win += R.player.place === 1 ? 1 : 0;
      time += R.player.finishTime; size += R.finishSize; ps_ += R.ev.pshatter; pf += R.ev.pfall; mult += R.player.mult;
      ideal += R.L.finishD / 6.4;
      for (const r of R.sim.racers) if (!r.isPlayer) { minBot = Math.min(minBot, r.finishTime); maxBot = Math.max(maxBot, r.finishTime); }
    }
    const k = +seeds;
    console.log(`n=${String(n).padStart(2)} place ${(place / k).toFixed(2)} top3 ${(top3 / k * 100).toFixed(0)}% win ${(win / k * 100).toFixed(0)}% time ${(time / k).toFixed(1)}s (ideal ${(ideal / k).toFixed(1)}) bots ${minBot.toFixed(1)}..${maxBot.toFixed(1)} size@fin ${(size / k).toFixed(1)} mult ${(mult / k).toFixed(2)} pShatter ${(ps_ / k).toFixed(1)} pFall ${(pf / k).toFixed(1)} notDone ${fails}`);
  }
}
