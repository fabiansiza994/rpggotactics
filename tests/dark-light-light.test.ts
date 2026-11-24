import { describe, expect, it } from 'vitest';
import { applyStatus } from '../src/game/domain/statuses/status-rules';
import { dealDamage } from '../src/game/domain/combat/damage';
import { endFactionTurn } from '../src/game/domain/turn/turn-flow';
import { ctxFor, makeEngine, mutable, p, setHand, unit } from './helpers';

describe('Light protection and explicit cleansing', () => {
  it('Minor Blessing rejects full HP and uses the owner Light World bonus without overheal', () => {
    const e = makeEngine(), hero = unit(e, e.heroId);
    const [uid] = setHand(e, ['light_minor_blessing']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: hero.pos }).ok).toBe(false);
    hero.hp -= 3;
    applyStatus(ctxFor(e), hero, 'LIGHT_WORLD', 6, hero.id);
    const hp = hero.hp;
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: hero.pos }).ok).toBe(true);
    expect(unit(e, e.heroId).hp).toBe(hp + 2);
  });
  it('Purifying Flash chooses only one minor status and preserves immobilization', () => {
    const e = makeEngine(), ctx = ctxFor(e), hero = unit(e, e.heroId);
    applyStatus(ctx, hero, 'BURNING', 2, 'enemy');
    applyStatus(ctx, hero, 'BLEEDING', 2, 'enemy');
    applyStatus(ctx, hero, 'ROOTED', 2, 'enemy');
    const [uid] = setHand(e, ['light_purifying_flash']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: hero.pos }).ok).toBe(true);
    expect(e.state.player.pendingCardChoice?.options.map(option => option.uid)).toEqual(['BURNING', 'BLEEDING']);
    const before = JSON.stringify(e.state);
    expect(e.dispatch({ type: 'RESOLVE_CARD_CHOICE', choiceUid: 'ROOTED' }).ok).toBe(false);
    expect(JSON.stringify(e.state)).toBe(before);
    expect(e.dispatch({ type: 'RESOLVE_CARD_CHOICE', choiceUid: 'BLEEDING' }).ok).toBe(true);
    expect(unit(e, e.heroId).statuses.map(status => status.id)).toEqual(['BURNING', 'ROOTED']);
  });
  it('Vigil blocks one minor application but does not block roots or damage', () => {
    const e = makeEngine(), ctx = ctxFor(e), hero = unit(e, e.heroId);
    applyStatus(ctx, hero, 'LIGHT_VIGIL', 1, hero.id);
    applyStatus(ctx, hero, 'ROOTED', 2, 'enemy');
    expect(hero.statuses.some(status => status.id === 'LIGHT_VIGIL')).toBe(true);
    applyStatus(ctx, hero, 'POISONED', 3, 'enemy');
    expect(hero.statuses.some(status => status.id === 'POISONED')).toBe(false);
    expect(hero.statuses.some(status => status.id === 'LIGHT_VIGIL')).toBe(false);
    applyStatus(ctx, hero, 'POISONED', 3, 'enemy');
    expect(hero.statuses.some(status => status.id === 'POISONED')).toBe(true);
  });
  it('Protective Light reduces only one damaging event and never stacks', () => {
    const e = makeEngine(), ctx = ctxFor(e), hero = unit(e, e.heroId), hp = hero.hp;
    applyStatus(ctx, hero, 'LIGHT_PROTECTION', 1, hero.id);
    applyStatus(ctx, hero, 'LIGHT_PROTECTION', 1, hero.id);
    expect(hero.statuses.filter(status => status.id === 'LIGHT_PROTECTION')).toHaveLength(1);
    expect(dealDamage(ctx, hero, 3, 'orc-1', 'PHYSICAL').hpLost).toBe(2);
    expect(dealDamage(ctx, hero, 3, 'orc-1', 'PHYSICAL').hpLost).toBe(3);
    expect(hero.hp).toBe(hp - 5);
  });
  it('Ash Mark is source-specific, direct-only and expires at the caster turn end', () => {
    const e = makeEngine({ hero: { heroId: 'warrior', pos: p(2, 2) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(3, 2) }] });
    mutable(e).player.energy = 5;
    const target = unit(e, 'orc-1');
    const [uid] = setHand(e, ['dark_ash_mark']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: target.pos }).ok).toBe(true);
    const ctx = ctxFor(e), current = unit(e, 'orc-1');
    dealDamage(ctx, current, 1, e.heroId, 'PHYSICAL');
    expect(current.statuses.some(status => status.id === 'ASH_MARK')).toBe(true);
    expect(dealDamage(ctx, current, 2, e.heroId, 'PHYSICAL', 'DIRECT_MELEE').hpLost).toBe(3);
    expect(current.statuses.some(status => status.id === 'ASH_MARK')).toBe(false);
    const [another] = setHand(e, ['dark_ash_mark']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: another!, target: current.pos }).ok).toBe(true);
    endFactionTurn(ctxFor(e), 'PLAYER');
    expect(unit(e, 'orc-1').statuses.some(status => status.id === 'ASH_MARK')).toBe(false);
  });
});
