import { describe, expect, it } from 'vitest';
import {
  GameEngine,
  DEFAULT_CONTENT,
  DECK_RULES,
  createProfile,
  createRun,
  currentEncounter,
  skirmishRewardContext,
  settleVictory,
  withHeroDeck,
  battleDeck,
  addCard,
  removeCard,
  type PlayerProfile,
  type RunState,
} from '../src/game';
import { handle } from '../server/src/index';
import { memoryD1, addAccount } from './support/d1';
import { playBattle } from './support/bot';
import { actSummons, spawnSummon } from '../src/game/domain/summons/summons';
import { ctxFor, makeEngine, mutable, p } from './helpers';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

interface State {
  profile: PlayerProfile;
  run: RunState | null;
  skirmish: { id: number; run: RunState; deck: { cardId: string; count: number }[] } | null;
  error?: { code: string };
}
function fixture(seed = 1) {
  const db = memoryD1({ legacyProfiles: true });
  const user = addAccount(db, 'summoner');
  const call = async (method: string, path: string, body?: unknown, token = user.token) => {
    const res = await handle(
      new Request(`https://local/api/tactics${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      { DB: db },
      { content: DEFAULT_CONTENT, now: () => 1000, seed: () => seed },
    );
    return { status: res.status, data: (await res.json()) as State };
  };
  return { db, call, user };
}
function winningSeed() {
  const context = skirmishRewardContext('escape', 'summoner');
  const profile = createProfile(DEFAULT_CONTENT);
  for (let seed = 1; seed <= 24; seed++) {
    const run = createRun(context, DEFAULT_CONTENT, seed);
    const e = new GameEngine(
      currentEncounter(context, run),
      withHeroDeck(
        DEFAULT_CONTENT,
        'summoner',
        battleDeck(profile, 'summoner', DEFAULT_CONTENT, DECK_RULES)
          .cards.slice()
          .sort((a, b) => a.cardId.localeCompare(b.cardId)),
      ),
      seed,
    );
    playBattle(e, 8);
    if (e.state.outcome?.result === 'WON') return { seed, commands: [...e.history] };
  }
  throw new Error('No legal Summoner escape win found');
}

describe('authoritative Summoner skirmish unlocks', () => {
  it('keeps Mage campaign separate and ties richer pools to actual elite/boss threats', () => {
    const normal = skirmishRewardContext('first_blood', 'summoner').encounters[0]!;
    const elite = skirmishRewardContext('crystal_guard', 'summoner').encounters[0]!;
    const boss = skirmishRewardContext('escape', 'summoner').encounters[0]!;
    expect(normal.rewards.pool).toBe('NORMAL');
    expect(elite.enemies.some((e) => DEFAULT_CONTENT.enemies[e.enemyId]?.rank === 'ELITE')).toBe(
      true,
    );
    expect(boss.enemies.some((e) => DEFAULT_CONTENT.enemies[e.enemyId]?.rank === 'BOSS')).toBe(
      true,
    );
    expect(() => skirmishRewardContext('first_blood', 'mage')).toThrow();
  });
  it('rejects spoofed victory, wrong seed, stale battle, wrong champion and unauthorized caller', async () => {
    const { call } = fixture();
    await call('POST', '/profile', {});
    expect(
      (await call('POST', '/skirmish/start', { heroId: 'mage', scenarioId: 'first_blood' })).status,
    ).toBe(422);
    expect(
      (await call('POST', '/skirmish/start', { heroId: 'summoner', scenarioId: 'unknown' })).status,
    ).toBe(422);
    const start = (
      await call('POST', '/skirmish/start', { heroId: 'summoner', scenarioId: 'first_blood' })
    ).data;
    const proof = { encounterId: 'first_blood', seed: 1, commands: [] };
    expect(
      (await call('POST', '/skirmish/victory', { battleId: start.skirmish!.id, proof })).status,
    ).toBe(422);
    expect(
      (
        await call('POST', '/skirmish/victory', {
          battleId: start.skirmish!.id,
          proof: { ...proof, seed: 2 },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call('POST', '/skirmish/reward', {
          battleId: start.skirmish!.id,
          optionId: 'reward-0-summon_wolf',
        })
      ).status,
    ).toBe(409);
    expect((await call('POST', '/skirmish/victory', { battleId: -1, proof })).status).toBe(409);
    expect(
      (
        await call(
          'POST',
          '/skirmish/start',
          { heroId: 'summoner', scenarioId: 'first_blood' },
          'invalid',
        )
      ).status,
    ).toBe(401);
    expect((await call('GET', '/state')).data.run).toBeNull();
  });
  it('replays a real boss escape win, stores stable offers and grants once, surviving reload', async () => {
    const win = winningSeed();
    const { call, db, user } = fixture(win.seed);
    await call('POST', '/profile', {});
    const start = (
      await call('POST', '/skirmish/start', { heroId: 'summoner', scenarioId: 'escape' })
    ).data.skirmish!;
    // Fixture: this account earned a second Tortuga (the starter has one) after battle start.
    db.sql.prepare("UPDATE tactics_player_cards SET copies=2, acquired=1, source='NORMAL_DROP' WHERE user_id=? AND hero_id='summoner' AND card_id='summon_turtle'").run(user.id);
    // Change the saved deck while the battle is running; replay must use its start snapshot.
    const changedDeck = addCard(removeCard(start.deck, 'summon_fox'), 'summon_turtle');
    expect((await call('PUT', '/decks/summoner/main', { cards: changedDeck })).status).toBe(200);
    const body = {
      battleId: start.id,
      proof: { encounterId: 'escape', seed: win.seed, commands: win.commands },
    };
    const victory = await call('POST', '/skirmish/victory', body);
    expect(victory.status, JSON.stringify(victory.data)).toBe(200);
    const run = victory.data.skirmish!.run;
    expect(run.status).toBe('CHOOSING_REWARD');
    expect(run.rewardOptions.some((o) => o.kind === 'ADD_CARD' && o.cardId === 'summon_wolf')).toBe(
      true,
    );
    expect(run.rewardOptions.every((o) => o.kind === 'ADD_CARD')).toBe(true);
    expect(
      (await call('POST', '/skirmish/victory', body)).data.skirmish!.run.rewardOptions,
    ).toEqual(run.rewardOptions);
    expect(
      (await call('POST', '/skirmish/start', { heroId: 'summoner', scenarioId: 'escape' })).status,
    ).toBe(409);
    expect(
      (await call('POST', '/skirmish/reward', { battleId: start.id, optionId: 'forged' })).status,
    ).toBe(409);
    const wolf = run.rewardOptions.find(
      (o) => o.kind === 'ADD_CARD' && o.cardId === 'summon_wolf',
    )!;
    // Locked card cannot be equipped before claim.
    const deck = addCard(removeCard(start.deck, 'summoner_push'), 'summon_wolf');
    expect((await call('PUT', '/decks/summoner/main', { cards: deck })).status).toBe(422);
    const claim = { battleId: start.id, optionId: wolf.id };
    const concurrent = await Promise.all([
      call('POST', '/skirmish/reward', claim),
      call('POST', '/skirmish/reward', claim),
    ]);
    expect(concurrent.some((r) => r.status === 200)).toBe(true);
    expect(concurrent.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    expect((await call('POST', '/skirmish/reward', claim)).status).toBe(200);
    const reloaded = (await call('GET', '/state')).data;
    expect(reloaded.profile.heroes.summoner!.collection.summon_wolf!.copies).toBe(1);
    expect(reloaded.profile.heroes.summoner!.rewardPity).toBe(0);
    expect(reloaded.run).toBeNull();
    expect(
      db.sql
        .prepare('SELECT count(*) n FROM tactics_skirmish_steps WHERE battle_id=?')
        .get(start.id),
    ).toMatchObject({ n: 2 });
    expect(
      db.sql
        .prepare("SELECT count(*) n FROM tactics_reward_log WHERE user_id=? AND event='CLAIMED'")
        .get(user.id),
    ).toMatchObject({ n: 1 });
    expect((await call('PUT', '/decks/summoner/main', { cards: deck })).status).toBe(200);
  });
  it('the additive migration grants only starter Fox to old Summoner profiles and is idempotent', async () => {
    const { call, db, user } = fixture();
    await call('POST', '/profile', {});
    db.sql
      .prepare("DELETE FROM tactics_player_cards WHERE user_id=? AND card_id='summon_fox'")
      .run(user.id);
    const migration = readFileSync(
      new URL('../server/migrations/0003_tactics_skirmishes.sql', import.meta.url),
      'utf8',
    );
    db.sql.exec(migration);
    db.sql.exec(migration);
    const hero = (await call('GET', '/state')).data.profile.heroes.summoner!;
    expect(hero.collection.summon_fox?.copies).toBe(3);
    // The 30-card starter's single Tortuga, not something the migration granted.
    expect(hero.collection.summon_turtle?.copies).toBe(1);
    expect(hero.collection.summon_wolf).toBeUndefined();
  });
  it('starting Summoner skirmishes preserves the independent Mage campaign', async () => {
    const { call } = fixture();
    await call('POST', '/profile', {});
    const campaign = (await call('POST', '/campaign/start', {})).data.run;
    await call('POST', '/skirmish/start', { heroId: 'summoner', scenarioId: 'first_blood' });
    const state = (await call('GET', '/state')).data;
    expect(state.run).toEqual(campaign);
    expect(state.run?.heroId).toBe('mage');
    expect(state.skirmish?.run.heroId).toBe('summoner');
  });
  it('no-drop wins reuse per-champion pity; a completed skirmish has no useless HP option', () => {
    const context = skirmishRewardContext('first_blood', 'summoner');
    let profile = createProfile(DEFAULT_CONTENT);
    let misses = 0;
    for (let seed = 1; seed < 100 && misses < 4; seed++) {
      const run = createRun(context, DEFAULT_CONTENT, seed);
      const won = settleVictory(context, DEFAULT_CONTENT, profile, run, 'first_blood', DECK_RULES);
      if (won.ok && !won.roll.cardDrop) {
        profile = won.profile;
        misses++;
        expect(won.run.status).toBe('COMPLETED');
      }
    }
    expect(misses).toBe(4);
    expect(profile.heroes.summoner!.rewardPity).toBe(4);
    expect(profile.heroes.mage!.rewardPity).toBe(0);
    const run = createRun(context, DEFAULT_CONTENT, 103);
    const won = settleVictory(context, DEFAULT_CONTENT, profile, run, 'first_blood', DECK_RULES);
    expect(won.ok && won.roll.cardDrop).toBe(true);
  });
  it('bounded ally actions reproduce exactly and stay affordable on a 7×5 board', () => {
    const samples: number[] = [];
    let reference: unknown;
    for (let i = 0; i < 30; i++) {
      const e = makeEngine({ hero: { heroId: 'summoner', pos: p(0, 2) } });
      const ctx = ctxFor(e);
      const hero = mutable(e).units.find((u) => u.id === e.heroId)!;
      spawnSummon(ctx, hero, 'chicken', p(1, 2));
      spawnSummon(ctx, hero, 'fox', p(0, 1));
      mutable(e).round = 2;
      const start = performance.now();
      actSummons(ctx);
      samples.push(performance.now() - start);
      if (i === 0) reference = structuredClone(e.state);
      else expect(e.state).toEqual(reference);
    }
    const sorted = samples.sort((a, b) => a - b);
    console.log('Summoner actSummons timing', { medianMs: sorted[15], p95Ms: sorted[28] });
    expect(sorted[15]).toBeLessThan(100);
  });
});
