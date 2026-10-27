import { BOARD_SIZES } from '../domain/board/board-size';
import type { CampaignDef, EncounterDef } from '../run/encounter';
import { ARCHER_HUNT_CAMPAIGN_ID } from './archer-hunt';
import { LEGEND } from './scenarios';

/**
 * «Sendero del Cazador» — the Archer's Act I: 10 encounters chasing La Bestia del Velo through
 * forest, root-choked ruins and mountain passes. Same framework as every campaign (EncounterDef,
 * objectives, waves, tiers); only the Archer plays it (`heroIds`), with its own run and progress.
 *
 * Each encounter teaches one Archer idea with the STARTER deck (every card a fight needs is in the
 * 30-card starter: Ojo del Cazador, Disparo Certero, Flecha Perforante, Trampa de Zarzas, Tiro al
 * Corazón…); the reward of each one is a fixed campaign card (`rewards.cards`), a bonus, never a
 * requirement. Balance probe: qa/archer-campaign/REPORT.md.
 *
 * Legend: the shared one plus `c` = cover (ranged attacks against a unit on it deal 1 less).
 * Coordinates: x = column (0 = left, hero side), y = row (0 = back row).
 */
const HUNT_LEGEND: EncounterDef['legend'] = { ...LEGEND, c: { terrain: 'COVER' } };

type Authored = Omit<EncounterDef, 'legend' | 'structures' | 'next' | 'waves' | 'hero'> &
  Partial<Pick<EncounterDef, 'waves' | 'structures'>> & { heroPos: EncounterDef['hero']['pos'] };

const reward = (pool: EncounterDef['rewards']['pool'], cardId: string | null): EncounterDef['rewards'] =>
  cardId ? { pool, choices: 1, cards: [cardId] } : { pool, choices: 0 };

