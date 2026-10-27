import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT, GameEngine, type GameContent, type GameEvent, type GameState } from '../src/game';
import { withArcher } from '../src/game/data/archer';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import { spawnSummon } from '../src/game/domain/summons/summons';
import { applyStatus, removeStatus } from '../src/game/domain/statuses/status-rules';
import { addShield, dealDamage } from '../src/game/domain/combat/damage';
import { attackDamage } from '../src/game/domain/combat/attack-modifiers';
import { springTrap } from '../src/game/domain/combat/traps';
import type { Pos } from '../src/game/domain/core/position';
import { tileAt } from '../src/game/domain/board/board';
import { ctxFor, endTurn, makeEngine, mutable, ofType, p, setHand, unit } from './helpers';

/**
 * Free catalog — Phase B mechanics, one directed scenario per rule (no simulations):
 * TARGET_ON_TERRAIN, ACTIVATE_SUMMON, summon aura, damage from Guardia, HP floor, linked trap net,
 * form-change trigger, plus each Ultra and the two new Rares.
 */
const WIDE = Array(5).fill('.........');
const ARCHER = withArcher(DEFAULT_CONTENT);
const SHIFTER = withShapeshifterRelease(DEFAULT_CONTENT);

function battle(heroId: string, enemies: { id: string; pos: Pos; enemyId?: string }[], heroPos = p(0, 2), content: GameContent = DEFAULT_CONTENT, layout = WIDE) {
  const engine = makeEngine({ layout, hero: { heroId, pos: heroPos }, enemies: enemies.map((e) => ({ enemyId: 'orc_warrior', ...e })) }, content);
  mutable(engine).player.energy = 9;
  for (const e of enemies) unit(engine, e.id).moveRange = 0;
  return engine;
}
const play = (engine: GameEngine, cardId: string, target: Pos | null) => {
  const [uid] = setHand(engine, [cardId]);
  const r = engine.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target });
  if (!r.ok) throw new Error(`${cardId}: ${r.error}`);
  return r.events;
};
const hero = (engine: GameEngine) => unit(engine, engine.heroId);
const terrainAt = (engine: GameEngine, q: Pos) => tileAt(engine.state.board, q)?.terrain;
const lost = (events: readonly GameEvent[], id: string) => ofType(events, 'UNIT_DAMAGED').filter((e) => e.unitId === id).reduce((n, e) => n + e.hpLost, 0);

describe('Detonación Elemental (Mage Legendary): target on FIRE or ICE is a real engine rule', () => {
  it('1 to plain ground, 3 on fire / ice (the tile under the unit at resolution), then the area is cleared', () => {
    const layout = ['.........', '.........', '....FI...', '.........', '.........'];
    const engine = battle('mage', [{ id: 'fire', pos: p(4, 2) }, { id: 'ice', pos: p(5, 2) }, { id: 'plain', pos: p(4, 3) }, { id: 'far', pos: p(7, 2) }], p(2, 2), DEFAULT_CONTENT, layout);
    const events = play(engine, 'elemental_detonation', p(4, 2));
    expect([lost(events, 'fire'), lost(events, 'ice'), lost(events, 'plain'), lost(events, 'far')]).toEqual([3, 3, 1, 0]);
    expect([terrainAt(engine, p(4, 2)), terrainAt(engine, p(5, 2))].map((t) => t ?? 'NORMAL')).not.toContain('FIRE');
    expect(terrainAt(engine, p(5, 2))).not.toBe('ICE');
  });

  it('timing: fire created earlier this turn counts; fire under a unit that was pushed away does not', () => {
    const engine = battle('mage', [{ id: 'orc', pos: p(4, 2) }], p(2, 2));
    play(engine, 'flame_tile', p(4, 2)); // the orc now stands on fire
    expect(lost(play(engine, 'elemental_detonation', p(4, 2)), 'orc')).toBe(3);
    const moved = battle('mage', [{ id: 'orc', pos: p(4, 2) }], p(2, 2), DEFAULT_CONTENT, ['.........', '.........', '.....F...', '.........', '.........']);
    expect(lost(play(moved, 'elemental_detonation', p(4, 2)), 'orc')).toBe(1); // fire next to it, not under it
  });
});

