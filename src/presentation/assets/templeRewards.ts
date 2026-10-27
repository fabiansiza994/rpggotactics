/** Art-only release registry. Never alters acquisition, rarity or reward pools. */
export const TEMPLE_REWARD_ART_IDS = [
  'threshold_wave',
  'threshold_call',
  'colossus_shove',
  'deflecting_arrow',
  'threshold_pounce',
  'threshold_step',
  'broken_seal',
  'counterweight_rope',
] as const;
export const TEMPLE_REWARD_ART = Object.fromEntries(
  TEMPLE_REWARD_ART_IDS.map((id) => [id, `/art/temple/cards/${id}.webp`]),
);
