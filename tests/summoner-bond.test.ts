import { describe, expect, it } from 'vitest';
import { createProfile, DEFAULT_CONTENT, GameEngine, SUMMONER_BOND_CARDS, TACTICAL_EXPANSION, withHeroDeck, type GameEvent, type GameState } from '../src/game';
import { replayBattle } from '../src/game/engine/replay';
import type { Command } from '../src/game/engine/commands';
import { applyDuel, createDuel, duelEvents, duelView, validateLoadout } from '../src/game/pvp/duel';
import { dealDamage } from '../src/game/domain/combat/damage';
import { actSummons, markedPrey, spawnSummon } from '../src/game/domain/summons/summons';
import { applyStatus, cleanseUnit } from '../src/game/domain/statuses/status-rules';
import type { ScenarioDef } from '../src/game/domain/scenario';
import { ctxFor, makeEngine, ofType, p, scenario, setHand, unit, endTurn } from './helpers';

type Spawn = { id: string; enemyId?: string; pos: { x: number; y: number } };

/** Summoner battle on a 7×5 board; enemies default to orcs (8 HP, melee 3). */
function battle(enemies: Spawn[], overrides: Partial<ScenarioDef> = {}): GameEngine {
  return makeEngine({
    hero: { heroId: 'summoner', pos: p(0, 2) },
    enemies: enemies.map((e) => ({ enemyId: 'orc_warrior', ...e })),
    ...overrides,
  });
}

/** A summon that may act this round (spawned summons normally wait one round). */
function summon(engine: GameEngine, summonId: string, pos: { x: number; y: number }) {
  const s = spawnSummon(ctxFor(engine), unit(engine, engine.heroId), summonId, pos);
  if (!s) throw new Error(`could not spawn ${summonId}`);
  s.summon!.readyRound = engine.state.round;
  return s;
}

const mark = (engine: GameEngine, targetId: string, duration = 1) =>
  applyStatus(ctxFor(engine), unit(engine, targetId), 'MARKED_PREY', duration, engine.heroId);

/** What the summons do at the end of the turn (same call as the real turn flow). */
function act(engine: GameEngine): GameEvent[] {
  const events: GameEvent[] = [];
  actSummons(ctxFor(engine, events));
  return events;
}
const attacks = (events: readonly GameEvent[]) => ofType(events, 'SUMMON_ATTACKED').map((e) => `${e.unitId}>${e.targetId}`);
const clone = (engine: GameEngine) => GameEngine.fromSnapshot(structuredClone(engine.state) as GameState, engine.content, scenario());

describe('Summoner bond cards: data', () => {
  it('three Summoner-only cards in the QA tactical set; no new rarity', () => {
    expect(SUMMONER_BOND_CARDS.map((c) => [c.id, c.cost, c.rarity])).toEqual([
      ['binder_strike', 1, 'COMMON'],
      ['binding_ward', 1, 'UNCOMMON'],
      ['mark_prey', 1, 'RARE'],
    ]);
    for (const c of SUMMONER_BOND_CARDS) {
      expect(c.heroId).toBe('summoner');
      expect(c.expansion).toBe(TACTICAL_EXPANSION);
    }
  });

  it('other champions cannot play them', () => {
    const engine = makeEngine({ hero: { heroId: 'warrior', pos: p(1, 2) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(2, 2) }] });
    const [uid] = setHand(engine, ['binder_strike']);
    expect(engine.getCardPlayability(uid!)).toMatchObject({ playable: false });
  });
});