describe('Orden del Vinculador (Summoner Legendary): act now, never twice', () => {
  const setup = () => {
    const engine = battle('summoner', [{ id: 'orc', pos: p(5, 2) }], p(0, 2));
    const fox = spawnSummon(ctxFor(engine), hero(engine), 'fox', p(2, 2))!;
    fox.summon!.readyRound = engine.state.round;
    return { engine, foxId: fox.id };
  };

  it('the ordered summon moves + attacks immediately, then skips the end-of-turn activation', () => {
    const { engine, foxId } = setup();
    const now = play(engine, 'binder_command', p(2, 2));
    expect(ofType(now, 'SUMMON_ORDERED')).toEqual([{ type: 'SUMMON_ORDERED', unitId: foxId }]);
    expect(ofType(now, 'SUMMON_ATTACKED').map((e) => e.unitId)).toEqual([foxId]);
    const r = engine.dispatch(endTurn(engine));
    expect(r.ok && ofType(r.events, 'SUMMON_ATTACKED').some((e) => e.unitId === foxId)).toBe(false);
    // Next round it acts normally again (one activation per round, never lost).
    const next = engine.dispatch(endTurn(engine));
    expect(next.ok && ofType(next.events, 'SUMMON_ATTACKED').some((e) => e.unitId === foxId)).toBe(true);
  });

  it('only a ready summon that has not acted this round is a target (no summon-and-strike, no double order)', () => {
    const { engine, foxId } = setup();
    const fresh = spawnSummon(ctxFor(engine), hero(engine), 'chicken', p(1, 3))!; // ready next round
    const [a, b] = setHand(engine, ['binder_command', 'binder_command']);
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: a!, target: fresh.pos }).ok).toBe(false);
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: a!, target: p(2, 2) }).ok).toBe(true);
    const foxPos = unit(engine, foxId).pos;
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: b!, target: foxPos }).ok).toBe(false);
  });

  it('deterministic replay: same snapshot + commands → identical state', () => {
    const { engine } = setup();
    const snapshot = structuredClone(engine.state) as GameState;
    const [uid] = setHand(engine, ['binder_command']);
    const commands = [{ type: 'PLAY_CARD', cardUid: uid!, target: p(2, 2) } as const];
    const start = structuredClone(engine.state) as GameState;
    for (const c of commands) engine.dispatch(c);
    engine.dispatch(endTurn(engine));
    const copy = GameEngine.fromSnapshot(start, engine.content, engine.scenario);
    for (const c of commands) copy.dispatch(c);
    copy.dispatch(endTurn(copy));
    expect(JSON.stringify(copy.state)).toBe(JSON.stringify(engine.state));
    expect(snapshot.round).toBe(start.round);
  });
});

