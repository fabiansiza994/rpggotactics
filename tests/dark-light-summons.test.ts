import { describe, expect, it } from 'vitest';
import { actSummons, spawnSummon } from '../src/game/domain/summons/summons';
import { applyStatus, removeStatus } from '../src/game/domain/statuses/status-rules';
import { dealDamage } from '../src/game/domain/combat/damage';
import { ctxFor, makeEngine, mutable, p, setHand, unit } from './helpers';

describe('La Parca: authoritative loyalty and betrayal', () => {
  function setup() {
    const e = makeEngine({ hero: { heroId: 'mage', pos: p(2, 2) }, enemies: [{ id: 'enemy', enemyId: 'orc_warrior', pos: p(6, 2) }] });
    const ctx = ctxFor(e), owner = unit(e, e.heroId);
    const reaper = spawnSummon(ctx, owner, 'dark_the_reaper', p(3, 2))!;
    reaper.summon!.readyRound = 1;
    return { e, ctx, owner, reaper };
  }
  it('costs four HP without allowing lethal sacrifice; capacity zero works for Mage', () => {
    const e = makeEngine(); const s = mutable(e); s.player.energy = 5;
    unit(e, e.heroId).hp = 4;
    const [uid] = setHand(e, ['dark_the_reaper']);
    const before = JSON.stringify(e.state);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(1, 2) }).ok).toBe(false);
    expect(JSON.stringify(e.state)).toBe(before);
    unit(e, e.heroId).hp = 5;
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(1, 2) }).ok).toBe(true);
    expect(unit(e, e.heroId).hp).toBe(1);
    expect(e.state.units.find(u => u.defId === 'dark_the_reaper')).toMatchObject({ hp: 12, moveRange: 2, summon: { capacityCost: 0 } });
  });
  it('betrays at exactly ten percent, preserving faction and owner', () => {
    const { e, ctx, owner, reaper } = setup();
    owner.maxHp = 40; owner.hp = 4;
    actSummons(ctx, owner.id);
    expect(owner.hp).toBe(1);
    expect(reaper.faction).toBe(owner.faction);
    expect(reaper.summon?.ownerId).toBe(owner.id);
    expect(e.state.units.includes(reaper)).toBe(true);
  });
  it('own Dark World prevents betrayal, even at critical HP; expiration reenables it next action', () => {
    const { e, ctx, owner, reaper } = setup();
    owner.maxHp = 40; owner.hp = 4;
    applyStatus(ctx, owner, 'DARK_WORLD', 6, owner.id);
    actSummons(ctx, owner.id);
    expect(owner.hp).toBe(4);
    removeStatus(ctx, owner, 'DARK_WORLD', 'EXPIRED');
    reaper.pos = p(3, 2); mutable(e).round++;
    actSummons(ctx, owner.id);
    expect(owner.hp).toBe(1);
  });
  it('enemy Dark World cannot protect its owner and serialized state preserves the decision', () => {
    const { e, ctx, owner, reaper } = setup(); owner.maxHp = 40; owner.hp = 4;
    applyStatus(ctx, unit(e, 'enemy'), 'DARK_WORLD', 6, 'enemy');
    const restored = JSON.parse(JSON.stringify(e.state));
    actSummons({ ...ctx, state: restored }, owner.id);
    expect(restored.units.find((u: { id: string }) => u.id === owner.id).hp).toBe(1);
    expect(restored.units.find((u: { id: string }) => u.id === reaper.id).summon.ownerId).toBe(owner.id);
  });
});

describe('Warrior Pact', () => {
  it('sacrifices one maximum PM and only damaging direct attacks refresh bleed', () => {
    const e = makeEngine({ hero: { heroId: 'warrior', pos: p(2, 2) } }); const s = mutable(e);
    s.player.energy = 5; s.player.maxMovePoints = 3; s.player.movePoints = 3;
    const [uid] = setHand(e, ['dark_warrior_pact']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: null }).ok).toBe(true);
    expect(e.state.player.maxMovePoints).toBe(2);
    expect(e.state.player.movePoints).toBe(2);
    const target = unit(e, 'orc-1'), ctx = ctxFor(e);
    target.shield = 1;
    dealDamage(ctx, target, 1, e.heroId, 'PHYSICAL', 'DIRECT_MELEE');
    expect(target.statuses.some(status => status.id === 'BLEEDING')).toBe(false);
    dealDamage(ctx, target, 4, e.heroId, 'PHYSICAL', 'DIRECT_MELEE');
    expect(target.statuses.find(status => status.id === 'BLEEDING')?.turnsLeft).toBe(2);
    dealDamage(ctx, target, 2, e.heroId, 'PHYSICAL', 'DIRECT_MELEE');
    expect(target.statuses.filter(status => status.id === 'BLEEDING')).toHaveLength(1);
  });
  it('rejects a sacrifice below one maximum PM without charging energy', () => {
    const e = makeEngine({ hero: { heroId: 'warrior', pos: p(2, 2) } }); const s = mutable(e);
    s.player.energy = 5; s.player.maxMovePoints = 1;
    const [uid] = setHand(e, ['dark_warrior_pact']); const before = JSON.stringify(e.state);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: null }).ok).toBe(false);
    expect(JSON.stringify(e.state)).toBe(before);
  });
});
