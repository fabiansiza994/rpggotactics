import { beforeEach, describe, expect, it } from 'vitest';
import {
  ARCHER_ACT_1,
  ARCHER_HUNT_CAMPAIGN,
  ARCHER_HUNT_CARDS,
  ASCENT_CAMPAIGN,
  campaignBattleContent,
  claimReward,
  createProfile,
  createRun,
  currentEncounter,
  DECK_RULES,
  DEFAULT_CONTENT,
  encounterFor,
  encounterOrder,
  GameEngine,
  grantCard,
  ownedFor,
  rollReward,
  serializeRun,
  settleVictory,
  validateDeck,
  validateWorlds,
  worldContext,
  worldsView,
  type GameContent,
  type PlayerProfile,
  type RunState,
  type VictoryProof,
  type WorldView,
} from '../src/game';
import { enemyBehavior, enemyPhase } from '../src/game/domain/ai/ai';
import { queryContext } from '../src/game/domain/context';
import { withArcher } from '../src/game/data/archer';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import { guestMayFight } from '../src/game/run/guest-gate';
import { handle } from '../server/src/index';
import { addAccount, memoryD1 } from './support/d1';
import { playBattle } from './support/bot';

const CONTENT = withArcher(DEFAULT_CONTENT);
const order = encounterOrder(ARCHER_HUNT_CAMPAIGN);
const ids = order.map((e) => e.id);
const released = worldContext((flag) => flag === 'ARCHER_CAMPAIGN');
const hidden = worldContext(() => false);
const STARTER = CONTENT.heroes.archer!.deck;

