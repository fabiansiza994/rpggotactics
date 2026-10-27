import { BOARD_SIZES } from '../domain/board/board-size';
import type { CampaignDef, EncounterDef } from '../run/encounter';
import { LEGEND } from './scenarios';

/**
 * "El Ascenso": vertical-slice campaign of 10 encounters. Difficulty comes from composition,
 * roles, formation, geometry, reinforcements and objectives — never from scaling stats.
 * Each encounter asks a different question: eliminate, take down a leader, recover pickups,
 * break through to an exit, hold out, or guard a crystal (objectives + collectibles are data).
 * Ranges/move points are untouched: the 6×9 board is meant to make positioning matter more.
 *
 * Coordinates: x = column (0 = left, hero side), y = row (0 = back row).
 * Legend: . floor  # pillar (blocks move+sight)  r rubble (blocks move)  F fire  I ice  x abyss
 */
type Authored = Omit<EncounterDef, 'legend' | 'structures' | 'next' | 'rewards' | 'waves'> &
  Partial<Pick<EncounterDef, 'waves' | 'rewards' | 'structures'>>;

const REWARDS_BY_TIER = {
  NORMAL: { pool: 'NORMAL', choices: 3 },
  ELITE: { pool: 'ELITE', choices: 3 },
  BOSS: { pool: 'BOSS', choices: 3 },
} as const;

