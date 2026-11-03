// Player steering (owner: core): keyboard A/D/arrows + gamepad stick (game.input.move) + relative horizontal drag
// (mouse / touch, first finger only) on the canvas → racer.targetX. UI buttons stop pointerdown propagation, so drags
// that start on a button never steer.
import type { Game } from 'aiwebengine';
import type { Racer } from './types';
import { X_LIMIT } from './config';

/** keyboard / full gamepad stick steering speed (m/s) */
const KEY_SPEED = 9;
/** a drag across the whole screen width moves the target this far (m) */
const DRAG_M = 15;

export class PlayerControls {
  /** input is applied only while enabled (the pointer is tracked anyway, so a finger held before "GO" works) */
  enabled = false;
  /** steering target (m) */
  targetX = 0;
  /** total |Δ targetX| since reset (the tutorial waits for ~1.5 m) */
  steered = 0;
  /** the last steering input was touch (initially: a touch-first device) — pick "drag your finger" vs keyboard hints */
  touch = false;

  private _game: Game;
  private _pid = -1;
  private _lastX = 0;
  /** drag pixels since the last update */
  private _dx = 0;

  constructor(game: Game) {
    this._game = game;
    if (typeof matchMedia !== 'undefined') this.touch = matchMedia('(pointer: coarse)').matches;
    game.canvas.addEventListener('pointerdown', this._down);
    addEventListener('pointermove', this._move);
    addEventListener('pointerup', this._up);
    addEventListener('pointercancel', this._up);
  }

  private _down = (e: PointerEvent) => {
    if (this._pid >= 0 || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this._pid = e.pointerId;
    this._lastX = e.clientX;
    this.touch = e.pointerType !== 'mouse';
  };
  private _move = (e: PointerEvent) => {
    if (e.pointerId !== this._pid) return;
    if (this.enabled) this._dx += e.clientX - this._lastX;
    this._lastX = e.clientX;
  };
  private _up = (e: PointerEvent) => {
    if (e.pointerId === this._pid) this._pid = -1;
  };

  /** read input, set r.targetX */
  update(r: Racer, dt: number): void {
    if (!this.enabled) { this._dx = 0; return; }
    let d = (this._dx * DRAG_M) / Math.max(1, this._game.screen.width);
    this._dx = 0;
    // A/D, arrows, gamepad stick, virtual joystick
    const ax = this._game.input.move()[0];
    if (Math.abs(ax) > 0.05) { d += ax * KEY_SPEED * dt; this.touch = false; }
    if (d) {
      const nx = Math.max(-X_LIMIT, Math.min(X_LIMIT, this.targetX + d));
      this.steered += Math.abs(nx - this.targetX);
      this.targetX = nx;
    }
    r.targetX = this.targetX;
  }

  /** forget drag state, target = x, steered = 0 */
  reset(x: number): void {
    this.targetX = Math.max(-X_LIMIT, Math.min(X_LIMIT, x));
    this.steered = 0;
    this._dx = 0;
    this._pid = -1;
  }

  destroy(): void {
    this._game.canvas.removeEventListener('pointerdown', this._down);
    removeEventListener('pointermove', this._move);
    removeEventListener('pointerup', this._up);
    removeEventListener('pointercancel', this._up);
  }
}
