import { defineConfig, type Plugin } from 'vite';
import { readdirSync, existsSync, writeFileSync } from 'node:fs';
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

/**
 * Fail the build if a lazily loaded chunk (e.g. the webgpu/webgl2 backend) imports from an entry chunk.
 * Game entries use top-level await (`await createGame()`), so such an import deadlocks at runtime:
 * the entry waits for the dynamic import, the dynamic chunk waits for the entry to finish evaluating.
 */
function noDynamicToEntryImports(): Plugin {
  return {
    name: 'no-dynamic-to-entry-imports',
    apply: 'build',
    generateBundle(_, bundle) {
      const entries = new Set(Object.values(bundle).filter((c: any) => c.type === 'chunk' && c.isEntry).map((c) => c.fileName));
      for (const c of Object.values(bundle) as any[]) {
        if (c.type !== 'chunk' || !c.isDynamicEntry || c.isEntry) continue;
        const bad = c.imports.filter((i: string) => entries.has(i));
        if (bad.length) {
          this.error(`Lazy chunk ${c.fileName} imports from entry chunk ${bad.join(', ')} (modules: ${Object.keys(c.modules).map((m) => m.split(/[\\/]src[\\/]/).pop()).join(', ')}). ` +
            'This deadlocks with top-level await in the game entry. Pass the needed values at runtime (see BackendEnv in src/gpu/device.ts) instead of importing them.');
        }
      }
    },
  };
}

/**
 * Dev-only endpoint for in-browser editors: POST /__aiwe/save?file=games/<name>/<file>.json with the JSON body
 * writes that file (only .json files inside games/).
 */
function devSave(): Plugin {
  return {
    name: 'dev-save-json',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__aiwe/save', (req, res) => {
        const file = new URL(req.url ?? '', 'http://x').searchParams.get('file') ?? '';
        const abs = resolve(file);
        if (req.method !== 'POST' || file.includes('..') || !/^games\/[\w-]+\/[\w/-]+\.json$/.test(file) || !abs.startsWith(resolve('games'))) {
          res.statusCode = 400;
          res.end('bad request');
          return;
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            JSON.parse(body);
            writeFileSync(abs, body);
            res.end('ok');
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
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
  plugins: [shaderPlugin(), noDynamicToEntryImports(), devSave()],
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
