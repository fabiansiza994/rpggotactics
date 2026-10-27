import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT } from '../src/game/data';
import { withArcher } from '../src/game/data/archer';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import { TEMPLE_CAMPAIGN } from '../src/game/data/temple-encounters';
import { GameEngine } from '../src/game/engine/GameEngine';
import { replayBattle } from '../src/game/engine/replay';
import { encounterFor } from '../src/game/run/encounter';
import { queryContext } from '../src/game/domain/context';
import type { MechanismBoardDef } from '../src/game/domain/mechanisms/mechanism';
import { mechanismById } from '../src/game/domain/mechanisms/mechanism-board';
import { syncMechanisms } from '../src/game/domain/mechanisms/mechanism-rules';
import { defeatUnit } from '../src/game/domain/combat/damage';
import { spawnSummon } from '../src/game/domain/summons/summons';
import type { ScenarioDef } from '../src/game/domain/scenario';
import type { GameState } from '../src/game/domain/state';
import type { Pos } from '../src/game/domain/core/position';
import { playCombatRoute, puzzleOnly, ROUTES, runRoute } from './support/act3-pilot';
import { ctxFor, endTurn, makeEngine, mutable, ofType, p, setHand, unit } from './helpers';

const CONTENT = withArcher(withShapeshifterRelease(DEFAULT_CONTENT));
const QUIET: Partial<ScenarioDef> = { enemies: [], objectives: [{ type: 'SURVIVE_ROUNDS', rounds: 30 }] };
const engineWith = (mechanisms: MechanismBoardDef, overrides: Partial<ScenarioDef> = {}) =>
  makeEngine({ ...QUIET, mechanisms, ...overrides }, CONTENT);
const m = (e: GameEngine, id: string) => mechanismById(e.state, id)!;
const settle = (e: GameEngine) => syncMechanisms(queryContext(mutable(e), e.content));
const interact = (e: GameEngine, mechanismId: string) => e.dispatch({ type: 'INTERACT', mechanismId });
const cues = (events: readonly { type: string }[]) => ofType(events as never, 'MECHANISM_CHANGED').map((x) => x.cue);
const moves = (e: GameEngine) => new Set(e.getLegalMoves().map((n) => `${n.pos.x},${n.pos.y}`));
const roundTrip = (e: GameEngine) => GameEngine.fromSnapshot(JSON.parse(JSON.stringify(e.state)) as GameState, e.content, e.scenario);

// ── Moving platforms ─────────────────────────────────────────────────────────

// Chasm (x) on row 2, columns 2..4. The platform rides that row: a (2,2) → b (4,2) → c (5,2, floor dock).
const CHASM = ['.......', '.......', '..xxx..', '.......', '.......'];
const PLATFORM = (extra: Partial<MechanismBoardDef['objects'][number]> = {}): MechanismBoardDef => ({
  objects: [
    { id: 'deck', kind: 'PLATFORM', pos: p(2, 2), stops: { a: p(2, 2), b: p(4, 2), c: p(5, 2) }, initialStop: 'a', ...extra },
    { id: 'lever', kind: 'SWITCH', pos: p(2, 1), momentary: true },
    { id: 'reset', kind: 'SWITCH', pos: p(0, 0), momentary: true, prompt: 'RESTABLECER' },
  ],
  rules: [
    { id: 'go', trigger: { type: 'ON_INTERACT', sources: ['lever'] }, actions: [{ type: 'ADVANCE', targets: ['deck'] }] },
    { id: 'home', trigger: { type: 'ON_INTERACT', sources: ['reset'] }, actions: [{ type: 'RESET', targets: ['deck'] }] },
  ],
});

