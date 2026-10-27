import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT } from '../src/game/data';
import { withArcher } from '../src/game/data/archer';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import { TEMPLE_CAMPAIGN, TEMPLE_ENCOUNTERS } from '../src/game/data/temple-encounters';
import { WORLD_CAMPAIGNS, WORLDS } from '../src/game/data/worlds';
import { GameEngine } from '../src/game/engine/GameEngine';
import { encounterFor, validateCampaign } from '../src/game/run/encounter';
import { validateScenario } from '../src/game/domain/scenario-validation';
import type { ScenarioDef } from '../src/game/domain/scenario';
import { spawnSummon } from '../src/game/domain/summons/summons';
import { actSummons } from '../src/game/domain/summons/summons';
import { syncMechanisms } from '../src/game/domain/mechanisms/mechanism-rules';
import { mechanismById } from '../src/game/domain/mechanisms/mechanism-board';
import { queryContext } from '../src/game/domain/context';
import { canSolveWithin, railReachesGoal, ROUTES, runRoute } from './support/act3-pilot';
import { ctxFor, endTurn, mutable, p, unit } from './helpers';

const CONTENT = withArcher(withShapeshifterRelease(DEFAULT_CONTENT));
const CHAMPIONS = TEMPLE_CAMPAIGN.heroIds;
const engineFor = (id: string, heroId: string, seed?: number) => {
  const sc = encounterFor(TEMPLE_CAMPAIGN, id, heroId);
  return new GameEngine(sc, CONTENT, seed ?? sc.defaultSeed);
};
const m = (e: GameEngine, id: string) => mechanismById(e.state, id)!;
const settle = (e: GameEngine) => syncMechanisms(queryContext(mutable(e), e.content));

describe('Act III encounters — data', () => {
  it('the temple campaign validates for every champion', () => {
    expect(validateCampaign(TEMPLE_CAMPAIGN, CONTENT)).toEqual([]);
    expect(TEMPLE_ENCOUNTERS.map((e) => e.id)).toEqual(['w3_e01', 'w3_e02', 'w3_e03', 'w3_e04', 'w3_e05', 'w3_e06', 'w3_e07', 'w3_e08', 'w3_e09', 'w3_e10']);
  });

  it('is World 3, hidden behind the WORLD_3 flag (no menu, no server run until released)', () => {
    const world = WORLDS.find((w) => w.campaignId === TEMPLE_CAMPAIGN.id)!;
    expect(world).toMatchObject({ id: 'world_3', releaseFlag: 'WORLD_3' });
    expect(WORLD_CAMPAIGNS[TEMPLE_CAMPAIGN.id]).toBe(TEMPLE_CAMPAIGN);
  });

  it('no Act I / Act II / Archer story encounter declares mechanisms', () => {
    for (const campaign of Object.values(WORLD_CAMPAIGNS).filter((c) => c.id !== TEMPLE_CAMPAIGN.id))
      for (const e of campaign.encounters) expect(e.mechanisms, e.id).toBeUndefined();
  });

  it('authoring validation catches broken puzzles', () => {
    const base = TEMPLE_ENCOUNTERS[0]!;
    const broken: ScenarioDef = {
      ...base,
      mechanisms: {
        objects: [
          { id: 'lever', kind: 'SWITCH', pos: { x: 5, y: 0 } }, // on a wall
          { id: 'gate', kind: 'GATE', pos: { x: 5, y: 2 } },
          { id: 'statue', kind: 'STATUE', pos: { x: 2, y: 2 }, allowedTiles: [{ x: 0, y: 0 }] },
        ],
        rules: [
          { id: 'r', trigger: { type: 'ON_INTERACT', sources: ['gate'] }, actions: [{ type: 'MOVE', targets: ['gate'] }] },
          { id: 'r2', trigger: { type: 'ON_OCCUPIED', sources: ['lever'] }, actions: [{ type: 'OPEN', targets: ['ghost'] }] },
        ],
      },
    };
    expect(validateScenario(base, CONTENT)).toEqual([]);
    const errors = validateScenario(broken, CONTENT);
    expect(errors.join('\n')).toMatch(/lever.*not on walkable floor/);
    expect(errors.join('\n')).toMatch(/statue.*outside its allowedTiles/);
    expect(errors.join('\n')).toMatch(/"gate" cannot be interacted with/);
    expect(errors.join('\n')).toMatch(/MOVE cannot target GATE/);
    expect(errors.join('\n')).toMatch(/ON_OCCUPIED sources must be pressure plates/);
    expect(errors.join('\n')).toMatch(/unknown target "ghost"/);
  });
});

