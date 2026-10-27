/** Visual-only fixtures. No commands, save slots, AI, capacity or movement rules are changed. */
import {
  DEFAULT_CONTENT,
  GameEngine,
  SCENARIOS_BY_ID,
  type GameState,
  type Pos,
  type Unit,
} from '../../../game';
import type { BoardViewModel } from '../../pixi/viewModel';

export const SHOWCASE_UNIT = 'qa-locomotion-unit';
export function showcaseState(id: string): GameState {
  const scenario = SCENARIOS_BY_ID.first_blood!;
  const state = structuredClone(
    new GameEngine(
      { ...scenario, hero: { ...scenario.hero, heroId: 'summoner' } },
      DEFAULT_CONTENT,
      13,
    ).state,
  ) as GameState;
  const hero = state.units.find((u) => u.kind === 'HERO')!;
  const summon = DEFAULT_CONTENT.summons?.[id];
  const form = id.startsWith('qa_form_') ? id.slice('qa_form_'.length) : null;
  const definition = summon ?? DEFAULT_CONTENT.heroes[id] ?? DEFAULT_CONTENT.enemies[id];
  const unit: Unit = {
    ...hero,
    id: SHOWCASE_UNIT,
    defId: form ? 'shapeshifter' : id,
    activeForm: form === 'humanoid' ? undefined : (form ?? undefined),
    name: form ? `Cambiaformas ${form}` : id==='qa_archer' ? 'Arquero · QA visual' : (definition?.name ?? id),
    kind: form || DEFAULT_CONTENT.heroes[id] ? 'HERO' : summon ? 'SUMMON' : 'ENEMY',
    pos: { x: 1, y: 2 },
    hp: definition?.maxHp ?? hero.maxHp,
    maxHp: definition?.maxHp ?? hero.maxHp,
    shield: 0,
    statuses: [],
  };
  return {
    ...state,
    scenarioId: `locomotion:${id}`,
    units: [unit],
    intents: [],
    obstacles: [],
    collectibles: [],
    player: { ...state.player, heroId: unit.id },
  };
}
export function showcaseModel(state: GameState): BoardViewModel {
  return {
    state,
    content: DEFAULT_CONTENT,
    heroId: SHOWCASE_UNIT,
    interactive: false,
    hoverTile: null,
    aimArmed: false,
    moveTiles: [],
    hoverPath: [],
    targetTiles: [],
    preview: null,
    intents: [],
    focusedEnemyId: null,
  };
}
export function showcaseRoute(
  steps: 2 | 3,
  direction: 1 | -1,
  start?: Pos,
): { from: Pos; to: Pos; path: Pos[] } {
  const from = start ?? { x: direction === 1 ? 1 : 5, y: 2 };
  const path = Array.from({ length: steps }, (_, i) => ({ x: from.x + (i + 1) * direction, y: 2 }));
  return { from, to: path.at(-1)!, path };
}

/** Bounded orthogonal visual routes; they do not authorize gameplay movement. */
export function showcaseDirectionalRoute(
  steps: 2 | 3,
  direction: 'up' | 'down' | 'left' | 'right',
) {
  const delta = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  }[direction];
  const from = { x: direction === 'left' ? 5 : 1, y: direction === 'up' ? 3 : 0 };
  const path = Array.from({ length: steps }, (_, i) => ({
    x: from.x + delta.x * (i + 1),
    y: from.y + delta.y * (i + 1),
  }));
  return { from, to: path.at(-1)!, path };
}
export function showcaseTurnRoute() {
  return {
    from: { x: 2, y: 3 },
    path: [
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
      { x: 2, y: 3 },
    ],
    to: { x: 2, y: 3 },
  };
}