describe('Act III phase 2 — moving platforms', () => {
  it('is floor where it stands; the chasm elsewhere is not', () => {
    const e = engineWith(PLATFORM(), { layout: CHASM, hero: { heroId: 'mage', pos: p(1, 2) } });
    expect(moves(e).has('2,2')).toBe(true);
    expect(moves(e).has('3,2')).toBe(false);
  });

  it('empty move: instant, PLATFORM_MOVED with nothing carried', () => {
    const e = engineWith(PLATFORM(), { layout: CHASM, hero: { heroId: 'mage', pos: p(1, 1) } });
    const r = interact(e, 'lever');
    expect(cues(r.events)).toEqual(['SWITCH_ACTIVATED', 'PLATFORM_MOVED']);
    expect(ofType(r.events, 'MECHANISM_CHANGED').find((x) => x.cue === 'PLATFORM_MOVED')).toMatchObject({ from: p(2, 2), pos: p(4, 2), carriedIds: [], causeId: 'lever' });
    expect(m(e, 'deck')).toMatchObject({ stop: 'b', pos: p(4, 2), active: true });
  });

  it('carries the champion (HP, statuses, movement kept) and pathfinding follows', () => {
    const e = engineWith(PLATFORM(), { layout: CHASM, hero: { heroId: 'mage', pos: p(1, 2) } });
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(2, 2) });
    mutable(e).units[0]!.hp = 13;
    const mp = e.state.player.movePoints;
    const r = interact(e, 'lever');
    expect(unit(e, 'mage')).toMatchObject({ pos: p(4, 2), hp: 13 });
    expect(e.state.player.movePoints).toBe(mp);
    expect(ofType(r.events, 'UNIT_TELEPORTED')).toEqual([{ type: 'UNIT_TELEPORTED', unitId: 'mage', from: p(2, 2), to: p(4, 2), sourceId: 'mechanism:deck' }]);
    expect(moves(e).has('5,2')).toBe(true);
    expect(moves(e).has('2,2')).toBe(false); // the floor left with the platform
  });

  it('carries a summon with its summon data and ownership; and an enemy', () => {
    const e = engineWith(PLATFORM(), { layout: CHASM, hero: { heroId: 'summoner', pos: p(1, 1) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(6, 4) }] });
    const fox = spawnSummon(ctxFor(e), unit(e, 'summoner'), 'fox', p(2, 2))!;
    const data = structuredClone(fox.summon);
    interact(e, 'lever');
    const moved = unit(e, fox.id);
    expect(moved).toMatchObject({ pos: p(4, 2), faction: 'PLAYER', kind: 'SUMMON' });
    expect(moved.summon).toEqual(data);

    const f = engineWith(PLATFORM(), { layout: CHASM, hero: { heroId: 'mage', pos: p(1, 1) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(2, 2) }] });
    interact(f, 'lever');
    expect(unit(f, 'orc-1').pos).toEqual(p(4, 2));
  });

  it('blocked destination: PLATFORM_BLOCKED, nobody moves, the lever can be pulled again later', () => {
    const e = engineWith(PLATFORM(), { layout: CHASM, hero: { heroId: 'mage', pos: p(1, 1) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(5, 2) }] });
    interact(e, 'lever'); // a → b
    e.dispatch(endTurn(e));
    const orc = unit(e, 'orc-1');
    mutable(e).units.find((u) => u.id === orc.id)!.pos = p(5, 2); // (arrange) stands on the dock tile
    const r = interact(e, 'lever'); // b → c blocked
    expect(cues(r.events)).toEqual(['SWITCH_ACTIVATED', 'PLATFORM_BLOCKED']);
    expect(m(e, 'deck')).toMatchObject({ stop: 'b', pos: p(4, 2) });
  });

  it('never moves into a wall, another mechanism or off the board (authoring validation)', () => {
    expect(() => engineWith(PLATFORM({ stops: { a: p(2, 2), b: p(9, 2) } }), { layout: CHASM })).toThrow(/leaves the board/);
    expect(() => engineWith(PLATFORM({ stops: { a: p(2, 2), b: p(2, 1) } }), { layout: CHASM })).toThrow(/sits in the lane/);
  });

  it('ADVANCE cycles the stops; RESET brings it home (mechanism state only)', () => {
    const e = engineWith(PLATFORM(), { layout: CHASM, hero: { heroId: 'mage', pos: p(1, 1) } });
    const stops: string[] = [];
    for (let i = 0; i < 3; i++) {
      interact(e, 'lever');
      stops.push(m(e, 'deck').stop!);
      e.dispatch(endTurn(e));
    }
    expect(stops).toEqual(['b', 'c', 'a']);
    interact(e, 'lever');
    e.dispatch(endTurn(e));
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(0, 1) });
    const hp = unit(e, 'mage').hp;
    expect(cues(interact(e, 'reset').events)).toContain('PLATFORM_MOVED');
    expect(m(e, 'deck')).toMatchObject({ stop: 'a', active: false });
    expect(unit(e, 'mage').hp).toBe(hp);
  });

  it('replay and reconnect reproduce platform positions and occupants', () => {
    const e = engineWith(PLATFORM(), { layout: CHASM, hero: { heroId: 'mage', pos: p(1, 2) } });
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(2, 2) });
    interact(e, 'lever');
    e.dispatch(endTurn(e));
    const replay = replayBattle(e.scenario, e.content, e.seed, e.history);
    expect(replay.rejectedAt).toBeNull();
    expect(JSON.stringify(replay.state)).toBe(JSON.stringify(e.state));
    const resumed = roundTrip(e);
    for (const engine of [e, resumed]) {
      engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(5, 2) });
      engine.dispatch(endTurn(engine));
    }
    expect(resumed.state).toEqual(e.state);
  });
});

