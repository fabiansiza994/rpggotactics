import type { ScenarioDef } from '../domain/scenario';

/**
 * Layout legend shared by every MVP scenario:
 *   .  suelo normal      #  pilar (bloquea paso y visión)   r  escombros (bloquea paso, no visión)
 *   F  fuego             I  hielo                           x  abismo (BLOCKED)
 *   E  salida (OBJECTIVE)    L  lava (permanente, 2 de daño al terminar el turno encima)
 */
export const LEGEND: ScenarioDef['legend'] = {
  '.': {},
  '#': { obstacleId: 'pillar' },
  r: { obstacleId: 'rubble' },
  F: { terrain: 'FIRE' },
  I: { terrain: 'ICE' },
  x: { terrain: 'BLOCKED' },
  E: { terrain: 'OBJECTIVE' },
  L: { terrain: 'LAVA' },
};

export const FIRST_BLOOD: ScenarioDef = {
  id: 'first_blood',
  name: 'First Blood',
  description: 'Derrota a los 2 enemigos. Aprende a moverte y a atacar.',
  layout: [
    '.......', //
    '...#...',
    '.......',
    '..r..I.',
    '.......',
  ],
  legend: LEGEND,
  hero: { heroId: 'mage', pos: { x: 1, y: 2 } },
  structures: [],
  enemies: [
    { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 5, y: 1 } },
    { id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 6, y: 3 } },
  ],
  waves: [],
  objectives: [{ type: 'ELIMINATE_ALL' }],
  defaultSeed: 1001,
};

export const CRYSTAL_GUARD: ScenarioDef = {
  id: 'crystal_guard',
  name: 'Crystal Guard',
  description: 'Protege el cristal durante 6 rondas. Usa terreno y control para frenar al enemigo.',
  layout: [
    '..I..#.', //
    '.......',
    '...F...',
    '.#...I.',
    '..I....',
  ],
  legend: LEGEND,
  hero: { heroId: 'mage', pos: { x: 2, y: 1 } },
  structures: [{ id: 'crystal', structureId: 'crystal', pos: { x: 0, y: 2 } }],
  enemies: [
    { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 5, y: 1 }, targetPreference: 'OBJECTIVE' },
    { id: 'shaman-1', enemyId: 'dark_shaman', pos: { x: 6, y: 3 } },
  ],
  waves: [
    { round: 3, enemies: [{ id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 6, y: 2 }, targetPreference: 'OBJECTIVE' }] },
    { round: 4, enemies: [{ id: 'orc-2', enemyId: 'orc_warrior', pos: { x: 6, y: 4 }, targetPreference: 'OBJECTIVE' }] },
  ],
  objectives: [{ type: 'PROTECT_TARGET', targetUnitId: 'crystal', rounds: 6 }],
  defaultSeed: 2002,
};

export const ESCAPE: ScenarioDef = {
  id: 'escape',
  name: 'Escape',
  description: 'Alcanza una casilla de salida antes de que terminen 7 rondas.',
  layout: [
    '..#.x.E', //
    '..#.I..',
    '....#..',
    '..x.I..',
    '..#.x.E',
  ],
  legend: LEGEND,
  hero: { heroId: 'mage', pos: { x: 0, y: 2 } },
  structures: [],
  enemies: [
    { id: 'brute-1', enemyId: 'stone_brute', pos: { x: 5, y: 2 } },
    { id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 5, y: 0 } },
    { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 5, y: 4 } },
    { id: 'shaman-1', enemyId: 'dark_shaman', pos: { x: 6, y: 3 } },
  ],
  waves: [
    { round: 3, enemies: [{ id: 'wolf-2', enemyId: 'shadow_wolf', pos: { x: 6, y: 1 } }] },
  ],
  objectives: [{ type: 'REACH_TILE', tiles: [{ x: 6, y: 0 }, { x: 6, y: 4 }], roundLimit: 7 }],
  defaultSeed: 3003,
};

export const SCENARIOS: readonly ScenarioDef[] = [FIRST_BLOOD, CRYSTAL_GUARD, ESCAPE];

export const SCENARIOS_BY_ID: Readonly<Record<string, ScenarioDef>> = Object.fromEntries(
  SCENARIOS.map((s) => [s.id, s]),
);
