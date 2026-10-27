import { describe, expect, it } from 'vitest';
import { replayBattle } from '../src/game/engine/replay';
import { GameEngine } from '../src/game/engine/GameEngine';
import { DEFAULT_CONTENT } from '../src/game/data';
import { hasLineOfSight } from '../src/game/domain/board/line-of-sight';
import { queryContext } from '../src/game/domain/context';
import { posKey } from '../src/game/domain/core/position';
import type { MechanismBoardDef } from '../src/game/domain/mechanisms/mechanism';
import { mechanismById } from '../src/game/domain/mechanisms/mechanism-board';
import { syncMechanisms } from '../src/game/domain/mechanisms/mechanism-rules';
import { spawnSummon } from '../src/game/domain/summons/summons';
import { actSummons } from '../src/game/domain/summons/summons';
import type { ScenarioDef } from '../src/game/domain/scenario';
import { parseCommand } from '../src/game/run/verify';
import { ctxFor, endTurn, makeEngine, mutable, ofType, p, unit } from './helpers';

const QUIET: Partial<ScenarioDef> = { enemies: [], objectives: [{ type: 'SURVIVE_ROUNDS', rounds: 30 }] };

function withMechanisms(mechanisms: MechanismBoardDef, overrides: Partial<ScenarioDef> = {}, content = DEFAULT_CONTENT): GameEngine {
  return makeEngine({ ...QUIET, mechanisms, ...overrides }, content);
}

const m = (e: GameEngine, id: string) => mechanismById(e.state, id)!;
const settle = (e: GameEngine) => syncMechanisms(queryContext(mutable(e), e.content));
const reachable = (e: GameEngine) => new Set(e.getLegalMoves().map((n) => posKey(n.pos)));
const interact = (e: GameEngine, mechanismId: string) => e.dispatch({ type: 'INTERACT', mechanismId });

const SWITCH_GATE = (toggle = false): MechanismBoardDef => ({
  objects: [
    { id: 'lever', kind: 'SWITCH', pos: p(1, 1), toggle },
    { id: 'gate', kind: 'GATE', pos: p(3, 2) },
  ],
  rules: [{ id: 'r', trigger: { type: 'ON_INTERACT', sources: ['lever'] }, actions: [{ type: toggle ? 'TOGGLE' : 'OPEN', targets: ['gate'] }] }],
});

// A wall on column 3 with one doorway (3,2): the gate.
const WALLED = ['...#...', '...#...', '.......', '...#...', '...#...'];

