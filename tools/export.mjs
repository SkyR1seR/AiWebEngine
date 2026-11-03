// Export one game as a self-contained folder + zip with index.html at the root (for game portals).
// Usage: npm run export <name> [-- --yandex | --playgama] [-- --no-zip]
//   --yandex      inject <script src="/sdk.js"> (Yandex Games SDK) into index.html
//   --playgama    ship Playgama Bridge: copy playgama-bridge.js (from @playgama/bridge) and the game's
//                 playgama-bridge-config.json next to index.html and load the SDK before the game
//   --no-overlay  don't inject the on-screen error/boot diagnostics
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync, deflateRawSync, crc32 } from 'node:zlib';
import { build } from 'vite';

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--'));
const dir = name && ['games', 'examples'].map((d) => join(d, name)).find((d) => existsSync(join(d, 'index.html')));
if (!dir) {
  console.error('usage: npm run export <name> [-- --yandex]   (looks in games/ and examples/)');
  process.exit(1);
}
const out = resolve('export', name);
process.env.EXAMPLE = name;
await build({
  configFile: resolve('vite.config.ts'),
  root: resolve(dir),
  base: './',
  logLevel: 'warn',
  build: { outDir: out, emptyOutDir: true, manifest: false },
});

const htmlPath = join(out, 'index.html');
if (!existsSync(htmlPath)) throw new Error('build produced no index.html');
// Error overlay: shows uncaught errors / failed script loads on screen, and after 12 s reports the boot stage
// if the game never became ready (engine marks stages via <html data-boot>). Invisible when all is well.
// console.error is mirrored only until the game is ready: portal SDKs log harmless errors of their own later
// (e.g. Yandex "The data does not differ from the previous ones") that players must not see.
const OVERLAY = `<script>(function(){var b,d=document.documentElement;function s(m){try{if(!b){b=document.createElement('pre');b.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:2147483647;margin:0;padding:8px;max-height:45%;overflow:auto;background:rgba(150,0,0,.92);color:#fff;font:12px/1.4 monospace;white-space:pre-wrap;pointer-events:auto';(document.body||d).appendChild(b)}b.textContent+=m+'\\n'}catch(e){}}
addEventListener('error',function(e){var t=e.target;s(t&&t!==window&&(t.src||t.href)?'Failed to load: '+(t.src||t.href):'Error: '+e.message+(e.filename?' @ '+e.filename+':'+e.lineno:''))},true);
addEventListener('unhandledrejection',function(e){var r=e.reason;s('Unhandled: '+(r&&(r.stack||r.message)||r))});
var ce=console.error;console.error=function(){if((d.dataset.boot||'').indexOf('ready')!==0)s([].map.call(arguments,String).join(' '));return ce.apply(console,arguments)};
setTimeout(function(){var st=d.dataset.boot||'';if(st.indexOf('ready')!==0)s('Not ready after 12 s. Last boot stage: '+(st||'game script did not start'))},12000)})();</script>`;

let html = readFileSync(htmlPath, 'utf8');
const head = [];
if (!args.includes('--no-overlay')) head.push(OVERLAY);
if (args.includes('--yandex') && !html.includes('/sdk.js')) head.push('<script src="/sdk.js"></script>');
if (args.includes('--playgama')) {
  // platforms forbid external resources: the SDK runtime ships inside the archive
  const runtime = resolve('node_modules/@playgama/bridge/dist/playgama-bridge.js');
  if (!existsSync(runtime)) throw new Error('@playgama/bridge is not installed (npm i)');
  copyFileSync(runtime, join(out, 'playgama-bridge.js'));
  const cfg = join(dir, 'playgama-bridge-config.json');
  if (existsSync(cfg)) copyFileSync(cfg, join(out, 'playgama-bridge-config.json'));
  else console.warn(`warning: ${cfg} not found (Playgama Bridge runs with defaults)`);
  if (!html.includes('playgama-bridge.js')) head.push('<script src="./playgama-bridge.js"></script>');
}
if (head.length) html = html.replace('<head>', '<head>\n  ' + head.join('\n  '));
writeFileSync(htmlPath, html);

const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
walk(out);
let raw = 0, gz = 0;
for (const f of files) { const b = readFileSync(f); raw += b.length; gz += gzipSync(b, { level: 9 }).length; }
console.log(`\nExported ${dir} -> export/${name}/ (${files.length} files, ${(raw / 1024).toFixed(1)} KB, ${(gz / 1024).toFixed(1)} KB gzip)`);

if (!args.includes('--no-zip')) {
  const zip = resolve('export', `${name}.zip`);
  writeFileSync(zip, makeZip(files.map((f) => [f.slice(out.length + 1).split(/[\\/]/).join('/'), readFileSync(f)])));
  console.log(`Archive: export/${name}.zip  (index.html is at the archive root — upload this file)`);
}

/** Minimal ZIP writer (deflate, forward-slash paths — PowerShell's Compress-Archive writes backslashes that break on Linux hosts). */
function makeZip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [path, data] of entries) {
    const nameBuf = Buffer.from(path, 'utf8');
    const comp = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(0, 10); h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(nameBuf.length, 26); h.writeUInt16LE(0, 28);
    local.push(h, nameBuf, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(0, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
