import { MAGE_THUNDER_CORE } from '../src/game/data/mage-thunder-core';
import { MAGE_THUNDER_EXPANSION } from '../src/game/data/mage-thunder-expansion';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ASCENT_CAMPAIGN,
  campaignBattleContent,
  claimReward,
  copyLimit,
  createProfile,
  createRun,
  currentEncounter,
  DECK_RULES,
  DEFAULT_CONTENT,
  GameEngine,
  ownedFor,
  PITY_THRESHOLD,
  REWARD_POOLS,
  rollReward,
  parseProfileSave,
  serializeProfile,
  settleVictory,
  withPity,
  type CardDefinition,
  type GameContent,
  type OwnedCopies,
  type PlayerProfile,
  type RewardPoolId,
  type RunState,
} from '../src/game';
import { handle } from '../server/src/index';
import { playBattle } from './support/bot';
import { addAccount, memoryD1 } from './support/d1';
import { seedForFirstDrop } from './support/drops';

const starter = createProfile(DEFAULT_CONTENT);
const starterOwned = ownedFor(starter, 'mage', DEFAULT_CONTENT);
const roll = (o: Partial<Parameters<typeof rollReward>[0]> & { poolId: RewardPoolId; seed: number }) =>
  rollReward({ content: DEFAULT_CONTENT, heroId: 'mage', owned: starterOwned, pity: 0, rules: DECK_RULES, count: 3, ...o });
const cardIds = (r: ReturnType<typeof rollReward>) => r.options.flatMap((o) => (o.kind === 'ADD_CARD' ? [o.cardId] : []));
const mageCards = Object.values(DEFAULT_CONTENT.cards).filter((c) => c.heroId === 'mage');
const allCapped: OwnedCopies = (id) => copyLimit(DEFAULT_CONTENT.cards[id]!, DECK_RULES);
const seeds = Array.from({ length: 400 }, (_, i) => i + 1);

describe('starter vs unlockable Mage cards', () => {
  it('the Mage starts with its core 8 cards + 2 of Repulse, Glacial Field and Flame Tile (30-card starter); the rest is earned', () => {
    const owned = mageCards.filter((c) => starterOwned(c.id) > 0).map((c) => c.id).sort();
    expect(owned).toEqual(['arcane_burst', 'barrier', 'blink', 'fireball', 'flame_tile', 'force_push', 'glacial_field', 'ice_wall', 'magic_missile', 'phase_step', 'repulse']);
    // The three added commons keep a third copy to earn (or buy): never at the copy cap.
    for (const id of ['flame_tile', 'glacial_field', 'repulse']) expect(starterOwned(id)).toBe(2);
    expect(mageCards.filter((c) => starterOwned(c.id) === 0).map((c) => c.id).sort()).toEqual([
      ...MAGE_THUNDER_CORE.map(c=>c.id), ...MAGE_THUNDER_EXPANSION.map(c=>c.id),
      'arcane_surge', // Still Mage-only, as in published Release 1.
      'arcane_burst_ii',
      'arcane_chain', // «Arsenal I» (QA-gated until released)
      'arcane_exchange', // Ranked Reward Track (early access: never drops)
      'ash_eclipse', // Ranked Premium Track (pass only: never drops)
      'blink_ii',
      'dispel',
      'frost_comet', // «Vitrina I» (QA-gated until released)
      'frost_nova',
      'glacial_shell',
      'ignition_rune', // Ranked Reward Track
      'magma_fissure', // World 2 completion reward (exclusive source: never drops)
      'mirror_step', // «Arsenal I»
      'silence_seal', // «Arsenal I»
      'threshold_wave', // Act III completion reward (exclusive source: never drops)
      'arcane_pull', 'archmage_eruption', 'elemental_detonation', // free catalog (milestone grants only)
    ].sort());
  });
});

describe('reward RNG (deterministic, server-controlled seed)', () => {
  it('same input → same offer; different seeds can differ', () => {
    expect(roll({ poolId: 'ELITE', seed: 77 })).toEqual(roll({ poolId: 'ELITE', seed: 77 }));
    const offers = new Set(seeds.slice(0, 60).map((seed) => cardIds(roll({ poolId: 'BOSS', seed })).join()));
    expect(offers.size).toBeGreaterThan(3);
  });

  it('options are distinct and carry rarity from the catalog', () => {
    for (const seed of seeds.slice(0, 80)) {
      const r = roll({ poolId: 'BOSS', seed });
      expect(new Set(r.options.map((o) => o.id)).size).toBe(r.options.length);
      for (const o of r.options) if (o.kind === 'ADD_CARD') expect(o.rarity).toBe(DEFAULT_CONTENT.cards[o.cardId]!.rarity ?? 'COMMON');
    }
  });
});

