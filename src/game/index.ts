/**
 * Public API of the game core. Presentation code should import from here only.
 */
import { DEFAULT_CONTENT, SCENARIOS_BY_ID } from './data';
import { GameEngine } from './engine/GameEngine';

export { GameEngine, RITUAL_SELECTION, ritualSelection } from './engine/GameEngine';
export { replayBattle } from './engine/replay';
export type { CommandResult, CardPreview, CardPlayability, EngineListener } from './engine/GameEngine';
export type { Command, CommandType } from './engine/commands';
export type { GameEvent, GameEventType, EventOfType } from './domain/events';
export type { GameState, PlayerState, BattleOutcome, BattlePhase } from './domain/state';
export type { Unit, Faction, UnitKind } from './domain/entities/unit';
export type { Obstacle, ObstacleDef } from './domain/entities/obstacle';
export type { Tile, Board } from './domain/board/board';
export type { Pos, Direction } from './domain/core/position';
export { posKey, samePos, manhattan } from './domain/core/position';
export type { CardAcquisition, CardDefinition, CardInstance, CardCategory, EffectBonus, EffectCondition, VisualElement } from './domain/cards/card';
export { isExclusiveCard } from './domain/cards/card';
export type { EnemyIntent } from './domain/ai/behavior';
export type { IntentPlan } from './domain/ai/ai';
export type { PathNode } from './domain/board/pathfinding';
export type { ObjectiveState, ObjectiveDef } from './domain/objectives/objective';
export type { Collectible, CollectibleKind, CollectibleSpawnDef } from './domain/entities/collectible';
export type { ScenarioDef } from './domain/scenario';
export type { GameContent, SummonDef } from './domain/content';
export type { StatusId } from './domain/statuses/status';
export type { TerrainType } from './domain/terrain/terrain';
export type { RuleError } from './domain/result';
export { DECK_RULES, HAND_RULES, DEFAULT_CONTENT, SCENARIOS, SCENARIOS_BY_ID, ASCENT_CAMPAIGN, CAMPAIGNS_BY_ID } from './data';
export { cardSource, WORLD_REWARD_CARDS, WORLD_REWARD_CARD_BY_CHAMPION, campaignForRun, INFERNAL_CAMPAIGN, INFERNAL_ENEMIES, WORLDS, WORLD_1, WORLD_2, WORLD_2_FLAG, WORLD_3, WORLD_3_FLAG, WORLD_CAMPAIGNS, worldContext } from './data';
export { ARCHER_ACT_1, ARCHER_CAMPAIGN_FLAG, ARCHER_HUNT_CAMPAIGN, ARCHER_HUNT_CAMPAIGN_ID, ARCHER_HUNT_CARDS, ARCHER_HUNT_ENCOUNTERS, ARCHER_HUNT_WORLD_ID, CAMPAIGN_HERO_IDS, defaultCampaignFor, VEIL_ENEMIES } from './data';
export type { BoardTheme, ChampionRuns, WorldCompletionReward, WorldContext, WorldDef, WorldHistory, WorldRecord, WorldStatus, WorldUnlock, WorldView } from './run/worlds';
export {
  encounterAlias,
  encounterNumber,
  primaryWorld,
  resolveEncounterId,
  totalProgress,
  validateWorlds,
  worldById,
  worldCompleted,
  worldOfCampaign,
  worldOfEncounter,
  worldReleased,
  worldsView,
  worldUnlocked,
} from './run/worlds';
export type { HitRider } from './domain/ai/behavior';
export { RITUAL_EXPANSION, RITUALS, SUMMONER_RITUAL_SET, withPrototypeRituals } from './data';
export { PRIMORDIAL_CARDS, PRIMORDIAL_EXPANSION, PRIMORDIAL_RITUALS, PRIMORDIAL_SET, PRIMORDIAL_SUMMONS } from './data';
export { NEUTRAL_CARDS, SUMMONER_BOND_CARDS, TACTICAL_CARDS, TACTICAL_EXPANSION } from './data';
export {
  ARSENAL_CARDS,
  ARSENAL_EXPANSION,
  ARSENAL_MAGE_CARDS,
  ARSENAL_NEUTRAL_CARDS,
  ARSENAL_SUMMONER_CARDS,
  ARSENAL_WARRIOR_CARDS,
} from './data';
export type { RitualDef, RitualResultKind, RitualTier } from './domain/rituals/ritual';
export { RITUAL_TIER_PIECES } from './domain/rituals/ritual';
export type { AltarStatus, RitualCreature, RitualProgress, RitualStatus } from './domain/rituals/ritual-rules';
export {
  altarOf,
  altarSealing,
  altarSlots,
  altarStatus,
  checkCommit,
  nextSealCost,
  ritualCapacityCost,
  ritualCreature,
  ritualProgress,
  ritualsUsingPiece,
} from './domain/rituals/ritual-rules';
export type { RitualAction } from './domain/ai/ritual-policy';
export { suggestRitualAction } from './domain/ai/ritual-policy';
export type { CardFamily } from './collection/card-family';
export { CARD_FAMILIES, cardFamily } from './collection/card-family';
export type { EnemyDef, EnemyRole, EnemyRank, HeroDef } from './domain/content';
export { BOARD_SIZES, type BoardSize } from './domain/board/board-size';
export { validateScenario, scenarioBoardSize } from './domain/scenario-validation';
export type { CampaignDef, ChampionSetup, EncounterDef, EncounterTier } from './run/encounter';
export {
  defaultCampaignHero,
  encounterById,
  encounterFor,
  encounterOrder,
  supportsHero,
  validateCampaign,
  validateEncounter,
} from './run/encounter';
export type { RewardOption, RewardPoolDef, RewardPoolId, RewardRoll, RewardRollInput } from './run/rewards';
export { PITY_THRESHOLD, REWARD_POOLS, rollReward, THEME_WEIGHT } from './run/rewards';
export type { ClaimResult, RunState, RunStatus, RunResult, VictoryResult } from './run/run';
export {
  battleSeed,
  chooseReward,
  createRun,
  currentEncounter,
  encounterIndex,
  claimReward,
  reofferPending,
  rewardRoll,
  settleVictory,
  runContent,
} from './run/run';