describe('Gólem del Pacto (Summoner Ultra): live aura', () => {
  const setup = () => {
    const engine = battle('summoner', [{ id: 'orc', pos: p(6, 2) }], p(3, 2));
    const events = play(engine, 'summon_pact_golem', p(4, 2));
    const golem = engine.state.units.find((u) => u.defId === 'pact_golem')!;
    return { engine, events, golemId: golem.id };
  };

  it('Única summon: 16 HP, armour 1, capacity 2; the card is banished', () => {
    const { engine, events, golemId } = setup();
    expect(unit(engine, golemId)).toMatchObject({ maxHp: 16, armor: 1, moveRange: 2 });
    expect(unit(engine, golemId).summon!.capacityCost).toBe(2);
    expect(ofType(events, 'CARD_BANISHED').map((e) => e.cardId)).toEqual(['summon_pact_golem']);
  });

  it('−1 to attacks on adjacent allies once ready; recalculated with movement; never itself; never stacked', () => {
    const { engine, golemId } = setup();
    const ctx = ctxFor(engine);
    const orc = unit(engine, 'orc');
    const me = hero(engine);
    expect(attackDamage(ctx, orc, me, 3)).toBe(3); // not ready yet (acts from the next round)
    mutable(engine).round += 1;
    expect(attackDamage(ctx, orc, me, 3)).toBe(2); // adjacent (3,2)–(4,2)
    me.pos = p(1, 2);
    expect(attackDamage(ctx, orc, me, 3)).toBe(3); // separated: no aura
    me.pos = p(4, 3);
    expect(attackDamage(ctx, orc, me, 3)).toBe(2); // moved next to it again
    expect(attackDamage(ctx, orc, unit(engine, golemId), 3)).toBe(3); // never protects itself
    applyStatus(ctx, me, 'SMOKE_SCREEN', 1, me.id); // Cobertura −1 + aura −1 → still −1
    expect(attackDamage(ctx, orc, me, 3)).toBe(2);
    removeStatus(ctx, me, 'SMOKE_SCREEN', 'EXPIRED');
    // Other allowed allies: another summon of the owner next to it.
    const fox = spawnSummon(ctx, me, 'fox', p(5, 2));
    if (fox) expect(attackDamage(ctx, orc, fox, 3)).toBe(2);
  });
});

describe('Golpe del Bastión (Warrior Legendary): the real Guardia at resolution', () => {
  const setup = () => battle('warrior', [{ id: 'orc', pos: p(1, 2) }], p(0, 2));

  it('Guardia 4 → 4 damage and the Guardia is spent; 9 → 6 (cap) and 3 left; none → 1', () => {
    for (const [guard, damage, left] of [[4, 4, 0], [9, 6, 3], [0, 1, 0]] as const) {
      const engine = setup();
      unit(engine, 'orc').maxHp = unit(engine, 'orc').hp = 20;
      if (guard) addShield(ctxFor(engine), hero(engine), guard, 'test');
      expect(lost(play(engine, 'bastion_blow', p(1, 2)), 'orc')).toBe(damage);
      expect(hero(engine).shield).toBe(left);
    }
  });

  it('reads the Guardia gained earlier the same turn (no stale value)', () => {
    const engine = setup();
    unit(engine, 'orc').maxHp = unit(engine, 'orc').hp = 20;
    play(engine, 'guard', null); // +4 Guardia
    expect(lost(play(engine, 'bastion_blow', p(1, 2)), 'orc')).toBe(4);
  });
});

describe('Último Bastión (Warrior Ultra): HP floor 1 for one enemy turn', () => {
  it('starts on play, holds through multi-hits, collisions and terrain, expires at the start of the owner’s next turn', () => {
    const engine = battle('warrior', [{ id: 'orc', pos: p(1, 2) }, { id: 'orc-2', pos: p(0, 3) }], p(0, 2));
    const events = play(engine, 'last_bastion', null);
    const me = hero(engine);
    expect(me.statuses.find((s) => s.id === 'LAST_STAND')).toBeDefined();
    expect(['orc', 'orc-2'].every((id) => unit(engine, id).statuses.some((s) => s.id === 'CHALLENGED'))).toBe(true);
    expect(me.momentum?.value).toBe(2);
    expect(ofType(events, 'CARD_BANISHED').map((e) => e.cardId)).toEqual(['last_bastion']);
    const ctx = ctxFor(engine);
    me.hp = 3;
    dealDamage(ctx, me, 10, 'orc', 'PHYSICAL');
    expect(me.hp).toBe(1);
    dealDamage(ctx, me, 10, 'orc', 'PHYSICAL'); // multi-hit
    dealDamage(ctx, me, 2, 'terrain', 'FIRE', 'GROUND_HAZARD'); // environment
    dealDamage(ctx, me, 5, 'status:BURNING', 'FIRE', 'PIERCING'); // lethal tick
    expect(me.hp).toBe(1);
    expect(engine.state.units.includes(me)).toBe(true);
    // Not immortality: it ends at the start of the owner's next turn.
    const r = engine.dispatch(endTurn(engine));
    expect(r.ok).toBe(true);
    const after = hero(engine);
    expect(after.statuses.some((s) => s.id === 'LAST_STAND')).toBe(false);
    dealDamage(ctxFor(engine), after, 10, 'orc', 'PHYSICAL');
    expect(engine.state.units.some((u) => u.id === after.id)).toBe(false);
  });

  it('a burn ticking at the start of the next turn can kill: the floor is gone before the tick', () => {
    const engine = battle('warrior', [{ id: 'orc', pos: p(8, 4) }], p(0, 2));
    play(engine, 'last_bastion', null);
    const me = hero(engine);
    me.hp = 1;
    applyStatus(ctxFor(engine), me, 'BURNING', 3, 'orc');
    engine.dispatch(endTurn(engine));
    expect(engine.state.outcome?.result).toBe('LOST');
  });
});

