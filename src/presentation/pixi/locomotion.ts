import type { Pos } from '../../game';
import type { CharacterMotion } from './CharacterAnimator';
import type { CharacterAnimationLayout } from './characterAnimations';
export type LocomotionMode = 'walk' | 'run';
/** Executed path length, never Manhattan distance or remaining move budget. */
export function locomotionRoute(move: { from: Pos; to: Pos; path: readonly Pos[] }) {
  const cells = [move.from, ...move.path, move.to].filter(
    (p, i, a) => !i || p.x !== a[i - 1]!.x || p.y !== a[i - 1]!.y,
  );
  const segments = cells.slice(1).map((to, i) => ({ from: cells[i]!, to }));
  return { segments, mode: segments.length >= 3 ? ('run' as const) : ('walk' as const) };
}
/** Honest fallback: reuse an authored gait, without claiming missing run frames exist. */
export function locomotionClip(
  layout: CharacterAnimationLayout | undefined,
  mode: LocomotionMode,
): CharacterMotion | null {
  const clips = layout?.clips;
  const choices: CharacterMotion[] =
    mode === 'run' ? ['run', 'walk', 'walk_heavy'] : ['walk', 'walk_heavy', 'run'];
  return choices.find((id) => (clips?.[id]?.count ?? 0) > 1) ?? null;
}
