export type SwipeDir = 'left' | 'right' | 'up' | 'down';

export interface PointerState {
  /** CSS px relative to canvas */
  x: number;
  y: number;
  /** movement since last frame (uses movementX/Y, works with pointer lock) */
  dx: number;
  dy: number;
  down: boolean;
  pressed: boolean;
  released: boolean;
  button: number;
  wheel: number;
}

/**
 * Keyboard / mouse / touch / gamepad state, polled per frame.
 * Keys use KeyboardEvent.code ('KeyW', 'Space', 'ArrowLeft', ...).
 */
export class Input {
  pointer: PointerState = { x: 0, y: 0, dx: 0, dy: 0, down: false, pressed: false, released: false, button: 0, wheel: 0 };
  /** Swipe detected this frame. */
  swipe: SwipeDir | null = null;
  /** Tap/click position detected this frame. */
  tap: { x: number; y: number } | null = null;
  /** Virtual stick written by UI joystick (-1..1). */
  virtual = { x: 0, y: 0 };
  /** Virtual buttons written by UI (e.g. 'jump'). */
  virtualButtons = new Set<string>();
  touches = new Map<number, { x: number; y: number }>();
  gamepad: Gamepad | null = null;
  enabled = true;

  private down = new Set<string>();
  private pressedSet = new Set<string>();
  private releasedSet = new Set<string>();
  private vPrev = new Set<string>();
  private start: { x: number; y: number; t: number; id: number } | null = null;

  constructor(public el: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (!e.repeat) { this.down.add(e.code); this.pressedSet.add(e.code); }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && e.target === document.body) e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.down.delete(e.code); this.releasedSet.add(e.code); });
    addEventListener('blur', () => this.down.clear());
    const pos = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      const p = pos(e);
      this.touches.set(e.pointerId, p);
      const P = this.pointer;
      P.x = p.x; P.y = p.y;
      P.down = true; P.pressed = true; P.button = e.button;
      this.down.add('Mouse' + e.button);
      this.pressedSet.add('Mouse' + e.button);
      if (!this.start) this.start = { ...p, t: performance.now(), id: e.pointerId };
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, p);
      const P = this.pointer;
      P.x = p.x; P.y = p.y;
      P.dx += e.movementX || 0; P.dy += e.movementY || 0;
    });
    const up = (e: PointerEvent) => {
      this.touches.delete(e.pointerId);
      const P = this.pointer;
      if (!this.touches.size) { P.down = false; P.released = true; }
      this.down.delete('Mouse' + e.button);
      this.releasedSet.add('Mouse' + e.button);
      const s = this.start;
      if (s && s.id === e.pointerId) {
        const p = pos(e), dx = p.x - s.x, dy = p.y - s.y, dt = performance.now() - s.t, dist = Math.hypot(dx, dy);
        if (dist > 30 && dt < 600) this.swipe = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
        else if (dist < 12 && dt < 350) this.tap = p;
        this.start = null;
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => { this.pointer.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Key or button currently held ('KeyW', 'Space', 'Mouse0', 'Pad0' (gamepad button), or virtual 'jump'). */
  isDown(code: string) {
    return this.down.has(code) || this.virtualButtons.has(code) || this.padButton(code);
  }
  /** Went down this frame. */
  wasPressed(code: string) {
    return this.pressedSet.has(code) || (this.virtualButtons.has(code) && !this.vPrev.has(code));
  }
  wasReleased(code: string) {
    return this.releasedSet.has(code) || (!this.virtualButtons.has(code) && this.vPrev.has(code));
  }
  /** Any of the codes pressed this frame. */
  anyPressed(...codes: string[]) { return codes.some((c) => this.wasPressed(c)); }

  private padPrev: boolean[] = [];
  private padButton(code: string) {
    if (!code.startsWith('Pad') || !this.gamepad) return false;
    return !!this.gamepad.buttons[+code.slice(3)]?.pressed;
  }

  /** Movement axis combining WASD, arrows, gamepad left stick and virtual joystick. x: right+, y: forward+ */
  move(): [number, number] {
    let x = 0, y = 0;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) y += 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) y -= 1;
    const g = this.gamepad;
    if (g) {
      const gx = g.axes[0] ?? 0, gy = -(g.axes[1] ?? 0);
      if (Math.hypot(gx, gy) > 0.15) { x += gx; y += gy; }
    }
    x += this.virtual.x;
    y += this.virtual.y;
    const l = Math.hypot(x, y);
    return l > 1 ? [x / l, y / l] : [x, y];
  }

  /** Right stick / look axis from gamepad. */
  look(): [number, number] {
    const g = this.gamepad;
    if (!g) return [0, 0];
    const x = g.axes[2] ?? 0, y = g.axes[3] ?? 0;
    return Math.hypot(x, y) > 0.15 ? [x, y] : [0, 0];
  }

  lockPointer() { this.el.requestPointerLock?.(); }
  get pointerLocked() { return document.pointerLockElement === this.el; }

  /** @internal called at frame start */
  poll() {
    const pads = navigator.getGamepads?.();
    this.gamepad = pads ? pads.find((p) => p) ?? null : null;
    if (this.gamepad) {
      this.gamepad.buttons.forEach((b, i) => {
        if (b.pressed && !this.padPrev[i]) this.pressedSet.add('Pad' + i);
        if (!b.pressed && this.padPrev[i]) this.releasedSet.add('Pad' + i);
        this.padPrev[i] = b.pressed;
      });
    }
  }

  /** @internal called at frame end */
  endFrame() {
    this.pressedSet.clear();
    this.releasedSet.clear();
    this.vPrev = new Set(this.virtualButtons);
    const P = this.pointer;
    P.pressed = P.released = false;
    P.dx = P.dy = P.wheel = 0;
    this.swipe = null;
    this.tap = null;
  }
}