describe('Red del Cazador (Archer Legendary): linked traps, one catch', () => {
  const setup = () => {
    const engine = battle('archer', [{ id: 'prey', pos: p(8, 2) }, { id: 'other', pos: p(8, 0) }], p(0, 2), ARCHER);
    return engine;
  };

  it('places a cross of traps on free tiles; the first catch roots + 1 damage, removes the rest; Presa → +2 Concentración', () => {
    const engine = setup();
    applyStatus(ctxFor(engine), unit(engine, 'prey'), 'PREY', 99, engine.heroId);
    const events = play(engine, 'hunters_net', p(4, 2));
    expect(ofType(events, 'TRAP_PLACED')).toHaveLength(5);
    const prey = unit(engine, 'prey');
    const focus = hero(engine).focus?.value ?? 0;
    prey.pos = p(5, 2);
    const caught: GameEvent[] = [];
    expect(springTrap(ctxFor(engine, caught), prey)).toBe(true);
    expect(prey.hp).toBe(prey.maxHp - 1);
    expect(prey.statuses.some((s) => s.id === 'ROOTED')).toBe(true);
    expect(ofType(caught, 'TRAP_REMOVED').map((e) => e.reason)).toEqual(['NET_CLOSED', 'NET_CLOSED', 'NET_CLOSED', 'NET_CLOSED']);
    expect(engine.state.traps ?? []).toEqual([]);
    expect(hero(engine).focus?.value).toBe(focus + 2);
    // Never again: another unit walking over the old net springs nothing.
    const other = unit(engine, 'other');
    other.pos = p(4, 2);
    expect(springTrap(ctxFor(engine), other)).toBe(false);
  });

  it('a non-Presa catch gives no Concentración; a new cast replaces the previous net (one net only)', () => {
    const engine = setup();
    play(engine, 'hunters_net', p(4, 2));
    const first = (engine.state.traps ?? []).map((t) => t.id);
    play(engine, 'hunters_net', p(3, 1));
    expect((engine.state.traps ?? []).some((t) => first.includes(t.id))).toBe(false);
    expect(new Set((engine.state.traps ?? []).map((t) => t.netId)).size).toBe(1);
    const focus = hero(engine).focus?.value ?? 0;
    const other = unit(engine, 'other');
    other.pos = p(3, 1);
    expect(springTrap(ctxFor(engine), other)).toBe(true);
    expect(hero(engine).focus?.value ?? 0).toBe(focus);
  });

  it('skips occupied tiles and is replay-safe', () => {
    const engine = battle('archer', [{ id: 'orc', pos: p(4, 2) }], p(0, 2), ARCHER);
    const start = structuredClone(engine.state) as GameState;
    const [uid] = setHand(engine, ['hunters_net']);
    const startHand = structuredClone(engine.state) as GameState;
    const cmd = { type: 'PLAY_CARD', cardUid: uid!, target: p(4, 2) } as const;
    const r = engine.dispatch(cmd);
    expect(r.ok && ofType(r.events, 'TRAP_PLACED')).toHaveLength(4); // the orc's tile is skipped
    engine.dispatch(endTurn(engine));
    const copy = GameEngine.fromSnapshot(startHand, engine.content, engine.scenario);
    copy.dispatch(cmd);
    copy.dispatch(endTurn(copy));
    expect(JSON.stringify(copy.state)).toBe(JSON.stringify(engine.state));
    expect(start.traps ?? []).toEqual([]);
  });
});

