import { isThunderAddition } from './thunderExpansionRecipe';
import { PULSE_TIMING } from './paralyzingPulseRecipe';
import { isThunderPremium, THUNDER_TIMING } from './thunderRecipe';
/** Presentation-only budgets. Never used to resolve authoritative commands. */
export type ResolutionFamily = 'fire' | 'ice' | 'arcane' | 'barrier' | 'movement' | 'push' | 'summon' | 'ritual';
export interface ResolutionProfile {
  family: ResolutionFamily;
  cast: number;
  travel: number;
  aftermath: number;
  read: number;
}
export const RESOLUTION_PROFILES: Record<ResolutionFamily, ResolutionProfile> = {
  fire: { family: 'fire', cast: 240, travel: 320, aftermath: 300, read: 200 },
  ice: { family: 'ice', cast: 250, travel: 0, aftermath: 420, read: 210 },
  arcane: { family: 'arcane', cast: 240, travel: 0, aftermath: 340, read: 220 },
  barrier: { family: 'barrier', cast: 220, travel: 0, aftermath: 380, read: 220 },
  movement: { family: 'movement', cast: 200, travel: 0, aftermath: 350, read: 220 },
  push: { family: 'push', cast: 220, travel: 100, aftermath: 380, read: 200 },
  summon: { family: 'summon', cast: 360, travel: 0, aftermath: 850, read: 240 },
  ritual: { family: 'ritual', cast: 450, travel: 0, aftermath: 1500, read: 450 },
};
const FAMILIES: Record<string, ResolutionFamily> = {
  fireball: 'fire', flame_tile: 'fire', magma_fissure: 'fire',
  frost_nova: 'ice', ice_wall: 'ice', glacial_field: 'ice',
  barrier: 'barrier', blink: 'movement', phase_step: 'movement', mirror_step: 'movement',
  force_push: 'push', repulse: 'push',
};
export function resolutionProfile(key: string, summon = false): ResolutionProfile {
  const family = summon || key.startsWith('summon_') ? 'summon' : FAMILIES[key] ?? 'arcane';
  const base = RESOLUTION_PROFILES[family];
  // Flat-art/projectile cards share the same phases without adding gameplay metadata.
  if (key === 'forbidden_bond') return { family: 'ritual', cast: 420, travel: 0, aftermath: 900, read: 340 }; // ~1.7 s total
  if (isThunderAddition(key)) return {...base, cast:key==='storm_avatar'?360:260, travel:['fulminating_spear','thunder_hammer','lightning_step'].includes(key)?240:80, aftermath:480, read:180};
  if (key === 'paralyzing_pulse') return {...base, ...PULSE_TIMING};
  if (isThunderPremium(key)) return { ...base, ...THUNDER_TIMING[key] };
  if (['thunder_discharge', 'chain_lightning', 'tempest_judgment'].includes(key)) return { ...base, travel: 260 };
  return key === 'magic_missile' ? { ...base, travel: 260 } : base;
}
export function resolutionTiming(key: string, reduced: boolean, summon = false) {
  const profile = resolutionProfile(key, summon);
  const cast = reduced ? 80 : profile.cast;
  const travel = reduced ? Math.min(60, profile.travel) : profile.travel;
  const aftermath = reduced ? 160 : profile.aftermath;
  const read = reduced ? 160 : profile.read;
  return { ...profile, cast, travel, aftermath, read, total: cast + travel + aftermath + read };
}
