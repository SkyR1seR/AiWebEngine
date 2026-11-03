// Bots that pretend to be online players (owner: core): profiles, AI steering, emotes, fake online counter.
import type { Profile, Racer } from './types';
import type { RaceSim } from './sim';

export type BotEvent = 'start' | 'overtake' | 'overtaken' | 'shatter' | 'smash' | 'finish1' | 'finish' | 'fall' | 'bridge';

/** `n` opponent profiles around the player's trophies/level (deterministic per seed) */
export function makeOpponents(player: { trophies: number; level: number }, n: number, seed: number): Profile[] {
  throw new Error('TODO makeOpponents' + player + n + seed);
}

/** Bot steering: call update every fixed step; sets racer.targetX. */
export class BotBrain {
  constructor(public racer: Racer, seed: number) { void seed; }
  update(sim: RaceSim, dt: number): void { throw new Error('TODO' + sim + dt); }
}

/** rubber band: set racer.rubber of bots each step from their distance to the player (0.9..1.1); ease (retries) favors the player */
export function applyRubberBand(sim: RaceSim, player: Racer, ease = 0): void { throw new Error('TODO' + sim + player + ease); }

/** maybe an emote/chat text for a bot event (null = stay silent) */
export function emoteFor(ev: BotEvent, rnd: () => number): string | null {
  throw new Error('TODO emoteFor' + ev + rnd);
}

/** fake "players online" number for a timestamp (smooth day/night curve + jitter) */
export function onlineCount(now: number): number {
  throw new Error('TODO onlineCount' + now);
}
