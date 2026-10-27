/** Ground overlays always sit above decorative floor art and below actors. */
export const TACTICAL_LAYER_ORDER = [
  'background',
  'base',
  'floor',
  'terrain',
  'objectives',
  'actors',
  'foreground',
  'ui',
] as const;
export function tacticalTileStyle(terrain: string) {
  const styles: Record<string, { color: number; alpha: number }> = {
    FIRE: { color: 0xe85d24, alpha: 0.46 },
    ICE: { color: 0x78ddef, alpha: 0.48 },
    SMOKE: { color: 0x8894a5, alpha: 0.45 },
  };
  return styles[terrain];
}
export const GUARDIAN_FLOOR = { x: 5.5, y: 2.5, radius: 2.05 } as const;

export function guardianOpening(
  state: { round: number },
  guardian?: { state: string; untilRound?: number },
) {
  if (guardian?.state !== 'EXPOSED') return 0;
  return Math.min(1, Math.max(0, ((guardian.untilRound ?? state.round) - state.round + 1) / 2));
}
