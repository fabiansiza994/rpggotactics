import { describe, expect, it } from 'vitest';
import {
  ASCENT_CAMPAIGN,
  campaignBattleContent,
  claimReward,
  createProfile,
  createRun,
  currentEncounter,
  DECK_RULES,
  DEFAULT_CONTENT,
  encounterOrder,
  GameEngine,
  heroProfile,
  parseRunSave,
  serializeRun,
  settleVictory,
  validateCampaign,
  verifyVictory,
  withHeroDeck,
  type CampaignDef,
  type EncounterDef,
  type PlayerProfile,
  type RunState,
} from '../src/game';
import { playBattle } from './support/bot';

const content = DEFAULT_CONTENT;
const heroOf = (cardId: string) => content.cards[cardId]!.heroId;

/** Wins the run's current encounter with the greedy bot and settles it (first winning seed). */
function winCurrent(profile: PlayerProfile, run: RunState) {
  const encounter = currentEncounter(ASCENT_CAMPAIGN, run);
  for (let seed = 1; seed < 40; seed++) {
    const engine = new GameEngine(encounter, campaignBattleContent(content, profile, run, DECK_RULES), seed);
    playBattle(engine, 30);
    if (engine.state.outcome?.result !== 'WON') continue;
    const proof = { encounterId: encounter.id, seed, commands: JSON.parse(JSON.stringify(engine.history)) };
    return { proof, engine };
  }
  throw new Error(`bot could not win ${encounter.id} as ${run.heroId}`);
}

/** A run seed whose first encounter offers a card to this champion. */
function dropSeed(heroId: string, profile: PlayerProfile): RunState {
  for (let seed = 1; seed < 500; seed++) {
    const run = createRun(ASCENT_CAMPAIGN, content, seed, heroId);
    const won = settleVictory(ASCENT_CAMPAIGN, content, profile, run, run.currentEncounterId, DECK_RULES);
    if (won.ok && won.run.rewardOptions.some((o) => o.kind === 'ADD_CARD')) return run;
  }
  throw new Error('no drop seed');
}

describe('one campaign, several champions', () => {
  it('El Ascenso is valid for every listed champion; Mage stays the default', () => {
    expect(ASCENT_CAMPAIGN.heroIds).toEqual(['mage', 'summoner', 'warrior']);
    expect(validateCampaign(ASCENT_CAMPAIGN, content)).toEqual([]);
    expect(createRun(ASCENT_CAMPAIGN, content, 3).heroId).toBe('mage');
  });

  it('rejects champions the campaign does not list', () => {
    expect(() => createRun(ASCENT_CAMPAIGN, content, 1, 'paladin')).toThrow(/cannot play/);
    expect(validateCampaign({ ...ASCENT_CAMPAIGN, heroIds: ['mage', 'ghost'] }, content)).toContain(
      'Campaign ascent: unknown champion "ghost"',
    );
  });

  it('the same 10 encounters: board, objective and rewards identical; the opening differs only where a ChampionSetup says so', () => {
    const mage = createRun(ASCENT_CAMPAIGN, content, 1, 'mage');
    const summoner = createRun(ASCENT_CAMPAIGN, content, 1, 'summoner');
    for (const e of encounterOrder(ASCENT_CAMPAIGN)) {
      const a = currentEncounter(ASCENT_CAMPAIGN, { ...mage, currentEncounterId: e.id });
      const b = currentEncounter(ASCENT_CAMPAIGN, { ...summoner, currentEncounterId: e.id });
      const setup = e.champions?.summoner;
      expect(e.champions?.mage).toBeUndefined(); // the Mage plays the authored opening
      expect(a.hero).toEqual({ heroId: 'mage', pos: e.hero.pos });
      expect(b.hero).toEqual({ heroId: 'summoner', pos: setup?.heroPos ?? e.hero.pos });
      expect(b.enemies).toEqual(setup?.enemies ?? a.enemies);
      expect(b.waves).toEqual(setup?.waves ?? a.waves);
      const opening = { hero: null, enemies: null, waves: null };
      expect({ ...b, ...opening }).toEqual({ ...a, ...opening });
      const engine = new GameEngine(b, campaignBattleContent(content, createProfile(content), summoner, DECK_RULES), 1);
      expect(engine.state.units.find((u) => u.kind === 'HERO')?.defId).toBe('summoner');
    }
  });
});