describe('Golpe del Vinculador', () => {
  const setup = () => {
    const engine = battle([{ id: 'orc-1', pos: p(1, 2) }, { id: 'orc-2', pos: p(4, 0) }]);
    const [uid] = setHand(engine, ['binder_strike']);
    return { engine, uid: uid! };
  };
  const strike = (engine: GameEngine, uid: string) => {
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: uid, target: p(1, 2) }).ok).toBe(true);
    return 8 - unit(engine, 'orc-1').hp;
  };

  it('2 damage to an adjacent enemy normally (melee only)', () => {
    const { engine, uid } = setup();
    expect(engine.getValidTargets(uid)).toEqual([p(1, 2)]);
    expect(strike(engine, uid)).toBe(2);
  });

  it('3 damage when one of your summons is next to the target', () => {
    const { engine, uid } = setup();
    summon(engine, 'fox', p(1, 1));
    expect(strike(engine, uid)).toBe(3);
  });

  it('a second adjacent summon adds nothing (flat bonus)', () => {
    const { engine, uid } = setup();
    summon(engine, 'chicken', p(1, 1));
    summon(engine, 'chicken', p(1, 3));
    expect(strike(engine, uid)).toBe(3);
  });

  it('no false bonus: summon only next to the caster / diagonal to the target / far away', () => {
    for (const pos of [p(0, 1), p(2, 1), p(5, 4)]) {
      const { engine, uid } = setup();
      summon(engine, 'fox', pos);
      expect(strike(engine, uid)).toBe(2);
    }
  });

  it("no false bonus from the rival's summon next to the target (PvP: only YOUR summons count)", () => {
    const profile = createProfile(DEFAULT_CONTENT);
    let state = createDuel([validateLoadout(profile, 'summoner'), validateLoadout(profile, 'summoner')], 5);
    const me = state.units.find((u) => u.id === state.player.heroId)!;
    const rival = state.units.find((u) => u.id === state.duel!.other.heroId)!;
    me.pos = { x: 3, y: 2 };
    rival.pos = { x: 4, y: 2 };
    state.player.energy = 5;
    // The rival's own summon stands next to the rival champion.
    const ctx = { state, content: DEFAULT_CONTENT, emit: () => {} };
    spawnSummon(ctx, rival, 'fox', { x: 4, y: 1 });
    state.player.hand = [{ uid: 'hit', cardId: 'binder_strike' }];
    state = applyDuel(state, { type: 'PLAY_CARD', cardUid: 'hit', target: { x: 4, y: 2 } }).state;
    expect(state.units.find((u) => u.id === rival.id)!.hp).toBe(rival.maxHp - 2);
  });

  it('the dry-run preview shows the bonus before playing', () => {
    const { engine, uid } = setup();
    summon(engine, 'fox', p(2, 2));
    const preview = engine.previewCard(uid, p(1, 2));
    expect(ofType(preview.predictedEvents, 'UNIT_DAMAGED')[0]).toMatchObject({ unitId: 'orc-1', hpLost: 3 });
  });
});

describe('Vínculo Protector', () => {
  const shieldWith = (summons: string[]) => {
    const engine = battle([{ id: 'orc-1', pos: p(6, 4) }]);
    summons.forEach((id, i) => summon(engine, id, p(2, i)));
    const [uid] = setHand(engine, ['binding_ward']);
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: null }).ok).toBe(true);
    return unit(engine, engine.heroId).shield;
  };

  it('3 shield without a summon', () => expect(shieldWith([])).toBe(3));
  it('5 shield with one summon', () => expect(shieldWith(['fox'])).toBe(5));
  it('still 5 with two summons (never scales with the army)', () => expect(shieldWith(['chicken', 'fox'])).toBe(5));

  it('normal Shield semantics: two copies add up like two Barriers, and all of it ends at your next turn', () => {
    const engine = battle([{ id: 'orc-1', pos: p(6, 4) }]);
    summon(engine, 'fox', p(2, 2));
    const [a, b] = setHand(engine, ['binding_ward', 'binding_ward']);
    engine.dispatch({ type: 'PLAY_CARD', cardUid: a!, target: null });
    engine.dispatch({ type: 'PLAY_CARD', cardUid: b!, target: null });
    expect(unit(engine, engine.heroId).shield).toBe(10);
    engine.dispatch(endTurn(engine));
    expect(unit(engine, engine.heroId).shield).toBe(0);
  });
});

