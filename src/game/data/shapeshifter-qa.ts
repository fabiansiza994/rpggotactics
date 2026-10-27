import type { GameContent, HeroDef } from '../domain/content';
import type { CardDefinition, EffectDef, TargetingDef } from '../domain/cards/card';
import type { DeckEntry } from '../collection/deck-rules';
import type { ScenarioDef } from '../domain/scenario';
import { PROTOTYPE_TRANSFORMATIONS } from './transformation-prototypes';

export const SHAPESHIFTER_QA_ID = 'shapeshifter';
const make = (
  id: string,
  name: string,
  cost: number,
  category: CardDefinition['category'],
  rulesText: string,
  targeting: TargetingDef,
  effects: EffectDef[],
  requiredForms?: CardDefinition['requiredForms'],
): CardDefinition => ({
  id,
  name,
  cost,
  category,
  rulesText: `QA provisional: ${rulesText}`,
  heroId: SHAPESHIFTER_QA_ID,
  tags: ['qa-prototype'],
  rarity: 'COMMON',
  maxCopies: 6,
  expansion: 'shapeshifter_private_qa',
  targeting,
  effects,
  requiredForms,
  presentation: { visualKey: 'barrier', element: 'NEUTRAL' },
});
const self: TargetingDef = { type: 'SELF' };
const melee: TargetingDef = { type: 'UNIT', range: 1, unitFilter: 'ENEMY' };
export const SHAPESHIFTER_QA_CARDS: readonly CardDefinition[] = [
  make('qa_bear_form', 'Forma de Oso', 1, 'UTILITY', 'Adopta Oso (+2 armadura). No cura.', self, [
    { type: 'TRANSFORM', formId: 'bear' },
  ]),
  make(
    'qa_minotaur_form',
    'Forma de Minotauro',
    1,
    'UTILITY',
    'Adopta Minotauro (+1 armadura). No cura.',
    self,
    [{ type: 'TRANSFORM', formId: 'minotaur' }],
  ),
  make(
    'qa_primal_instinct',
    'Instinto Primordial',
    0,
    'UTILITY',
    'Roba 1 carta; respeta el límite de mano.',
    self,
    [{ type: 'DRAW', count: 1 }],
  ),
  make(
    'qa_wild_strike',
    'Golpe Salvaje',
    1,
    'ATTACK',
    'Inflige 2 de daño físico adyacente.',
    melee,
    [{ type: 'DAMAGE', amount: 2, damageType: 'PHYSICAL', to: 'ENEMIES' }],
  ),
  make(
    'qa_hunter_step',
    'Paso del Cazador',
    1,
    'MOVEMENT',
    'Camina hasta 2 casillas con STEP existente.',
    { type: 'STEP', range: 2 },
    [{ type: 'STEP_CASTER' }],
  ),
  make('qa_bark_skin', 'Piel de Corteza', 1, 'DEFENSE', 'Gana 3 de escudo.', self, [
    { type: 'SHIELD', amount: 3, to: 'CASTER' },
  ]),
  make(
    'qa_bear_claw',
    'Zarpazo Demoledor',
    2,
    'ATTACK',
    'Oso: daño 4 y empuje 1. Colisión existente: 1 daño.',
    melee,
    [
      { type: 'DAMAGE', amount: 4, damageType: 'PHYSICAL', to: 'ENEMIES' },
      { type: 'PUSH', distance: 1, collisionDamage: 1, to: 'ENEMIES' },
    ],
    ['bear'],
  ),
  make(
    'qa_protective_roar',
    'Rugido Protector',
    1,
    'DEFENSE',
    'Oso: gana 4 de escudo propio. Sin provocación ni aura.',
    self,
    [{ type: 'SHIELD', amount: 4, to: 'CASTER' }],
    ['bear'],
  ),
  make(
    'qa_brutal_charge',
    'Embestida Brutal',
    2,
    'ATTACK',
    'Minotauro: carga recta 2–3, daño 3 y empuje 1 (colisión 1).',
    { type: 'CHARGE', minRange: 2, range: 3 },
    [
      { type: 'CHARGE_CASTER' },
      { type: 'DAMAGE', amount: 3, damageType: 'PHYSICAL', to: 'ENEMIES' },
      { type: 'PUSH', distance: 1, collisionDamage: 1, to: 'ENEMIES' },
    ],
    ['minotaur'],
  ),
  make(
    'qa_axe_sweep',
    'Barrido de Hacha',
    2,
    'ATTACK',
    'Minotauro: daño 3 a enemigos ortogonalmente adyacentes.',
    { type: 'SELF', area: { shape: 'CROSS', radius: 1, includeCenter: false } },
    [{ type: 'DAMAGE', amount: 3, damageType: 'PHYSICAL', to: 'ENEMIES' }],
    ['minotaur'],
  ),
];
const deck = (counts: readonly number[]): DeckEntry[] =>
  SHAPESHIFTER_QA_CARDS.map((card, i) => ({ cardId: card.id, count: counts[i] ?? 0 })).filter(
    (e) => e.count > 0,
  );
export const SHAPESHIFTER_QA_DECKS = {
  balanced: deck([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]),
  bear: deck([4, 2, 3, 3, 3, 4, 4, 4, 1, 2]),
  minotaur: deck([2, 4, 3, 3, 3, 2, 2, 2, 5, 4]),
};
/** Private fixture builder, never imported by public content or server configuration. */
export function withShapeshifterQa(base: GameContent): GameContent {
  const hero: HeroDef = {
    id: SHAPESHIFTER_QA_ID,
    name: 'Cambiaformas QA',
    maxHp: 24,
    maxEnergy: 4,
    movePoints: 3,
    startingHandSize: 5,
    drawPerTurn: 1,
    handSize: 5,
    maxHandSize: 6,
    transformationForms: ['bear', 'minotaur'],
    visualKey: 'mage',
    deck: SHAPESHIFTER_QA_DECKS.balanced,
    starterCollection: SHAPESHIFTER_QA_CARDS.map((c) => ({ cardId: c.id, count: 6 })),
  };
  return {
    ...base,
    defaultHeroId: hero.id,
    heroes: { ...base.heroes, [hero.id]: hero },
    cards: { ...base.cards, ...Object.fromEntries(SHAPESHIFTER_QA_CARDS.map((c) => [c.id, c])) },
    transformations: { ...base.transformations, ...PROTOTYPE_TRANSFORMATIONS },
  };
}
export const SHAPESHIFTER_QA_SCENARIO: ScenarioDef = {
  id: 'shapeshifter_private_lab',
  name: 'Laboratorio Cambiaformas',
  description: 'Solo QA: sin recompensas ni campaña.',
  layout: ['.......', '...#...', '.......', '.......', '.......'],
  legend: { '.': {}, '#': { obstacleId: 'pillar' } },
  hero: { heroId: SHAPESHIFTER_QA_ID, pos: { x: 1, y: 2 } },
  structures: [],
  enemies: [
    { id: 'qa-orc', enemyId: 'orc_warrior', pos: { x: 5, y: 2 } },
    { id: 'qa-wolf', enemyId: 'shadow_wolf', pos: { x: 5, y: 4 } },
  ],
  waves: [],
  objectives: [{ type: 'ELIMINATE_ALL' }],
  defaultSeed: 42,
};