describe('rewards and progress never cross champions', () => {
  it('a Summoner victory offers Summoner cards and grants them to the Summoner only', () => {
    const profile = createProfile(content);
    const run = dropSeed('summoner', profile);
    const won = settleVictory(ASCENT_CAMPAIGN, content, profile, run, run.currentEncounterId, DECK_RULES);
    if (!won.ok) throw new Error(won.error);
    const cards = won.run.rewardOptions.flatMap((o) => (o.kind === 'ADD_CARD' ? [o.cardId] : []));
    expect(cards.length).toBeGreaterThan(0);
    for (const id of cards) expect(heroOf(id)).toBe('summoner');

    const option = won.run.rewardOptions.find((o) => o.kind === 'ADD_CARD')!;
    const claim = claimReward(ASCENT_CAMPAIGN, content, won.profile, won.run, option.id);
    if (!claim.ok) throw new Error(claim.error);
    expect(claim.granted?.cardId).toBe(option.kind === 'ADD_CARD' ? option.cardId : null);
    // Mage collection, decks and pity are exactly as before.
    expect(claim.profile.heroes.mage).toEqual(profile.heroes.mage);
    expect(heroProfile(claim.profile, 'summoner', content).collection[claim.granted!.cardId]!.copies).toBeGreaterThan(
      heroProfile(profile, 'summoner', content).collection[claim.granted!.cardId]?.copies ?? 0,
    );
  });

  it('a Mage victory offers Mage cards and leaves the Summoner untouched', () => {
    const profile = createProfile(content);
    const run = dropSeed('mage', profile);
    const won = settleVictory(ASCENT_CAMPAIGN, content, profile, run, run.currentEncounterId, DECK_RULES);
    if (!won.ok) throw new Error(won.error);
    for (const o of won.run.rewardOptions) if (o.kind === 'ADD_CARD') expect(heroOf(o.cardId)).toBe('mage');
    const option = won.run.rewardOptions.find((o) => o.kind === 'ADD_CARD')!;
    const claim = claimReward(ASCENT_CAMPAIGN, content, won.profile, won.run, option.id);
    if (!claim.ok) throw new Error(claim.error);
    expect(claim.profile.heroes.summoner).toEqual(profile.heroes.summoner);
  });

  it('pity is per champion: a Summoner no-drop win does not move Mage pity', () => {
    const profile = createProfile(content);
    for (let seed = 1; seed < 500; seed++) {
      const run = createRun(ASCENT_CAMPAIGN, content, seed, 'summoner');
      const won = settleVictory(ASCENT_CAMPAIGN, content, profile, run, run.currentEncounterId, DECK_RULES);
      if (!won.ok || won.roll.options.length) continue;
      expect(won.profile.heroes.summoner!.rewardPity).toBeGreaterThan(0);
      expect(won.profile.heroes.mage!.rewardPity).toBe(0);
      return;
    }
    throw new Error('no no-drop seed');
  });

  it('victory proofs replay with the run champion: a Summoner win does not verify on a Mage run', () => {
    const profile = createProfile(content);
    const summonerRun = { ...createRun(ASCENT_CAMPAIGN, content, 5, 'summoner'), currentEncounterId: 'ascent_04_shield_wall', completedEncounterIds: encounterOrder(ASCENT_CAMPAIGN).slice(0, 3).map((e) => e.id) };
    const { proof } = winCurrent(profile, summonerRun);
    expect(verifyVictory(ASCENT_CAMPAIGN, content, profile, summonerRun, proof, DECK_RULES)).toEqual({ ok: true });
    const mageRun = { ...summonerRun, heroId: 'mage' };
    expect(verifyVictory(ASCENT_CAMPAIGN, content, profile, mageRun, proof, DECK_RULES).ok).toBe(false);
  });
});

