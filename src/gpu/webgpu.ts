import type {
  BindLayout, CreateDeviceOptions, Device, GpuBindGroup, GpuBuffer, GpuPipeline, GpuTexture, PassDesc,
  PipelineDesc, RenderPass, TexFormat, TextureDesc,
} from './device';
import { layoutKey } from './device';
import type { preprocess as Preprocess } from './preprocess';
import { wgslLib } from '../shaders/wgsl';

interface WBuf extends GpuBuffer { b: GPUBuffer }
interface WTex extends GpuTexture { t: GPUTexture; v: GPUTextureView; s: GPUSampler }

const FORMATS: Record<TexFormat, GPUTextureFormat> = {
  rgba8: 'rgba8unorm', rgba8srgb: 'rgba8unorm-srgb', rgba16f: 'rgba16float', depth24: 'depth24plus', depth32f: 'depth32float',
};
const BLENDS: Record<string, GPUBlendState> = {
  alpha: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } },
  add: { color: { srcFactor: 'src-alpha', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } },
  premult: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } },
  multiply: { color: { srcFactor: 'dst', dstFactor: 'zero' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } },
};
const MIP_WGSL = `@group(0)@binding(0)var t:texture_2d<f32>;@group(0)@binding(1)var s:sampler;
struct O{@builtin(position)p:vec4f,@location(0)uv:vec2f}
@vertex fn vs_main(@builtin(vertex_index)i:u32)->O{let uv=vec2f(f32((i<<1u)&2u),f32(i&2u));var o:O;o.p=vec4f(uv*2.-1.,0.,1.);o.uv=vec2f(uv.x,1.-uv.y);return o;}
@fragment fn fs_main(i:O)->@location(0)vec4f{return textureSample(t,s,i.uv);}`;

