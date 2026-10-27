import { describe, expect, it } from 'vitest';
import { DECK_RULES, DEFAULT_CONTENT, GameEngine, type GameContent, type GameState, type PlayerProfile } from '../src/game';
import { withArcher } from '../src/game/data/archer';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import { FREE_CATALOG, FREE_CATALOG_EXPANSION, FREE_CATALOG_NEW_CARDS } from '../src/game/data/free-catalog';
import { addCardIssue, copyLimit, validateDeck, type DeckEntry } from '../src/game/collection/deck-rules';
import { createProfile, grantCard, heroProfile } from '../src/game/collection/profile';
import { parseProfileSave, serializeProfile } from '../src/game/collection/profile-save';
import {
  applyCatalogGrants,
  catalogFactsFrom,
  discoverRarities,
  dueCatalogGrants,
  type CatalogFacts,
} from '../src/game/collection/free-catalog';
import { isExclusiveCard } from '../src/game/domain/cards/card';
import { rollReward, REWARD_POOLS } from '../src/game/run/rewards';
import { masteryLevelXp } from '../src/game/mastery/mastery';
import { createDuel, applyDuel } from '../src/game/pvp/duel';
import { endTurn, makeEngine, mutable, ofType, p, setHand } from './helpers';

/**
 * Free card catalog — Phase A: LEGENDARY/ULTRA rarities, the Única rule (1 copy, banished once
 * played, never recycled), deck limits, and the milestone grants (first clear, Mastery 7, Act I,
 * Archer Sendero) including the retroactive catch-up. Server-side grants: free-catalog-server.test.ts.
 */
const ALL = withShapeshifterRelease(withArcher(DEFAULT_CONTENT));
const released = (c: GameContent): GameContent => ({ ...c, releasedExpansions: [...(c.releasedExpansions ?? []), FREE_CATALOG_EXPANSION] });
const ULTRAS = ['archmage_eruption', 'summon_pact_golem', 'last_bastion', 'arrow_rain', 'ancestral_stampede'];
const LEGENDARIES = ['elemental_detonation', 'binder_command', 'bastion_blow', 'hunters_net', 'form_dance'];

const facts = (over: Partial<{ cleared: Record<string, string[]>; worlds: Record<string, string[]>; mastery: Record<string, number> | null }> = {}): CatalogFacts => ({
  cleared: (h) => new Set(over.cleared?.[h] ?? []),
  completedWorlds: (h) => new Set(over.worlds?.[h] ?? []),
  masteryLevel: (h) => (over.mastery === null ? null : (over.mastery?.[h] ?? 1)),
});