describe('campaign saves keep their champion', () => {
  it('a Summoner run round-trips as a Summoner run; legacy Mage saves still load as Mage', () => {
    const summoner = createRun(ASCENT_CAMPAIGN, content, 9, 'summoner');
    const loaded = parseRunSave(serializeRun(summoner), ASCENT_CAMPAIGN, content);
    expect(loaded).toEqual({ status: 'OK', run: summoner });

    const legacy = JSON.stringify({ version: 2, run: createRun(ASCENT_CAMPAIGN, content, 4) });
    const mage = parseRunSave(legacy, ASCENT_CAMPAIGN, content);
    expect(mage.status === 'OK' && mage.run.heroId).toBe('mage');
  });

  it("a save whose rewards belong to another champion is rejected, not reassigned", () => {
    const run: RunState = {
      ...createRun(ASCENT_CAMPAIGN, content, 2, 'summoner'),
      status: 'CHOOSING_REWARD',
      completedEncounterIds: ['ascent_01_outpost'],
      rewardOptions: [{ id: 'r1', kind: 'ADD_CARD', cardId: 'frost_nova', rarity: 'UNCOMMON' }],
    };
    const result = parseRunSave(serializeRun(run), ASCENT_CAMPAIGN, content);
    expect(result).toEqual({ status: 'INVALID', reason: 'reward card "frost_nova" is not a summoner card' });
    expect(parseRunSave(serializeRun({ ...run, heroId: 'paladin' }), ASCENT_CAMPAIGN, content).status).toBe('INVALID');
  });
});

describe('per-champion openings (ChampionSetup)', () => {
  const id = 'ascent_09_elder';
  const withSetup = (setup: NonNullable<EncounterDef['champions']>): CampaignDef => ({
    ...ASCENT_CAMPAIGN,
    encounters: ASCENT_CAMPAIGN.encounters.map((e) => (e.id === id ? { ...e, champions: setup } : e)),
  });
  const at = (campaign: CampaignDef, heroId: string) =>
    currentEncounter(campaign, { ...createRun(campaign, content, 1, heroId), currentEncounterId: id });

  it('changes only that champion\'s opening; board, objective and rewards stay the same', () => {
    const campaign = withSetup({
      summoner: { reason: 'test', heroPos: { x: 0, y: 2 }, waves: [{ round: 4, enemies: [{ id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 8, y: 0 } }] }] },
    });
    const authored = at(ASCENT_CAMPAIGN, 'mage');
    expect(at(campaign, 'mage')).toEqual({ ...authored, champions: campaign.encounters.find((e) => e.id === id)!.champions });
    const summoner = at(campaign, 'summoner');
    expect(summoner.hero).toEqual({ heroId: 'summoner', pos: { x: 0, y: 2 } });
    expect(summoner.waves[0]!.round).toBe(4);
    for (const key of ['layout', 'objectives', 'rewards', 'tier', 'enemies', 'collectibles'] as const) expect(summoner[key]).toEqual(authored[key]);
    expect(validateCampaign(campaign, content)).toEqual([]);
  });

  it('a setup must be a legal opening for a champion of the campaign', () => {
    expect(validateCampaign(withSetup({ paladin: { reason: 'test' } }), content)).toContain(
      `Encounter ${id}: setup for "paladin", who cannot play the campaign`,
    );
    const blocked = validateCampaign(withSetup({ summoner: { reason: 'test', heroPos: { x: 6, y: 1 } } }), content);
    expect(blocked.some((e) => e.includes('blocked'))).toBe(true);
    const noTarget = validateCampaign(
      withSetup({ summoner: { reason: 'test', enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 6, y: 5 } }] } }),
      content,
    );
    expect(noTarget.length).toBeGreaterThan(0); // DEFEAT_TARGET "elder" must still exist
  });
});

describe('the Summoner can finish the campaign', () => {
  // A mid-campaign Summoner deck (a few earned creatures/support), as in qa/multi-champion.
  const MID = [
    ['summon_chicken', 2], ['nurture', 3], ['summoner_ward', 3], ['summoner_push', 2], ['summoner_step', 1],
    ['summon_fox', 3], ['summon_turtle', 2], ['summon_raven', 2], ['entangle', 2],
  ].map(([cardId, count]) => ({ cardId: cardId as string, count: count as number }));

  it('every encounter (with its Summoner opening) can be won by the summon-aware greedy bot', () => {
    const battle = withHeroDeck(content, 'summoner', MID);
    for (const e of encounterOrder(ASCENT_CAMPAIGN)) {
      const encounter = currentEncounter(ASCENT_CAMPAIGN, { ...createRun(ASCENT_CAMPAIGN, content, 1, 'summoner'), currentEncounterId: e.id });
      const won = Array.from({ length: 12 }, (_, i) => i + 1).some(
        (seed) => playBattle(new GameEngine(encounter, battle, seed), 60, undefined, { summonAware: true }).outcome?.result === 'WON',
      );
      expect(won, e.id).toBe(true);
    }
  }, 300_000);
});
