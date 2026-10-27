import { beforeEach, describe, expect, it } from 'vitest';
import {
  ARCHER_HUNT_CAMPAIGN,
  ASCENT_CAMPAIGN,
  campaignBattleContent,
  createRun,
  currentEncounter,
  DECK_RULES,
  DEFAULT_CONTENT,
  encounterOrder,
  GameEngine,
  serializeRun,
  type GameContent,
  type PlayerProfile,
  type RunState,
  type VictoryProof,
} from '../src/game';
import { withArcher } from '../src/game/data/archer';
import { masteryLevelXp } from '../src/game/mastery/mastery';
import type { DiscoverRarityView } from '../src/game/collection/free-catalog';
import { handle } from '../server/src/index';
import { addAccount, memoryD1 } from './support/d1';
import { playBattle } from './support/bot';

/**
 * Free catalog on the Worker: grants on every state read, from durable rows only (reward log,
 * world history, runs, mastery XP). Retroactive for existing accounts, idempotent under retries,
 * reloads and concurrent reads, and it never pays crystals, badges or world rewards again.
 */
type State = { profile: PlayerProfile | null; runs: Record<string, RunState | null> | null; error?: { code: string } };

let db: ReturnType<typeof memoryD1>;
let content: GameContent;
let env: Record<string, string | undefined>;
let ids = 0;
const ascent = encounterOrder(ASCENT_CAMPAIGN).map((e) => e.id);
const hunt = encounterOrder(ARCHER_HUNT_CAMPAIGN).map((e) => e.id);