describe('catalog: 20 cards, 5 champions × 4 rarities', () => {
  it('every champion has Común, Rara, Legendaria and Ultra with the matching card rarity', () => {
    expect(Object.keys(FREE_CATALOG).sort()).toEqual(['archer', 'mage', 'shapeshifter', 'summoner', 'warrior']);
    for (const [heroId, rows] of Object.entries(FREE_CATALOG)) {
      expect(rows.map((r) => r.tier)).toEqual(['COMMON', 'RARE', 'LEGENDARY', 'ULTRA']);
      for (const r of rows) {
        const card = ALL.cards[r.cardId];
        expect(card, r.cardId).toBeDefined();
        expect(card!.heroId).toBe(heroId);
        expect(card!.rarity ?? 'COMMON').toBe(r.tier);
      }
    }
    const rows = Object.values(FREE_CATALOG).flat();
    expect(rows).toHaveLength(20);
    expect(rows.filter((r) => r.reused).map((r) => r.cardId).sort()).toEqual(
      ['challenge', 'fireball', 'mark_prey', 'pinning_arrow', 'qa_bear_form', 'shield_bash', 'summon_fox', 'true_shot'].sort(),
    );
    expect(FREE_CATALOG_NEW_CARDS).toHaveLength(12);
  });

  it('Commons are starter cards (owned from the first match); every Ultra is Única', () => {
    const profile = createProfile(ALL);
    for (const [heroId, rows] of Object.entries(FREE_CATALOG))
      expect(heroProfile(profile, heroId, ALL).collection[rows[0]!.cardId]?.copies ?? 0, heroId).toBeGreaterThan(0);
    for (const id of ULTRAS) expect(ALL.cards[id]).toMatchObject({ rarity: 'ULTRA', unique: true });
    for (const id of LEGENDARIES) expect(ALL.cards[id]!.unique).toBeUndefined();
  });

  it('the 12 new cards keep guaranteed milestone sources and no random drops; commercial overlap is allowed with that route', () => {
    for (const card of FREE_CATALOG_NEW_CARDS) {
      expect(isExclusiveCard(card)).toBe(true);
      expect(card.acquisition?.source).toBe('FREE_CATALOG');
      expect(card.presentation.premiumTreatment).toBeUndefined();
    }
    for (const pool of Object.values(REWARD_POOLS)) expect([pool.rarityWeights.LEGENDARY, pool.rarityWeights.ULTRA]).toEqual([0, 0]);
    // Even with the set released, a boss roll never offers a catalog card.
    const content = released(DEFAULT_CONTENT);
    for (let seed = 1; seed < 40; seed++) {
      const roll = rollReward({ poolId: 'BOSS', heroId: 'mage', owned: () => 0, content, seed, pity: 0, rules: DECK_RULES, count: 3 });
      expect(roll.options.some((o) => o.kind === 'ADD_CARD' && FREE_CATALOG_NEW_CARDS.some((c) => c.id === o.cardId))).toBe(false);
    }
  });
});

describe('Legendary / Ultra serialization and deck limits', () => {
  it('a profile owning a Legendary and an Ultra survives save → load unchanged', () => {
    let profile: PlayerProfile = createProfile(DEFAULT_CONTENT);
    for (const id of ['elemental_detonation', 'archmage_eruption']) profile = (grantCard(profile, 'mage', id, DEFAULT_CONTENT) as { profile: PlayerProfile }).profile;
    const loaded = parseProfileSave(serializeProfile(profile), DEFAULT_CONTENT);
    expect(loaded.status).toBe('OK');
    const mage = heroProfile((loaded as { profile: PlayerProfile }).profile, 'mage', DEFAULT_CONTENT);
    expect(mage.collection.elemental_detonation?.copies).toBe(1);
    expect(mage.collection.archmage_eruption?.copies).toBe(1);
  });

  it('copy limits: Legendary 1, Ultra (Única) 1; Common/Rare limits unchanged', () => {
    expect(DECK_RULES.maxCopiesByRarity).toMatchObject({ COMMON: 3, UNCOMMON: 2, RARE: 1, LEGENDARY: 1, ULTRA: 1 });
    expect(copyLimit(DEFAULT_CONTENT.cards.elemental_detonation!, DECK_RULES)).toBe(1);
    expect(copyLimit(DEFAULT_CONTENT.cards.archmage_eruption!, DECK_RULES)).toBe(1);
    // Única wins over any per-card override.
    expect(copyLimit({ ...DEFAULT_CONTENT.cards.archmage_eruption!, maxCopies: 3 }, DECK_RULES)).toBe(1);
    expect(copyLimit(DEFAULT_CONTENT.cards.fireball!, DECK_RULES)).toBe(3);
    expect(DECK_RULES.requiredSize).toBe(30);
  });

  it('Unique deck limit: 2 copies are refused; at most 1 Ultra per deck', () => {
    const owned = () => 3;
    const starter = DEFAULT_CONTENT.heroes.mage!.deck;
    const deck29: DeckEntry[] = starter.map((e) => ({ ...e }));
    const trimmed = deck29.map((e, i) => (i === 0 ? { ...e, count: e.count - 2 } : e)); // 28 cards
    const two: DeckEntry[] = [...trimmed, { cardId: 'archmage_eruption', count: 2 }];
    expect(validateDeck(two, 'mage', owned, DEFAULT_CONTENT, DECK_RULES)).toContainEqual({ code: 'COPY_LIMIT', cardId: 'archmage_eruption', count: 2, limit: 1 });
    const one: DeckEntry[] = [...trimmed, { cardId: 'archmage_eruption', count: 1 }];
    expect(addCardIssue(one, 'archmage_eruption', 'mage', owned, DEFAULT_CONTENT, DECK_RULES)).toMatchObject({ code: 'COPY_LIMIT' });
    // A second Ultra (synthetic: the catalog has one per champion) hits the per-deck Ultra cap.
    const content: GameContent = { ...DEFAULT_CONTENT, cards: { ...DEFAULT_CONTENT.cards, qa_ultra: { ...DEFAULT_CONTENT.cards.archmage_eruption!, id: 'qa_ultra' } } };
    expect(addCardIssue(one, 'qa_ultra', 'mage', owned, content, DECK_RULES)).toEqual({ code: 'ULTRA_LIMIT', count: 2, limit: 1 });
    expect(validateDeck([...trimmed.map((e, i) => (i === 1 ? { ...e, count: e.count - 1 } : e)), { cardId: 'archmage_eruption', count: 1 }, { cardId: 'qa_ultra', count: 1 }, { cardId: 'fireball', count: 0 }].filter((e) => e.count > 0), 'mage', owned, content, DECK_RULES)).toContainEqual({ code: 'ULTRA_LIMIT', count: 2, limit: 1 });
  });
});

