import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ENCOUNTER_IDENTITY,
  unitVisualId,
  unitVisualTint,
} from '../src/presentation/assets/visualIdentity';
import {
  CHARACTER_PAINTINGS,
  ENVIRONMENT_PAINTINGS,
  MATERIAL_PAINTINGS,
} from '../src/presentation/assets/paintedAssets';
import { CHARACTER_ANIMATIONS } from '../src/presentation/pixi/characterAnimations';
import { CHARACTER_SPECS } from '../src/presentation/pixi/renderContract';

describe('infernal presentation asset contracts', () => {
  it('all six enemies have separate owned artwork and anchored action clips', () => {
    for (const id of [
      'infernal_imp',
      'infernal_knight',
      'ash_shaman',
      'magma_beast',
      'infernal_jailer',
      'forge_king',
    ]) {
      expect(unitVisualId(id)).toBe(id);
      expect(unitVisualTint(id)).toBe(0xffffff);
      expect(existsSync(`public${CHARACTER_PAINTINGS[id]}`)).toBe(true);
      expect(existsSync(`public${CHARACTER_ANIMATIONS[id]!.url}`)).toBe(true);
      expect(CHARACTER_SPECS[id]!.anchorY).toBe(0.875);
      for (const clip of ['idle', 'walk', 'attack', 'hit', 'death'] as const)
        expect(CHARACTER_ANIMATIONS[id]!.clips[clip]).toBeDefined();
    }
  });
  it('ten encounters use the forge identity while Ascent retains its environments', () => {
    for (let i = 1; i <= 10; i++)
      expect(ENCOUNTER_IDENTITY[`w2_e${String(i).padStart(2, '0')}`]!.theme).toBe('infernal_forge');
    expect(ENCOUNTER_IDENTITY.first_blood!.theme).toBe('duel');
    for (const path of [
      ENVIRONMENT_PAINTINGS.infernal_forge,
      MATERIAL_PAINTINGS.infernal_basalt,
      MATERIAL_PAINTINGS.infernal_lava,
    ])
      expect(existsSync(`public${path}`)).toBe(true);
  });
});
