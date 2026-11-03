import type { Game } from '../core/game';
import { sound } from '../audio/index';
import { boot } from '../core/hooks';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A product of the platform catalog (prices are set in each platform's dashboard). */
export interface PlaygamaProduct {
  id: string;
  /** formatted price from the platform (e.g. "49 YAN", "$0.99"), or '' */
  price: string;
  priceValue: number;
  currency: string;
}

/**
 * Playgama Bridge wrapper (one SDK for Yandex Games, CrazyGames, Poki, Playgama, VK, ... — https://wiki.playgama.com).
 * The SDK script (`playgama-bridge.js`) is added by `npm run export <name> -- --playgama`; without it (dev server)
 * every call is a safe no-op: ads are unavailable, saves go to localStorage.
 *
 *   const pgInit = playgama();             // start SDK init first, in parallel with the engine
 *   const game = await createGame();
 *   const pg = await pgInit; pg.game = game;
 *   pg.ready();                            // REQUIRED: once the first screen is interactive ("game_ready")
 *   pg.gameplayStart() / pg.gameplayStop()
 *   await pg.showAd();                     // interstitial; game paused + muted while it shows
 *   if (await pg.showRewarded()) bonus();
 *   await pg.save({ best }); const d = await pg.load();
 *   pg.mute(true)                          // the player's own sound setting (combined with platform/ad muting)
 */
export class Playgama {
  /** the `bridge` global after initialize() (null when the SDK isn't on the page or failed) */
  bridge: any = null;
  /** ISO 639-1 language from the platform (browser language without the SDK) */
  lang = (typeof navigator !== 'undefined' ? navigator.language.slice(0, 2).toLowerCase() : 'en') || 'en';
  /** platform id: 'yandex', 'crazy_games', 'playgama', 'mock', ... ('none' without the SDK) */
  platform = 'none';
  private _readySent = false;
  private _adOpen = false;
  private _playing = false;
  private _userMuted = false;
  /** reasons the game is held: 'ad' | 'pause' pause + mute, 'audio' mutes only */
  private _holds = new Set<string>();

  constructor(public game: Game | null = null) {}

  get available() { return !!this.bridge; }

  /** @internal */
  async init(timeoutMs = 10000) {
    const b = (globalThis as any).bridge;
    if (!b?.initialize) { boot('sdk: playgama bridge not found'); return this; }
    boot('sdk: playgama init');
    try {
      await Promise.race([b.initialize(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))]);
      this.bridge = b;
      this.platform = String(b.platform?.id ?? 'unknown');
      const l = String(b.platform?.language ?? '').slice(0, 2).toLowerCase();
      if (l) this.lang = l;
      const E = b.EVENT_NAME ?? {};
      b.platform?.on?.(E.PAUSE_STATE_CHANGED ?? 'pause_state_changed', (paused: boolean) => this._hold('pause', !!paused));
      b.platform?.on?.(E.AUDIO_STATE_CHANGED ?? 'audio_state_changed', (on: boolean) => this._hold('audio', !on));
      if (b.platform?.isAudioEnabled === false) this._hold('audio', true);
      boot(`sdk: ok, platform=${this.platform}, lang=${this.lang}`);
    } catch (e) {
      console.warn('Playgama Bridge init failed', e);
      boot('sdk: failed (' + e + ')');
      this.bridge = null;
    }
    return this;
  }

  private _send(msg: string, opts?: Record<string, unknown>) {
    try { const p = this.bridge?.platform?.sendMessage?.(msg, opts); p?.catch?.(() => {}); } catch { /* unsupported message */ }
  }

  /** Tell the platform the game is loaded and interactive (call once). */
  ready() {
    if (this._readySent) return;
    this._readySent = true;
    this._send('game_ready');
    boot(this.bridge ? 'ready: game_ready sent' : 'ready (no SDK)');
  }
  /** Active gameplay started (level/run begins). */
  gameplayStart() {
    if (this._playing) return;
    this._playing = true;
    this._send('gameplay_started');
  }
  /** Gameplay paused/ended (menus, results, ads). */
  gameplayStop() {
    if (!this._playing) return;
    this._playing = false;
    this._send('gameplay_stopped');
  }
  /** Level lifecycle messages (analytics on some platforms). */
  levelStarted(level: number | string) { this._send('level_started', { level: String(level) }); }
  levelCompleted(level: number | string) { this._send('level_completed', { level: String(level) }); }
  levelFailed(level: number | string) { this._send('level_failed', { level: String(level) }); }

  /** The player's own sound setting; the effective mute also includes ads and platform requests. */
  mute(on: boolean) {
    this._userMuted = on;
    this._apply();
  }
  get muted() { return this._userMuted; }

  private _hold(reason: string, on: boolean) {
    if (on === this._holds.has(reason)) return;
    if (on) this._holds.add(reason); else this._holds.delete(reason);
    this._apply();
  }
  private _apply() {
    sound.mute(this._userMuted || this._holds.size > 0);
    const pause = this._holds.has('ad') || this._holds.has('pause');
    if (pause) this.game?.pause(); else if (this.game?.held) this.game.resume();
  }

  get interstitialSupported() { return !!this.bridge?.advertisement?.isInterstitialSupported; }
  get rewardedSupported() { return !!this.bridge?.advertisement?.isRewardedSupported; }

  /**
   * Shows an ad and resolves when it is over. `rewarded`: resolves true only if the platform reported the reward.
   * The game is paused and muted while the ad is open.
   */
  private _ad(rewarded: boolean, placement?: string): Promise<boolean> {
    const ad = this.bridge?.advertisement;
    if (!ad || this._adOpen || !(rewarded ? ad.isRewardedSupported : ad.isInterstitialSupported)) return Promise.resolve(false);
    this._adOpen = true;
    const playing = this._playing;
    if (playing) this.gameplayStop();
    const ev = rewarded ? (this.bridge.EVENT_NAME?.REWARDED_STATE_CHANGED ?? 'rewarded_state_changed')
      : (this.bridge.EVENT_NAME?.INTERSTITIAL_STATE_CHANGED ?? 'interstitial_state_changed');
    return new Promise((res) => {
      let got = false, opened = false, finished = false;
      // safety: an ad that never opens (no fill, blocked) must not lock the game
      const timer = setTimeout(() => { if (!opened) done(); }, 12000);
      const done = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        ad.off?.(ev, onState);
        this._adOpen = false;
        this._hold('ad', false);
        if (playing) this.gameplayStart();
        res(rewarded ? got : opened);
      };
      const onState = (state: string) => {
        if (state === 'opened') { opened = true; this._hold('ad', true); }
        else if (state === 'rewarded') got = true;
        else if (state === 'closed' || state === 'failed') done();
      };
      ad.on?.(ev, onState);
      try {
        if (rewarded) ad.showRewarded(placement ?? null); else ad.showInterstitial(placement ?? null);
      } catch { done(); }
    });
  }
  /** Interstitial ad between rounds (the SDK enforces the minimum delay). Resolves true if it was shown. */
  showAd(placement?: string) { return this._ad(false, placement); }
  /** Rewarded video. Resolves true if the reward must be granted. */
  showRewarded(placement?: string) { return this._ad(true, placement); }

  /** newest data waiting to be sent, last data sent, and whether a send is in flight */
  private _next: string | null = null;
  private _sent = '';
  private _sending = false;
  /** Save progress (platform cloud/local storage via the SDK, localStorage without it). Rapid saves are merged. */
  async save(data: Record<string, any>) {
    const json = JSON.stringify(data);
    const st = this.bridge?.storage;
    if (!st) { try { localStorage.setItem('save', json); } catch {} return; }
    this._next = json;
    if (this._sending) return;
    this._sending = true;
    try {
      while (this._next !== null) {
        const j = this._next;
        this._next = null;
        if (j === this._sent) continue;
        try { await st.set('save', j); this._sent = j; } catch (e) { console.warn('save failed', e); }
      }
    } finally {
      this._sending = false;
    }
  }
  /** Load progress saved with save(). */
  async load<T extends Record<string, any>>(): Promise<Partial<T>> {
    const parse = (v: unknown): Partial<T> | null => {
      if (v && typeof v === 'object') return v as Partial<T>;
      if (typeof v === 'string' && v) try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : null; } catch {}
      return null;
    };
    const st = this.bridge?.storage;
    if (st) try {
      const d = parse(await st.get('save', false));
      if (d) { this._sent = JSON.stringify(d); return d; }
    } catch {}
    try { return parse(localStorage.getItem('save')) ?? {}; } catch { return {}; }
  }

  /** In-app purchases supported on this platform. */
  get paymentsSupported() { return !!this.bridge?.payments?.isSupported; }
  /** Product catalog with platform prices ([] when unsupported). */
  async catalog(): Promise<PlaygamaProduct[]> {
    if (!this.paymentsSupported) return [];
    try {
      const list = await this.bridge.payments.getCatalog();
      return (Array.isArray(list) ? list : []).map((p: any) => ({
        id: String(p.id), price: p.price != null ? String(p.price) : '', priceValue: Number(p.priceValue) || 0, currency: String(p.priceCurrencyCode ?? ''),
      }));
    } catch { return []; }
  }
  /** Buy a product (from a direct player action). Resolves the purchase object or null (cancelled / failed). */
  async purchase(id: string): Promise<Record<string, any> | null> {
    if (!this.paymentsSupported) return null;
    try { return (await this.bridge.payments.purchase(id)) ?? { id }; } catch { return null; }
  }
  /** Consume a consumable product after granting it (by product id). */
  async consume(id: string): Promise<boolean> {
    if (!this.paymentsSupported) return false;
    try { await this.bridge.payments.consumePurchase(id); return true; } catch { return false; }
  }
  /** Product ids of the player's active purchases (permanent ones + unconsumed consumables). */
  async purchases(): Promise<string[]> {
    if (!this.paymentsSupported) return [];
    try {
      const list = await this.bridge.payments.getPurchases();
      return (Array.isArray(list) ? list : []).map((p: any) => String(p.id ?? p.productID ?? '')).filter(Boolean);
    } catch { return []; }
  }

  /** Server time in ms (falls back to the device clock). */
  async serverTime(): Promise<number> {
    try { const t = Number(await this.bridge?.platform?.getServerTime?.()); if (t > 0) return t; } catch {}
    return Date.now();
  }
}

/** Init Playgama Bridge (no-op wrapper when the SDK script isn't on the page). */
export function playgama(game: Game | null = null, timeoutMs?: number) {
  return new Playgama(game).init(timeoutMs);
}
