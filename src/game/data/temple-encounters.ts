import { BOARD_SIZES } from '../domain/board/board-size';
import type { Pos } from '../domain/core/position';
import type { CampaignDef, EncounterDef } from '../run/encounter';
import { LEGEND } from './scenarios';
import { TEMPLE_PHASE3_ENCOUNTERS } from './temple-phase3-encounters';

/**
 * Act III «El Templo del Umbral» (local QA only). Phase 1, XXI–XXIII, teaches the interactive
 * battlefield (domain/mechanisms): switch → gate, plate → bridge, three seals (AND). Phase 2,
 * XXIV–XXVI: moving platforms, the Mechanical Guardian (timed lever + plate expose it), ordered
 * runes, relic carry/extraction and a staged objective.
 * Every puzzle is DATA (objects + trigger rules); there is no code per map.
 *
 * Phase 3, XXVII–XXX (data/temple-phase3-encounters.ts): weight-driven sections, the rotating
 * maze, the Heart and the Architect boss. One act of 10 encounters: `TEMPLE_CAMPAIGN`.
 *
 * RELEASE: World 3 (data/worlds.ts WORLD_3) behind the WORLD_3 flag, hidden by default. The DEV
 * labs `/act3-qa` and `/act3-rotation-qa` play it locally.
 * Enemies are the World 1 roster plus the Guardián Mecánico and the Arquitecto (data/temple.ts).
 * Rewards (data/temple-rewards.ts, qa/act3-completion/REPORT.md): NORMAL/ELITE/BOSS pools like the
 * other acts, authored neutral cards at XXIV/XXVI/XXVIII, crystal milestones at XXII/XXV/XXIX
 * (store/freeEconomy.ts) and the completion reward at XXX (crystals, badge, champion card).
 *
 * Coordinates: x = column (0 = left, hero side), y = row (0 = back row).
 * Legend: . floor  # temple wall/pillar  x chasm (BLOCKED, see-through)  E exit
 * Mechanism tiles are '.' in the layout: the mechanism decides whether they block.
 *
 * Softlock analysis per encounter: qa/act3-interactive/REPORT.md (tests/act3-encounters.test.ts,
 * tests/act3-phase2.test.ts).
 */
type Authored = Omit<EncounterDef, 'legend' | 'structures' | 'next' | 'rewards' | 'waves'> &
  Partial<Pick<EncounterDef, 'waves' | 'rewards' | 'structures'>>;

const row = (y: number, xs: number[]): Pos[] => xs.map((x) => ({ x, y }));

