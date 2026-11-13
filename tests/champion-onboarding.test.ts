import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ASCENT_CAMPAIGN,
  asNewPlayer,
  campaignBattleContent,
  chooseStartingChampion,
  claimChampionUnlock,
  createProfile,
  createRun,
  currentEncounter,
  DECK_RULES,
  DEFAULT_CONTENT,
  encounterOrder,
  GameEngine,
  guestGateReached,
  guestMayFight,
  isChampionUnlocked,
  needsStartingChampion,
  parseProfileSave,
  pendingChampionUnlock,
  recordCampaignBest,
  serializeProfile,
  serializeRun,
  starterDeck,
  unlockRequirement,
  type PlayerProfile,
  type RunState,
  type VictoryProof,
} from '../src/game';
import { handle } from '../server/src/index';
import { sanitizeLocalImport } from '../server/src/importLocal';
import { createPlayer } from '../server/src/repo';
import { playBattle } from './support/bot';
import { addAccount, memoryD1 } from './support/d1';

const ALL = ['mage', 'summoner', 'warrior'];
const NO_WARRIOR = ['mage', 'summoner'];
const order = encounterOrder(ASCENT_CAMPAIGN).map((e) => e.id);
const fresh = () => asNewPlayer(createProfile(DEFAULT_CONTENT));
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};
/** A guest/local run of `heroId` that completed the first `done` encounters. */
const runAt = (heroId: string, done: number): RunState => ({
  ...createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 1, heroId),
  currentEncounterId: order[done]!,
  completedEncounterIds: order.slice(0, done),
});