const AUTHORED: Authored[] = [
  {
    id: 'hunt_01_trail',
    name: 'I · El Rastro',
    tier: 'NORMAL',
    board: BOARD_SIZES.COMPACT,
    focus: 'Marca a un orco con Ojo del Cazador: tu Presa recibe más daño. Dispara desde lejos y no dejes que te alcancen.',
    description: 'Primer rastro de la Bestia: dos orcos de avanzada. Presa, disparo y movimiento.',
    layout: [
      '.......', //
      '....#..',
      '.......',
      '..#....',
      '.......',
    ],
    heroPos: { x: 0, y: 2 },
    enemies: [
      { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 6, y: 1 } },
      { id: 'orc-2', enemyId: 'orc_warrior', pos: { x: 6, y: 3 } },
    ],
    objectives: [{ type: 'ELIMINATE_ALL' }],
    rewards: reward('NORMAL', 'fresh_trail'),
    defaultSeed: 201,
  },
  {
    id: 'hunt_02_trees',
    name: 'II · Entre los Árboles',
    tier: 'NORMAL',
    board: BOARD_SIZES.COMPACT,
    focus: 'Caza al chamán líder: los árboles cortan la visión. Busca un ángulo libre; su escolta puede quedar en pie.',
    description: 'El líder se esconde entre troncos que bloquean la línea de visión.',
    layout: [
      '.....#.', //
      '..#....',
      '.......',
      '....#..',
      '.#.....',
    ],
    heroPos: { x: 0, y: 2 },
    enemies: [
      { id: 'leader', enemyId: 'dark_shaman', pos: { x: 6, y: 1 } },
      { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 4, y: 1 } },
    ],
    objectives: [{ type: 'DEFEAT_TARGET', targetUnitId: 'leader' }],
    rewards: reward('NORMAL', 'branch_leap'),
    defaultSeed: 202,
  },
  {
    id: 'hunt_03_field',
    name: 'III · Campo de Caza',
    tier: 'NORMAL',
    board: BOARD_SIZES.STANDARD,
    focus: 'Distancia Óptima: a 3–4 casillas de tu Presa, Disparo Certero te da Concentración. Demasiado cerca, te golpean.',
    description: 'Campo abierto con escombros y cobertura: líneas de tiro largas y rutas alternativas.',
    layout: [
      '.........', //
      '...r..c..',
      '.c...#...',
      '...#...c.',
      '..c..r...',
      '.........',
    ],
    heroPos: { x: 0, y: 3 },
    enemies: [
      { id: 'brute-1', enemyId: 'stone_brute', pos: { x: 7, y: 1 } },
      { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 8, y: 3 } },
      { id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 8, y: 5 } },
    ],
    objectives: [{ type: 'ELIMINATE_ALL' }],
    rewards: reward('NORMAL', 'ice_arrow'),
    defaultSeed: 203,
  },
  {
    id: 'hunt_04_thorns',
    name: 'IV · Paso de Espinas',
    tier: 'NORMAL',
    board: BOARD_SIZES.STANDARD,
    focus: 'ESCAPA: los lobos te persiguen. Zarzas o Flecha de Hielo en su camino, y llega a una SALIDA antes de la ronda 7.',
    description: 'Huida entre zarzas: no hace falta matar a nadie, solo cortar las rutas de los perseguidores.',
    layout: [
      '....r....', //
      '..r...r.E',
      '..r......',
      '......r..',
      '..r.r...E',
      '....r....',
    ],
    heroPos: { x: 1, y: 2 },
    enemies: [
      { id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 0, y: 0 } },
      { id: 'wolf-2', enemyId: 'shadow_wolf', pos: { x: 0, y: 5 } },
      { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 6, y: 2 } },
    ],
    waves: [{ round: 3, enemies: [{ id: 'orc-2', enemyId: 'orc_warrior', pos: { x: 8, y: 2 } }] }],
    objectives: [{ type: 'REACH_TILE', tiles: [{ x: 8, y: 1 }, { x: 8, y: 4 }], roundLimit: 7 }],
    rewards: reward('NORMAL', 'hunters_snare'),
    defaultSeed: 204,
  },
  {
    id: 'hunt_05_stalker',
    name: 'V · El Acechador',
    tier: 'ELITE',
    board: BOARD_SIZES.STANDARD,
    focus: 'ÉLITE: el Acechador corre 4 casillas y golpea por 4 en melé. Atrápalo, retrocede y dispárale desde 3–4.',
    description: 'Primer élite: un cazador veloz que rompe tu distancia cada turno.',
    layout: [
      '.........', //
      '..#...c..',
      '.....r...',
      '...r.....',
      '..c...#..',
      '.........',
    ],
    heroPos: { x: 0, y: 3 },
    enemies: [
      { id: 'stalker', enemyId: 'veil_stalker', pos: { x: 8, y: 2 } },
      { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 8, y: 5 } },
    ],
    objectives: [{ type: 'DEFEAT_TARGET', targetUnitId: 'stalker' }],
    rewards: reward('ELITE', 'pinning_arrow'),
    defaultSeed: 205,
  },
  {
    id: 'hunt_06_gorge',
    name: 'VI · El Desfiladero',
    tier: 'NORMAL',
    board: BOARD_SIZES.STANDARD,
    focus: 'Protege la reliquia 5 rondas: llegan por tres pasos. Flecha Perforante atraviesa a dos en fila.',
    description: 'Defensa de una reliquia del santuario en un desfiladero con tres carriles.',
    layout: [
      '....x....', //
      '..x.x..x.',
      '.........',
      '.........',
      '..x.x..x.',
      '....x....',
    ],
    heroPos: { x: 1, y: 3 },
    structures: [{ id: 'relic', structureId: 'crystal', pos: { x: 0, y: 2 } }],
    enemies: [
      { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 8, y: 0 }, targetPreference: 'OBJECTIVE' },
      { id: 'orc-2', enemyId: 'orc_warrior', pos: { x: 8, y: 3 } },
      { id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 8, y: 5 }, targetPreference: 'OBJECTIVE' },
    ],
    waves: [{ round: 3, enemies: [{ id: 'orc-3', enemyId: 'orc_warrior', pos: { x: 8, y: 2 }, targetPreference: 'OBJECTIVE' }] }],
    objectives: [{ type: 'PROTECT_TARGET', targetUnitId: 'relic', rounds: 5 }],
    rewards: reward('NORMAL', 'fire_arrow'),
    defaultSeed: 206,
  },
  {
    id: 'hunt_07_cornered',
    name: 'VII · Sin Escapatoria',
    tier: 'NORMAL',
    board: BOARD_SIZES.LARGE,
    focus: 'Resiste 6 rondas: llegan por todos los lados. No te quedes en una esquina: muévete y guarda Concentración.',
    description: 'Supervivencia con oleadas pequeñas desde cuatro direcciones.',
    layout: [
      '..........', //
      '..#....#..',
      '....I.....',
      '..........',
      '.....I....',
      '..#....#..',
      '..........',
    ],
    heroPos: { x: 4, y: 3 },
    enemies: [
      { id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 9, y: 3 } },
      { id: 'shaman-1', enemyId: 'dark_shaman', pos: { x: 0, y: 0 } },
    ],
    waves: [
      { round: 2, enemies: [{ id: 'wolf-2', enemyId: 'shadow_wolf', pos: { x: 0, y: 6 } }] },
      { round: 3, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 9, y: 0 } }] },
      { round: 4, enemies: [{ id: 'shaman-2', enemyId: 'dark_shaman', pos: { x: 9, y: 6 } }] },
      { round: 5, enemies: [{ id: 'wolf-3', enemyId: 'shadow_wolf', pos: { x: 0, y: 3 } }] },
    ],
    objectives: [{ type: 'SURVIVE_ROUNDS', rounds: 6 }],
    rewards: reward('NORMAL', 'smoke_arrow'),
    defaultSeed: 207,
  },
  {
    id: 'hunt_08_two_prey',
    name: 'VIII · Dos Presas',
    tier: 'NORMAL',
    board: BOARD_SIZES.STANDARD,
    focus: 'Derriba al Alfa y al Chamán Anciano. Solo tienes UNA Presa: decide a quién marcar primero.',
    description: 'Dos objetivos prioritarios con amenazas distintas: carga en línea y explosión en área.',
    layout: [
      '.........', //
      '...#.....',
      '......c..',
      '..c......',
      '.....#...',
      '.........',
    ],
    heroPos: { x: 0, y: 2 },
    enemies: [
      { id: 'alpha', enemyId: 'wolf_alpha', pos: { x: 8, y: 4 } },
      { id: 'elder', enemyId: 'shaman_elder', pos: { x: 8, y: 1 } },
    ],
    waves: [{ round: 3, enemies: [{ id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 8, y: 0 } }] }],
    objectives: [
      { type: 'DEFEAT_TARGET', targetUnitId: 'alpha' },
      { type: 'DEFEAT_TARGET', targetUnitId: 'elder' },
    ],
    rewards: reward('NORMAL', 'poison_arrow'),
    defaultSeed: 208,
  },
  {
    id: 'hunt_09_guardian',
    name: 'IX · Guardián del Velo',
    tier: 'ELITE',
    board: BOARD_SIZES.STANDARD,
    focus: 'ÉLITE: su explosión cae donde estás y te empuja. No te quedes quieto; a 3–4 casillas es vulnerable.',
    description: 'Segundo élite: un guardián que castiga quedarse fijo. Bajo la mitad de vida, su área crece.',
    layout: [
      '.........', //
      '..c...#..',
      '....r....',
      '.#.......',
      '......r..',
      '...c.....',
    ],
    heroPos: { x: 0, y: 2 },
    enemies: [
      { id: 'guardian', enemyId: 'veil_guardian', pos: { x: 8, y: 3 } },
      { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 7, y: 1 } },
    ],
    waves: [
      { round: 3, enemies: [{ id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 8, y: 0 } }] },
      { round: 5, enemies: [{ id: 'wolf-2', enemyId: 'shadow_wolf', pos: { x: 8, y: 5 } }] },
    ],
    objectives: [{ type: 'DEFEAT_TARGET', targetUnitId: 'guardian' }],
    rewards: reward('ELITE', 'rebound_arrow'),
    defaultSeed: 209,
  },
  {
    id: 'hunt_10_veil_beast',
    name: 'X · La Bestia del Velo',
    tier: 'BOSS',
    board: BOARD_SIZES.LARGE,
    focus: 'JEFE: la Bestia salta en línea recta. Rompe sus carriles con pilares y trampas; bajo la mitad de vida entra en Frenesí.',
    description: 'Jefe final: un cazador monstruoso que cambia de distancia y te obliga a moverte.',
    layout: [
      '..........', //
      '..#.......',
      '......#...',
      '...r......',
      '......#...',
      '..#.......',
      '..........',
    ],
    heroPos: { x: 1, y: 3 },
    enemies: [
      { id: 'beast', enemyId: 'veil_beast', pos: { x: 8, y: 3 } },
      { id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 9, y: 0 } },
    ],
    waves: [
      { round: 3, enemies: [{ id: 'shaman-1', enemyId: 'dark_shaman', pos: { x: 9, y: 6 } }] },
      { round: 5, enemies: [{ id: 'wolf-2', enemyId: 'shadow_wolf', pos: { x: 9, y: 6 } }] },
    ],
    objectives: [{ type: 'DEFEAT_TARGET', targetUnitId: 'beast' }],
    // The act's reward is its completion reward (250 crystals + Ojo del Depredador): no extra offer.
    rewards: reward('BOSS', null),
    defaultSeed: 210,
  },
];

export const ARCHER_HUNT_ENCOUNTERS: readonly EncounterDef[] = AUTHORED.map(({ heroPos, ...e }, i) => ({
  legend: HUNT_LEGEND,
  structures: [],
  waves: [],
  next: AUTHORED[i + 1]?.id ?? null,
  hero: { heroId: 'archer', pos: heroPos },
  ...e,
}));

export const ARCHER_HUNT_CAMPAIGN: CampaignDef = {
  id: ARCHER_HUNT_CAMPAIGN_ID,
  name: 'Sendero del Cazador',
  kind: 'CHAMPION_STORY',
  heroIds: ['archer'],
  start: ARCHER_HUNT_ENCOUNTERS[0]!.id,
  encounters: ARCHER_HUNT_ENCOUNTERS,
};