describe('Única: banished after use, never recycled', () => {
  const ultraBattle = () => {
    const engine = makeEngine({ layout: Array(5).fill('.........'), enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(4, 2) }] });
    const [uid] = setHand(engine, ['archmage_eruption']);
    mutable(engine).player.energy = 5;
    return { engine, uid: uid! };
  };

  it('played → BANISHED (not discarded), out of hand, deck and discard', () => {
    const { engine, uid } = ultraBattle();
    const r = engine.dispatch({ type: 'PLAY_CARD', cardUid: uid, target: p(4, 2) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(ofType(r.events, 'CARD_BANISHED')).toEqual([{ type: 'CARD_BANISHED', cardUid: uid, cardId: 'archmage_eruption' }]);
    expect(ofType(r.events, 'CARD_DISCARDED')).toEqual([]);
    const s = engine.state;
    expect(s.player.banished?.map((c) => c.uid)).toEqual([uid]);
    expect([...s.player.hand, ...s.player.deck, ...s.player.discard].some((c) => c.uid === uid)).toBe(false);
  });

  it('no recycle: an empty deck reshuffles the discard, never the banished Ultra', () => {
    const { engine, uid } = ultraBattle();
    engine.dispatch({ type: 'PLAY_CARD', cardUid: uid, target: p(4, 2) });
    const s = mutable(engine);
    s.player.discard.push(...s.player.deck.splice(0)); // deck empty: the next draw recycles
    for (let k = 0; k < 4 && !s.outcome; k++) engine.dispatch(endTurn(engine));
    const live = engine.state.player;
    const everywhere = [...live.hand, ...live.deck, ...live.discard];
    expect(everywhere.some((c) => c.cardId === 'archmage_eruption')).toBe(false);
    expect(live.banished?.map((c) => c.uid)).toEqual([uid]);
  });

  it('replay and reconnect keep the banished state exactly', () => {
    const { engine, uid } = ultraBattle();
    const snapshot = structuredClone(engine.state) as GameState;
    const play = { type: 'PLAY_CARD', cardUid: uid, target: p(4, 2) } as const;
    engine.dispatch(play);
    engine.dispatch(endTurn(engine));
    const copy = GameEngine.fromSnapshot(snapshot, engine.content, engine.scenario);
    copy.dispatch(play);
    copy.dispatch(endTurn(copy));
    expect(JSON.stringify(copy.state)).toBe(JSON.stringify(engine.state));
    const reconnect = GameEngine.fromSnapshot(JSON.parse(JSON.stringify(engine.state)) as GameState, engine.content, engine.scenario);
    expect(reconnect.state.player.banished?.map((c) => c.cardId)).toEqual(['archmage_eruption']);
    engine.dispatch(endTurn(engine));
    reconnect.dispatch(endTurn(reconnect));
    expect(JSON.stringify(reconnect.state)).toBe(JSON.stringify(engine.state));
  });

  it('PvP: the banished pile follows its owner across seat swaps, and the event is public', () => {
    const cards = (heroId: string, ultra: string) => {
      const base = DEFAULT_CONTENT.heroes[heroId]!.deck.map((e) => ({ ...e }));
      base[0]!.count -= 1;
      return [...base, { cardId: ultra, count: 1 }];
    };
    let state = createDuel([{ heroId: 'warrior', cards: cards('warrior', 'last_bastion') }, { heroId: 'mage', cards: cards('mage', 'archmage_eruption') }], 7);
    // Arrange: the active seat holds its Ultra.
    const active = state.player;
    const ultraId = active.heroId === 'champion-a' ? 'last_bastion' : 'archmage_eruption';
    const all = [...active.deck, ...active.hand];
    const ultra = all.find((c) => c.cardId === ultraId)!;
    active.deck = active.deck.filter((c) => c !== ultra);
    active.hand = [...active.hand.filter((c) => c !== ultra), ultra];
    active.energy = 5;
    if (ultraId === 'archmage_eruption') {
      const rival = state.units.find((u) => u.id !== active.heroId && u.kind === 'HERO')!;
      const me = state.units.find((u) => u.id === active.heroId)!;
      rival.pos = { x: me.pos.x + 3, y: me.pos.y };
      if (rival.pos.x >= state.board.width) rival.pos = { x: me.pos.x - 3, y: me.pos.y };
    }
    const target = ultraId === 'archmage_eruption' ? state.units.find((u) => u.id !== active.heroId && u.kind === 'HERO')!.pos : null;
    const played = applyDuel(state, { type: 'PLAY_CARD', cardUid: ultra.uid, target });
    expect(ofType(played.events, 'CARD_BANISHED').map((e) => e.cardId)).toEqual([ultraId]);
    state = played.state;
    const owner = state.player.heroId;
    state = applyDuel(state, endTurn(state)).state;
    // The other seat is active now: the owner's banished pile travelled with its PlayerState.
    expect(state.player.heroId).not.toBe(owner);
    expect(state.duel!.other.banished?.map((c) => c.cardId)).toEqual([ultraId]);
    expect(state.player.banished ?? []).toEqual([]);
  });
});

