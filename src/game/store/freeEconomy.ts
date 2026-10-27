/** Initial gameplay economy. Currency prices and battle rules are unchanged. */
export const DAILY_FIRST_WIN_CRYSTALS = 40;
export const ASCENT_CRYSTAL_MILESTONES: Readonly<Record<number, number>> = {
  3: 30,
  5: 40,
  9: 50,
  10: 100,
};
/**
 * Act III «El Templo del Umbral» (World 3), by encounter number in the act: XXII (small), XXV and
 * XXIX (elites). With the 170 of its completion reward (data/worlds.ts WORLD_3) the act pays 250 per
 * champion: World 2 pays 250 (completion only), World 1 220 (milestones only).
 */
export const TEMPLE_CRYSTAL_MILESTONES: Readonly<Record<number, number>> = {
  2: 20,
  5: 30,
  9: 30,
};
/** Campaign id → crystal milestones (encounter number in play order → Arcane Crystals, once per champion). */
export const CAMPAIGN_CRYSTAL_MILESTONES: Readonly<Record<string, Readonly<Record<number, number>>>> = {
  ascent: ASCENT_CRYSTAL_MILESTONES,
  temple: TEMPLE_CRYSTAL_MILESTONES,
};
