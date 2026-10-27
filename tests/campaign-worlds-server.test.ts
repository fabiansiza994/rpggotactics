import { beforeEach, describe, expect, it } from 'vitest';
import {
  ASCENT_CAMPAIGN,
  campaignBattleContent,
  createRun,
  currentEncounter,
  DECK_RULES,
  DEFAULT_CONTENT,
  encounterOrder,
  GameEngine,
  INFERNAL_CAMPAIGN,
  serializeRun,
  type GameContent,
  type PlayerProfile,
  type RunState,
  type VictoryProof,
  type WorldView,
} from '../src/game';
import { handle } from '../server/src/index';
import { addAccount, memoryD1 } from './support/d1';
import { playBattle } from './support/bot';

type State = {
  profile: PlayerProfile | null;
  run: RunState | null;
  runs: Record<string, RunState | null> | null;
  worldRuns: Record<string, Record<string, RunState | null>> | null;
  worlds: Record<string, { worlds: WorldView[]; total: { completedEncounters: number; totalEncounters: number; completedWorlds: number } }> | null;
  world2Available: boolean;
  error?: { code: string };
};

let db: ReturnType<typeof memoryD1>;
let world2: boolean | undefined;
let content: GameContent;
let ids = 0;
const ascent = encounterOrder(ASCENT_CAMPAIGN).map((e) => e.id);
const infernal = encounterOrder(INFERNAL_CAMPAIGN).map((e) => e.id);

/** Test content where every World 2 foe has 1 HP: the greedy bot can then win any encounter. */
const weakInfernal = (): GameContent => ({
  ...DEFAULT_CONTENT,
  enemies: Object.fromEntries(
    Object.entries(DEFAULT_CONTENT.enemies).map(([id, e]) => [id, ['forge_king', 'ash_shaman', 'infernal_imp', 'infernal_knight', 'magma_beast', 'infernal_jailer'].includes(id) ? { ...e, maxHp: 1, armor: 0 } : e]),
  ),
});

