/** Presentation palettes and encounter identity; never read by the rules engine. */
export const CARD_IDENTITY: Record<string, { tone: string; family: string; motif: string }> = {
  ...Object.fromEntries(['arcane_chain','mirror_step','silence_seal'].map(id=>[id,{tone:'#91dce8',family:'arcane',motif:'rune'}])),
  ...Object.fromEntries(['pack_call','bond_sacrifice','alpha_instinct'].map(id=>[id,{tone:'#c49de0',family:'bond',motif:'rune'}])),
  ...Object.fromEntries(['challenge','guard_breaker','titan_step'].map(id=>[id,{tone:'#c9b48a',family:'force',motif:'wave'}])),
  ...Object.fromEntries(['smoke_bomb','grappling_hook','field_ration'].map(id=>[id,{tone:'#b8b09e',family:'neutral',motif:'tool'}])),
  ...Object.fromEntries(['emergency_strike','take_cover','step_back','first_aid','shove'].map(id=>[id,{tone:'#b8b09e',family:'neutral',motif:'tool'}])),
  binder_strike:{tone:'#bb9edf',family:'bond',motif:'rune'},
  binding_ward:{tone:'#bb9edf',family:'bond',motif:'shield'},
  mark_prey:{tone:'#c6a6ef',family:'bond',motif:'prey'},
  summon_fox: { tone: '#d8b786', family: 'summon', motif: 'rune' },
  summon_turtle: { tone: '#a3c8a5', family: 'summon', motif: 'shield' },
  summon_raven: { tone: '#aaa5dc', family: 'summon', motif: 'rune' },
  summon_wolf: { tone: '#c3b5e8', family: 'summon', motif: 'rune' },
  summon_chicken: { tone: '#b4dba2', family: 'summon', motif: 'rune' },
  nurture: { tone: '#b4dba2', family: 'defense', motif: 'shield' },
  fireball: { tone: '#e6a266', family: 'fire', motif: 'ember' },
  flame_tile: { tone: '#e6a266', family: 'fire', motif: 'ember' },
  ice_wall: { tone: '#9edce6', family: 'ice', motif: 'crystal' },
  frost_nova: { tone: '#9edce6', family: 'ice', motif: 'crystal' },
  magic_missile: { tone: '#bba3df', family: 'arcane', motif: 'rune' },
  arcane_burst: { tone: '#bba3df', family: 'arcane', motif: 'rune' },
  arcane_surge: { tone: '#bba3df', family: 'arcane', motif: 'rune' },
  dispel: { tone: '#b1d5c8', family: 'arcane', motif: 'rune' },
  blink: { tone: '#9bbfe8', family: 'movement', motif: 'phase' },
  phase_step: { tone: '#9bbfe8', family: 'movement', motif: 'phase' },
  barrier: { tone: '#d9c38e', family: 'defense', motif: 'shield' },
  force_push: { tone: '#b0c9d0', family: 'force', motif: 'wave' },
  // Warrior: worn steel, oxblood and warm Momentum accents.
  heavy_strike: { tone: '#d39a7c', family: 'force', motif: 'wave' },
  shield_bash: { tone: '#c9b48a', family: 'force', motif: 'shield' },
  warrior_charge: { tone: '#d7836a', family: 'movement', motif: 'wave' },
  guard: { tone: '#d9c38e', family: 'defense', motif: 'shield' },
  riposte: { tone: '#e0b070', family: 'defense', motif: 'shield' },
  second_wind: { tone: '#b4dba2', family: 'defense', motif: 'shield' },
  brutal_shove: { tone: '#b0c9d0', family: 'force', motif: 'wave' },
  steady_advance: { tone: '#c9c0a8', family: 'movement', motif: 'phase' },
  sweep: { tone: '#d39a7c', family: 'force', motif: 'wave' },
  grapple: { tone: '#b9a48c', family: 'force', motif: 'wave' },
  steel_wall: { tone: '#c8ccd6', family: 'defense', motif: 'shield' },
  bastion: { tone: '#e3c27a', family: 'defense', motif: 'shield' },
  ram: { tone: '#d7836a', family: 'movement', motif: 'wave' },
  unstoppable: { tone: '#e0a36c', family: 'movement', motif: 'phase' },
  vanguard_fury: { tone: '#e07a5c', family: 'force', motif: 'wave' },
  // «Juramento del Verdugo»: crimson on dark steel (placeholder until its painted art exists).
  execution: { tone: '#c8423a', family: 'force', motif: 'wave' },
  // Summoner rituals (placeholders until qa/summoner-rituals/ART_MANIFEST.md is painted):
  // runes = stone/green, marks = moonlit violet, war drake = ember.
  rune_stone: { tone: '#b9b29a', family: 'ritual', motif: 'rune' },
  rune_shell: { tone: '#9fc49a', family: 'ritual', motif: 'shield' },
  mark_moon: { tone: '#c7c3f0', family: 'ritual', motif: 'rune' },
  mark_fang: { tone: '#d9b0a0', family: 'ritual', motif: 'rune' },
  mark_blood: { tone: '#d07c88', family: 'ritual', motif: 'rune' },
  summon_war_drake: { tone: '#e08a5a', family: 'summon', motif: 'ember' },
};
export const ENCOUNTER_IDENTITY: Record<
  string,
  {
    theme: string;
    accent: string;
    light: number;
    ambient: 'embers' | 'motes' | 'dust';
    title: string;
  }
