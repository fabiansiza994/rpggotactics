import { SUMMONER_LOCOMOTION } from '../qa/locomotion/summonerLocomotion';
import type { TerrainType } from '../../game/domain/terrain/terrain';

/** Presentation policy only. Never infer flying from the absence of a gait. */
export const AIRBORNE_VISUALS = new Set(
  Object.entries(SUMMONER_LOCOMOTION)
    .filter(([, profile]) => profile.travel === 'flight')
    .map(([id]) => id),
);
export function groundMaterial(terrain: TerrainType | undefined): 'dust' | 'frost' | null {
  if (terrain === 'ICE') return 'frost';
  return terrain && ['NORMAL', 'OBJECTIVE', 'COVER', 'SMOKE'].includes(terrain) ? 'dust' : null;
}
export function footfallBudget(
  running: boolean,
  heavy: boolean,
  compact: boolean,
  reduced: boolean,
) {
  return reduced ? 0 : Math.min(8, (running ? 4 : 2) + (heavy ? 2 : 0)) / (compact ? 2 : 1);
}
export const GROUND_PARTICLE_LIMIT = 64;
