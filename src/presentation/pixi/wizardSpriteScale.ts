import { CHARACTER_ANIMATIONS } from './characterAnimations.ts';
import { TILE } from './renderContract.ts';

/** Match the original half-resolution atlas, regardless of the directional texture's resolution. */
export function wizardSpriteScale(textureHeight: number): number {
  return (
    (TILE / (286 * CHARACTER_ANIMATIONS.mage!.runtimeScale)) *
    (CHARACTER_ANIMATIONS.mage!.cellSize / textureHeight)
  );
}
