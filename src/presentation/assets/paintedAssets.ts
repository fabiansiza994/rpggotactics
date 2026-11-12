import { TEMPLE_REWARD_ART } from './templeRewards';
import { archerPresentationEnabled } from '../archerRelease';
import { SHAPESHIFTER_CARD_ART } from './shapeshifterCards';
import { shapeshifterPresentationEnabled } from '../shapeshifterRelease';
import { QA_FORM_VISUALS, QA_TRANSFORM_ART, QA_CHAMPION_PORTRAIT } from '../qa/shapeshifter/visuals';
/** Local, project-owned artwork. No game definitions depend on these assets. */
const root = '/art/checkpoint05';
/** Arsenal I assets are available for QA; this registry never releases the expansion. */
export const ARSENAL_CARD_ART_IDS = ['arcane_chain', 'mirror_step', 'silence_seal', 'pack_call', 'bond_sacrifice', 'alpha_instinct', 'challenge', 'guard_breaker', 'titan_step', 'smoke_bomb', 'grappling_hook', 'field_ration'] as const;
export const CHARACTER_PAINTINGS: Record<string, string> = Object.fromEntries(
  ['mage', 'orc_warrior', 'shadow_wolf', 'dark_shaman', 'stone_brute', 'crystal'].map((id) => [
    id,
    `${root}/characters/${id}.webp`,
  ]),
);
export const CARD_PAINTINGS: Record<string, string> = Object.fromEntries(
  [
    'fireball',
    'blink',
    'ice_wall',
    'arcane_burst',
    'barrier',
    'magic_missile',
    'force_push',
    'frost_nova',
    'arcane_surge',
    'phase_step',
    'flame_tile',
    'dispel',
  ].map((id) => [id, `${root}/cards/${id}.webp`]),
);
export const ENVIRONMENT_PAINTINGS: Record<string, string> = Object.fromEntries(
  ['duel', 'sanctuary', 'fracture'].map((id) => [id, `${root}/environments/${id}.webp`]),
);
export const MATERIAL_PAINTINGS: Record<string, string> = Object.fromEntries(
  ['stone', 'pillar', 'rubble', 'ice_obstacle'].map((id) => [id, `${root}/materials/${id}.webp`]),
);
ENVIRONMENT_PAINTINGS.veil_forest = '/art/archer-hunt/veil_forest.webp';
for (const id of ['veil_tree', 'veil_brambles', 'veil_cover', 'veil_relic', 'veil_camp'])
  MATERIAL_PAINTINGS[id] = `/art/archer-hunt/${id}.webp`;
for (const id of ['veil_stalker', 'veil_guardian', 'veil_beast', 'veil_relic'])
  CHARACTER_PAINTINGS[id] = `/art/archer-hunt/${id}.webp`;

CHARACTER_PAINTINGS.chicken = '/art/summoner/chicken.webp';
CARD_PAINTINGS.summon_chicken = '/art/summoner/chicken.webp';

for (const id of ['fox', 'turtle', 'raven', 'wolf', 'summoner']) {
  CHARACTER_PAINTINGS[id] = `/art/summoner/${id}.webp`;
  if (id !== 'summoner') CARD_PAINTINGS[`summon_${id}`] = `/art/summoner/${id}.webp`;
}

/** Final Phase 4C illustrations, independent of combat/VFX keys. */
export const FINAL_CARD_ART: Record<string, string> = Object.fromEntries(
  [
    'arcane_burst_ii',
    'glacial_field',
    'repulse',
    'blink_ii',
    'glacial_shell',
    'pack_hymn',
    'spur_familiar',
    'vital_offering',
    'entangle',
    'recall_familiar',
  ].map((id) => [id, `/art/store-cards/${id}.webp`]),
);
for (const id of ['ice_arrow', 'fire_arrow', 'poison_arrow', 'rebound_arrow', 'smoke_arrow', 'fresh_trail', 'branch_leap', 'hunters_snare', 'pinning_arrow', 'predator_eye'])
  FINAL_CARD_ART[id] = `/art/archer-hunt/${id}.webp`;
