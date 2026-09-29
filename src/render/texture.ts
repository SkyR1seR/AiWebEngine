import type { GpuTexture, TextureDesc } from '../gpu/device';

export interface TextureOptions {
  wrap?: TextureDesc['wrap'];
  filter?: TextureDesc['filter'];
  mips?: boolean;
  /** color data in sRGB (default true for images) */
  srgb?: boolean;
}

/** CPU-side texture description; uploaded lazily by the renderer. */
export class Texture {
  /** @internal */ gpu?: GpuTexture;
  /** @internal */ gpuVersion = -1;
  version = 0;
  constructor(
    public source: TexImageSource | Uint8Array | null,
    public width: number,
    public height: number,
    public options: TextureOptions = {},
  ) {}
  /** Mark source changed (e.g. canvas redrawn). */
  update() { this.version++; }

  /** Texture from raw RGBA8 pixels. */
  static fromPixels(data: Uint8Array, w: number, h: number, opts: TextureOptions = {}) {
    return new Texture(data, w, h, { srgb: false, mips: false, ...opts });
  }
  /** Texture from a canvas (drawn with 2D API). */
  static fromCanvas(c: HTMLCanvasElement | OffscreenCanvas, opts: TextureOptions = {}) {
    return new Texture(c, c.width, c.height, { mips: true, ...opts });
  }
}

const cache = new Map<string, Promise<Texture>>();

/** Load an image texture (PNG/JPEG/WebP/AVIF). Cached per URL. */
export function loadTexture(url: string, opts: TextureOptions = {}): Promise<Texture> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then((r) => r.blob()).then((b) => imageTexture(b, opts));
    cache.set(url, p);
  }
  return p;
}

export async function imageTexture(blob: Blob, opts: TextureOptions = {}) {
  const img = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  return new Texture(img, img.width, img.height, { mips: true, wrap: 'repeat', ...opts });
}

/** Generated radial soft-dot texture (particles default). */
export function softDot(size = 64, hardness = 0) {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1;
    const r = Math.min(1, Math.hypot(dx, dy));
    const a = Math.pow(1 - r, 1 + (1 - hardness) * 1.5) * (r < 1 ? 1 : 0);
    const i = (y * size + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = 255;
    d[i + 3] = Math.round(Math.min(1, a * (1 + hardness * 4)) * 255);
  }
  return Texture.fromPixels(d, size, size, { wrap: 'clamp' });
}

/** Checkerboard texture, handy for prototyping. */
export function checker(size = 64, cells = 8, a = 0xffffff, b = 0xcccccc) {
  const d = new Uint8Array(size * size * 4);
  const cs = size / cells;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = ((Math.floor(x / cs) + Math.floor(y / cs)) & 1) ? b : a;
    const i = (y * size + x) * 4;
    d[i] = (c >> 16) & 255; d[i + 1] = (c >> 8) & 255; d[i + 2] = c & 255; d[i + 3] = 255;
  }
  return new Texture(d, size, size, { wrap: 'repeat', filter: 'nearest', mips: false, srgb: true });
}