describe('encounter quality (from tier metadata)', () => {
  const dropRate = (poolId: RewardPoolId) => seeds.filter((seed) => roll({ poolId, seed }).cardDrop).length / seeds.length;

  it('normal: ~configured chance, cards only; elite: higher chance + MAX_HP; boss: always cards', () => {
    expect(Math.abs(dropRate('NORMAL') - REWARD_POOLS.NORMAL.cardChance)).toBeLessThan(0.08);
    expect(dropRate('ELITE')).toBeGreaterThan(dropRate('NORMAL') + 0.25);
    expect(dropRate('BOSS')).toBe(1);
    for (const seed of seeds.slice(0, 60)) {
      expect(roll({ poolId: 'NORMAL', seed }).options.every((o) => o.kind === 'ADD_CARD')).toBe(true);
      expect(roll({ poolId: 'ELITE', seed }).options.filter((o) => o.kind === 'MAX_HP')).toHaveLength(1);
    }
  });

  it('elite/boss guarantee the best available rarity (UNCOMMON+ today) among new cards', () => {
    for (const seed of seeds.slice(0, 80)) {
      for (const poolId of ['ELITE', 'BOSS'] as const) {
        const r = roll({ poolId, seed });
        if (r.cardDrop) expect(r.options.some((o) => o.kind === 'ADD_CARD' && o.rarity !== 'COMMON')).toBe(true);
      }
    }
  });

  it('champion pools: a Summoner roll only offers Summoner (or neutral) cards', () => {
    const summonerOwned: OwnedCopies = () => 0;
    for (const seed of seeds.slice(0, 40))
      for (const id of cardIds(roll({ poolId: 'BOSS', seed, heroId: 'summoner', owned: summonerOwned })))
        expect([undefined, 'summoner']).toContain(DEFAULT_CONTENT.cards[id]!.heroId);
  });

  it('themed pools: favorTags make matching cards more likely', () => {
    // Blink II is the only unowned UNCOMMON+ card tagged 'teleport' (the elite slot needs UNCOMMON or better).
    const count = (favorTags?: string[]) =>
      seeds.filter((seed) => cardIds(roll({ poolId: 'ELITE', seed, count: 2, favorTags }))[0] === 'blink_ii').length;
    expect(count()).toBeGreaterThan(0);
    expect(count(['teleport'])).toBeGreaterThan(count() * 1.5);
  });
});

describe('duplicate protection', () => {
  it('unowned cards fill the offer first', () => {
    for (const seed of seeds.slice(0, 100)) {
      const ids = cardIds(roll({ poolId: 'BOSS', seed, pity: PITY_THRESHOLD }));
      // 4 unowned Mage cards exist, the boss offers 2 card slots: both must be new.
      expect(ids.every((id) => starterOwned(id) === 0)).toBe(true);
    }
  });

  it('capped cards are never offered; below-cap copies are once new cards run out', () => {
    // Own every Mage card except one copy short on Fireball.
    const almost: OwnedCopies = (id) => (id === 'fireball' ? 2 : allCapped(id));
    for (const seed of seeds.slice(0, 60)) {
      const ids = cardIds(roll({ poolId: 'BOSS', seed, owned: almost }));
      expect(ids).toEqual(['fireball']);
    }
  });

  it('a complete collection degrades safely: normal → nothing, elite/boss → MAX_HP only', () => {
    for (const seed of seeds.slice(0, 30)) {
      expect(roll({ poolId: 'NORMAL', seed, owned: allCapped, pity: PITY_THRESHOLD }).options).toEqual([]);
      for (const poolId of ['ELITE', 'BOSS'] as const)
        expect(roll({ poolId, seed, owned: allCapped }).options.map((o) => o.kind)).toEqual(['MAX_HP']);
    }
  });
});