for (const id of ARSENAL_CARD_ART_IDS) FINAL_CARD_ART[id] = `/art/arsenal-cards/${id}.webp`;
/** Final Vitrina I art; release remains governed by server catalog policy. */
for (const id of ['frost_comet', 'pack_oath', 'judgement_hammer']) FINAL_CARD_ART[id] = `/art/showcase-cards/${id}.webp`;

CHARACTER_PAINTINGS.warrior = '/art/checkpoint05/characters/warrior.webp';
for (const id of [
  'heavy_strike',
  'shield_bash',
  'warrior_charge',
  'guard',
  'riposte',
  'second_wind',
  'brutal_shove',
  'steady_advance',
  'sweep',
  'grapple',
  'steel_wall',
  'bastion',
  'ram',
  'unstoppable',
  'vanguard_fury',
  'execution',
])
  FINAL_CARD_ART[id] = `/art/store-cards/${id}.webp`;

/** Board masters can use the normalized foot anchor independently of portrait framing. */
export const BATTLE_CHARACTER_PAINTINGS: Record<string, string> = {
  warrior: '/art/animations/warrior_idle.webp',
};

/** QA ritual illustrations: artwork availability never changes release or ownership. */
for (const id of [
  'rune_stone',
  'rune_shell',
  'mark_moon',
  'mark_fang',
  'mark_blood',
  'summon_war_drake',
])
  FINAL_CARD_ART[id] = `/art/store-cards/${id}.webp`;

for (const id of ['ancient_turtle', 'war_drake', 'ancient_wolf'])
  CHARACTER_PAINTINGS[id] = `/art/rituals/${id}.webp`;

ENVIRONMENT_PAINTINGS.infernal_forge = '/art/infernal/forge-background.webp';
MATERIAL_PAINTINGS.infernal_basalt = '/art/infernal/basalt.webp';
for (const id of ['infernal_imp', 'infernal_knight', 'infernal_jailer', 'ash_shaman', 'magma_beast', 'forge_king'])
  CHARACTER_PAINTINGS[id] = `/art/infernal/${id}.webp`;
MATERIAL_PAINTINGS.infernal_lava = '/art/infernal/lava.webp';

for (const id of ['magma_fissure', 'summon_ash_hound', 'forge_strike']) FINAL_CARD_ART[id] = `/art/world-rewards/${id}.webp`;
CHARACTER_PAINTINGS.ash_hound = '/art/infernal/ash_hound.webp';

/** Tactical QA card art never releases a set or changes its rarity. */
export const TACTICAL_CARD_ART_IDS = ['emergency_strike','take_cover','step_back','first_aid','shove','binder_strike','binding_ward','mark_prey'] as const;
for(const id of TACTICAL_CARD_ART_IDS) FINAL_CARD_ART[id]=`/art/tactical-cards/${id}.webp`;

/** Final original Primordial art; acquisition is gated independently by release flags. */
CHARACTER_PAINTINGS.primordial_dragon = '/art/primordial/primordial_dragon.webp';
for (const id of ['seal_claw', 'seal_fang', 'seal_wing', 'seal_heart'])
  FINAL_CARD_ART[id] = `/art/primordial/${id}.webp`;

// Static infernal dressing; shared texture cache, no combat or collision changes.
MATERIAL_PAINTINGS.infernal_pylon = '/art/infernal-props/pylon.webp';
MATERIAL_PAINTINGS.infernal_cage_support = '/art/infernal-props/cage_support.webp';

MATERIAL_PAINTINGS.root_snare = '/art/status/root_snare.webp';

/** Rastreo has independent final artwork; gameplay/VFX identity remains unchanged. */
FINAL_CARD_ART.pack_tracking = "/art/summoner-cards/pack_tracking.webp";

