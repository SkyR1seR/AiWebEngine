// dev harness (core): trace shatters of skilled bots
import { generateLevel, wallRows } from '../level';
import { RaceSim, type RacerSetup } from '../sim';
import { BotBrain } from '../bots';
import { baseStats } from '../config';
const [n, skill, kind] = process.argv.slice(2).filter((x) => x !== '--');
let shown = 0;
for (let s = 0; s < 10 && shown < 14; s++) {
  const L = generateLevel(+n, +n * 7919 + 13 + s * 101, 0);
  const setups: RacerSetup[] = [0, 1, 2, 3, 4].map((i) => ({ profile: { name: 'b' + i, skin: 'noob', ball: 'snow', trophies: 0, level: 1, isBot: i > 0 }, isPlayer: i === 0, stats: baseStats(), skill: +skill }));
  let sim!: RaceSim;
  sim = new RaceSim(L, setups, {
    shatter: (r, c, o) => {
      if (!o || (kind && c !== kind) || shown++ > 14) return;
      const row = c === 'wall' ? wallRows(L).find((w) => w[0].id <= o.id && w[w.length - 1].id >= o.id)! : [o];
      console.log(`seed${s} t=${sim.time.toFixed(2)} r${r.id} ${c} size=${r.size.toFixed(1)} left=${sim.strengthLeft(o).toFixed(1)} ballX=${r.ballX.toFixed(2)} x=${r.x.toFixed(2)} tx=${r.targetX.toFixed(2)} stateT=${r.stateT.toFixed(2)} st=${r.state} | ${row.map((w) => `[${(w.x - w.w).toFixed(1)}..${(w.x + w.w).toFixed(1)}:${sim.strengthLeft(w).toFixed(0)}${sim.broken.has(w.id) ? 'X' : ''}]`).join(' ')} ${c === 'hammer' ? 'th=' + sim.hammerAngle(o).toFixed(2) + ' ox=' + o.x.toFixed(1) : ''}`);
    },
  });
  const brains = sim.racers.map((r, i) => new BotBrain(r, s * 7 + i));
  sim.start();
  for (let k = 0; k < 60 * 300 && !sim.racers.every((r) => r.state === 'done'); k++) { for (const br of brains) br.update(sim, 1 / 60); sim.step(1 / 60); }
}
