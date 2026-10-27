import { fireballPilotAllowed } from './fireballRecipe';

/** Local visual rollout only; original timeline and combat payloads are unchanged. */
export const magePilot = { frost: true, missile: true };
export type MageRecipeKey = 'frost_nova' | 'magic_missile';
export const mageRecipeEnabled = (key: string): key is MageRecipeKey =>
  fireballPilotAllowed() &&
  (key === 'frost_nova' ? magePilot.frost : key === 'magic_missile' && magePilot.missile);
export const MAGE_FRAMES = {
  frostWave: [0, 1, 2, 3],
  iceCharge: [4],
  iceShard: [5],
  mist: [6],
  iceSpark: [7],
  arcaneImpact: [8, 9, 10, 11],
  arcaneCharge: [12],
  missile: [13],
  trail: [14],
  mote: [15],
} as const;
