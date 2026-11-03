// Race simulation (owner: core). Pure logic, fixed step, no rendering. Single source of truth for gameplay rules.
import type { LevelData, Obstacle, Profile, Racer, RacerStats, SimEvents } from './types';

export interface RacerSetup { profile: Profile; isPlayer: boolean; stats: RacerStats; skill: number }
/** shared snow bridge plugging a hole */
export interface Bridge { o: number; x0: number; x1: number }

export class RaceSim {
  time = 0;
  running = false;
  racers: Racer[] = [];
  /** ids of destroyed obstacles (shared by everybody) */
  broken = new Set<number>();
  bridges: Bridge[] = [];
  /** ids of collected pickups */
  taken = new Set<number>();
  /** finish order */
  order: Racer[] = [];

  constructor(public level: LevelData, setups: RacerSetup[], public events: SimEvents = {}) {
    throw new Error('TODO RaceSim' + setups.length);
  }
  /** countdown over: everybody runs */
  start(): void { throw new Error('TODO'); }
  /** advance by a fixed step (1/60) */
  step(dt: number): void { throw new Error('TODO' + dt); }
  get player(): Racer { throw new Error('TODO'); }
  /** current lateral x of a (moving) obstacle */
  obstacleX(o: Obstacle, t = this.time): number { throw new Error('TODO' + o + t); }
  /** hammer swing angle (rad) */
  hammerAngle(o: Obstacle, t = this.time): number { throw new Error('TODO' + o + t); }
  /** remaining strength of a destructible obstacle (too-small balls chip it: -0.5*size per hit); Infinity if indestructible */
  strengthLeft(o: Obstacle): number { throw new Error('TODO' + o); }
  /** icicle: warn 0..1 (shadow growing), fall -1 (hanging) or 0..1 (dropping/impact), hit = dangerous now */
  icicleState(o: Obstacle, t = this.time): { warn: number; fall: number; hit: boolean } { throw new Error('TODO' + o + t); }
}