describe('Act III encounters — every champion solves every puzzle with MOVE + INTERACT only', () => {
  // Phase 1 (XXI–XXIII). XXIV–XXVI have their own route tests in act3-phase2.test.ts (XXV needs the
  // Guardian alive, which puzzle-only mode would remove).
  for (const enc of TEMPLE_ENCOUNTERS.slice(0, 3))
    it(`${enc.name}: known route wins for ${CHAMPIONS.join(', ')}`, () => {
      for (const heroId of CHAMPIONS) expect(runRoute(engineFor(enc.id, heroId), ROUTES[enc.id]!).result, heroId).toBe('WON');
    });

  it('statue rails: from every allowed tile the statue can still be pushed onto its plate (no dead positions)', () => {
    for (const [id, statueId, plateId] of [['w3_e02', 'statue', 'plate'], ['w3_e03', 'statue-a', 'seal-a'], ['w3_e03', 'statue-b', 'seal-b']] as const) {
      const e = engineFor(id, 'mage');
      const statue = m(e, statueId);
      const isFloor = (q: { x: number; y: number }) => {
        const tile = e.state.board.tiles[q.y * e.state.board.width + q.x];
        return q.x >= 0 && q.y >= 0 && q.x < e.state.board.width && q.y < e.state.board.height && !!tile && CONTENT.terrain[tile.terrain]?.walkable === true && !e.state.obstacles.some((o) => o.pos.x === q.x && o.pos.y === q.y);
      };
      expect(statue.def.allowedTiles, `${id} ${statueId} has a rail`).toBeDefined();
      expect(railReachesGoal(statue.def.allowedTiles!, m(e, plateId).pos, isFloor), `${id} ${statueId}`).toEqual([]);
    }
  });
});

describe('Act III encounters — the puzzle is the point (a champion alone cannot cheese it)', () => {
  // Bounded searches on boards made tiny by removing the statues: they finish exhausted (every
  // reachable configuration visited) well under the node cap.
  it('XXII: without the statue, no champion can cross on foot (the bridge rises behind them)', () => {
    for (const heroId of CHAMPIONS) {
      const e = engineFor('w3_e02', heroId);
      mutable(e).mechanisms!.objects = mutable(e).mechanisms!.objects.filter((o) => o.def.id !== 'statue');
      const r = canSolveWithin(e, 12);
      expect(r, heroId).toMatchObject({ solved: false, exhausted: true });
    }
  });

  it('XXIII: without the statues, a champion alone cannot hold the three seals', () => {
    for (const heroId of CHAMPIONS) {
      const e = engineFor('w3_e03', heroId);
      mutable(e).mechanisms!.objects = mutable(e).mechanisms!.objects.filter((o) => o.def.kind !== 'STATUE');
      const r = canSolveWithin(e, 12);
      expect(r, heroId).toMatchObject({ solved: false, exhausted: true });
    }
  });

  it('XXI teaches the gate: the exit is unreachable until the lever is pulled', () => {
    const e = engineFor('w3_e01', 'mage');
    mutable(e).mechanisms!.rules = [];
    expect(canSolveWithin(e, 12)).toMatchObject({ solved: false, exhausted: true });
  });
});

