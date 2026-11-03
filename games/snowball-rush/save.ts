// Save data (owner: meta): defaults, migration/normalization, currency helpers.
import type { Currency, Save } from './types';

export const SAVE_VERSION = 1;
export function defaultSave(now: number): Save { throw new Error('TODO' + now); }
/** fill missing/invalid fields of loaded data (cloud or localStorage) */
export function normalize(raw: Partial<Save> | null | undefined, now: number): Save { throw new Error('TODO' + raw + now); }
export function canAfford(s: Save, cur: Currency, n: number): boolean { throw new Error('TODO' + s + cur + n); }
/** subtract if affordable; returns success */
export function spend(s: Save, cur: Currency, n: number): boolean { throw new Error('TODO' + s + cur + n); }
export function earn(s: Save, cur: Currency, n: number): void { throw new Error('TODO' + s + cur + n); }