if (shapeshifterPresentationEnabled) {
 CHARACTER_PAINTINGS.shapeshifter = QA_CHAMPION_PORTRAIT;
 for (const [id,v] of Object.entries(QA_FORM_VISUALS)) {
   CHARACTER_PAINTINGS[`qa_form_${id}`] = v.poses.idle;
   for (const [pose,url] of Object.entries(v.poses)) CHARACTER_PAINTINGS[`qa_form_${id}:${pose}`] = url;
 }
 for (const [id,v] of Object.entries(QA_TRANSFORM_ART)) FINAL_CARD_ART[id] = v.art;
 Object.assign(FINAL_CARD_ART, SHAPESHIFTER_CARD_ART);
}

if (archerPresentationEnabled) CHARACTER_PAINTINGS.qa_archer = '/art/archer/idle.webp';
/** Playable QA Archer (data/archer.ts): the existing approved portrait, never a new one. */
if (archerPresentationEnabled) CHARACTER_PAINTINGS.archer = '/art/archer/portrait.webp';

/** Final Archer illustrations; asset registration never releases the champion. */
for (const id of ['archer_shot','hunters_eye','true_shot','stalker_step','piercing_arrow','heart_shot','tactical_retreat','bramble_trap','executioner_arrow']) FINAL_CARD_ART[id] = `/art/archer-cards/${id}.webp`;

FINAL_CARD_ART.unleashed_hunt = "/art/summoner-cards/unleashed_hunt.webp";

/** Ranked Preseason paintings; acquisition and rarity remain core data. */
export const RANKED_CARD_ART_IDS = ['palisade','wall_patience','pact_relay','wild_burst','ignition_rune','altar_echo','siege_leap','tracking_arrow','arcane_exchange'] as const;
for (const id of RANKED_CARD_ART_IDS) FINAL_CARD_ART[id] = `/art/ranked-cards/${id}.webp`;

/** Act III rewards: individual illustrations; no gameplay rarity or availability changes. */
Object.assign(FINAL_CARD_ART, TEMPLE_REWARD_ART);
for (const id of ['heart_warden', 'temple_architect'])
  CHARACTER_PAINTINGS[id] = `/art/temple/characters/${id}.webp`;

/** Cuidar bandada: original group-protection illustration, shared by every card surface. */
FINAL_CARD_ART.nurture = "/art/summoner-cards/nurture.webp";
CARD_PAINTINGS.nurture = FINAL_CARD_ART.nurture;

// Free catalog: original landscape illustrations; release availability remains flag-controlled.
for (const id of ["arcane_pull", "elemental_detonation", "archmage_eruption", "binder_command", "summon_pact_golem", "bastion_blow", "last_bastion", "hunters_net", "arrow_rain", "minotaur_awakening", "form_dance", "ancestral_stampede"]) FINAL_CARD_ART[id] = `/art/free-catalog/${id}.webp`;

// Catalog inspection can show approved transformation art while the champion/set stays locked.
for (const [id, visual] of Object.entries(QA_TRANSFORM_ART)) FINAL_CARD_ART[id] = visual.art;

CHARACTER_PAINTINGS.pact_golem = '/art/free-catalog/pact_golem.webp';

// Final Ranked Premium art: paths only; loading remains demand-driven by each card surface.
for (const id of ["double_moon_pact", "fallen_king_wall", "stalker_heart", "ash_eclipse", "primal_ascent"]) FINAL_CARD_ART[id] = `/art/ranked-premium/${id}.webp`;

// Vínculo Prohibido: original painted ritual scene (qa/forbidden-bond-art-20261022).
FINAL_CARD_ART.forbidden_bond = "/art/forbidden-bond/forbidden_bond.webp";

/** Mage Thunder: original approved-scope expansion artwork. */
for (const id of ["thunder_discharge", "chain_lightning", "arcane_overload", "paralyzing_pulse", "tempest_judgment"]) FINAL_CARD_ART[id] = `/art/mage-elements/${id}.webp`;

// Thunder expansion: individual optimized illustrations, loaded by card on demand.
for (const id of ["fulminating_spear", "voltaic_armor", "lightning_step", "storm_orb", "conductive_mark", "thunder_hammer", "static_field", "electric_frenzy", "lightning_wall", "storm_avatar"]) FINAL_CARD_ART[id] = `/art/mage-thunder/${id}.webp`;
