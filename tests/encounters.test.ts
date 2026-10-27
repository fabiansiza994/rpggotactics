import { describe, expect, it } from 'vitest';
import {
  ASCENT_CAMPAIGN,
  BOARD_SIZES,
  DEFAULT_CONTENT,
  encounterOrder,
  GameEngine,
  validateCampaign,
  validateEncounter,
  validateScenario,
  type EncounterDef,
} from '../src/game';
import { computeReachable } from '../src/game/domain/board/pathfinding';
import { getValidTargets } from '../src/game/domain/cards/targeting';
import { queryContext } from '../src/game/domain/context';
import { posKey } from '../src/game/domain/core/position';
import { ofType, p, scenario } from './helpers';
import { playBattle } from './support/bot';

const blank = (rows: number, columns: number) => Array.from({ length: rows }, () => '.'.repeat(columns));
const encounter = (id: string) => ASCENT_CAMPAIGN.encounters.find((e) => e.id === id)!;

describe('board dimensions come from the encounter', () => {
  for (const [name, size] of Object.entries(BOARD_SIZES)) {
    it(`${name} ${size.rows}x${size.columns}: state, tiles and corners`, () => {
      const engine = new GameEngine(
        scenario({
          layout: blank(size.rows, size.columns),
          hero: { heroId: 'mage', pos: p(0, 0) },
          enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(size.columns - 1, size.rows - 1) }],
        }),
        DEFAULT_CONTENT,
      );
      const { board } = engine.state;
      expect(board.width).toBe(size.columns);
      expect(board.height).toBe(size.rows);
      expect(board.tiles).toHaveLength(size.rows * size.columns);
      // The far corner is a real, occupied tile (no 7×5 clamp anywhere).
      expect(engine.state.units.find((u) => u.id === 'orc-1')?.pos).toEqual(p(size.columns - 1, size.rows - 1));
    });
  }

  it('6x9: movement and pathfinding reach the new columns/rows, never outside the board', () => {
    const engine = new GameEngine(
      scenario({ layout: blank(6, 9), hero: { heroId: 'mage', pos: p(6, 4) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(0, 0) }] }),
      DEFAULT_CONTENT,
    );
    const legal = engine.getLegalMoves().map((n) => n.pos);
    expect(legal).toContainEqual(p(8, 5)); // column 9, row 6: outside any 7×5 board
    expect(legal.every((q) => q.x >= 0 && q.y >= 0 && q.x < 9 && q.y < 6)).toBe(true);
    const result = engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(8, 5) });
    expect(result.ok).toBe(true);
    expect(engine.state.units.find((u) => u.id === 'mage')?.pos).toEqual(p(8, 5));
  });

  it('6x9: blocked cells shape paths (choke point is the only way through)', () => {
    const chasm = encounter('ascent_07_chasm');
    const engine = new GameEngine({ ...chasm, enemies: [{ id: 'far', enemyId: 'orc_warrior', pos: p(8, 0) }], waves: [] }, DEFAULT_CONTENT);
    const state = structuredClone(engine.state);
    const hero = state.units.find((u) => u.id === 'mage')!;
    hero.pos = p(3, 4);
    const reach = computeReachable(queryContext(state, DEFAULT_CONTENT), hero, 4);
    // (5,4) is 2 steps away in a straight line, but the abyss/pillar column forces the detour
    // through the single gap at (4,2): (3,4)→(3,3)→(3,2)→(4,2)→(5,2) = 4.
    expect(reach.get(posKey(p(5, 2)))?.cost).toBe(4);
    expect(reach.has(posKey(p(5, 4)))).toBe(false);
    expect(reach.has(posKey(p(4, 3)))).toBe(false); // pillar
    expect(reach.has(posKey(p(4, 4)))).toBe(false); // abyss
  });

  it('6x9: card targeting covers in-range tiles in the wide area and never leaves the board', () => {
    const engine = new GameEngine(
      scenario({ layout: blank(6, 9), hero: { heroId: 'mage', pos: p(8, 5) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(8, 1) }] }),
      DEFAULT_CONTENT,
    );
    const ctx = queryContext(structuredClone(engine.state), DEFAULT_CONTENT);
    const caster = ctx.state.units.find((u) => u.id === 'mage')!;
    const blink = DEFAULT_CONTENT.cards.blink!.targeting;
    const tiles = getValidTargets(ctx, caster, blink);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((q) => q.x < 9 && q.y < 6)).toBe(true);
    const missile = getValidTargets(ctx, caster, DEFAULT_CONTENT.cards.magic_missile!.targeting);
    expect(missile).toEqual([p(8, 1)]); // range 4 unchanged by the bigger board
  });

  it('7x10: enemy AI walks toward the hero across the large board', () => {
    const engine = new GameEngine(
      scenario({ layout: blank(7, 10), hero: { heroId: 'mage', pos: p(0, 6) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(9, 0) }] }),
      DEFAULT_CONTENT,
    );
    const result = engine.dispatch({ type: 'END_TURN' });
    expect(result.ok).toBe(true);
    const moved = ofType(result.ok ? result.events : [], 'UNIT_MOVED').filter((e) => e.unitId === 'orc-1');
    expect(moved.length).toBeGreaterThan(0);
    const orc = engine.state.units.find((u) => u.id === 'orc-1')!;
    expect(orc.pos.x + (6 - orc.pos.y)).toBeLessThan(9 + 6);
  });
});