const AUTHORED: Authored[] = [
  {
    // Tutorial: one lever, one gate. The lever is one-way (it can never be undone), the gate never
    // closes again → no state of this map can block the exit. Pressure: a wolf + an orc guarding
    // the lever on your side, one orc waiting behind the gate.
    id: 'w3_e01',
    name: 'XXI · La Puerta Sellada',
    tier: 'NORMAL',
    board: BOARD_SIZES.STANDARD,
    focus: 'Ponte junto a la palanca y pulsa ACTIVAR: abre la puerta sellada. Luego llega a la salida.',
    description: 'Tutorial del templo: un interruptor abre la única puerta del muro.',
    layout: [
      '.....#...', //
      '.....#..E',
      '.........',
      '.....#..E',
      '.....#...',
      '.....#...',
    ],
    hero: { heroId: 'mage', pos: { x: 1, y: 2 } },
    enemies: [
      { id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 4, y: 0 } },
      { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 3, y: 5 } },
      { id: 'orc-2', enemyId: 'orc_warrior', pos: { x: 7, y: 2 } },
    ],
    mechanisms: {
      objects: [
        { id: 'lever', kind: 'SWITCH', pos: { x: 3, y: 3 }, toggle: false, label: 'Palanca del sello' },
        { id: 'gate', kind: 'GATE', pos: { x: 5, y: 2 }, label: 'Puerta sellada' },
      ],
      rules: [{ id: 'lever-opens-gate', trigger: { type: 'ON_INTERACT', sources: ['lever'] }, actions: [{ type: 'OPEN', targets: ['gate'] }], once: true }],
    },
    objectives: [
      { type: 'MECHANISM', goal: 'OPEN', ids: ['gate'], label: 'Abre la puerta sellada' },
      { type: 'REACH_TILE', tiles: [{ x: 8, y: 1 }, { x: 8, y: 3 }], roundLimit: 9 },
    ],
    defaultSeed: 301,
  },
  {
    // Plate + bridge: "something must stay here". The plate is 7+ steps from the far bank, so a
    // champion standing on it cannot cross before stepping off raises the bridge (Archer: 4 MP,
    // still short). Universal solution: push the statue onto the plate (2 pushes, any champion).
    // Alternatives: a Summoner GUARD summon holds it; standing on it lets the far orcs cross to you.
    // The statue is confined to the 2×2 block around the plate, where every tile can still reach
    // it → it can never be pushed into a dead position. Each bridge tile touches solid ground, and
    // a segment never rises under someone → nobody is ever stranded.
    id: 'w3_e02',
    name: 'XXII · Puentes Rotos',
    tier: 'NORMAL',
    board: BOARD_SIZES.STANDARD,
    focus: 'El puente solo baja mientras algo pesa sobre la placa. Deja la estatua (o una invocación) encima y cruza.',
    description: 'Placa de presión y puente levadizo sobre el abismo del templo.',
    layout: [
      '...#xx...', //
      '...#xx..E',
      '.........',
      '...#xx..E',
      '...#xx...',
      '...#xx...',
    ],
    hero: { heroId: 'mage', pos: { x: 0, y: 1 } },
    enemies: [
      { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 7, y: 0 } },
      { id: 'orc-2', enemyId: 'orc_warrior', pos: { x: 7, y: 5 } },
      { id: 'shaman-1', enemyId: 'dark_shaman', pos: { x: 8, y: 2 } },
    ],
    waves: [{ round: 2, enemies: [{ id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 2, y: 0 } }] }],
    mechanisms: {
      objects: [
        { id: 'plate', kind: 'PRESSURE_PLATE', pos: { x: 0, y: 5 }, label: 'Placa del puente' },
        {
          id: 'statue',
          kind: 'STATUE',
          pos: { x: 1, y: 4 },
          allowedTiles: [...row(4, [0, 1]), ...row(5, [0, 1])],
          label: 'Estatua de contrapeso',
        },
        { id: 'bridge-w', kind: 'BRIDGE', pos: { x: 4, y: 2 }, label: 'Puente' },
        { id: 'bridge-e', kind: 'BRIDGE', pos: { x: 5, y: 2 }, label: 'Puente' },
      ],
      rules: [
        { id: 'plate-lowers', trigger: { type: 'ON_OCCUPIED', sources: ['plate'] }, actions: [{ type: 'LOWER', targets: ['bridge-w', 'bridge-e'] }] },
        { id: 'plate-raises', trigger: { type: 'ON_VACATED', sources: ['plate'] }, actions: [{ type: 'RAISE', targets: ['bridge-w', 'bridge-e'] }] },
      ],
    },
    objectives: [{ type: 'REACH_TILE', tiles: [{ x: 8, y: 1 }, { x: 8, y: 3 }], roundLimit: 11 }],
    defaultSeed: 302,
  },
  {
    // Three seals (AND). Two statues + one champion hold A, B, C at once → the chamber opens, the
    // seals lock (they stay active forever) and the rune vents die. Statues ride fixed rails
    // (allowedTiles) on which every tile can still be pushed onto its seal → no dead positions;
    // the reset lever brings both home anyway. A Summoner may hold any seal with a GUARD summon.
    id: 'w3_e03',
    name: 'XXIII · Los Tres Sellos',
    tier: 'NORMAL',
    board: BOARD_SIZES.STANDARD,
    focus: 'Activa los tres sellos a la vez: dos estatuas y tú. La cámara de la reliquia se abre.',
    description: 'Puzzle de condición múltiple: tres placas abren la cámara de la reliquia.',
    layout: [
      '.........', //
      '......###',
      '.........',
      '......#..',
      '......###',
      '.........',
    ],
    hero: { heroId: 'mage', pos: { x: 0, y: 2 } },
    enemies: [
      { id: 'brute-1', enemyId: 'stone_brute', pos: { x: 7, y: 3 } },
      { id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 8, y: 0 } },
      { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 5, y: 5 } },
    ],
    waves: [{ round: 3, enemies: [{ id: 'shaman-1', enemyId: 'dark_shaman', pos: { x: 8, y: 5 } }] }],
    mechanisms: {
      objects: [
        { id: 'seal-a', kind: 'PRESSURE_PLATE', pos: { x: 1, y: 1 }, label: 'Sello del Alba' },
        { id: 'seal-b', kind: 'PRESSURE_PLATE', pos: { x: 3, y: 4 }, label: 'Sello del Ocaso' },
        { id: 'seal-c', kind: 'PRESSURE_PLATE', pos: { x: 5, y: 2 }, label: 'Sello del Umbral' },
        { id: 'statue-a', kind: 'STATUE', pos: { x: 2, y: 1 }, allowedTiles: row(1, [1, 2, 3, 4]), label: 'Estatua del Alba' },
        { id: 'statue-b', kind: 'STATUE', pos: { x: 3, y: 3 }, allowedTiles: [{ x: 3, y: 2 }, { x: 3, y: 3 }, { x: 3, y: 4 }], label: 'Estatua del Ocaso' },
        { id: 'gate', kind: 'GATE', pos: { x: 6, y: 2 }, label: 'Cámara de la reliquia' },
        { id: 'relic', kind: 'RELIC', pos: { x: 8, y: 2 }, label: 'Reliquia del Umbral' },
        { id: 'vent-n', kind: 'TRAP', pos: { x: 5, y: 1 }, trap: { damage: 2, damageType: 'ARCANE' }, label: 'Runa de descarga' },
        { id: 'vent-s', kind: 'TRAP', pos: { x: 5, y: 3 }, trap: { damage: 2, damageType: 'ARCANE' }, label: 'Runa de descarga' },
        { id: 'reset', kind: 'SWITCH', pos: { x: 0, y: 0 }, momentary: true, prompt: 'RESTABLECER', label: 'Palanca de restablecer' },
      ],
      rules: [
        {
          id: 'three-seals',
          trigger: { type: 'ON_ALL_ACTIVE', sources: ['seal-a', 'seal-b', 'seal-c'] },
          actions: [
            { type: 'OPEN', targets: ['gate'] },
            { type: 'DISABLE', targets: ['seal-a', 'seal-b', 'seal-c'] },
            { type: 'DISABLE', targets: ['vent-n', 'vent-s'] },
          ],
          once: true,
        },
        { id: 'reset-statues', trigger: { type: 'ON_INTERACT', sources: ['reset'] }, actions: [{ type: 'RESET', targets: ['statue-a', 'statue-b'] }] },
      ],
    },
    objectives: [{ type: 'MECHANISM', goal: 'COLLECT_RELIC', ids: ['relic'], roundLimit: 12, label: 'Recupera la Reliquia del Umbral' }],
    defaultSeed: 303,
  },
  {
    // Two moving floor sections over the temple chasm. The near platform starts docked on the FAR
    // bank, usually carrying an orc: calling it (lever A) brings the orc to you, so the player
    // chooses when to call it. Riding it back (lever A again, standing on it) crosses the chasm.
    // Lever B lifts the second platform from the bank to the exit pocket. Every stop of both
    // platforms touches solid ground → nobody can be stranded; REINICIAR CÁMARA restores both
    // platforms (only mechanism state: never enemies, HP or the fight).
    id: 'w3_e04',
    name: 'XXIV · La Cámara Móvil',
    tier: 'NORMAL',
    board: BOARD_SIZES.STANDARD,
    focus: 'Las secciones del suelo se mueven con las palancas y llevan consigo a quien esté encima. Cuidado con lo que traes.',
    description: 'Plataformas móviles sobre el abismo: alinea las secciones para llegar a la salida.',
    layout: [
      '...xxx..E', //
      '...xxxxxx',
      '...xxxxx.',
      '...xxx...',
      '...xxx...',
      '....xx...',
    ],
    hero: { heroId: 'mage', pos: { x: 1, y: 4 } },
    enemies: [
      { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 5, y: 4 } },
      { id: 'orc-2', enemyId: 'orc_warrior', pos: { x: 6, y: 5 } },
      { id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 6, y: 0 } },
    ],
    mechanisms: {
      objects: [
        {
          id: 'platform-a',
          kind: 'PLATFORM',
          pos: { x: 5, y: 4 },
          stops: { far: { x: 5, y: 4 }, near: { x: 3, y: 4 } },
          initialStop: 'far',
          label: 'Sección del abismo',
        },
        {
          id: 'platform-b',
          kind: 'PLATFORM',
          pos: { x: 7, y: 2 },
          stops: { bank: { x: 7, y: 2 }, pocket: { x: 7, y: 1 } },
          initialStop: 'bank',
          label: 'Sección del umbral',
        },
        { id: 'lever-a', kind: 'SWITCH', pos: { x: 3, y: 5 }, momentary: true, repeatableControl: true, label: 'Palanca del abismo' },
        { id: 'lever-b', kind: 'SWITCH', pos: { x: 8, y: 2 }, momentary: true, repeatableControl: true, label: 'Palanca del umbral' },
        { id: 'reset', kind: 'SWITCH', pos: { x: 0, y: 0 }, momentary: true, repeatableControl: true, prompt: 'RESTABLECER', label: 'Reiniciar cámara' },
      ],
      rules: [
        { id: 'lever-a-moves', trigger: { type: 'ON_INTERACT', sources: ['lever-a'] }, actions: [{ type: 'ADVANCE', targets: ['platform-a'] }] },
        { id: 'lever-b-moves', trigger: { type: 'ON_INTERACT', sources: ['lever-b'] }, actions: [{ type: 'ADVANCE', targets: ['platform-b'] }] },
        { id: 'reset-chamber', trigger: { type: 'ON_INTERACT', sources: ['reset'] }, actions: [{ type: 'RESET', targets: ['platform-a', 'platform-b'] }] },
      ],
    },
    objectives: [{ type: 'REACH_TILE', tiles: [{ x: 8, y: 0 }], roundLimit: 16 }],
    rewards: { pool: 'NORMAL', choices: 1, cards: ['threshold_step'] },
    defaultSeed: 304,
  },
  {
    // Elite: the Guardián Mecánico is plated (FORTIFIED: attacks deal 2 less) from round 1. Its
    // plating drops for 3 rounds whenever the LIVE lever (ON for 2 rounds) and the plate are active
    // together. The core then RELOCATES its control: the used lever goes dark at once (no re-pull
    // inside the window), and only when the window closes (plating back) does the next lever of
    // the ring wake up — A (north) → B (east) → C (south) → A. Standing still at one
    // lever no longer works; every window asks for a new approach. Universal solution: push the
    // statue onto the plate once, then pull whichever lever is live (all three are floor-level
    // pedestals with open tiles on every side, no ranged use, nothing can spawn on them). A
    // Summoner may hold the plate with a summon. Its blow knocks you back 1 tile.
    // State (serialized, replay/reconnect exact): `mechanisms.cycles` (live lever index),
    // `mechanisms.exposureCycles` (closed windows), each lever's state/lock.
    id: 'w3_e05',
    name: 'XXV · Guardián Mecánico',
    tier: 'ELITE',
    board: BOARD_SIZES.STANDARD,
    focus: 'Palanca activa y placa a la vez exponen su núcleo 3 rondas. Después el núcleo cambia de palanca: muévete a la nueva.',
    description: 'Primer élite del templo: un constructo blindado cuyo núcleo cambia de palanca tras cada apertura.',
    layout: [
      '.........', //
      '.#.....#.',
      '.........',
      '.........',
      '.#.....#.',
      '.........',
    ],
    hero: { heroId: 'mage', pos: { x: 3, y: 3 } },
    enemies: [
      { id: 'guardian', enemyId: 'temple_guardian', pos: { x: 5, y: 2 } },
    ],
    // No reinforcements: the walk between levers is the pressure now (playtest).
    waves: [],
    mechanisms: {
      objects: [
        // Ring positions: three open tiles (3 free sides each, no pillar pocket next to them) about
        // 6–7 steps apart: north, east, south. A pedestal beside a pillar made a dead end a single
        // Guardian could seal (playtest), so none sits there.
        { id: 'lever-a', kind: 'SWITCH', pos: { x: 3, y: 0 }, holdRounds: 2, label: 'Palanca del núcleo A' },
        { id: 'lever-b', kind: 'SWITCH', pos: { x: 8, y: 2 }, holdRounds: 2, startsLocked: true, label: 'Palanca del núcleo B' },
        { id: 'lever-c', kind: 'SWITCH', pos: { x: 5, y: 5 }, holdRounds: 2, startsLocked: true, label: 'Palanca del núcleo C' },
        { id: 'plate', kind: 'PRESSURE_PLATE', pos: { x: 2, y: 5 }, label: 'Placa del núcleo' },
        { id: 'statue', kind: 'STATUE', pos: { x: 3, y: 5 }, allowedTiles: [{ x: 2, y: 5 }, { x: 3, y: 5 }], label: 'Estatua de contrapeso' },
      ],
      rules: [
        { id: 'plating', trigger: { type: 'ON_ROUND_START' }, actions: [{ type: 'FORTIFY', unitIds: ['guardian'] }], once: true },
        ...(['a', 'b', 'c'] as const).map((k) => ({
          id: `expose-at-${k}`,
          trigger: { type: 'ON_ALL_ACTIVE' as const, sources: [`lever-${k}`, 'plate'] },
          actions: [
            // 3 rounds: the walk to the next lever is the price of each window (playtest:
            // qa/act3-completion/REPORT.md; 2 rounds left too little time to hit).
            { type: 'EXPOSE' as const, unitIds: ['guardian'], rounds: 3 },
            // The used lever goes dark at once: no re-pull while the core is open.
            { type: 'DISABLE' as const, targets: [`lever-${k}`] },
          ],
        })),
        // Core closed again (end of the window) → the next lever wakes up.
        { id: 'core-relocates', trigger: { type: 'ON_EXPOSE_END', unitIds: ['guardian'] }, actions: [{ type: 'CYCLE', targets: ['lever-a', 'lever-b', 'lever-c'] }] },
      ],
    },
    // No round limit: the pressure is the plating rhythm and the Guardian's blows, not a clock.
    objectives: [{ type: 'DEFEAT_TARGET', targetUnitId: 'guardian' }],
    rewards: { pool: 'ELITE', choices: 3 },
    defaultSeed: 305,
  },
  {
    // Carry + extraction. Wake the runes IN ORDER (Sol, then Luna) to open the vault, take the relic
    // (RECOGER: carried, −1 movement) and bring it back to the entrance (ASEGURAR on an exit tile).
    // Taking it changes the temple once: the main gate shuts behind you (never on anyone), the side
    // gate opens, two rune traps arm and an ambusher arrives at the entrance. The side gate never closes again → the
    // way home always exists. The relic can't vanish: dropped where the carrier stands (or last
    // stood), and nothing can close on a dropped relic.
    id: 'w3_e06',
    name: 'XXVI · La Reliquia Perdida',
    tier: 'NORMAL',
    board: BOARD_SIZES.LARGE,
    focus: 'Despierta la Runa del Sol y después la de la Luna, recoge la reliquia y llévala a la entrada. Entrar fue fácil; salir con ella, no.',
    description: 'Recupera la reliquia y extráela: el templo reacciona cuando la tomas.',
    layout: [
      '....#.....', //
      '....#.....',
      'E......###',
      'E...#.....',
      'E...#..###',
      '..........',
      '....#.....',
    ],
    hero: { heroId: 'mage', pos: { x: 1, y: 3 } },
    enemies: [
      { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 6, y: 2 } },
      { id: 'shaman-1', enemyId: 'dark_shaman', pos: { x: 9, y: 0 } },
    ],
    mechanisms: {
      objects: [
        { id: 'rune-sun', kind: 'SWITCH', pos: { x: 6, y: 0 }, momentary: true, label: 'Runa del Sol' },
        { id: 'rune-moon', kind: 'SWITCH', pos: { x: 6, y: 6 }, momentary: true, label: 'Runa de la Luna' },
        { id: 'vault', kind: 'GATE', pos: { x: 7, y: 3 }, label: 'Cámara de la reliquia' },
        { id: 'gate-main', kind: 'GATE', pos: { x: 4, y: 2 }, initial: 'OPEN', label: 'Puerta principal' },
        { id: 'gate-side', kind: 'GATE', pos: { x: 4, y: 5 }, label: 'Paso lateral' },
        {
          id: 'relic',
          kind: 'RELIC',
          pos: { x: 9, y: 3 },
          carry: { extraction: [{ x: 0, y: 2 }, { x: 0, y: 3 }, { x: 0, y: 4 }] },
          label: 'Reliquia Perdida',
        },
        { id: 'trap-n', kind: 'TRAP', pos: { x: 5, y: 4 }, initial: 'DISABLED', trap: { damage: 2, damageType: 'ARCANE' }, label: 'Runa de descarga' },
        { id: 'trap-s', kind: 'TRAP', pos: { x: 3, y: 4 }, initial: 'DISABLED', trap: { damage: 2, damageType: 'ARCANE' }, label: 'Runa de descarga' },
      ],
      rules: [
        { id: 'sun-then-moon', trigger: { type: 'ON_SEQUENCE', sources: ['rune-sun', 'rune-moon'] }, actions: [{ type: 'OPEN', targets: ['vault'] }], once: true },
        {
          id: 'temple-reacts',
          trigger: { type: 'ON_INTERACT', sources: ['relic'] },
          once: true,
          actions: [
            { type: 'CLOSE', targets: ['gate-main'] },
            { type: 'OPEN', targets: ['gate-side'] },
            { type: 'ENABLE', targets: ['trap-n', 'trap-s'] },
            {
              type: 'SPAWN',
              // One ambusher at the entrance: the way home is the fight, not a flood of spawns.
              enemies: [{ id: 'orc-3', enemyId: 'orc_warrior', pos: { x: 2, y: 0 } }],
            },
          ],
        },
      ],
    },
    objectives: [
      {
        type: 'MECHANISM',
        goal: 'STAGES',
        ids: [],
        label: 'Reliquia asegurada',
        roundLimit: 22,
        stages: [
          { label: 'Llega a la cámara de la reliquia', objective: { type: 'REACH_TILE', tiles: [{ x: 8, y: 3 }], roundLimit: 22 } },
          { label: 'Recoge la reliquia', objective: { type: 'MECHANISM', goal: 'ACTIVATE_N', ids: ['relic'] } },
          { label: 'Llévala a la entrada y asegúrala', objective: { type: 'MECHANISM', goal: 'EXTRACT_RELIC', ids: ['relic'] } },
        ],
      },
    ],
    rewards: { pool: 'NORMAL', choices: 1, cards: ['broken_seal'] },
    defaultSeed: 306,
  },
];

const CHAIN: Omit<EncounterDef, 'next'>[] = [
  ...AUTHORED.map((e) => ({ legend: LEGEND, structures: [], waves: [], rewards: { pool: 'NORMAL' as const, choices: 3 }, ...e })),
  ...TEMPLE_PHASE3_ENCOUNTERS,
];

/** XXI–XXX in play order. */
export const TEMPLE_ENCOUNTERS: readonly EncounterDef[] = CHAIN.map((e, i) => ({ ...e, next: CHAIN[i + 1]?.id ?? null }));

/** Act III «El Templo del Umbral» (World 3): one campaign, ten encounters, every champion. */
export const TEMPLE_CAMPAIGN: CampaignDef = {
  id: 'temple',
  name: 'El Templo del Umbral',
  kind: 'MAIN_ACT',
  heroIds: ['mage', 'summoner', 'warrior', 'shapeshifter', 'archer'],
  start: TEMPLE_ENCOUNTERS[0]!.id,
  encounters: TEMPLE_ENCOUNTERS,
};