describe('milestone grants (pure core, guests and server share it)', () => {
  const content = released(ALL);
  const profile = () => createProfile(content);
  const owned = (pr: PlayerProfile) => (h: string, c: string) => heroProfile(pr, h, content).collection[c]?.copies ?? 0;

  it('nothing before the set is released, nothing for unmet milestones', () => {
    expect(dueCatalogGrants(ALL, owned(profile()), facts({ worlds: { mage: ['world_1'] }, mastery: { mage: 10 } }))).toEqual([]);
    expect(dueCatalogGrants(content, owned(profile()), facts())).toEqual([]);
  });

  it('Rare = first clear of El Ascenso IV (Archer: Sendero V); Legendary = Mastery 7; Ultra = Act I (Archer: Sendero)', () => {
    const due = dueCatalogGrants(
      content,
      owned(profile()),
      facts({
        cleared: { mage: ['ascent_04_shield_wall'], archer: ['hunt_05_stalker'] },
        worlds: { warrior: ['world_1'], archer: ['archer_act_1'], shapeshifter: ['world_1'] },
        mastery: { summoner: 7, mage: 6 },
      }),
    );
    expect(due.map((g) => `${g.heroId}:${g.cardId}`).sort()).toEqual(
      ['mage:arcane_pull', 'archer:pinning_arrow', 'summoner:binder_command', 'warrior:last_bastion', 'archer:arrow_rain', 'shapeshifter:ancestral_stampede'].sort(),
    );
    // A champion's own Act I only: the Archer's Ascenso completion is not its Act I equivalent.
    expect(dueCatalogGrants(content, owned(profile()), facts({ worlds: { archer: ['world_1'] } }))).toEqual([]);
  });

  it('idempotent: applying twice grants once; an already-owned reused Rare is never duplicated', () => {
    const f = facts({ cleared: { summoner: ['ascent_04_shield_wall'] }, worlds: { summoner: ['world_1'] } });
    const once = applyCatalogGrants(profile(), content, f);
    expect(once.granted.map((g) => g.cardId).sort()).toEqual(['mark_prey', 'summon_pact_golem']);
    const twice = applyCatalogGrants(once.profile, content, f);
    expect(twice.granted).toEqual([]);
    expect(twice.profile).toBe(once.profile);
    // Marcar Presa already owned from a drop: no extra copy.
    const dropped = (grantCard(profile(), 'summoner', 'mark_prey', content) as { profile: PlayerProfile }).profile;
    const after = applyCatalogGrants(dropped, content, f);
    expect(after.granted.map((g) => g.cardId)).toEqual(['summon_pact_golem']);
    expect(heroProfile(after.profile, 'summoner', content).collection.mark_prey?.copies).toBe(1);
  });

  it('retroactive Act I from existing progress only: a COMPLETED legacy run or a world history row', () => {
    const run = { campaignId: 'ascent', heroId: 'mage', completedEncounterIds: ['ascent_10_colossus'] } as never;
    const fromRun = catalogFactsFrom({ runs: (h) => (h === 'mage' ? [run] : []), worldHistory: {} });
    expect(fromRun.completedWorlds('mage').has('world_1')).toBe(true);
    // A completed world implies its encounters were won (so the Rare comes too).
    expect(fromRun.cleared('mage').has('ascent_04_shield_wall')).toBe(true);
    const fromHistory = catalogFactsFrom({ runs: () => [], worldHistory: { warrior: { world_1: { completedAt: 5, rewardGrantedAt: null } } } });
    const granted = applyCatalogGrants(profile(), content, fromHistory).granted.map((g) => g.cardId).sort();
    expect(granted).toEqual(['challenge', 'last_bastion']);
    // Mastery unavailable (guest) never grants a Legendary.
    expect(fromHistory.masteryLevel('warrior')).toBeNull();
    const xp = catalogFactsFrom({ runs: () => [], worldHistory: {}, masteryXp: (h) => (h === 'mage' ? masteryLevelXp(7) : masteryLevelXp(7) - 1) });
    expect([xp.masteryLevel('mage'), xp.masteryLevel('warrior')]).toEqual([7, 6]);
  });
});

