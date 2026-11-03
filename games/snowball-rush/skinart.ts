// Procedural skins (owner: art): 64x64 character skins, UI portraits/figures, voxel ball looks and icons.
import type { Geometry, Material, Texture } from 'aiwebengine';

/** 64x64 skin canvas (cached; do not modify) */
export function skinCanvas(id: string): HTMLCanvasElement { throw new Error('TODO ' + id); }
export function skinTexture(id: string): Texture { throw new Error('TODO ' + id); }
/** NEW canvas each call: head front (avatar), px = output size */
export function skinPortrait(id: string, px = 48): HTMLCanvasElement { throw new Error('TODO ' + id + px); }
/** NEW canvas each call: full body front view (cards), px = output height */
export function skinFigure(id: string, px = 128): HTMLCanvasElement { throw new Error('TODO ' + id + px); }
/** signature color of a skin (markers on the progress bar) */
export function skinColor(id: string): string { throw new Error('TODO ' + id); }
/** voxel ball of radius 1 for a ball skin (cached) */
export function ballGeometry(id: string): Geometry { throw new Error('TODO ' + id); }
/** material for a ball skin (cached) */
export function ballMaterial(id: string): Material { throw new Error('TODO ' + id); }
/** NEW canvas each call: 2D pixel ball icon */
export function ballIcon(id: string, px = 64): HTMLCanvasElement { throw new Error('TODO ' + id + px); }
