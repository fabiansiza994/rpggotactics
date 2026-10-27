import { encounterOrder, type CampaignDef } from '../run/encounter';
import type { RunState } from '../run/run';
import { rewardContextFor } from '../run/skirmish';
import type { WorldContext, WorldDef } from '../run/worlds';
import { ASCENT_CAMPAIGN } from './encounters';
import { INFERNAL_CAMPAIGN } from './infernal-encounters';
import { ARCHER_HUNT_CAMPAIGN } from './archer-hunt-encounters';
import { ARCHER_HUNT_WORLD_ID } from './archer-hunt';
import { WORLD_REWARD_CARD_BY_CHAMPION } from './world-rewards';
import { TEMPLE_CAMPAIGN } from './temple-encounters';
import { TEMPLE_COMPLETION_CARD_BY_CHAMPION, TEMPLE_WORLD_ID } from './temple-rewards';
import type { CardDefinition } from '../domain/cards/card';

/**
 * The campaign's worlds, in order. World 1 is the historical «El Ascenso» campaign, untouched
 * (same campaign id, encounter ids and runs). Adding World 3 = a campaign file + one entry here.
 * Future candidates (not implemented): World 3 «Selva Caótica», World 4 «Inframundo».
 */
const ids = (campaign: CampaignDef) => encounterOrder(campaign).map((e) => e.id);

/** Release switch of World 2: server WORLD_2_ENABLED / WORLD_2_QA, client VITE_WORLD_2_ENABLED. */
export const WORLD_2_FLAG = 'WORLD_2';

export const WORLD_1: WorldDef = {
  id: 'world_1',
  order: 1,
  name: 'El Ascenso',
  subtitle: 'La fortaleza oscura',
  description: 'Diez encuentros por la fortaleza de los orcos: cada uno pide algo distinto, hasta el Coloso de Piedra.',
  theme: 'ascension',
  campaignId: ASCENT_CAMPAIGN.id,
  encounterIds: ids(ASCENT_CAMPAIGN),
  bossEncounterId: 'ascent_10_colossus',
  backgroundId: 'bg_dark_fortress',
  boardTheme: {
    id: 'dark_fortress',
    floor: 'worn_stone_flagstones',
    edge: 'fortress_wall_shadow',
    props: ['banners', 'braziers', 'broken_columns'],
    hazardVisuals: { FIRE: 'brazier_fire', ICE: 'frost_sheet' },
    atmosphere: ['dust_motes'],
  },
  enemyPool: ['orc_warrior', 'shadow_wolf', 'dark_shaman', 'stone_brute', 'wolf_alpha', 'shaman_elder', 'stone_colossus'],
  hazardSet: ['FIRE', 'ICE'],
  unlock: { type: 'ALWAYS' },
  rewardTheme: { id: 'ascension', favorTags: [], championHooks: { mage: null, summoner: null, warrior: null } },
  // World 1 never had a completion reward; adding one now would pay legacy accounts retroactively.
  completionReward: null,
  releaseFlag: null,
  presentation: {
    accent: '#8fb4ff',
    accentSoft: '#2a3550',
    label: 'Mundo 1',
    firstEncounterNumber: 1,
    enemyArt: {},
  },
};