describe('champion unlock rules (core)', () => {
  it('a new profile chooses exactly one starting champion; it is selected and persists', () => {
    for (const heroId of ALL) {
      const profile = fresh();
      expect(needsStartingChampion(profile)).toBe(true);
      expect(ALL.filter((id) => isChampionUnlocked(profile, id))).toEqual([]);
      const chosen = ok(chooseStartingChampion(profile, heroId, ALL)).profile;
      expect(chosen.selectedChampionId).toBe(heroId);
      expect(ALL.filter((id) => isChampionUnlocked(chosen, id))).toEqual([heroId]);
      const reloaded = parseProfileSave(serializeProfile(chosen), DEFAULT_CONTENT);
      expect(reloaded.status === 'OK' && reloaded.profile.champions).toEqual(chosen.champions);
      expect(reloaded.status === 'OK' && needsStartingChampion(reloaded.profile)).toBe(false);
    }
  });

  it('the same choice twice is a no-op; a second, different choice is refused', () => {
    const chosen = ok(chooseStartingChampion(fresh(), 'mage', ALL));
    const again = ok(chooseStartingChampion(chosen.profile, 'mage', ALL));
    expect(again.unlock).toBeNull();
    expect(again.profile).toBe(chosen.profile);
    expect(chooseStartingChampion(chosen.profile, 'summoner', ALL)).toEqual({ ok: false, error: 'ALREADY_CHOSEN' });
  });

  it('only released champions can be chosen (QA-only Warrior stays hidden)', () => {
    expect(chooseStartingChampion(fresh(), 'warrior', NO_WARRIOR)).toEqual({ ok: false, error: 'NOT_AVAILABLE' });
    expect(chooseStartingChampion(fresh(), 'paladin', ALL)).toEqual({ ok: false, error: 'NOT_AVAILABLE' });
    expect(ok(chooseStartingChampion(fresh(), 'warrior', ALL)).profile.selectedChampionId).toBe('warrior');
  });

  it('legacy profiles (no unlock state) keep every champion and never see onboarding', () => {
    const legacy = createProfile(DEFAULT_CONTENT);
    expect(needsStartingChampion(legacy)).toBe(false);
    expect(NO_WARRIOR.every((id) => isChampionUnlocked(legacy, id))).toBe(true);
    expect(isChampionUnlocked(legacy, 'warrior')).toBe(false);
    expect(pendingChampionUnlock(legacy, ALL)).toBeNull();
    expect(chooseStartingChampion(legacy, 'mage', ALL)).toEqual({ ok: false, error: 'LEGACY_PROFILE' });
    // Old saves without the field load as legacy.
    const loaded = parseProfileSave(JSON.stringify({ version: 1, profile: { heroes: {}, selectedChampionId: 'summoner' } }), DEFAULT_CONTENT);
    expect(loaded.status === 'OK' && loaded.profile.champions).toBeUndefined();
  });

  it('encounter III → choose 1 of 2; encounter VI → the last one; claims are idempotent, never repeatable', () => {
    let p = ok(chooseStartingChampion(fresh(), 'mage', ALL)).profile;
    expect(pendingChampionUnlock(p, ALL)).toBeNull();
    expect(claimChampionUnlock(p, 'summoner', ALL)).toEqual({ ok: false, error: 'NO_UNLOCK_PENDING' });
    p = recordCampaignBest(p, 2);
    expect(pendingChampionUnlock(p, ALL)).toBeNull();
    expect(unlockRequirement(p, 'warrior', ALL)).toEqual({ milestone: 'ASCENT_3', encounters: 3, choice: true, ready: false });
    p = recordCampaignBest(p, 3);
    expect(pendingChampionUnlock(p, ALL)).toEqual({ milestone: 'ASCENT_3', kind: 'CHOICE', options: ['summoner', 'warrior'] });
    const claimed = ok(claimChampionUnlock(p, 'warrior', ALL));
    expect(claimed.unlock).toEqual({ heroId: 'warrior', milestone: 'ASCENT_3' });
    p = claimed.profile;
    expect(ok(claimChampionUnlock(p, 'warrior', ALL)).profile).toBe(p); // retry: no change
    expect(claimChampionUnlock(p, 'summoner', ALL)).toEqual({ ok: false, error: 'NO_UNLOCK_PENDING' });
    expect(unlockRequirement(p, 'summoner', ALL)).toEqual({ milestone: 'ASCENT_6', encounters: 6, choice: false, ready: false });
    p = recordCampaignBest(p, 6);
    expect(pendingChampionUnlock(p, ALL)).toEqual({ milestone: 'ASCENT_6', kind: 'REVEAL', options: ['summoner'] });
    p = ok(claimChampionUnlock(p, 'summoner', ALL)).profile;
    expect(ALL.every((id) => isChampionUnlocked(p, id))).toBe(true);
    expect(pendingChampionUnlock(p, ALL)).toBeNull();
    expect(p.champions!.unlocks.map((u) => u.milestone)).toEqual(['START', 'ASCENT_3', 'ASCENT_6']);
  });

  it('the best progress never decreases (a new campaign keeps the milestones)', () => {
    let p = ok(chooseStartingChampion(fresh(), 'mage', ALL)).profile;
    p = recordCampaignBest(p, 3);
    expect(recordCampaignBest(p, 0)).toBe(p);
    expect(p.champions!.campaignBest).toBe(3);
  });

  it('a champion released later is reached through the same milestones', () => {
    let p = ok(chooseStartingChampion(fresh(), 'mage', NO_WARRIOR)).profile;
    p = recordCampaignBest(p, 3);
    // Only one champion left to pick: it is revealed, not chosen.
    expect(pendingChampionUnlock(p, NO_WARRIOR)).toEqual({ milestone: 'ASCENT_3', kind: 'REVEAL', options: ['summoner'] });
    p = ok(claimChampionUnlock(p, 'summoner', NO_WARRIOR)).profile;
    p = recordCampaignBest(p, 6);
    expect(pendingChampionUnlock(p, NO_WARRIOR)).toBeNull();
    expect(pendingChampionUnlock(p, ALL)).toEqual({ milestone: 'ASCENT_6', kind: 'REVEAL', options: ['warrior'] });
  });

  it('malformed unlock data is never read as "everything unlocked"', () => {
    const save = JSON.parse(serializeProfile(fresh()));
    save.profile.champions = { mode: 'PROGRESSION', unlocks: 'all' };
    expect(parseProfileSave(JSON.stringify(save), DEFAULT_CONTENT).status).toBe('INVALID');
  });

  it('guests fight encounters I–III only; the gate is reached after III', () => {
    expect(order.map((id) => guestMayFight(ASCENT_CAMPAIGN, id))).toEqual([true, true, true, false, false, false, false, false, false, false]);
    expect(guestGateReached(ASCENT_CAMPAIGN, runAt('mage', 2))).toBe(false);
    expect(guestGateReached(ASCENT_CAMPAIGN, { ...runAt('mage', 3), status: 'IN_BATTLE' })).toBe(true);
    expect(guestGateReached(ASCENT_CAMPAIGN, runAt('mage', 7))).toBe(true);
    expect(guestGateReached(ASCENT_CAMPAIGN, null)).toBe(false);
  });
});