describe('«Descubre las rarezas» data', () => {
  it('four rows per champion, locked ones visible with stats, unlock method and progress', () => {
    const content = released(ALL);
    const rows = discoverRarities(content, createProfile(content), 'mage', facts({ cleared: { mage: ['ascent_01_outpost', 'ascent_02_watchtower'] }, mastery: { mage: 4 } }));
    expect(rows.map((r) => [r.tier, r.cardId, r.owned])).toEqual([
      ['COMMON', 'fireball', true],
      ['RARE', 'arcane_pull', false],
      ['LEGENDARY', 'elemental_detonation', false],
      ['ULTRA', 'archmage_eruption', false],
    ]);
    expect(rows[1]).toMatchObject({ rarity: 'RARE', cost: 1, unlock: { type: 'ENCOUNTER_CLEAR', met: false, progress: { current: 2, target: 4 } } });
    expect(rows[1]!.unlock.label).toContain('IV · Muro de escudos');
    expect(rows[2]!.unlock).toMatchObject({ label: 'Maestría 7', progress: { current: 4, target: 7 } });
    expect(rows[3]).toMatchObject({ unique: true, rarity: 'ULTRA', unlock: { type: 'WORLD_COMPLETED', progress: { current: 2, target: 10 } } });
    for (const r of rows) expect(r.rulesText.length).toBeGreaterThan(20);
  });
});
