// dev harness (core): grouped balance table. Run: npx vite-node games/snowball-rush/dev/core-balance.ts -- [seeds] [skill]
import { race } from './core-race';
const [seeds = '12', ps = '0.6'] = process.argv.slice(2).filter((a) => a !== '--');
const groups: [number, number][] = [[0, 0], [1, 5], [6, 15], [16, 30], [31, 60]];
for (const ease of [0, 0.3]) for (const [a, b] of groups) {
  let n_ = 0, place = 0, top3 = 0, win = 0, time = 0, size = 0, shat = 0;
  for (let n = a; n <= b; n += b - a > 10 ? 3 : 1) for (let s = 0; s < +seeds; s++) {
    const R = race(n, n * 7919 + 13 + s * 101, ease, +ps);
    n_++; place += R.player.place; top3 += R.player.place <= 3 ? 1 : 0; win += R.player.place === 1 ? 1 : 0;
    time += R.player.finishTime / (R.L.finishD / 6.4); size += R.finishSize; shat += R.ev.pshatter;
  }
  console.log(`ease ${ease} levels ${a}-${b}: place ${(place / n_).toFixed(2)} top3 ${(top3 / n_ * 100).toFixed(0)}% win ${(win / n_ * 100).toFixed(0)}% time/ideal ${(time / n_).toFixed(2)} size@finish ${(size / n_).toFixed(1)} shatters ${(shat / n_).toFixed(2)} (${n_} races)`);
}
