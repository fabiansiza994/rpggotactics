import { sourceFacingSign } from '../qa/locomotion/gaitGeometry';
import type { CharacterMotion } from './CharacterAnimator';

/** Presentation-only poses: never consume gameplay RNG or change ground anchors. */
export const SUMMON_MOTION = {
  primordial_dragon: { gaitMs: 380, lift: .6, lean: .018, attackLean: .065, lunge: 8, idleLift: .3 },
  chicken: { gaitMs: 115, lift: 3.2, lean: 0.05, attackLean: 0.23, lunge: 4, idleLift: 0.4 },
  fox: { gaitMs: 160, lift: 2, lean: 0.045, attackLean: 0.09, lunge: 8, idleLift: 0.3 },
  wolf: { gaitMs: 210, lift: 1.3, lean: 0.03, attackLean: 0.12, lunge: 10, idleLift: 0.25 },
  turtle: { gaitMs: 420, lift: 0.35, lean: 0.025, attackLean: 0.035, lunge: 3, idleLift: 0.1 },
  raven: { gaitMs: 180, lift: 5, lean: 0.035, attackLean: -0.13, lunge: 2, idleLift: 1.2 },
} as const;

export function summonPose(
  id: string,
  motion: CharacterMotion,
  progress: number,
  clock: number,
  moving: boolean,
  reduced: boolean,
) {
  const profile = SUMMON_MOTION[id as keyof typeof SUMMON_MOTION];
  if (!profile) return null;
  const t = Math.max(0, Math.min(1, progress));
  const pulse = Math.sin(t * Math.PI);
  const gait = Math.sin((clock / profile.gaitMs) * Math.PI);
  const idle = Math.sin(clock / 900);
  if (motion === 'death')
    return { x: 0, y: 0, rotation: reduced ? 0 : t * 0.12, scaleY: 1, alpha: 1 - t };
  if (reduced) return { x: 0, y: 0, rotation: 0, scaleY: 1, alpha: 1 };
  if (motion === 'arrival')
    return {
      x: 0,
      y: -pulse * (id === 'raven' ? 7 : 2),
      rotation: 0,
      scaleY: 0.94 + t * 0.06,
      alpha: t,
    };
  if (motion === 'hit')
    return { x: -pulse * 2, y: 0, rotation: -pulse * 0.07, scaleY: 1, alpha: 1 };
  if (id === 'primordial_dragon' && motion === 'attack') {
    // Retract before the heavy bite; return to the unchanged ground anchor.
    const bite = t < .25 ? -Math.sin(t / .25 * Math.PI / 2) * 2
      : Math.sin((t - .25) / .75 * Math.PI) * profile.lunge;
    return { x: bite, y: 0, rotation: bite / profile.lunge * profile.attackLean,
      scaleY: 1 - Math.max(0, bite) * .004, alpha: 1 };
  }
  if (motion === 'attack')
    return {
      x: pulse * profile.lunge,
      y: -pulse * (id === 'raven' ? 4 : 0),
      rotation: pulse * profile.attackLean,
      scaleY: 1 - pulse * 0.035,
      alpha: 1,
    };
  return {
    x: 0,
    y: moving ? -Math.abs(gait) * profile.lift : -idle * profile.idleLift,
    rotation: moving ? gait * profile.lean : 0,
    scaleY: 1,
    alpha: 1,
  };
}

/** PaintedFigure mirrors each native source for logical RIGHT.
 * World-space pose impulses must use logical facing rather than source texture scale. */
export function summonFacingSign(id: string, sourceScaleX: number): number {
  return (Math.sign(sourceScaleX) || 1) * sourceFacingSign(id);
}