// ── Server ────────────────────────────────────────────────────────────────────────────────
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let db: ReturnType<typeof memoryD1>;
let env: Record<string, unknown> = {};
const deps = { content: DEFAULT_CONTENT, now: () => 1_000_000, seed: () => 7, summonerCampaign: true };
async function call(token: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; body: Body }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await handle(
    new Request(`https://api.test/api/tactics${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    { DB: db, ...env },
    deps,
  );
  return { status: res.status, body: (await res.json()) as Body };
}
function winProof(state: Body, heroId: string): VictoryProof {
  const run = state.runs[heroId] as RunState;
  const encounter = currentEncounter(ASCENT_CAMPAIGN, run);
  for (let seed = 1; seed < 80; seed++) {
    const engine = new GameEngine(encounter, campaignBattleContent(DEFAULT_CONTENT, state.profile as PlayerProfile, run, DECK_RULES), seed);
    playBattle(engine);
    if (engine.state.outcome?.result === 'WON') return { encounterId: encounter.id, seed, commands: JSON.parse(JSON.stringify(engine.history)) };
  }
  throw new Error('bot could not win');
}
/** Wins the champion's current encounter through the real endpoints and claims the first offer. */
async function winEncounter(token: string, heroId: string): Promise<Body> {
  let state = (await call(token, 'GET', '/state')).body;
  state = (await call(token, 'POST', '/campaign/victory', { heroId, proof: winProof(state, heroId) })).body;
  const run = state.runs[heroId] as RunState;
  if (run.status === 'CHOOSING_REWARD')
    state = (await call(token, 'POST', '/campaign/reward', { heroId, optionId: run.rewardOptions[0]!.id, encounterId: run.currentEncounterId })).body;
  return state;
}

describe('server: champion onboarding and unlocks', () => {
  beforeEach(() => {
    db = memoryD1();
    env = {};
  });

  it('a new account starts in onboarding: nothing playable until the first choice', async () => {
    const { token } = addAccount(db, 'nueva');
    const created = await call(token, 'POST', '/profile', {});
    expect(created.body.profile.champions).toEqual({ mode: 'PROGRESSION', startingChampionId: null, unlocks: [], campaignBest: 0 });
    expect(created.body.championsAvailable).toEqual(NO_WARRIOR); // Warrior flag off
    expect((await call(token, 'POST', '/campaign/start', { heroId: 'mage' })).body.error.code).toBe('CHAMPION_LOCKED');
    expect((await call(token, 'PUT', '/champion', { championId: 'summoner' })).status).toBe(403);
    expect((await call(token, 'PUT', '/decks/mage/main', { cards: starterDeck(DEFAULT_CONTENT.heroes.mage!) })).status).toBe(403);
    expect((await call(token, 'POST', '/skirmish/start', { heroId: 'summoner', scenarioId: 'first_blood' })).status).toBe(403);
    env = { PVP_ROOMS: {} };
    expect((await call(token, 'POST', '/pvp/join', { code: 'ABCDEFGH', heroId: 'mage' })).status).toBe(403);
  });

  it('first choice: persists, repeat is idempotent, a second champion or a hidden one is refused', async () => {
    const { token } = addAccount(db, 'nueva');
    await call(token, 'POST', '/profile', {});
    expect((await call(token, 'POST', '/champions/start', { heroId: 'warrior' })).status).toBe(403); // QA-only
    const chosen = await call(token, 'POST', '/champions/start', { heroId: 'summoner' });
    expect(chosen.status).toBe(200);
    expect(chosen.body.profile.selectedChampionId).toBe('summoner');
    expect(chosen.body.profile.champions).toMatchObject({ startingChampionId: 'summoner', unlocks: [{ heroId: 'summoner', milestone: 'START' }] });
    expect((await call(token, 'POST', '/champions/start', { heroId: 'summoner' })).status).toBe(200);
    const second = await call(token, 'POST', '/champions/start', { heroId: 'mage' });
    expect([second.status, second.body.error.code]).toEqual([409, 'ALREADY_CHOSEN']);
    const reload = await call(token, 'GET', '/state');
    expect(reload.body.profile.champions.unlocks).toEqual([{ heroId: 'summoner', milestone: 'START' }]);
    expect((await call(token, 'POST', '/campaign/start', { heroId: 'summoner' })).status).toBe(200);
    expect((await call(token, 'POST', '/campaign/start', { heroId: 'mage' })).status).toBe(403);
  });

  it('two concurrent different first choices unlock only one champion', async () => {
    const { token } = addAccount(db, 'nueva');
    await call(token, 'POST', '/profile', {});
    const results = await Promise.all([
      call(token, 'POST', '/champions/start', { heroId: 'mage' }),
      call(token, 'POST', '/champions/start', { heroId: 'summoner' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const unlocks = (await call(token, 'GET', '/state')).body.profile.champions.unlocks;
    expect(unlocks).toHaveLength(1);
    // The database itself refuses a second START row.
    expect(() =>
      db.sql.prepare("INSERT INTO tactics_champion_unlocks (user_id, hero_id, milestone, unlocked_at) VALUES (1, 'warrior', 'START', 0)").run(),
    ).toThrow();
  });

  it('three verified wins unlock a choice (account-wide); the new champion starts at 0/10; encounter VI unlocks the last', async () => {
    const { id, token } = addAccount(db, 'nueva');
    env = { WARRIOR_ENABLED: '1' };
    await call(token, 'POST', '/profile', {});
    await call(token, 'POST', '/champions/start', { heroId: 'mage' });
    await call(token, 'POST', '/campaign/start', { heroId: 'mage' });
    expect((await call(token, 'POST', '/champions/unlock', { heroId: 'summoner' })).body.error.code).toBe('NO_UNLOCK_PENDING');
    let state: Body = {};
    for (let i = 0; i < 3; i++) state = await winEncounter(token, 'mage');
    expect(state.runs.mage.completedEncounterIds).toHaveLength(3);
    expect(state.profile.champions.campaignBest).toBe(3);
    const forged = await call(token, 'POST', '/champions/unlock', { heroId: 'paladin' });
    expect(forged.status).toBe(422);
    const unlocked = await call(token, 'POST', '/champions/unlock', { heroId: 'warrior' });
    expect(unlocked.status).toBe(200);
    expect(unlocked.body.profile.champions.unlocks.at(-1)).toEqual({ heroId: 'warrior', milestone: 'ASCENT_3' });
    expect((await call(token, 'POST', '/champions/unlock', { heroId: 'warrior' })).status).toBe(200); // idempotent retry
    expect((await call(token, 'POST', '/champions/unlock', { heroId: 'summoner' })).body.error.code).toBe('NO_UNLOCK_PENDING');
    // Independent runs: Mage 3/10, Warrior starts at 0/10, Summoner still locked.
    const warrior = await call(token, 'POST', '/campaign/start', { heroId: 'warrior' });
    expect(warrior.body.runs.warrior.completedEncounterIds).toEqual([]);
    expect(warrior.body.runs.mage.completedEncounterIds).toHaveLength(3);
    expect((await call(token, 'POST', '/campaign/start', { heroId: 'summoner' })).status).toBe(403);
    // A new Mage campaign never takes the milestone back.
    await call(token, 'POST', '/campaign/start', { heroId: 'mage' });
    expect((await call(token, 'GET', '/state')).body.profile.champions.campaignBest).toBe(3);
    // Encounter VI (progress simulated in the database) reveals the remaining champion.
    db.sql.prepare('UPDATE tactics_profiles SET campaign_best = 6 WHERE user_id = ?').run(id);
    const last = await call(token, 'POST', '/champions/unlock', { heroId: 'summoner' });
    expect(last.body.profile.champions.unlocks.map((u: Body) => u.heroId)).toEqual(['mage', 'warrior', 'summoner']);
  });

  it('unauthenticated campaign continuation is rejected', async () => {
    expect((await call(null, 'POST', '/campaign/start', { heroId: 'mage' })).status).toBe(401);
    expect((await call(null, 'POST', '/champions/start', { heroId: 'mage' })).status).toBe(401);
  });
});

describe('server: legacy accounts and migration 0012', () => {
  it('existing rows become LEGACY: no onboarding, every champion, progress/decks/cards untouched', async () => {
    // A database as production had it before 0012, with a player created by the old Worker.
    const sql = new DatabaseSync(':memory:');
    sql.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at INTEGER NOT NULL, recovery_code_hash TEXT, recovery_code_salt TEXT);
      CREATE TABLE sessions (token TEXT PRIMARY KEY, username TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);`);
    const migrate = (file: string) => sql.exec(readFileSync(new URL(`../server/migrations/${file}`, import.meta.url), 'utf8'));
    for (const f of ['0001_tactics_player_data.sql', '0002_tactics_card_progression.sql', '0003_tactics_skirmishes.sql', '0007_tactics_store_economy.sql', '0008_tactics_cosmetic_equip.sql', '0011_tactics_campaign_runs_per_hero.sql']) migrate(f);
    sql.exec("INSERT INTO users (username, password_hash, salt, created_at) VALUES ('veterana', 'h', 's', 0)");
    sql.exec("INSERT INTO sessions VALUES ('token-veterana', 'veterana', 0, 4000000000000)");
    sql.exec("INSERT INTO tactics_profiles (user_id, display_name, selected_champion_id, save_version, created_at, updated_at) VALUES (1, 'veterana', 'summoner', 1, 0, 0)");
    sql.exec("INSERT INTO tactics_player_cards VALUES (1, 'mage', 'frost_nova', 2, 1, 'NORMAL_DROP', 0)");
    const run = runAt('mage', 5);
    sql.prepare("INSERT INTO tactics_hero_campaign_runs VALUES (1, 'ascent', 'mage', ?, 1, 0)").run(serializeRun(run));
    const before = sql.prepare('SELECT * FROM tactics_player_cards ORDER BY card_id').all();
    migrate('0012_tactics_champion_unlocks.sql');
    expect(sql.prepare('SELECT champion_mode, starting_champion_id, campaign_best FROM tactics_profiles').get()).toEqual({
      champion_mode: 'LEGACY',
      starting_champion_id: null,
      campaign_best: 0,
    });
    expect(sql.prepare('SELECT * FROM tactics_player_cards ORDER BY card_id').all()).toEqual(before);
    // The current Worker reads deck columns added by 0028 (multi-deck; it also alters 0023's queue).
    for (const f of ['0023_tactics_ranked_preseason.sql', '0028_tactics_multi_deck.sql', '0029_tactics_collection_claim_revision.sql']) migrate(f);

    const d1 = memoryD1();
    const wrapped = { ...d1, prepare: (q: string) => wrap(sql, q), batch: d1.batch };
    const res = await handle(new Request('https://api.test/api/tactics/state', { headers: { Authorization: 'Bearer token-veterana' } }), { DB: wrapped }, deps);
    const state = (await res.json()) as Body;
    expect(state.profile.champions).toMatchObject({ mode: 'LEGACY', campaignBest: 5 }); // retroactive Warrior milestone
    expect(state.profile.selectedChampionId).toBe('summoner');
    expect(state.runs.mage.completedEncounterIds).toEqual(order.slice(0, 5));
    expect(state.profile.heroes.mage.collection.frost_nova.copies).toBe(2);
  });

  for (const best of [0, 2, 3, 5, 6, 7]) {
    it(`legacy best ${best}: Warrior retroactive VI, persisted across campaign reset`, async () => {
      db = memoryD1(); env = { WARRIOR_ENABLED: '1' };
      const { id, token } = addAccount(db, `legacy_${best}`);
      const original = createProfile(DEFAULT_CONTENT);
      await createPlayer(db, id, `legacy_${best}`, original, [runAt('mage', best)], { source: 'STARTER', importedAt: null, now: 0 });
      const state = (await call(token, 'GET', '/state')).body;
      expect(state.profile.champions).toMatchObject({ mode: 'LEGACY', campaignBest: best });
      expect(needsStartingChampion(state.profile)).toBe(false);
      expect(isChampionUnlocked(state.profile, 'mage')).toBe(true);
      expect(isChampionUnlocked(state.profile, 'summoner')).toBe(true);
      expect(isChampionUnlocked(state.profile, 'warrior')).toBe(best >= 6);
      for (const [heroId, originalHero] of Object.entries(original.heroes)) {
        const actual = state.profile.heroes[heroId];
        expect(actual.collection).toEqual(originalHero.collection);
        expect(actual.activeDeckId).toBe(originalHero.activeDeckId);
        expect(actual.rewardPity).toBe(originalHero.rewardPity);
        expect(actual.decks[0].cards).toEqual([...originalHero.decks[0]!.cards].sort((a,b) => a.cardId.localeCompare(b.cardId)));
      }
      if (best < 6) expect(unlockRequirement(state.profile, 'warrior', ALL)).toMatchObject({encounters: 6, choice: false});
      expect((await call(token, 'POST', '/campaign/start', {heroId: 'warrior'})).status).toBe(best >= 6 ? 200 : 403);
      expect((await call(token, 'PUT', '/champion', {championId: 'warrior'})).status).toBe(best >= 6 ? 200 : 403);
      expect((await call(token, 'PUT', '/decks/warrior/main', {cards: starterDeck(DEFAULT_CONTENT.heroes.warrior!)})).status).toBe(best >= 6 ? 200 : 403);
      if (best < 6) {
        // Reward-tracked skirmishes currently belong to Summoner only; Warrior uses normal local skirmish.
        expect((await call(token, 'POST', '/skirmish/start', {heroId: 'warrior', scenarioId: 'first_blood'})).status).toBe(422);
        env = { WARRIOR_ENABLED: '1', PVP_ROOMS: {} };
        expect((await call(token, 'POST', '/pvp/join', {heroId: 'warrior', code: 'ABCDEFGH'})).status).toBe(403);
      }
      await call(token, 'POST', '/campaign/start', {heroId: 'mage'});
      expect((await call(token, 'GET', '/state')).body.profile.champions.campaignBest).toBe(best);
    });
  }

  it('a legacy account keeps using every released champion in every mode', async () => {
    db = memoryD1();
    env = {};
    const { id, token } = addAccount(db, 'veterana');
    await createPlayer(db, id, 'veterana', createProfile(DEFAULT_CONTENT), [runAt('mage', 4)], { source: 'STARTER', importedAt: null, now: 0 });
    expect((await call(token, 'PUT', '/champion', { championId: 'summoner' })).status).toBe(200);
    expect((await call(token, 'POST', '/campaign/start', { heroId: 'summoner' })).status).toBe(200);
    expect((await call(token, 'POST', '/champions/start', { heroId: 'mage' })).body.error.code).toBe('LEGACY_PROFILE');
    const state = (await call(token, 'GET', '/state')).body;
    expect(state.profile.champions).toMatchObject({ mode: 'LEGACY', campaignBest: 4 });
    expect(state.runs.mage.completedEncounterIds).toHaveLength(4);
  });
});

