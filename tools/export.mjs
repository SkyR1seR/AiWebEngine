// Export one game as a self-contained folder + zip with index.html at the root (for game portals).
// Usage: npm run export <name> [-- --yandex] [-- --no-zip]
//   --yandex  inject <script src="/sdk.js"> (Yandex Games SDK) into index.html
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs';
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
if (args.includes('--yandex')) {
  let html = readFileSync(htmlPath, 'utf8');
  if (!html.includes('/sdk.js')) html = html.replace('<head>', '<head>\n  <script src="/sdk.js"></script>');
  writeFileSync(htmlPath, html);
}

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
