export interface DynamicResolutionOptions {
  /** frame rate to hold (default 60) */
  targetFps?: number;
  /** min/max render scale (default 0.5..1) */
  min?: number;
  max?: number;
}

export interface ScreenOptions {
  /** Device pixel ratio cap (default 2). Lower = faster on high-DPI phones. */
  maxDpr?: number;
  /** Fixed render scale multiplier (default 1). */
  renderScale?: number;
  /** Automatically lower render scale when frame rate drops (default true). */
  dynamicResolution?: boolean | DynamicResolutionOptions;
}

export interface SafeArea { top: number; right: number; bottom: number; left: number }

/**
 * Tracks canvas CSS size, DPR and adaptive render scale. Pixel size = css * min(dpr, maxDpr) * scale.
 */
export class Screen {
  /** CSS pixel size of the canvas. */
  width = 1;
  height = 1;
  /** Backing buffer size in device pixels. */
  pixelWidth = 1;
  pixelHeight = 1;
  /** Current dynamic render scale (0..1). */
  scale = 1;
  maxDpr: number;
  renderScale: number;
  safeArea: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };
  private dyn: Required<DynamicResolutionOptions> | null;
  private ema = 0;
  private evalT = 0;
  private goodT = 0;
  private lockT = 0;
  private lastUp = -1e9;
  private clock = 0;
  private listeners: ((s: Screen) => void)[] = [];
  private dirty = true;
  private probe: HTMLDivElement;

  constructor(public canvas: HTMLCanvasElement, o: ScreenOptions = {}) {
    this.maxDpr = o.maxDpr ?? 2;
    this.renderScale = o.renderScale ?? 1;
    const d = o.dynamicResolution ?? true;
    this.dyn = d ? { targetFps: 60, min: 0.5, max: 1, ...(d === true ? {} : d) } : null;
    const s = canvas.style;
    if (!s.width) s.width = '100%';
    if (!s.height) s.height = '100%';
    s.display = 'block';
    s.touchAction = 'none';
    s.userSelect = 'none';
    new ResizeObserver(() => (this.dirty = true)).observe(canvas);
    addEventListener('resize', () => (this.dirty = true));
    // safe-area probe
    const p = (this.probe = document.createElement('div'));
    p.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(p);
  }

  get aspect() { return this.width / this.height; }
  get portrait() { return this.height > this.width; }
  get dpr() { return Math.min(devicePixelRatio || 1, this.maxDpr); }

  onResize(fn: (s: Screen) => void) {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((f) => f !== fn); };
  }

  /** Called every frame by the game loop. Returns true if the backing size changed. */
  update(dt: number): boolean {
    this.clock += dt;
    if (this.dyn && dt > 0 && dt < 0.25) this.adapt(dt);
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    const k = this.dpr * this.renderScale * this.scale;
    const pw = Math.max(1, Math.round(w * k)), ph = Math.max(1, Math.round(h * k));
    if (!this.dirty && pw === this.pixelWidth && ph === this.pixelHeight) return false;
    this.dirty = false;
    const changedCss = w !== this.width || h !== this.height;
    this.width = w; this.height = h;
    const changed = pw !== this.pixelWidth || ph !== this.pixelHeight;
    this.pixelWidth = pw; this.pixelHeight = ph;
    const cs = getComputedStyle(this.probe);
    this.safeArea = { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
    if (changedCss || changed) for (const f of this.listeners) f(this);
    return changed;
  }

  private adapt(dt: number) {
    const d = this.dyn!;
    const ms = dt * 1000;
    this.ema = this.ema ? this.ema * 0.9 + ms * 0.1 : ms;
    this.evalT += dt;
    if (this.evalT < 0.5) return;
    this.evalT = 0;
    const budget = 1000 / d.targetFps;
    if (this.ema > budget * 1.25 && this.scale > d.min) {
      // dropped soon after raising -> hold off raising for a while
      if (this.clock - this.lastUp < 3) this.lockT = this.clock + 15;
      this.scale = Math.max(d.min, this.scale - 0.1);
      this.goodT = 0;
      this.dirty = true;
    } else if (this.ema < budget * 1.08) {
      this.goodT += 0.5;
      if (this.goodT >= 3 && this.scale < d.max && this.clock > this.lockT) {
        this.scale = Math.min(d.max, this.scale + 0.05);
        this.lastUp = this.clock;
        this.goodT = 0;
        this.dirty = true;
      }
    } else this.goodT = 0;
  }
}