describe('Act III — softlock scenarios', () => {
  it('XXII: statues can never leave the 2×2 counterweight block (pushing it against a wall is refused)', () => {
    const e = engineFor('w3_e02', 'warrior');
    mutable(e).units.find((u) => u.kind === 'HERO')!.pos = p(2, 4);
    mutable(e).units = mutable(e).units.filter((u) => u.kind !== 'ENEMY');
    expect(e.dispatch({ type: 'INTERACT', mechanismId: 'statue' }).ok).toBe(true); // → (0,4)
    e.dispatch(endTurn(e));
    mutable(e).units.find((u) => u.kind === 'HERO')!.pos = p(0, 5);
    const up = e.getInteractions().find((o) => o.mechanismId === 'statue')!;
    expect(up).toMatchObject({ allowed: false, reason: 'PUSH_BLOCKED' }); // (0,3) is off its rail
  });

  it('XXII: abandoning the plate after the statue holds it keeps the bridge down', () => {
    const e = engineFor('w3_e02', 'mage');
    const s = mutable(e);
    s.units = s.units.filter((u) => u.kind !== 'ENEMY');
    s.mechanisms!.objects.find((o) => o.def.id === 'statue')!.pos = p(0, 5);
    settle(e);
    expect(m(e, 'bridge-w').state).toBe('LOWERED');
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(2, 2) });
    expect(m(e, 'bridge-w').state).toBe('LOWERED');
  });

  it('XXII: a bridge never rises under a unit crossing it, and nobody is stranded', () => {
    const e = engineFor('w3_e02', 'mage');
    const s = mutable(e);
    s.units = s.units.filter((u) => u.kind !== 'ENEMY');
    const hero = unit(e, 'mage');
    hero.pos = p(0, 5);
    settle(e); // champion on the plate: bridge down
    hero.pos = p(4, 2); // (test arrange) the champion is on the west span when the plate empties
    settle(e);
    expect(m(e, 'bridge-w')).toMatchObject({ state: 'LOWERED', pending: { action: 'RAISE' } });
    expect(m(e, 'bridge-e').state).toBe('RAISED');
    // The span it stands on still touches solid ground: it can walk back.
    expect(e.getLegalMoves().some((n) => n.pos.x === 3 && n.pos.y === 2)).toBe(true);
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(3, 2) });
    expect(m(e, 'bridge-w').state).toBe('RAISED');
  });

  it('XXIII: the reset lever returns misplaced statues home; a blocked home waits for its tile', () => {
    const e = engineFor('w3_e03', 'mage');
    const s = mutable(e);
    s.units = s.units.filter((u) => u.kind !== 'ENEMY');
    s.pendingWaves = [];
    m(e, 'statue-a').pos = p(4, 1);
    m(e, 'statue-b').pos = p(3, 2);
    unit(e, 'mage').pos = p(1, 0);
    s.units.push({ ...structuredClone(unit(e, 'mage')), id: 'decoy', kind: 'STRUCTURE', pos: p(2, 1) }); // stands on statue-a's home
    expect(e.dispatch({ type: 'INTERACT', mechanismId: 'reset' }).ok).toBe(true);
    expect(m(e, 'statue-b').pos).toEqual(p(3, 3));
    expect(m(e, 'statue-a')).toMatchObject({ pos: p(4, 1), pending: { action: 'RESET' } });
    // Always the engine's CURRENT state: dispatch replaced the object `s` pointed to.
    mutable(e).units = mutable(e).units.filter((u) => u.id !== 'decoy');
    e.dispatch(endTurn(e));
    expect(m(e, 'statue-a').pos).toEqual(p(2, 1));
  });

  it('XXIII: once the three seals hold, the chamber stays open and the seals lock', () => {
    const e = engineFor('w3_e03', 'warrior');
    const s = mutable(e);
    s.units = s.units.filter((u) => u.kind !== 'ENEMY');
    m(e, 'statue-a').pos = p(1, 1);
    m(e, 'statue-b').pos = p(3, 4);
    unit(e, 'warrior').pos = p(4, 2);
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'warrior', to: p(5, 2) });
    expect(m(e, 'gate').state).toBe('OPEN');
    expect(['seal-a', 'seal-b', 'seal-c'].map((id) => m(e, id).locked)).toEqual([true, true, true]);
    expect(m(e, 'vent-n').state).toBe('DISABLED');
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'warrior', to: p(4, 2) });
    expect(m(e, 'gate').state).toBe('OPEN');
    expect(m(e, 'seal-c').active).toBe(true);
  });
});

describe('Act III — Summoner plate advantage', () => {
  it('XXII: a summon left on the plate lowers the bridge and stays while the Summoner crosses', () => {
    const e = engineFor('w3_e02', 'summoner');
    const s = mutable(e);
    s.units = s.units.filter((u) => u.kind !== 'ENEMY');
    s.pendingWaves = [];
    const ctx = ctxFor(e);
    const fox = spawnSummon(ctx, unit(e, 'summoner'), 'fox', p(0, 5))!;
    settle(e);
    expect(m(e, 'bridge-w').state).toBe('LOWERED');
    fox.summon!.readyRound = 1;
    actSummons(ctx);
    expect(fox.pos).toEqual(p(0, 5));
  });

  it('XXIII: a summon may hold any seal', () => {
    const e = engineFor('w3_e03', 'summoner');
    const s = mutable(e);
    s.units = s.units.filter((u) => u.kind !== 'ENEMY');
    m(e, 'statue-a').pos = p(1, 1);
    spawnSummon(ctxFor(e), unit(e, 'summoner'), 'turtle', p(3, 4));
    unit(e, 'summoner').pos = p(4, 2);
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'summoner', to: p(5, 2) });
    expect(m(e, 'gate').state).toBe('OPEN');
  });
});

describe('Act III — determinism of the authored encounters', () => {
  it('every known route replays to byte-identical final states', () => {
    // Combat-only goals (XXV Guardian, XXX boss) have no puzzle-only route.
    for (const enc of TEMPLE_ENCOUNTERS.filter((e) => e.id !== 'w3_e05' && e.id !== 'w3_e10')) {
      const a = runRoute(engineFor(enc.id, 'warrior'), ROUTES[enc.id]!).state;
      const b = runRoute(engineFor(enc.id, 'warrior'), ROUTES[enc.id]!).state;
      expect(a.outcome).toMatchObject({ result: 'WON' });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });
});