describe('Act III interactive battlefield — engine', () => {
  it('a static scenario never grows a mechanisms field (older states byte-identical)', () => {
    const e = makeEngine(QUIET);
    expect('mechanisms' in e.state).toBe(false);
    expect(e.getInteractions()).toEqual([]);
    expect(e.getMechanismView()).toBeNull();
  });

  it('switch opens gate: event chain, no energy, no movement spent', () => {
    const e = withMechanisms(SWITCH_GATE(), { layout: WALLED, hero: { heroId: 'mage', pos: p(1, 2) } });
    const energy = e.state.player.energy;
    const mp = e.state.player.movePoints;
    expect(e.getInteractions()[0]).toMatchObject({ mechanismId: 'lever', verb: 'ACTIVAR', adjacent: true, allowed: true });
    const r = interact(e, 'lever');
    expect(r.ok).toBe(true);
    const cues = ofType(r.events, 'MECHANISM_CHANGED').map((x) => [x.cue, x.mechanismId, x.causeId]);
    expect(cues).toEqual([
      ['SWITCH_ACTIVATED', 'lever', undefined],
      ['GATE_OPENED', 'gate', 'lever'],
    ]);
    expect(m(e, 'gate').state).toBe('OPEN');
    expect(e.state.player.energy).toBe(energy);
    expect(e.state.player.movePoints).toBe(mp);
  });

  it('closed gate blocks the path; open gate allows it (pathfinding reacts immediately)', () => {
    const e = withMechanisms(SWITCH_GATE(), { layout: WALLED, hero: { heroId: 'mage', pos: p(1, 2) } });
    expect(reachable(e).has('3,2')).toBe(false);
    expect(reachable(e).has('4,2')).toBe(false);
    interact(e, 'lever');
    expect(reachable(e).has('3,2')).toBe(true);
    expect(reachable(e).has('4,2')).toBe(true);
  });

  it('a closed gate blocks line of sight; open it and it does not', () => {
    const e = withMechanisms(SWITCH_GATE(), { layout: WALLED, hero: { heroId: 'mage', pos: p(1, 2) } });
    const ctx = queryContext(mutable(e), e.content);
    expect(hasLineOfSight(ctx, p(1, 2), p(5, 2))).toBe(false);
    interact(e, 'lever');
    expect(hasLineOfSight(queryContext(mutable(e), e.content), p(1, 2), p(5, 2))).toBe(true);
  });

  it('enemy AI paths through the gate only once it is open', () => {
    const e = withMechanisms(SWITCH_GATE(), {
      layout: WALLED,
      hero: { heroId: 'mage', pos: p(1, 2) },
      enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(6, 2) }],
    });
    e.dispatch(endTurn(e));
    expect(unit(e, 'orc-1').pos.x).toBeGreaterThan(3); // stuck on its side
    interact(e, 'lever');
    e.dispatch(endTurn(e));
    expect(unit(e, 'orc-1').pos.x).toBeLessThanOrEqual(3); // came through
  });

  it('switch toggles if configured; one interaction per turn', () => {
    const e = withMechanisms(SWITCH_GATE(true), { layout: WALLED, hero: { heroId: 'mage', pos: p(1, 2) } });
    expect(interact(e, 'lever').ok).toBe(true);
    expect(m(e, 'gate').state).toBe('OPEN');
    const again = interact(e, 'lever');
    expect(again).toMatchObject({ ok: false, error: 'INTERACTION_USED' });
    e.dispatch(endTurn(e));
    expect(e.getInteractions()[0]).toMatchObject({ verb: 'DESACTIVAR', allowed: true });
    expect(interact(e, 'lever').ok).toBe(true);
    expect(m(e, 'gate').state).toBe('CLOSED');
    expect(m(e, 'lever').state).toBe('OFF');
  });

  it('one-way switch cannot be used twice; not adjacent is refused by the engine', () => {
    const e = withMechanisms(SWITCH_GATE(false), { layout: WALLED, hero: { heroId: 'mage', pos: p(0, 4) } });
    expect(interact(e, 'lever')).toMatchObject({ ok: false, error: 'NOT_ADJACENT' });
    expect(e.getInteractions()[0]).toMatchObject({ adjacent: false, allowed: false, reason: 'NOT_ADJACENT' });
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(1, 2) });
    expect(interact(e, 'lever').ok).toBe(true);
    e.dispatch(endTurn(e));
    expect(interact(e, 'lever')).toMatchObject({ ok: false, error: 'NOT_INTERACTABLE' });
  });

  it('moving then interacting then playing a card stays within the normal turn economy', () => {
    const e = withMechanisms(SWITCH_GATE(), { layout: WALLED, hero: { heroId: 'mage', pos: p(0, 2) } });
    expect(e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(1, 2) }).ok).toBe(true);
    const mpAfterMove = e.state.player.movePoints;
    expect(interact(e, 'lever').ok).toBe(true);
    // Interaction did not refund or spend MP or energy; a second interaction is refused.
    expect(e.state.player.movePoints).toBe(mpAfterMove);
    expect(e.state.player.energy).toBe(e.state.player.maxEnergy);
    expect(interact(e, 'lever').ok).toBe(false);
  });

  it('an object with energyCost charges it, and refuses without energy', () => {
    const def = SWITCH_GATE();
    const e = withMechanisms({ ...def, objects: [{ ...def.objects[0]!, energyCost: 2 }, def.objects[1]!] }, { layout: WALLED, hero: { heroId: 'mage', pos: p(1, 2) } });
    mutable(e).player.energy = 1;
    expect(interact(e, 'lever')).toMatchObject({ ok: false, error: 'NOT_ENOUGH_ENERGY' });
    mutable(e).player.energy = 3;
    expect(interact(e, 'lever').ok).toBe(true);
    expect(e.state.player.energy).toBe(1);
  });

  const PLATE_BRIDGE = (accepts?: ('HERO' | 'SUMMON' | 'MOVABLE_OBJECT' | 'ANY_UNIT')[]): MechanismBoardDef => ({
    objects: [
      { id: 'plate', kind: 'PRESSURE_PLATE', pos: p(1, 2), ...(accepts ? { accepts } : {}) },
      { id: 'bridge', kind: 'BRIDGE', pos: p(3, 2) },
    ],
    rules: [
      { id: 'down', trigger: { type: 'ON_OCCUPIED', sources: ['plate'] }, actions: [{ type: 'LOWER', targets: ['bridge'] }] },
      { id: 'up', trigger: { type: 'ON_VACATED', sources: ['plate'] }, actions: [{ type: 'RAISE', targets: ['bridge'] }] },
    ],
  });
  // Chasm on column 3 except the bridge tile.
  const CHASM = ['...x...', '...x...', '.......', '...x...', '...x...'];

  it('plate activates on enter, deactivates on leave; bridge traversal follows', () => {
    const e = withMechanisms(PLATE_BRIDGE(), { layout: CHASM, hero: { heroId: 'mage', pos: p(0, 2) } });
    expect(reachable(e).has('3,2')).toBe(false);
    const on = e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(1, 2) });
    expect(ofType(on.events, 'MECHANISM_CHANGED').map((x) => x.cue)).toEqual(['PLATE_PRESSED', 'BRIDGE_LOWERED']);
    expect(m(e, 'plate').active).toBe(true);
    expect(reachable(e).has('3,2')).toBe(true);
    const off = e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(1, 1) });
    expect(ofType(off.events, 'MECHANISM_CHANGED').map((x) => x.cue)).toEqual(['PLATE_RELEASED', 'BRIDGE_RAISED']);
    expect(m(e, 'bridge').state).toBe('RAISED');
  });

  it('walking across a plate without stopping does not press it', () => {
    const e = withMechanisms(PLATE_BRIDGE(), { layout: CHASM, hero: { heroId: 'mage', pos: p(0, 2) } });
    const r = e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(2, 2) });
    expect(ofType(r.events, 'MECHANISM_CHANGED')).toEqual([]);
    expect(m(e, 'bridge').state).toBe('RAISED');
  });

  it('summon can activate an allowed plate and holds it on its own turn', () => {
    const e = withMechanisms(PLATE_BRIDGE(), { layout: CHASM, hero: { heroId: 'summoner', pos: p(0, 0) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(6, 4) }] });
    const ctx = ctxFor(e);
    const chicken = spawnSummon(ctx, unit(e, 'summoner'), 'chicken', p(1, 2))!;
    settle(e);
    expect(m(e, 'plate').active).toBe(true);
    expect(m(e, 'bridge').state).toBe('LOWERED');
    chicken.summon!.readyRound = 1;
    actSummons(ctx);
    expect(chicken.pos).toEqual(p(1, 2)); // a scout would walk off; on a plate it holds
  });

  it('summon is rejected by a HERO_ONLY plate (and does not hold it)', () => {
    const e = withMechanisms(PLATE_BRIDGE(['HERO']), { layout: CHASM, hero: { heroId: 'summoner', pos: p(0, 0) } });
    spawnSummon(ctxFor(e), unit(e, 'summoner'), 'chicken', p(1, 2));
    settle(e);
    expect(m(e, 'plate').active).toBe(false);
    expect(m(e, 'bridge').state).toBe('RAISED');
  });

  const STATUE_PLATE: MechanismBoardDef = {
    objects: [
      { id: 'plate', kind: 'PRESSURE_PLATE', pos: p(3, 2) },
      { id: 'statue', kind: 'STATUE', pos: p(2, 2) },
      { id: 'gate', kind: 'GATE', pos: p(5, 2) },
    ],
    rules: [
      { id: 'open', trigger: { type: 'ON_OCCUPIED', sources: ['plate'] }, actions: [{ type: 'OPEN', targets: ['gate'] }] },
      { id: 'close', trigger: { type: 'ON_VACATED', sources: ['plate'] }, actions: [{ type: 'CLOSE', targets: ['gate'] }] },
    ],
  };

  it('movable block activates a plate (push 1 cardinal tile away from the champion)', () => {
    const e = withMechanisms(STATUE_PLATE, { hero: { heroId: 'mage', pos: p(1, 2) } });
    const opt = e.getInteractions().find((o) => o.mechanismId === 'statue')!;
    expect(opt).toMatchObject({ verb: 'EMPUJAR', allowed: true, pushTo: p(3, 2) });
    const r = interact(e, 'statue');
    expect(ofType(r.events, 'MECHANISM_CHANGED').map((x) => x.cue)).toEqual(['STATUE_PUSHED', 'PLATE_PRESSED', 'GATE_OPENED']);
    expect(m(e, 'statue').pos).toEqual(p(3, 2));
    expect(m(e, 'gate').state).toBe('OPEN');
    // The statue is solid: the champion cannot walk through it.
    expect(reachable(e).has('3,2')).toBe(false);
  });

  it('movable object cannot overlap a unit, a wall or leave the board', () => {
    const e = withMechanisms(STATUE_PLATE, { hero: { heroId: 'mage', pos: p(1, 2) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(3, 2) }] });
    expect(interact(e, 'statue')).toMatchObject({ ok: false, error: 'PUSH_BLOCKED' });
    expect(m(e, 'statue').pos).toEqual(p(2, 2));
    const edge = withMechanisms({ objects: [{ id: 'statue', kind: 'STATUE', pos: p(0, 2) }], rules: [] }, { hero: { heroId: 'mage', pos: p(1, 2) } });
    expect(interact(edge, 'statue')).toMatchObject({ ok: false, error: 'PUSH_BLOCKED' });
    const wall = withMechanisms({ objects: [{ id: 'statue', kind: 'STATUE', pos: p(2, 2) }], rules: [] }, { layout: ['.......', '.......', '...#...', '.......', '.......'], hero: { heroId: 'mage', pos: p(1, 2) } });
    expect(interact(wall, 'statue')).toMatchObject({ ok: false, error: 'PUSH_BLOCKED' });
  });

  it('gate cannot close on an occupied tile: the close waits, then applies (deterministic)', () => {
    const e = withMechanisms(STATUE_PLATE, { hero: { heroId: 'mage', pos: p(3, 1) } });
    // Press the plate with the champion, then step off it INTO the open gate tile.
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(3, 2) });
    expect(m(e, 'gate').state).toBe('OPEN');
    const r = e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(5, 2) });
    expect(r.ok).toBe(true);
    expect(ofType(r.events, 'MECHANISM_CHANGED').map((x) => x.cue)).toEqual(['PLATE_RELEASED', 'GATE_CLOSE_DEFERRED']);
    expect(m(e, 'gate')).toMatchObject({ state: 'OPEN', pending: { action: 'CLOSE' } });
    expect(e.getMechanismView()!.objects.find((o) => o.id === 'gate')!.visualState).toBe('pending');
    e.dispatch(endTurn(e));
    const leave = e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(6, 2) });
    expect(ofType(leave.events, 'MECHANISM_CHANGED').map((x) => x.cue)).toEqual(['GATE_CLOSED']);
    expect(m(e, 'gate').state).toBe('CLOSED');
  });

  it('AND condition: the gate opens only when every plate is pressed', () => {
    const e = withMechanisms(
      {
        objects: [
          { id: 'a', kind: 'PRESSURE_PLATE', pos: p(1, 1) },
          { id: 'b', kind: 'PRESSURE_PLATE', pos: p(1, 3) },
          { id: 'gate', kind: 'GATE', pos: p(5, 2) },
        ],
        rules: [{ id: 'and', trigger: { type: 'ON_ALL_ACTIVE', sources: ['a', 'b'] }, actions: [{ type: 'OPEN', targets: ['gate'] }] }],
      },
      { hero: { heroId: 'summoner', pos: p(0, 2) } },
    );
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'summoner', to: p(1, 1) });
    expect(m(e, 'a').active).toBe(true);
    expect(m(e, 'gate').state).toBe('CLOSED');
    spawnSummon(ctxFor(e), unit(e, 'summoner'), 'chicken', p(1, 3));
    settle(e);
    expect(m(e, 'gate').state).toBe('OPEN');
  });

  it('ANY condition fires on the first plate', () => {
    const e = withMechanisms(
      {
        objects: [
          { id: 'a', kind: 'PRESSURE_PLATE', pos: p(1, 1) },
          { id: 'b', kind: 'PRESSURE_PLATE', pos: p(1, 3) },
          { id: 'gate', kind: 'GATE', pos: p(5, 2) },
        ],
        rules: [{ id: 'any', trigger: { type: 'ON_ANY_ACTIVE', sources: ['a', 'b'] }, actions: [{ type: 'OPEN', targets: ['gate'] }] }],
      },
      { hero: { heroId: 'mage', pos: p(0, 3) } },
    );
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(1, 3) });
    expect(m(e, 'gate').state).toBe('OPEN');
  });

  const ONCE = (once: boolean): MechanismBoardDef => ({
    objects: [
      { id: 'plate', kind: 'PRESSURE_PLATE', pos: p(1, 2) },
      { id: 'gate', kind: 'GATE', pos: p(5, 2) },
    ],
    rules: [{ id: 'flip', trigger: { type: 'ON_OCCUPIED', sources: ['plate'] }, actions: [{ type: 'TOGGLE', targets: ['gate'] }], once }],
  });

  it('a trigger fires once if configured; repeatable triggers fire every time', () => {
    for (const once of [true, false]) {
      const e = withMechanisms(ONCE(once), { hero: { heroId: 'mage', pos: p(0, 2) } });
      e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(1, 2) }); // press: toggle → OPEN
      e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(0, 2) }); // release
      e.dispatch(endTurn(e));
      e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(1, 2) }); // press again
      expect(m(e, 'gate').state).toBe(once ? 'OPEN' : 'CLOSED');
      expect(e.state.mechanisms!.fired).toEqual(once ? ['flip'] : []);
    }
  });

  it('traps fire on accepted units that end on them, and DISABLE turns them off', () => {
    const e = withMechanisms(
      {
        objects: [
          { id: 'vent', kind: 'TRAP', pos: p(2, 2), trap: { damage: 2, damageType: 'ARCANE' } },
          { id: 'btn', kind: 'SWITCH', pos: p(0, 0), momentary: true },
        ],
        rules: [{ id: 'off', trigger: { type: 'ON_INTERACT', sources: ['btn'] }, actions: [{ type: 'DISABLE', targets: ['vent'] }] }],
      },
      { hero: { heroId: 'mage', pos: p(1, 2) } },
    );
    const hp = unit(e, 'mage').hp;
    const r = e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(2, 2) });
    expect(ofType(r.events, 'MECHANISM_CHANGED').map((x) => x.cue)).toEqual(['TRAP_FIRED']);
    expect(unit(e, 'mage').hp).toBe(hp - 2);
    e.dispatch(endTurn(e));
    expect(e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(0, 1) }).ok).toBe(true);
    expect(interact(e, 'btn').ok).toBe(true);
    expect(m(e, 'btn').state).toBe('OFF'); // momentary button never latches
    e.dispatch(endTurn(e));
    expect(e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(2, 2) }).ok).toBe(true);
    expect(unit(e, 'mage').hp).toBe(hp - 2);
  });

  it('round triggers and KEEP_ACTIVE objectives count round ends with every plate held', () => {
    const e = withMechanisms(
      {
        objects: [{ id: 'plate', kind: 'PRESSURE_PLATE', pos: p(1, 2) }],
        rules: [],
      },
      { hero: { heroId: 'mage', pos: p(1, 2) }, objectives: [{ type: 'MECHANISM', goal: 'KEEP_ACTIVE', ids: ['plate'], required: 2 }] },
    );
    expect(e.state.objectives[0]!.current).toBe(0);
    e.dispatch(endTurn(e));
    expect(e.state.objectives[0]!.current).toBe(1);
    e.dispatch(endTurn(e));
    expect(e.state.outcome).toMatchObject({ result: 'WON' });
  });

  it('INTERACT is never available in PvP duels', () => {
    const e = withMechanisms(SWITCH_GATE(), { layout: WALLED, hero: { heroId: 'mage', pos: p(1, 2) } });
    mutable(e).duel = { other: { heroId: 'x' } } as never;
    expect(interact(e, 'lever')).toMatchObject({ ok: false });
    expect(e.getInteractions()).toEqual([]);
  });

  it('the run verifier accepts INTERACT and rejects malformed ones', () => {
    expect(parseCommand({ type: 'INTERACT', mechanismId: 'lever' })).toEqual({ type: 'INTERACT', mechanismId: 'lever' });
    expect(parseCommand({ type: 'INTERACT', mechanismId: 7 })).toBeNull();
    expect(parseCommand({ type: 'INTERACT', mechanismId: 'x'.repeat(200) })).toBeNull();
  });

  it('visual telegraph: links, interactable, targeted and live energy', () => {
    const e = withMechanisms(SWITCH_GATE(), { layout: WALLED, hero: { heroId: 'mage', pos: p(1, 2) } });
    const before = e.getMechanismView()!;
    expect(before.links).toEqual([{ from: 'lever', to: 'gate', ruleId: 'r', live: false }]);
    expect(before.objects.find((o) => o.id === 'lever')).toMatchObject({ interactable: true, targeted: false, connected: ['gate'], visualState: 'inactive' });
    expect(before.objects.find((o) => o.id === 'gate')).toMatchObject({ interactable: false, targeted: true, solid: true });
    interact(e, 'lever');
    const after = e.getMechanismView()!;
    expect(after.links[0]!.live).toBe(true);
    expect(after.objects.find((o) => o.id === 'gate')).toMatchObject({ visualState: 'active', solid: false });
  });
});

