import { defineConfig, type Plugin } from 'vite';
import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Minify shader source: strip comments/whitespace, keep preprocessor lines intact. */
export function minifyShader(src: string): string {
  src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const lines = src.split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean);
  let out = '';
  for (let l of lines) {
    const pre = l[0] === '#';
    if (!pre) l = l.replace(/\s*([{}()[\];,=+\-*/<>:&|!?.@])\s*/g, '$1');
    if (out) {
      const prevPre = out.lastIndexOf('\n') >= 0 ? out.slice(out.lastIndexOf('\n') + 1)[0] === '#' : out[0] === '#';
      if (pre || prevPre || (/\w$/.test(out) && /^\w/.test(l))) out += '\n';
    }
    out += l;
  }
  return out;
}

function shaderPlugin(): Plugin {
  return {
    name: 'shader-minify',
    enforce: 'pre',
    transform(code, id) {
      if (!/\.(wgsl|glsl)$/.test(id)) return;
      return { code: `export default ${JSON.stringify(minifyShader(code))};`, map: null };
    },
  };
}

function htmlInputs() {
  const inputs: Record<string, string> = {};
  // EXAMPLE=runner vite build -> build a single example/game (for accurate size measurements)
  const only = process.env.EXAMPLE;
  if (only) {
    for (const dir of ['examples', 'games']) if (existsSync(`${dir}/${only}/index.html`)) inputs[only] = resolve(dir, only, 'index.html');
    return inputs;
  }
  for (const dir of ['examples', 'games']) {
    if (!existsSync(dir)) continue;
    if (existsSync(`${dir}/index.html`)) inputs[`${dir}-index`] = resolve(dir, 'index.html');
    for (const name of readdirSync(dir)) {
      const html = resolve(dir, name, 'index.html');
      if (existsSync(html)) inputs[`${dir}-${name}`] = html;
    }
  }
  return inputs;
}

export default defineConfig({
  plugins: [shaderPlugin()],
  resolve: {
    alias: [
      { find: /^aiwebengine$/, replacement: resolve('src/index.ts') },
      { find: /^aiwebengine\/(.*)$/, replacement: resolve('src/$1/index.ts') },
    ],
  },
  base: './',
  build: {
    target: 'es2022',
    modulePreload: { polyfill: false },
    manifest: true,
    minify: 'terser',
    terserOptions: {
      ecma: 2020,
      module: true,
      toplevel: true,
      compress: { passes: 3, unsafe_arrows: true, unsafe_methods: true, pure_getters: true },
      // private members are named _x and mangled (they never cross module/chunk boundaries)
      mangle: { properties: { regex: /^_/ } },
      format: { comments: false },
    },
    rollupOptions: { input: htmlInputs() },
  },
  server: { open: false },
  test: { include: ['tests/**/*.test.ts'] },
} as any);
