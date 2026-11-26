import { rm,cp,mkdir } from 'node:fs/promises';
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
      await Promise.all(['arcane-v1', 'arcane-v2', 'arcane-battle'].map(name => rm(resolve(out, 'audio', name), { recursive: true, force: true })));
      const dest=resolve(out,'audio/arcane-battle/v1');await mkdir(dest,{recursive:true});
      for(const name of ['battle_music_ancient_battlefield.m4a','battle_music_echoes_of_the_arcane.m4a','battle_music_the_silent_war.m4a','battle_victory_A.mp3','battle_defeat_A.mp3','battle_turn_start_A.mp3','battle_enemy_turn_A.mp3'])await cp(resolve('public/audio/arcane-battle/v1',name),resolve(dest,name));
    },
  };
}
