import { build } from 'esbuild';
import { resolve } from 'node:path';
const entry = process.argv[2];
const r = await build({
  entryPoints: [entry], bundle: true, minify: true, format: 'esm', write: false, metafile: true, splitting: true, outdir: 'x',
  loader: { '.wgsl': 'text', '.glsl': 'text' }, target: 'es2022',
  alias: { aiwebengine: resolve('src/index.ts') },
  plugins: [{ name: 'sub', setup(b) { b.onResolve({ filter: /^aiwebengine\// }, (a) => ({ path: resolve('src', a.path.slice(12), 'index.ts') })); } }],
});
const out = Object.values(r.metafile.outputs).find((o) => o.entryPoint);
const rows = Object.entries(out.inputs).map(([k, v]) => [k, v.bytesInOutput]).sort((a, b) => b[1] - a[1]);
let t = 0; for (const [, b] of rows) t += b;
for (const [k, b] of rows.slice(0, 25)) console.log(String(b).padStart(7), k);
console.log('total', t);