> = {
  first_blood: {
    theme: 'duel',
    accent: '#bc8a61',
    light: 0xc89669,
    ambient: 'embers',
    title: 'El patio de las cenizas',
  },
  crystal_guard: {
    theme: 'sanctuary',
    accent: '#7ea9c0',
    light: 0x8acddd,
    ambient: 'motes',
    title: 'El santuario de la vigilia',
  },
  escape: {
    theme: 'fracture',
    accent: '#998b9d',
    light: 0xa5a1bc,
    ambient: 'dust',
    title: 'La galería quebrada',
  },
};
/** Campaign encounters reuse the three painted arena identities (no new environment art). */
const ENCOUNTER_THEME_ALIAS: Record<string, keyof typeof ENCOUNTER_IDENTITY> = {
  ascent_01_outpost: 'first_blood',
  ascent_02_watchtower: 'first_blood',
  ascent_03_open_field: 'first_blood',
  ascent_04_shield_wall: 'crystal_guard',
  ascent_05_alpha: 'escape',
  ascent_06_pincer: 'first_blood',
  ascent_07_chasm: 'escape',
  ascent_08_warband: 'crystal_guard',
  ascent_09_elder: 'crystal_guard',
  ascent_10_colossus: 'escape',
};
export const encounterIdentity = (id: string) =>
  id.startsWith('hunt_') ? { theme: 'veil_forest', accent: '#a6c7ad', light: 0xa6bfc9, ambient: 'motes' as const, title: 'El bosque del Velo' } :
  ENCOUNTER_IDENTITY[id] ??
  ENCOUNTER_IDENTITY[ENCOUNTER_THEME_ALIAS[id] ?? 'first_blood'] ??
  ENCOUNTER_IDENTITY.first_blood!;

/**
 * Elite / boss enemies are new rule definitions drawn with an existing character's art, a
 * little larger so their rank reads on the board. Rules never see any of this.
 */
