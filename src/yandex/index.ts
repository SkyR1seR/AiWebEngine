import type { Game } from '../core/game';
import { sound } from '../audio/index';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const YaGames: { init(): Promise<any> } | undefined;

/**
 * Yandex Games SDK wrapper. Safe to use outside Yandex (every call becomes a no-op),
 * so the same build runs locally and on the portal.
 *
 *   const ya = await yandex(game);   // after assets are loaded
 *   ya.ready();                      // required by moderation: game is loaded and playable
 *   ya.gameplayStart() / ya.gameplayStop()
 *   await ya.showAd();               // fullscreen ad between rounds (game paused + muted meanwhile)
 *   if (await ya.showRewarded()) giveBonus();
 *   await ya.save({ best }); const data = await ya.load();
 */
export class Yandex {
  /** raw SDK object (null when not running on Yandex Games) */
  sdk: any = null;
  player: any = null;
  /** interface language from the portal ('ru', 'en', 'tr', ...) */
  lang = (typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'en') || 'en';
  private _readySent = false;
  private _adOpen = false;
  private _playing = false;

  constructor(public game: Game) {}

  get available() { return !!this.sdk; }

  /** @internal */
  async init(timeoutMs = 5000) {
    if (typeof YaGames === 'undefined') return this;
    try {
      this.sdk = await Promise.race([YaGames.init(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))]);
      this.lang = this.sdk.environment?.i18n?.lang ?? this.lang;
      // portal asks to pause (e.g. its own overlays)
      this.sdk.on?.('game_api_pause', () => this.hold(true));
      this.sdk.on?.('game_api_resume', () => this.hold(false));
    } catch (e) {
      console.warn('Yandex SDK init failed', e);
      this.sdk = null;
    }
    return this;
  }

  /** Tell the portal the game finished loading (call once, when the first screen is interactive). */
  ready() {
    if (this._readySent) return;
    this._readySent = true;
    this.sdk?.features?.LoadingAPI?.ready();
  }
  /** Active gameplay started (level/run begins). */
  gameplayStart() {
    if (this._playing) return;
    this._playing = true;
    this.sdk?.features?.GameplayAPI?.start();
  }
  /** Gameplay paused/ended (menus, game over, ads). */
  gameplayStop() {
    if (!this._playing) return;
    this._playing = false;
    this.sdk?.features?.GameplayAPI?.stop();
  }

  private _wasMuted = false;
  private hold(on: boolean) {
    if (on) {
      this._wasMuted = sound.muted;
      sound.mute(true);
      this.game.pause();
    } else {
      sound.mute(this._wasMuted);
      this.game.resume();
    }
  }

  /** Fullscreen (interstitial) ad. Resolves when closed; true if it was shown. */
  showAd(): Promise<boolean> {
    if (!this.sdk || this._adOpen) return Promise.resolve(false);
    this._adOpen = true;
    const playing = this._playing;
    if (playing) this.gameplayStop();
    return new Promise((res) => {
      const done = (shown: boolean) => { this._adOpen = false; this.hold(false); if (playing) this.gameplayStart(); res(shown); };
      this.sdk.adv.showFullscreenAdv({
        callbacks: { onOpen: () => this.hold(true), onClose: (shown: boolean) => done(!!shown), onError: () => done(false), onOffline: () => done(false) },
      });
    });
  }

  /** Rewarded video. Resolves true if the reward must be granted. */
  showRewarded(): Promise<boolean> {
    if (!this.sdk || this._adOpen) return Promise.resolve(false);
    this._adOpen = true;
    const playing = this._playing;
    if (playing) this.gameplayStop();
    let rewarded = false;
    return new Promise((res) => {
      const done = () => { this._adOpen = false; this.hold(false); if (playing) this.gameplayStart(); res(rewarded); };
      this.sdk.adv.showRewardedVideo({
        callbacks: { onOpen: () => this.hold(true), onRewarded: () => (rewarded = true), onClose: done, onError: done },
      });
    });
  }

  private async getPlayer() {
    if (!this.sdk) return null;
    try { return (this.player ??= await this.sdk.getPlayer({ scopes: false })); } catch { return null; }
  }
  /** Save progress (cloud on Yandex, localStorage otherwise). */
  async save(data: Record<string, any>) {
    try { localStorage.setItem('save', JSON.stringify(data)); } catch {}
    const p = await this.getPlayer();
    try { await p?.setData(data, true); } catch {}
  }
  /** Load progress saved with save(). */
  async load<T extends Record<string, any>>(): Promise<Partial<T>> {
    const p = await this.getPlayer();
    if (p) try { const d = await p.getData(); if (d && Object.keys(d).length) return d; } catch {}
    try { return JSON.parse(localStorage.getItem('save') ?? '{}'); } catch { return {}; }
  }
}

/** Init the Yandex Games SDK (no-op wrapper when the page isn't on Yandex). */
export function yandex(game: Game, timeoutMs?: number) {
  return new Yandex(game).init(timeoutMs);
}