describe('Archer campaign «Sendero del Cazador» — data', () => {
  it('is a valid world of the existing framework: 10 encounters, 2 elites, 1 boss, varied objectives', () => {
    // Production content (every released champion), as the Worker validates it.
    expect(validateWorlds(released, withArcher(withShapeshifterRelease(DEFAULT_CONTENT)))).toEqual([]);
    expect(ids).toHaveLength(10);
    expect(order.filter((e) => e.tier === 'ELITE').map((e) => e.id)).toEqual(['hunt_05_stalker', 'hunt_09_guardian']);
    expect(order.filter((e) => e.tier === 'BOSS').map((e) => e.id)).toEqual(['hunt_10_veil_beast']);
    expect(new Set(order.flatMap((e) => e.objectives.map((o) => o.type)))).toEqual(
      new Set(['ELIMINATE_ALL', 'DEFEAT_TARGET', 'REACH_TILE', 'PROTECT_TARGET', 'SURVIVE_ROUNDS']),
    );
    expect(order.find((e) => e.id === 'hunt_08_two_prey')!.objectives.filter((o) => o.type === 'DEFEAT_TARGET')).toHaveLength(2);
    expect(ARCHER_HUNT_CAMPAIGN.heroIds).toEqual(['archer']);
    expect(ARCHER_ACT_1.completionReward).toMatchObject({ crystals: 250, championCards: { archer: 'predator_eye' } });
  });

  it('is playable with the starter deck: every encounter starts with it, no reward card is required', () => {
    expect(validateDeck(STARTER, 'archer', ownedFor(createProfile(CONTENT), 'archer', CONTENT), CONTENT, DECK_RULES)).toEqual([]);
    const rewardIds = new Set(ARCHER_HUNT_CARDS.map((c) => c.id));
    expect(STARTER.some((e) => rewardIds.has(e.cardId))).toBe(false);
    for (const e of order) {
      const engine = new GameEngine(encounterFor(ARCHER_HUNT_CAMPAIGN, e.id, 'archer'), CONTENT, 1);
      expect(engine.state.units.find((u) => u.kind === 'HERO')?.defId).toBe('archer');
    }
  });

  it('rewards are a fixed progression of exclusive Archer cards, never in random drops', () => {
    expect(order.map((e) => e.rewards.cards?.[0] ?? null)).toEqual([
      'fresh_trail', 'branch_leap', 'ice_arrow', 'hunters_snare', 'pinning_arrow',
      'fire_arrow', 'smoke_arrow', 'poison_arrow', 'rebound_arrow', null,
    ]);
    for (const card of ARCHER_HUNT_CARDS) {
      expect(card.heroId).toBe('archer');
      expect(card.acquisition?.worldId).toBe(ARCHER_ACT_1.id);
    }
    expect(CONTENT.cards.predator_eye).toMatchObject({ rarity: 'RARE', acquisition: { source: 'WORLD_COMPLETION' } });
    // A pool roll (skirmish, other campaigns) never offers them, even with every drop forced.
    const profile = createProfile(CONTENT);
    for (let seed = 0; seed < 50; seed++) {
      const roll = rollReward({ content: CONTENT, heroId: 'archer', owned: ownedFor(profile, 'archer', CONTENT), pity: 4, rules: DECK_RULES, poolId: 'BOSS', seed, count: 3 });
      expect(roll.options.some((o) => o.kind === 'ADD_CARD' && ARCHER_HUNT_CARDS.some((c) => c.id === o.cardId))).toBe(false);
    }
  });

  it('is listed for the Archer only, starts at 0/10 and is hidden while its switch is off', () => {
    const archer = worldsView(released, {}, {}, 'archer');
    expect(archer.map((w) => w.id)).toEqual(['world_1', ARCHER_ACT_1.id]);
    expect(archer[1]).toMatchObject({ status: 'UNLOCKED', unlocked: true, completedEncounters: 0, totalEncounters: 10, currentEncounter: ids[0], actLabel: 'Acto I' });
    expect(worldsView(hidden, {}, {}, 'archer').map(w => w.id)).toEqual(['world_1']);
    for (const heroId of ['mage', 'summoner', 'warrior'])
      expect(worldsView(released, {}, {}, heroId).map((w) => w.id)).toEqual(['world_1']);
  });

  it('guests cannot fight it (server-granted rewards); World 1 guest encounters are unchanged', () => {
    expect(guestMayFight(ARCHER_HUNT_CAMPAIGN, ids[0]!)).toBe(false);
    expect(guestMayFight(ASCENT_CAMPAIGN, encounterOrder(ASCENT_CAMPAIGN)[0]!.id)).toBe(true);
  });

  it('progression: victory offers the authored card once, claiming grants it and unlocks the next encounter', () => {
    let profile: PlayerProfile = createProfile(CONTENT);
    let run = createRun(ARCHER_HUNT_CAMPAIGN, CONTENT, 7, 'archer');
    const won = settleVictory(ARCHER_HUNT_CAMPAIGN, CONTENT, profile, run, ids[0]!, DECK_RULES);
    expect(won.ok).toBe(true);
    if (!won.ok) return;
    expect(won.run.rewardOptions).toEqual([{ id: 'reward-0-fresh_trail', kind: 'ADD_CARD', cardId: 'fresh_trail', rarity: 'COMMON', isNew: true }]);
    // The same victory cannot be settled twice.
    expect(settleVictory(ARCHER_HUNT_CAMPAIGN, CONTENT, profile, won.run, ids[0]!, DECK_RULES).ok).toBe(false);
    const claimed = claimReward(ARCHER_HUNT_CAMPAIGN, CONTENT, profile, won.run, 'reward-0-fresh_trail');
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    ({ profile, run } = claimed);
    expect(ownedFor(profile, 'archer', CONTENT)('fresh_trail')).toBe(1);
    expect(run).toMatchObject({ status: 'IN_BATTLE', currentEncounterId: ids[1], completedEncounterIds: [ids[0]] });
    expect(claimReward(ARCHER_HUNT_CAMPAIGN, CONTENT, profile, run, 'reward-0-fresh_trail').ok).toBe(false);
  });

  it('a capped authored card falls back to the normal pool (replays never grant past the copy limit)', () => {
    let profile = createProfile(CONTENT);
    const granted = grantCard(profile, 'archer', 'pinning_arrow', CONTENT);
    if (granted.ok) profile = granted.profile;
    const run: RunState = { ...createRun(ARCHER_HUNT_CAMPAIGN, CONTENT, 7, 'archer'), currentEncounterId: 'hunt_05_stalker', completedEncounterIds: ids.slice(0, 4) };
    const won = settleVictory(ARCHER_HUNT_CAMPAIGN, CONTENT, profile, run, 'hunt_05_stalker', DECK_RULES);
    expect(won.ok && won.run.rewardOptions.some((o) => o.kind === 'ADD_CARD' && o.cardId === 'pinning_arrow')).toBe(false);
  });

  it('boss phases: La Bestia del Velo switches to «Frenesí» (pursuing melee) at half HP', () => {
    const engine = new GameEngine(encounterFor(ARCHER_HUNT_CAMPAIGN, 'hunt_10_veil_beast', 'archer'), CONTENT, 3);
    const state = structuredClone(engine.state);
    const beast = state.units.find((u) => u.id === 'beast')!;
    const ctx = queryContext(state, CONTENT);
    expect(enemyBehavior(ctx, beast).type).toBe('CHARGE');
    beast.hp = 12;
    expect(enemyPhase(CONTENT.enemies.veil_beast!, beast)?.name).toBe('Frenesí');
    expect(enemyBehavior(ctx, beast).type).toBe('MELEE');
    // Enemies without phases are untouched.
    expect(enemyPhase(CONTENT.enemies.orc_warrior!, { hp: 1, maxHp: 8 })).toBeNull();
  });
});

