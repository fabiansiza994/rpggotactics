import { beforeEach, describe, expect, it } from 'vitest';
import {
  addCard,
  addCardIssue,
  ASCENT_CAMPAIGN,
  claimReward,
  createProfile,
  createRun,
  DECK_RULES,
  DEFAULT_CONTENT,
  grantCard,
  ownedFor,
  parseProfileSave,
  removeCard,
  rollReward,
  saveActiveDeck,
  serializeProfile,
  starterDeck,
  type CardDefinition,
  type GameContent,
  type PlayerProfile,
  type RunState,
} from '../src/game';
import { handle } from '../server/src/index';
import { sanitizeLocalImport } from '../server/src/importLocal';
import { addAccount, memoryD1 } from './support/d1';

/**
 * No real neutral card exists yet: these fixtures add one to the content so the shared pool
 * can be validated before the first neutral card ships.
 */
const neutral = (over: Partial<CardDefinition>): CardDefinition =>
  ({ ...DEFAULT_CONTENT.cards.barrier!, heroId: undefined, rarity: 'UNCOMMON', ...over }) as CardDefinition;
const CONTENT: GameContent = {
  ...DEFAULT_CONTENT,
  cards: {
    ...DEFAULT_CONTENT.cards,
    ward_stone: neutral({ id: 'ward_stone', name: 'Piedra de guarda' }),
    field_ration: neutral({ id: 'field_ration', name: 'Ración', rarity: 'COMMON' }),
  },
};
const mageDeck = starterDeck(CONTENT.heroes.mage!);
const summonerDeck = starterDeck(CONTENT.heroes.summoner!);

function granted(profile: PlayerProfile, heroId: string, cardId: string): PlayerProfile {
  const r = grantCard(profile, heroId, cardId, CONTENT);
  if (!r.ok) throw new Error(r.error);
  return r.profile;
}

