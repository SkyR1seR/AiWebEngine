import { createDevice, type CreateDeviceOptions, type Device } from '../gpu/device';
import { Renderer } from '../render/renderer';
import { Screen, type ScreenOptions } from '../platform/screen';
import { Input } from '../platform/input';
import { Scene } from '../scene/scene';
import { Camera } from '../scene/camera';
import { tweens } from '../anim/tween';

/** Engine subsystem hooked into the loop (physics worlds, animators, UI...). */
export interface System {
  /** fixed-rate update (physics) */
  fixedUpdate?(dt: number): void;
  /** per-frame update; alpha = fixed-step interpolation factor */
  update?(dt: number, alpha: number): void;
  /** after scene matrices are updated, before rendering */
  preRender?(dt: number): void;
  /** after rendering */
  postRender?(dt: number): void;
}

export interface GameOptions extends CreateDeviceOptions, ScreenOptions {
  /** Canvas element or selector. Created fullscreen if omitted. */
  canvas?: HTMLCanvasElement | string;
  /** Fixed step for fixedUpdate / physics (default 1/60). */
  fixedStep?: number;
  /** Pause when tab hidden (default true). */
  pauseOnHidden?: boolean;
  /** Start the loop immediately (default true). */
  autoStart?: boolean;
}

type Fn = (dt: number) => void;

export class Game {
  scene = new Scene();
  camera = new Camera();
  time = { dt: 0, elapsed: 0, frame: 0, fps: 60, alpha: 0, scale: 1 };
  systems: System[] = [];
  running = false;
  paused = false;
  readonly fixedStep: number;
  private fns: { update: Fn[]; fixed: Fn[]; late: Fn[]; render: Fn[] } = { update: [], fixed: [], late: [], render: [] };
  private acc = 0;
  private last = 0;
  private raf = 0;

  constructor(public device: Device, public renderer: Renderer, public screen: Screen, public input: Input, o: GameOptions) {
    this.fixedStep = o.fixedStep ?? 1 / 60;
    this.camera.position[2] = 5;
    this.scene.add(this.camera);
    if (o.pauseOnHidden ?? true) document.addEventListener('visibilitychange', () => { this.paused = document.hidden; this.last = 0; });
  }

  get canvas() { return this.device.canvas; }

  /** Per-frame callback. Returns unsubscribe. */
  onUpdate(fn: Fn) { return this.on('update', fn); }
  /** Fixed-step callback (runs before physics step). */
  onFixedUpdate(fn: Fn) { return this.on('fixed', fn); }
  /** After update & physics sync (camera follow goes here). */
  onLateUpdate(fn: Fn) { return this.on('late', fn); }
  /** After rendering (UI sync). */
  onRender(fn: Fn) { return this.on('render', fn); }
  private on(k: keyof Game['fns'], fn: Fn) {
    this.fns[k].push(fn);
    return () => { this.fns[k] = this.fns[k].filter((f) => f !== fn); };
  }

  addSystem<T extends System>(s: T): T { this.systems.push(s); return s; }
  removeSystem(s: System) { this.systems = this.systems.filter((x) => x !== s); }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = 0;
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(t / 1000);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }

  /** Advance one frame (called by the loop; can be called manually for tests). */
  frame(now: number) {
    const raw = this.last ? Math.min(now - this.last, 0.1) : this.fixedStep;
    this.last = now;
    if (this.paused) return;
    const dt = raw * this.time.scale;
    const T = this.time;
    T.dt = dt; T.elapsed += dt; T.frame++;
    if (raw > 0) T.fps = T.fps * 0.95 + (1 / raw) * 0.05;

    if (this.screen.update(raw)) this.device.resize(this.screen.pixelWidth, this.screen.pixelHeight);
    this.input.poll();

    // fixed steps
    this.acc += dt;
    let steps = 0;
    while (this.acc >= this.fixedStep && steps < 5) {
      for (const f of this.fns.fixed) f(this.fixedStep);
      for (const s of this.systems) s.fixedUpdate?.(this.fixedStep);
      this.acc -= this.fixedStep;
      steps++;
    }
    if (steps === 5) this.acc = 0;
    T.alpha = this.acc / this.fixedStep;

    for (const f of this.fns.update) f(dt);
    tweens.update(dt);
    this.scene.updateScripts(dt);
    for (const s of this.systems) s.update?.(dt, T.alpha);
    for (const f of this.fns.late) f(dt);

    this.scene.updateMatrices();
    for (const s of this.systems) s.preRender?.(dt);
    this.renderer.time = T.elapsed;
    this.renderer.render(this.scene, this.camera);
    for (const s of this.systems) s.postRender?.(dt);
    for (const f of this.fns.render) f(dt);
    this.input.endFrame();
  }
}

/** Create a game: device (WebGPU → WebGL2 fallback), renderer, adaptive screen, input, scene and camera. */
export async function createGame(o: GameOptions = {}): Promise<Game> {
  let canvas = typeof o.canvas === 'string' ? document.querySelector<HTMLCanvasElement>(o.canvas) : o.canvas;
  if (!canvas) {
    canvas = document.createElement('canvas');
    const st = document.documentElement.style, bs = document.body.style;
    st.height = bs.height = '100%';
    bs.margin = '0';
    bs.overflow = 'hidden';
    bs.background = '#000';
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
    document.body.appendChild(canvas);
  }
  const screen = new Screen(canvas, o);
  screen.update(0);
  canvas.width = screen.pixelWidth;
  canvas.height = screen.pixelHeight;
  const device = await createDevice(canvas, o);
  device.resize(screen.pixelWidth, screen.pixelHeight);
  const game = new Game(device, new Renderer(device), screen, new Input(canvas), o);
  if (o.autoStart ?? true) game.start();
  return game;
}
