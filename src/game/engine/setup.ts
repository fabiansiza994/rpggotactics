import { createBoard, tileAt } from '../domain/board/board';
import { requireDef, type GameContent } from '../domain/content';
import type { RuleContext } from '../domain/context';
import { createDrawPile, drawCards } from '../domain/cards/deck';
import type { Unit } from '../domain/entities/unit';
import type { GameEvent } from '../domain/events';
import type { ScenarioDef } from '../domain/scenario';
import type { GameState } from '../domain/state';
import { beginBattle } from '../domain/turn/turn-flow';
import { evaluateObjective } from '../domain/objectives/objective-rules';
import { scenarioBoardSize, validateScenario } from '../domain/scenario-validation';
import { createMechanismBoard } from '../domain/mechanisms/mechanism-board';

function validateLayout(scenario: ScenarioDef, content: GameContent): { width: number; height: number } {
  const errors = validateScenario(scenario, content);
  if (errors.length) throw new Error(errors.join('\n'));
  const { rows, columns } = scenarioBoardSize(scenario);
  return { width: columns, height: rows };
}

/**
 * Builds the initial GameState from an encounter declaration and runs the battle start
 * (opening hand, round 1, player turn, first intents). Pure: same inputs → same state/events.
 */
export function createBattle(
  scenario: ScenarioDef,
  content: GameContent,
  seed: number,
): { state: GameState; events: GameEvent[] } {
  const { width, height } = validateLayout(scenario, content);
  const heroDef = requireDef(content.heroes, scenario.hero.heroId, 'hero');

  const board = createBoard(width, height);
  const obstacles: GameState['obstacles'] = [];
  let nextId = 1;
  scenario.layout.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const legend = scenario.legend[ch];
      if (!legend) throw new Error(`Scenario ${scenario.id}: no legend entry for "${ch}"`);
      const tile = tileAt(board, { x, y });
      if (tile && legend.terrain) {
        tile.terrain = legend.terrain;
        tile.baseTerrain = legend.terrain;
      }
      if (legend.obstacleId) {
        requireDef(content.obstacles, legend.obstacleId, 'obstacle');
        obstacles.push({ id: `obstacle-${nextId++}`, defId: legend.obstacleId, pos: { x, y }, turnsLeft: null });
      }
    });
  });

  const hero: Unit = {
    id: heroDef.id,
    defId: heroDef.id,
    name: heroDef.name,
    faction: 'PLAYER',
    kind: 'HERO',
    pos: scenario.hero.pos,
    hp: heroDef.maxHp,
    maxHp: heroDef.maxHp,
    shield: 0,
    armor: 0,
    moveRange: heroDef.movePoints,
    statuses: [],
    targetPreference: 'HERO',
    ...(heroDef.momentum ? { momentum: { value: 0, max: heroDef.momentum.max, engagedRound: 0 } } : {}),
    ...(heroDef.focus ? { focus: { value: 0, max: heroDef.focus.max } } : {}),
  };
  const structures: Unit[] = scenario.structures.map((s) => {
    const def = requireDef(content.structures, s.structureId, 'structure');
    return {
      id: s.id,
      defId: def.id,
      name: def.name,
      faction: 'PLAYER',
      kind: 'STRUCTURE',
      pos: s.pos,
      hp: def.maxHp,
      maxHp: def.maxHp,
      shield: 0,
      armor: def.armor,
      moveRange: 0,
      statuses: [],
      targetPreference: 'HERO',
    };
  });
  const enemies: Unit[] = scenario.enemies.map((spawn) => {
    const def = requireDef(content.enemies, spawn.enemyId, 'enemy');
    return {
      id: spawn.id,
      defId: def.id,
      name: def.name,
      faction: 'ENEMY',
      kind: 'ENEMY',
      pos: spawn.pos,
      hp: def.maxHp,
      maxHp: def.maxHp,
      shield: 0,
      armor: def.armor,
      moveRange: def.moveRange,
      statuses: [],
      targetPreference: spawn.targetPreference ?? 'HERO',
    };
  });

  for (const entry of heroDef.deck) {
    const card = requireDef(content.cards, entry.cardId, 'card');
    if (card.heroId && card.heroId !== heroDef.id) throw new Error(`Card ${card.id} is not legal for ${heroDef.id}`);
  }
  // Shuffled once here, from the seed; the opening hand and every later draw take from this pile.
  const rng = { rngState: seed >>> 0 };
  const deck = createDrawPile(rng, heroDef.deck, () => `card-${nextId++}`);

  if (heroDef.guaranteedTransformationOpening && !deck.slice(0, heroDef.startingHandSize).some(c => content.cards[c.cardId]?.effects.some(f => f.type === 'TRANSFORM'))) {
    const index = deck.findIndex(c => content.cards[c.cardId]?.effects.some(f => f.type === 'TRANSFORM'));
    const slot = Math.min(heroDef.startingHandSize, deck.length) - 1;
    if (index >= 0 && slot >= 0) [deck[slot], deck[index]] = [deck[index]!, deck[slot]!];
  }

  const waveEnemies = scenario.waves.reduce((n, w) => n + w.enemies.length, 0);
  const state: GameState = {
    scenarioId: scenario.id,
    round: 1,
    phase: 'PLAYER',
    activeFaction: 'PLAYER',
    board,
    units: [hero, ...structures, ...enemies],
    obstacles,
    collectibles: (scenario.collectibles ?? []).map((c) => ({ ...structuredClone(c), collected: false })),
    player: {
      heroId: hero.id,
      energy: 0,
      maxEnergy: heroDef.maxEnergy,
      movePoints: 0,
      maxMovePoints: heroDef.movePoints,
      drawPerTurn: heroDef.drawPerTurn,
      maxHandSize: heroDef.maxHandSize,
      ...(heroDef.handSize !== undefined ? { handSize: heroDef.handSize } : {}),
      deck,
      hand: [],
      discard: [],
      deckRecycles: 0,
      // Only champions with an altar carry ritual state (other states stay byte-identical).
      ...(heroDef.altarSlots ? { altar: [], altarSeals: 0, ritualsResolved: [] } : {}),
    },
    intents: [],
    objectives: [],
    pendingWaves: structuredClone(scenario.waves),
    outcome: null,
    stats: { enemiesDefeated: 0, totalEnemies: enemies.length + waveEnemies, cardsPlayed: 0 },
    rngState: rng.rngState,
    nextId,
  };
  if (scenario.mechanisms) state.mechanisms = createMechanismBoard(scenario.mechanisms);
  state.objectives = scenario.objectives.map((def) => ({ def, ...evaluateObjective(state, def) }));

  const events: GameEvent[] = [{ type: 'BATTLE_STARTED', scenarioId: scenario.id, seed }];
  if (content.qaCombatDepth && !state.duel) for (const unit of state.units) unit.combatFacing = unit.faction === 'PLAYER' ? 'RIGHT' : 'LEFT';
  const ctx: RuleContext = { state, content, emit: (e) => events.push(e) };
  drawCards(ctx, heroDef.startingHandSize);
  beginBattle(ctx);
  return { state, events };
}
