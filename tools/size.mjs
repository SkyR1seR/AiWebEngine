// Builds every example/game on its own (like a shipped game) and reports gzip/brotli sizes:
// app chunk (engine + game code) + the backend chunk loaded at runtime (only one of webgpu/webgl2).
// Usage: npm run size [-- name ...]
import { readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { join } from 'node:path';
import { build } from 'vite';

const names = process.argv.slice(2).length ? process.argv.slice(2)
  : ['examples', 'games'].flatMap((d) => (existsSync(d) ? readdirSync(d).filter((n) => existsSync(join(d, n, 'index.html'))) : []));
const measure = (file) => {
  const b = readFileSync(file);
  return { gz: gzipSync(b, { level: 9 }).length, br: brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length };
};
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const rows = [];
for (const name of names) {
  const out = join('node_modules/.size', name);
  process.env.EXAMPLE = name;
  await build({ logLevel: 'silent', build: { outDir: out, emptyOutDir: true } });
  const files = readdirSync(join(out, 'assets')).filter((f) => f.endsWith('.js'));
  const pick = (re) => files.filter((f) => re.test(f)).map((f) => measure(join(out, 'assets', f))).reduce((a, b) => ({ gz: a.gz + b.gz, br: a.br + b.br }), { gz: 0, br: 0 });
  const app = pick(/^(?!webgpu|webgl2)/), gpu = pick(/^webgpu/), gl = pick(/^webgl2/);
  rows.push([name, app, gpu, gl]);
  rmSync(out, { recursive: true, force: true });
}
console.log('\n' + ['example', 'app', '+webgpu', '+webgl2', 'total gzip', 'total brotli'].map((h, i) => (i ? h.padStart(14) : h.padEnd(16))).join(''));
for (const [n, a, g, l] of rows) {
  console.log(n.padEnd(16) + [a.gz, g.gz, l.gz, a.gz + Math.max(g.gz, l.gz), a.br + Math.max(g.br, l.br)].map((v) => kb(v).padStart(14)).join(''));
}
console.log('\n(total = app + the larger backend; only one backend is downloaded at runtime)\n');