async function call<T = State>(token: string, method: string, path: string, body?: unknown) {
  const req = new Request(`https://api.test/api/tactics${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const deps = { content, now: () => 2_000_000, seed: () => 11, summonerCampaign: true, archerCampaign: true, store: { catalog: [], cosmetics: {}, newId: () => `tx-${++ids}` } };
  const res = await handle(req, { DB: db, ...env } as never, deps);
  return { status: res.status, body: (await res.json()) as T };
}

const copies = (userId: number, heroId: string, cardId: string) =>
  (db.sql.prepare('SELECT copies FROM tactics_player_cards WHERE user_id = ? AND hero_id = ? AND card_id = ?').get(userId, heroId, cardId) as { copies: number } | undefined)?.copies ?? 0;
const crystals = (userId: number) =>
  (db.sql.prepare("SELECT balance FROM tactics_wallets WHERE user_id = ? AND currency_id = 'arcane_crystals'").get(userId) as { balance: number } | undefined)?.balance ?? 0;
const ledgerRows = (userId: number) => (db.sql.prepare('SELECT COUNT(*) AS n FROM tactics_wallet_ledger WHERE user_id = ?').get(userId) as { n: number }).n;
const worldRows = (userId: number) => db.sql.prepare('SELECT hero_id, world_id, reward_granted_at FROM tactics_world_progress WHERE user_id = ? ORDER BY hero_id, world_id').all(userId);

function putRun(userId: number, run: RunState) {
  db.sql
    .prepare(
      `INSERT INTO tactics_hero_campaign_runs (user_id, campaign_id, hero_id, run_json, save_version, updated_at) VALUES (?, ?, ?, ?, 1, 1)
       ON CONFLICT (user_id, campaign_id, hero_id) DO UPDATE SET run_json = excluded.run_json`,
    )
    .run(userId, run.campaignId, run.heroId, serializeRun(run));
}
const completed = (heroId: string, campaign = ASCENT_CAMPAIGN, route = ascent): RunState => ({
  ...createRun(campaign, content, 5, heroId),
  status: 'COMPLETED',
  currentEncounterId: route.at(-1)!,
  completedEncounterIds: [...route],
});
const victoryLog = (userId: number, heroId: string, encounterId: string, campaignId = 'ascent') =>
  db.sql
    .prepare("INSERT INTO tactics_reward_log (user_id, campaign_id, run_seed, encounter_id, pool, event, pity_before, pity_after, created_at, hero_id) VALUES (?, ?, 1, ?, 'NORMAL', 'NO_DROP', 0, 0, 10, ?)")
    .run(userId, campaignId, encounterId, heroId);
const masteryXp = (userId: number, heroId: string, xp: number) =>
  db.sql.prepare("INSERT INTO tactics_mastery_ledger (user_id, hero_id, source, reference_id, xp, day, created_at) VALUES (?, ?, 'QA_FIXTURE', ?, ?, 'qa', 0)").run(userId, heroId, `fx-${++ids}`, xp);

async function account(name = 'ana') {
  const a = addAccount(db, name);
  await call(a.token, 'POST', '/profile', {});
  return a;
}

beforeEach(() => {
  db = memoryD1({ legacyProfiles: true });
  content = DEFAULT_CONTENT;
  env = { FREE_CATALOG_ENABLED: '1', MASTERY_ENABLED: '1' };
});

describe('Worker: free catalog grants', () => {
  it('switch off: no milestone grants anything (cards stay unobtainable)', async () => {
    env = { MASTERY_ENABLED: '1' };
    const { id, token } = await account();
    putRun(id, completed('mage'));
    masteryXp(id, 'mage', masteryLevelXp(7));
    await call(token, 'GET', '/state');
    for (const card of ['arcane_pull', 'elemental_detonation', 'archmage_eruption']) expect(copies(id, 'mage', card)).toBe(0);
  });

  it('RETROACTIVE ACT I: an account that already completed El Ascenso gets the Ultra (+ the Rare) — card only', async () => {
    const { id, token } = await account();
    putRun(id, completed('mage'));
    const balance = crystals(id);
    const ledger = ledgerRows(id);
    const world = worldRows(id);
    const state = await call(token, 'GET', '/state');
    expect(copies(id, 'mage', 'archmage_eruption')).toBe(1);
    expect(copies(id, 'mage', 'arcane_pull')).toBe(1); // a completed world implies IV was won
    expect(state.body.profile!.heroes.mage!.collection.archmage_eruption?.copies).toBe(1);
    // Nothing else: no crystals, no ledger row, no world reward / badge row.
    expect([crystals(id), ledgerRows(id)]).toEqual([balance, ledger]);
    expect(worldRows(id)).toEqual(world);
    // Not equipped automatically: the active deck is untouched.
    expect(state.body.profile!.heroes.mage!.decks[0]!.cards.some((c) => c.cardId === 'archmage_eruption')).toBe(false);
  });

  it('IDEMPOTENCY: reloads, retries and concurrent reads never add a copy', async () => {
    const { id, token } = await account();
    putRun(id, completed('warrior'));
    await Promise.all([call(token, 'GET', '/state'), call(token, 'GET', '/state'), call(token, 'GET', '/state')]);
    await call(token, 'GET', '/state');
    expect([copies(id, 'warrior', 'last_bastion'), copies(id, 'warrior', 'challenge')]).toEqual([1, 1]);
  });

  it('RARE MILESTONE: first clear of IV from the reward log alone (the run was replaced since); a dropped Rare is not duplicated', async () => {
    const { id, token } = await account();
    victoryLog(id, 'mage', 'ascent_04_shield_wall');
    victoryLog(id, 'summoner', 'ascent_04_shield_wall');
    db.sql.prepare("INSERT INTO tactics_player_cards (user_id, hero_id, card_id, copies, acquired, source, unlocked_at) VALUES (?, 'summoner', 'mark_prey', 1, 1, 'CAMPAIGN_REWARD', 1)").run(id);
    await call(token, 'GET', '/state');
    expect(copies(id, 'mage', 'arcane_pull')).toBe(1);
    expect(copies(id, 'summoner', 'mark_prey')).toBe(1);
    expect(copies(id, 'mage', 'archmage_eruption')).toBe(0); // only IV, not Act I
    // III alone is not enough.
    victoryLog(id, 'warrior', 'ascent_03_open_field');
    await call(token, 'GET', '/state');
    expect(copies(id, 'warrior', 'challenge')).toBe(0);
  });

  it('RETROACTIVE MASTERY 7: XP already at 7 grants the Legendary; 6 does not; mastery off waits', async () => {
    const { id, token } = await account();
    masteryXp(id, 'summoner', masteryLevelXp(7));
    masteryXp(id, 'warrior', masteryLevelXp(7) - 1);
    env = { FREE_CATALOG_ENABLED: '1' };
    await call(token, 'GET', '/state');
    expect(copies(id, 'summoner', 'binder_command')).toBe(0);
    env = { FREE_CATALOG_ENABLED: '1', MASTERY_ENABLED: '1' };
    await call(token, 'GET', '/state');
    expect(copies(id, 'summoner', 'binder_command')).toBe(1);
    expect(copies(id, 'warrior', 'bastion_blow')).toBe(0);
    // Mastery itself is untouched (no reset, no extra XP).
    expect((db.sql.prepare("SELECT xp FROM tactics_champion_mastery WHERE user_id = ? AND hero_id = 'summoner'").get(id) as { xp: number }).xp).toBe(masteryLevelXp(7));
  });

  it('ARCHER SENDERO: the Archer’s Act I equivalent grants Lluvia de Flechas (+ Flecha Clavadora from V); El Ascenso does not', async () => {
    content = withArcher(DEFAULT_CONTENT);
    env = { ...env, ARCHER_ENABLED: '1', ARCHER_CAMPAIGN_ENABLED: '1' };
    const { id, token } = await account();
    putRun(id, completed('archer'));
    await call(token, 'GET', '/state');
    expect(copies(id, 'archer', 'arrow_rain')).toBe(0);
    putRun(id, completed('archer', ARCHER_HUNT_CAMPAIGN, hunt));
    await call(token, 'GET', '/state');
    expect([copies(id, 'archer', 'arrow_rain'), copies(id, 'archer', 'pinning_arrow')]).toEqual([1, 1]);
  });

  it('ACT I UNLOCK (live): winning the boss returns the Ultra in the same victory response, and pays exactly what it paid without the catalog', async () => {
    content = { ...DEFAULT_CONTENT, enemies: Object.fromEntries(Object.entries(DEFAULT_CONTENT.enemies).map(([k, e]) => [k, { ...e, maxHp: 1, armor: 0 }])) };
    const bossWin = async (name: string) => {
      const { id, token } = await account(name);
      const run: RunState = { ...createRun(ASCENT_CAMPAIGN, content, 5, 'mage'), currentEncounterId: ascent.at(-1)!, completedEncounterIds: ascent.slice(0, -1) };
      putRun(id, run);
      const state = await call(token, 'GET', '/state');
      const encounter = currentEncounter(ASCENT_CAMPAIGN, run);
      let proof: VictoryProof | null = null;
      for (let seed = 1; seed < 80 && !proof; seed++) {
        const engine = new GameEngine(encounter, campaignBattleContent(content, state.body.profile!, run, DECK_RULES), seed);
        playBattle(engine, 30);
        if (engine.state.outcome?.result === 'WON') proof = { encounterId: encounter.id, seed, commands: JSON.parse(JSON.stringify(engine.history)) };
      }
      const before = crystals(id);
      const ultraBefore = copies(id, 'mage', 'archmage_eruption');
      const won = await call(token, 'POST', '/campaign/victory', { heroId: 'mage', proof });
      expect(won.status).toBe(200);
      return { id, token, proof, ultraBefore, won, paid: crystals(id) - before };
    };
    env = { MASTERY_ENABLED: '1' };
    const control = await bossWin('control');
    env = { FREE_CATALOG_ENABLED: '1', MASTERY_ENABLED: '1' };
    const live = await bossWin('live');
    expect(copies(live.id, 'mage', 'arcane_pull')).toBe(1); // IV was already cleared
    expect(live.ultraBefore).toBe(0);
    expect(live.won.body.profile!.heroes.mage!.collection.archmage_eruption?.copies).toBe(1);
    expect(control.won.body.profile!.heroes.mage!.collection.archmage_eruption?.copies ?? 0).toBe(0);
    // Same crystals as the same victory without the catalog: the Ultra adds no economy.
    expect(live.paid).toBe(control.paid);
    // Replaying the same victory (lost response) changes nothing.
    await call(live.token, 'POST', '/campaign/victory', { heroId: 'mage', proof: live.proof });
    expect(copies(live.id, 'mage', 'archmage_eruption')).toBe(1);
  });

  it('EXISTING ACCOUNT MIGRATION: saved decks and other cards are untouched; the view lists all 4 rarities', async () => {
    const { id, token } = await account();
    const before = db.sql.prepare('SELECT * FROM tactics_deck_cards WHERE user_id = ? ORDER BY hero_id, deck_id, card_id').all(id);
    const view = await call<{ released: boolean; champions: Record<string, DiscoverRarityView[]> }>(token, 'GET', '/free-catalog');
    expect(db.sql.prepare('SELECT * FROM tactics_deck_cards WHERE user_id = ? ORDER BY hero_id, deck_id, card_id').all(id)).toEqual(before);
    expect(view.body.released).toBe(true);
    const rows = view.body.champions.mage!;
    expect(rows.map((r) => [r.tier, r.owned])).toEqual([['COMMON', true], ['RARE', false], ['LEGENDARY', false], ['ULTRA', false]]);
    expect(rows[3]!.rulesText).toContain('Única');
  });
});
