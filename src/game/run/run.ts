import type { DeckRules } from '../collection/deck-rules';
import { grantCard, heroProfile, ownedCard, ownedFor, withPity, type PlayerProfile } from '../collection/profile';
import { requireDef, type GameContent } from '../domain/content';
import { defaultCampaignHero, encounterById, encounterFor, encounterOrder, supportsHero, type CampaignDef, type EncounterDef } from './encounter';
import { PITY_THRESHOLD, REWARD_POOLS, rollReward, type RewardOption, type RewardRoll } from './rewards';

/**
 * - IN_BATTLE:        fighting `currentEncounterId` (retries allowed).
 * - CHOOSING_REWARD:  just won it; exactly one of `rewardOptions` must be taken to continue.
 * - COMPLETED:        the last encounter was won and its reward taken.
 */
export type RunStatus = 'IN_BATTLE' | 'CHOOSING_REWARD' | 'COMPLETED';

/**
 * Minimal progression between battles. Plain serialisable data (no backend / save system).
 * Battles are still created fresh by the engine; the run only changes the INPUTS
 * (encounter + max HP via `runContent`), so the combat core is untouched. The deck is NOT
 * part of the run: it comes from the player profile (collection/deck builder), and card
 * rewards are granted to the collection by the caller.
 */
export interface RunState {
  campaignId: string;
  seed: number;
  heroId: string;
  status: RunStatus;
  currentEncounterId: string;
  completedEncounterIds: string[];
  rewardOptions: RewardOption[];
  chosenRewards: { encounterId: string; reward: RewardOption }[];
  maxHpBonus: number;
}

export type RunResult = { ok: true; run: RunState } | { ok: false; error: string };

/** A fresh run of `campaign` for one champion (default: the campaign's first champion). */
export function createRun(campaign: CampaignDef, content: GameContent, seed = 1, heroId = defaultCampaignHero(campaign)): RunState {
  if (!supportsHero(campaign, heroId)) throw new Error(`Campaign ${campaign.id}: champion "${heroId}" cannot play it`);
  const hero = requireDef(content.heroes, heroId, 'hero');
  return {
    campaignId: campaign.id,
    seed: seed >>> 0,
    heroId: hero.id,
    status: 'IN_BATTLE',
    currentEncounterId: campaign.start,
    completedEncounterIds: [],
    rewardOptions: [],
    chosenRewards: [],
    maxHpBonus: 0,
  };
}

/** The battle the run fights next, with the run's champion on the hero spawn. */
export const currentEncounter = (campaign: CampaignDef, run: RunState): EncounterDef =>
  encounterFor(campaign, run.currentEncounterId, run.heroId);

/** 0-based position of the current encounter in play order. */
export function encounterIndex(campaign: CampaignDef, run: RunState): number {
  return encounterOrder(campaign).findIndex((e) => e.id === run.currentEncounterId);
}

/** Battle seed: the encounter's authored seed mixed with the run seed (reproducible runs). */
export function battleSeed(run: RunState, encounter: EncounterDef): number {
  return (encounter.defaultSeed + Math.imul(run.seed, 0x9e3779b1)) >>> 0;
}

/**
 * Content for the next battle: the given tables (already carrying the hero's battle deck,
 * see `withHeroDeck`) with the run's max HP bonus applied.
 */
export function runContent(content: GameContent, run: RunState): GameContent {
  const hero = requireDef(content.heroes, run.heroId, 'hero');
  return {
    ...content,
    heroes: {
      ...content.heroes,
      [hero.id]: { ...hero, maxHp: hero.maxHp + run.maxHpBonus },
    },
  };
}

export type VictoryResult =
  | { ok: true; run: RunState; profile: PlayerProfile; roll: RewardRoll; pity: { before: number; after: number } }
  | { ok: false; error: string };

/**
 * The battle for `encounterId` was won: mark it completed and roll its reward from the
 * champion's collection and pity (`rollReward`). Only valid while fighting that encounter, so
 * repeated victory notifications are rejected (idempotent). The offer is stored in the run and
 * never regenerated: reloading cannot reroll it. A win with nothing to offer (a normal fight
 * without a drop) advances directly and adds pity.
 */
export function settleVictory(
  campaign: CampaignDef,
  content: GameContent,
  profile: PlayerProfile,
  run: RunState,
  encounterId: string,
  rules: DeckRules,
): VictoryResult {
  if (run.status !== 'IN_BATTLE') return { ok: false, error: `run is ${run.status}` };
  if (encounterId !== run.currentEncounterId)
    return { ok: false, error: `won "${encounterId}" but the run is at "${run.currentEncounterId}"` };
  const encounter = currentEncounter(campaign, run);
  const completed = { ...run, completedEncounterIds: [...run.completedEncounterIds, encounter.id] };
  const roll = rewardRoll(content, profile, run, encounter, rules);
  const pity = heroProfile(profile, run.heroId, content).rewardPity;
  if (roll.options.length === 0) {
    const after = Math.min(PITY_THRESHOLD, pity + REWARD_POOLS[encounter.rewards.pool].pityGain);
    return { ok: true, run: advance(campaign, completed), profile: withPity(profile, run.heroId, after, content), roll, pity: { before: pity, after } };
  }
  return { ok: true, run: { ...completed, status: 'CHOOSING_REWARD', rewardOptions: roll.options }, profile, roll, pity: { before: pity, after: pity } };
}

