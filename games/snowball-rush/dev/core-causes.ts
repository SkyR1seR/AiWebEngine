// dev harness (core): shatter causes per racer per race by AI skill. Run: npx vite-node games/snowball-rush/dev/core-causes.ts -- <fromN> <toN> <skill>
import { generateLevel } from '../level';
import { RaceSim, type RacerSetup } from '../sim';
import { BotBrain } from '../bots';
import { baseStats } from '../config';
const [a, b, skill] = process.argv.slice(2).filter((x) => x !== '--').map(Number);
const causes: Record<string, number> = {};
let races = 0;
for (let n = a; n <= b; n++) for (let s = 0; s < 20; s++) {
  const L = generateLevel(n, n * 7919 + 13 + s * 101, 0);
  const setups: RacerSetup[] = [0, 1, 2, 3, 4].map((i) => ({ profile: { name: 'b' + i, skin: 'noob', ball: 'snow', trophies: 0, level: 1, isBot: i > 0 }, isPlayer: i === 0, stats: baseStats(), skill }));
  const sim = new RaceSim(L, setups, { shatter: (r, c, o) => { const key = c + (o && (c === 'wall' || c === 'spikes' || c === 'pusher') ? (r.size < (o.strength) ? '' : '') : ''); causes[key] = (causes[key] ?? 0) + 1; } , fall: () => { causes.fall = (causes.fall ?? 0) + 1; } });
  const brains = sim.racers.map((r, i) => new BotBrain(r, s * 7 + i));
  sim.start(); races++;
  for (let k = 0; k < 60 * 300 && !sim.racers.every((r) => r.state === 'done'); k++) { for (const br of brains) br.update(sim, 1 / 60); sim.step(1 / 60); }
}
console.log('per racer per race:', Object.entries(causes).map(([k, v]) => `${k}=${(v / races / 5).toFixed(2)}`).join(' '));
