import type { Defines } from './preprocess';

// Render hardware interface shared by WebGPU and WebGL2 backends.

export type BackendKind = 'webgpu' | 'webgl2';
export type VertexFormat = 'float32' | 'float32x2' | 'float32x3' | 'float32x4' | 'unorm8x4';
export type TexFormat = 'rgba8' | 'rgba8srgb' | 'rgba16f' | 'depth24' | 'depth32f';
export type Blend = 'opaque' | 'alpha' | 'add' | 'premult' | 'multiply';
export type Cull = 'none' | 'back' | 'front';
/** ubo: uniform buffer; dyn: uniform buffer with dynamic offset; tex: texture+sampler; depth: comparison depth texture+sampler */
export type BindKind = 'ubo' | 'dyn' | 'tex' | 'depth';

export interface BindEntry { name: string; kind: BindKind }
/** A bind-group layout. WGSL binding numbers are sequential; `tex`/`depth` take two (texture, sampler). */
export interface BindLayout { entries: BindEntry[]; key?: string }

export interface VertexAttr { loc: number; format: VertexFormat; offset: number }
export interface VertexBufferLayout { stride: number; step: 'vertex' | 'instance'; attrs: VertexAttr[] }

export interface PipelineDesc {
  /** Shader source in the device's language (WGSL or GLSL with #if VERTEX / #if FRAGMENT sections). */
  code: string;
  defines?: Defines;
  groups: BindLayout[];
  buffers: VertexBufferLayout[];
  topology?: 'triangles' | 'lines';
  cull?: Cull;
  blend?: Blend;
  depthTest?: boolean;
  depthWrite?: boolean;
  depthCompare?: 'less' | 'lequal' | 'always';
  /** 'screen' renders to canvas; null = depth-only. */
  color?: TexFormat | 'screen' | null;
  /** depth attachment format; 'screen' = the canvas depth buffer. */
  depth?: TexFormat | 'screen' | null;
  depthBias?: number;
  depthBiasSlope?: number;
}

export interface TextureDesc {
  width: number;
  height: number;
  format?: TexFormat;
  data?: TexImageSource | ArrayBufferView | null;
  mips?: boolean;
  wrap?: 'repeat' | 'clamp' | 'mirror';
  filter?: 'linear' | 'nearest';
  /** usable as render target */
  target?: boolean;
  /** depth comparison sampler (shadow maps) */
  compare?: boolean;
}

export interface GpuBuffer { size: number; readonly __buf?: true }
export interface GpuTexture { width: number; height: number; format: TexFormat; readonly __tex?: true }
export interface GpuPipeline { readonly __pipe?: true }
export interface GpuBindGroup { readonly __bg?: true }

export type BindResource = GpuBuffer | GpuTexture | { buffer: GpuBuffer; size: number; offset?: number };

export interface PassDesc {
  color?: GpuTexture | 'screen' | null;
  depth?: GpuTexture | 'screen' | null;
  /** RGBA clear color (linear); omit to load existing contents */
  clear?: ArrayLike<number> | null;
  clearDepth?: boolean;
}

export interface RenderPass {
  setPipeline(p: GpuPipeline): void;
  setBindGroup(index: number, g: GpuBindGroup, dynamicOffsets?: number[]): void;
  setVertexBuffer(slot: number, b: GpuBuffer, offset?: number): void;
  setIndexBuffer(b: GpuBuffer, format: 'uint16' | 'uint32'): void;
  draw(count: number, instances?: number, first?: number): void;
  drawIndexed(count: number, instances?: number, first?: number): void;
  end(): void;
}

export interface DeviceCaps {
  /** can render to rgba16f */
  halfFloatTarget: boolean;
  /** uniform buffer offset alignment (bytes) */
  uboAlign: number;
  maxTextureSize: number;
}

export interface Device {
  kind: BackendKind;
  canvas: HTMLCanvasElement;
  caps: DeviceCaps;
  /** Built-in shader library in this device's language. */
  lib: Record<string, string>;
  /** Canvas pixel size (set via resize). */
  width: number;
  height: number;
  resize(w: number, h: number): void;
  createBuffer(usage: 'vertex' | 'index' | 'uniform', sizeOrData: number | ArrayBufferView): GpuBuffer;
  writeBuffer(b: GpuBuffer, data: ArrayBufferView, offset?: number, size?: number): void;
  destroyBuffer(b: GpuBuffer): void;
  createTexture(desc: TextureDesc): GpuTexture;
  destroyTexture(t: GpuTexture): void;
  createPipeline(desc: PipelineDesc): GpuPipeline;
  createBindGroup(layout: BindLayout, resources: BindResource[]): GpuBindGroup;
  beginPass(desc: PassDesc): RenderPass;
  /** Flush the frame (submit command buffers). */
  submit(): void;
  destroy(): void;
}

export const layoutKey = (l: BindLayout) => (l.key ??= l.entries.map((e) => e.kind + ':' + e.name).join(','));

export const vertexFormatSize: Record<VertexFormat, number> = {
  float32: 4, float32x2: 8, float32x3: 12, float32x4: 16, unorm8x4: 4,
};

export interface CreateDeviceOptions {
  backend?: 'auto' | BackendKind;
  antialias?: boolean;
  powerPreference?: 'low-power' | 'high-performance';
}

/** Create the best available device. Backends are code-split: only the chosen one is downloaded. */
export async function createDevice(canvas: HTMLCanvasElement, opts: CreateDeviceOptions = {}): Promise<Device> {
  let want = opts.backend ?? 'auto';
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('backend') : null;
  if (q === 'webgl2' || q === 'webgpu') want = q;
  if (want !== 'webgl2' && typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const m = await import('./webgpu');
      const d = await m.createWebGPUDevice(canvas, opts);
      if (d) return d;
    } catch (e) {
      console.warn('WebGPU init failed, falling back to WebGL2', e);
    }
  }
  const m = await import('./webgl2');
  return m.createWebGL2Device(canvas, opts);
}