describe('Act III — replay / reconnect', () => {
  const PUZZLE: MechanismBoardDef = {
    objects: [
      { id: 'lever', kind: 'SWITCH', pos: p(0, 0), toggle: true },
      { id: 'plate', kind: 'PRESSURE_PLATE', pos: p(3, 2) },
      { id: 'statue', kind: 'STATUE', pos: p(2, 2) },
      { id: 'gate', kind: 'GATE', pos: p(5, 2) },
      { id: 'bridge', kind: 'BRIDGE', pos: p(5, 4) },
      { id: 'relic', kind: 'RELIC', pos: p(6, 0) },
    ],
    rules: [
      { id: 'g', trigger: { type: 'ON_OCCUPIED', sources: ['plate'] }, actions: [{ type: 'OPEN', targets: ['gate'] }] },
      { id: 'b', trigger: { type: 'ON_INTERACT', sources: ['lever'] }, actions: [{ type: 'TOGGLE', targets: ['bridge'] }] },
    ],
  };
  const SC: Partial<ScenarioDef> = { hero: { heroId: 'mage', pos: p(1, 2) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(6, 4) }] };

  function play(): GameEngine {
    const e = withMechanisms(PUZZLE, SC);
    expect(interact(e, 'statue').ok).toBe(true); // plate pressed → gate open
    e.dispatch(endTurn(e));
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(0, 1) });
    expect(interact(e, 'lever').ok).toBe(true); // bridge lowered
    e.dispatch(endTurn(e));
    return e;
  }

  it('replayBattle reproduces switch, plate, gate, bridge and statue exactly', () => {
    const e = play();
    const sc = { ...(e.scenario as ScenarioDef) };
    const { state, rejectedAt } = replayBattle(sc, e.content, e.seed, e.history);
    expect(rejectedAt).toBeNull();
    expect(state).toEqual(e.state);
    expect(state.mechanisms!.objects.map((o) => [o.def.id, o.state, o.pos])).toEqual([
      ['lever', 'ON', p(0, 0)],
      ['plate', 'IDLE', p(3, 2)],
      ['statue', 'IDLE', p(3, 2)],
      ['gate', 'OPEN', p(5, 2)],
      ['bridge', 'LOWERED', p(5, 4)],
      ['relic', 'IDLE', p(6, 0)],
    ]);
    expect(JSON.stringify(state)).toBe(JSON.stringify(e.state)); // deterministic serialisation
  });

  it('reconnect: a JSON snapshot (gate open, block moved) continues identically', () => {
    const live = play();
    const snapshot = JSON.parse(JSON.stringify(live.state));
    const resumed = GameEngine.fromSnapshot(snapshot, live.content, live.scenario);
    expect(resumed.state.mechanisms!.objects.find((o) => o.def.id === 'gate')!.state).toBe('OPEN');
    expect(resumed.state.mechanisms!.objects.find((o) => o.def.id === 'statue')!.pos).toEqual(p(3, 2));
    for (const engine of [live, resumed]) {
      engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(1, 1) });
      engine.dispatch(endTurn(engine));
    }
    expect(resumed.state).toEqual(live.state);
    expect(resumed.getLegalMoves()).toEqual(live.getLegalMoves());
  });

  it('replay is rejected at an illegal INTERACT (server cannot be tricked)', () => {
    const e = withMechanisms(PUZZLE, SC);
    const { rejectedAt } = replayBattle(e.scenario as ScenarioDef, e.content, e.seed, [{ type: 'INTERACT', mechanismId: 'relic' }]);
    expect(rejectedAt).toBe(0);
  });
});
