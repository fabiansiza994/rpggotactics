import type { Pos } from '../domain/core/position';
import type { EncounterDef } from '../run/encounter';
import { LEGEND } from './scenarios';

/**
 * Act III phase 3 — DYNAMIC BOARD GEOMETRY, XXVII–XXX. The act's identity is a board that changes
 * shape during the fight: sections that rotate (REGION, mechanism-transform.ts), platforms that
 * slide (PLATFORM), walls that rise and fall (GATE), controls that relocate (CYCLE). The four maps
 * close the act (data/temple-encounters.ts chains them after XXI–XXVI into one 10-encounter act).
 *
 * Release: Act III is World 3 (data/worlds.ts WORLD_3) behind the WORLD_3 flag (off by default).
 *
 * Coordinates: x = column (0 = left, hero side), y = row (0 = back row).
 * Legend: . floor  # pillar/wall  b low mechanism block (blocks movement, not sight)  x abyss  E exit
 * Mechanism tiles are '.' (or 'x' under a platform stop) in the layout.
 */
const square = (x0: number, y0: number, size: number): Pos[] => {
  const out: Pos[] = [];
  for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) out.push({ x, y });
  return out;
};
const LEGEND_B = { ...LEGEND, b: { obstacleId: 'temple_block' } };

/**
 * XXVII «Peso y Contrapeso». The chasm column holds ONE moving section, the Balanza, linked to a
 * plate on the far bank by weight: plate pressed → the Balanza slides to the NORTH slot (the north
 * route opens, the south one closes); plate free → back to the SOUTH slot. Opening one route closes
 * the other, and whoever stands on the Balanza rides it.
 *
 * Route: walk onto the Balanza (south slot), push the counterweight statue off the south landing
 * onto the plate (INTERACT, any champion) — the weight sends the Balanza north WITH YOU on it —
 * step off into the north pocket and reach the exit. A Summoner can instead drop a summon on the
 * plate from the Balanza (same ride); the champion can never be its own weight (the plate is behind
 * the statue). SAFETY: every Balanza slot touches ground on both banks; nothing can push the statue
 * off its two-tile rail; with the weight on, the north pocket (exit) is always reachable; if a
 * summon-weight dies the Balanza returns south with nobody stranded (both slots touch the west
 * bank). Tests: tests/act3-completion.test.ts.
 */
const PESO_Y_CONTRAPESO: EncounterDef = {
  id: 'w3_e07',
  name: 'XXVII · Peso y Contrapeso',
  tier: 'NORMAL',
  board: { rows: 6, columns: 9 },
  focus: 'La Balanza va donde pesa la placa: con peso, al norte; sin peso, al sur. Súbete y deja que el contrapeso te lleve.',
  description: 'Una sección móvil sobre el abismo obedece al peso de una placa: abrir una ruta cierra la otra.',
  legend: LEGEND,
  layout: [
    '....x...E', //
    '....x....',
    '....x####',
    '....x####',
    '....x....',
    '....x....',
  ],
  hero: { heroId: 'mage', pos: { x: 1, y: 2 } },
  structures: [],
  enemies: [
    { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 6, y: 1 } },
    { id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 0, y: 5 } },
  ],
  waves: [{ round: 3, enemies: [{ id: 'orc-2', enemyId: 'orc_warrior', pos: { x: 0, y: 0 } }] }],
  mechanisms: {
    objects: [
      {
        id: 'balance',
        kind: 'PLATFORM',
        pos: { x: 4, y: 4 },
        stops: { south: { x: 4, y: 4 }, north: { x: 4, y: 1 } },
        initialStop: 'south',
        label: 'La Balanza',
      },
      { id: 'statue', kind: 'STATUE', pos: { x: 5, y: 4 }, allowedTiles: [{ x: 5, y: 4 }, { x: 6, y: 4 }], label: 'Contrapeso' },
      { id: 'plate', kind: 'PRESSURE_PLATE', pos: { x: 6, y: 4 }, label: 'Placa del contrapeso' },
    ],
    rules: [
      { id: 'weight-north', trigger: { type: 'ON_OCCUPIED', sources: ['plate'] }, actions: [{ type: 'MOVE', targets: ['balance'], stop: 'north' }] },
      { id: 'free-south', trigger: { type: 'ON_VACATED', sources: ['plate'] }, actions: [{ type: 'MOVE', targets: ['balance'], stop: 'south' }] },
    ],
  },
  objectives: [{ type: 'REACH_TILE', tiles: [{ x: 8, y: 0 }], roundLimit: 12 }],
  rewards: { pool: 'NORMAL', choices: 3 },
  next: null,
  defaultSeed: 307,
};

const SECTION: Pos[] = square(3, 0, 7);

