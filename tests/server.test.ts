import { beforeEach, describe, expect, it } from 'vitest';
import {
  addCard,
  ASCENT_CAMPAIGN,
  campaignBattleContent,
  createProfile,
  currentEncounter,
  DECK_RULES,
  DEFAULT_CONTENT,
  GameEngine,
  removeCard,
  serializeProfile,
  serializeRun,
  starterDeck,
  type PlayerProfile,
  type RunState,
  type VictoryProof,
} from '../src/game';
import { handle } from '../server/src/index';
import { addAccount, memoryD1 } from './support/d1';
import { playBattle } from './support/bot';

type State = {
  user: { id: number; username: string };
  hasProfile: boolean;
  profile: PlayerProfile | null;
  run: RunState | null;
  meta: { migratedFromLocalAt: number | null } | null;
  importNotes?: string[];
  error?: { code: string; reason?: string; issues?: { code: string }[] };
};

const mage = DEFAULT_CONTENT.heroes.mage!;
/** Deck lists are unordered (draw order is shuffled); the database returns them sorted by card id. */
const norm = (deck: readonly { cardId: string; count: number }[]) => [...deck].sort((a, b) => a.cardId.localeCompare(b.cardId));
let db: ReturnType<typeof memoryD1>;
const deps = { content: DEFAULT_CONTENT, now: () => 1_000_000, seed: () => 7 };

