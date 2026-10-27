import { beforeEach, describe, expect, it } from 'vitest';
import {
  ASCENT_CAMPAIGN,
  campaignBattleContent,
  createProfile,
  createRun,
  currentEncounter,
  DECK_RULES,
  DEFAULT_CONTENT,
  encounterOrder,
  GameEngine,
  PITY_THRESHOLD,
  serializeProfile,
  serializeRun,
  withPity,
  type PlayerProfile,
  type RunState,
  type VictoryProof,
} from '../src/game';
import { handle } from '../server/src/index';
import { addAccount, memoryD1 } from './support/d1';
import { playBattle } from './support/bot';

type State = {
  profile: PlayerProfile | null;
  run: RunState | null;
  runs: Record<string, RunState | null> | null;
  error?: { code: string };
  importNotes?: string[];
};

let db: ReturnType<typeof memoryD1>;
let released = true;
const order = encounterOrder(ASCENT_CAMPAIGN).map((e) => e.id);

async function call(token: string, method: string, path: string, body?: unknown) {
  const req = new Request(`https://api.test/api/tactics${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const deps = { content: DEFAULT_CONTENT, now: () => 1_000_000, seed: () => 7, summonerCampaign: released };
  const res = await handle(req, { DB: db }, deps);
  return { status: res.status, body: (await res.json()) as State };
}

/** Greedy-bot win of the champion's current encounter, as a client proof. */
function winProof(state: State, heroId: string): VictoryProof {
  const run = state.runs![heroId]!;
  const encounter = currentEncounter(ASCENT_CAMPAIGN, run);
  for (let seed = 1; seed < 60; seed++) {
    const engine = new GameEngine(encounter, campaignBattleContent(DEFAULT_CONTENT, state.profile!, run, DECK_RULES), seed);
    playBattle(engine, 30);
    if (engine.state.outcome?.result === 'WON')
      return { encounterId: encounter.id, seed, commands: JSON.parse(JSON.stringify(engine.history)) };
  }
  throw new Error(`bot could not win as ${heroId}`);
}

beforeEach(() => {
  db = memoryD1({ legacyProfiles: true });
  released = true;
});

describe('server: one run per champion', () => {
  it('preserves Mage writes by the previous Worker after the migration copy', async () => {
    const { id, token } = addAccount(db, 'rollout');
    await call(token, 'POST', '/profile', {});
    await call(token, 'POST', '/campaign/start', {});
    const newer = createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 987, 'mage');
    db.sql.prepare('UPDATE tactics_campaign_runs SET run_json = ?, updated_at = ? WHERE user_id = ?')
      .run(serializeRun(newer), 1_000_001, id);
    const restored = await call(token, 'GET', '/state');
    expect(restored.body.run).toEqual(newer);
    expect(restored.body.runs!.mage).toEqual(newer);
  });
  it('Summoner start is refused while the Summoner campaign is locked; the Mage is unaffected', async () => {
    released = false;
    const { token } = addAccount(db, 'ana');
    await call(token, 'POST', '/profile', {});
    const locked = await call(token, 'POST', '/campaign/start', { heroId: 'summoner' });
    expect(locked.status).toBe(403);
    expect(locked.body.error?.code).toBe('CHAMPION_LOCKED');
    expect((await call(token, 'POST', '/campaign/start', { heroId: 'paladin' })).status).toBe(422);
    // The Warrior is QA-only: locked without WARRIOR_ENABLED / WARRIOR_QA.
    expect((await call(token, 'POST', '/campaign/start', { heroId: 'warrior' })).body.error?.code).toBe('CHAMPION_LOCKED');
    const mage = await call(token, 'POST', '/campaign/start', {}); // older clients: no heroId = Mage
    expect(mage.body.run).toMatchObject({ heroId: 'mage', currentEncounterId: order[0] });
    expect(mage.body.runs).toEqual({ mage: mage.body.run, summoner: null, warrior: null });
  });

  it('Summoner and Mage runs, rewards, pity and logs never cross', async () => {
    const { id, token } = addAccount(db, 'ana');
    await call(token, 'POST', '/profile', {});
    // Pity at the threshold so the first wins always offer cards.
    db.sql.prepare('INSERT OR REPLACE INTO tactics_hero_progress (user_id, hero_id, reward_pity, updated_at) VALUES (?, ?, ?, 0)').run(id, 'summoner', PITY_THRESHOLD);
    await call(token, 'POST', '/campaign/start', { heroId: 'mage' });
    const started = await call(token, 'POST', '/campaign/start', { heroId: 'summoner' });
    expect(started.body.runs!.summoner).toMatchObject({ heroId: 'summoner', currentEncounterId: order[0] });
    const mageBefore = started.body.runs!.mage;
    const mageProfile = started.body.profile!.heroes.mage;

    // A Summoner proof is not a Mage victory (replayed with the Mage's run and deck).
    const proof = winProof(started.body, 'summoner');
    expect((await call(token, 'POST', '/campaign/victory', { proof, heroId: 'mage' })).status).toBe(422);
    const won = await call(token, 'POST', '/campaign/victory', { proof, heroId: 'summoner' });
    expect(won.status).toBe(200);
    const summonerRun = won.body.runs!.summoner!;
    expect(summonerRun.status).toBe('CHOOSING_REWARD');
    for (const o of summonerRun.rewardOptions) if (o.kind === 'ADD_CARD') expect(DEFAULT_CONTENT.cards[o.cardId]!.heroId).toBe('summoner');

    // The Summoner's offer cannot be claimed through the Mage run.
    const offer = summonerRun.rewardOptions.find((o) => o.kind === 'ADD_CARD')!;
    expect((await call(token, 'POST', '/campaign/reward', { optionId: offer.id, encounterId: order[0], heroId: 'mage' })).status).toBe(409);
    const took = await call(token, 'POST', '/campaign/reward', { optionId: offer.id, encounterId: order[0], heroId: 'summoner' });
    expect(took.status).toBe(200);
    expect(took.body.runs!.summoner).toMatchObject({ status: 'IN_BATTLE', currentEncounterId: order[1] });
    expect(took.body.runs!.mage).toEqual(mageBefore);
    expect(took.body.profile!.heroes.mage).toEqual(mageProfile);
    if (offer.kind === 'ADD_CARD') {
      const rows = db.sql.prepare('SELECT hero_id FROM tactics_player_cards WHERE user_id = ? AND card_id = ?').all(id, offer.cardId);
      expect(rows).toEqual([{ hero_id: 'summoner' }]);
    }
    const logs = db.sql.prepare('SELECT DISTINCT hero_id FROM tactics_reward_log WHERE user_id = ?').all(id);
    expect(logs).toEqual([{ hero_id: 'summoner' }]);

    // Another device restores both runs.
    const reload = await call(token, 'GET', '/state');
    expect(reload.body.runs).toEqual(took.body.runs);
    expect(reload.body.run).toEqual(mageBefore); // legacy field = the Mage run
  }, 120000);

  it('a new Summoner campaign does not reset the Mage run (and vice versa)', async () => {
    const { token } = addAccount(db, 'ana');
    await call(token, 'POST', '/profile', {});
    const mage = (await call(token, 'POST', '/campaign/start', { heroId: 'mage' })).body;
    const won = await call(token, 'POST', '/campaign/victory', { proof: winProof(mage, 'mage'), heroId: 'mage' });
    const mageRun = won.body.runs!.mage;
    await call(token, 'POST', '/campaign/start', { heroId: 'summoner' });
    const again = await call(token, 'POST', '/campaign/start', { heroId: 'summoner' });
    expect(again.body.runs!.mage).toEqual(mageRun);
    expect(again.body.runs!.summoner).toMatchObject({ completedEncounterIds: [] });
  }, 60000);

  it('migration 0011: an existing Mage run is kept as the Mage run and mirrored for rollback', async () => {
    const { id, token } = addAccount(db, 'old');
    await call(token, 'POST', '/profile', {});
    const legacy = { ...createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 5), currentEncounterId: order[3]!, completedEncounterIds: order.slice(0, 3) };
    // Pre-0011 state: the run only lives in the old table; re-applying the copy step migrates it.
    db.sql.prepare('DELETE FROM tactics_hero_campaign_runs').run();
    db.sql.prepare('INSERT INTO tactics_campaign_runs (user_id, campaign_id, run_json, save_version, updated_at) VALUES (?, ?, ?, 1, 0)').run(id, 'ascent', serializeRun(legacy));
    db.sql.exec(`INSERT OR IGNORE INTO tactics_hero_campaign_runs (user_id, campaign_id, hero_id, run_json, save_version, updated_at)
      SELECT user_id, campaign_id, 'mage', run_json, save_version, updated_at FROM tactics_campaign_runs;`);
    const state = await call(token, 'GET', '/state');
    expect(state.body.runs).toEqual({ mage: legacy, summoner: null, warrior: null });
    // Progress keeps being mirrored into the old table for the Mage.
    const won = await call(token, 'POST', '/campaign/victory', { proof: winProof(state.body, 'mage'), heroId: 'mage' });
    const old = db.sql.prepare('SELECT run_json FROM tactics_campaign_runs WHERE user_id = ?').get(id) as { run_json: string };
    expect(JSON.parse(old.run_json).run).toEqual(won.body.runs!.mage);
  }, 60000);

  it('a row stored under the wrong champion is never served as that champion\'s run', async () => {
    const { id, token } = addAccount(db, 'ana');
    await call(token, 'POST', '/profile', {});
    db.sql
      .prepare("INSERT INTO tactics_hero_campaign_runs (user_id, campaign_id, hero_id, run_json, save_version, updated_at) VALUES (?, 'ascent', 'summoner', ?, 1, 0)")
      .run(id, serializeRun(createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 2, 'mage')));
    expect((await call(token, 'GET', '/state')).body.runs!.summoner).toBeNull();
  });

  it('local import brings each champion\'s campaign into its own run', async () => {
    const { token } = addAccount(db, 'ana');
    const mage = { ...createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 3), currentEncounterId: order[2]!, completedEncounterIds: order.slice(0, 2) };
    const summoner = { ...createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 4, 'summoner'), currentEncounterId: order[1]!, completedEncounterIds: order.slice(0, 1) };
    const profile = serializeProfile(withPity(createProfile(DEFAULT_CONTENT), 'summoner', 2, DEFAULT_CONTENT));
    const imported = await call(token, 'POST', '/import', {
      profile,
      campaign: serializeRun(mage),
      // A Mage run in another champion's slot is discarded, not reassigned.
      campaigns: { mage: serializeRun(mage), summoner: serializeRun(summoner), warrior: serializeRun(mage) },
    });
    expect(imported.body.runs).toEqual({ mage, summoner, warrior: null });
    const bad = await call(addAccount(db, 'bo').token, 'POST', '/import', { profile, campaigns: { summoner: serializeRun(mage) } });
    expect(bad.body.runs).toEqual({ mage: null, summoner: null, warrior: null });
    expect(bad.body.importNotes).toContain('summoner: campaign discarded: it is a mage run');
    // Older clients send only `campaign` (the Mage run).
    const legacy = await call(addAccount(db, 'cy').token, 'POST', '/import', { profile, campaign: serializeRun(mage) });
    expect(legacy.body.runs).toEqual({ mage, summoner: null, warrior: null });
  });
});