/** Runs statements of a hand-built pre-0012 database through the D1 interface. */
function wrap(sql: DatabaseSync, query: string, values: unknown[] = []): ReturnType<ReturnType<typeof memoryD1>['prepare']> {
  type V = Parameters<ReturnType<DatabaseSync['prepare']>['get']>;
  return {
    bind: (...next: unknown[]) => wrap(sql, query, next),
    first: async <T,>() => (sql.prepare(query).get(...(values as V)) as T | undefined) ?? null,
    all: async <T,>() => ({ results: sql.prepare(query).all(...(values as V)) as T[] }),
    run: async () => sql.prepare(query).run(...(values as V)),
  };
}

describe('server: guest import keeps (and re-validates) champion progress', () => {
  const save = (profile: PlayerProfile) => serializeProfile(profile);

  it('a guest that chose a champion and finished encounter III keeps it all, Encounter IV ready', () => {
    let profile = ok(chooseStartingChampion(fresh(), 'summoner', ALL)).profile;
    profile = ok(claimChampionUnlock(recordCampaignBest(profile, 3), 'mage', ALL)).profile;
    const imported = sanitizeLocalImport(save(profile), { summoner: serializeRun(runAt('summoner', 3)) }, DEFAULT_CONTENT, DECK_RULES, NO_WARRIOR);
    expect(imported.profile.champions).toEqual(profile.champions);
    expect(imported.runs.map((r) => [r.heroId, r.currentEncounterId])).toEqual([['summoner', order[3]]]);
  });

  it('pre-unlock guest saves import as legacy (backfill policy)', () => {
    const imported = sanitizeLocalImport(save(createProfile(DEFAULT_CONTENT)), { mage: serializeRun(runAt('mage', 6)) }, DEFAULT_CONTENT, DECK_RULES, NO_WARRIOR);
    expect(imported.profile.champions).toBeUndefined();
    expect(imported.runs[0]!.completedEncounterIds).toHaveLength(6);
  });

  it('forged unlocks or progress past the guest limit are dropped, never granted', () => {
    const chosen = ok(chooseStartingChampion(fresh(), 'mage', ALL)).profile;
    const forged: PlayerProfile = {
      ...chosen,
      selectedChampionId: 'warrior',
      champions: {
        ...chosen.champions!,
        campaignBest: 10,
        unlocks: [...chosen.champions!.unlocks, { heroId: 'summoner', milestone: 'ASCENT_3' }, { heroId: 'warrior', milestone: 'ASCENT_6' }],
      },
    };
    const imported = sanitizeLocalImport(
      save(forged),
      { mage: serializeRun(runAt('mage', 7)), warrior: serializeRun(runAt('warrior', 1)) },
      DEFAULT_CONTENT,
      DECK_RULES,
      ALL,
    );
    expect(imported.profile.champions!.campaignBest).toBe(3);
    expect(imported.profile.champions!.unlocks.map((u) => u.heroId)).toEqual(['mage', 'summoner']);
    expect(imported.profile.selectedChampionId).toBe('mage');
    expect(imported.runs).toEqual([]); // Mage run past III and the locked Warrior's run dropped
    expect(imported.notes.join('\n')).toMatch(/warrior/);
  });
});

