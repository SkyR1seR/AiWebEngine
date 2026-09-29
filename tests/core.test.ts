import { describe, it, expect } from 'vitest';
import { preprocess } from '../src/gpu/preprocess';
import { minifyShader } from '../vite.config';
import {
  m4, m4compose, m4invert, m4mul, m4decompose, qeuler, quat, v3, v3transformMat4, qslerp, m4perspective, color,
} from '../src/core/math';
import { tween, tweens, Ease, wait } from '../src/anim/tween';
import { AnimationClip, Animator } from '../src/anim/animator';
import { Node } from '../src/scene/node';

describe('preprocess', () => {
  it('handles nested #if/#elif/#else and substitution', () => {
    const src = ['a', '#if A', 'b', '#if !B', 'c', '#endif', '#elif C && D', 'd', '#else', 'e', '#endif', 'n={{N}}'].join('\n');
    expect(preprocess(src, { A: 1, N: 4 })).toBe('a\nb\nc\nn=4');
    expect(preprocess(src, { A: 1, B: 1 })).toBe('a\nb\nn=0');
    expect(preprocess(src, { C: 1, D: 1 })).toBe('a\nd\nn=0');
    expect(preprocess(src, { C: 1 })).toBe('a\ne\nn=0');
    expect(preprocess('#if (A || B) && !C\nx\n#endif', { B: 1 })).toBe('x');
  });
  it('minifier keeps preprocessor lines', () => {
    const m = minifyShader('// c\nfn f() {\n  let x = 1.0; /* y */\n#if A\n  x = 2.0;\n#endif\n}\n');
    expect(m).toBe('fn f(){let x=1.0;\n#if A\nx=2.0;\n#endif\n}');
    expect(preprocess(m, { A: 1 })).toContain('x=2.0;');
  });
});

describe('math', () => {
  it('compose/decompose/invert roundtrip', () => {
    const q = qeuler(quat(), 0.3, 1.2, -0.4);
    const m = m4compose(m4(), [1, 2, 3], q, [2, 2, 2]);
    const t = v3(), r = quat(), s = v3();
    m4decompose(m, t, r, s);
    expect([...t]).toEqual([1, 2, 3].map((x) => expect.closeTo(x, 5)));
    expect(s[0]).toBeCloseTo(2, 5);
    const d = Math.abs(r[0] * q[0] + r[1] * q[1] + r[2] * q[2] + r[3] * q[3]);
    expect(d).toBeCloseTo(1, 5);
    const id = m4mul(m4(), m, m4invert(m4(), m));
    for (let i = 0; i < 16; i++) expect(id[i]).toBeCloseTo(i % 5 === 0 ? 1 : 0, 5);
  });
  it('perspective maps near->0 far->1', () => {
    const p = m4perspective(m4(), 1, 1, 0.5, 100);
    expect(v3transformMat4(v3(), [0, 0, -0.5], p)[2]).toBeCloseTo(0, 5);
    expect(v3transformMat4(v3(), [0, 0, -100], p)[2]).toBeCloseTo(1, 5);
  });
  it('slerp midpoint', () => {
    const a = qeuler(quat(), 0, 0, 0), b = qeuler(quat(), 0, Math.PI / 2, 0);
    const m = qslerp(quat(), a, b, 0.5);
    const e = qeuler(quat(), 0, Math.PI / 4, 0);
    for (let i = 0; i < 4; i++) expect(m[i]).toBeCloseTo(e[i], 5);
  });
  it('color converts sRGB to linear', () => {
    const c = color(0xff8000);
    expect(c[0]).toBeCloseTo(1, 5);
    expect(c[1]).toBeCloseTo(0.2158, 3);
  });
});

describe('tween', () => {
  it('animates and resolves', async () => {
    const o = { x: 0 };
    let done = false;
    tween(o, { x: 10 }, 1, { ease: 'linear' }).then(() => (done = true));
    tweens.update(0.5);
    expect(o.x).toBeCloseTo(5);
    tweens.update(0.6);
    expect(o.x).toBe(10);
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(true);
    expect(Ease.bounceOut(1)).toBeCloseTo(1);
    const w = wait(0.2);
    tweens.update(0.25);
    await w;
  });
});

describe('animator', () => {
  it('samples and crossfades', () => {
    const root = new Node();
    const bone = root.add(new Node('bone'));
    const up = new AnimationClip('up', [{ target: 'bone', path: 'position', times: new Float32Array([0, 1]), values: new Float32Array([0, 0, 0, 0, 2, 0]) }]);
    const side = new AnimationClip('side', [{ target: 'bone', path: 'position', times: new Float32Array([0, 1]), values: new Float32Array([4, 0, 0, 4, 0, 0]) }]);
    const a = new Animator(root, [up, side]);
    a.play('up', { fade: 0 });
    a.update(0.5);
    expect(bone.position[1]).toBeCloseTo(1);
    let ended = false;
    a.on('loop', () => (ended = true));
    a.update(0.6);
    expect(ended).toBe(true);
    a.play('side', { fade: 1 });
    a.update(0.5);
    expect(bone.position[0]).toBeCloseTo(2, 1);
    a.update(0.6);
    expect(bone.position[0]).toBeCloseTo(4);
    expect(a.actions.size).toBe(1);
  });
});
