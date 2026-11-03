// Procedural 16x16 pixel-art textures and UI icons (owner: art). Our own art, generic voxel style.
import type { Texture } from 'aiwebengine';

export type TexId =
  | 'snow' | 'snowSide' | 'dirt' | 'ice' | 'packedIce' | 'thaw' | 'salt' | 'boost' | 'planks' | 'log' | 'logTop'
  | 'leaves' | 'snowLeaves' | 'stone' | 'cobble' | 'brick' | 'wool' | 'giftRed' | 'giftGreen' | 'giftBlue' | 'giftGold'
  | 'coal' | 'fire' | 'water' | 'gold' | 'glass' | 'lamp' | 'candy' | 'iceWall' | 'spike' | 'metal' | 'redWool' | 'window';

/** cached nearest-filtered repeating texture */
export function tex(id: TexId): Texture { throw new Error('TODO tex ' + id); }
/** the 16x16 source canvas (do not modify) */
export function texCanvas(id: TexId): HTMLCanvasElement { throw new Error('TODO texCanvas ' + id); }

export type IconId =
  | 'coin' | 'gem' | 'trophy' | 'gift' | 'ad' | 'lock' | 'star' | 'speed' | 'grip' | 'armor' | 'start' | 'magnet'
  | 'snowflake' | 'tree' | 'bell' | 'shield' | 'boost' | 'grow' | 'case_snow' | 'case_ice' | 'case_santa' | 'key'
  | 'clock' | 'crown' | 'sound' | 'mute' | 'music' | 'cart' | 'shirt' | 'up' | 'calendar' | 'back' | 'close' | 'check'
  | 'play' | 'noads' | 'fire' | 'flag';

/** pixel-art icon as a PNG data URL (cached); render with image-rendering:pixelated */
export function iconURL(id: IconId): string { throw new Error('TODO iconURL ' + id); }

/** sign texture with big pixel digits/text (e.g. wall strength "15", bonus "x2") */
export function signTexture(text: string, fg?: string, bg?: string): Texture { throw new Error('TODO signTexture ' + text + fg + bg); }