// ── Client store (guest) ──────────────────────────────────────────────────────────────────
function memoryStorage() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}
const AUTH = 'https://auth.test';
const API = 'https://api.test';
async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (url === `${AUTH}/api/register`) {
    const { username } = JSON.parse(String(init!.body)) as { username: string };
    const { token } = addAccount(db, username);
    return Response.json({ token, username, recoveryCode: 'TEST-TEST-TEST-TEST-TEST' });
  }
  if (url === `${AUTH}/api/login`) {
    const { username } = JSON.parse(String(init!.body)) as { username: string };
    return Response.json({ token: `token-${username}`, username });
  }
  if (url.startsWith(API)) return handle(new Request(url, init), { DB: db }, deps);
  return new Response('not found', { status: 404 });
}
async function boot(storage: ReturnType<typeof memoryStorage>) {
  vi.resetModules();
  vi.stubGlobal('window', { localStorage: storage });
  const { useBattleStore } = await import('../src/presentation/store/battleStore');
  useBattleStore.subscribe((s) => {
    if (s.introLocked) s.introBeat('unlock');
  });
  await Promise.resolve();
  return useBattleStore;
}
type Store = Awaited<ReturnType<typeof boot>>;
const idle = (store: Store) => vi.waitFor(() => expect(store.getState().cloud.busy).toBeNull());