describe('encounter validation', () => {
  it('rejects empty, ragged and out-of-limit boards', () => {
    expect(validateScenario(scenario({ layout: [] }), DEFAULT_CONTENT).join()).toMatch(/empty layout/);
    expect(validateScenario(scenario({ layout: ['.......', '......'] }), DEFAULT_CONTENT).join()).toMatch(/ragged/);
    expect(validateScenario(scenario({ layout: blank(2, 7), hero: { heroId: 'mage', pos: p(0, 0) } }), DEFAULT_CONTENT).join()).toMatch(/rows 2/);
    expect(validateScenario(scenario({ layout: blank(5, 13) }), DEFAULT_CONTENT).join()).toMatch(/columns 13/);
    expect(() => new GameEngine(scenario({ layout: blank(5, 13) }), DEFAULT_CONTENT)).toThrow(/columns 13/);
  });

  it('rejects spawns outside the grid, on blocked cells, overlapping, or with duplicate ids', () => {
    const errors = (overrides: Parameters<typeof scenario>[0]) => validateScenario(scenario(overrides), DEFAULT_CONTENT).join('\n');
    expect(errors({ enemies: [{ id: 'o', enemyId: 'orc_warrior', pos: p(7, 2) }] })).toMatch(/outside the 5x7 board/);
    expect(errors({ layout: ['.......', '......x', '.......', '.......', '.......'], enemies: [{ id: 'o', enemyId: 'orc_warrior', pos: p(6, 1) }] })).toMatch(/blocked tile/);
    expect(errors({ layout: ['.......', '......#', '.......', '.......', '.......'], enemies: [{ id: 'o', enemyId: 'orc_warrior', pos: p(6, 1) }] })).toMatch(/blocked tile/);
    expect(errors({ enemies: [{ id: 'a', enemyId: 'orc_warrior', pos: p(5, 2) }, { id: 'b', enemyId: 'orc_warrior', pos: p(5, 2) }] })).toMatch(/overlaps "a"/);
    expect(errors({ enemies: [{ id: 'a', enemyId: 'orc_warrior', pos: p(5, 2) }, { id: 'a', enemyId: 'orc_warrior', pos: p(6, 2) }] })).toMatch(/duplicate unit id/);
    expect(errors({ hero: { heroId: 'mage', pos: p(-1, 0) } })).toMatch(/hero spawn .* outside/);
  });

  it('authoring rules: teams start apart; declared board must match the layout', () => {
    const close = scenario({ enemies: [{ id: 'o', enemyId: 'orc_warrior', pos: p(1, 2) }] });
    expect(validateScenario(close, DEFAULT_CONTENT)).toEqual([]); // rules tests may build cramped boards
    expect(validateScenario(close, DEFAULT_CONTENT, { authoring: true }).join()).toMatch(/spawns 1 tiles from the hero/);
    const mismatch: EncounterDef = { ...encounter('ascent_03_open_field'), board: BOARD_SIZES.COMPACT };
    expect(validateEncounter(mismatch, DEFAULT_CONTENT).join()).toMatch(/declares 5x7 but layout is 6x9/);
  });

  it('DEFEAT_TARGET must reference a real enemy', () => {
    const s = scenario({ objectives: [{ type: 'DEFEAT_TARGET', targetUnitId: 'ghost' }] });
    expect(validateScenario(s, DEFAULT_CONTENT).join()).toMatch(/missing enemy "ghost"/);
  });
});