async function call(token: string, method: string, path: string, body?: unknown) {
  const req = new Request(`https://api.test/api/tactics${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const deps = { content, now: () => 2_000_000, seed: () => 11, summonerCampaign: true, world2, store: { catalog: [], cosmetics: {}, newId: () => `tx-${++ids}` } };
  const res = await handle(req, { DB: db }, deps);
  return { status: res.status, body: (await res.json()) as State };
}

const completedRun = (heroId: string): RunState => ({
  ...createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 5, heroId),
  status: 'COMPLETED',
  currentEncounterId: ascent.at(-1)!,
  completedEncounterIds: [...ascent],
});

function putRun(userId: number, run: RunState) {
  db.sql
    .prepare(
      `INSERT INTO tactics_hero_campaign_runs (user_id, campaign_id, hero_id, run_json, save_version, updated_at) VALUES (?, ?, ?, ?, 1, 1)
       ON CONFLICT (user_id, campaign_id, hero_id) DO UPDATE SET run_json = excluded.run_json`,
    )
    .run(userId, run.campaignId, run.heroId, serializeRun(run));
}

/** A greedy-bot win of the run's current encounter (any world), as a client proof. */
function winProof(state: State, run: RunState): VictoryProof {
  const campaign = run.campaignId === INFERNAL_CAMPAIGN.id ? INFERNAL_CAMPAIGN : ASCENT_CAMPAIGN;
  const encounter = currentEncounter(campaign, run);
  for (let seed = 1; seed < 80; seed++) {
    const engine = new GameEngine(encounter, campaignBattleContent(content, state.profile!, run, DECK_RULES), seed);
    playBattle(engine, 30);
    if (engine.state.outcome?.result === 'WON') return { encounterId: encounter.id, seed, commands: JSON.parse(JSON.stringify(engine.history)) };
  }
  throw new Error(`bot could not win ${encounter.id}`);
}

const view = (state: State, heroId: string, worldId: string) => state.worlds![heroId]!.worlds.find((w) => w.id === worldId);
const crystals = (userId: number) =>
  (db.sql.prepare("SELECT balance FROM tactics_wallets WHERE user_id = ? AND currency_id = 'arcane_crystals'").get(userId) as { balance: number } | undefined)?.balance ?? 0;

beforeEach(() => {
  db = memoryD1({ legacyProfiles: true });
  world2 = true;
  content = DEFAULT_CONTENT;
});

describe('server: campaign worlds', () => {
  it('World 1 is untouched for older clients (no campaignId) and World 2 starts locked', async () => {
    const { token } = addAccount(db, 'ana');
    await call(token, 'POST', '/profile', {});
    const started = await call(token, 'POST', '/campaign/start', { heroId: 'mage' });
    expect(started.body.run).toMatchObject({ campaignId: 'ascent', heroId: 'mage', currentEncounterId: ascent[0] });
    // World 3 (Act III) is listed with empty runs: hidden by its flag, it can be neither started nor won.
    expect(started.body.worldRuns).toEqual({
      infernal: { mage: null, summoner: null, warrior: null, shapeshifter: null, archer: null },
      temple: { mage: null, summoner: null, warrior: null, shapeshifter: null, archer: null },
      archer_hunt: { archer: null },
    });
    expect(view(started.body, 'mage', 'world_1')).toMatchObject({ status: 'IN_PROGRESS', unlocked: true, completedEncounters: 0, totalEncounters: 10, currentEncounter: ascent[0], currentEncounterAlias: 'w1_e01' });
    expect(view(started.body, 'mage', 'world_2')).toMatchObject({ status: 'LOCKED', unlocked: false, currentEncounter: null });
    const locked = await call(token, 'POST', '/campaign/start', { heroId: 'mage', campaignId: 'infernal' });
    expect(locked.status).toBe(403);
    expect(locked.body.error?.code).toBe('WORLD_LOCKED');
    // A World 1 victory still works exactly as before (proof without campaignId).
    const won = await call(token, 'POST', '/campaign/victory', { heroId: 'mage', proof: winProof(started.body, started.body.run!) });
    expect(won.status).toBe(200);
    expect(won.body.run!.completedEncounterIds).toEqual([ascent[0]]);
  });

  it('a hidden World 2 (flag off) is neither listed nor startable, even after World 1', async () => {
    world2 = false;
    const { id, token } = addAccount(db, 'ana');
    await call(token, 'POST', '/profile', {});
    putRun(id, completedRun('summoner'));
    const state = await call(token, 'GET', '/state');
    expect(state.body.world2Available).toBe(false);
    expect(state.body.worlds!.summoner!.worlds.map((w) => w.id)).toEqual(['world_1']);
    const r = await call(token, 'POST', '/campaign/start', { heroId: 'summoner', campaignId: 'infernal' });
    expect(r.status).toBe(403);
    expect(r.body.error?.code).toBe('WORLD_LOCKED');
  });

  it('legacy account with Invocador 10/10: World 1 COMPLETADO, World 2 DESBLOQUEADO 0/10, playable — per champion', async () => {
    const { id, token } = addAccount(db, 'legacy');
    await call(token, 'POST', '/profile', {});
    putRun(id, completedRun('summoner'));
    const state = await call(token, 'GET', '/state');
    expect(view(state.body, 'summoner', 'world_1')).toMatchObject({ status: 'COMPLETED', completed: true, bossDefeated: true, completedEncounters: 10 });
    expect(view(state.body, 'summoner', 'world_2')).toMatchObject({ status: 'UNLOCKED', unlocked: true, completedEncounters: 0, totalEncounters: 10, currentEncounter: 'w2_e01', currentEncounterAlias: 'w2_e01', run: null });
    expect(state.body.worlds!.summoner!.total).toEqual({ completedEncounters: 10, totalEncounters: 20, completedWorlds: 1 });
    // The Mage never finished World 1: World 2 stays locked for it.
    expect(view(state.body, 'mage', 'world_2')!.unlocked).toBe(false);
    expect((await call(token, 'POST', '/campaign/start', { heroId: 'mage', campaignId: 'infernal' })).status).toBe(403);
    const started = await call(token, 'POST', '/campaign/start', { heroId: 'summoner', campaignId: 'infernal' });
    expect(started.status).toBe(200);
    expect(started.body.worldRuns!.infernal!.summoner).toMatchObject({ campaignId: 'infernal', currentEncounterId: 'w2_e01', status: 'IN_BATTLE' });
    // World 1's completed run is untouched.
    expect(started.body.runs!.summoner).toEqual(completedRun('summoner'));
  });

  it('a verified boss victory in the reward log unlocks World 2 even after World 1 was restarted (hero_id NULL = Mage)', async () => {
    const { id, token } = addAccount(db, 'old');
    await call(token, 'POST', '/profile', {});
    await call(token, 'POST', '/campaign/start', { heroId: 'mage' }); // the 10/10 run was replaced long ago
    db.sql
      .prepare(`INSERT INTO tactics_reward_log (user_id, campaign_id, hero_id, run_seed, encounter_id, pool, event, pity_before, pity_after, created_at) VALUES (?, 'ascent', NULL, 1, 'ascent_10_colossus', 'BOSS', 'OFFERED', 0, 0, 5)`)
      .run(id);
    const state = await call(token, 'GET', '/state');
    expect(view(state.body, 'mage', 'world_1')).toMatchObject({ completed: true, completedEncounters: 10, run: { completedEncounters: 0 } });
    expect(view(state.body, 'mage', 'world_2')!.status).toBe('UNLOCKED');
    expect(view(state.body, 'summoner', 'world_2')!.status).toBe('LOCKED');
  });

  it('replaying World 1 ("Nueva campaña") never relocks World 2 nor touches its run', async () => {
    const { id, token } = addAccount(db, 'legacy');
    await call(token, 'POST', '/profile', {});
    putRun(id, completedRun('summoner'));
    const w2 = await call(token, 'POST', '/campaign/start', { heroId: 'summoner', campaignId: 'infernal' });
    const replay = await call(token, 'POST', '/campaign/start', { heroId: 'summoner' });
    expect(replay.body.runs!.summoner).toMatchObject({ currentEncounterId: ascent[0], completedEncounterIds: [] });
    expect(view(replay.body, 'summoner', 'world_1')).toMatchObject({ completed: true, status: 'COMPLETED', run: { completedEncounters: 0 } });
    expect(view(replay.body, 'summoner', 'world_2')).toMatchObject({ unlocked: true, status: 'IN_PROGRESS' });
    expect(replay.body.worldRuns!.infernal!.summoner).toEqual(w2.body.worldRuns!.infernal!.summoner);
    // The derived completion became a durable row when its run was overwritten.
    expect(db.sql.prepare("SELECT world_id FROM tactics_world_progress WHERE user_id = ? AND hero_id = 'summoner'").all(id)).toEqual([{ world_id: 'world_1' }]);
    expect((await call(token, 'POST', '/campaign/start', { heroId: 'summoner', campaignId: 'infernal' })).status).toBe(200);
  });

  it('rejects forged ids: another encounter, another world, unknown campaigns', async () => {
    const { id, token } = addAccount(db, 'legacy');
    await call(token, 'POST', '/profile', {});
    putRun(id, completedRun('mage'));
    content = weakInfernal();
    const started = await call(token, 'POST', '/campaign/start', { heroId: 'mage', campaignId: 'infernal' });
    const run = started.body.worldRuns!.infernal!.mage!;
    // A real win of w2_e05, sent while the run is at w2_e01.
    const ahead = winProof(started.body, { ...run, currentEncounterId: 'w2_e05', completedEncounterIds: infernal.slice(0, 4) });
    const r1 = await call(token, 'POST', '/campaign/victory', { heroId: 'mage', campaignId: 'infernal', proof: ahead });
    expect(r1.status).toBe(422);
    // A valid World 2 proof submitted as World 1, and vice versa.
    const real = winProof(started.body, run);
    expect((await call(token, 'POST', '/campaign/victory', { heroId: 'mage', proof: real })).status).toBe(422); // World 1's run is COMPLETED
    for (const campaignId of ['skirmish', 'nope', 42])
      expect((await call(token, 'POST', '/campaign/start', { heroId: 'mage', campaignId })).body.error?.code).toBe('UNKNOWN_CAMPAIGN');
    const ok = await call(token, 'POST', '/campaign/victory', { heroId: 'mage', campaignId: 'infernal', proof: real });
    expect(ok.status).toBe(200);
    expect(ok.body.worldRuns!.infernal!.mage!.completedEncounterIds).toEqual(['w2_e01']);
    // World 2 progress never moves the World 1 milestone counter.
    expect(ok.body.profile!.champions!.campaignBest).toBe(10);
  });

  it('defeating the Forge King completes World 2 once: reward paid once, replays and retries pay nothing', async () => {
    const { id, token } = addAccount(db, 'hero');
    await call(token, 'POST', '/profile', {});
    putRun(id, completedRun('summoner'));
    content = weakInfernal();
    // Play the world through to the boss with real, replay-verified wins.
    let state = (await call(token, 'POST', '/campaign/start', { heroId: 'summoner', campaignId: 'infernal' })).body;
    const walk = async () => {
      for (let i = 0; i < infernal.length; i++) {
        const run = state.worldRuns!.infernal!.summoner!;
        const proof = winProof(state, run);
        const won = await call(token, 'POST', '/campaign/victory', { heroId: 'summoner', campaignId: 'infernal', proof });
        expect(won.status).toBe(200);
        state = won.body;
        const after = state.worldRuns!.infernal!.summoner!;
        if (after.status === 'CHOOSING_REWARD') {
          if (proof.encounterId === 'w2_e10') {
            // A lost response retried: the durable result, no second payment.
            const retry = await call(token, 'POST', '/campaign/victory', { heroId: 'summoner', campaignId: 'infernal', proof });
            expect(retry.status).toBe(200);
          }
          state = (await call(token, 'POST', '/campaign/reward', { heroId: 'summoner', campaignId: 'infernal', optionId: after.rewardOptions[0]!.id, encounterId: after.currentEncounterId })).body;
        }
      }
    };
    expect(view(state, 'summoner', 'world_2')!.completionReward).toMatchObject({ crystals: 250, granted: false });
    await walk();
    expect(state.worldRuns!.infernal!.summoner!.status).toBe('COMPLETED');
    expect(view(state, 'summoner', 'world_2')).toMatchObject({ status: 'COMPLETED', completed: true, bossDefeated: true, completedEncounters: 10, completionReward: { granted: true } });
    expect(crystals(id)).toBe(290);
    const ledger = db.sql.prepare("SELECT reason, reference_id, amount_delta FROM tactics_wallet_ledger WHERE user_id = ? AND reason = 'ACHIEVEMENT_REWARD'").all(id);
    expect(ledger).toEqual([{ reason: 'ACHIEVEMENT_REWARD', reference_id: 'world:world_2:summoner', amount_delta: 250 }]);
    // Replay World 2 and beat the boss again: still one payment.
    state = (await call(token, 'POST', '/campaign/start', { heroId: 'summoner', campaignId: 'infernal' })).body;
    expect(view(state, 'summoner', 'world_2')).toMatchObject({ status: 'COMPLETED', run: { completedEncounters: 0 } });
    await walk();
    expect(crystals(id)).toBe(290);
    expect(view(state, 'summoner', 'world_2')!.completionReward!.granted).toBe(true);
  }, 120_000);

  it('the completion reward is per champion and the ledger key makes a duplicate payment impossible', async () => {
    const { id, token } = addAccount(db, 'hero');
    await call(token, 'POST', '/profile', {});
    putRun(id, completedRun('mage'));
    content = weakInfernal();
    await call(token, 'POST', '/campaign/start', { heroId: 'mage', campaignId: 'infernal' });
    // Jump the stored run to the boss (QA-style), then win it.
    putRun(id, { ...createRun(INFERNAL_CAMPAIGN, content, 11, 'mage'), currentEncounterId: 'w2_e10', completedEncounterIds: infernal.slice(0, 9) });
    const state = (await call(token, 'GET', '/state')).body;
    const proof = winProof(state, state.worldRuns!.infernal!.mage!);
    // Simulate a payment that already happened (e.g. a concurrent request) without its row.
    db.sql
      .prepare("INSERT INTO tactics_wallet_ledger (transaction_id, user_id, currency_id, amount_delta, balance_before, balance_after, reason, reference_id, created_at) VALUES ('x', ?, 'arcane_crystals', 250, 0, 250, 'ACHIEVEMENT_REWARD', 'world:world_2:mage', 1)")
      .run(id);
    const raced = await call(token, 'POST', '/campaign/victory', { heroId: 'mage', campaignId: 'infernal', proof });
    // The whole step is refused (nothing half-written), never a second payment.
    expect(raced.status).toBe(409);
    expect(crystals(id)).toBe(250);
    expect(raced.body.error?.code).toBe('INVALID_STEP');
  });
});
