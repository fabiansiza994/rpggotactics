import { BOARD_SIZES } from '../domain/board/board-size';
import type { CampaignDef, EncounterDef } from '../run/encounter';
import { LEGEND } from './scenarios';

/**
 * World 2 «Reino Infernal»: encounters XI–XX. Authored like «El Ascenso» (data/encounters.ts):
 * difficulty comes from LAVA geometry, the infernal roster's riders (burn, push, scorched ground)
 * and the objective — never from scaling the stats of World 1 enemies. Every map has lava; most
 * use it as the shape of the board (corridors, rivers, pits next to the knights' push lines).
 *
 * One lava rule (data/rules.ts): a unit that ENDS its side's turn on lava takes 2 FIRE damage.
 * Crossing it is free. Fire creatures (imps, beast, king) are immune; knights and shamans are not.
 *
 * Coordinates: x = column (0 = left, hero side), y = row (0 = back row).
 * Legend: . floor  # pillar  r rubble  L lava  F fire  E exit  x abyss
 * Ids are stable and world-scoped (w2_eNN); World 1 keeps its historical ids (see run/worlds.ts).
 */
type Authored = Omit<EncounterDef, 'legend' | 'structures' | 'next' | 'rewards' | 'waves'> &
  Partial<Pick<EncounterDef, 'waves' | 'rewards' | 'structures'>>;

/** Same pools as World 1 (no new economy); the boss favours fire-tagged cards (thematic hook). */
const REWARDS_BY_TIER: Record<EncounterDef['tier'], EncounterDef['rewards']> = {
  NORMAL: { pool: 'NORMAL', choices: 3 },
  ELITE: { pool: 'ELITE', choices: 3 },
  BOSS: { pool: 'BOSS', choices: 3, favorTags: ['fire'] },
};

