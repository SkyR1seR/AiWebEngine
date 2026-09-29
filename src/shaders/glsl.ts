import frame from './frame.glsl';
import lit from './lit.glsl';
import sky from './sky.glsl';
import particles from './particles.glsl';

/** Built-in GLSL library (bundled only with the WebGL2 backend chunk). */
export const glslLib: Record<string, string> = {
  lit: frame + '\n' + lit,
  sky: frame + '\n' + sky,
  particles: frame + '\n' + particles,
};