// ── Mechanical Guardian ──────────────────────────────────────────────────────

const GUARDIAN: MechanismBoardDef = {
  objects: [
    { id: 'lever', kind: 'SWITCH', pos: p(1, 0), holdRounds: 2 },
    { id: 'plate', kind: 'PRESSURE_PLATE', pos: p(1, 2) },
  ],
  rules: [
    { id: 'plating', trigger: { type: 'ON_ROUND_START' }, actions: [{ type: 'FORTIFY', unitIds: ['guardian'] }], once: true },
    {
      id: 'expose',
      trigger: { type: 'ON_ALL_ACTIVE', sources: ['lever', 'plate'] },
      actions: [
        { type: 'EXPOSE', unitIds: ['guardian'], rounds: 2 },
        { type: 'RESET', targets: ['lever'] },
      ],
    },
  ],
};
const guardianEngine = () =>
  engineWith(GUARDIAN, { hero: { heroId: 'mage', pos: p(1, 3) }, enemies: [{ id: 'guardian', enemyId: 'temple_guardian', pos: p(5, 2) }] });
const plated = (e: GameEngine) => unit(e, 'guardian').statuses.some((s) => s.id === 'FORTIFIED');

describe('Act III phase 2 — Mechanical Guardian', () => {
  it('starts FORTIFIED (event for the presentation, status on the unit)', () => {
    const e = guardianEngine();
    expect(plated(e)).toBe(true);
    expect(ofType(e.initialEvents, 'GUARDIAN_STATE')).toEqual([{ type: 'GUARDIAN_STATE', cue: 'GUARDIAN_FORTIFIED', unitId: 'guardian' }]);
    expect(e.getMechanismView()!.guardians).toEqual([{ unitId: 'guardian', state: 'FORTIFIED' }]);
    expect(e.getMechanismView()!.unitLinks.map((l) => l.from)).toEqual(['lever', 'plate']);
  });

  it('plating mitigates strongly but is not immunity; exposed takes normal damage', () => {
    const fireballAt = (e: GameEngine, target: { x: number; y: number }) => {
      mutable(e).units.find((u) => u.id === 'guardian')!.pos = target;
      const [card] = setHand(e, ['fireball']);
      const r = e.dispatch({ type: 'PLAY_CARD', cardUid: card!, target });
      return ofType(r.events, 'UNIT_DAMAGED').find((x) => x.unitId === 'guardian')!.hpLost;
    };
    expect(fireballAt(guardianEngine(), p(4, 3))).toBe(1); // 3 − 2 (plated)
    const f = guardianEngine();
    mutable(f).mechanisms!.exposed = { guardian: f.state.round }; // (arrange) inside a window
    settle(f);
    expect(fireballAt(f, p(4, 3))).toBe(3);
  });

  it('activation needs BOTH mechanisms in the same window; the lever alone does nothing', () => {
    const e = guardianEngine();
    mutable(e).units[0]!.pos = p(0, 0);
    expect(ofType(interact(e, 'lever').events, 'GUARDIAN_STATE')).toEqual([]);
    expect(m(e, 'lever').state).toBe('ON');
    e.dispatch(endTurn(e)); // round 1 ends: lever (2 rounds) still ON
    expect(m(e, 'lever').state).toBe('ON');
    mutable(e).units.find((u) => u.id === 'guardian')!.pos = p(6, 4); // (arrange) out of the way
    const onPlate = e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(1, 2) });
    expect(ofType(onPlate.events, 'GUARDIAN_STATE').map((x) => x.cue)).toEqual(['GUARDIAN_EXPOSED']);
    expect(m(e, 'lever').state).toBe('OFF'); // reset: the window can be reopened later
  });

  it('the timed lever turns itself off at the end of its second round', () => {
    const e = guardianEngine();
    mutable(e).units[0]!.pos = p(0, 0);
    interact(e, 'lever');
    e.dispatch(endTurn(e));
    expect(m(e, 'lever').state).toBe('ON');
    const end = e.dispatch(endTurn(e));
    expect(cues(end.events)).toContain('SWITCH_DEACTIVATED');
    expect(m(e, 'lever').state).toBe('OFF');
  });

  it('re-fortifies when the window closes, and the window is reusable', () => {
    const e = guardianEngine();
    mutable(e).units[0]!.pos = p(1, 2); // on the plate
    settle(e);
    mutable(e).units[0]!.pos = p(0, 0);
    mutable(e).mechanisms!.objects.find((o) => o.def.id === 'plate')!.locked = true; // plate stays held (arrange)
    interact(e, 'lever');
    expect(plated(e)).toBe(false);
    e.dispatch(endTurn(e)); // end of round 1: still exposed (2 rounds)
    expect(plated(e)).toBe(false);
    const close = e.dispatch(endTurn(e)); // end of round 2: plating returns
    expect(ofType(close.events, 'GUARDIAN_STATE').map((x) => x.cue)).toEqual(['GUARDIAN_REFORTIFIED']);
    expect(plated(e)).toBe(true);
    expect(interact(e, 'lever').ok).toBe(true); // second window
    expect(plated(e)).toBe(false);
  });

  it('cannot get stuck in an invalid plating state: a stripped status is restored, a missing one re-derived', () => {
    const e = guardianEngine();
    const g = mutable(e).units.find((u) => u.id === 'guardian')!;
    g.statuses = []; // e.g. a cleanse
    settle(e);
    expect(plated(e)).toBe(true);
    mutable(e).mechanisms!.exposed = { guardian: e.state.round };
    settle(e);
    expect(plated(e)).toBe(false);
  });

  it('replay reproduces the plating state exactly', () => {
    const e = guardianEngine();
    mutable(e).units[0]!.pos = p(0, 0);
    interact(e, 'lever');
    e.dispatch(endTurn(e));
    const replay = replayBattle({ ...e.scenario, hero: { heroId: 'mage', pos: p(0, 0) } }, e.content, e.seed, e.history);
    expect(replay.rejectedAt).toBeNull();
    expect(replay.state.mechanisms!.armored).toEqual(['guardian']);
    expect(replay.state.units.find((u) => u.id === 'guardian')!.statuses.some((s) => s.id === 'FORTIFIED')).toBe(true);
  });
});

