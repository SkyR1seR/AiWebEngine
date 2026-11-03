// Music & sound effects (owner: audio): procedural chiptune of public-domain carols, festive sfx, rolling snow loop.
export type Sfx =
  | 'click' | 'coin' | 'gem' | 'smash' | 'shatter' | 'splash' | 'bridge' | 'boost' | 'shield' | 'count' | 'go' | 'finish'
  | 'win' | 'lose' | 'bell' | 'tick' | 'reveal' | 'buy' | 'whoosh' | 'crunch' | 'sizzle' | 'error' | 'levelup' | 'pop'
  | 'gift' | 'bump' | 'fall';

export function sfx(name: Sfx, vol = 1): void { void name; void vol; }

export interface Music {
  /** start / switch track (fades) */
  play(track: 'menu' | 'race'): void;
  stop(): void;
  /** music on/off setting (sfx are controlled by sound.mute) */
  setEnabled(on: boolean): void;
  readonly enabled: boolean;
}
export const music: Music = { play() {}, stop() {}, setEnabled() {}, enabled: true };

/** looping snow crunch of the player's rolling ball */
export class RollSound {
  update(dt: number, speed01: number, size01: number, onSnow: boolean, active: boolean): void { void dt; void speed01; void size01; void onSnow; void active; }
  stop(): void {}
}