export const WORLD_2: WorldDef = {
  id: 'world_2',
  order: 2,
  name: 'Reino Infernal',
  subtitle: 'La forja del Rey',
  description: 'Una fortaleza de ceniza, cadenas y ríos de lava. Aquí la presión viene del suelo: dónde terminas el turno importa.',
  theme: 'infernal',
  campaignId: INFERNAL_CAMPAIGN.id,
  encounterIds: ids(INFERNAL_CAMPAIGN),
  bossEncounterId: 'w2_e10',
  backgroundId: 'bg_infernal_forge',
  boardTheme: {
    id: 'infernal_forge',
    floor: 'scorched_basalt_with_glowing_seams',
    edge: 'molten_moat_and_chained_walls',
    props: ['anvils', 'hanging_chains', 'forge_furnaces', 'cooled_slag', 'ruined_gates'],
    hazardVisuals: { LAVA: 'flowing_lava_tile_animated', FIRE: 'ember_scorch_temporary' },
    atmosphere: ['rising_embers', 'heat_haze', 'ash_fall'],
  },
  enemyPool: ['infernal_imp', 'infernal_knight', 'infernal_jailer', 'ash_shaman', 'magma_beast', 'forge_king'],
  hazardSet: ['LAVA', 'FIRE'],
  unlock: { type: 'WORLD_COMPLETED', worldId: 'world_1' },
  rewardTheme: {
    id: 'infernal',
    favorTags: ['fire'],
    // The completion reward cards (data/world-rewards.ts).
    championHooks: WORLD_REWARD_CARD_BY_CHAMPION.world_2!,
  },
  completionReward: {
    crystals: 250,
    badgeId: 'badge_forge_king',
    badgeName: 'Vencedor del Rey de la Forja',
    championCards: WORLD_REWARD_CARD_BY_CHAMPION.world_2,
  },
  releaseFlag: WORLD_2_FLAG,
  presentation: {
    accent: '#ff7a3d',
    accentSoft: '#4a1e12',
    label: 'Mundo 2',
    firstEncounterNumber: 11,
    enemyArt: {
      infernal_imp: { visualKey: 'enemy_infernal_imp', placeholderBase: 'shadow_wolf' },
      infernal_knight: { visualKey: 'enemy_infernal_knight', placeholderBase: 'orc_warrior' },
      infernal_jailer: { visualKey: 'enemy_infernal_knight', placeholderBase: 'orc_warrior' },
      ash_shaman: { visualKey: 'enemy_ash_shaman', placeholderBase: 'dark_shaman' },
      magma_beast: { visualKey: 'enemy_magma_beast', placeholderBase: 'stone_brute' },
      forge_king: { visualKey: 'enemy_forge_king', placeholderBase: 'stone_brute' },
    },
  },
};

/** Release switch of World 3: server WORLD_3_ENABLED / WORLD_3_QA, client VITE_WORLD_3_ENABLED. */
export const WORLD_3_FLAG = 'WORLD_3';

/**
 * Act III «El Templo del Umbral»: the interactive battlefield. Every encounter changes the board
 * (gates, plates, statues, platforms, rotating sections, relocating controls). Hidden behind
 * WORLD_3 until its visual pass. Completion reward: data/temple-rewards.ts.
 */
export const WORLD_3: WorldDef = {
  id: TEMPLE_WORLD_ID,
  order: 3,
  name: 'El Templo del Umbral',
  subtitle: 'El Arquitecto del Umbral',
  description: 'Un templo vivo: palancas, placas, puentes, secciones que giran y muros que se mueven. El tablero cambia en cada encuentro.',
  theme: 'temple',
  campaignId: TEMPLE_CAMPAIGN.id,
  encounterIds: ids(TEMPLE_CAMPAIGN),
  bossEncounterId: 'w3_e10',
  backgroundId: 'bg_temple_threshold',
  boardTheme: {
    id: 'temple_mechanism',
    floor: 'dark_temple_stone_with_brass_seams',
    edge: 'floating_board_over_abyss_mist',
    props: ['levers', 'pressure_plates', 'statues', 'sliding_walls', 'rotating_sections'],
    hazardVisuals: {},
    atmosphere: ['drifting_mist', 'rune_glow'],
  },
  enemyPool: ['orc_warrior', 'shadow_wolf', 'dark_shaman', 'stone_brute', 'temple_guardian', 'heart_warden', 'temple_architect'],
  hazardSet: [],
  unlock: { type: 'WORLD_COMPLETED', worldId: 'world_2' },
  rewardTheme: { id: 'temple', favorTags: ['temple-reward'], championHooks: TEMPLE_COMPLETION_CARD_BY_CHAMPION },
  completionReward: {
    crystals: 170,
    badgeId: 'badge_temple_threshold',
    badgeName: 'Rompesellos del Umbral',
    championCards: TEMPLE_COMPLETION_CARD_BY_CHAMPION,
  },
  releaseFlag: WORLD_3_FLAG,
  presentation: {
    accent: '#5fd4c4',
    accentSoft: '#163a38',
    label: 'Mundo 3',
    firstEncounterNumber: 21,
    enemyArt: {
      temple_guardian: { visualKey: 'enemy_temple_guardian', placeholderBase: 'stone_brute' },
      heart_warden: { visualKey: 'enemy_heart_warden', placeholderBase: 'stone_brute' },
      temple_architect: { visualKey: 'enemy_temple_architect', placeholderBase: 'dark_shaman' },
    },
  },
};