// ── Relic carry / extraction ─────────────────────────────────────────────────

const RELIC: MechanismBoardDef = {
  objects: [
    { id: 'relic', kind: 'RELIC', pos: p(3, 2), carry: { extraction: [p(0, 2)] } },
    { id: 'gate', kind: 'GATE', pos: p(5, 2), initial: 'OPEN' },
    { id: 'shut', kind: 'SWITCH', pos: p(6, 0), momentary: true },
  ],
  rules: [{ id: 'shut-gate', trigger: { type: 'ON_INTERACT', sources: ['shut'] }, actions: [{ type: 'CLOSE', targets: ['gate'] }] }],
};
const relicEngine = (overrides: Partial<ScenarioDef> = {}) =>
  engineWith(RELIC, {
    hero: { heroId: 'mage', pos: p(2, 2) },
    objectives: [{ type: 'MECHANISM', goal: 'EXTRACT_RELIC', ids: ['relic'] }],
    ...overrides,
  });

describe('Act III phase 2 — relic carry / extraction', () => {
  it('pickup: RECOGER → CARRIED by the champion, RELIC_PICKED_UP, movement −1 from the next turn', () => {
    const e = relicEngine();
    expect(e.getInteractions().find((o) => o.mechanismId === 'relic')).toMatchObject({ verb: 'RECOGER', allowed: true });
    const r = interact(e, 'relic');
    expect(cues(r.events)).toEqual(['RELIC_PICKED_UP']);
    expect(m(e, 'relic')).toMatchObject({ state: 'CARRIED', carrier: 'mage' });
    expect(unit(e, 'mage').statuses.map((s) => s.id)).toContain('RELIC_BURDEN');
    e.dispatch(endTurn(e));
    expect(e.state.player.movePoints).toBe(e.state.player.maxMovePoints - 1);
    expect(e.getMechanismView()!.objects.find((o) => o.id === 'relic')).toMatchObject({ carrier: 'mage', solid: false });
  });

  it('duplicate interaction is rejected; the next turn offers SOLTAR', () => {
    const e = relicEngine();
    interact(e, 'relic');
    expect(interact(e, 'relic')).toMatchObject({ ok: false, error: 'INTERACTION_USED' });
    e.dispatch(endTurn(e));
    expect(e.getInteractions().find((o) => o.mechanismId === 'relic')).toMatchObject({ verb: 'SOLTAR', adjacent: true, allowed: true });
  });

  it('drop: SOLTAR leaves it on the champion tile; it can be picked up again (even from that tile)', () => {
    const e = relicEngine();
    interact(e, 'relic');
    e.dispatch(endTurn(e));
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(2, 3) });
    expect(cues(interact(e, 'relic').events)).toEqual(['RELIC_DROPPED']);
    expect(m(e, 'relic')).toMatchObject({ state: 'DROPPED', pos: p(2, 3) });
    expect(unit(e, 'mage').statuses.map((s) => s.id)).not.toContain('RELIC_BURDEN');
    e.dispatch(endTurn(e));
    expect(e.getInteractions().find((o) => o.mechanismId === 'relic')).toMatchObject({ verb: 'RECOGER', allowed: true });
    expect(interact(e, 'relic').ok).toBe(true);
  });

  it('carrier death: the relic falls where the carrier last stood, never vanishes', () => {
    const e = relicEngine({ objectives: [{ type: 'SURVIVE_ROUNDS', rounds: 30 }] });
    interact(e, 'relic');
    e.dispatch(endTurn(e));
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(1, 1) });
    const ctx = ctxFor(e);
    defeatUnit(ctx, unit(e, 'mage'));
    settle(e);
    expect(m(e, 'relic')).toMatchObject({ state: 'DROPPED', pos: p(1, 1) });
  });

  it('a gate never closes on a dropped relic (it can never be sealed away)', () => {
    const e = relicEngine();
    interact(e, 'relic');
    e.dispatch(endTurn(e));
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(4, 2) });
    e.dispatch(endTurn(e));
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(5, 2) }); // onto the open gate
    interact(e, 'relic'); // drop it in the doorway
    e.dispatch(endTurn(e));
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(6, 1) });
    const r = interact(e, 'shut');
    expect(cues(r.events)).toContain('GATE_CLOSE_DEFERRED');
    expect(m(e, 'gate').state).toBe('OPEN');
  });

  it('extraction: ASEGURAR only on an extraction tile, then the objective completes', () => {
    const e = relicEngine();
    interact(e, 'relic');
    e.dispatch(endTurn(e));
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(1, 2) });
    expect(e.getInteractions().find((o) => o.mechanismId === 'relic')!.verb).toBe('SOLTAR');
    e.dispatch(endTurn(e));
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(0, 2) });
    expect(e.state.outcome).toBeNull(); // standing in the zone is not enough
    expect(e.getInteractions().find((o) => o.mechanismId === 'relic')!.verb).toBe('ASEGURAR');
    const r = interact(e, 'relic');
    expect(cues(r.events)).toEqual(['RELIC_EXTRACTED']);
    expect(e.state.outcome).toMatchObject({ result: 'WON' });
    expect(unit(e, 'mage').statuses.map((s) => s.id)).not.toContain('RELIC_BURDEN');
  });

  it('enemies and summons never pick it up (champion only)', () => {
    const e = relicEngine({ hero: { heroId: 'summoner', pos: p(0, 0) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(6, 4) }] });
    interact(e, 'relic'); // not adjacent: refused
    mutable(e).units[0]!.pos = p(2, 2);
    interact(e, 'relic');
    e.dispatch(endTurn(e));
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'summoner', to: p(2, 3) });
    interact(e, 'relic');
    spawnSummon(ctxFor(e), unit(e, 'summoner'), 'fox', p(1, 3));
    mutable(e).units.find((u) => u.id === 'orc-1')!.pos = p(3, 3);
    e.dispatch(endTurn(e));
    expect(m(e, 'relic').state).toBe('DROPPED');
  });

  it('reconnect keeps the carrier and the stage of the extraction', () => {
    const e = relicEngine();
    interact(e, 'relic');
    e.dispatch(endTurn(e));
    const resumed = roundTrip(e);
    expect(mechanismById(resumed.state, 'relic')).toMatchObject({ state: 'CARRIED', carrier: 'mage' });
    for (const engine of [e, resumed]) {
      engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(0, 2) });
      engine.dispatch({ type: 'INTERACT', mechanismId: 'relic' });
    }
    expect(resumed.state).toEqual(e.state);
  });
});

