import {
  ASCENT_CAMPAIGN,
  copyLimit,
  createProfile,
  createRun,
  currentEncounter,
  DECK_RULES,
  DEFAULT_CONTENT,
  ownedFor,
  REWARD_POOLS,
  rewardRoll,
  rollReward,
  type OwnedCopies,
  type PlayerProfile,
  type GameContent,
  type RewardPoolId,
} from '../../src/game';

/**
 * Today's content with every card set released (QA sets included): what the store and rewards
 * look like once a set ships. The store never lists an offer holding an unreleased card.
 */
export const ALL_RELEASED: GameContent = {
  ...DEFAULT_CONTENT,
  releasedExpansions: [...new Set(Object.values(DEFAULT_CONTENT.cards).flatMap((c) => (c.expansion ? [c.expansion] : [])))],
};

/** A run seed whose Encounter I roll does (or does not) offer cards for this profile. */
export function seedForFirstDrop(drop: boolean, profile: PlayerProfile = createProfile(DEFAULT_CONTENT)): number {
  for (let seed = 1; seed < 500; seed++) {
    const run = createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, seed);
    if (rewardRoll(DEFAULT_CONTENT, profile, run, currentEncounter(ASCENT_CAMPAIGN, run), DECK_RULES).cardDrop === drop) return seed;
  }
  throw new Error('no seed found');
}

/**
 * Whether play can grant another copy of `cardId` to a fresh player (no store exclusives).
 * Rewards offer unowned cards first, so a card the 30-card starter already holds below its cap
 * is checked once the rest of that champion's pool is collected (copies fill the offers then).
 */
export function droppableThroughPlay(heroId: string, cardId: string, seeds = 300, content: GameContent = DEFAULT_CONTENT): boolean {
  const starter = ownedFor(createProfile(DEFAULT_CONTENT), heroId, DEFAULT_CONTENT);
  const card = DEFAULT_CONTENT.cards[cardId]!;
  if (starter(cardId) >= copyLimit(card, DECK_RULES)) return false;
  const owned: OwnedCopies =
    starter(cardId) === 0
      ? starter
      : (id) => (id === cardId ? starter(id) : copyLimit(DEFAULT_CONTENT.cards[id]!, DECK_RULES));
  return (Object.keys(REWARD_POOLS) as RewardPoolId[]).some((poolId) =>
    Array.from({ length: seeds }, (_, seed) => seed).some((seed) =>
      rollReward({ content, heroId, owned, pity: 4, rules: DECK_RULES, poolId, seed, count: 3 }).options.some(
        (o) => o.kind === 'ADD_CARD' && o.cardId === cardId,
      ),
    ),
  );
}