const UNIT_VISUAL_ALIAS: Record<string, { base: string; scale: number; tint?: number }> = {
  archer: { base: 'qa_archer', scale: 1 },
  summoner: { base: 'summoner', scale: 1 },
  wolf_alpha: { base: 'shadow_wolf', scale: 1.14 },
  shaman_elder: { base: 'dark_shaman', scale: 1.1 },
  stone_colossus: { base: 'stone_brute', scale: 1.24 },
  // Ritual creatures have original painted artwork; aliases never change gameplay.
  ancient_wolf: { base: 'ancient_wolf', scale: 1 },
  ash_hound: { base: 'ash_hound', scale: 1 },
  primordial_dragon: { base: 'primordial_dragon', scale: 1 },
  infernal_imp: { base: 'infernal_imp', scale: 1 },
  infernal_knight: { base: 'infernal_knight', scale: 1 },
  infernal_jailer: { base: 'infernal_jailer', scale: 1 },
  ash_shaman: { base: 'ash_shaman', scale: 1 },
  magma_beast: { base: 'magma_beast', scale: 1 },
  forge_king: { base: 'forge_king', scale: 1 },
  // Original Veil paintings; appearance never changes enemy definitions or occupancy.
  veil_stalker: { base: 'veil_stalker', scale: 1 },
  veil_guardian: { base: 'veil_guardian', scale: 1 },
  veil_beast: { base: 'veil_beast', scale: 1 },


};
/** Art id (painting, animation clips, render contract) for a unit definition. */
export const unitVisualId = (defId: string) => UNIT_VISUAL_ALIAS[defId]?.base ?? defId;
export const unitVisualScale = (defId: string) => UNIT_VISUAL_ALIAS[defId]?.scale ?? 1;
/** Sprite tint for borrowed placeholder art (white = untouched). */
export const unitVisualTint = (defId: string) => UNIT_VISUAL_ALIAS[defId]?.tint ?? 0xffffff;

/** Environmental dressing only; authored separately from encounter rules and terrain. */
export type BattlefieldStyle = 'courtyard' | 'weathered' | 'ceremonial' | 'fractured' | 'citadel';
const BATTLEFIELD_STYLES: Record<string, BattlefieldStyle> = {
  first_blood: 'courtyard',
  crystal_guard: 'ceremonial',
  escape: 'fractured',
  ascent_01_outpost: 'courtyard',
  ascent_02_watchtower: 'weathered',
  ascent_03_open_field: 'weathered',
  ascent_04_shield_wall: 'ceremonial',
  ascent_05_alpha: 'fractured',
  ascent_06_pincer: 'courtyard',
  ascent_07_chasm: 'fractured',
  ascent_08_warband: 'citadel',
  ascent_09_elder: 'ceremonial',
  ascent_10_colossus: 'citadel',
};
export const battlefieldStyle = (id: string): BattlefieldStyle =>
  BATTLEFIELD_STYLES[id] ?? 'courtyard';

/** World 2 dressing stays presentation-only; none of these values enter replay state. */
export const INFERNAL_SCENERY = ['Puertas de ceniza', 'Corredor de cadenas', 'La fundición', 'Patio de los condenados', 'Prisión del Carcelero', 'Río de magma', 'Los hornos', 'Foso de la bestia', 'Antesala real', 'Gran forja'];
for (let i = 1; i <= 10; i++) ENCOUNTER_IDENTITY[`w2_e${String(i).padStart(2, '0')}`] = {
  theme: 'infernal_forge', accent: '#e6a66a', light: 0xff9852, ambient: 'embers', title: INFERNAL_SCENERY[i - 1]!,
};

/** Act III «Templo del Umbral»: the temple-mechanism board (dark stone, brass, teal runes). Presentation only. */
const TEMPLE_SCENERY: Record<string, string> = {
  w3_e01: 'La puerta sellada', w3_e02: 'Puentes rotos', w3_e03: 'Los tres sellos', w3_e04: 'La cámara móvil',
  w3_e05: 'El guardián mecánico', w3_e06: 'La reliquia perdida', w3_e07: 'Peso y contrapeso', w3_e08: 'El laberinto vivo',
  w3_e09: 'El corazón del templo', w3_e10: 'El arquitecto del umbral',
};
for (const [id, title] of Object.entries(TEMPLE_SCENERY))
  ENCOUNTER_IDENTITY[id] = { theme: 'temple_mechanism', accent: '#79cfc6', light: 0x7fd0c8, ambient: 'dust', title };

Object.assign(CARD_IDENTITY, { magma_fissure: {tone:'#e69956',family:'fire',motif:'ember'}, summon_ash_hound: {tone:'#ba996e',family:'summon',motif:'ember'}, forge_strike: {tone:'#dcac70',family:'force',motif:'wave'} });

CARD_IDENTITY.unleashed_hunt = {tone:'#c5a2ec',family:'summon',motif:'rune'};