/** Release switch of the Archer campaign: server ARCHER_CAMPAIGN_ENABLED / _QA, client VITE_ARCHER_CAMPAIGN. */
export const ARCHER_CAMPAIGN_FLAG = 'ARCHER_CAMPAIGN';

/**
 * Champion story («Sendero del Cazador»), listed only for the Archer. Its independent ALWAYS
 * unlock does not depend on main-act progress. Story orders start at 11; main acts keep 1, 2, 3…
 */
export const ARCHER_ACT_1: WorldDef = {
  id: ARCHER_HUNT_WORLD_ID,
  order: 11,
  name: 'Sendero del Cazador',
  subtitle: 'La Bestia del Velo',
  description: 'Persigue a la Bestia del Velo a través de bosques y ruinas. Marca a tus presas, domina la distancia y prepara el disparo perfecto.',
  theme: 'veil_forest',
  campaignId: ARCHER_HUNT_CAMPAIGN.id,
  encounterIds: ids(ARCHER_HUNT_CAMPAIGN),
  bossEncounterId: 'hunt_10_veil_beast',
  backgroundId: 'bg_veil_forest',
  boardTheme: {
    id: 'veil_forest',
    floor: 'mossy_forest_floor_and_root_choked_ruin_slabs',
    edge: 'dark_treeline_with_veil_mist',
    props: ['ancient_trees', 'fallen_logs', 'thorn_brambles', 'mossy_ruin_stones', 'hunter_shrines'],
    hazardVisuals: { ICE: 'frosted_mountain_pass' },
    atmosphere: ['drifting_veil_mist', 'falling_leaves', 'fireflies'],
  },
  enemyPool: ['orc_warrior', 'shadow_wolf', 'dark_shaman', 'stone_brute', 'wolf_alpha', 'shaman_elder', 'veil_stalker', 'veil_guardian', 'veil_beast'],
  hazardSet: ['ICE'],
  unlock: { type: 'ALWAYS' },
  rewardTheme: { id: 'veil_hunt', favorTags: [], championHooks: { archer: 'predator_eye' } },
  completionReward: {
    crystals: 250,
    badgeId: 'badge_veil_beast',
    badgeName: 'Cazador de la Bestia del Velo',
    championCards: { archer: 'predator_eye' },
  },
  releaseFlag: ARCHER_CAMPAIGN_FLAG,
  presentation: {
    accent: '#7fd6a0',
    accentSoft: '#1d3a2b',
    label: 'Acto I',
    actLabel: 'Acto I',
    firstEncounterNumber: 1,
    enemyArt: {
      veil_stalker: { visualKey: 'enemy_veil_stalker', placeholderBase: 'shadow_wolf' },
      veil_guardian: { visualKey: 'enemy_veil_guardian', placeholderBase: 'dark_shaman' },
      veil_beast: { visualKey: 'enemy_veil_beast', placeholderBase: 'shadow_wolf' },
    },
  },
};