describe('shared neutral pool', () => {
  it('a neutral card earned by the Summoner is owned by the account, not by the Summoner', () => {
    const before = createProfile(CONTENT);
    const after = granted(before, 'summoner', 'ward_stone');
    expect(after.shared!.collection.ward_stone).toEqual({ copies: 1, acquired: 1 });
    expect(after.heroes).toEqual(before.heroes);
    expect(ownedFor(after, 'mage', CONTENT)('ward_stone')).toBe(1);
    expect(ownedFor(after, 'summoner', CONTENT)('ward_stone')).toBe(1);
  });

  it('both champions can equip it in their own decks; equipping does not consume copies', () => {
    let profile = granted(createProfile(CONTENT), 'mage', 'ward_stone');
    profile = granted(profile, 'summoner', 'ward_stone'); // 2 copies, shared
    const mage = addCard(addCard(removeCard(removeCard(mageDeck, 'blink'), 'blink'), 'ward_stone'), 'ward_stone');
    const summoner = addCard(removeCard(summonerDeck, 'summoner_push'), 'ward_stone');
    const a = saveActiveDeck(profile, 'mage', mage, CONTENT, DECK_RULES);
    if (!a.ok) throw new Error(JSON.stringify(a.issues));
    const b = saveActiveDeck(a.profile, 'summoner', summoner, CONTENT, DECK_RULES);
    if (!b.ok) throw new Error(JSON.stringify(b.issues));
    // Decks stay independent: each champion keeps its own list.
    expect(b.profile.heroes.mage!.decks[0]!.cards).toEqual(mage);
    expect(b.profile.heroes.summoner!.decks[0]!.cards).toEqual(summoner);
    // The rarity cap still applies per deck (UNCOMMON = 2).
    expect(addCardIssue(mage, 'ward_stone', 'mage', ownedFor(profile, 'mage', CONTENT), CONTENT, DECK_RULES)?.code).toBe('COPY_LIMIT');
  });

  it('class restrictions are untouched: Mage cards stay Mage-only even when the Mage owns them', () => {
    const profile = granted(createProfile(CONTENT), 'mage', 'frost_nova');
    expect(ownedFor(profile, 'mage', CONTENT)('frost_nova')).toBe(1);
    expect(ownedFor(profile, 'summoner', CONTENT)('frost_nova')).toBe(0);
    expect(grantCard(profile, 'summoner', 'frost_nova', CONTENT).ok).toBe(false);
    const deck = addCard(removeCard(summonerDeck, 'summoner_push'), 'frost_nova');
    expect(addCardIssue(removeCard(summonerDeck, 'summoner_push'), 'frost_nova', 'summoner', ownedFor(profile, 'summoner', CONTENT), CONTENT, DECK_RULES)?.code).toBe('WRONG_HERO');
    expect(saveActiveDeck(profile, 'summoner', deck, CONTENT, DECK_RULES).ok).toBe(false);
    expect(profile.shared!.collection.frost_nova).toBeUndefined();
  });

  it('either champion can earn neutral duplicates after prioritizing unowned cards', () => {
    const offered = (profile: PlayerProfile, heroId: string, complete = false) =>
      Array.from({ length: 300 }, (_, seed) => seed).some((seed) =>
        rollReward({ content: CONTENT, heroId, owned: complete ? () => 5 : ownedFor(profile, heroId, CONTENT), pity: 4, rules: DECK_RULES, poolId: 'BOSS', seed, count: 3 }).options.some(
          (o) => o.kind === 'ADD_CARD' && o.cardId === 'ward_stone',
        ),
      );
    const fresh = createProfile(CONTENT);
    expect(offered(fresh, 'mage')).toBe(true);
    expect(offered(fresh, 'summoner')).toBe(true);
    const capped = granted(granted(fresh, 'mage', 'ward_stone'), 'summoner', 'ward_stone');
    expect(offered(capped, 'mage')).toBe(false);
    expect(offered(capped, 'summoner')).toBe(false);
    expect(offered(capped, 'mage', true)).toBe(true);
    expect(offered(capped, 'summoner', true)).toBe(true);
  });

  it('a campaign claim of a neutral card goes to the shared pool and reports isNew from it', () => {
    const run: RunState = {
      ...createRun(ASCENT_CAMPAIGN, CONTENT, 1, 'summoner'),
      status: 'CHOOSING_REWARD',
      completedEncounterIds: ['ascent_01_outpost'],
      rewardOptions: [{ id: 'r', kind: 'ADD_CARD', cardId: 'ward_stone', rarity: 'UNCOMMON' }],
    };
    const profile = createProfile(CONTENT);
    const first = claimReward(ASCENT_CAMPAIGN, CONTENT, profile, run, 'r');
    if (!first.ok) throw new Error(first.error);
    expect(first.granted).toEqual({ cardId: 'ward_stone', copies: 1, acquired: 1, isNew: true });
    expect(first.profile.heroes.summoner!.collection.ward_stone).toBeUndefined();
    expect(first.profile.heroes.mage).toEqual(profile.heroes.mage);
    const again = claimReward(ASCENT_CAMPAIGN, CONTENT, first.profile, run, 'r');
    expect(again.ok && again.granted).toEqual({ cardId: 'ward_stone', copies: 2, acquired: 2, isNew: false });
  });
});

describe('neutral pool persistence', () => {
  it('round-trips through the local save; saves without a pool keep working', () => {
    const profile = granted(createProfile(CONTENT), 'mage', 'ward_stone');
    const loaded = parseProfileSave(serializeProfile(profile), CONTENT);
    expect(loaded.status === 'OK' && loaded.profile).toEqual(profile);

    const legacy = { ...createProfile(CONTENT), shared: undefined }; // JSON drops the key
    const old = parseProfileSave(JSON.stringify({ version: 1, profile: legacy }), CONTENT);
    expect(old.status === 'OK' && old.profile.shared).toEqual({ collection: {}, acquisitions: 0 });
  });

  it('copies of a card that later became neutral move from the champions to the pool, summed, once', () => {
    const profile = createProfile(CONTENT);
    profile.heroes.mage!.collection.ward_stone = { copies: 1, acquired: 4 };
    profile.heroes.summoner!.collection.ward_stone = { copies: 1, acquired: 2 };
    const raw = serializeProfile({ ...profile, shared: undefined });
    const loaded = parseProfileSave(raw, CONTENT);
    if (loaded.status !== 'OK') throw new Error('not loaded');
    expect(loaded.profile.shared!.collection.ward_stone!.copies).toBe(2);
    expect(loaded.profile.heroes.mage!.collection.ward_stone).toBeUndefined();
    expect(loaded.profile.heroes.summoner!.collection.ward_stone).toBeUndefined();
    // Saving and loading again does not count them twice.
    const twice = parseProfileSave(serializeProfile(loaded.profile), CONTENT);
    expect(twice.status === 'OK' && twice.profile.shared!.collection.ward_stone!.copies).toBe(2);
  });

  it('a local import caps neutral copies and keeps them shared', () => {
    const profile = granted(granted(granted(createProfile(CONTENT), 'mage', 'ward_stone'), 'mage', 'ward_stone'), 'mage', 'ward_stone');
    const imported = sanitizeLocalImport(serializeProfile(profile), null, CONTENT, DECK_RULES);
    expect(imported.profile.shared!.collection.ward_stone!.copies).toBe(2); // UNCOMMON cap
    expect(imported.notes).toContain('shared: ward_stone unverified surplus not imported; legacy allowance 2 copies');
    expect(imported.profile.heroes.mage!.collection.ward_stone).toBeUndefined();
  });
});

