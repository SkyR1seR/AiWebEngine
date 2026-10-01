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
  private _dyn: Required<DynamicResolutionOptions> | null;
  private _ema = 0;
  private _evalT = 0;
  private _goodT = 0;
  private _lockT = 0;
  private _lastUp = -1e9;
  private _clock = 0;
  private _listeners: ((s: Screen) => void)[] = [];
  private _dirty = true;
  private _probe: HTMLDivElement;

  constructor(public canvas: HTMLCanvasElement, o: ScreenOptions = {}) {
    this.maxDpr = o.maxDpr ?? 2;
    this.renderScale = o.renderScale ?? 1;
    const d = o.dynamicResolution ?? true;
    this._dyn = d ? { targetFps: 60, min: 0.5, max: 1, ...(d === true ? {} : d) } : null;
    const s = canvas.style;
    if (!s.width) s.width = '100%';
    if (!s.height) s.height = '100%';
    s.display = 'block';
    s.touchAction = 'none';
    s.userSelect = 'none';
    // a held finger must not select text or open the long-press menu anywhere on the page (text fields still work)
    const ds = document.documentElement.style as CSSStyleDeclaration & Record<string, string>;
    ds.userSelect = ds.webkitUserSelect = 'none';
    ds.webkitTouchCallout = 'none';
    const editable = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);
    document.addEventListener('selectstart', (e) => { if (!editable(e.target)) e.preventDefault(); });
    document.addEventListener('contextmenu', (e) => { if (!editable(e.target)) e.preventDefault(); });
    new ResizeObserver(() => (this._dirty = true)).observe(canvas);
    addEventListener('resize', () => (this._dirty = true));
    // safe-area probe
    const p = (this._probe = document.createElement('div'));
    p.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(p);
  }

  get aspect() { return this.width / this.height; }
  get portrait() { return this.height > this.width; }
  get dpr() { return Math.min(devicePixelRatio || 1, this.maxDpr); }

  onResize(fn: (s: Screen) => void) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter((f) => f !== fn); };
  }

  /** Called every frame by the game loop. Returns true if the backing size changed. */
  update(dt: number): boolean {
    this._clock += dt;
    if (this._dyn && dt > 0 && dt < 0.25) this._adapt(dt);
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    const k = this.dpr * this.renderScale * this.scale;
    const pw = Math.max(1, Math.round(w * k)), ph = Math.max(1, Math.round(h * k));
    if (!this._dirty && pw === this.pixelWidth && ph === this.pixelHeight) return false;
    this._dirty = false;
    const changedCss = w !== this.width || h !== this.height;
    this.width = w; this.height = h;
    const changed = pw !== this.pixelWidth || ph !== this.pixelHeight;
    this.pixelWidth = pw; this.pixelHeight = ph;
    const cs = getComputedStyle(this._probe);
    this.safeArea = { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
    if (changedCss || changed) for (const f of this._listeners) f(this);
    return changed;
  }

  private _adapt(dt: number) {
    const d = this._dyn!;
    const ms = dt * 1000;
    this._ema = this._ema ? this._ema * 0.9 + ms * 0.1 : ms;
    this._evalT += dt;
    if (this._evalT < 0.5) return;
    this._evalT = 0;
    const budget = 1000 / d.targetFps;
    if (this._ema > budget * 1.25 && this.scale > d.min) {
      // dropped soon after raising -> hold off raising for a while
      if (this._clock - this._lastUp < 3) this._lockT = this._clock + 15;
      this.scale = Math.max(d.min, this.scale - 0.1);
      this._goodT = 0;
      this._dirty = true;
    } else if (this._ema < budget * 1.08) {
      this._goodT += 0.5;
      if (this._goodT >= 3 && this.scale < d.max && this._clock > this._lockT) {
        this.scale = Math.min(d.max, this.scale + 0.05);
        this._lastUp = this._clock;
        this._goodT = 0;
        this._dirty = true;
      }
    } else this._goodT = 0;
  }
}