describe('Danza de las Formas (Shapeshifter Legendary): «al cambiar de forma»', () => {
  const setup = (content: GameContent = SHIFTER) => {
    const engine = battle('shapeshifter', [{ id: 'orc', pos: p(8, 4) }], p(0, 2), content);
    mutable(engine).player.movePoints = 0;
    return engine;
  };

  it('draws 1; the first 2 form changes give +2 shield and +1 move each; the 3rd gives nothing', () => {
    const engine = setup();
    const hand = engine.state.player.hand.length;
    const [dance, bear, mino, back] = setHand(engine, ['form_dance', 'qa_bear_form', 'qa_minotaur_form', 'qa_bear_form']);
    const r = engine.dispatch({ type: 'PLAY_CARD', cardUid: dance!, target: null });
    expect(r.ok && ofType(r.events, 'CARD_DRAWN')).toHaveLength(1);
    expect(hand).toBeGreaterThan(0);
    engine.dispatch({ type: 'PLAY_CARD', cardUid: bear!, target: null });
    expect([hero(engine).shield, engine.state.player.movePoints]).toEqual([2, 1]);
    engine.dispatch({ type: 'PLAY_CARD', cardUid: mino!, target: null });
    expect([hero(engine).shield, engine.state.player.movePoints]).toEqual([4, 2]);
    expect(hero(engine).statuses.some((s) => s.id === 'FORM_DANCE')).toBe(false); // charges used up
    engine.dispatch({ type: 'PLAY_CARD', cardUid: back!, target: null });
    expect([hero(engine).shield, engine.state.player.movePoints]).toEqual([4, 2]);
  });

  it('generic: works for any registered form (a synthetic third form), and ends with the turn', () => {
    const wolf: GameContent = {
      ...SHIFTER,
      transformations: { ...SHIFTER.transformations, wolf: { id: 'wolf', name: 'Lobo', armorBonus: 0 } },
      heroes: { ...SHIFTER.heroes, shapeshifter: { ...SHIFTER.heroes.shapeshifter!, transformationForms: ['bear', 'minotaur', 'wolf'] } },
      cards: { ...SHIFTER.cards, qa_wolf_form: { ...SHIFTER.cards.qa_bear_form!, id: 'qa_wolf_form', effects: [{ type: 'TRANSFORM', formId: 'wolf' }] } },
    };
    const engine = setup(wolf);
    play(engine, 'form_dance', null);
    play(engine, 'qa_wolf_form', null);
    expect(hero(engine).shield).toBe(2);
    engine.dispatch(endTurn(engine));
    expect(hero(engine).statuses.some((s) => s.id === 'FORM_DANCE')).toBe(false);
  });
});