describe('neutral pool on the server', () => {
  let db: ReturnType<typeof memoryD1>;
  const deps = { content: CONTENT, now: () => 1_000_000, seed: () => 7 };
  const call = async (token: string, method: string, path: string, body?: unknown) => {
    const req = new Request(`https://api.test/api/tactics${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res = await handle(req, { DB: db }, deps);
    return { status: res.status, body: (await res.json()) as { profile: PlayerProfile } };
  };
  beforeEach(() => {
    db = memoryD1({ legacyProfiles: true });
  });

  it('concurrent legacy folds do not duplicate or overwrite copies', async () => {
    const {id,token}=addAccount(db,'legacy_concurrency');await call(token,'POST','/profile',{});
    db.sql.prepare("INSERT INTO tactics_player_cards VALUES(?,'mage','ward_stone',2,1,'LOCAL_IMPORT',0)").run(id);
    db.sql.prepare("INSERT INTO tactics_player_cards VALUES(?,'*','ward_stone',5,2,'STORE_PURCHASE',0)").run(id);
    const results=await Promise.all([call(token,'GET','/state'),call(token,'GET','/state')]);
    for(const result of results) expect(result.body.profile.shared!.collection.ward_stone!.copies).toBe(7);
    expect((await call(token,'GET','/state')).body.profile.shared!.collection.ward_stone!.copies).toBe(7);
  });

  it('legacy champion rows of a now-neutral card are moved to the shared row in one step', async () => {
    const { id, token } = addAccount(db, 'ana');
    await call(token, 'POST', '/profile', {});
    for (const hero of ['mage', 'summoner'])
      db.sql
        .prepare("INSERT INTO tactics_player_cards (user_id, hero_id, card_id, copies, acquired, source, unlocked_at) VALUES (?, ?, 'ward_stone', 1, 3, 'NORMAL_DROP', 0)")
        .run(id, hero);
    const first = await call(token, 'GET', '/state');
    expect(first.body.profile.shared!.collection.ward_stone!.copies).toBe(2);
    expect(first.body.profile.heroes.mage!.collection.ward_stone).toBeUndefined();
    const rows = db.sql.prepare("SELECT hero_id, copies FROM tactics_player_cards WHERE user_id = ? AND card_id = 'ward_stone'").all(id);
    expect(rows).toEqual([{ hero_id: '*', copies: 2 }]);
    expect((await call(token, 'GET', '/state')).body.profile.shared).toEqual(first.body.profile.shared);
  });

  it('decks of both champions validate shared copies; class cards stay per champion', async () => {
    const { id, token } = addAccount(db, 'ana');
    await call(token, 'POST', '/profile', {});
    db.sql
      .prepare("INSERT INTO tactics_player_cards (user_id, hero_id, card_id, copies, acquired, source, unlocked_at) VALUES (?, '*', 'ward_stone', 1, 1, 'NORMAL_DROP', 0)")
      .run(id);
    const summoner = addCard(removeCard(summonerDeck, 'summoner_push'), 'ward_stone');
    const mage = addCard(removeCard(mageDeck, 'blink'), 'ward_stone');
    expect((await call(token, 'PUT', '/decks/summoner/main', { cards: summoner })).status).toBe(200);
    expect((await call(token, 'PUT', '/decks/mage/main', { cards: mage })).status).toBe(200);
    const glacial = addCard(removeCard(summonerDeck, 'summoner_push'), 'glacial_field');
    expect((await call(token, 'PUT', '/decks/summoner/main', { cards: glacial })).status).toBe(422);
  });
});