const AUTHORED: Authored[] = [
  {
    id: 'ascent_01_outpost',
    name: 'I · Puesto de guardia',
    tier: 'NORMAL',
    board: BOARD_SIZES.COMPACT,
    focus: 'Dos guerreros avanzan de frente: muévete, apunta y remata.',
    description: 'Combate introductorio contra dos frontliners.',
    layout: [
      '.......', //
      '...#...',
      '.......',
      '.......',
      '.......',
    ],
    hero: { heroId: 'mage', pos: { x: 1, y: 2 } },
    enemies: [
      { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 5, y: 1 } },
      { id: 'orc-2', enemyId: 'orc_warrior', pos: { x: 6, y: 3 } },
    ],
    objectives: [{ type: 'ELIMINATE_ALL' }],
    defaultSeed: 101,
  },
  {
    id: 'ascent_02_watchtower',
    name: 'II · La atalaya',
    tier: 'NORMAL',
    board: BOARD_SIZES.COMPACT,
    focus: 'Derriba al chamán de la atalaya: su guardia puede quedar en pie. Sal de las zonas marcadas.',
    description: 'Primera amenaza a distancia, cubierta por un frontliner. Objetivo: el líder.',
    layout: [
      '.......', //
      '....r..',
      '.......',
      '..#....',
      '.......',
    ],
    hero: { heroId: 'mage', pos: { x: 1, y: 2 } },
    enemies: [
      { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 4, y: 2 } },
      { id: 'shaman-1', enemyId: 'dark_shaman', pos: { x: 6, y: 1 } },
    ],
    objectives: [{ type: 'DEFEAT_TARGET', targetUnitId: 'shaman-1' }],
    defaultSeed: 102,
  },
  {
    id: 'ascent_03_open_field',
    name: 'III · Campo abierto',
    tier: 'NORMAL',
    board: BOARD_SIZES.STANDARD,
    focus: 'Recupera los 2 orbes arcanos, uno en cada flanco. No hace falta matar a todos.',
    description: 'Introducción al 6×9: muévete entre enemigos repartidos para recoger orbes.',
    layout: [
      '.........', //
      '....#....',
      '.........',
      '.........',
      '....r....',
      '.........',
    ],
    hero: { heroId: 'mage', pos: { x: 1, y: 3 } },
    enemies: [
      { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 6, y: 1 } },
      { id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 8, y: 3 } },
      { id: 'orc-2', enemyId: 'orc_warrior', pos: { x: 7, y: 5 } },
    ],
    collectibles: [
      { id: 'orb-1', kind: 'ORB', pos: { x: 5, y: 0 } },
      { id: 'orb-2', kind: 'ORB', pos: { x: 6, y: 4 } },
    ],
    objectives: [{ type: 'COLLECT_OBJECTS', kind: 'ORB', required: 2 }],
    defaultSeed: 103,
  },
  {
    id: 'ascent_04_shield_wall',
    name: 'IV · Muro de escudos',
    tier: 'NORMAL',
    board: BOARD_SIZES.STANDARD,
    focus: 'Un muro con un solo paso, guardado por un bruto: crúzalo y pisa una SALIDA antes de la ronda 8.',
    description: 'Abrirse paso hasta las salidas tras un muro custodiado por frontline y dos chamanes.',
    // Wall on column 6 (rubble lets the shamans see through, pillars don't); gap at rows 2-3.
    layout: [
      '......r.E', //
      '..I...#..',
      '.........',
      '...#.....',
      '......#..',
      '......r.E',
    ],
    hero: { heroId: 'mage', pos: { x: 0, y: 3 } },
    enemies: [
      { id: 'brute-1', enemyId: 'stone_brute', pos: { x: 6, y: 2 } },
      { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 5, y: 4 } },
      { id: 'shaman-1', enemyId: 'dark_shaman', pos: { x: 7, y: 2 } },
      { id: 'shaman-2', enemyId: 'dark_shaman', pos: { x: 8, y: 4 } },
    ],
    objectives: [{ type: 'REACH_TILE', tiles: [{ x: 8, y: 0 }, { x: 8, y: 5 }], roundLimit: 8 }],
    defaultSeed: 104,
  },
  {
    id: 'ascent_05_alpha',
    name: 'V · El alfa',
    tier: 'ELITE',
    board: BOARD_SIZES.STANDARD,
    focus: 'ÉLITE: derrota al Alfa, que embiste 6 casillas en línea. Rompe su carril con pilares y muros.',
    description: 'Primer élite: un lobo alfa con carga larga escoltado por guerreros.',
    layout: [
      '.........', //
      '...#.....',
      '.........',
      '......#..',
      '...#.....',
      '.........',
    ],
    hero: { heroId: 'mage', pos: { x: 1, y: 3 } },
    enemies: [
      { id: 'alpha', enemyId: 'wolf_alpha', pos: { x: 8, y: 2 } },
      { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 6, y: 1 } },
      { id: 'orc-2', enemyId: 'orc_warrior', pos: { x: 7, y: 4 } },
    ],
    objectives: [{ type: 'DEFEAT_TARGET', targetUnitId: 'alpha' }],
    defaultSeed: 105,
    champions: {
      summoner: {
        reason:
          'The escort starts one column back: one more turn to put blockers in the Alpha\'s charge lanes before the orcs arrive (bot: starter 59→70%, mid 85→88%).',
        enemies: [
          { id: 'alpha', enemyId: 'wolf_alpha', pos: { x: 8, y: 2 } },
          { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 7, y: 1 } },
          { id: 'orc-2', enemyId: 'orc_warrior', pos: { x: 8, y: 4 } },
        ],
      },
    },
  },
  {
    id: 'ascent_06_pincer',
    name: 'VI · La pinza',
    tier: 'NORMAL',
    board: BOARD_SIZES.STANDARD,
    focus: 'Resiste 5 rondas: lobos por ambos flancos y refuerzos a tu espalda. No te dejes encerrar.',
    description: 'Supervivencia contra una pinza que aprovecha el ancho del campo.',
    layout: [
      '.........', //
      '.........',
      '....I....',
      '....I....',
      '.........',
      '.........',
    ],
    hero: { heroId: 'mage', pos: { x: 1, y: 2 } },
    enemies: [
      { id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 5, y: 0 } },
      { id: 'wolf-2', enemyId: 'shadow_wolf', pos: { x: 5, y: 5 } },
      { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 6, y: 2 } },
      { id: 'shaman-1', enemyId: 'dark_shaman', pos: { x: 8, y: 3 } },
    ],
    waves: [
      { round: 3, enemies: [{ id: 'orc-2', enemyId: 'orc_warrior', pos: { x: 0, y: 5 } }] },
      { round: 4, enemies: [{ id: 'wolf-3', enemyId: 'shadow_wolf', pos: { x: 8, y: 0 } }] },
    ],
    objectives: [{ type: 'SURVIVE_ROUNDS', rounds: 5 }],
    defaultSeed: 106,
  },
  {
    id: 'ascent_07_chasm',
    name: 'VII · El abismo',
    tier: 'NORMAL',
    board: BOARD_SIZES.STANDARD,
    focus: 'Recupera las 3 páginas del grimorio a ambos lados del abismo. Refuerzos en las rondas 3 y 4.',
    description: 'Choke point con abismo y pilar; páginas repartidas y refuerzos por oleadas.',
    layout: [
      '....x....', //
      '....x....',
      '.........',
      '....#....',
      '....x....',
      '....x....',
    ],
    hero: { heroId: 'mage', pos: { x: 1, y: 3 } },
    enemies: [
      { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 7, y: 1 } },
      { id: 'brute-1', enemyId: 'stone_brute', pos: { x: 6, y: 3 } },
      { id: 'shaman-1', enemyId: 'dark_shaman', pos: { x: 8, y: 4 } },
    ],
    waves: [
      { round: 3, enemies: [{ id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 8, y: 0 } }] },
      { round: 4, enemies: [{ id: 'orc-2', enemyId: 'orc_warrior', pos: { x: 8, y: 5 } }] },
    ],
    collectibles: [
      { id: 'page-1', kind: 'PAGE', pos: { x: 2, y: 5 } },
      { id: 'page-2', kind: 'PAGE', pos: { x: 5, y: 1 } },
      { id: 'page-3', kind: 'PAGE', pos: { x: 6, y: 4 } },
    ],
    objectives: [{ type: 'COLLECT_OBJECTS', kind: 'PAGE', required: 3 }],
    defaultSeed: 107,
    champions: {
      summoner: {
        reason:
          'No Blink across the abyss: pages are fetched by summons through the one-tile choke, so one reinforcement (the wolf, a round later) instead of two (bot: starter 22→37%, mid 36→42%).',
        waves: [{ round: 4, enemies: [{ id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 8, y: 0 } }] }],
      },
    },
  },
  {
    id: 'ascent_08_warband',
    name: 'VIII · Partida de guerra',
    tier: 'NORMAL',
    board: BOARD_SIZES.STANDARD,
    focus: 'Protege el cristal 5 rondas: el guerrero y el lobo van a por él, el resto a por ti.',
    description: 'Defensa de un cristal frente a roles mezclados con sinergia.',
    layout: [
      '.........', //
      '...F.....',
      '.....#...',
      '.........',
      '...r.....',
      '.........',
    ],
    hero: { heroId: 'mage', pos: { x: 1, y: 3 } },
    structures: [{ id: 'crystal', structureId: 'crystal', pos: { x: 0, y: 2 } }],
    enemies: [
      { id: 'brute-1', enemyId: 'stone_brute', pos: { x: 6, y: 3 } },
      { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 6, y: 1 }, targetPreference: 'OBJECTIVE' },
      { id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 7, y: 5 }, targetPreference: 'OBJECTIVE' },
      { id: 'shaman-1', enemyId: 'dark_shaman', pos: { x: 8, y: 2 } },
    ],
    objectives: [{ type: 'PROTECT_TARGET', targetUnitId: 'crystal', rounds: 5 }],
    defaultSeed: 108,
  },
  {
    id: 'ascent_09_elder',
    name: 'IX · El anciano',
    tier: 'ELITE',
    board: BOARD_SIZES.STANDARD,
    focus: 'MINI-JEFE: derrota al Chamán Anciano. Su escolta no importa si él cae.',
    description: 'Objetivo especial: eliminar al líder detrás de su guardia.',
    layout: [
      '.........', //
      '......#..',
      '.........',
      '..r......',
      '......#..',
      '.........',
    ],
    hero: { heroId: 'mage', pos: { x: 1, y: 2 } },
    enemies: [
      { id: 'elder', enemyId: 'shaman_elder', pos: { x: 8, y: 2 } },
      { id: 'brute-1', enemyId: 'stone_brute', pos: { x: 6, y: 2 } },
      { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 6, y: 5 } },
    ],
    waves: [{ round: 3, enemies: [{ id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 8, y: 0 } }] }],
    objectives: [{ type: 'DEFEAT_TARGET', targetUnitId: 'elder' }],
    defaultSeed: 109,
  },
  {
    id: 'ascent_10_colossus',
    name: 'X · El coloso',
    tier: 'BOSS',
    // 7×10: the boss fight is about kiting a slow heavy hitter while adds arrive.
    board: BOARD_SIZES.LARGE,
    focus: 'JEFE: el Coloso golpea por 6 pero se mueve 2. Mantén la distancia y derríbalo.',
    description: 'Jefe con escolta a distancia y refuerzos de lobos.',
    layout: [
      '..........', //
      '...#......',
      '.......I..',
      '....r.....',
      '.......I..',
      '...#......',
      '..........',
    ],
    hero: { heroId: 'mage', pos: { x: 1, y: 3 } },
    enemies: [
      { id: 'colossus', enemyId: 'stone_colossus', pos: { x: 8, y: 3 } },
      { id: 'shaman-1', enemyId: 'dark_shaman', pos: { x: 9, y: 1 } },
      { id: 'shaman-2', enemyId: 'dark_shaman', pos: { x: 9, y: 5 } },
    ],
    waves: [
      { round: 3, enemies: [{ id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 9, y: 0 } }] },
      { round: 5, enemies: [{ id: 'wolf-2', enemyId: 'shadow_wolf', pos: { x: 9, y: 6 } }] },
    ],
    objectives: [{ type: 'DEFEAT_TARGET', targetUnitId: 'colossus' }],
    defaultSeed: 110,
  },
];

export const ASCENT_ENCOUNTERS: readonly EncounterDef[] = AUTHORED.map((e, i) => ({
  legend: LEGEND,
  structures: [],
  waves: [],
  rewards: REWARDS_BY_TIER[e.tier],
  next: AUTHORED[i + 1]?.id ?? null,
  ...e,
}));

export const ASCENT_CAMPAIGN: CampaignDef = {
  id: 'ascent',
  name: 'El Ascenso',
  // Mage first: saves from before multi-champion campaigns are Mage runs. The Warrior plays the
  // authored encounters (no per-champion setups yet); clients/server gate it as QA-only.
  kind: 'MAIN_ACT',
  heroIds: ['mage', 'summoner', 'warrior', 'shapeshifter', 'archer'],
  start: ASCENT_ENCOUNTERS[0]!.id,
  encounters: ASCENT_ENCOUNTERS,
};