// ── Ordered runes + multi-stage objectives ───────────────────────────────────

describe('Act III phase 2 — sequenced switches and staged objectives', () => {
  const SEQ: MechanismBoardDef = {
    objects: [
      { id: 'sun', kind: 'SWITCH', pos: p(1, 0), momentary: true },
      { id: 'moon', kind: 'SWITCH', pos: p(3, 0), momentary: true },
      { id: 'vault', kind: 'GATE', pos: p(5, 2) },
    ],
    rules: [{ id: 'order', trigger: { type: 'ON_SEQUENCE', sources: ['sun', 'moon'] }, actions: [{ type: 'OPEN', targets: ['vault'] }], once: true }],
  };

  it('only the right order opens; a wrong rune restarts the sequence', () => {
    const e = engineWith(SEQ, { hero: { heroId: 'mage', pos: p(2, 0) } });
    expect(cues(interact(e, 'moon').events)).toEqual(['SWITCH_ACTIVATED', 'SEQUENCE_RESET']);
    e.dispatch(endTurn(e));
    interact(e, 'sun');
    expect(e.state.mechanisms!.sequences).toEqual({ order: 1 });
    e.dispatch(endTurn(e));
    const done = interact(e, 'moon');
    expect(cues(done.events)).toEqual(['SWITCH_ACTIVATED', 'SEQUENCE_PROGRESS', 'GATE_OPENED']);
    expect(m(e, 'vault').state).toBe('OPEN');
  });

  it('STAGES: each stage latches, OBJECTIVE_STAGE_CHANGED names the next one, reconnect keeps the stage', () => {
    const e = engineWith(RELIC, {
      hero: { heroId: 'mage', pos: p(0, 0) },
      objectives: [
        {
          type: 'MECHANISM',
          goal: 'STAGES',
          ids: [],
          stages: [
            { label: 'Llega', objective: { type: 'REACH_TILE', tiles: [p(2, 2)], roundLimit: 20 } },
            { label: 'Recoge', objective: { type: 'MECHANISM', goal: 'ACTIVATE_N', ids: ['relic'] } },
            { label: 'Asegura', objective: { type: 'MECHANISM', goal: 'EXTRACT_RELIC', ids: ['relic'] } },
          ],
        },
      ],
    });
    expect(e.state.objectives[0]).toMatchObject({ current: 0, target: 3, status: 'IN_PROGRESS' });
    const reach = e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(2, 1) });
    expect(ofType(reach.events, 'OBJECTIVE_STAGE_CHANGED')).toEqual([]);
    e.dispatch(endTurn(e));
    const there = e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(2, 2) });
    expect(ofType(there.events, 'OBJECTIVE_STAGE_CHANGED')).toEqual([{ type: 'OBJECTIVE_STAGE_CHANGED', index: 0, stage: 1, total: 3, label: 'Recoge' }]);
    interact(e, 'relic');
    expect(e.state.objectives[0]!.current).toBe(2);
    e.dispatch(endTurn(e));
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(1, 2) }); // left the "reach" tile: stage stays
    expect(roundTrip(e).state.objectives[0]!.current).toBe(2);
    e.dispatch(endTurn(e));
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(0, 2) });
    interact(e, 'relic');
    expect(e.state.outcome).toMatchObject({ result: 'WON' });
  });
});