describe('Marcar Presa: the mark', () => {
  it('marks a visible enemy at range 4 with line of sight; never an ally or an out-of-sight enemy', () => {
    const engine = battle(
      [{ id: 'near', pos: p(3, 2) }, { id: 'far', pos: p(6, 0) }, { id: 'hidden', pos: p(3, 4) }],
      { layout: ['.......', '.......', '.......', '.#.....', '.......'], hero: { heroId: 'summoner', pos: p(1, 4) } },
    );
    summon(engine, 'fox', p(0, 4));
    const [uid] = setHand(engine, ['mark_prey']);
    const targets = engine.getValidTargets(uid!);
    expect(targets).toContainEqual(p(3, 2));
    expect(targets).toContainEqual(p(3, 4));
    expect(targets).not.toContainEqual(p(6, 0)); // distance 9
    expect(targets).not.toContainEqual(p(0, 4)); // own summon
  });

  it('records who marked it, is public and visible as a status', () => {
    const engine = battle([{ id: 'orc-1', pos: p(3, 2) }]);
    const [uid] = setHand(engine, ['mark_prey']);
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(3, 2) }).ok).toBe(true);
    expect(unit(engine, 'orc-1').statuses).toEqual([{ id: 'MARKED_PREY', turnsLeft: 3, sourceId: engine.heroId }]);
  });

  it('one prey at a time: a new mark moves it (no second marked unit)', () => {
    const engine = battle([{ id: 'a', pos: p(3, 2) }, { id: 'b', pos: p(2, 0) }]);
    const [m1, m2] = setHand(engine, ['mark_prey', 'mark_prey']);
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: m1!, target: p(3, 2) }).ok).toBe(true);
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: m2!, target: p(2, 0) }).ok).toBe(true);
    expect(unit(engine, 'a').statuses).toEqual([]);
    expect(unit(engine, 'b').statuses.map((s) => s.id)).toEqual(['MARKED_PREY']);
  });

  it('ends on death: no stale reference anywhere', () => {
    const engine = battle([{ id: 'a', pos: p(3, 2) }, { id: 'b', pos: p(4, 4) }]);
    const fox = summon(engine, 'fox', p(1, 2));
    mark(engine, 'a');
    expect(markedPrey(ctxFor(engine), fox)?.id).toBe('a');
    dealDamage(ctxFor(engine), unit(engine, 'a'), 99, 'test', 'PHYSICAL');
    expect(engine.state.units.some((u) => u.statuses.some((s) => s.id === 'MARKED_PREY'))).toBe(false);
    expect(markedPrey(ctxFor(engine), fox)).toBeUndefined();
    // The summons simply go back to their normal behaviour.
    expect(attacks(act(engine))).toEqual([`${fox.id}>b`]);
  });

  it('lasts 3 full turns (summons use it every round), then expires; a cleanse removes it', () => {
    const engine = battle([{ id: 'orc-1', pos: p(4, 2) }, { id: 'orc-2', pos: p(6, 4) }]);
    unit(engine, 'orc-1').maxHp = unit(engine, 'orc-1').hp = 99; // (arrange) survives three rounds of bites
    const fox = summon(engine, 'fox', p(5, 3));
    const [uid] = setHand(engine, ['mark_prey']);
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(4, 2) }).ok).toBe(true);
    const events: GameEvent[] = [];
    engine.subscribe((evs) => events.push(...evs));
    for (const left of [2, 1]) {
      engine.dispatch(endTurn(engine));
      expect(unit(engine, 'orc-1').statuses.find((s) => s.id === 'MARKED_PREY')?.turnsLeft).toBe(left);
    }
    engine.dispatch(endTurn(engine));
    expect(attacks(events).filter((a) => a === `${fox.id}>orc-1`).length).toBeGreaterThanOrEqual(3);
    expect(ofType(events, 'STATUS_REMOVED')).toContainEqual(expect.objectContaining({ unitId: 'orc-1', status: 'MARKED_PREY', reason: 'EXPIRED' }));
    expect(engine.state.units.some((u) => u.statuses.some((s) => s.id === 'MARKED_PREY'))).toBe(false);

    const other = battle([{ id: 'orc-1', pos: p(5, 2) }]);
    mark(other, 'orc-1');
    expect(cleanseUnit(ctxFor(other), unit(other, 'orc-1'))).toBe(1);
  });
});

