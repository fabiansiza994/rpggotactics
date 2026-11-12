/** Cosmetic tails only; never used by spellTimeline, HP, recoil or the action queue. */
export const ELEMENTAL_REACTION_MS = { fire: 650, ice: 700, arcane: 600 } as const;
export type ElementalReactionKind = keyof typeof ELEMENTAL_REACTION_MS;
export function elementalReactionDuration(kind: ElementalReactionKind, adjusted: boolean): number {
  return adjusted ? ELEMENTAL_REACTION_MS[kind] : kind === 'arcane' ? 340 : 380;
}
/** Immediate contact, readable manifestation, then a soft residual fade. */
export function elementalReactionEnvelope(t: number): number {
  if (t < .1) return .8 + 2 * t;
  if (t < .55) return 1;
  return Math.max(0, (1 - t) / .45) ** 1.25;
}
