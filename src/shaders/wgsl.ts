import frame from './frame.wgsl';
import lit from './lit.wgsl';
import sky from './sky.wgsl';
import particles from './particles.wgsl';

/** Built-in WGSL library (bundled only with the WebGPU backend chunk). */
export const wgslLib: Record<string, string> = {
  lit: frame + '\n' + lit,
  sky: frame + '\n' + sky,
  particles: frame + '\n' + particles,
};
