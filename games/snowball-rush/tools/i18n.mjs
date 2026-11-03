// Localization tool for Snowball Rush.
//   node games/snowball-rush/tools/i18n.mjs            → writes tools/strings.json: every English UI string (+ Russian
//                                                        counterpart and file) found in { ru, en } object literals
//   node games/snowball-rush/tools/i18n.mjs --check    → reports missing / obsolete / broken keys of lang/<code>.json
// Keys are the English strings; template literals become "{0}", "{1}"... in order of the ${} parts (see i18n.ts).
import ts from 'typescript';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const langDir = join(root, 'lang');
const files = readdirSync(root).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));
const warnings = new Set();

/** collect strings from an expression (the en side); `path` lists positions so the ru side can be aligned */
function collect(node, out, sf, path = '') {
  if (!node) return;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression?.(node)) return collect(node.expression, out, sf, path);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) { out.push([path, node.text]); return; }
  if (ts.isTemplateExpression(node)) {
    let s = node.head.text;
    node.templateSpans.forEach((sp, i) => { s += `{${i}}` + sp.literal.text; });
    out.push([path, s]);
    return;
  }
  if (ts.isArrayLiteralExpression(node)) { node.elements.forEach((e, i) => collect(e, out, sf, `${path}[${i}]`)); return; }
  if (ts.isObjectLiteralExpression(node)) {
    for (const p of node.properties) {
      if (ts.isPropertyAssignment(p)) collect(p.initializer, out, sf, `${path}.${p.name.getText(sf)}`);
      else if (ts.isMethodDeclaration(p) && p.body) collectBody(p.body, out, sf, `${path}.${p.name.getText(sf)}()`);
    }
    return;
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    if (ts.isBlock(node.body)) collectBody(node.body, out, sf, path + '()');
    else collect(node.body, out, sf, path + '()');
    return;
  }
  if (ts.isConditionalExpression(node)) { collect(node.whenTrue, out, sf, path + '?'); collect(node.whenFalse, out, sf, path + ':'); return; }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    warnings.add(`${sf.fileName.split('/').pop()}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}: string glued with "+" inside en: — use a template literal`);
    collect(node.left, out, sf, path + '+l');
    collect(node.right, out, sf, path + '+r');
  }
}
function collectBody(block, out, sf, path) {
  let i = 0;
  const visit = (n) => {
    if (ts.isReturnStatement(n) && n.expression) collect(n.expression, out, sf, `${path}#${i++}`);
    else if (!ts.isFunctionLike(n)) ts.forEachChild(n, visit);
  };
  ts.forEachChild(block, visit);
}

const entries = new Map();
for (const f of files) {
  const sf = ts.createSourceFile(join(root, f), readFileSync(join(root, f), 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const prop = (name) => node.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === name);
      const en = prop('en'), ru = prop('ru');
      if (en && ru) {
        const enS = [], ruS = [];
        collect(en.initializer, enS, sf);
        collect(ru.initializer, ruS, sf);
        const ruBy = new Map(ruS);
        for (const [p, s] of enS) {
          if (!/\p{L}/u.test(s.replace(/\{\d+\}/g, ''))) continue; // nothing to translate
          const e = entries.get(s) ?? { en: s, ru: ruBy.get(p) ?? '', files: [] };
          if (!e.files.includes(f)) e.files.push(f);
          entries.set(s, e);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

const list = [...entries.values()].sort((a, b) => a.files[0].localeCompare(b.files[0]) || a.en.localeCompare(b.en));
const placeholders = (s) => (s.match(/\{\d+\}/g) ?? []).sort().join();

if (process.argv.includes('--check')) {
  let bad = 0;
  const langs = existsSync(langDir) ? readdirSync(langDir).filter((f) => /^[a-z]{2}\.json$/.test(f)) : [];
  for (const lf of langs) {
    const d = JSON.parse(readFileSync(join(langDir, lf), 'utf8'));
    const missing = list.filter((e) => typeof d[e.en] !== 'string' || !d[e.en].trim());
    const obsolete = Object.keys(d).filter((k) => !entries.has(k));
    const broken = list.filter((e) => typeof d[e.en] === 'string' && placeholders(d[e.en]) !== placeholders(e.en));
    if (missing.length || broken.length) bad++;
    console.log(`${lf}: ${list.length - missing.length}/${list.length} translated, ${missing.length} missing, ${broken.length} placeholder mismatches, ${obsolete.length} obsolete`);
    for (const e of missing.slice(0, 8)) console.log('   missing: ' + JSON.stringify(e.en));
    for (const e of broken.slice(0, 8)) console.log('   broken:  ' + JSON.stringify(e.en) + ' → ' + JSON.stringify(d[e.en]));
  }
  for (const w of warnings) console.log('warning: ' + w);
  process.exit(bad ? 1 : 0);
} else {
  writeFileSync(join(root, 'tools', 'strings.json'), JSON.stringify(list, null, 1) + '\n');
  console.log(`${list.length} strings from ${files.length} files → tools/strings.json`);
  for (const w of warnings) console.log('warning: ' + w);
}
