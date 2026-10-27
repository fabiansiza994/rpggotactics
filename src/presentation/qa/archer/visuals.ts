import type { CharacterAnimationLayout } from '../../pixi/characterAnimations';
import type { CardinalView } from '../../pixi/directionalFacing';

/** Visual specimen only: no hero, deck, card or server definition is registered. */
export const ARCHER_VISUAL_ID = 'qa_archer';
export const ARCHER_PORTRAITS = {
  battle: '/art/archer/portrait.webp',
  thumbnail: '/art/archer/thumbnail.webp',
};
/** Measured on packed 256px release frame, at the bow/string grip (not unit center). */
export const ARCHER_RELEASE_POINTS: Record<CardinalView,{x:number;y:number}> = {
  front:{x:.60,y:.31}, back:{x:.25,y:.28}, left:{x:.28,y:.37}, right:{x:.87,y:.37},
};
export const ARCHER_RELEASE_FRAME = 3;
export const ARCHER_ANIMATION: CharacterAnimationLayout = {
  url: '/art/archer/front.webp', columns: 4, cellSize: 256, runtimeScale: .5,
  actionStyle: 'martial',
  directionalUrls: {
    front: '/art/archer/front.webp', back: '/art/archer/back.webp',
    left: '/art/archer/left.webp', right: '/art/archer/right.webp',
  },
  clips: {
    idle: { start: 0, count: 1, frameMs: 3200, loop: true },
    walk: { start: 4, count: 4, frameMs: 140, loop: true },
    run: { start: 8, count: 4, frameMs: 95, loop: true },
    attack: { start: 12, count: 5, frameMs: 90, loop: false },
    hit: { start: 17, count: 3, frameMs: 55, loop: false },
    death: { start: 20, count: 4, frameMs: 150, loop: false, terminal: true },
  },
};

/** Presentation beats, not engine timing. Reduced motion preserves release → impact order. */
export function archerShotTiming(reduced: boolean) {
  return reduced ? { release: 90, travel: 90, recovery: 110 } : { release: 300, travel: 220, recovery: 180 };
}
