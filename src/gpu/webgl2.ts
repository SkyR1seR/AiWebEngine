import type {
  BindLayout, BindResource, CreateDeviceOptions, Device, GpuBindGroup, GpuBuffer, GpuPipeline, GpuTexture,
  PassDesc, PipelineDesc, RenderPass, TexFormat, TextureDesc, VertexBufferLayout,
} from './device';
import { preprocess } from './preprocess';
import { glslLib } from '../shaders/glsl';

interface GLBuf extends GpuBuffer { b: WebGLBuffer; t: number }
interface GLTex extends GpuTexture { t: WebGLTexture; id: number }
interface BindGroup_ extends GpuBindGroup { layout: BindLayout; resources: BindResource[] }
interface GLPipe extends GpuPipeline {
  prog: WebGLProgram;
  d: PipelineDesc;
  buffers: VertexBufferLayout[];
  locs: number[];
  key: string;
}

const HEADER = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2DShadow;\n';

export function createWebGL2Device(canvas: HTMLCanvasElement, opts: CreateDeviceOptions): Device {
  const gl = canvas.getContext('webgl2', {
    antialias: opts.antialias ?? true,
    alpha: false,
    depth: true,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: opts.powerPreference ?? 'high-performance',
  }) as WebGL2RenderingContext;
  if (!gl) throw new Error('WebGL2 not supported');
  const halfFloat = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); console.error('WebGL context lost'); });

  const programs = new Map<string, WebGLProgram>();
  const fbos = new Map<string, WebGLFramebuffer>();
  let texId = 0;
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  // --- cached state ---
  let curPipe: GLPipe | null = null;
  let curProg: WebGLProgram | null = null;
  let enabledLocs: number[] = [];
  const slotBuf: (GLBuf | null)[] = [];
  const slotOff: number[] = [];
  let slotLayoutKey = '';
  let blendState = '';
  let cullState = '';
  let depthState = '';

  const fmt = (f: TexFormat): [number, number, number] => {
    switch (f) {
      case 'rgba8srgb': return [gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE];
      case 'rgba16f': return [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT];
      case 'depth24': return [gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT];
      case 'depth32f': return [gl.DEPTH_COMPONENT32F, gl.DEPTH_COMPONENT, gl.FLOAT];
      default: return [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE];
    }
  };

  function compile(type: number, src: string) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      console.error(src.split('\n').map((l, i) => i + 1 + ': ' + l).join('\n'));
      throw new Error('GLSL compile error: ' + log);
    }
    return s;
  }

  function program(vs: string, fs: string) {
    const key = vs + '\0' + fs;
    let p = programs.get(key);
    if (p) return p;
    p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('GLSL link error: ' + gl.getProgramInfoLog(p));
    programs.set(key, p);
    return p;
  }

  function fbo(color: GLTex | null, depth: GLTex | null) {
    const key = (color?.id ?? -1) + ':' + (depth?.id ?? -1);
    let f = fbos.get(key);
    if (!f) {
      f = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      if (color) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color.t, 0);
      if (depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth.t, 0);
      gl.drawBuffers([color ? gl.COLOR_ATTACHMENT0 : gl.NONE]);
      gl.readBuffer(color ? gl.COLOR_ATTACHMENT0 : gl.NONE);
      fbos.set(key, f);
    }
    return f;
  }

  function applyPipelineState(d: PipelineDesc) {
    const b = d.blend ?? 'opaque';
    if (b !== blendState) {
      blendState = b;
      if (b === 'opaque') gl.disable(gl.BLEND);
      else {
        gl.enable(gl.BLEND);
        if (b === 'alpha') gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        else if (b === 'add') gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
        else if (b === 'premult') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        else gl.blendFunc(gl.DST_COLOR, gl.ZERO);
      }
    }
    const c = d.cull ?? 'back';
    if (c !== cullState) {
      cullState = c;
      if (c === 'none') gl.disable(gl.CULL_FACE);
      else { gl.enable(gl.CULL_FACE); gl.cullFace(c === 'back' ? gl.BACK : gl.FRONT); }
    }
    const ds = `${d.depthTest ?? true}${d.depthWrite ?? true}${d.depthCompare ?? 'less'}${d.depthBias ?? 0}/${d.depthBiasSlope ?? 0}`;
    if (ds !== depthState) {
      depthState = ds;
      if (d.depthTest ?? true) {
        gl.enable(gl.DEPTH_TEST);
        const cmp = d.depthCompare ?? 'less';
        gl.depthFunc(cmp === 'less' ? gl.LESS : cmp === 'lequal' ? gl.LEQUAL : gl.ALWAYS);
      } else gl.disable(gl.DEPTH_TEST);
      gl.depthMask(d.depthWrite ?? true);
      if (d.depthBias || d.depthBiasSlope) {
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(d.depthBiasSlope ?? 0, d.depthBias ?? 0);
      } else gl.disable(gl.POLYGON_OFFSET_FILL);
    }
  }

  /** Point attributes of all slots at currently bound buffers. */
  function setupAttribs(p: GLPipe) {
    for (let s = 0; s < p.buffers.length; s++) {
      const buf = slotBuf[s];
      if (!buf) continue;
      const l = p.buffers[s];
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.b);
      for (const a of l.attrs) {
        const [n, type, norm] =
          a.format === 'unorm8x4' ? [4, gl.UNSIGNED_BYTE, true] : [a.format === 'float32' ? 1 : +a.format.slice(-1), gl.FLOAT, false];
        gl.vertexAttribPointer(a.loc, n, type, norm, l.stride, a.offset + (slotOff[s] || 0));
        gl.vertexAttribDivisor(a.loc, l.step === 'instance' ? 1 : 0);
      }
    }
  }

  const dev: Device = {
    kind: 'webgl2',
    canvas,
    lib: glslLib,
    width: canvas.width,
    height: canvas.height,
    caps: {
      halfFloatTarget: halfFloat,
      uboAlign: gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    },
    resize(w, h) {
      canvas.width = dev.width = w;
      canvas.height = dev.height = h;
    },
    createBuffer(usage, sizeOrData) {
      const t = usage === 'vertex' ? gl.ARRAY_BUFFER : usage === 'index' ? gl.ELEMENT_ARRAY_BUFFER : gl.UNIFORM_BUFFER;
      const b = gl.createBuffer()!;
      if (t === gl.ELEMENT_ARRAY_BUFFER) gl.bindVertexArray(null);
      gl.bindBuffer(t, b);
      const size = typeof sizeOrData === 'number' ? sizeOrData : sizeOrData.byteLength;
      if (typeof sizeOrData === 'number') gl.bufferData(t, sizeOrData, gl.DYNAMIC_DRAW);
      else gl.bufferData(t, sizeOrData, usage === 'uniform' ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
      if (t === gl.ELEMENT_ARRAY_BUFFER) gl.bindVertexArray(vao);
      return { size, b, t } as GLBuf;
    },
    writeBuffer(buf, data, offset = 0, size) {
      const b = buf as GLBuf;
      if (b.t === gl.ELEMENT_ARRAY_BUFFER) gl.bindVertexArray(null);
      gl.bindBuffer(b.t, b.b);
      gl.bufferSubData(b.t, offset, new Uint8Array(data.buffer, data.byteOffset, size ?? data.byteLength));
      if (b.t === gl.ELEMENT_ARRAY_BUFFER) gl.bindVertexArray(vao);
    },
    destroyBuffer(b) { gl.deleteBuffer((b as GLBuf).b); },
    createTexture(d: TextureDesc) {
      const t = gl.createTexture()!;
      const format = d.format ?? 'rgba8';
      const [ifmt, f, type] = fmt(format);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      if (d.data && !ArrayBuffer.isView(d.data)) gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, f, type, d.data as TexImageSource);
      else gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, d.width, d.height, 0, f, type, (d.data as ArrayBufferView) ?? null);
      const wrap = d.wrap === 'repeat' ? gl.REPEAT : d.wrap === 'mirror' ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE;
      const lin = (d.filter ?? 'linear') === 'linear';
      const isDepth = format.startsWith('depth');
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, lin && (!isDepth || d.compare) ? gl.LINEAR : gl.NEAREST);
      if (d.mips) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, lin ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST_MIPMAP_NEAREST);
        if (aniso && lin) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);
      } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, lin && (!isDepth || d.compare) ? gl.LINEAR : gl.NEAREST);
      if (d.compare) {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      }
      return { width: d.width, height: d.height, format, t, id: texId++ } as GLTex;
    },
    destroyTexture(t) {
      gl.deleteTexture((t as GLTex).t);
      const id = (t as GLTex).id;
      for (const [k, f] of fbos) if (k.split(':').includes(String(id))) { gl.deleteFramebuffer(f); fbos.delete(k); }
    },
    createPipeline(d) {
      const defs = d.defines ?? {};
      const vs = HEADER + preprocess(d.code, { ...defs, VERTEX: 1 });
      const fs = HEADER + preprocess(d.code, { ...defs, FRAGMENT: 1 });
      const prog = program(vs, fs);
      gl.useProgram(prog);
      curProg = prog;
      d.groups.forEach((g, gi) => {
        let u = 0, t = 0;
        for (const e of g.entries) {
          if (e.kind === 'ubo' || e.kind === 'dyn') {
            const idx = gl.getUniformBlockIndex(prog, e.name);
            if (idx !== gl.INVALID_INDEX) gl.uniformBlockBinding(prog, idx, gi * 4 + u);
            u++;
          } else {
            const loc = gl.getUniformLocation(prog, e.name);
            if (loc) gl.uniform1i(loc, gi * 4 + t);
            t++;
          }
        }
      });
      const locs = d.buffers.flatMap((b) => b.attrs.map((a) => a.loc));
      const key = JSON.stringify(d.buffers);
      return { prog, d, buffers: d.buffers, locs, key } as GLPipe;
    },
    createBindGroup(layout: BindLayout, resources: BindResource[]) {
      return { layout, resources } as BindGroup_;
    },
    beginPass(p: PassDesc): RenderPass {
      const color = p.color === 'screen' || p.color === undefined ? null : (p.color as GLTex | null);
      const depth = p.depth === 'screen' || !p.depth ? null : (p.depth as GLTex);
      const toScreen = p.color === 'screen' || (p.color === undefined && !depth);
      gl.bindFramebuffer(gl.FRAMEBUFFER, toScreen ? null : fbo(color, depth));
      const w = toScreen ? dev.width : (color ?? depth)!.width;
      const h = toScreen ? dev.height : (color ?? depth)!.height;
      gl.viewport(0, 0, w, h);
      let mask = 0;
      if (p.clear && (color || toScreen)) {
        gl.clearColor(p.clear[0], p.clear[1], p.clear[2], p.clear[3] ?? 1);
        gl.colorMask(true, true, true, true);
        mask |= gl.COLOR_BUFFER_BIT;
      }
      if (p.clearDepth) {
        gl.depthMask(true);
        depthState = '';
        mask |= gl.DEPTH_BUFFER_BIT;
      }
      if (mask) gl.clear(mask);
      let indexType: number = gl.UNSIGNED_SHORT;
      let indexSize = 2;
      let dirtyAttribs = true;
      const pass: RenderPass = {
        setPipeline(pp) {
          const pipe = pp as GLPipe;
          if (pipe === curPipe) return;
          curPipe = pipe;
          if (curProg !== pipe.prog) { gl.useProgram(pipe.prog); curProg = pipe.prog; }
          applyPipelineState(pipe.d);
          if (pipe.key !== slotLayoutKey) {
            for (const l of enabledLocs) if (!pipe.locs.includes(l)) gl.disableVertexAttribArray(l);
            for (const l of pipe.locs) if (!enabledLocs.includes(l)) gl.enableVertexAttribArray(l);
            enabledLocs = pipe.locs;
            dirtyAttribs = true;
          }
        },
        setBindGroup(gi, g, dyn) {
          const bg = g as BindGroup_;
          let u = 0, t = 0, k = 0;
          bg.layout.entries.forEach((e, i) => {
            const r = bg.resources[i] as any;
            if (e.kind === 'ubo' || e.kind === 'dyn') {
              const buf = (r.buffer ?? r) as GLBuf;
              const off = (r.offset ?? 0) + (e.kind === 'dyn' ? dyn![k++] : 0);
              if (r.size) gl.bindBufferRange(gl.UNIFORM_BUFFER, gi * 4 + u, buf.b, off, r.size);
              else gl.bindBufferBase(gl.UNIFORM_BUFFER, gi * 4 + u, buf.b);
              u++;
            } else {
              gl.activeTexture(gl.TEXTURE0 + gi * 4 + t);
              gl.bindTexture(gl.TEXTURE_2D, (r as GLTex).t);
              t++;
            }
          });
        },
        setVertexBuffer(slot, b, offset = 0) {
          if (slotBuf[slot] !== b || slotOff[slot] !== offset) {
            slotBuf[slot] = b as GLBuf;
            slotOff[slot] = offset;
            dirtyAttribs = true;
          }
        },
        setIndexBuffer(b, f) {
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, (b as GLBuf).b);
          indexType = f === 'uint16' ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
          indexSize = f === 'uint16' ? 2 : 4;
        },
        draw(count, instances = 1, first = 0) {
          if (dirtyAttribs || curPipe!.key !== slotLayoutKey) { setupAttribs(curPipe!); slotLayoutKey = curPipe!.key; dirtyAttribs = false; }
          const mode = curPipe!.d.topology === 'lines' ? gl.LINES : gl.TRIANGLES;
          gl.drawArraysInstanced(mode, first, count, instances);
        },
        drawIndexed(count, instances = 1, first = 0) {
          if (dirtyAttribs || curPipe!.key !== slotLayoutKey) { setupAttribs(curPipe!); slotLayoutKey = curPipe!.key; dirtyAttribs = false; }
          const mode = curPipe!.d.topology === 'lines' ? gl.LINES : gl.TRIANGLES;
          gl.drawElementsInstanced(mode, count, indexType, first * indexSize, instances);
        },
        end() {},
      };
      return pass;
    },
    submit() {
      curPipe = null;
    },
    destroy() {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
  return dev;
}