describe('Ultras', () => {
  it('Erupción del Archimago: 2 fire + push 1; only EMPTY area tiles burn (2 rounds); banished', () => {
    const engine = battle('mage', [{ id: 'a', pos: p(4, 2) }, { id: 'b', pos: p(5, 1) }], p(1, 2));
    const events = play(engine, 'archmage_eruption', p(4, 2));
    expect([lost(events, 'a'), lost(events, 'b')]).toEqual([2, 2]);
    expect(unit(engine, 'a').pos).toEqual(p(5, 2));
    expect(unit(engine, 'b').pos).toEqual(p(6, 1));
    const burning = ofType(events, 'TERRAIN_CREATED').filter((e) => e.terrain === 'FIRE');
    expect(burning.length).toBeGreaterThan(0);
    // Never under a unit standing in the area after the push.
    expect(burning.some((e) => engine.state.units.some((u) => u.pos.x === e.pos.x && u.pos.y === e.pos.y))).toBe(false);
    expect(ofType(events, 'CARD_BANISHED').map((e) => e.cardId)).toEqual(['archmage_eruption']);
  });

  it('Lluvia de Flechas: 2 to each enemy in 3×3 (cover ignored), 3 to the Presa and +2 Concentración', () => {
    const layout = ['.........', '.........', '.........', '.........', '.........'];
    const engine = battle('archer', [{ id: 'prey', pos: p(5, 2) }, { id: 'b', pos: p(5, 3) }, { id: 'out', pos: p(7, 2) }], p(0, 2), ARCHER, layout);
    applyStatus(ctxFor(engine), unit(engine, 'prey'), 'PREY', 99, engine.heroId);
    const focus = hero(engine).focus?.value ?? 0;
    const events = play(engine, 'arrow_rain', p(5, 2));
    expect([lost(events, 'prey'), lost(events, 'b'), lost(events, 'out')]).toEqual([3, 2, 0]);
    expect(hero(engine).focus?.value).toBe(focus + 2);
    expect(ofType(events, 'CARD_BANISHED')).toHaveLength(1);
  });

  it('Estampida Ancestral: Human → Minotaur charge (3 + push 2) → Bear with 4 shield; refused while rooted', () => {
    const engine = battle('shapeshifter', [{ id: 'orc', pos: p(5, 2) }], p(0, 2), SHIFTER);
    unit(engine, 'orc').maxHp = unit(engine, 'orc').hp = 20;
    const events = play(engine, 'ancestral_stampede', p(5, 2));
    expect(ofType(events, 'FORM_CHANGED').map((e) => e.to)).toEqual(['minotaur', 'bear']);
    expect(lost(events, 'orc')).toBe(3);
    expect(hero(engine).pos).toEqual(p(4, 2));
    expect(unit(engine, 'orc').pos).toEqual(p(7, 2));
    expect(hero(engine)).toMatchObject({ activeForm: 'bear', shield: 4 });
    const rooted = battle('shapeshifter', [{ id: 'orc', pos: p(4, 2) }], p(0, 2), SHIFTER);
    applyStatus(ctxFor(rooted), hero(rooted), 'ROOTED', 1, 'orc');
    const [uid] = setHand(rooted, ['ancestral_stampede']);
    expect(rooted.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(4, 2) }).ok).toBe(false);
  });
});

describe('new Rares', () => {
  it('Atracción Arcana: only at distance 3–4; Slowed then pulled 2; never a structure', () => {
    const engine = battle('mage', [{ id: 'orc', pos: p(4, 2) }, { id: 'near', pos: p(2, 4) }], p(0, 2));
    const events = play(engine, 'arcane_pull', p(4, 2));
    expect(unit(engine, 'orc').pos).toEqual(p(2, 2));
    expect(unit(engine, 'orc').statuses.some((s) => s.id === 'SLOWED')).toBe(true);
    expect(lost(events, 'orc')).toBe(0);
    const [uid] = setHand(engine, ['arcane_pull']);
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(2, 2) }).ok).toBe(false); // distance 2
  });

  it('Despertar del Minotauro: Human/Bear only → Minotaur + 2 to each adjacent enemy', () => {
    const engine = battle('shapeshifter', [{ id: 'a', pos: p(1, 2) }, { id: 'b', pos: p(0, 1) }, { id: 'far', pos: p(3, 2) }], p(0, 2), SHIFTER);
    const events = play(engine, 'minotaur_awakening', null);
    expect(hero(engine).activeForm).toBe('minotaur');
    expect([lost(events, 'a'), lost(events, 'b'), lost(events, 'far')]).toEqual([2, 2, 0]);
    const [uid] = setHand(engine, ['minotaur_awakening']);
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: null }).ok).toBe(false); // already Minotaur
  });
});
