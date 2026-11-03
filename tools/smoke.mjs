// Smoke test of an exported game the way a portal runs it: cross-origin iframe + fake Yandex SDK + headless Chrome.
// Passes when the game reaches `ya.ready()` (engine logs "[aiwe] ready...") on both WebGPU and WebGL2.
// Usage: npm run smoke <name> [-- --playgama] [-- --export]
//   (run `npm run export <name> -- --yandex` (or `-- --playgama`) first, or pass --export)
//   --playgama: the export ships Playgama Bridge; it runs on its mock platform here (no fake SDK needed)
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';

/** Async spawn (spawnSync would block the in-process HTTP servers). */
function run(cmd, argv, timeout) {
  return new Promise((ok) => {
    const p = spawn(cmd, argv);
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    const t = setTimeout(() => p.kill(), timeout);
    p.on('close', () => { clearTimeout(t); ok({ stdout, stderr }); });
  });
}

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--'));
if (!name) { console.error('usage: npm run smoke <name> [-- --export]'); process.exit(1); }
const pg = args.includes('--playgama');
if (args.includes('--export') || !existsSync(`export/${name}/index.html`)) execFileSync('node', ['tools/export.mjs', name, pg ? '--playgama' : '--yandex', '--no-zip'], { stdio: 'inherit' });
const root = resolve('export', name);

const FAKE_SDK = `window.YaGames={init:function(){return new Promise(function(r){setTimeout(function(){r({environment:{i18n:{lang:'ru'}},on:function(){},
features:{LoadingAPI:{ready:function(){console.log('FAKE-SDK LoadingAPI.ready')}},GameplayAPI:{start:function(){},stop:function(){}}},
adv:{showFullscreenAdv:function(o){o.callbacks.onClose(false)},showRewardedVideo:function(o){o.callbacks.onClose()}},
getPlayer:function(){return Promise.resolve({getData:function(){return Promise.resolve({})},setData:function(){return Promise.resolve()}})}})},500)})}};`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2' };

const servers = [];
const serve = (port, handler) => new Promise((ok) => { const s = createServer(handler).listen(port, ok); servers.push(s); });
// game origin (like app-XXXX.games.s3.yandex.net): /sdk.js at the root, game under /game/
await serve(8812, (req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/sdk.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(FAKE_SDK); }
  let p = join(root, decodeURIComponent(url.replace(/^\/game/, '')));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
  res.end(readFileSync(p));
});
// portal origin: parent page with the game iframe; /slow keeps the load event open so Chrome doesn't exit early
await serve(8811, (req, res) => {
  if (req.url.startsWith('/slow')) return setTimeout(() => { res.writeHead(200, { 'content-type': 'image/gif' }); res.end(); }, 10000);
  const q = req.url.includes('webgl2') ? '?backend=webgl2' : '';
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><body style="margin:0"><iframe src="http://127.0.0.1:8812/game/index.html${q}" style="width:400px;height:700px;border:0"></iframe><img src="/slow"></body>`);
});

const chrome = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => existsSync(p));
if (!chrome) { console.error('Chrome/Edge not found'); process.exit(1); }

let failed = false;
for (const mode of ['webgpu', 'webgl2']) {
  const prof = mkdtempSync(join(tmpdir(), 'aiwe-smoke-'));
  const r = await run(chrome, ['--headless=new', '--enable-unsafe-webgpu', `--user-data-dir=${prof}`, '--enable-logging=stderr', '--v=0',
    '--dump-dom', `http://localhost:8811/${mode === 'webgl2' ? '?webgl2' : ''}`], 60000);
  rmSync(prof, { recursive: true, force: true });
  const lines = `${r.stderr || ''}\n${r.stdout || ''}`.split('\n').filter((l) => l.includes('CONSOLE')).map((l) => l.replace(/.*CONSOLE:?\(?\d*\)?\]\s*/, '').replace(/, source:.*/, ''));
  const boot = lines.filter((l) => l.includes('[aiwe]'));
  const errors = lines.filter((l) => /error|uncaught|unhandled/i.test(l) && !l.includes('GL Driver'));
  const ok = boot.some((l) => l.includes('ready'));
  console.log(`\n${ok ? 'PASS' : 'FAIL'} ${mode}`);
  for (const l of boot) console.log('  ' + l);
  for (const l of errors) console.log('  ! ' + l);
  if (!ok) failed = true;
}
for (const s of servers) s.close();
process.exit(failed ? 1 : 0);