/** The deterministic roll an encounter of this run makes for this collection + pity. */
export function rewardRoll(content: GameContent, profile: PlayerProfile, run: RunState, encounter: EncounterDef, rules: DeckRules): RewardRoll {
  const hero = heroProfile(profile, run.heroId, content);
  const rolled = rollReward({
    content,
    heroId: run.heroId,
    owned: ownedFor(profile, run.heroId, content),
    pity: hero.rewardPity,
    rules,
    poolId: encounter.rewards.pool,
    seed: battleSeed(run, encounter) ^ 0x5bd1e995,
    count: encounter.rewards.choices,
    favorTags: encounter.rewards.favorTags,
    authored: encounter.rewards.cards,
  });
  // A one-battle skirmish has no future run HP; retain existing tier/pity/card rules.
  if (run.campaignId === 'skirmish') rolled.options = rolled.options.filter(o => o.kind === 'ADD_CARD');
  return rolled;
}

/**
 * A pending offer that came from outside (an imported save) is replaced by the one this
 * collection would really get; with nothing to offer the run simply moves on.
 */
export function reofferPending(campaign: CampaignDef, content: GameContent, profile: PlayerProfile, run: RunState, rules: DeckRules): RunState {
  if (run.status !== 'CHOOSING_REWARD') return run;
  const roll = rewardRoll(content, profile, run, currentEncounter(campaign, run), rules);
  return roll.options.length ? { ...run, rewardOptions: roll.options } : advance(campaign, { ...run, rewardOptions: [] });
}

export type ClaimResult =
  | {
      ok: true;
      run: RunState;
      profile: PlayerProfile;
      reward: RewardOption;
      /** The card copy granted (null for MAX_HP). */
      granted: { cardId: string; copies: number; acquired: number; isNew: boolean } | null;
      pity: { before: number; after: number };
    }
  | { ok: false; error: string };

/**
 * Take exactly one offered reward: the run advances, a card goes to the collection (never
 * equipped automatically) and pity resets; a non-card reward adds pity instead. Callers
 * persist the returned run + profile together.
 */
export function claimReward(
  campaign: CampaignDef,
  content: GameContent,
  profile: PlayerProfile,
  run: RunState,
  optionId: string,
): ClaimResult {
  const next = chooseReward(campaign, run, optionId);
  if (!next.ok) return next;
  const reward = next.run.chosenRewards.at(-1)!.reward;
  const encounter = encounterById(campaign, run.currentEncounterId);
  const before = heroProfile(profile, run.heroId, content).rewardPity;
  if (reward.kind !== 'ADD_CARD') {
    const after = Math.min(PITY_THRESHOLD, before + REWARD_POOLS[encounter.rewards.pool].pityGain);
    return { ok: true, run: next.run, profile: withPity(profile, run.heroId, after, content), reward, granted: null, pity: { before, after } };
  }
  const wasOwned = ownedFor(profile, run.heroId, content)(reward.cardId) > 0;
  const granted = grantCard(profile, run.heroId, reward.cardId, content);
  if (!granted.ok) return granted;
  const owned = ownedCard(granted.profile, run.heroId, reward.cardId, content)!;
  return {
    ok: true,
    run: next.run,
    profile: withPity(granted.profile, run.heroId, 0, content),
    reward,
    granted: { cardId: reward.cardId, copies: owned.copies, acquired: owned.acquired, isNew: !wasOwned },
    pity: { before, after: 0 },
  };
}

/**
 * Run-only step of a claim (validation + advance; MAX_HP applies to the run). Use
 * `claimReward`, which also grants the card and updates pity.
 */
export function chooseReward(campaign: CampaignDef, run: RunState, optionId: string): RunResult {
  if (run.status !== 'CHOOSING_REWARD') return { ok: false, error: 'no reward to choose' };
  const reward = run.rewardOptions.find((o) => o.id === optionId);
  if (!reward) return { ok: false, error: `"${optionId}" is not one of the offered rewards` };
  const next: RunState = {
    ...run,
    rewardOptions: [],
    chosenRewards: [...run.chosenRewards, { encounterId: run.currentEncounterId, reward }],
  };
  if (reward.kind === 'MAX_HP') next.maxHpBonus += reward.amount;
  return { ok: true, run: advance(campaign, next) };
}

function advance(campaign: CampaignDef, run: RunState): RunState {
  const following = currentEncounter(campaign, run).next;
  return following
    ? { ...run, status: 'IN_BATTLE', currentEncounterId: following }
    : { ...run, status: 'COMPLETED' };
}
