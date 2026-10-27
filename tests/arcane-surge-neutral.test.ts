import { expect, it } from 'vitest';
import {
  DEFAULT_CONTENT,
  GameEngine,
  createProfile,
  grantCard,
  parseProfileSave,
  serializeProfile,
  ownedFor,
  starterDeck,
  addCard,
  removeCard,
  validateDeck,
  DECK_RULES,
  copyLimit,
  saveActiveDeck,
} from '../src/game';
import { cardsForHero } from '../src/game/collection/deck-rules';
import { ownedCard } from '../src/game/collection/profile';
import { withArcher } from '../src/game/data/archer';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import {
  browseCollection,
  EMPTY_QUERY,
} from '../src/presentation/react/deckbuilder/collectionView';
import { makeEngine, mutable, p, setHand } from './helpers';
import { createDuel, validateLoadout, applyDuel, duelEvents } from '../src/game/pvp/duel';
const id = 'arcane_surge',
  content = withShapeshifterRelease(withArcher(DEFAULT_CONTENT));
it('keeps the same identity, cost, effect and rarity; no duplicate card or starter grant', () => {
  const card = content.cards[id]!;
  expect(card).toMatchObject({
    name: 'Arcane Surge',
    cost: 1,
    rarity: 'UNCOMMON',
    targeting: { type: 'SELF' },
    effects: [{ type: 'DRAW', count: 2 }],
  });
  expect(card.heroId).toBeUndefined();
  expect(copyLimit(card, DECK_RULES)).toBe(2);
  const profile = createProfile(content);
  expect(profile.shared!.collection[id]).toBeUndefined();
  for (const hero of Object.values(content.heroes))
    expect(hero.deck.some((e) => e.cardId === id)).toBe(false);
  expect(Object.values(content.cards).filter((c) => c.id === id)).toHaveLength(1);
});
for (const hero of ['mage', 'summoner', 'warrior', 'archer', 'shapeshifter'])
  it(`${hero}: neutral collection, ownership and specific deck obey the same copy rules`, () => {
    let profile = createProfile(content);
    const r = grantCard(profile, 'mage', id, content);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    profile = r.profile;
    const pool = cardsForHero(content, hero);
    expect(pool.some((c) => c.id === id)).toBe(true);
    expect(
      browseCollection(pool, (c) => ownedCard(profile, hero, c, content), {
        ...EMPTY_QUERY,
        origin: 'NEUTRAL',
        ownership: 'UNLOCKED',
      }).some((c) => c.id === id),
    ).toBe(true);
    const deck = addCard(
      removeCard(
        starterDeck(content.heroes[hero]!),
        starterDeck(content.heroes[hero]!).find(
          (e) => content.cards[e.cardId]?.heroId === undefined,
        )?.cardId ?? content.heroes[hero]!.deck[0]!.cardId,
      ),
      id,
    );
    expect(validateDeck(deck, hero, ownedFor(profile, hero, content), content, DECK_RULES)).toEqual(
      [],
    );
    expect(
      validateDeck([{ cardId: id, count: 3 }], hero, () => 9, content, DECK_RULES).some(
        (i) => i.code === 'COPY_LIMIT',
      ),
    ).toBe(true);
  });
it('old Mage copies move, not multiply, and its existing deck survives repeated save/load', () => {
  const old = {
    ...content,
    cards: { ...content.cards, [id]: { ...content.cards[id]!, heroId: 'mage' } },
  };
  let profile = createProfile(old);
  for (let i = 0; i < 2; i++) {
    const r = grantCard(profile, 'mage', id, old);
    if (!r.ok) throw Error(r.error);
    profile = r.profile;
  }
  const h = profile.heroes.mage!;
  h.decks[0]!.cards = addCard(removeCard(h.decks[0]!.cards, h.decks[0]!.cards[0]!.cardId), id);
  const original = structuredClone(h.decks);
  const loaded = parseProfileSave(serializeProfile(profile), content);
  expect(loaded.status).toBe('OK');
  if (loaded.status !== 'OK') return;
  expect(loaded.profile.shared!.collection[id]!.copies).toBe(2);
  expect(loaded.profile.heroes.mage!.collection[id]).toBeUndefined();
  expect(loaded.profile.heroes.mage!.decks).toEqual(original);
  expect(validateLoadout(loaded.profile, 'mage', content).cards).toEqual(original[0]!.cards);
  const again = parseProfileSave(serializeProfile(loaded.profile), content);
  expect(again.status).toBe('OK');
  if (again.status === 'OK') expect(again.profile).toEqual(loaded.profile);
});
for (const hero of ['mage', 'summoner', 'warrior', 'archer', 'shapeshifter'])
  it(`${hero}: actual PvE cast draws two with deterministic replay`, () => {
    const e = makeEngine({ hero: { heroId: hero, pos: p(0, 2) } }, content, 42);
    const [uid] = setHand(e, [id]);
    mutable(e).player.energy = 5;
    const before = structuredClone(e.state),
      cmd = { type: 'PLAY_CARD' as const, cardUid: uid!, target: null };
    const r = e.dispatch(cmd);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events.filter((e) => e.type === 'CARD_DRAWN')).toHaveLength(2);
    expect(e.state.player.hand).toHaveLength(2);
    expect(e.state.player.energy).toBe(4);
    const replay = GameEngine.fromSnapshot(before, content, e.scenario);
    expect(replay.dispatch(cmd)).toEqual(r);
    expect(replay.state).toEqual(e.state);
  });