const AUTHORED: Authored[] = [
  {
    id: 'w2_e01',
    name: 'XI · Las puertas de ceniza',
    tier: 'NORMAL',
    board: BOARD_SIZES.STANDARD,
    focus: 'Los diablillos cruzan la lava sin quemarse y te prenden fuego. Tú no: no termines el turno sobre ella.',
    description: 'Introducción al Reino Infernal: lava y diablillos rápidos (los caballeros llegan en el XII).',
    layout: [
      '.........', //
      '...L.....',
      '...L..#..',
      '.........',
      '...L..#..',
      '...L.....',
    ],
    hero: { heroId: 'mage', pos: { x: 1, y: 3 } },
    enemies: [
      { id: 'imp-1', enemyId: 'infernal_imp', pos: { x: 7, y: 1 } },
      { id: 'imp-2', enemyId: 'infernal_imp', pos: { x: 7, y: 5 } },
      { id: 'imp-3', enemyId: 'infernal_imp', pos: { x: 8, y: 3 } },
    ],
    objectives: [{ type: 'ELIMINATE_ALL' }],
    defaultSeed: 201,
  },
  {
    id: 'w2_e02',
    name: 'XII · El corredor ardiente',
    tier: 'NORMAL',
    board: BOARD_SIZES.STANDARD,
    focus: 'Pisa una SALIDA antes de la ronda 7. Los pasillos son estrechos y los caballeros empujan hacia la lava.',
    description: 'Huida por corredores de lava custodiados por frontline que controla el espacio.',
    layout: [
      '..LL...LE', //
      '..LL.#...',
      '.....#LL.',
      '..#......',
      '..LL.#LL.',
      '..LL...LE',
    ],
    hero: { heroId: 'mage', pos: { x: 0, y: 3 } },
    enemies: [
      { id: 'knight-1', enemyId: 'infernal_knight', pos: { x: 7, y: 1 } },
      { id: 'knight-2', enemyId: 'infernal_knight', pos: { x: 6, y: 5 } },
      { id: 'imp-1', enemyId: 'infernal_imp', pos: { x: 4, y: 0 } },
      { id: 'imp-2', enemyId: 'infernal_imp', pos: { x: 4, y: 5 } },
      { id: 'shaman-1', enemyId: 'ash_shaman', pos: { x: 8, y: 3 } },
    ],
    waves: [{ round: 2, enemies: [{ id: 'imp-3', enemyId: 'infernal_imp', pos: { x: 8, y: 4 } }] }],
    objectives: [{ type: 'REACH_TILE', tiles: [{ x: 8, y: 0 }, { x: 8, y: 5 }], roundLimit: 7 }],
    defaultSeed: 202,
  },
  {
    id: 'w2_e03',
    name: 'XIII · La fundición',
    tier: 'NORMAL',
    board: BOARD_SIZES.STANDARD,
    focus: 'Recupera los 3 núcleos de forja entre los pozos de lava. El chamán deja el suelo ardiendo.',
    description: 'Recuperación de objetos con suelo negado por lava permanente y fuego temporal.',
    layout: [
      '....L....', //
      '.L..L..#.',
      '.L.......',
      '.......L.',
      '.#..L..L.',
      '....L....',
    ],
    hero: { heroId: 'mage', pos: { x: 0, y: 3 } },
    enemies: [
      { id: 'knight-1', enemyId: 'infernal_knight', pos: { x: 6, y: 2 } },
      { id: 'shaman-1', enemyId: 'ash_shaman', pos: { x: 8, y: 1 } },
      { id: 'imp-1', enemyId: 'infernal_imp', pos: { x: 7, y: 5 } },
      { id: 'imp-2', enemyId: 'infernal_imp', pos: { x: 8, y: 3 } },
    ],
    waves: [
      { round: 3, enemies: [{ id: 'imp-3', enemyId: 'infernal_imp', pos: { x: 8, y: 0 } }] },
    ],
    collectibles: [
      { id: 'core-1', kind: 'CORE', pos: { x: 3, y: 0 } },
      { id: 'core-2', kind: 'CORE', pos: { x: 5, y: 3 } },
      { id: 'core-3', kind: 'CORE', pos: { x: 8, y: 4 } },
    ],
    objectives: [{ type: 'COLLECT_OBJECTS', kind: 'CORE', required: 3 }],
    defaultSeed: 203,
  },
  {
    id: 'w2_e04',
    name: 'XIV · Los condenados',
    tier: 'NORMAL',
    board: BOARD_SIZES.STANDARD,
    focus: 'Resiste 6 rondas. Llegan diablillos también por tu espalda: elige qué casillas sin lava defender.',
    description: 'Supervivencia en un patio sembrado de pozos de lava, con refuerzos por ambos lados.',
    layout: [
      '.........', //
      '..L...L..',
      '....#....',
      '..L...L..',
      '....#....',
      '..L...L..',
    ],
    hero: { heroId: 'mage', pos: { x: 1, y: 2 } },
    enemies: [
      { id: 'imp-1', enemyId: 'infernal_imp', pos: { x: 8, y: 0 } },
      { id: 'knight-1', enemyId: 'infernal_knight', pos: { x: 7, y: 2 } },
      { id: 'shaman-1', enemyId: 'ash_shaman', pos: { x: 8, y: 4 } },
    ],
    waves: [
      { round: 2, enemies: [{ id: 'imp-2', enemyId: 'infernal_imp', pos: { x: 0, y: 5 } }] },
      { round: 3, enemies: [{ id: 'knight-2', enemyId: 'infernal_knight', pos: { x: 8, y: 5 } }, { id: 'imp-3', enemyId: 'infernal_imp', pos: { x: 8, y: 1 } }] },
      { round: 4, enemies: [{ id: 'imp-4', enemyId: 'infernal_imp', pos: { x: 0, y: 0 } }, { id: 'shaman-2', enemyId: 'ash_shaman', pos: { x: 8, y: 3 } }] },
      { round: 5, enemies: [{ id: 'imp-5', enemyId: 'infernal_imp', pos: { x: 0, y: 3 } }] },
    ],
    objectives: [{ type: 'SURVIVE_ROUNDS', rounds: 6 }],
    defaultSeed: 204,
  },
  {
    id: 'w2_e05',
    name: 'XV · El carcelero',
    tier: 'ELITE',
    board: BOARD_SIZES.STANDARD,
    focus: 'ÉLITE: derrota al Carcelero. Su golpe te lanza 2 casillas: no le des la espalda a un pozo de lava.',
    description: 'Primer élite del mundo: un caballero pesado que lanza a su objetivo hacia los pozos.',
    layout: [
      '.........', //
      '..#...L..',
      '....L....',
      '..L...#..',
      '....L....',
      '..#...L..',
    ],
    hero: { heroId: 'mage', pos: { x: 1, y: 3 } },
    enemies: [
      { id: 'jailer', enemyId: 'infernal_jailer', pos: { x: 7, y: 2 } },
      { id: 'imp-1', enemyId: 'infernal_imp', pos: { x: 8, y: 0 } },
      { id: 'shaman-1', enemyId: 'ash_shaman', pos: { x: 8, y: 4 } },
    ],
    waves: [{ round: 3, enemies: [{ id: 'imp-2', enemyId: 'infernal_imp', pos: { x: 8, y: 5 } }] }],
    objectives: [{ type: 'DEFEAT_TARGET', targetUnitId: 'jailer' }],
    defaultSeed: 205,
  },
  {
    id: 'w2_e06',
    name: 'XVI · Río de fuego',
    tier: 'NORMAL',
    // 7×10: a lava river with three crossings; the exits are on the far bank.
    board: BOARD_SIZES.LARGE,
    focus: 'Cruza el río de lava y pisa una SALIDA antes de la ronda 8. Caballeros guardan el puente y las salidas.',
    description: 'Control de rutas: tres pasos sobre un río de lava, con chamanes negando la otra orilla.',
    layout: [
      '..........', //
      '....LL....',
      '....LL...E',
      '..........',
      '....LL...E',
      '....LL....',
      '..........',
    ],
    hero: { heroId: 'mage', pos: { x: 0, y: 3 } },
    enemies: [
      { id: 'knight-1', enemyId: 'infernal_knight', pos: { x: 6, y: 3 } },
      { id: 'knight-2', enemyId: 'infernal_knight', pos: { x: 8, y: 2 } },
      { id: 'knight-3', enemyId: 'infernal_knight', pos: { x: 8, y: 4 } },
      { id: 'shaman-1', enemyId: 'ash_shaman', pos: { x: 8, y: 0 } },
      { id: 'shaman-2', enemyId: 'ash_shaman', pos: { x: 8, y: 6 } },
      { id: 'imp-1', enemyId: 'infernal_imp', pos: { x: 9, y: 3 } },
    ],
    waves: [{ round: 2, enemies: [{ id: 'imp-2', enemyId: 'infernal_imp', pos: { x: 9, y: 0 } }, { id: 'imp-3', enemyId: 'infernal_imp', pos: { x: 9, y: 6 } }] }],
    objectives: [{ type: 'REACH_TILE', tiles: [{ x: 9, y: 2 }, { x: 9, y: 4 }], roundLimit: 8 }],
    defaultSeed: 206,
  },
  {
    id: 'w2_e07',
    name: 'XVII · Los hornos',
    tier: 'NORMAL',
    board: BOARD_SIZES.STANDARD,
    focus: 'Protege el cristal 5 rondas. Diablillos y caballeros van a por él; llegan refuerzos cada ronda.',
    description: 'Defensa de un objetivo frente a refuerzos sucesivos (oleadas con el sistema existente).',
    layout: [
      '.........', //
      '.L...#...',
      '.........',
      '.L.....L.',
      '.....#...',
      '.L.......',
    ],
    hero: { heroId: 'mage', pos: { x: 2, y: 2 } },
    structures: [{ id: 'crystal', structureId: 'crystal', pos: { x: 0, y: 2 } }],
    enemies: [
      { id: 'knight-1', enemyId: 'infernal_knight', pos: { x: 6, y: 2 }, targetPreference: 'OBJECTIVE' },
      { id: 'imp-1', enemyId: 'infernal_imp', pos: { x: 7, y: 0 }, targetPreference: 'OBJECTIVE' },
      { id: 'shaman-1', enemyId: 'ash_shaman', pos: { x: 8, y: 3 } },
    ],
    waves: [
      { round: 2, enemies: [{ id: 'imp-2', enemyId: 'infernal_imp', pos: { x: 8, y: 5 }, targetPreference: 'OBJECTIVE' }] },
      { round: 3, enemies: [{ id: 'knight-2', enemyId: 'infernal_knight', pos: { x: 8, y: 1 } }] },
      { round: 4, enemies: [{ id: 'imp-3', enemyId: 'infernal_imp', pos: { x: 8, y: 0 }, targetPreference: 'OBJECTIVE' }] },
    ],
    objectives: [{ type: 'PROTECT_TARGET', targetUnitId: 'crystal', rounds: 5 }],
    defaultSeed: 207,
  },
  {
    id: 'w2_e08',
    name: 'XVIII · La bestia encadenada',
    tier: 'ELITE',
    board: BOARD_SIZES.STANDARD,
    focus: 'ÉLITE: derrota a la Bestia de Magma. Su golpe de área se ve venir: sal del recuadro y castígala.',
    description: 'Élite pesado con ataque de zona telegrafiado que deja fuego, escoltado por un caballero.',
    layout: [
      '.........', //
      '...#.....',
      '.....L...',
      '..L...L..',
      '.....L...',
      '...#.....',
    ],
    hero: { heroId: 'mage', pos: { x: 1, y: 3 } },
    enemies: [
      { id: 'beast', enemyId: 'magma_beast', pos: { x: 7, y: 3 } },
      { id: 'knight-1', enemyId: 'infernal_knight', pos: { x: 6, y: 1 } },
      { id: 'imp-1', enemyId: 'infernal_imp', pos: { x: 8, y: 5 } },
    ],
    waves: [{ round: 3, enemies: [{ id: 'imp-2', enemyId: 'infernal_imp', pos: { x: 8, y: 0 } }] }],
    objectives: [{ type: 'DEFEAT_TARGET', targetUnitId: 'beast' }],
    defaultSeed: 208,
  },
  {
    id: 'w2_e09',
    name: 'XIX · Antesala de la forja',
    tier: 'ELITE',
    // 7×10: the hardest normal fight of the world, every infernal role at once.
    board: BOARD_SIZES.LARGE,
    focus: 'Acaba con toda la guardia de la forja: todos los roles del Reino Infernal a la vez, y refuerzos.',
    description: 'Combate duro previo al jefe: frontline que empuja, chamanes, diablillos y refuerzos.',
    layout: [
      '..........', //
      '...L....#.',
      '...L..L...',
      '.....#....',
      '...L..L...',
      '...L....#.',
      '..........',
    ],
    hero: { heroId: 'mage', pos: { x: 1, y: 3 } },
    enemies: [
      { id: 'knight-1', enemyId: 'infernal_knight', pos: { x: 6, y: 3 } },
      { id: 'knight-2', enemyId: 'infernal_knight', pos: { x: 7, y: 5 } },
      { id: 'shaman-1', enemyId: 'ash_shaman', pos: { x: 9, y: 2 } },
      { id: 'imp-1', enemyId: 'infernal_imp', pos: { x: 8, y: 0 } },
    ],
    waves: [{ round: 3, enemies: [{ id: 'imp-2', enemyId: 'infernal_imp', pos: { x: 8, y: 6 } }, { id: 'shaman-2', enemyId: 'ash_shaman', pos: { x: 9, y: 4 } }] }],
    objectives: [{ type: 'ELIMINATE_ALL' }],
    defaultSeed: 209,
  },
  {
    id: 'w2_e10',
    name: 'XX · El Rey de la Forja',
    tier: 'BOSS',
    // 7×10. Its "phases" are composition, not new systems: every slam leaves fire for 3 rounds
    // (the arena shrinks), imps arrive on rounds 3 and 6, a knight on round 5.
    board: BOARD_SIZES.LARGE,
    focus: 'JEFE: el Rey golpea un área de 3×3 a 3 casillas y lanza fuera a quien sobrevive. Cada golpe deja fuego.',
    description: 'Jefe final del Reino Infernal: control de terreno progresivo y refuerzos por fases.',
    layout: [
      '..........', //
      '...#..L...',
      '......L...',
      '..r.......',
      '......L...',
      '...#..L...',
      '..........',
    ],
    hero: { heroId: 'mage', pos: { x: 1, y: 3 } },
    enemies: [
      { id: 'king', enemyId: 'forge_king', pos: { x: 8, y: 3 } },
      { id: 'shaman-1', enemyId: 'ash_shaman', pos: { x: 9, y: 1 } },
    ],
    waves: [
      { round: 3, enemies: [{ id: 'imp-1', enemyId: 'infernal_imp', pos: { x: 9, y: 0 } }] },
      { round: 5, enemies: [{ id: 'knight-1', enemyId: 'infernal_knight', pos: { x: 9, y: 3 } }] },
      { round: 6, enemies: [{ id: 'imp-2', enemyId: 'infernal_imp', pos: { x: 9, y: 6 } }] },
    ],
    objectives: [{ type: 'DEFEAT_TARGET', targetUnitId: 'king' }],
    defaultSeed: 210,
  },
];

export const INFERNAL_ENCOUNTERS: readonly EncounterDef[] = AUTHORED.map((e, i) => ({
  legend: LEGEND,
  structures: [],
  waves: [],
  rewards: REWARDS_BY_TIER[e.tier],
  next: AUTHORED[i + 1]?.id ?? null,
  ...e,
}));

/** World 2's encounters as a campaign: one independent run per champion, like «El Ascenso». */
export const INFERNAL_CAMPAIGN: CampaignDef = {
  id: 'infernal',
  name: 'Reino Infernal',
  kind: 'MAIN_ACT',
  heroIds: ['mage', 'summoner', 'warrior', 'shapeshifter', 'archer'],
  start: INFERNAL_ENCOUNTERS[0]!.id,
  encounters: INFERNAL_ENCOUNTERS,
};