/**
 * XXVIII. The right 7×7 of the board is one rotating section: walkways over the abyss with a rune
 * console at its centre. The lever on the hero's side turns it clockwise; the console (which rides
 * at the pivot) turns it counter-clockwise. Both are REPEATABLE_CONTROLs: any number of turns per
 * turn, never spending the turn's interaction.
 *
 * Authored (0°) the section holds two walkways:
 *   «el Arco»  doors left (row 5) and bottom: a dead end that never touches the console. Its wolf
 *              reaches you while the Arco faces your side; turning the section seals it away.
 *   «el Eje»   doors top (column 6) and right (row 1): it touches the console. The exit lies right
 *              of the section's middle row, so only the Eje's top door can ever meet it (at 90°).
 * Route: lever ×2 (180°: the Eje's right door now faces your side; its orc comes out to fight) →
 * walk in → console ×1 (90°) → walk out to the exit. Minimum 3 pulls, no
 * shortcut with fewer (checked: tests/act3-living-maze.test.ts); 270° → console ×2 also works.
 *
 * SAFETY: the section is a permutation of itself (validated), so a turn can never put anyone in
 * the abyss or on top of someone; the champion can always reach a control (the lever from the
 * left side, the console from inside the Eje) and the Arco keeps its door while nobody turns it →
 * no softlock (exhaustive state check in the test). The section turns only from player actions.
 */
const LIVING_MAZE: EncounterDef = {
  id: 'w3_e08',
  name: 'XXVIII · El Laberinto Vivo',
  tier: 'NORMAL',
  board: { rows: 7, columns: 11 },
  focus: 'La palanca gira la mitad derecha del templo, con todo lo que lleva encima. Busca la orientación que une tu lado con la salida.',
  description: 'Laberinto giratorio: la mitad derecha del tablero rota 90° con sus pasillos, muros y enemigos.',
  legend: LEGEND_B,
  layout: [
    '...xxx.xxxx', //
    '...xxx....x',
    '...x.x..bxx',
    '...x.x..xxE',
    '...x.xxxxxx',
    '.......xxxx',
    '...xxx.xxxx',
  ],
  hero: { heroId: 'mage', pos: { x: 0, y: 3 } },
  structures: [],
  enemies: [
    { id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 4, y: 2 } },
    { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 8, y: 1 } },
  ],
  waves: [],
  mechanisms: {
    objects: [
      { id: 'maze', kind: 'REGION', pos: { x: 3, y: 0 }, region: { cells: SECTION, pivot: { x: 6.5, y: 3.5 } }, label: 'Laberinto Vivo' },
      { id: 'lever', kind: 'SWITCH', pos: { x: 1, y: 1 }, momentary: true, interactionMode: 'REPEATABLE_CONTROL', prompt: 'GIRAR', label: 'Palanca del laberinto (↻)' },
      { id: 'console', kind: 'SWITCH', pos: { x: 6, y: 3 }, momentary: true, interactionMode: 'REPEATABLE_CONTROL', prompt: 'GIRAR', label: 'Consola del eje (↺)' },
    ],
    rules: [
      { id: 'lever-turns-cw', trigger: { type: 'ON_INTERACT', sources: ['lever'] }, actions: [{ type: 'ROTATE', targets: ['maze'], turns: 1 }] },
      { id: 'console-turns-ccw', trigger: { type: 'ON_INTERACT', sources: ['console'] }, actions: [{ type: 'ROTATE', targets: ['maze'], turns: -1 }] },
    ],
  },
  objectives: [{ type: 'REACH_TILE', tiles: [{ x: 10, y: 3 }], roundLimit: 14 }],
  // Authored neutral card offer (data/temple-rewards.ts).
  rewards: { pool: 'NORMAL', choices: 1, cards: ['counterweight_rope'] },
  next: null,
  defaultSeed: 308,
};

/**
 * XXIX «El Corazón del Templo» (elite, pre-boss): rotation + sliding wall + pressure control.
 * A 5×5 section between your side and the Heart's chamber holds an L-shaped walkway (a west arm and
 * a north arm meeting at the centre) and a rune console at the tip of the north arm. The chamber's
 * sliding wall opens only while weight sits on the plate on your side (statue rail, or a summon).
 * At 0° the west arm faces you; the east door is reachable only at 180° (at 90° the console itself
 * blocks it): walk in, turn the section twice from the console (riding it), cross the open wall and
 * shut the Heart down while the Warden and the chamber's reinforcements push back.
 * Controls: the lever on your side and the console both turn clockwise, as REPEATABLE_CONTROLs —
 * still free under the NARROW rule, because the plate and the wall stand where turning the section
 * can never move anything (mechanism-rules.safeRepeatableControl).
 * SAFETY: the section is a permutation of itself (validated); the lever re-aligns the west arm from
 * your side at any time; the wall never closes on anyone (deferred) and the statue's rail ends on the
 * plate (exhaustive check: tests/act3-completion.test.ts).
 */