export type { ProofResult, VictoryProof } from './run/verify';
export { campaignBattleContent, MAX_PROOF_COMMANDS, parseCommand, verifyVictory } from './run/verify';
export type { RouteNode, RouteProgress } from './run/route';
export { campaignRoute, nextEncounterId } from './run/route';
export type { RunLoad } from './run/save';
export { legacyCardRewards, parseRunSave, RUN_SAVE_VERSION, serializeRun } from './run/save';

export type {
  CardRarity,
  CollectionCardStatus,
  DeckEdit,
  DeckEditIssue,
  DeckEditResult,
  DeckEntry,
  DeckIssue,
  DeckIssueCode,
  DeckRules,
  DeckStatus,
  OwnedCopies,
} from './collection/deck-rules';
export {
  addCard,
  addCardIssue,
  cardsForHero,
  collectionCardStatus,
  copyLimit,
  countInDeck,
  deckSize,
  deckStatus,
  editDeck,
  isCardForHero,
  isLegacyDeck,
  neutralCount,
  rarityOf,
  removeCard,
  sameDeck,
  usableCopies,
  validateDeck,
} from './collection/deck-rules';
export type { BattleDeck, HeroProfile, OwnedCard, PlayerProfile, ProfileResult, SavedDeck, SharedCollection } from './collection/profile';
export {
  activeDeck,
  battleDeck,
  collectionOwner,
  createProfile,
  defaultChampionId,
  grantCard,
  heroProfile,
  isNeutral,
  isUnlocked,
  ownedCard,
  ownedFor,
  saveActiveDeck,
  sharedPool,
  starterShared,
  SHARED_POOL_ID,
  starterDeck,
  starterHeroProfile,
  withPity,
  STARTER_DECK_ID,
  STARTER_DECK_NAME,
  withHeroDeck,
} from './collection/profile';
export type { ChampionDeckSummary, DeckOpError, DeckOpResult } from './collection/decks';
export {
  copyName,
  createDeck,
  DECK_ID_PATTERN,
  DECK_NAME_MAX,
  deckSummaries,
  DEFAULT_DECK_SLOTS_PER_CHAMPION,
  deleteDeck,
  duplicateDeck,
  fallbackDefault,
  findDeck,
  NEW_DECK_NAME,
  normalizeDeckName,
  orderedDecks,
  renameDeck,
  setDefaultDeck,
  updateDeck,
} from './collection/decks';
export type { DeckBuilderView } from './collection/deck-builder-view';
export { deckBuilderView } from './collection/deck-builder-view';
export type { BattleLoadout, SelectResult } from './collection/loadout';
export { loadoutDeck, loadoutFor, selectChampion, selectedLoadout } from './collection/loadout';
export type {
  ChampionMilestone,
  ChampionProgress,
  ChampionUnlock,
  PendingUnlock,
  UnlockError,
  UnlockMilestoneId,
  UnlockRequirement,
  UnlockResult,
} from './collection/champion-unlocks';
export {
  asNewPlayer,
  CHAMPION_MILESTONES,
  championPlayable,
  championProgress,
  chooseStartingChampion,
  claimChampionUnlock,
  isChampionUnlocked,
  needsStartingChampion,
  newChampionProgress,
  pendingChampionUnlock,
  recordCampaignBest,
  revalidateChampionProgress,
  unlockRequirement,
} from './collection/champion-unlocks';
export { GUEST_ENCOUNTER_LIMIT, guestGateReached, guestMayFight } from './run/guest-gate';
export type { ProfileLoad } from './collection/profile-save';
export { parseProfileSave, PROFILE_SAVE_VERSION, serializeProfile } from './collection/profile-save';

