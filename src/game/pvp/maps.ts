import type { ScenarioDef } from '../domain/scenario';
import type { Pos } from '../domain/core/position';
import { DOMINION_SCENARIO, DOMINION_NODES, type PvpMode } from './dominion';

export interface PvpMapDefinition {
  id: string;
  name: string;
  description: string;
  allowedModes: readonly PvpMode[];
  layout: readonly string[];
  playerSpawns: readonly [Pos, Pos];
  objectiveNodes: readonly Pos[];
}
const nodes: readonly Pos[] = [
  { x: 1, y: 2 },
  { x: 6, y: 3 },
  { x: 1, y: 4 },
];
export const PVP_MAPS: readonly PvpMapDefinition[] = [
  {
    id: 'classic',
    name: 'Patio arcano',
    description: 'Arena clásica sin modificadores.',
    allowedModes: ['DUEL', 'DOMINION'],
    layout: Array.from({ length: 7 }, () => '..........'),
    playerSpawns: [
      { x: 4, y: 0 },
      { x: 4, y: 6 },
    ],
    objectiveNodes: DOMINION_NODES,
  },
  {
    id: 'broken_bridge',
    name: 'Puente quebrado',
    description: 'Tres pasos sobre el abismo; cobertura en los accesos.',
    allowedModes: ['DUEL', 'DOMINION'],
    layout: [
      '.........',
      '.C.....C.',
      '.........',
      '..##...#.',
      '.........',
      '.C.....C.',
      '.........',
    ],
    playerSpawns: [
      { x: 4, y: 0 },
      { x: 4, y: 6 },
    ],
    objectiveNodes: nodes,
  },
  {
    id: 'shattered_sanctum',
    name: 'Santuario fracturado',
    description: 'Plataformas rotas, cobertura, peligro y runas arcanas.',
    allowedModes: ['DUEL', 'DOMINION'],
    layout: [
      '##.....##',
      '#..A.C..#',
      '..C.H....',
      '.#..#..#.',
      '..C.H....',
      '#..A.C..#',
      '##.....##',
    ],
    playerSpawns: [
      { x: 4, y: 0 },
      { x: 4, y: 6 },
    ],
    objectiveNodes: nodes,
  },
];
export function pvpMap(id: unknown = 'classic', mode: PvpMode = 'DUEL'): PvpMapDefinition {
  const map = PVP_MAPS.find((m) => m.id === id);
  if (!map || !map.allowedModes.includes(mode)) throw Error('INVALID_MAP');
  if (
    mode === 'DOMINION' &&
    (map.objectiveNodes.length !== 3 ||
      map.objectiveNodes.some((p) => map.layout[p.y]?.[p.x] !== '.'))
  )
    throw Error('INVALID_MAP');
  return map;
}
export function mapScenario(map: PvpMapDefinition, mode: PvpMode): ScenarioDef {
  const classicDuel = map.id === 'classic' && mode === 'DUEL';
  return {
    ...DOMINION_SCENARIO,
    id: mode === 'DOMINION' ? 'private_dominion' : 'private_duel',
    name: map.name,
    layout: classicDuel ? Array.from({ length: 6 }, () => '.........') : [...map.layout],
    legend: {
      '.': {},
      '#': { terrain: 'VOID' },
      C: { terrain: 'COVER' },
      H: { terrain: 'HAZARD' },
      A: { terrain: 'ARCANE' },
    },
    hero: { heroId: 'mage', pos: classicDuel ? { x: 0, y: 1 } : map.playerSpawns[0] },
  };
}
export function mapSpawns(map: PvpMapDefinition, mode: PvpMode): readonly [Pos, Pos] {
  return map.id === 'classic' && mode === 'DUEL'
    ? [
        { x: 0, y: 1 },
        { x: 8, y: 4 },
      ]
    : map.playerSpawns;
}