describe('client store: onboarding, locks and the guest limit', () => {
  beforeEach(() => {
    db = memoryD1();
    env = {};
    // The real rules (the test config opens progression for other suites).
    vi.stubEnv('VITE_OPEN_PROGRESSION', '');
    vi.stubEnv('VITE_SUMMONER_CAMPAIGN', '1');
    vi.stubEnv('VITE_AUTH_API_URL', AUTH);
    vi.stubEnv('VITE_TACTICS_API_URL', API);
    vi.stubGlobal('fetch', fakeFetch);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('new guest: choose → persists → reload does not ask again; locked champions cannot be forced', async () => {
    const device = memoryStorage();
    let store = await boot(device);
    expect(store.getState().account.status).toBe('GUEST');
    expect(needsStartingChampion(store.getState().profile)).toBe(true);
    expect(await store.getState().startRun()).toBe(false);
    expect(await store.getState().startScenario('first_blood', undefined, 'mage')).toBe(false);
    expect(await store.getState().chooseStartingChampion('warrior')).toBe(false); // not released to guests
    expect(await store.getState().chooseStartingChampion('summoner')).toBe(true);
    expect(store.getState().campaignHeroId).toBe('summoner');
    expect(await store.getState().chooseStartingChampion('mage')).toBe(false);

    store = await boot(device); // reload
    expect(needsStartingChampion(store.getState().profile)).toBe(false);
    expect(store.getState().campaignHeroId).toBe('summoner');
    store.getState().selectChampion('mage');
    expect(store.getState().profile.selectedChampionId).toBe('summoner');
    store.getState().selectCampaignHero('mage');
    expect(store.getState().campaignHeroId).toBe('summoner');
    expect(await store.getState().startScenario('first_blood', undefined, 'mage')).toBe(false);
    expect((await store.getState().saveDeck('mage', starterDeck(DEFAULT_CONTENT.heroes.mage!))).ok).toBe(false);
    store.getState().openDeckBuilder('mage');
    expect(store.getState().screen).toBe('MENU');
    expect(await store.getState().startRun()).toBe(true);
    expect(store.getState().engine!.scenario.hero.heroId).toBe('summoner');
  });

  it('encounters I–III play; IV is blocked by every path (continue twice, QA jump, crafted save)', async () => {
    const device = memoryStorage();
    let profile = ok(chooseStartingChampion(fresh(), 'mage', NO_WARRIOR)).profile;
    profile = recordCampaignBest(profile, 2);
    device.setItem('rpg-go-tactics:profile', serializeProfile(profile));
    device.setItem('rpg-go-tactics:campaign:hero:mage', serializeRun(runAt('mage', 2)));
    let store = await boot(device);
    store.getState().continueRun();
    expect(store.getState().engine!.scenario.id).toBe(order[2]); // encounter III plays
    // Win it (the greedy bot plays through the store's engine) → reward → the run waits at IV.
    for (let attempt = 0; attempt < 12 && store.getState().state!.outcome?.result !== 'WON'; attempt++) {
      if (attempt) store.getState().restart();
      playBattle(store.getState().engine!);
    }
    expect(store.getState().run!.completedEncounterIds).toHaveLength(3);
    const run = store.getState().run!;
    if (run.status === 'CHOOSING_REWARD') store.getState().chooseReward(run.rewardOptions[0]!.id);
    expect(store.getState().run!.currentEncounterId).toBe(order[3]);
    expect(store.getState().profile.champions!.campaignBest).toBe(3);

    const before = store.getState().engine;
    store.getState().continueRun();
    store.getState().continueRun();
    expect(store.getState().guestGate).toBe(true);
    expect(store.getState().engine).toBe(before); // still the encounter III battle, no IV
    store.getState().closeGuestGate();
    store.getState().backToMenu();
    expect(await store.getState().startRun(1, order[3])).toBe(false);
    expect(JSON.parse(device.data.get('rpg-go-tactics:campaign:hero:mage')!).run.currentEncounterId).toBe(order[3]);

    device.setItem('rpg-go-tactics:campaign:hero:mage', serializeRun(runAt('mage', 7))); // crafted
    store = await boot(device);
    store.getState().continueRun();
    expect(store.getState().engine).toBeNull();
    expect(store.getState().guestGate).toBe(true);
    // The milestone was earned as a guest: the second champion can be unlocked locally.
    expect(await store.getState().claimChampionUnlock('summoner')).toBe(true);
    expect(isChampionUnlocked(store.getState().profile, 'summoner')).toBe(true);
  });

  it('guest → create account from the invitation: progress migrates and Encounter IV starts', async () => {
    const device = memoryStorage();
    let profile = ok(chooseStartingChampion(fresh(), 'mage', NO_WARRIOR)).profile;
    profile = ok(claimChampionUnlock(recordCampaignBest(profile, 3), 'summoner', NO_WARRIOR)).profile;
    device.setItem('rpg-go-tactics:profile', serializeProfile(profile));
    device.setItem('rpg-go-tactics:campaign:hero:mage', serializeRun(runAt('mage', 3)));
    const store = await boot(device);
    store.getState().continueRun();
    expect(store.getState().guestGate).toBe(true);
    store.getState().beginConversion();
    const created = await store.getState().register('nueva_cuenta', 'password-123', 'turnstile');
    expect('recoveryCode' in created).toBe(true);
    await store.getState().finishAccountSetup();
    await idle(store);
    expect(store.getState().account.status).toBe('READY');
    expect(store.getState().profile.champions).toEqual(profile.champions);
    expect(store.getState().runs.mage!.currentEncounterId).toBe(order[3]);
    store.getState().continueRun();
    expect(store.getState().engine!.scenario.id).toBe(order[3]);
    expect(store.getState().guestGate).toBe(false);
  });

  it('signing in to an account that already has cloud progress keeps the cloud save and says so', async () => {
    const { id } = addAccount(db, 'veterana');
    await createPlayer(db, id, 'veterana', createProfile(DEFAULT_CONTENT), [runAt('mage', 5)], { source: 'STARTER', importedAt: null, now: 0 });
    const device = memoryStorage();
    const local = ok(chooseStartingChampion(fresh(), 'summoner', NO_WARRIOR)).profile;
    device.setItem('rpg-go-tactics:profile', serializeProfile(local));
    device.setItem('rpg-go-tactics:campaign:hero:summoner', serializeRun(runAt('summoner', 3)));
    const store = await boot(device);
    store.getState().beginConversion();
    expect(await store.getState().signIn('veterana', 'pw')).toBeNull();
    await idle(store);
    expect(store.getState().account.status).toBe('READY');
    expect(needsStartingChampion(store.getState().profile)).toBe(false); // legacy account: no onboarding
    expect(store.getState().runs.mage!.completedEncounterIds).toHaveLength(5);
    expect(store.getState().accountNotice).toMatch(/nube/);
    expect(device.data.get('rpg-go-tactics:campaign:hero:summoner')).toBe(serializeRun(runAt('summoner', 3))); // guest save untouched
  });
});