async function call(token: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; body: State }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const req = new Request(`https://api.test/api/tactics${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await handle(req, { DB: db }, deps);
  return { status: res.status, body: (await res.json()) as State };
}

/** Plays the current encounter with the greedy bot until it wins; returns the proof a client would send. */
function winProof(state: State): VictoryProof {
  const run = state.run!;
  const encounter = currentEncounter(ASCENT_CAMPAIGN, run);
  for (let seed = 1; seed < 60; seed++) {
    const engine = new GameEngine(encounter, campaignBattleContent(DEFAULT_CONTENT, state.profile!, run, DECK_RULES), seed);
    playBattle(engine);
    if (engine.state.outcome?.result === 'WON')
      return { encounterId: encounter.id, seed, commands: JSON.parse(JSON.stringify(engine.history)) };
  }
  throw new Error('bot could not win');
}

beforeEach(() => {
  db = memoryD1({ legacyProfiles: true });
});

describe('auth / identity', () => {
  it('rejects missing, unknown and expired sessions', async () => {
    addAccount(db, 'old', { expiresAt: 10 });
    expect((await call(null, 'GET', '/state')).status).toBe(401);
    expect((await call('nope', 'GET', '/state')).status).toBe(401);
    expect((await call('token-old', 'GET', '/state')).status).toBe(401);
  });

  it('resolves the account behind the token (stable numeric id, not the email/username)', async () => {
    addAccount(db, 'ana');
    const bruno = addAccount(db, 'bruno');
    const me = await call(bruno.token, 'GET', '/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toEqual({ id: bruno.id, username: 'bruno' });
    expect(me.body.hasProfile).toBe(false);
  });
});

describe('profile + collection', () => {
  it('creates a starter profile once; the player sees their own starter collection', async () => {
    const { token } = addAccount(db, 'ana');
    const created = await call(token, 'POST', '/profile', {});
    expect(created.status).toBe(200);
    expect(created.body.profile!.selectedChampionId).toBe('mage');
    expect(created.body.profile!.heroes.mage!.collection.magic_missile).toEqual({ copies: 3, acquired: 0 });
    expect(norm(created.body.profile!.heroes.summoner!.decks[0]!.cards)).toEqual(norm(starterDeck(DEFAULT_CONTENT.heroes.summoner!)));
    expect((await call(token, 'POST', '/profile', {})).status).toBe(409);
  });

  it("one player cannot read or change another's progression (identity only from the token)", async () => {
    const ana = addAccount(db, 'ana');
    const bruno = addAccount(db, 'bruno');
    await call(ana.token, 'POST', '/profile', {});
    await call(bruno.token, 'POST', '/profile', {});
    // A body userId is ignored: the change applies to the caller only.
    await call(ana.token, 'PUT', '/champion', { championId: 'summoner', userId: bruno.id });
    expect((await call(ana.token, 'GET', '/state')).body.profile!.selectedChampionId).toBe('summoner');
    const b = await call(bruno.token, 'GET', '/state');
    expect(b.body.user.id).toBe(bruno.id);
    expect(b.body.profile!.selectedChampionId).toBe('mage');
  });

  it('champion selection persists and unknown champions are rejected', async () => {
    const { token } = addAccount(db, 'ana');
    await call(token, 'POST', '/profile', {});
    expect((await call(token, 'PUT', '/champion', { championId: 'paladin' })).status).toBe(422);
    await call(token, 'PUT', '/champion', { championId: 'summoner' });
    expect((await call(token, 'GET', '/state')).body.profile!.selectedChampionId).toBe('summoner');
  });
});

describe('decks (validated against the server collection)', () => {
  it('rejects unowned copies, locked/other-champion cards and bad sizes', async () => {
    const { token } = addAccount(db, 'ana');
    await call(token, 'POST', '/profile', {});
    const base = removeCard(starterDeck(mage), 'blink');
    const unowned = await call(token, 'PUT', '/decks/mage/main', { cards: addCard(base, 'repulse') }); // only 2 owned
    expect(unowned.status).toBe(422);
    expect(unowned.body.error!.issues!.map((i) => i.code)).toContain('NOT_ENOUGH_COPIES');
    const wrong = await call(token, 'PUT', '/decks/mage/main', { cards: addCard(base, 'summon_chicken') });
    expect(wrong.body.error!.issues!.map((i) => i.code)).toContain('WRONG_HERO');
    expect((await call(token, 'PUT', '/decks/mage/main', { cards: base })).status).toBe(422); // 29 cards
    expect((await call(token, 'PUT', '/decks/mage/nope', { cards: starterDeck(mage) })).status).toBe(404);
    expect((await call(token, 'PUT', '/decks/mage/main', { cards: 'all of them' })).status).toBe(400);
  });
});

describe('campaign (server-validated steps)', () => {
  it('start → replay-verified victory → offered reward → card owned → deck uses it → survives reload', async () => {
    const { token } = addAccount(db, 'ana');
    await call(token, 'POST', '/profile', {});
    const started = await call(token, 'POST', '/campaign/start', {});
    expect(started.body.run).toMatchObject({ status: 'IN_BATTLE', currentEncounterId: ASCENT_CAMPAIGN.start, seed: 7 });

    // Claims without a real win are refused.
    const empty = await call(token, 'POST', '/campaign/victory', { proof: { encounterId: ASCENT_CAMPAIGN.start, seed: 1, commands: [] } });
    expect(empty.status).toBe(422);
    const proof = winProof(started.body);
    const forged = await call(token, 'POST', '/campaign/victory', { proof: { ...proof, commands: proof.commands.slice(0, -1) } });
    expect(forged.status).toBe(422);
    const wrongEncounter = await call(token, 'POST', '/campaign/victory', { proof: { ...proof, encounterId: 'ascent_10_colossus' } });
    expect(wrongEncounter.status).toBe(422);

    const won = await call(token, 'POST', '/campaign/victory', { proof });
    expect(won.status).toBe(200);
    expect(won.body.run!.status).toBe('CHOOSING_REWARD');
    expect((await call(token, 'POST', '/campaign/victory', { proof })).status).toBe(200); // durable result, no second reward

    expect((await call(token, 'POST', '/campaign/reward', { optionId: 'reward-0-meteor' })).status).toBe(409);
    const offer = won.body.run!.rewardOptions.find((o) => o.kind === 'ADD_CARD')!;
    if (offer.kind !== 'ADD_CARD') throw new Error('expected a card offer');
    const took = await call(token, 'POST', '/campaign/reward', { optionId: offer.id });
    expect(took.body.run).toMatchObject({ status: 'IN_BATTLE', currentEncounterId: 'ascent_02_watchtower' });
    const before = starterDeck(mage).find((e) => e.cardId === offer.cardId)?.count ?? 0;
    expect(took.body.profile!.heroes.mage!.collection[offer.cardId]!.copies).toBe(before + 1);
    // Not equipped automatically.
    expect(norm(took.body.profile!.heroes.mage!.decks[0]!.cards)).toEqual(norm(starterDeck(mage)));

    // Now a deck with the earned copy is legal (if the rarity limit allows another copy).
    const victim = starterDeck(mage).find((e) => e.cardId !== offer.cardId)!.cardId;
    const deck = addCard(removeCard(starterDeck(mage), victim), offer.cardId);
    const limit = DECK_RULES.maxCopiesByRarity[DEFAULT_CONTENT.cards[offer.cardId]!.rarity ?? 'COMMON'];
    const saved = await call(token, 'PUT', '/decks/mage/main', { cards: deck });
    expect(saved.status).toBe(before + 1 <= limit ? 200 : 422);

    // "Another device": a fresh read with the same account restores everything.
    const reload = await call(token, 'GET', '/state');
    expect(reload.body.run).toEqual(took.body.run);
    expect(reload.body.profile).toEqual(saved.status === 200 ? saved.body.profile : took.body.profile);
  }, 60_000);

  it('account deletion in RPG-GO cascades to every Tactics row', async () => {
    const { token, id } = addAccount(db, 'ana');
    await call(token, 'POST', '/profile', {});
    await call(token, 'POST', '/campaign/start', {});
    db.sql.prepare("DELETE FROM users WHERE username = 'ana'").run();
    for (const table of ['tactics_profiles', 'tactics_player_cards', 'tactics_decks', 'tactics_deck_cards', 'tactics_campaign_runs', 'tactics_hero_campaign_runs'])
      expect(db.sql.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(id)).toEqual(expect.objectContaining({ n: 0 }));
  });
});

describe('one-time local import', () => {
  const localRun = (patch: Partial<RunState> = {}): RunState => ({
    campaignId: ASCENT_CAMPAIGN.id,
    seed: 3,
    heroId: 'mage',
    status: 'IN_BATTLE',
    currentEncounterId: 'ascent_02_watchtower',
    completedEncounterIds: ['ascent_01_outpost'],
    rewardOptions: [],
    chosenRewards: [],
    maxHpBonus: 0,
    ...patch,
  });

  it('imports a valid local save once and marks the migration', async () => {
    const { token } = addAccount(db, 'ana');
    const profile = { ...createProfile(DEFAULT_CONTENT), selectedChampionId: 'summoner' };
    profile.heroes.mage!.collection.repulse = { copies: 3, acquired: 1 };
    const deck = addCard(removeCard(starterDeck(mage), 'blink'), 'repulse');
    profile.heroes.mage!.decks[0]!.cards = deck;
    const res = await call(token, 'POST', '/import', { profile: serializeProfile(profile), campaign: serializeRun(localRun()) });
    expect(res.status).toBe(200);
    expect(res.body.meta!.migratedFromLocalAt).toBe(1_000_000);
    expect(res.body.profile!.selectedChampionId).toBe('summoner');
    expect(norm(res.body.profile!.heroes.mage!.decks[0]!.cards)).toEqual(norm(deck));
    expect(res.body.run!.currentEncounterId).toBe('ascent_02_watchtower');
    // Only when the server has no save: a second import (e.g. another device) is refused.
    expect((await call(token, 'POST', '/import', { profile: serializeProfile(profile) })).status).toBe(409);
  });

  it('drops unknown cards, caps inflated copies, replaces illegal decks and regenerates reward offers', async () => {
    const { token } = addAccount(db, 'ana');
    const profile = createProfile(DEFAULT_CONTENT);
    profile.heroes.mage!.collection.fireball = { copies: 99, acquired: 1 };
    profile.heroes.mage!.collection.not_a_card = { copies: 5, acquired: 2 };
    profile.heroes.mage!.collection.summon_chicken = { copies: 3, acquired: 3 };
    profile.heroes.mage!.decks[0]!.cards = [{ cardId: 'fireball', count: 20 }];
    const forgedOffer = localRun({
      status: 'CHOOSING_REWARD',
      currentEncounterId: 'ascent_02_watchtower',
      completedEncounterIds: ['ascent_01_outpost', 'ascent_02_watchtower'],
      rewardOptions: [{ id: 'reward-0-frost_nova', kind: 'ADD_CARD', cardId: 'frost_nova', rarity: 'UNCOMMON' }],
    });
    const res = await call(token, 'POST', '/import', { profile: serializeProfile(profile), campaign: serializeRun(forgedOffer) });
    expect(res.status).toBe(200);
    const collection = res.body.profile!.heroes.mage!.collection;
    expect(collection.fireball!.copies).toBe(3);
    expect(collection.not_a_card).toBeUndefined();
    expect(collection.summon_chicken).toBeUndefined();
    expect(norm(res.body.profile!.heroes.mage!.decks[0]!.cards)).toEqual(norm(starterDeck(mage)));
    expect(res.body.run!.rewardOptions.map((o) => o.id)).not.toEqual(['reward-0-frost_nova']);
    expect(res.body.run!.rewardOptions).toHaveLength(3);
    expect(res.body.importNotes!.length).toBeGreaterThan(0);
  });

  it('garbage local data falls back to a clean starter account instead of failing', async () => {
    const { token } = addAccount(db, 'ana');
    const res = await call(token, 'POST', '/import', { profile: '{oops', campaign: JSON.stringify({ version: 2, run: { campaignId: 'x' } }) });
    expect(res.status).toBe(200);
    expect(norm(res.body.profile!.heroes.mage!.decks[0]!.cards)).toEqual(norm(starterDeck(mage)));
    expect(res.body.run).toBeNull();
  });
});

describe('CORS allowlist', () => {
  const allowed = 'https://localhost,http://localhost:5173';
  const req = (origin: string | null, method = 'GET') =>
    handle(new Request('https://api.test/api/tactics/health', { method, headers: origin ? { Origin: origin } : {} }), { DB: db, ALLOWED_ORIGINS: allowed }, deps);

  it('echoes listed origins only; unlisted browser origins get no Allow-Origin', async () => {
    expect((await req('https://localhost')).headers.get('Access-Control-Allow-Origin')).toBe('https://localhost');
    expect((await req('http://localhost:5173', 'OPTIONS')).headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect((await req('https://evil.example')).headers.get('Access-Control-Allow-Origin')).toBeNull();
    const native = await req(null);
    expect(native.status).toBe(200);
    expect(native.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(native.headers.get('Vary')).toBe('Origin');
  });
});

describe('campaign encounter 3 response-loss regression', () => {
  it('retries the already verified third victory without advancing or rewarding twice', async () => {
    addAccount(db, 'retry');
    const token = 'token-retry';
    await call(token, 'POST', '/profile', {});
    let state = (await call(token, 'POST', '/campaign/start', {})).body;
    for (let i = 0; i < 3; i++) {
      const proof = winProof(state);
      const won = await call(token, 'POST', '/campaign/victory', { proof });
      expect(won.status).toBe(200);
      const rows = db.sql.prepare('SELECT count(*) AS n FROM tactics_reward_log').get();
      // Simulate a committed response lost in transit: resend the same proof.
      const retry = await call(token, 'POST', '/campaign/victory', { proof });
      expect(retry.status).toBe(200);
      expect(retry.body.run).toEqual(won.body.run);
      expect(db.sql.prepare('SELECT count(*) AS n FROM tactics_reward_log').get()).toEqual(rows);
      state = retry.body;
      if (state.run!.status === 'CHOOSING_REWARD')
        state = (await call(token, 'POST', '/campaign/reward', { optionId: state.run!.rewardOptions[0]!.id })).body;
    }
    expect(state.run!.completedEncounterIds).toHaveLength(3);
  }, 60000);
});

describe('campaign reward retry uses encounter identity', () => {
  it('returns a claimed reward unchanged and rejects an unoffered option', async () => {
    const {token} = addAccount(db, 'reward-retry');
    await call(token, 'POST', '/profile', {});
    const state = (await call(token, 'POST', '/campaign/start', {})).body;
    const won = await call(token, 'POST', '/campaign/victory', {proof:winProof(state)});
    const encounterId = won.body.run!.currentEncounterId;
    const optionId = won.body.run!.rewardOptions[0]!.id;
    const claim = await call(token, 'POST', '/campaign/reward', {encounterId,optionId});
    expect(claim.status).toBe(200);
    const rows = db.sql.prepare('SELECT count(*) AS n FROM tactics_reward_log').get();
    const retry = await call(token, 'POST', '/campaign/reward', {encounterId,optionId});
    expect(retry.status).toBe(200);
    expect(retry.body.profile).toEqual(claim.body.profile);
    expect(retry.body.run).toEqual(claim.body.run);
    expect(db.sql.prepare('SELECT count(*) AS n FROM tactics_reward_log').get()).toEqual(rows);
    expect((await call(token,'POST','/campaign/reward',{encounterId,optionId:'fake'})).status).toBe(409);
  });
});
