import { describe, expect, it } from 'vitest';
import { ctxFor, makeEngine, mutable, p, setHand, unit } from './helpers';
import { spawnSummon } from '../src/game/domain/summons/summons';
import { applyStatus } from '../src/game/domain/statuses/status-rules';
import { planCardSelection } from '../src/presentation/input/pairSelection';

describe('Light and shadow walking uses authoritative targeting', () => {
  it('Light Step selects an ally then a free adjacent destination without spending movement', () => {
    const e = makeEngine({ hero: { heroId: 'summoner', pos: p(2, 2) } }), ctx = ctxFor(e);
    mutable(e).player.energy = 5;
    const ally = spawnSummon(ctx, unit(e, e.heroId), 'chicken', p(3, 2))!;
    const [uid] = setHand(e, ['light_light_step']);
    const first = planCardSelection(e, uid!, ally.pos, null);
    expect(first.kind).toBe('first');
    if (first.kind !== 'first') throw Error('first selection missing');
    const second = planCardSelection(e, uid!, p(3, 3), first.pair);
    expect(second.kind).toBe('command');
    if (second.kind !== 'command') throw Error('command missing');
    const before = e.state.player.movePoints;
    expect(e.dispatch(second.command).ok).toBe(true);
    expect(unit(e, ally.id).pos).toEqual(p(3, 3));
    expect(e.state.player.movePoints).toBe(before);
  });
  it('rooted allies and occupied destinations are rejected without cost', () => {
    const e = makeEngine({ hero: { heroId: 'summoner', pos: p(2, 2) } }), ctx = ctxFor(e);
    mutable(e).player.energy = 5;
    const ally = spawnSummon(ctx, unit(e, e.heroId), 'chicken', p(3, 2))!;
    const [uid] = setHand(e, ['light_light_step']);
    const before = JSON.stringify(e.state);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: ally.pos, secondary: p(2, 2) }).ok).toBe(false);
    expect(JSON.stringify(e.state)).toBe(before);
    applyStatus(ctx, ally, 'ROOTED', 2, 'enemy');
    expect(e.getSecondaryTargets(uid!, ally.pos)).toEqual([]);
  });
  it('Shadow Step respects rooting and does not spend the normal movement pool', () => {
    const e = makeEngine(); mutable(e).player.energy = 5;
    const [uid] = setHand(e, ['dark_umbral_step']);
    const before = e.state.player.movePoints;
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(2, 2) }).ok).toBe(true);
    expect(e.state.player.movePoints).toBe(before);
    expect(unit(e, e.heroId).pos).toEqual(p(2, 2));
  });
});