describe('pity (core rules)', () => {
  const run1 = (seed: number) => createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, seed);
  const settle = (profile: PlayerProfile, run: RunState) => settleVictory(ASCENT_CAMPAIGN, DEFAULT_CONTENT, profile, run, run.currentEncounterId, DECK_RULES);

  it('a normal win without a drop adds pity; at the threshold the next win always offers cards', () => {
    const missSeed = seedForFirstDrop(false);
    const missed = settle(starter, run1(missSeed));
    if (!missed.ok) throw new Error(missed.error);
    expect(missed.run).toMatchObject({ status: 'IN_BATTLE', currentEncounterId: 'ascent_02_watchtower' });
    expect(missed.pity).toEqual({ before: 0, after: REWARD_POOLS.NORMAL.pityGain });
    // Same seed, pity at threshold → forced drop.
    const lucky = settle(withPity(starter, 'mage', PITY_THRESHOLD, DEFAULT_CONTENT), run1(missSeed));
    if (!lucky.ok) throw new Error(lucky.error);
    expect(lucky.run.status).toBe('CHOOSING_REWARD');
    expect(lucky.roll.pityTriggered).toBe(true);
  });

  it('claiming a card resets pity; claiming MAX_HP adds the tier gain', () => {
    const p = withPity(starter, 'mage', 3, DEFAULT_CONTENT);
    let run = createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 1);
    run = { ...run, currentEncounterId: 'ascent_05_alpha', completedEncounterIds: ['ascent_01_outpost', 'ascent_02_watchtower', 'ascent_03_open_field', 'ascent_04_shield_wall'] };
    const won = settle(p, run);
    if (!won.ok) throw new Error(won.error);
    const card = won.run.rewardOptions.find((o) => o.kind === 'ADD_CARD');
    const hp = won.run.rewardOptions.find((o) => o.kind === 'MAX_HP')!;
    if (card) {
      const c = claimReward(ASCENT_CAMPAIGN, DEFAULT_CONTENT, won.profile, won.run, card.id);
      expect(c.ok && c.pity).toEqual({ before: 3, after: 0 });
      expect(c.ok && c.granted?.isNew).toBe(card.kind === 'ADD_CARD' && starterOwned(card.cardId) === 0);
    }
    const h = claimReward(ASCENT_CAMPAIGN, DEFAULT_CONTENT, won.profile, won.run, hp.id);
    expect(h.ok && h.pity).toEqual({ before: 3, after: Math.min(PITY_THRESHOLD, 3 + REWARD_POOLS.ELITE.pityGain) });
  });

  it('pity persists in the profile save and old saves start at 0', () => {
    const p = withPity(starter, 'mage', 3, DEFAULT_CONTENT);
    const raw = JSON.parse(serializeProfile(p));
    expect(raw.profile.heroes.mage.rewardPity).toBe(3);
    delete raw.profile.heroes.mage.rewardPity;
    const old = parseProfileSave(JSON.stringify(raw), DEFAULT_CONTENT);
    expect(old.status === 'OK' && old.profile.heroes.mage!.rewardPity).toBe(0);
  });
});

