import geometry from './frameGeometry.json';
import { SUMMONER_LOCOMOTION } from './summonerLocomotion';
import { spriteScale, type SpriteSpec } from '../../pixi/renderContract';
/** Measured master-reference frame mapping, shared across the whole cycle, never a per-animation fudge factor. */
export function gaitGeometry(id: string, spec: SpriteSpec, tile: number, textureHeight: number) {
  const g = geometry[id as keyof typeof geometry];
  if (!g) return null;
  const masterScale = spriteScale(spec, g.masterHeight, tile);
  const cellScale = textureHeight / 256;
  return {
    scale: (g.masterVisibleHeight * masterScale) / (g.referenceVisibleHeight * cellScale),
    anchorY: g.groundY / 256,
    topClearance:
      (g.gaitVisibleHeight * g.masterVisibleHeight * masterScale) / g.referenceVisibleHeight -
      (g.masterBottom - spec.anchorY * g.masterHeight) * masterScale,
    supportOffset: (g.masterBottom - spec.anchorY * g.masterHeight) * masterScale,
  };
}
export function sourceFacingSign(id: string, motion: string = 'idle'): 1 | -1 {
  if (['veil_stalker','veil_guardian','veil_beast'].includes(id)) return -1;
  // Fox master faces right; the independently illustrated locomotion sheet faces left.
  const native =
    id === 'fox' && motion !== 'walk' && motion !== 'run'
      ? 'RIGHT'
      : SUMMONER_LOCOMOTION[id as keyof typeof SUMMONER_LOCOMOTION]?.nativeFacing;
  return native === 'LEFT' ? -1 : 1;
}
