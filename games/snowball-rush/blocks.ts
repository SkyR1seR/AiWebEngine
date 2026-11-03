// Voxel geometry helpers (owner: art): merged block meshes grouped by texture, boxes, voxel spheres, sprites.
import type { Geometry, Material, MaterialOptions, Node } from 'aiwebengine';
import type { TexId } from './textures';

/** one texture for all faces, or [top, side, bottom] */
export type Faces = TexId | [TexId, TexId, TexId];
/** block centered at (x, y, z), size 1 unless sx/sy/sz given */
export interface Block { x: number; y: number; z: number; t: Faces; sx?: number; sy?: number; sz?: number }

/** cached lambert material with the pixel texture (opts change the cache key) */
export function blockMaterial(id: TexId, opts?: MaterialOptions): Material { throw new Error('TODO ' + id + opts); }
/** merge many blocks into few meshes (one per texture); faces between touching unit blocks are culled */
export function buildBlocks(blocks: Block[], opts?: { castShadow?: boolean; receiveShadow?: boolean }): Node { throw new Error('TODO ' + blocks.length + opts); }
/** box with per-meter tiled UVs, centered at origin */
export function boxGeometry(sx: number, sy: number, sz: number): Geometry { throw new Error('TODO ' + sx + sy + sz); }
/** sphere of radius 1 made of voxels on a res^3 grid (exposed faces only), vertex colors from paint(x,y,z in -1..1) → hex, uv per voxel face */
export function voxelSphere(res: number, paint: (x: number, y: number, z: number) => number): Geometry { throw new Error('TODO ' + res + paint); }
/** two crossed vertical quads (fire, plants), bottom at y=0 */
export function crossSprite(w: number, h: number): Geometry { throw new Error('TODO ' + w + h); }