describe('Marcar Presa: summon AI (target preference, not manual control)', () => {
  it('a summon attacks the marked prey it can reach instead of the closer enemy', () => {
    // Fox at (3,2): orc-near is adjacent, the prey needs a 2-step walk.
    const base = battle([{ id: 'near', pos: p(4, 2) }, { id: 'prey', pos: p(3, 4) }]);
    const fox = summon(base, 'fox', p(3, 2));
    const unmarked = clone(base);
    expect(attacks(act(unmarked))).toEqual([`${fox.id}>near`]);
    mark(base, 'prey');
    expect(attacks(act(base))).toEqual([`${fox.id}>prey`]);
    expect(unit(base, 'prey').hp).toBe(6);
  });

  it('every species focuses the prey when it can: fox, wolf, raven (from range), turtle, ash hound, chicken', () => {
    for (const [species, from] of [
      ['fox', p(2, 2)],
      ['wolf', p(3, 1)],
      ['raven', p(2, 1)],
      ['turtle', p(4, 1)],
      ['ash_hound', p(2, 2)],
      ['chicken', p(2, 2)],
    ] as const) {
      const engine = battle([{ id: 'near', pos: p(4, 2) }, { id: 'prey', pos: p(4, 0) }]);
      const s = summon(engine, species, from);
      mark(engine, 'prey');
      expect([species, attacks(act(engine))]).toEqual([species, [`${s.id}>prey`]]);
    }
  });

  it('identity kept: the chicken still pecks and retreats; the raven still shoots from 2–3', () => {
    const engine = battle([{ id: 'near', pos: p(2, 2) }, { id: 'prey', pos: p(4, 0) }]);
    const chicken = summon(engine, 'chicken', p(3, 2));
    mark(engine, 'prey');
    const events = act(engine);
    expect(attacks(events)).toEqual([`${chicken.id}>prey`]);
    const moves = ofType(events, 'UNIT_MOVED').filter((e) => e.unitId === chicken.id);
    expect(moves).toHaveLength(2); // approach, then the usual retreat
    expect(Math.min(...engine.state.units.filter((u) => u.faction === 'ENEMY').map((u) => Math.abs(u.pos.x - chicken.pos.x) + Math.abs(u.pos.y - chicken.pos.y)))).toBeGreaterThan(1);

    const ranged = battle([{ id: 'near', pos: p(2, 2) }, { id: 'prey', pos: p(5, 2) }]);
    const raven = summon(ranged, 'raven', p(1, 1));
    mark(ranged, 'prey');
    act(ranged);
    const d = Math.abs(raven.pos.x - 5) + Math.abs(raven.pos.y - 2);
    expect(d).toBeGreaterThanOrEqual(2);
    expect(d).toBeLessThanOrEqual(3);
    expect(unit(ranged, 'prey').hp).toBe(7);
  });

  it('pursuit: out of reach this activation → it closes in on the prey instead of the closer enemy', () => {
    const engine = battle([{ id: 'near', pos: p(1, 0) }, { id: 'prey', pos: p(6, 4) }]);
    const turtle = summon(engine, 'turtle', p(1, 2)); // moves 1: cannot get next to the prey this turn
    const unmarked = clone(engine);
    mark(engine, 'prey', 3);
    act(engine);
    act(unmarked);
    const d = (u: { pos: { x: number; y: number } }) => Math.abs(u.pos.x - 6) + Math.abs(u.pos.y - 4);
    expect(d(unit(engine, turtle.id))).toBe(d({ pos: p(1, 2) }) - 1);
    expect(d(unit(unmarked, turtle.id))).toBeGreaterThanOrEqual(d({ pos: p(1, 2) }));
    // Still attacks what is in reach after moving (pursuit never wastes the attack).
    expect(unit(engine, 'prey').hp).toBe(8);
  });

  it('pursuit over turns: a slow summon reaches and bites the prey before the 3-turn mark ends', () => {
    const engine = battle([{ id: 'prey', pos: p(5, 2) }], { layout: ['.......', '.......', '.......', '.......', '.......'] });
    unit(engine, 'prey').moveRange = 0; // (arrange) a stationary prey
    const turtle = summon(engine, 'turtle', p(1, 2));
    mark(engine, 'prey', 3);
    const events: GameEvent[] = [];
    for (let k = 0; k < 3; k++) {
      events.push(...act(engine));
      (engine.state as GameState).round++;
    }
    expect(attacks(events)).toContain(`${turtle.id}>prey`);
  });

  it('no valid route (walled off) → exactly the normal behaviour', () => {
    const engine = battle([{ id: 'near', pos: p(2, 2) }, { id: 'prey', pos: p(6, 0) }], {
      layout: ['.....#.', '.....##', '.......', '.......', '.......'],
      hero: { heroId: 'summoner', pos: p(0, 4) },
    });
    summon(engine, 'turtle', p(1, 2));
    summon(engine, 'chicken', p(0, 0));
    const unmarked = clone(engine);
    mark(engine, 'prey', 3);
    expect(attacks(act(engine))).toEqual(attacks(act(unmarked)));
    expect(engine.state.units.map((u) => [u.id, u.pos, u.hp])).toEqual(unmarked.state.units.map((u) => [u.id, u.pos, u.hp]));
  });

  it('never walks across or onto hazards to reach the prey, never through units', () => {
    // The prey sits in a corner ringed by fire; the fox would have to stand on fire.
    const engine = battle([{ id: 'near', pos: p(2, 2) }, { id: 'prey', pos: p(6, 0) }], {
      layout: ['.....F.', '......F', '.......', '.......', '.......'],
      hero: { heroId: 'summoner', pos: p(0, 4) },
    });
    const fox = summon(engine, 'fox', p(3, 1));
    const unmarked = clone(engine);
    mark(engine, 'prey');
    const events = act(engine);
    expect(attacks(events)).toEqual(attacks(act(unmarked)));
    expect(unit(engine, fox.id).pos).toEqual(unit(unmarked, fox.id).pos);
    expect(unit(engine, 'prey').hp).toBe(8);
  });

  it('a Rooted or Stunned summon cannot be dragged to the prey (statuses still win)', () => {
    const engine = battle([{ id: 'near', pos: p(4, 2) }, { id: 'prey', pos: p(3, 4) }]);
    const fox = summon(engine, 'fox', p(3, 2));
    applyStatus(ctxFor(engine), fox, 'ROOTED', 1, 'test');
    mark(engine, 'prey');
    expect(attacks(act(engine))).toEqual([`${fox.id}>near`]);
    expect(fox.pos).toEqual(p(3, 2));
  });

  it("an enemy hero's own mark is not a command: marks only steer the marker's summons", () => {
    const engine = battle([{ id: 'near', pos: p(4, 2) }, { id: 'prey', pos: p(3, 4) }]);
    const fox = summon(engine, 'fox', p(3, 2));
    applyStatus(ctxFor(engine), unit(engine, 'prey'), 'MARKED_PREY', 1, 'someone-else');
    expect(attacks(act(engine))).toEqual([`${fox.id}>near`]);
  });
});