/** Convenience factory wiring the default content. */
export function createEngine(scenarioId: string, seed?: number): GameEngine {
  const scenario = SCENARIOS_BY_ID[scenarioId];
  if (!scenario) throw new Error(`Unknown scenario "${scenarioId}"`);
  return new GameEngine(scenario, DEFAULT_CONTENT, seed ?? scenario.defaultSeed);
}

export { summonUsage } from './domain/summons/summons';

export { skirmishRewardContext, rewardContextFor } from './run/skirmish';

export type {
  CardGrant,
  CatalogIssue,
  CosmeticDef,
  CosmeticGrant,
  CosmeticKind,
  CurrencyDef,
  CurrencyPackage,
  ExcludedContent,
  LedgerReason,
  OfferView,
  PaymentProvider,
  PurchasePlan,
  PurchaseQuote,
  StoreCategoryId,
  StoreContent,
  StoreContext,
  StoreOffer,
  StoreOfferType,
  StoreOwnership,
  Unavailable,
} from './store/store';
export {
  contentValue,
  cosmeticSlot,
  CURRENCIES,
  EQUIPPABLE_KINDS,
  isOfferActive,
  LEDGER_REASONS,
  offerView,
  packageTotal,
  PAYMENT_PROVIDERS,
  planPurchase,
  proratedPrice,
  PREMIUM_CURRENCY_ID,
  PRICE_LADDER,
  STORE_CATEGORIES,
  validateCatalog,
  validOffers,
} from './store/store';
export { COSMETICS, CURRENCY_PACKAGES, STORE_CATALOG } from './data/store-catalog';
export type { GiftBlock, GiftContext, GiftResult, GiftStatus } from './store/gifts';
export { GIFT_LIMITS, GIFT_RESULT_LABEL, GIFT_RESULTS, giftMessage, giftRarity, planGift } from './store/gifts';
export type { PromoContext, PromoGrant, PromoPlan, PromoResult, PromoReward, PromoRewardItem } from './store/promo';
export {
  checkPromoReward,
  describePromoGrant,
  normalizePromoCode,
  parsePromoReward,
  planPromoReward,
  PROMO_INPUT_MAX,
  PROMO_RESULT_LABEL,
  PROMO_RESULTS,
  promoItems,
} from './store/promo';
export { checkEndTurnDiscard, discardRequired, fallbackDiscardUid, handExcess, keptHandSize } from './domain/cards/hand-limit';
export { suggestHandDiscard } from './domain/ai/hand-discard';
export { SHOWCASE_STORE_CARDS, SHOWCASE_STORE_EXPANSION } from './data';

export type { TransformationDef } from './domain/transformations/transformations';
export { activeForm } from './domain/transformations/transformations';

// Interactive battlefield (Act III «El Templo del Umbral»).
export type {
  InteractionVerb,
  MechanismAction,
  MechanismBoard,
  MechanismBoardDef,
  MechanismCue,
  MechanismDef,
  MechanismKind,
  MechanismRuleDef,
  MechanismStateValue,
  OccupantClass,
} from './domain/mechanisms/mechanism';
export type { InteractionOption } from './domain/mechanisms/mechanism-rules';
export type { MechanismLink, MechanismView, MechanismVisual, MechanismVisualState } from './domain/mechanisms/mechanism-view';
export { mechanismView } from './domain/mechanisms/mechanism-view';
