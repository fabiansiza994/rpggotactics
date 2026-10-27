import { describe, expect, it } from 'vitest';
import {
  ASCENT_CAMPAIGN,
  battleSeed,
  chooseReward,
  createRun,
  currentEncounter,
  DEFAULT_CONTENT,
  encounterOrder,
  GameEngine,
  createProfile,
  DECK_RULES,
  PITY_THRESHOLD,
  settleVictory,
  withPity,
  runContent,
  withHeroDeck,
  type RunState,
} from '../src/game';

/** Pity at the threshold: every win is guaranteed to offer cards (run tests stay drop-independent). */
const LUCKY = withPity(createProfile(DEFAULT_CONTENT), 'mage', PITY_THRESHOLD, DEFAULT_CONTENT);
const settle = (run: RunState, encounterId: string) => settleVictory(ASCENT_CAMPAIGN, DEFAULT_CONTENT, LUCKY, run, encounterId, DECK_RULES);

function win(run: RunState): RunState {
  const r = settle(run, run.currentEncounterId);
  if (!r.ok) throw new Error(r.error);
  return r.run;
}
function take(run: RunState, index = 0): RunState {
  const r = chooseReward(ASCENT_CAMPAIGN, run, run.rewardOptions[index]!.id);
  if (!r.ok) throw new Error(r.error);
  return r.run;
}

describe('run progression', () => {
  it('starts at the first encounter; the run carries no deck (it comes from the profile)', () => {
    const run = createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 7);
    expect(run.status).toBe('IN_BATTLE');
    expect(run.currentEncounterId).toBe(ASCENT_CAMPAIGN.start);
    expect(run.completedEncounterIds).toEqual([]);
    expect(run).not.toHaveProperty('deck');
  });

  it('victory completes the encounter and offers rewards; the next encounter is not loaded yet', () => {
    const run = win(createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT));
    expect(run.status).toBe('CHOOSING_REWARD');
    expect(run.completedEncounterIds).toEqual(['ascent_01_outpost']);
    expect(run.currentEncounterId).toBe('ascent_01_outpost');
    expect(run.rewardOptions).toHaveLength(3);
  });

  it('a victory for the wrong encounter or a repeated victory is rejected', () => {
    const run = createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT);
    expect(settle(run, 'ascent_02_watchtower').ok).toBe(false);
    const won = win(run);
    expect(settle(won, won.currentEncounterId).ok).toBe(false);
  });

  it('exactly one reward: choosing advances, a second choice or an unknown option is rejected', () => {
    const won = win(createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT));
    expect(chooseReward(ASCENT_CAMPAIGN, won, 'not-offered').ok).toBe(false);
    const next = take(won, 1);
    expect(next.status).toBe('IN_BATTLE');
    expect(next.currentEncounterId).toBe('ascent_02_watchtower');
    expect(next.chosenRewards).toHaveLength(1);
    expect(next.chosenRewards[0]!.reward).toEqual(won.rewardOptions[1]);
    expect(next.rewardOptions).toEqual([]);
    expect(chooseReward(ASCENT_CAMPAIGN, next, won.rewardOptions[0]!.id).ok).toBe(false);
  });

  it('a chosen card is recorded, not equipped: the run never edits a deck', () => {
    const won = win(createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT));
    const offer = won.rewardOptions.find((o) => o.kind === 'ADD_CARD')!;
    const next = take(won, won.rewardOptions.indexOf(offer));
    expect(next.chosenRewards.at(-1)!.reward).toEqual(offer);
    expect(next.maxHpBonus).toBe(0);
  });

  it('the battle fights with the deck it is given (withHeroDeck), plus the run max HP', () => {
    const run = createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT);
    const deck = [
      { cardId: 'magic_missile', count: 3 },
      { cardId: 'blink', count: 2 },
    ];
    const encounter = currentEncounter(ASCENT_CAMPAIGN, run);
    const engine = new GameEngine(encounter, runContent(withHeroDeck(DEFAULT_CONTENT, 'mage', deck), run), battleSeed(run, encounter));
    const { player } = engine.state;
    const cards = [...player.deck, ...player.hand, ...player.discard];
    expect(cards).toHaveLength(5);
    expect(cards.filter((c) => c.cardId === 'blink')).toHaveLength(2);
    // Base content is untouched.
    expect(DEFAULT_CONTENT.heroes.mage!.deck.reduce((n, e) => n + e.count, 0)).toBe(30);
  });

  it('a MAX_HP reward persists as hero max HP in later battles', () => {
    let run = createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT);
    for (let i = 0; i < 4; i++) run = take(win(run));
    expect(run.currentEncounterId).toBe('ascent_05_alpha');
    run = win(run); // elite
    const hpIndex = run.rewardOptions.findIndex((o) => o.kind === 'MAX_HP');
    expect(hpIndex).toBeGreaterThanOrEqual(0);
    run = take(run, hpIndex);
    expect(run.maxHpBonus).toBe(3);
    const encounter = currentEncounter(ASCENT_CAMPAIGN, run);
    const hero = new GameEngine(encounter, runContent(DEFAULT_CONTENT, run)).state.units.find((u) => u.kind === 'HERO')!;
    expect(hero.maxHp).toBe(DEFAULT_CONTENT.heroes.mage!.maxHp + 3);
    expect(hero.hp).toBe(hero.maxHp);
  });

  it('runs through all 10 encounters in order and completes', () => {
    let run = createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 3);
    const visited: string[] = [];
    while (run.status !== 'COMPLETED') {
      visited.push(run.currentEncounterId);
      run = take(win(run));
    }
    expect(visited).toEqual(encounterOrder(ASCENT_CAMPAIGN).map((e) => e.id));
    expect(run.completedEncounterIds).toEqual(visited);
    expect(run.chosenRewards).toHaveLength(10);
  });
});