export const WORLDS: readonly WorldDef[] = [WORLD_1, WORLD_2, WORLD_3, ARCHER_ACT_1];

/** Every campaign the worlds play (by id). */
export const WORLD_CAMPAIGNS: Readonly<Record<string, CampaignDef>> = {
  [ASCENT_CAMPAIGN.id]: ASCENT_CAMPAIGN,
  [INFERNAL_CAMPAIGN.id]: INFERNAL_CAMPAIGN,
  [TEMPLE_CAMPAIGN.id]: TEMPLE_CAMPAIGN,
  [ARCHER_HUNT_CAMPAIGN.id]: ARCHER_HUNT_CAMPAIGN,
};

/** Every champion that has a campaign (server state lists worlds for these). */
export const CAMPAIGN_HERO_IDS: readonly string[] = [...new Set(Object.values(WORLD_CAMPAIGNS).flatMap((c) => c.heroIds))];

/** The campaign a champion's campaign card opens by default (its first world's). */
export function defaultCampaignFor(heroId: string): CampaignDef {
  const world = [...WORLDS].sort((a, b) => a.order - b.order).find((w) => WORLD_CAMPAIGNS[w.campaignId]?.heroIds.includes(heroId));
  return (world && WORLD_CAMPAIGNS[world.campaignId]) || ASCENT_CAMPAIGN;
}

/** World context for a caller; `released` tells which flagged worlds this caller may see. */
export const worldContext = (released: (flag: string) => boolean = () => false): WorldContext => ({
  worlds: WORLDS,
  campaigns: WORLD_CAMPAIGNS,
  released: (world) => world.releaseFlag !== null && released(world.releaseFlag),
});

/** The campaign a run belongs to: a world campaign, or a skirmish's one-battle context. */
export function campaignForRun(run: Pick<RunState, 'campaignId' | 'currentEncounterId' | 'heroId'>): CampaignDef {
  if (run.campaignId === 'skirmish') return rewardContextFor(run as RunState);
  const campaign = WORLD_CAMPAIGNS[run.campaignId];
  if (!campaign) throw new Error(`Unknown campaign "${run.campaignId}"`);
  return campaign;
}

/**
 * Where an exclusive card comes from, for the client badge ("RECOMPENSA DE MUNDO · Reino
 * Infernal") without hardcoding card names. Null = an ordinary card.
 */
export function cardSource(
  card: Pick<CardDefinition, 'acquisition'>,
): { kind: 'WORLD_REWARD' | 'CAMPAIGN_REWARD' | 'RANKED_REWARD' | 'FREE_CATALOG'; worldId: string; worldName: string; label: string } | null {
  const a = card.acquisition;
  if (!a) return null;
  // Free catalog: earned by playing (data/free-catalog.ts); "worldId" is empty (no single world).
  if (a.source === 'FREE_CATALOG') return { kind: 'FREE_CATALOG', worldId: '', worldName: 'Catálogo gratuito', label: 'Catálogo gratuito' };
  // Ranked Reward Track early access: "worldId" carries the season id (no world involved).
  if (a.source === 'RANKED_TRACK') return { kind: 'RANKED_REWARD', worldId: a.seasonId, worldName: 'Ranked', label: 'Ranked Pretemporada' };
  // Ranked Premium Track (pass) early access: same kind as the free track, its own label.
  if (a.source === 'RANKED_PREMIUM') return { kind: 'RANKED_REWARD', worldId: a.seasonId, worldName: 'Ranked', label: 'Pase Premium Ranked' };
  const world = WORLDS.find((w) => w.id === a.worldId);
  const worldName = world?.name ?? a.worldId;
  return a.source === 'WORLD_COMPLETION'
    ? { kind: 'WORLD_REWARD', worldId: a.worldId, worldName, label: 'Recompensa de mundo' }
    : { kind: 'CAMPAIGN_REWARD', worldId: a.worldId, worldName, label: 'Recompensa de campaña' };
}
