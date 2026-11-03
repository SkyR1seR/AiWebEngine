// Gameplay tunables (owner: core). Other modules may read the exported constants.
/** start ball size before upgrades */
export const START_SIZE = 3;
export const MAX_SIZE = 30;
/** gap between the racer and the ball surface (m): ball center d = racer d + r + BALL_AHEAD */
export const BALL_AHEAD = 0.45;
/** skin pixel size in meters (character is 32 px = 1.44 m tall) */
export const PX = 0.045;
/** start line x positions; player is at index 2 (center) */
export const START_X = [-4.8, -2.4, 0, 2.4, 4.8];