describe('Marcar Presa: determinism, replay, PvP authority', () => {
  it('replay reproduces the exact same summon decisions (twice, and the headless server replay)', () => {
    const sc = scenario({
      hero: { heroId: 'summoner', pos: p(0, 2) },
      enemies: [{ id: 'near', enemyId: 'orc_warrior', pos: p(5, 2) }, { id: 'prey', enemyId: 'orc_warrior', pos: p(5, 0) }],
    });
    const deck = [{ cardId: 'summon_fox', count: 10 }, { cardId: 'mark_prey', count: 10 }, { cardId: 'summon_chicken', count: 10 }];
    const content = withHeroDeck(DEFAULT_CONTENT, 'summoner', deck);
    const run = (fixed?: readonly Command[]) => {
      const engine = new GameEngine(sc, content, 3);
      const log: string[] = [];
      engine.subscribe((evs) => log.push(...attacks(evs).map((a) => `r${engine.state.round} ${a}`)));
      const cmds: Command[] = [];
      const send = (c: Command) => {
        expect(engine.dispatch(c).ok).toBe(true);
        cmds.push(c);
      };
      if (fixed) for (const c of fixed) send(c);
      else
        for (let turn = 0; turn < 4 && !engine.state.outcome; turn++) {
          for (const card of [...engine.state.player.hand]) {
            if (!engine.getCardPlayability(card.uid).playable) continue;
            const targets = engine.getValidTargets(card.uid);
            const prey = engine.state.units.find((u) => u.id === 'prey');
            const target = card.cardId === 'mark_prey' ? (prey && targets.find((t) => t.x === prey.pos.x && t.y === prey.pos.y)) : targets[0];
            if (target) send({ type: 'PLAY_CARD', cardUid: card.uid, target });
          }
          send({ type: 'END_TURN' });
        }
      return { state: engine.state, log, cmds };
    };
    const a = run();
    const b = run(a.cmds);
    expect(b.log).toEqual(a.log);
    expect(b.state).toEqual(a.state);
    expect(a.log.some((x) => x.endsWith('>prey'))).toBe(true);
    const headless = replayBattle(sc, content, 3, a.cmds);
    expect(headless.rejectedAt).toBeNull();
    expect(headless.state).toEqual(a.state);
  });

  it('PvP: the server applies the mark, both seats see it (public), summons act authoritatively', () => {
    const profile = createProfile(DEFAULT_CONTENT);
    let state = createDuel([validateLoadout(profile, 'summoner'), validateLoadout(profile, 'mage')], 9);
    if (state.player.heroId !== 'champion-a') state = applyDuel(state, endTurn(state)).state;
    const me = state.units.find((u) => u.id === 'champion-a')!;
    const rival = state.units.find((u) => u.id === 'champion-b')!;
    me.pos = { x: 1, y: 2 };
    rival.pos = { x: 4, y: 2 };
    state.player.energy = 9;
    state.player.hand = [
      { uid: 'fox', cardId: 'summon_fox' },
      { uid: 'mark', cardId: 'mark_prey' },
    ];
    state = applyDuel(state, { type: 'PLAY_CARD', cardUid: 'fox', target: { x: 2, y: 2 } }).state;
    const fox = state.units.find((u) => u.kind === 'SUMMON')!;
    fox.summon!.readyRound = state.round;
    const marked = applyDuel(state, { type: 'PLAY_CARD', cardUid: 'mark', target: { x: 4, y: 2 } });
    state = marked.state;
    for (const seat of [0, 1] as const) {
      const view = duelView(state, seat);
      expect(view.units.find((u) => u.id === rival.id)!.statuses).toEqual([{ id: 'MARKED_PREY', turnsLeft: 3, sourceId: me.id }]);
      expect(duelEvents(state, seat, marked.events).some((e) => e.type === 'STATUS_APPLIED' && e.status === 'MARKED_PREY')).toBe(true);
      // The rival seat learns nothing private: no hand, no deck order.
      if (seat === 1) expect(view.player.hand.some((c) => c.uid === 'fox' || c.uid === 'mark')).toBe(false);
    }
    const end = applyDuel(state, endTurn(state));
    expect(ofType(end.events, 'SUMMON_ATTACKED')).toContainEqual(expect.objectContaining({ unitId: fox.id, targetId: rival.id }));
    // The mark is on the rival: it counts down at the end of the rival's own turns (3 of them).
    let after = end.state;
    for (let turn = 0; turn < 5; turn++) {
      after = applyDuel(after, endTurn(after)).state;
      if (turn < 4) expect(after.units.find((u) => u.id === rival.id)!.statuses.some((s) => s.id === 'MARKED_PREY'), `turn ${turn}`).toBe(true);
    }
    expect(after.units.find((u) => u.id === rival.id)!.statuses.some((s) => s.id === 'MARKED_PREY')).toBe(false);
  });

  it('a client cannot steer summons: there is no command for it, only the card', () => {
    const profile = createProfile(DEFAULT_CONTENT);
    const state = createDuel([validateLoadout(profile, 'summoner'), validateLoadout(profile, 'mage')], 9);
    expect(() => applyDuel(state, { type: 'MARK_PREY', targetId: 'champion-b' } as unknown as Command)).toThrow();
    // An out-of-range mark is refused by the server like any illegal target.
    state.player.hand = [{ uid: 'mark', cardId: 'mark_prey' }];
    state.player.energy = 5;
    const me = state.units.find((u) => u.id === state.player.heroId)!;
    const rival = state.units.find((u) => u.id === state.duel!.other.heroId)!;
    me.pos = { x: 0, y: 0 };
    rival.pos = { x: 6, y: 4 };
    expect(() => applyDuel(state, { type: 'PLAY_CARD', cardUid: 'mark', target: rival.pos })).toThrow();
  });
});