// ── Worker ─────────────────────────────────────────────────────────────────────────────────
type State = {
  profile: PlayerProfile | null;
  runs: Record<string, RunState | null> | null;
  worldRuns: Record<string, Record<string, RunState | null>> | null;
  worlds: Record<string, { worlds: WorldView[] }> | null;
  archerCampaignAvailable?: boolean;
  error?: { code: string; message: string };
};

let db: ReturnType<typeof memoryD1>;
let archerCampaign: boolean | undefined;
let content: GameContent;
let tx = 0;

/** Test content where every enemy has 1 HP: the greedy bot can win any encounter for a proof. */
const weak = (): GameContent => ({
  ...CONTENT,
  enemies: Object.fromEntries(Object.entries(CONTENT.enemies).map(([id, e]) => [id, { ...e, maxHp: 1, armor: 0 }])),
});

async function call(token: string, method: string, path: string, body?: unknown, env: Record<string, string> = { ARCHER_ENABLED: '1' }) {
  const req = new Request(`https://api.test/api/tactics${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const deps = { content, now: () => 2_000_000, seed: () => 11, archerCampaign, store: { catalog: [], cosmetics: {}, newId: () => `tx-${++tx}` } };
  const res = await handle(req, { DB: db, ...env } as never, deps);
  return { status: res.status, body: (await res.json()) as State };
}

const archerRun = (s: State) => s.worldRuns?.archer_hunt?.archer ?? null;
const view = (s: State) => s.worlds!.archer!.worlds.find((w) => w.id === ARCHER_ACT_1.id);
const crystals = (userId: number) =>
  (db.sql.prepare("SELECT balance FROM tactics_wallets WHERE user_id = ? AND currency_id = 'arcane_crystals'").get(userId) as { balance: number } | undefined)?.balance ?? 0;
const copies = (userId: number, cardId: string) =>
  (db.sql.prepare("SELECT copies FROM tactics_player_cards WHERE user_id = ? AND hero_id = 'archer' AND card_id = ?").get(userId, cardId) as { copies: number } | undefined)?.copies ?? 0;

function winProof(state: State, run: RunState): VictoryProof {
  const encounter = currentEncounter(ARCHER_HUNT_CAMPAIGN, run);
  for (let seed = 1; seed < 60; seed++) {
    const engine = new GameEngine(encounter, campaignBattleContent(content, state.profile!, run, DECK_RULES), seed);
    playBattle(engine, 30, undefined, { archer: true });
    if (engine.state.outcome?.result === 'WON') return { encounterId: encounter.id, seed, commands: JSON.parse(JSON.stringify(engine.history)) };
  }
  throw new Error(`bot could not win ${encounter.id}`);
}

beforeEach(() => {
  db = memoryD1();
  archerCampaign = true;
  content = weak();
});

async function newArcherAccount(name = 'hunter') {
  const account = addAccount(db, name);
  await call(account.token, 'POST', '/profile', {});
  await call(account.token, 'POST', '/champions/start', { heroId: 'mage' });
  return account;
}

describe('Archer campaign — Worker', () => {
  it('switch off: not listed, start refused with the existing message; the Archer stays free elsewhere', async () => {
    archerCampaign = false;
    const { token } = await newArcherAccount();
    const state = await call(token, 'GET', '/state');
    expect(state.body.archerCampaignAvailable).toBe(false);
    expect(state.body.worlds!.archer!.worlds.map(w => w.id)).toEqual(['world_1']);
    const denied = await call(token, 'POST', '/campaign/start', { heroId: 'archer', campaignId: 'archer_hunt' });
    expect(denied.status).toBe(403);
    expect(denied.body.error?.code).toBe('WORLD_LOCKED');
    expect((await call(token, 'PUT', '/champion', { championId: 'archer' })).status).toBe(200);
  });

  it('needs the Archer itself: campaign switch on but ARCHER_ENABLED off is refused', async () => {
    const { token } = await newArcherAccount();
    const denied = await call(token, 'POST', '/campaign/start', { heroId: 'archer', campaignId: 'archer_hunt' }, {});
    expect(denied.body.error?.code).toBe('CHAMPION_LOCKED');
  });

  it('appears at 0/10, starts at I (explicit story campaignId), Ascent runs untouched', async () => {
    const { token } = await newArcherAccount();
    const before = await call(token, 'GET', '/state');
    expect(before.body.archerCampaignAvailable).toBe(true);
    expect(view(before.body)).toMatchObject({ status: 'UNLOCKED', completedEncounters: 0, totalEncounters: 10, actLabel: 'Acto I' });
    expect(before.body.worlds!.mage!.worlds.some((w) => w.id === ARCHER_ACT_1.id)).toBe(false);
    const mage = await call(token, 'POST', '/campaign/start', { heroId: 'mage' });
    const started = await call(token, 'POST', '/campaign/start', { heroId: 'archer', campaignId: 'archer_hunt' });
    expect(started.status).toBe(200);
    expect(archerRun(started.body)).toMatchObject({ campaignId: 'archer_hunt', heroId: 'archer', currentEncounterId: ids[0], completedEncounterIds: [] });
    expect(view(started.body)).toMatchObject({ status: 'IN_PROGRESS', completedEncounters: 0 });
    expect(started.body.runs!.mage).toEqual(mage.body.runs!.mage);
    // Shared main acts are separate from the Archer's story.
    const main = await call(token, 'POST', '/campaign/start', { heroId: 'archer', campaignId: 'ascent' });
    expect(main.status).toBe(200);
    expect(archerRun(main.body)).toEqual(archerRun(started.body));
  });

  it('victory → authored reward → claim once → next encounter; resend and reload are idempotent', async () => {
    const { id, token } = await newArcherAccount();
    const started = await call(token, 'POST', '/campaign/start', { heroId: 'archer', campaignId: 'archer_hunt' });
    const proof = winProof(started.body, archerRun(started.body)!);
    const won = await call(token, 'POST', '/campaign/victory', { heroId: 'archer', campaignId: 'archer_hunt', proof });
    expect(won.status).toBe(200);
    expect(archerRun(won.body)).toMatchObject({ status: 'CHOOSING_REWARD', rewardOptions: [{ kind: 'ADD_CARD', cardId: 'fresh_trail' }] });
    // A lost response resent: same result, no second offer.
    const again = await call(token, 'POST', '/campaign/victory', { heroId: 'archer', campaignId: 'archer_hunt', proof });
    expect(archerRun(again.body)).toEqual(archerRun(won.body));
    const optionId = archerRun(won.body)!.rewardOptions[0]!.id;
    const claim = { heroId: 'archer', campaignId: 'archer_hunt', optionId, encounterId: ids[0] };
    const claimed = await call(token, 'POST', '/campaign/reward', claim);
    expect(claimed.status).toBe(200);
    expect(copies(id, 'fresh_trail')).toBe(1);
    expect((await call(token, 'POST', '/campaign/reward', claim)).status).toBe(200);
    expect(copies(id, 'fresh_trail')).toBe(1);
    // Resume after refresh / reconnect: the server state is the run.
    const reloaded = await call(token, 'GET', '/state');
    expect(archerRun(reloaded.body)).toMatchObject({ status: 'IN_BATTLE', currentEncounterId: ids[1], completedEncounterIds: [ids[0]] });
    expect(view(reloaded.body)).toMatchObject({ completedEncounters: 1, currentEncounter: ids[1] });
    // The reward is in the collection, never equipped.
    expect(JSON.stringify(reloaded.body.profile!.heroes.archer!.decks)).not.toContain('fresh_trail');
  });

  it('boss completion: 10/10, 250 crystals + Ojo del Depredador exactly once (replay pays nothing)', async () => {
    const { id, token } = await newArcherAccount();
    await call(token, 'POST', '/campaign/start', { heroId: 'archer', campaignId: 'archer_hunt' });
    const atBoss: RunState = { ...createRun(ARCHER_HUNT_CAMPAIGN, CONTENT, 11, 'archer'), currentEncounterId: ids[9]!, completedEncounterIds: ids.slice(0, 9) };
    db.sql
      .prepare('UPDATE tactics_hero_campaign_runs SET run_json = ? WHERE user_id = ? AND campaign_id = ? AND hero_id = ?')
      .run(serializeRun(atBoss), id, 'archer_hunt', 'archer');
    const state = await call(token, 'GET', '/state');
    const won = await call(token, 'POST', '/campaign/victory', { heroId: 'archer', campaignId: 'archer_hunt', proof: winProof(state.body, archerRun(state.body)!) });
    expect(won.status).toBe(200);
    expect(archerRun(won.body)).toMatchObject({ status: 'COMPLETED' });
    expect(view(won.body)).toMatchObject({ status: 'COMPLETED', completedEncounters: 10, completionReward: { crystals: 250, granted: true, cardId: 'predator_eye' } });
    expect(crystals(id)).toBe(250);
    expect(copies(id, 'predator_eye')).toBe(1);
    // Replay the act and beat the boss again: no second payout.
    await call(token, 'POST', '/campaign/start', { heroId: 'archer', campaignId: 'archer_hunt' });
    db.sql
      .prepare('UPDATE tactics_hero_campaign_runs SET run_json = ? WHERE user_id = ? AND campaign_id = ? AND hero_id = ?')
      .run(serializeRun({ ...atBoss, seed: 12 }), id, 'archer_hunt', 'archer');
    const replay = await call(token, 'GET', '/state');
    expect(view(replay.body)).toMatchObject({ status: 'COMPLETED', completedEncounters: 10 });
    await call(token, 'POST', '/campaign/victory', { heroId: 'archer', campaignId: 'archer_hunt', proof: winProof(replay.body, archerRun(replay.body)!) });
    expect(crystals(id)).toBe(250);
    expect(copies(id, 'predator_eye')).toBe(1);
  });

  it('special arrows: III Hielo, VI Ígnea, VII Humo, VIII Venenosa, IX Rebote — granted once each, usable in an Archer deck', async () => {
    const { id, token } = await newArcherAccount();
    await call(token, 'POST', '/campaign/start', { heroId: 'archer', campaignId: 'archer_hunt' });
    const put = (run: RunState) =>
      db.sql
        .prepare('UPDATE tactics_hero_campaign_runs SET run_json = ? WHERE user_id = ? AND campaign_id = ? AND hero_id = ?')
        .run(serializeRun(run), id, 'archer_hunt', 'archer');
    for (const [encounterId, cardId] of [['hunt_03_field', 'ice_arrow'], ['hunt_06_gorge', 'fire_arrow'], ['hunt_07_cornered', 'smoke_arrow'], ['hunt_08_two_prey', 'poison_arrow'], ['hunt_09_guardian', 'rebound_arrow']] as const) {
      const at = ids.indexOf(encounterId);
      put({ ...createRun(ARCHER_HUNT_CAMPAIGN, CONTENT, 11, 'archer'), currentEncounterId: encounterId, completedEncounterIds: ids.slice(0, at) });
      const state = await call(token, 'GET', '/state');
      const proof = winProof(state.body, archerRun(state.body)!);
      const won = await call(token, 'POST', '/campaign/victory', { heroId: 'archer', campaignId: 'archer_hunt', proof });
      expect(archerRun(won.body)!.rewardOptions).toEqual([expect.objectContaining({ kind: 'ADD_CARD', cardId })]);
      const claim = { heroId: 'archer', campaignId: 'archer_hunt', optionId: archerRun(won.body)!.rewardOptions[0]!.id, encounterId };
      expect((await call(token, 'POST', '/campaign/reward', claim)).status).toBe(200);
      // Retry and refresh never duplicate.
      await call(token, 'POST', '/campaign/reward', claim);
      await call(token, 'POST', '/campaign/victory', { heroId: 'archer', campaignId: 'archer_hunt', proof });
      expect(copies(id, cardId)).toBe(1);
      const after = await call(token, 'GET', '/state');
      expect(after.body.profile!.heroes.archer!.collection[cardId]?.copies).toBe(1);
      expect(archerRun(after.body)!.currentEncounterId).toBe(ids[at + 1]);
    }
    // All five fit a legal 30-card Archer deck (they replace two Disparos and three neutrals).
    const deck = CONTENT.heroes.archer!.deck.map((e) =>
      e.cardId === 'archer_shot' ? { ...e, count: 1 } : e.cardId === 'shove' ? { ...e, count: 0 } : e.cardId === 'first_aid' ? { ...e, count: 1 } : e,
    ).filter((e) => e.count > 0);
    const withArrows = [...deck, { cardId: 'ice_arrow', count: 1 }, { cardId: 'fire_arrow', count: 1 }, { cardId: 'smoke_arrow', count: 1 }, { cardId: 'poison_arrow', count: 1 }, { cardId: 'rebound_arrow', count: 1 }];
    expect(withArrows.reduce((n, e) => n + e.count, 0)).toBe(30);
    expect((await call(token, 'PUT', '/decks/archer/main', { cards: withArrows })).status).toBe(200);
    // A second Rebote (RARE, 1 copy owned) is refused by the existing deck rules.
    const two = withArrows.map((e) => (e.cardId === 'rebound_arrow' ? { ...e, count: 2 } : e.cardId === 'ice_arrow' ? { ...e, count: 0 } : e)).filter((e) => e.count > 0);
    expect((await call(token, 'PUT', '/decks/archer/main', { cards: two })).status).not.toBe(200);
  });

  it('existing campaigns are unaffected: Mage runs World 1 as before and never sees the Archer act', async () => {
    const { token } = await newArcherAccount();
    const started = await call(token, 'POST', '/campaign/start', { heroId: 'mage' });
    expect(started.body.runs!.mage).toMatchObject({ campaignId: 'ascent', currentEncounterId: encounterOrder(ASCENT_CAMPAIGN)[0]!.id });
    expect(started.body.worlds!.mage!.worlds.map((w) => w.id)).toEqual(['world_1']);
    expect((await call(token, 'POST', '/campaign/start', { heroId: 'mage', campaignId: 'archer_hunt' })).body.error?.code).toBe('UNKNOWN_CAMPAIGN');
  });
});