// ── Encounters XXIV–XXVI ─────────────────────────────────────────────────────

const CHAMPIONS = TEMPLE_CAMPAIGN.heroIds;
const engineFor = (id: string, heroId: string, seed?: number) => {
  const sc = encounterFor(TEMPLE_CAMPAIGN, id, heroId);
  return new GameEngine(sc, CONTENT, seed ?? sc.defaultSeed);
};

describe('Act III phase 2 — encounters (known human routes, every champion)', () => {
  it('XXIV · La Cámara Móvil: the route wins for every champion', () => {
    for (const heroId of CHAMPIONS) expect(runRoute(engineFor('w3_e04', heroId), ROUTES.w3_e04!).result, heroId).toBe('WON');
  });

  it('XXVI · La Reliquia Perdida: the route (Sol → Luna, carry, secure) wins for every champion', () => {
    for (const heroId of CHAMPIONS) {
      const { result, state } = runRoute(engineFor('w3_e06', heroId), ROUTES.w3_e06!);
      expect(result, heroId).toBe('WON');
      expect(state.mechanisms!.objects.find((o) => o.def.id === 'relic')!.state).toBe('EXTRACTED');
    }
  });

  it('XXV · Guardián Mecánico: every champion opens the window with the route (statue → plate, lever)', () => {
    for (const heroId of CHAMPIONS) {
      const e = engineFor('w3_e05', heroId);
      const s = mutable(e);
      s.units = s.units.filter((u) => u.kind !== 'ENEMY' || u.id === 'guardian');
      s.pendingWaves = [];
      let exposed = 0;
      e.subscribe((events) => (exposed += ofType(events, 'GUARDIAN_STATE').filter((x) => x.cue === 'GUARDIAN_EXPOSED').length));
      playCombatRoute(e, ROUTES.w3_e05!, [], 6);
      expect(exposed, heroId).toBeGreaterThan(0);
    }
  });
});

