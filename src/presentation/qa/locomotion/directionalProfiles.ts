import review from '../../../../qa/combat-depth/directional/art-review.json';
import assets from './verticalAssets.json';
import { shapeshifterPresentationEnabled } from '../../shapeshifterRelease';
import type { CardinalView } from '../../pixi/directionalFacing';
import { characterSpec, spriteScale, TILE } from '../../pixi/renderContract';
export interface VerticalAsset {
  front: string;
  back: string;
  referenceKind: 'master' | 'contractAtlas' | 'pilotAtlas';
  referenceHeight: number;
  referenceVisibleHeight: number;
  referenceBottom: number;
  referenceGroundY: number | null;
  masterHeight: number;
  masterVisibleHeight: number;
  masterBottom: number;
  visibleHeight: number;
  maxVisibleHeight: number;
  groundY: number;
  bytes: number;
}
export const VERTICAL_ASSETS = assets as Record<string, VerticalAsset>;
export const verticalAsset = (id: string) =>
  shapeshifterPresentationEnabled ? VERTICAL_ASSETS[id] : undefined;
export const isVerticalView = (view: CardinalView) => view === 'front' || view === 'back';
/** Scale is measured once for both directions and both gaits, never per frame. */
export function verticalGeometry(id: string, textureHeight: number) {
  const a = VERTICAL_ASSETS[id];
  if (!a) return null;
  const spec = characterSpec(id),
    scale =
      a.referenceKind === 'pilotAtlas'
        ? TILE / (286 * 0.5)
        : spriteScale(spec, a.referenceHeight, TILE);
  return {
    scale: (a.referenceVisibleHeight * scale) / ((a.visibleHeight * textureHeight) / 256),
    topClearance:
      ((a.referenceVisibleHeight * scale) / a.visibleHeight) * a.maxVisibleHeight -
      (a.referenceBottom - (a.referenceGroundY ?? a.referenceHeight * spec.anchorY)) * scale,
    anchorY: a.groundY / 256,
    supportOffset:
      (a.referenceBottom - (a.referenceGroundY ?? a.referenceHeight * spec.anchorY)) * scale,
  };
}
export const VERTICAL_TIMING = {
  walk: { count: 3, frameMs: 160, loop: true },
  run: { count: 3, frameMs: 95, loop: true },
} as const;

/** Correct the native handedness of genuine rear drawings, never derive rear art from a side. */
export function verticalMirror(id: string, view: string, motion: string, frame: number): boolean {
  if (view !== 'back') return false;
  const annotations = review as Record<string, { backMirrors: boolean[] }>;
  const index =
    (motion === 'run' ? 3 : 0) + (motion === 'walk' || motion === 'run' ? frame % 3 : 0);
  return annotations[id]?.backMirrors[index] ?? false;
}
