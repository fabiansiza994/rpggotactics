/** Individual final paintings. Metadata only: ownership/release/gameplay are unchanged. */
export const PRIMORDIAL_LEGACY_ART_IDS = [
  'thorn_wall','refuge','purifying_claws','guardian_circle','sap_blood','territorial_rejection',
  'verdict_axe','break_encirclement','maze_mark','conqueror_march','threshold_edge','silent_horns',
  'lineage_pulse','shedding_rite','hunt_echo','skin_memory','ancestor_round','untamed_bond',
].map(id => `qa_legacy_${id}`);
export const PRIMORDIAL_LEGACY_CARD_ART: Readonly<Record<string,string>> = Object.fromEntries(
  PRIMORDIAL_LEGACY_ART_IDS.map(id => [id, `/art/primordial-legacy/${id}.webp`]),
);
