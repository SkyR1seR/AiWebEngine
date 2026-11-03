// dev harness (core): ASCII dump of a level + stats. Run: npx vite-node games/snowball-rush/dev/core-dump.ts -- <n> [seed] [ease]
import { generateLevel, expectedSizes, wallRows } from '../level';
import { TRACK_W } from '../types';

const [n = '0', seed, ease = '0'] = process.argv.slice(2).filter((a) => a !== '--');
const L = generateLevel(+n, seed ? +seed : undefined, +ease);
const E = expectedSizes(L);
const SYM: Record<string, string> = { wall: '#', spikes: '^', fire: 'F', hammer: 'H', pusher: 'P', plow: 'W', icicle: 'I', gap: '~', bonus: 'B' };
const lines: string[] = [];
for (let r = Math.min(L.length - 1, L.finishD + 14); r >= 0; r--) {
  const row: string[] = [];
  for (let c = 0; c < TRACK_W; c++) row.push(['.', '-', 't', 's', '>'][L.surface[r * TRACK_W + c]]);
  for (const p of L.pickups) if (Math.floor(p.d) === r) row[Math.min(12, Math.max(0, Math.floor(p.x + 6.5)))] = p.kind === 'coin' ? 'o' : p.kind === 'gem' ? '*' : 'G';
  const notes: string[] = [];
  for (const o of L.obstacles) {
    if (Math.floor(o.d) !== r && !(o.kind === 'gap' && r >= Math.floor(o.d - o.len) && r <= Math.floor(o.d + o.len))) continue;
    const c0 = Math.max(0, Math.floor(o.x - o.w + 6.5)), c1 = Math.min(12, Math.floor(o.x + o.w + 6.5 - 1e-6));
    const ext = o.kind === 'hammer' || o.kind === 'icicle' ? 0 : 1;
    for (let c = ext ? c0 : Math.floor(o.x + 6.5); c <= (ext ? c1 : Math.floor(o.x + 6.5)); c++) row[Math.max(0, Math.min(12, c))] = SYM[o.kind];
    notes.push(`${o.kind}${isFinite(o.strength) ? ':' + o.strength : ''}${o.speed ? ' v' + o.speed.toFixed(1) : ''}${o.reward ? ' [' + o.reward + ']' : ''}`);
  }
  lines.push(`${String(r).padStart(3)} ${r === L.finishD ? '=' : '|'}${row.join('')}| E${E[r].toFixed(1).padStart(5)} ${notes.join(', ')}`);
}
console.log(lines.join('\n'));
const cnt = (k: string) => L.pickups.filter((p) => p.kind === k).length;
console.log(`n=${L.n} seed=${L.seed} ease=${ease} finish=${L.finishD} len=${L.length} obstacles=${L.obstacles.length} coins=${cnt('coin')} gifts=${cnt('gift')} gems=${cnt('gem')} botSkill=${L.botSkill.toFixed(2)}`);
console.log('wall rows:', wallRows(L).map((r) => `${r[0].d.toFixed(0)}:[${r.map((o) => o.strength).join(',')}] E=${E[Math.floor(r[0].d)].toFixed(1)}`).join('  '));
