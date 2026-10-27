import { UNLEASHED_HUNT_EXPANSION } from './unleashed-hunt';
import type { GameContent } from '../domain/content';
import { CARDS } from './cards';
import { DECK_RULES, HAND_RULES, OBSTACLES, STATUSES, TERRAIN } from './rules';
import { ENEMIES, HEROES, STRUCTURES, SUMMONS } from './units';
import { RITUALS } from './summoner-rituals';
import { PRIMORDIAL_RITUALS } from './primordial-dragon';
import { TEMPLE_OBSTACLES } from './temple';

export const DEFAULT_CONTENT: GameContent = {
  defaultHeroId: 'mage',
  releasedExpansions: [UNLEASHED_HUNT_EXPANSION],
  cards: CARDS,
  summons: SUMMONS,
  rituals: { ...RITUALS, ...PRIMORDIAL_RITUALS },
  heroes: HEROES,
  enemies: ENEMIES,
  structures: STRUCTURES,
  obstacles: { ...OBSTACLES, ...TEMPLE_OBSTACLES },
  statuses: STATUSES,
  terrain: TERRAIN,
};

export {
  RITUAL_EXPANSION,
  RITUALS,
  SUMMONER_RITUAL_SET,
  withPrototypeRituals,
} from './summoner-rituals';
export { PRIMORDIAL_CARDS, PRIMORDIAL_EXPANSION, PRIMORDIAL_RITUALS, PRIMORDIAL_SET, PRIMORDIAL_SUMMONS } from './primordial-dragon';
export { DECK_RULES, HAND_RULES, CARDS, ENEMIES, HEROES, STRUCTURES, SUMMONS, OBSTACLES, STATUSES, TERRAIN };
export { SCENARIOS, SCENARIOS_BY_ID, FIRST_BLOOD, CRYSTAL_GUARD, ESCAPE } from './scenarios';
export { ASCENT_CAMPAIGN, ASCENT_ENCOUNTERS } from './encounters';
export { INFERNAL_CAMPAIGN, INFERNAL_ENCOUNTERS } from './infernal-encounters';
export { INFERNAL_ENEMIES } from './infernal';
export { NEUTRAL_CARDS, SUMMONER_BOND_CARDS, TACTICAL_CARDS, TACTICAL_EXPANSION } from './tactical-cards';
export {
  ARSENAL_CARDS,
  ARSENAL_EXPANSION,
  ARSENAL_MAGE_CARDS,
  ARSENAL_NEUTRAL_CARDS,
  ARSENAL_SUMMONER_CARDS,
  ARSENAL_WARRIOR_CARDS,
} from './arsenal-cards';
export { WORLD_REWARD_CARDS, WORLD_REWARD_CARD_BY_CHAMPION } from './world-rewards';
export { cardSource, campaignForRun, WORLDS, WORLD_1, WORLD_2, WORLD_2_FLAG, WORLD_3, WORLD_3_FLAG, WORLD_CAMPAIGNS, worldContext, ARCHER_ACT_1, ARCHER_CAMPAIGN_FLAG, CAMPAIGN_HERO_IDS, defaultCampaignFor } from './worlds';
export { ARCHER_HUNT_CAMPAIGN, ARCHER_HUNT_ENCOUNTERS } from './archer-hunt-encounters';
export { ARCHER_HUNT_CARDS, ARCHER_HUNT_CAMPAIGN_ID, ARCHER_HUNT_WORLD_ID, VEIL_ENEMIES } from './archer-hunt';
/** Every campaign by id (World 1 «El Ascenso», World 2 «Reino Infernal»). */
export { WORLD_CAMPAIGNS as CAMPAIGNS_BY_ID } from './worlds';
export { SHOWCASE_STORE_CARDS, SHOWCASE_STORE_EXPANSION } from './showcase-store-cards';