export async function createWebGPUDevice(canvas: HTMLCanvasElement, opts: CreateDeviceOptions, preprocess: typeof Preprocess): Promise<Device | null> {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: opts.powerPreference ?? 'high-performance' });
  if (!adapter) return null;
  const gpu = await adapter.requestDevice();
  const ctx = canvas.getContext('webgpu');
  if (!ctx) return null;
  const screenFormat = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device: gpu, format: screenFormat, alphaMode: 'opaque' });
  gpu.addEventListener('uncapturederror', (e) => console.error('WebGPU:', (e as GPUUncapturedErrorEvent).error.message));
  const samples = opts.antialias ?? true ? 4 : 1;
  const VIS = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;

  const bglCache = new Map<string, GPUBindGroupLayout>();
  const modules = new Map<string, GPUShaderModule>();
  let msaaTex: GPUTexture | null = null;
  let depthTex: GPUTexture | null = null;
  let encoder: GPUCommandEncoder | null = null;
  let screenView: GPUTextureView | null = null;
  const mipPipes = new Map<string, GPURenderPipeline>();
  let mipSampler: GPUSampler | null = null;

  function bgl(l: BindLayout) {
    const key = layoutKey(l);
    let g = bglCache.get(key);
    if (!g) {
      const entries: GPUBindGroupLayoutEntry[] = [];
      let b = 0;
      for (const e of l.entries) {
        if (e.kind === 'ubo' || e.kind === 'dyn') entries.push({ binding: b++, visibility: VIS, buffer: { type: 'uniform', hasDynamicOffset: e.kind === 'dyn' } });
        else {
          const depth = e.kind === 'depth';
          entries.push({ binding: b++, visibility: VIS, texture: { sampleType: depth ? 'depth' : 'float' } });
          entries.push({ binding: b++, visibility: VIS, sampler: { type: depth ? 'comparison' : 'filtering' } });
        }
      }
      g = gpu.createBindGroupLayout({ entries });
      bglCache.set(key, g);
    }
    return g;
  }

  function module(code: string) {
    let m = modules.get(code);
    if (!m) {
      m = gpu.createShaderModule({ code });
      m.getCompilationInfo().then((info) => {
        for (const msg of info.messages) if (msg.type === 'error') console.error(`WGSL ${msg.lineNum}:${msg.linePos} ${msg.message}\n` + code.split('\n')[msg.lineNum - 1]);
      });
      modules.set(code, m);
    }
    return m;
  }

  function enc() {
    return (encoder ??= gpu.createCommandEncoder());
  }

  function screenTargets() {
    const w = canvas.width, h = canvas.height;
    if (!depthTex || depthTex.width !== w || depthTex.height !== h) {
      depthTex?.destroy();
      msaaTex?.destroy();
      depthTex = gpu.createTexture({ size: [w, h], format: 'depth24plus', sampleCount: samples, usage: GPUTextureUsage.RENDER_ATTACHMENT });
      msaaTex = samples > 1 ? gpu.createTexture({ size: [w, h], format: screenFormat, sampleCount: samples, usage: GPUTextureUsage.RENDER_ATTACHMENT }) : null;
    }
    screenView ??= ctx!.getCurrentTexture().createView();
  }

  function genMips(t: GPUTexture, format: GPUTextureFormat) {
    let pipe = mipPipes.get(format);
    if (!pipe) {
      const m = module(MIP_WGSL);
      pipe = gpu.createRenderPipeline({
        layout: 'auto',
        vertex: { module: m, entryPoint: 'vs_main' },
        fragment: { module: m, entryPoint: 'fs_main', targets: [{ format }] },
      });
      mipPipes.set(format, pipe);
    }
    mipSampler ??= gpu.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    const e = gpu.createCommandEncoder();
    for (let i = 1; i < t.mipLevelCount; i++) {
      const bg = gpu.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: t.createView({ baseMipLevel: i - 1, mipLevelCount: 1 }) }, { binding: 1, resource: mipSampler }],
      });
      const p = e.beginRenderPass({ colorAttachments: [{ view: t.createView({ baseMipLevel: i, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store' }] });
      p.setPipeline(pipe);
      p.setBindGroup(0, bg);
      p.draw(3);
      p.end();
    }
    gpu.queue.submit([e.finish()]);
  }

  const dev: Device = {
    kind: 'webgpu',
    canvas,
    lib: wgslLib,
    width: canvas.width,
    height: canvas.height,
    caps: {
      halfFloatTarget: true,
      uboAlign: gpu.limits.minUniformBufferOffsetAlignment,
      maxTextureSize: gpu.limits.maxTextureDimension2D,
    },
    resize(w, h) {
      canvas.width = dev.width = w;
      canvas.height = dev.height = h;
    },
    createBuffer(usage, sizeOrData) {
      const u = (usage === 'vertex' ? GPUBufferUsage.VERTEX : usage === 'index' ? GPUBufferUsage.INDEX : GPUBufferUsage.UNIFORM) | GPUBufferUsage.COPY_DST;
      const raw = typeof sizeOrData === 'number' ? sizeOrData : sizeOrData.byteLength;
      const size = (raw + 3) & ~3;
      const b = gpu.createBuffer({ size, usage: u, mappedAtCreation: typeof sizeOrData !== 'number' });
      if (typeof sizeOrData !== 'number') {
        new Uint8Array(b.getMappedRange()).set(new Uint8Array(sizeOrData.buffer, sizeOrData.byteOffset, raw));
        b.unmap();
      }
      return { size, b } as WBuf;
    },
    writeBuffer(buf, data, offset = 0, size) {
      let n = size ?? data.byteLength;
      if (n & 3) {
        // WebGPU requires 4-byte multiples: copy into a padded scratch
        const tmp = new Uint8Array((n + 3) & ~3);
        tmp.set(new Uint8Array(data.buffer, data.byteOffset, n));
        gpu.queue.writeBuffer((buf as WBuf).b, offset, tmp);
        return;
      }
      gpu.queue.writeBuffer((buf as WBuf).b, offset, data.buffer, data.byteOffset, n);
    },
    destroyBuffer(b) { (b as WBuf).b.destroy(); },
    createTexture(d: TextureDesc) {
      const format = d.format ?? 'rgba8';
      const f = FORMATS[format];
      const isDepth = format.startsWith('depth');
      const mipLevelCount = d.mips ? Math.floor(Math.log2(Math.max(d.width, d.height))) + 1 : 1;
      const external = d.data && !ArrayBuffer.isView(d.data);
      const t = gpu.createTexture({
        size: [d.width, d.height],
        format: f,
        mipLevelCount,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST |
          (d.target || d.mips || external || isDepth ? GPUTextureUsage.RENDER_ATTACHMENT : 0),
      });
      if (external) gpu.queue.copyExternalImageToTexture({ source: d.data as any }, { texture: t }, [d.width, d.height]);
      else if (d.data) {
        const bpp = format === 'rgba16f' ? 8 : 4;
        gpu.queue.writeTexture({ texture: t }, d.data as any, { bytesPerRow: d.width * bpp }, [d.width, d.height]);
      }
      if (d.mips && d.data) genMips(t, f);
      const lin = (d.filter ?? 'linear') === 'linear';
      const wrap: GPUAddressMode = d.wrap === 'repeat' ? 'repeat' : d.wrap === 'mirror' ? 'mirror-repeat' : 'clamp-to-edge';
      const s = gpu.createSampler({
        addressModeU: wrap, addressModeV: wrap,
        magFilter: lin && (!isDepth || d.compare) ? 'linear' : 'nearest',
        minFilter: lin && (!isDepth || d.compare) ? 'linear' : 'nearest',
        mipmapFilter: d.mips && lin ? 'linear' : 'nearest',
        maxAnisotropy: d.mips && lin ? 4 : 1,
        compare: d.compare ? 'less-equal' : undefined,
      });
      return { width: d.width, height: d.height, format, t, v: t.createView(), s } as WTex;
    },
    destroyTexture(t) { (t as WTex).t.destroy(); },
    createPipeline(d: PipelineDesc) {
      const code = preprocess(d.code, d.defines ?? {});
      const m = module(code);
      const color = d.color === undefined ? 'screen' : d.color;
      const depth = d.depth === undefined ? 'screen' : d.depth;
      const count = color === 'screen' ? samples : 1;
      const cmp = d.depthTest === false ? 'always' : d.depthCompare === 'lequal' ? 'less-equal' : d.depthCompare ?? 'less';
      const p = gpu.createRenderPipeline({
        layout: gpu.createPipelineLayout({ bindGroupLayouts: d.groups.map(bgl) }),
        vertex: {
          module: m,
          entryPoint: 'vs_main',
          buffers: d.buffers.map((b) => ({
            arrayStride: b.stride,
            stepMode: b.step,
            attributes: b.attrs.map((a) => ({ shaderLocation: a.loc, format: a.format, offset: a.offset })),
          })),
        },
        fragment: color === null ? undefined : {
          module: m,
          entryPoint: 'fs_main',
          targets: [{ format: color === 'screen' ? screenFormat : FORMATS[color], blend: d.blend && d.blend !== 'opaque' ? BLENDS[d.blend] : undefined }],
        },
        primitive: { topology: d.topology === 'lines' ? 'line-list' : 'triangle-list', cullMode: d.cull ?? 'back', frontFace: 'ccw' },
        depthStencil: depth === null ? undefined : {
          format: depth === 'screen' ? 'depth24plus' : FORMATS[depth],
          depthWriteEnabled: d.depthWrite ?? true,
          depthCompare: cmp as GPUCompareFunction,
          depthBias: d.depthBias ?? 0,
          depthBiasSlopeScale: d.depthBiasSlope ?? 0,
        },
        multisample: { count },
      });
      return p as unknown as GpuPipeline;
    },
    createBindGroup(layout, resources) {
      const entries: GPUBindGroupEntry[] = [];
      let b = 0;
      layout.entries.forEach((e, i) => {
        const r = resources[i] as any;
        if (e.kind === 'ubo' || e.kind === 'dyn') {
          entries.push({ binding: b++, resource: { buffer: (r.buffer ?? r).b, offset: r.offset ?? 0, size: r.size ?? (r.buffer ?? r).size } });
        } else {
          entries.push({ binding: b++, resource: (r as WTex).v });
          entries.push({ binding: b++, resource: (r as WTex).s });
        }
      });
      return gpu.createBindGroup({ layout: bgl(layout), entries }) as unknown as GpuBindGroup;
    },
    beginPass(pd: PassDesc): RenderPass {
      const colorT = pd.color === undefined ? 'screen' : pd.color;
      const depthT = pd.depth === undefined ? (colorT === 'screen' ? 'screen' : null) : pd.depth;
      if (colorT === 'screen' || depthT === 'screen') screenTargets();
      const clear = pd.clear;
      const colorAttachments: GPURenderPassColorAttachment[] = [];
      if (colorT) {
        const toScreen = colorT === 'screen';
        colorAttachments.push({
          view: toScreen ? (msaaTex ? msaaTex.createView() : screenView!) : (colorT as WTex).v,
          resolveTarget: toScreen && msaaTex ? screenView! : undefined,
          loadOp: clear ? 'clear' : 'load',
          storeOp: 'store',
          clearValue: clear ? { r: clear[0], g: clear[1], b: clear[2], a: clear[3] ?? 1 } : undefined,
        });
      }
      const p = enc().beginRenderPass({
        colorAttachments,
        depthStencilAttachment: depthT ? {
          view: depthT === 'screen' ? depthTex!.createView() : (depthT as WTex).v,
          depthLoadOp: pd.clearDepth ? 'clear' : 'load',
          depthStoreOp: 'store',
          depthClearValue: 1,
        } : undefined,
      });
      return {
        setPipeline: (pp) => p.setPipeline(pp as unknown as GPURenderPipeline),
        setBindGroup: (i, g, dyn) => p.setBindGroup(i, g as unknown as GPUBindGroup, dyn ?? []),
        setVertexBuffer: (slot, b, off = 0) => p.setVertexBuffer(slot, (b as WBuf).b, off),
        setIndexBuffer: (b, f) => p.setIndexBuffer((b as WBuf).b, f),
        draw: (n, inst = 1, first = 0) => p.draw(n, inst, first),
        drawIndexed: (n, inst = 1, first = 0) => p.drawIndexed(n, inst, first),
        end: () => p.end(),
      };
    },
    submit() {
      if (encoder) gpu.queue.submit([encoder.finish()]);
      encoder = null;
      screenView = null;
    },
    destroy() {
      gpu.destroy();
    },
  };
  return dev;
}
