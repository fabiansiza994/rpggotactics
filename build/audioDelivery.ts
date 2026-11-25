import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
/** Public-directory copies bypass JS tree shaking. Strip private listening collections
 * from the build output only; original files and the DEV listening lab stay intact. */
export function audioDelivery(): Plugin {
  let out = '';
  return {
    name: 'selected-audio-delivery', apply: 'build',
    configResolved(config) { out = resolve(config.root, config.build.outDir); },
    async closeBundle() {
      if (!out || out === resolve('public')) throw new Error('Unsafe audio output directory');
      await Promise.all(['arcane-v1', 'arcane-v2'].map(name => rm(resolve(out, 'audio', name), { recursive: true, force: true })));
    },
  };
}