const HEART_SECTION = square(3, 1, 5);
const CORAZON: EncounterDef = {
  id: 'w3_e09',
  name: 'XXIX · El Corazón del Templo',
  tier: 'ELITE',
  board: { rows: 7, columns: 11 },
  focus: 'Pon peso en la placa para abrir el muro, gira la sección hasta que su brazo toque el muro y desactiva el Corazón bajo presión.',
  description: 'Élite previo al jefe: sección giratoria, muro deslizante y placa de presión protegen el Corazón del Templo.',
  legend: LEGEND,
  layout: [
    '...xxxxx###', //
    '...xx.xx#..',
    '...xx.xx#..',
    '......xx...',
    '...xxxxx#..',
    '...xxxxx#..',
    '...xxxxx###',
  ],
  hero: { heroId: 'mage', pos: { x: 0, y: 3 } },
  structures: [],
  enemies: [
    { id: 'warden', enemyId: 'heart_warden', pos: { x: 9, y: 2 } },
    { id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 2, y: 0 } },
  ],
  // The reinforcement comes from YOUR side (pressure while you turn the section); one more in the
  // chamber would only queue behind the Sentinel in the single-file corridor (playtest).
  waves: [{ round: 4, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 0, y: 6 } }] }],
  mechanisms: {
    objects: [
      { id: 'heart-section', kind: 'REGION', pos: { x: 3, y: 1 }, region: { cells: HEART_SECTION, pivot: { x: 5.5, y: 3.5 } }, label: 'Sección del Corazón' },
      { id: 'console', kind: 'SWITCH', pos: { x: 5, y: 1 }, momentary: true, interactionMode: 'REPEATABLE_CONTROL', prompt: 'GIRAR', label: 'Consola de la sección (↻)' },
      { id: 'lever', kind: 'SWITCH', pos: { x: 1, y: 1 }, momentary: true, interactionMode: 'REPEATABLE_CONTROL', prompt: 'GIRAR', label: 'Palanca de la sección (↻)' },
      { id: 'plate', kind: 'PRESSURE_PLATE', pos: { x: 1, y: 6 }, label: 'Placa del muro' },
      { id: 'statue', kind: 'STATUE', pos: { x: 1, y: 5 }, allowedTiles: [{ x: 1, y: 5 }, { x: 1, y: 6 }], label: 'Estatua de contrapeso' },
      { id: 'wall', kind: 'GATE', pos: { x: 8, y: 3 }, label: 'Muro del Corazón' },
      { id: 'heart', kind: 'SWITCH', pos: { x: 10, y: 3 }, toggle: false, prompt: 'DESACTIVAR', label: 'Corazón del Templo' },
    ],
    rules: [
      { id: 'console-turns', trigger: { type: 'ON_INTERACT', sources: ['console'] }, actions: [{ type: 'ROTATE', targets: ['heart-section'], turns: 1 }] },
      { id: 'lever-turns', trigger: { type: 'ON_INTERACT', sources: ['lever'] }, actions: [{ type: 'ROTATE', targets: ['heart-section'], turns: 1 }] },
      { id: 'weight-opens', trigger: { type: 'ON_OCCUPIED', sources: ['plate'] }, actions: [{ type: 'OPEN', targets: ['wall'] }] },
      { id: 'weight-lost', trigger: { type: 'ON_VACATED', sources: ['plate'] }, actions: [{ type: 'CLOSE', targets: ['wall'] }] },
    ],
  },
  objectives: [
    {
      type: 'MECHANISM',
      goal: 'STAGES',
      ids: [],
      label: 'Corazón desactivado',
      roundLimit: 20,
      stages: [
        { label: 'Abre el muro del Corazón', objective: { type: 'MECHANISM', goal: 'OPEN', ids: ['wall'] } },
        { label: 'Desactiva el Corazón', objective: { type: 'MECHANISM', goal: 'ACTIVATE_N', ids: ['heart'] } },
      ],
    },
  ],
  rewards: { pool: 'ELITE', choices: 3 },
  next: null,
  defaultSeed: 309,
};

/**
 * XXX «El Arquitecto del Umbral» (boss). The Architect stands on a dais behind two sliding walls
 * and rebuilds the temple around you, always TELEGRAPHED a round ahead (MechanismView.scheduled):
 *   - end of every 2nd round: it turns the central sanctum a quarter clockwise (riders ride);
 *   - end of every 3rd round: it swaps its walls (the open one closes, the closed one opens; a wall
 *     never closes on anyone).
 * Its plating (FORTIFIED, −2) drops for 3 rounds when you pull the live Key on the sanctum; that Key
 * then goes dark and, when the window closes, the OTHER Key wakes (CYCLE). The keys ride the
 * sanctum, so the Architect's turns keep moving your target. Your counter-lever turns the sanctum
 * back (an ordinary interaction: one per turn, the same budget as a Key — undo, or expose).
 * SAFETY: the sanctum is solid floor but for two pillars, so every Key is reachable in every
 * orientation; walls only ever re-route (the outer ring always reaches the dais); every change stops
 * when the Architect falls (`whileAlive`).
 */
