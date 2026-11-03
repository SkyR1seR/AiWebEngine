// Blocky character from a 64x64 skin + accessories (owner: art). Feet at y=0, faces +Z, 1.44 m tall.
import type { Node } from 'aiwebengine';

export interface Character { root: Node; head: Node; body: Node; armR: Node; armL: Node; legR: Node; legL: Node; skin: string }
export type Pose = 'idle' | 'run' | 'push' | 'stun' | 'fall' | 'cheer' | 'sad' | 'wave';

export function createCharacter(skinId: string): Character { throw new Error('TODO ' + skinId); }
/** procedural pose at time t (s); speed scales the run cycle (m/s) */
export function animateCharacter(c: Character, pose: Pose, t: number, speed = 6): void { throw new Error('TODO ' + c + pose + t + speed); }
