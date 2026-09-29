export type Defines = Record<string, number | boolean | string | undefined>;

/**
 * Tiny line-based shader preprocessor shared by WGSL and GLSL.
 * Supports: #if EXPR / #ifdef X / #ifndef X / #elif EXPR / #else / #endif, where EXPR uses
 * identifiers, numbers, !, &&, ||, parentheses. `{{NAME}}` is replaced by the define value.
 */
export function preprocess(src: string, defs: Defines): string {
  const out: string[] = [];
  // stack entries: [active, anyTaken, parentActive]
  const stack: [boolean, boolean, boolean][] = [];
  let active = true;
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (t[0] === '#') {
      const m = /^#(\w+)\s*(.*)$/.exec(t);
      const d = m ? m[1] : '';
      const arg = m ? m[2] : '';
      if (d === 'if' || d === 'ifdef' || d === 'ifndef') {
        const v = d === 'if' ? evalExpr(arg, defs) : d === 'ifdef' ? !!defs[arg] : !defs[arg];
        stack.push([active && v, v, active]);
        active = active && v;
        continue;
      }
      if (d === 'elif' || d === 'else' || d === 'endif') {
        const top = stack[stack.length - 1];
        if (!top) throw new Error('shader: unmatched #' + d);
        if (d === 'endif') {
          stack.pop();
          active = top[2];
        } else {
          const v = !top[1] && (d === 'else' || evalExpr(arg, defs));
          top[0] = top[2] && v;
          top[1] = top[1] || v;
          active = top[0];
        }
        continue;
      }
    }
    if (active) out.push(line.indexOf('{{') >= 0 ? line.replace(/\{\{(\w+)\}\}/g, (_, k) => String(defs[k] ?? 0)) : line);
  }
  if (stack.length) throw new Error('shader: missing #endif');
  return out.join('\n');
}

function evalExpr(expr: string, defs: Defines): boolean {
  const toks = expr.match(/\|\||&&|!|\(|\)|\w+/g) || [];
  let i = 0;
  const val = (t: string) => (/^\d/.test(t) ? +t !== 0 : !!defs[t]);
  const prim = (): boolean => {
    const t = toks[i++];
    if (t === '!') return !prim();
    if (t === '(') { const v = or(); i++; return v; }
    return val(t);
  };
  const and = (): boolean => { let v = prim(); while (toks[i] === '&&') { i++; const r = prim(); v = v && r; } return v; };
  const or = (): boolean => { let v = and(); while (toks[i] === '||') { i++; const r = and(); v = v || r; } return v; };
  return or();
}