const SANCTUM = square(3, 1, 5);
const ARQUITECTO: EncounterDef = {
  id: 'w3_e10',
  name: 'XXX · El Arquitecto del Umbral',
  tier: 'BOSS',
  board: { rows: 7, columns: 11 },
  focus: 'El Arquitecto gira el santuario y mueve sus muros: mira el aviso de cada ronda. Tira de la Llave activa para romper su blindaje.',
  description: 'Jefe del Acto III: controla el tablero, siempre con aviso previo.',
  legend: LEGEND,
  layout: [
    '...xxxxx...', //
    '...........',
    '....#......',
    '........#..',
    '......#....',
    '...........',
    '...xxxxx...',
  ],
  hero: { heroId: 'mage', pos: { x: 0, y: 3 } },
  structures: [],
  enemies: [
    { id: 'architect', enemyId: 'temple_architect', pos: { x: 9, y: 3 } },
    { id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 9, y: 0 } },
  ],
  waves: [{ round: 4, enemies: [{ id: 'wolf-1', enemyId: 'shadow_wolf', pos: { x: 10, y: 6 } }] }],
  mechanisms: {
    objects: [
      { id: 'sanctum', kind: 'REGION', pos: { x: 3, y: 1 }, region: { cells: SANCTUM, pivot: { x: 5.5, y: 3.5 } }, label: 'Santuario' },
      { id: 'key-a', kind: 'SWITCH', pos: { x: 5, y: 1 }, momentary: true, label: 'Llave del Umbral (norte)' },
      { id: 'key-b', kind: 'SWITCH', pos: { x: 5, y: 5 }, momentary: true, startsLocked: true, label: 'Llave del Umbral (sur)' },
      { id: 'counter', kind: 'SWITCH', pos: { x: 1, y: 3 }, momentary: true, prompt: 'GIRAR', label: 'Palanca de contragiro (↺)' },
      { id: 'wall-n', kind: 'GATE', pos: { x: 8, y: 2 }, initial: 'OPEN', label: 'Muro norte del estrado' },
      { id: 'wall-s', kind: 'GATE', pos: { x: 8, y: 4 }, label: 'Muro sur del estrado' },
    ],
    rules: [
      { id: 'plating', trigger: { type: 'ON_ROUND_START' }, actions: [{ type: 'FORTIFY', unitIds: ['architect'] }], once: true },
      ...(['a', 'b'] as const).map((k) => ({
        id: `key-${k}-exposes`,
        trigger: { type: 'ON_INTERACT' as const, sources: [`key-${k}`] },
        actions: [
          { type: 'EXPOSE' as const, unitIds: ['architect'], rounds: 3 },
          { type: 'DISABLE' as const, targets: [`key-${k}`] },
        ],
      })),
      { id: 'keys-relocate', trigger: { type: 'ON_EXPOSE_END', unitIds: ['architect'] }, actions: [{ type: 'CYCLE', targets: ['key-a', 'key-b'] }] },
      { id: 'counter-turns', trigger: { type: 'ON_INTERACT', sources: ['counter'] }, actions: [{ type: 'ROTATE', targets: ['sanctum'], turns: -1 }] },
      {
        id: 'architect-turns',
        label: 'El Arquitecto girará el santuario ↻',
        trigger: { type: 'ON_ROUND_END', every: 2 },
        whileAlive: ['architect'],
        actions: [{ type: 'ROTATE', targets: ['sanctum'], turns: 1 }],
      },
      {
        id: 'architect-walls',
        label: 'El Arquitecto cambiará sus muros',
        trigger: { type: 'ON_ROUND_END', every: 3 },
        whileAlive: ['architect'],
        actions: [{ type: 'TOGGLE', targets: ['wall-n', 'wall-s'] }],
      },
    ],
  },
  objectives: [{ type: 'DEFEAT_TARGET', targetUnitId: 'architect' }],
  rewards: { pool: 'BOSS', choices: 3 },
  next: null,
  defaultSeed: 310,
};

/** XXVII–XXX in play order (chained after XXVI by data/temple-encounters.ts). */
export const TEMPLE_PHASE3_ENCOUNTERS: readonly EncounterDef[] = [PESO_Y_CONTRAPESO, LIVING_MAZE, CORAZON, ARQUITECTO];