// ── Server: authority, persistence, no reroll, audit ──────────────────────────────────
type State = { profile: PlayerProfile; run: RunState | null; error?: { code: string } };
let db: ReturnType<typeof memoryD1>;
let serverSeed = 1;
async function call(token: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: State }> {
  const req = new Request(`https://api.test/api/tactics${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await handle(req, { DB: db }, { content: DEFAULT_CONTENT as GameContent, now: () => 9, seed: () => serverSeed });
  return { status: res.status, body: (await res.json()) as State };
}
function winProof(s: State) {
  const encounter = currentEncounter(ASCENT_CAMPAIGN, s.run!);
  for (let seed = 1; seed < 60; seed++) {
    const engine = new GameEngine(encounter, campaignBattleContent(DEFAULT_CONTENT, s.profile, s.run!, DECK_RULES), seed);
    playBattle(engine);
    if (engine.state.outcome?.result === 'WON') return { encounterId: encounter.id, seed, commands: JSON.parse(JSON.stringify(engine.history)) };
  }
  throw new Error('bot could not win');
}
const pityRow = (userId: number) =>
  (db.sql.prepare("SELECT reward_pity AS p FROM tactics_hero_progress WHERE user_id = ? AND hero_id = 'mage'").get(userId) as { p: number } | undefined)?.p;
const log = (userId: number) =>
  db.sql.prepare('SELECT event, pool, pity_before AS b, pity_after AS a FROM tactics_reward_log WHERE user_id = ? ORDER BY id').all(userId) as { event: string; pool: string; b: number; a: number }[];

describe('server: authoritative card progression', () => {
  beforeEach(() => {
    db = memoryD1({ legacyProfiles: true });
  });

  it('drop → stored offer (GET never rerolls) → claim once → card owned with drop source → pity reset → audited', async () => {
    serverSeed = seedForFirstDrop(true);
    const { token, id } = addAccount(db, 'ana');
    await call(token, 'POST', '/profile', {});
    const started = (await call(token, 'POST', '/campaign/start', {})).body;
    const proof = winProof(started);
    // Forged victories leave pity and the log untouched.
    expect((await call(token, 'POST', '/campaign/victory', { proof: { ...proof, commands: [] } })).status).toBe(422);
    expect(log(id)).toEqual([]);
    const won = (await call(token, 'POST', '/campaign/victory', { proof })).body;
    expect(won.run!.status).toBe('CHOOSING_REWARD');
    const offer = won.run!.rewardOptions;
    for (let i = 0; i < 3; i++) expect((await call(token, 'GET', '/state')).body.run!.rewardOptions).toEqual(offer);
    expect((await call(token, 'POST', '/campaign/victory', { proof })).status).toBe(200); // same stored offer

    // The client cannot name a card, rarity or pity: only a stored option id counts.
    const forged = await call(token, 'POST', '/campaign/reward', { optionId: 'reward-0-frost_nova', cardId: 'frost_nova', rarity: 'RARE', pity: 0 });
    if (!offer.some((o) => o.id === 'reward-0-frost_nova')) expect(forged.status).toBe(409);
    const card = offer.find((o) => o.kind === 'ADD_CARD')!;
    if (card.kind !== 'ADD_CARD') throw new Error('expected a card');
    const claimed = await call(token, 'POST', '/campaign/reward', { optionId: card.id, pity: 99 });
    expect(claimed.status).toBe(200);
    expect(ownedFor(claimed.body.profile, 'mage', DEFAULT_CONTENT)(card.cardId)).toBe(starterOwned(card.cardId) + 1);
    expect((await call(token, 'POST', '/campaign/reward', { optionId: card.id })).status).toBe(409);
    expect(pityRow(id)).toBe(0);
    const row = db.sql.prepare('SELECT source FROM tactics_player_cards WHERE user_id = ? AND card_id = ?').get(id, card.cardId) as { source: string };
    expect(row.source).toBe('NORMAL_DROP');
    expect(log(id).map((l) => l.event)).toEqual(['OFFERED', 'CLAIMED']);
    // The new card is immediately part of the collection the Deck Builder reads.
    expect(ownedFor((await call(token, 'GET', '/state')).body.profile, 'mage', DEFAULT_CONTENT)(card.cardId)).toBeGreaterThan(0);
  }, 60_000);

  it('a win without a drop advances, adds persisted pity, and is audited as NO_DROP', async () => {
    serverSeed = seedForFirstDrop(false);
    const { token, id } = addAccount(db, 'bruno');
    await call(token, 'POST', '/profile', {});
    const started = (await call(token, 'POST', '/campaign/start', {})).body;
    const won = (await call(token, 'POST', '/campaign/victory', { proof: winProof(started) })).body;
    expect(won.run).toMatchObject({ status: 'IN_BATTLE', currentEncounterId: 'ascent_02_watchtower' });
    expect(won.profile.heroes.mage!.rewardPity).toBe(1);
    expect(pityRow(id)).toBe(1);
    expect((await call(token, 'GET', '/state')).body.profile.heroes.mage!.rewardPity).toBe(1); // reload
    expect(log(id)).toEqual([{ event: 'NO_DROP', pool: 'NORMAL', b: 0, a: 1 }]);
    expect((await call(token, 'POST', '/campaign/reward', { optionId: 'reward-0-dispel' })).status).toBe(409);
  }, 60_000);

  it('another account cannot claim, and imported pity is ignored', async () => {
    serverSeed = seedForFirstDrop(true);
    const ana = addAccount(db, 'ana');
    const eve = addAccount(db, 'eve');
    await call(ana.token, 'POST', '/profile', {});
    const started = (await call(ana.token, 'POST', '/campaign/start', {})).body;
    const won = (await call(ana.token, 'POST', '/campaign/victory', { proof: winProof(started) })).body;
    const forged = withPity(createProfile(DEFAULT_CONTENT), 'mage', 99, DEFAULT_CONTENT);
    const imported = (await call(eve.token, 'POST', '/import', { profile: serializeProfile(forged), campaign: null })).body;
    expect(imported.profile.heroes.mage!.rewardPity).toBe(0);
    expect((await call(eve.token, 'POST', '/campaign/reward', { optionId: won.run!.rewardOptions[0]!.id })).status).toBe(409);
    expect((await call(ana.token, 'GET', '/state')).body.run!.status).toBe('CHOOSING_REWARD');
    expect(db.sql.prepare('SELECT COUNT(*) AS n FROM tactics_reward_log WHERE user_id = ?').get(eve.id)).toEqual(expect.objectContaining({ n: 0 }));
  }, 60_000);
});

// Keep the type import used (CardDefinition documents the catalog shape in these tests).
export type _Catalog = CardDefinition;