it.each([0, 1])('empty discard and %s cards remaining draw only available cards', (remaining) => {
  const e = makeEngine();
  const [uid] = setHand(e, [id]);
  const s = mutable(e);
  s.player.deck = s.player.deck.slice(0, remaining);
  s.player.discard = [];
  const r = e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: null });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.events.filter((e) => e.type === 'CARD_DRAWN')).toHaveLength(remaining);
  expect(e.state.player.hand).toHaveLength(remaining);
  expect(e.state.player.deckRecycles).toBe(0);
});
it('draws across the discard boundary and keeps full-hand overflow rules', () => {
  const e = makeEngine();
  const [uid] = setHand(e, [id]);
  const s = mutable(e);
  s.player.discard = s.player.deck.splice(1);
  const r = e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: null });
  expect(r.ok).toBe(true);
  expect(e.state.player.hand).toHaveLength(2);
  expect(e.state.player.deckRecycles).toBe(1);
  const full = makeEngine();
  const uids = setHand(full, [
    id,
    ...Array(mutable(full).player.maxHandSize - 1).fill('magic_missile'),
  ]);
  const result = full.dispatch({ type: 'PLAY_CARD', cardUid: uids[0]!, target: null });
  expect(result.ok).toBe(true);
  expect(full.state.player.hand).toHaveLength(full.state.player.maxHandSize);
  if (result.ok)
    expect(result.events.some((e) => e.type === 'CARD_DISCARDED' && e.reason === 'HAND_FULL')).toBe(
      true,
    );
});
it('PvP keeps private draws private and replays the identical authoritative command', () => {
  const profile = createProfile(content),
    state = createDuel(
      [validateLoadout(profile, 'warrior', content), validateLoadout(profile, 'summoner', content)],
      42,
      'DUEL',
      'classic',
      content,
    );
  state.player.hand = [{ uid: 'draw-qa', cardId: id }];
  state.player.energy = 5;
  const cmd = { type: 'PLAY_CARD' as const, cardUid: 'draw-qa', target: null };
  const r = applyDuel(state, cmd, content);
  expect(r.events.filter((e) => e.type === 'CARD_DRAWN')).toHaveLength(2);
  expect(applyDuel(structuredClone(state), cmd, content)).toEqual(r);
  const rival = (state.duel!.active === 0 ? 1 : 0) as 0 | 1;
  expect(duelEvents(r.state, rival, r.events).filter((e) => e.type === 'CARD_DRAWN')).toHaveLength(
    0,
  );
});

it('retains an over-cap legacy deck, rejects new matches/saves, and permits a legal correction', () => {
  const old: typeof content = {...content, cards: {...content.cards, [id]: {...content.cards[id]!, heroId: 'mage'}}};
  let profile = createProfile(old);
  const additions = ['emergency_strike','take_cover','step_back','first_aid',id];
  for (const cardId of additions) {
    const r = grantCard(profile,'mage',cardId,old);
    if (!r.ok) throw Error(r.error);
    profile = r.profile;
  }
  const saved = profile.heroes.mage!.decks[0]!;
  const removed: string[] = [];
  for (const cardId of additions) {
    const original = saved.cards.find(e => old.cards[e.cardId]?.heroId === 'mage' && e.cardId !== id)!;
    removed.push(original.cardId);
    saved.cards = addCard(removeCard(saved.cards,original.cardId),cardId);
  }
  expect(validateDeck(saved.cards,'mage',ownedFor(profile,'mage',old),old,DECK_RULES)).toEqual([]);
  const before = structuredClone(saved.cards);
  const parsed = parseProfileSave(serializeProfile(profile),content);
  if (parsed.status !== 'OK') throw Error(parsed.status);
  const migrated = parsed.profile;
  expect(migrated.heroes.mage!.decks[0]!.cards).toEqual(before);
  expect(validateDeck(before,'mage',ownedFor(migrated,'mage',content),content,DECK_RULES)).toContainEqual({code:'NEUTRAL_LIMIT',count:5,limit:4});
  expect(() => validateLoadout(migrated,'mage',content)).toThrow();
  expect(saveActiveDeck(migrated,'mage',before,content,DECK_RULES).ok).toBe(false);
  expect(migrated.heroes.mage!.decks[0]!.cards).toEqual(before);
  const corrected = addCard(removeCard(before,'first_aid'),removed[3]!);
  const result = saveActiveDeck(migrated,'mage',corrected,content,DECK_RULES);
  expect(result.ok).toBe(true);
  if(result.ok) expect(validateLoadout(result.profile,'mage',content).cards).toEqual(corrected);
});
