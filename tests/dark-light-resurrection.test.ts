import { describe, expect, it } from 'vitest';
import { ctxFor, makeEngine, mutable, p, setHand, unit } from './helpers';
import { defeatUnit } from '../src/game/domain/combat/damage';
import { spawnSummon, summonCapacityOf } from '../src/game/domain/summons/summons';
import { endFactionTurn } from '../src/game/domain/turn/turn-flow';

describe('Summon recovery uses provenance of an actually dead owned instance', () => {
  it('resurrects full HP with normal capacity and next-round readiness; a second recovery is rejected', () => {
    const e = makeEngine({ hero: { heroId: 'summoner', pos: p(2, 2) } }); mutable(e).player.energy = 20;
    const [summonUid] = setHand(e, ['summon_chicken']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: summonUid!, target: p(3, 2) }).ok).toBe(true);
    const chicken = e.state.units.find(unit => unit.defId === 'chicken')!;
    expect(chicken.summon?.sourceCardUid).toBe(summonUid);
    defeatUnit(ctxFor(e), chicken);
    const [resurrectionUid] = setHand(e, ['light_beyond_call']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: resurrectionUid!, target: p(3, 2) }).ok).toBe(true);
    expect(e.state.player.pendingCardChoice?.options.map(option => option.uid)).toEqual([summonUid]);
    expect(e.dispatch({ type: 'RESOLVE_CARD_CHOICE', choiceUid: summonUid! }).ok).toBe(true);
    const revived = e.state.units.find(unit => unit.defId === 'chicken')!;
    expect(revived.hp).toBe(3);
    expect(revived.summon).toMatchObject({ capacityCost: 1, readyRound: e.state.round + 1, recoveredCard: { uid: summonUid, recoveredThisBattle: true } });
    expect(e.state.player.discard.some(card => card.uid === summonUid)).toBe(false);
    defeatUnit(ctxFor(e), revived);
    expect(e.state.player.discard.find(card => card.uid === summonUid)?.recoveredThisBattle).toBe(true);
    const [again] = setHand(e, ['light_beyond_call']); const before = JSON.stringify(e.state);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: again!, target: p(3, 2) }).ok).toBe(false);
    expect(JSON.stringify(e.state)).toBe(before);
  });
  it('a card in the grave without a recorded dead summon does not authorize resurrection', () => {
    const e = makeEngine({ hero: { heroId: 'summoner', pos: p(2, 2) } }); mutable(e).player.energy = 20;
    mutable(e).player.discard = [{ uid: 'not-summoned', cardId: 'summon_chicken' }];
    const [uid] = setHand(e, ['light_beyond_call']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(3, 2) }).ok).toBe(false);
  });
});

describe('Pact Fairy live capacity', () => {
  it('two fairies stack capacity, expire independently and do not duplicate cleanup', () => {
    const e = makeEngine({ hero: { heroId: 'summoner', pos: p(2, 2) } }), ctx = ctxFor(e), owner = unit(e, e.heroId);
    const base = summonCapacityOf(e.content, owner);
    const first = spawnSummon(ctx, owner, 'light_pact_fairy', p(3, 2))!;
    const second = spawnSummon(ctx, owner, 'light_pact_fairy', p(2, 3))!;
    expect(summonCapacityOf(e.content, owner)).toBe(base + 2);
    defeatUnit(ctx, first); defeatUnit(ctx, first);
    expect(summonCapacityOf(e.content, owner)).toBe(base + 1);
    for (let i = 0; i < 5; i++) endFactionTurn(ctx, 'PLAYER');
    expect(e.state.units.includes(second)).toBe(false);
    expect(summonCapacityOf(e.content, owner)).toBe(base);
  });
});