describe('Act III phase 2 — softlock safety', () => {
  it('XXIV: every platform stop docks on solid ground → a rider can always step off', () => {
    const e = engineFor('w3_e04', 'mage');
    const sc = e.scenario;
    for (const o of sc.mechanisms!.objects.filter((x) => x.kind === 'PLATFORM'))
      for (const [name, stop] of Object.entries(o.stops!)) {
        const s = puzzleOnly(e.state);
        const deck = s.mechanisms!.objects.find((x) => x.def.id === o.id)!;
        deck.pos = { ...stop };
        deck.stop = name;
        s.units[0]!.pos = { ...stop };
        const probe = GameEngine.fromSnapshot(s, e.content, sc);
        expect(probe.getLegalMoves().length, `${o.id}@${name}`).toBeGreaterThan(0);
      }
  });

  it('XXIV: REINICIAR CÁMARA restores both platforms and nothing else (HP, enemies untouched)', () => {
    const e = engineFor('w3_e04', 'warrior');
    const s = mutable(e);
    s.units = s.units.filter((u) => u.kind !== 'ENEMY');
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'warrior', to: p(2, 5) });
    interact(e, 'lever-a'); // a: far → near
    e.dispatch(endTurn(e));
    mutable(e).units.find((u) => u.id === 'warrior')!.pos = p(0, 1); // (arrange) beside the reset button
    const hp = unit(e, 'warrior').hp;
    const r = interact(e, 'reset');
    expect(cues(r.events)).toEqual(['SWITCH_ACTIVATED', 'PLATFORM_MOVED']);
    expect(m(e, 'platform-a').stop).toBe('far');
    expect(m(e, 'platform-b').stop).toBe('bank');
    expect(unit(e, 'warrior').hp).toBe(hp);
  });

  it('XXV: the plating can never be permanent — every window can be reopened (at the next live lever)', () => {
    const e = engineFor('w3_e05', 'mage');
    const s = mutable(e);
    s.units = s.units.filter((u) => u.kind !== 'ENEMY' || u.id === 'guardian');
    m(e, 'statue').pos = p(2, 5); // statue already on the plate
    settle(e);
    unit(e, 'mage').maxHp = unit(e, 'mage').hp = 999; // (arrange) twelve rounds of Guardian blows
    let windows = 0;
    const beside: Record<string, Pos> = { 'lever-a': p(3, 1), 'lever-b': p(7, 2), 'lever-c': p(5, 4) };
    for (let i = 0; i < 4; i++) {
      mutable(e).units.find((u) => u.id === 'guardian')!.pos = p(4, 3);
      const live = e.getMechanismView()!.rings[0]!.live;
      mutable(e).units[0]!.pos = beside[live]!;
      const r = interact(e, live);
      windows += ofType(r.events, 'GUARDIAN_STATE').filter((x) => x.cue === 'GUARDIAN_EXPOSED').length;
      for (let k = 0; k < 3; k++) e.dispatch(endTurn(e)); // the 3-round window, then the next lever wakes
    }
    expect(windows).toBe(4);
  });

  it('XXVI: taking the relic shuts the main gate (deferred if occupied) and opens the side gate for good', () => {
    const { state } = runRoute(engineFor('w3_e06', 'archer'), ROUTES.w3_e06!.slice(0, 7));
    const relic = state.mechanisms!.objects.find((o) => o.def.id === 'relic')!;
    expect(relic.state).toBe('CARRIED');
    const gate = (id: string) => state.mechanisms!.objects.find((o) => o.def.id === id)!.state;
    expect([gate('gate-main'), gate('gate-side'), gate('trap-n')]).toEqual(['CLOSED', 'OPEN', 'ENABLED']);
  });

  it('XXVI: the extraction stays reachable from anywhere the relic can be (no rule ever closes the side gate)', () => {
    const e = engineFor('w3_e06', 'mage');
    const closes = e.scenario.mechanisms!.rules.flatMap((r) => r.actions).filter((a) => a.type === 'CLOSE' || a.type === 'TOGGLE' || a.type === 'RESET');
    expect(closes.flatMap((a) => a.targets ?? [])).toEqual(['gate-main']);
    // From the vault with the relic in hand, the way home exists on foot.
    const { state } = runRoute(engineFor('w3_e06', 'mage'), ROUTES.w3_e06!.slice(0, 7));
    const probe = GameEngine.fromSnapshot(state, e.content, e.scenario);
    expect(probe.getLegalMoves().length).toBeGreaterThan(0);
    expect(runRoute(GameEngine.fromSnapshot(state, e.content, e.scenario), ROUTES.w3_e06!.slice(7)).result).toBe('WON');
  });

  it('XXVI: wrong rune order never locks the vault (sequence restarts)', () => {
    const e = engineFor('w3_e06', 'mage');
    const s = mutable(e);
    s.units = s.units.filter((u) => u.kind !== 'ENEMY');
    s.units[0]!.pos = p(6, 5);
    interact(e, 'rune-moon'); // wrong first
    e.dispatch(endTurn(e));
    mutable(e).units[0]!.pos = p(6, 1);
    interact(e, 'rune-sun');
    e.dispatch(endTurn(e));
    mutable(e).units[0]!.pos = p(6, 5);
    interact(e, 'rune-moon');
    expect(m(e, 'vault').state).toBe('OPEN');
  });
});
