// One-off refactor: rename `private x` members to `private _x` (+ `this.x` -> `this._x`) so terser can mangle them.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
for (const f of walk('src').filter((f) => f.endsWith('.ts'))) {
  let s = readFileSync(f, 'utf8');
  const names = [...new Set([...s.matchAll(/^\s+private (?:readonly )?([a-zA-Z]\w*)[?]?[:= ;(<]/gm)].map((m) => m[1]))];
  if (!names.length) continue;
  for (const n of names) {
    s = s.replace(new RegExp(String.raw`^(\s+private (?:readonly )?)${n}\b`, 'gm'), `$1_${n}`);
    s = s.replace(new RegExp(String.raw`\bthis\.${n}\b`, 'g'), `this._${n}`);
  }
  writeFileSync(f, s);
  console.log(f, names.length);
}