describe('Ascent campaign catalog', () => {
  const order = encounterOrder(ASCENT_CAMPAIGN);

  it('is valid: every encounter, spawn, link and declared board', () => {
    expect(validateCampaign(ASCENT_CAMPAIGN, DEFAULT_CONTENT)).toEqual([]);
    expect(order).toHaveLength(10);
  });

  it('progression shape: 5x7 intro, 6x9 standard, 7x10 only for the boss; tiers escalate', () => {
    expect(order.map((e) => `${e.board.rows}x${e.board.columns}`)).toEqual([
      '5x7', '5x7', '6x9', '6x9', '6x9', '6x9', '6x9', '6x9', '6x9', '7x10',
    ]);
    expect(order.map((e) => e.tier)).toEqual([
      'NORMAL', 'NORMAL', 'NORMAL', 'NORMAL', 'ELITE', 'NORMAL', 'NORMAL', 'NORMAL', 'ELITE', 'BOSS',
    ]);
    expect(order.at(-1)?.next).toBeNull();
  });

  it('difficulty comes from composition, not stat scaling: normal enemies are the stock definitions', () => {
    const ranks = (e: EncounterDef) =>
      [...e.enemies, ...e.waves.flatMap((w) => w.enemies)].map((s) => DEFAULT_CONTENT.enemies[s.enemyId]!.rank);
    expect(ranks(order[0]!).every((r) => r === 'NORMAL')).toBe(true);
    expect(ranks(encounter('ascent_05_alpha'))).toContain('ELITE');
    expect(ranks(encounter('ascent_10_colossus'))).toContain('BOSS');
    const roles = new Set(order.flatMap((e) => e.enemies.map((s) => DEFAULT_CONTENT.enemies[s.enemyId]!.role)));
    expect([...roles].sort()).toEqual(['DIVER', 'FRONTLINER', 'RANGED', 'TANK']);
    // Reinforcements and blocked geometry are used, but only after the introduction.
    expect(order.slice(0, 3).every((e) => e.waves.length === 0)).toBe(true);
    expect(encounter('ascent_07_chasm').waves.length).toBeGreaterThan(0);
  });

  it('mission variety: most encounters are NOT "eliminate all"; pickups sit on the board', () => {
    const types = order.map((e) => e.objectives.map((o) => o.type).join('+'));
    expect(types).toEqual([
      'ELIMINATE_ALL', 'DEFEAT_TARGET', 'COLLECT_OBJECTS', 'REACH_TILE', 'DEFEAT_TARGET',
      'SURVIVE_ROUNDS', 'COLLECT_OBJECTS', 'PROTECT_TARGET', 'DEFEAT_TARGET', 'DEFEAT_TARGET',
    ]);
    for (const e of order.filter((x) => x.objectives.some((o) => o.type === 'COLLECT_OBJECTS'))) {
      const engine = new GameEngine(e, DEFAULT_CONTENT);
      expect(engine.state.collectibles.length, e.id).toBeGreaterThanOrEqual(2);
      expect(engine.state.collectibles.every((c) => !c.collected)).toBe(true);
    }
  });

  it('each encounter loads with its own board size and spawns', () => {
    for (const e of order) {
      const engine = new GameEngine(e, DEFAULT_CONTENT);
      expect(engine.state.scenarioId).toBe(e.id);
      expect([engine.state.board.height, engine.state.board.width]).toEqual([e.board.rows, e.board.columns]);
      expect(engine.state.units.find((u) => u.kind === 'HERO')?.pos).toEqual(e.hero.pos);
      for (const s of e.enemies) expect(engine.state.units.find((u) => u.id === s.id)?.pos).toEqual(s.pos);
    }
  });

  it('every encounter can be won by a rules-only greedy bot', () => {
    for (const e of order) {
      const won = Array.from({ length: 10 }, (_, i) => i + 1).some(
        (seed) => playBattle(new GameEngine(e, DEFAULT_CONTENT, seed), 30).outcome?.result === 'WON',
      );
      expect(won, e.id).toBe(true);
    }
  }, 240000);
});

describe('DEFEAT_TARGET objective', () => {
  it('wins when the target falls even if other enemies remain', () => {
    const engine = new GameEngine(
      scenario({
        enemies: [
          { id: 'boss', enemyId: 'orc_warrior', pos: p(4, 2) },
          { id: 'guard', enemyId: 'orc_warrior', pos: p(6, 4) },
        ],
        objectives: [{ type: 'DEFEAT_TARGET', targetUnitId: 'boss' }],
      }),
      DEFAULT_CONTENT,
    );
    (engine.state as { units: unknown[] }).units = engine.state.units.map((u) => (u.id === 'boss' ? { ...u, hp: 1 } : u));
    const hand = [{ uid: 'mm', cardId: 'magic_missile' }];
    (engine.state.player as { hand: unknown[] }).hand = hand;
    const result = engine.dispatch({ type: 'PLAY_CARD', cardUid: 'mm', target: p(4, 2) });
    expect(result.ok).toBe(true);
    expect(engine.state.outcome).toEqual({ result: 'WON', reason: 'OBJECTIVES_COMPLETED' });
    expect(engine.state.units.some((u) => u.id === 'guard')).toBe(true);
  });
});
