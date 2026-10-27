import type { CardDefinition, EffectCondition, EffectDef, TargetingDef } from '../domain/cards/card';
import type { GameContent, HeroDef } from '../domain/content';
import { HAND_RULES } from './rules';
import { ARCHER_HUNT_CARDS, VEIL_ENEMIES } from './archer-hunt';
import { RANKED_ARCHER_CARDS } from './ranked-cards';
import { RANKED_PREMIUM_ARCHER_CARDS } from './ranked-premium-cards';
import { TEMPLE_ARCHER_CARDS } from './temple-rewards';
import { FREE_CATALOG_ARCHER_CARDS } from './free-catalog';

/**
 * Archer (Arquero) — gameplay phase 1, QA-only. Fantasy: precision hunter.
 *
 *   mark the Presa → reposition → gain Concentración → find Distancia Óptima → empowered shot
 *
 * Never registered in DEFAULT_CONTENT: `withArcher(content)` adds the champion and its cards, so
 * public content, campaigns, rewards, the store and the Worker stay unchanged until a release
 * switch exists. Every card belongs to the QA set `archer_core` (never dropped or sold).
 *
 * Shots are PHYSICAL and RANGED (cover reduces them by 1, like every ranged attack) and need line
 * of sight; there is no RNG and no random critical anywhere. visualKeys are provisional: the shot
 * cards share `archer_arrow`, bound to the existing bow + physical arrow presentation.
 */
export const ARCHER_ID = 'archer';
export const ARCHER_EXPANSION = 'archer_core';

/** Distancia Óptima of the champion (Manhattan, inclusive). Single source for rules and UI. */
export const ARCHER_OPTIMAL_RANGE = { min: 3, max: 4 } as const;

const PREY: EffectCondition = { type: 'TARGET_IS_PREY' };
const OPTIMAL: EffectCondition = { type: 'TARGET_IN_OPTIMAL_RANGE' };
const SHOT = (range: number): TargetingDef => ({ type: 'UNIT', range, unitFilter: 'ENEMY', requiresLineOfSight: true });
const arrow = (amount: number, extra: Partial<Extract<EffectDef, { type: 'DAMAGE' }>> = {}): EffectDef => ({
  type: 'DAMAGE',
  amount,
  damageType: 'PHYSICAL',
  to: 'ENEMIES',
  attackKind: 'RANGED',
  ...extra,
});
const card = (def: Omit<CardDefinition, 'heroId' | 'expansion'>): CardDefinition => ({
  ...def,
  heroId: ARCHER_ID,
  expansion: ARCHER_EXPANSION,
});

export const ARCHER_CARDS: CardDefinition[] = [
  // ── Basic attack: the reliable shot every Archer deck carries (Magic Missile's counterpart).
  card({
    id: 'archer_shot',
    name: 'Disparo',
    cost: 1,
    category: 'ATTACK',
    tags: ['arrow', 'basic', 'reliable'],
    rarity: 'COMMON',
    rulesText: 'Inflige 2 de daño físico a distancia a un enemigo a distancia 4. Requiere línea de visión.',
    targeting: SHOT(4),
    effects: [arrow(2)],
    presentation: { visualKey: 'archer_arrow', element: 'NEUTRAL', castAnimation: 'attack' },
  }),
  card({
    id: 'hunters_eye',
    name: 'Ojo del Cazador',
    cost: 0,
    category: 'UTILITY',
    tags: ['prey', 'mark'],
    rarity: 'COMMON',
    rulesText:
      'Marca a un enemigo a distancia 6 con línea de visión como tu Presa. Solo tienes una Presa: la nueva reemplaza a la anterior. No causa daño.',
    targeting: SHOT(6),
    // PREY never counts down (STATUSES.PREY.permanent); the duration only has to be positive.
    effects: [{ type: 'APPLY_STATUS', status: 'PREY', duration: 1, to: 'ENEMIES' }],
    presentation: { visualKey: 'hunters_eye', element: 'NEUTRAL', castAnimation: 'ability' },
  }),
  card({
    id: 'true_shot',
    name: 'Disparo Certero',
    cost: 1,
    category: 'ATTACK',
    tags: ['arrow', 'prey', 'focus-builder'],
    rarity: 'COMMON',
    rulesText:
      'Inflige 2 de daño físico a distancia (4). Contra tu Presa: 3. Si golpeas a tu Presa desde Distancia Óptima (3–4), ganas 1 Concentración.',
    targeting: SHOT(4),
    effects: [arrow(2, { bonus: { when: PREY, amount: 1 }, focusGain: { amount: 1, when: [PREY, OPTIMAL] } })],
    presentation: { visualKey: 'archer_arrow', element: 'NEUTRAL', castAnimation: 'attack' },
  }),
  card({
    id: 'stalker_step',
    name: 'Paso del Acechador',
    cost: 1,
    category: 'MOVEMENT',
    tags: ['movement', 'focus-builder'],
    rarity: 'COMMON',
    rulesText:
      'Caminas hasta 2 casillas sin gastar movimiento. Si terminas sin enemigos adyacentes y con línea de visión hacia tu Presa, ganas 1 Concentración.',
    targeting: { type: 'STEP', range: 2 },
    effects: [
      { type: 'STEP_CASTER' },
      { type: 'GAIN_FOCUS', amount: 1, when: [{ type: 'CASTER_NOT_ADJACENT_TO_ENEMY' }, { type: 'PREY_IN_LINE_OF_SIGHT' }] },
    ],
    presentation: { visualKey: 'stalker_step', element: 'NEUTRAL', castAnimation: 'ability' },
  }),
  card({
    id: 'piercing_arrow',
    name: 'Flecha Perforante',
    cost: 2,
    category: 'ATTACK',
    tags: ['arrow', 'line', 'projectile', 'focus-spender'],
    rarity: 'COMMON',
    rulesText:
      'Flecha en línea recta (4): 3 de daño físico al primer objetivo. Con 2 Concentración puedes apuntar al enemigo que hay detrás: la consume y la flecha atraviesa e inflige 3 a ambos.',
    targeting: { type: 'LINE', range: 4, pierce: false, focusPierce: 2 },
    effects: [arrow(3)],
    presentation: { visualKey: 'archer_arrow', element: 'NEUTRAL', castAnimation: 'attack' },
  }),
  card({
    id: 'heart_shot',
    name: 'Tiro al Corazón',
    cost: 3,
    category: 'ATTACK',
    tags: ['arrow', 'finisher', 'focus-spender', 'signature'],
    // Signature finisher: 2 copies per deck (UNCOMMON). It is gated by 3 Concentración anyway.
    rarity: 'UNCOMMON',
    focusCost: 3,
    rulesText:
      'Requiere y consume 3 Concentración. Inflige 4 de daño físico a distancia (4). Contra tu Presa desde Distancia Óptima (3–4): 6. Sin críticos aleatorios.',
    targeting: SHOT(4),
    effects: [arrow(4, { bonus: { when: [PREY, OPTIMAL], amount: 2 } })],
    presentation: { visualKey: 'archer_arrow', element: 'NEUTRAL', castAnimation: 'attack' },
  }),
  card({
    id: 'tactical_retreat',
    name: 'Retirada Táctica',
    cost: 1,
    category: 'MOVEMENT',
    tags: ['movement', 'retreat', 'focus-builder'],
    rarity: 'COMMON',
    rulesText:
      'Caminas hasta 2 casillas alejándote del enemigo más cercano, sin gastar movimiento y sin provocar daño. Si terminas en Distancia Óptima (3–4) de tu Presa, ganas 1 Concentración.',
    targeting: { type: 'STEP', range: 2, away: true },
    effects: [{ type: 'STEP_CASTER' }, { type: 'GAIN_FOCUS', amount: 1, when: [{ type: 'PREY_IN_OPTIMAL_RANGE' }] }],
    presentation: { visualKey: 'tactical_retreat', element: 'NEUTRAL', castAnimation: 'ability' },
  }),
  card({
    id: 'bramble_trap',
    name: 'Trampa de Zarzas',
    cost: 1,
    category: 'TERRAIN',
    tags: ['trap', 'root', 'control'],
    rarity: 'COMMON',
    rulesText:
      'Coloca una trampa visible en una casilla libre a distancia 3 (dura 3 rondas). El primer enemigo que entre se detiene, recibe 1 de daño y queda Enraizado.',
    targeting: { type: 'TILE', range: 3, minRange: 1, tileFilter: 'EMPTY' },
    effects: [{ type: 'PLACE_TRAP', trapId: 'bramble', damage: 1, rounds: 3 }],
    presentation: { visualKey: 'bramble_trap', element: 'NEUTRAL', castAnimation: 'ability' },
  }),
  card({
    id: 'executioner_arrow',
    name: 'Flecha del Verdugo',
    cost: 2,
    category: 'ATTACK',
    tags: ['arrow', 'prey', 'finisher'],
    rarity: 'COMMON',
    rulesText:
      'Inflige 2 de daño físico a distancia (4). Si el objetivo es tu Presa y está al 40% de su vida o menos: 4. No es una ejecución instantánea.',
    targeting: SHOT(4),
    effects: [arrow(2, { bonus: { when: [PREY, { type: 'TARGET_HP_AT_MOST_PCT', pct: 40 }], amount: 2 } })],
    presentation: { visualKey: 'archer_arrow', element: 'NEUTRAL', castAnimation: 'attack' },
  }),
];

/**
 * High ranged damage, high mobility (4 MP, two free steps), medium control (one root trap), low
 * defence: no shield, heal or armour of its own, and the lowest champion HP pool (18, like the
 * Summoner — who has bodies to hide behind). 4 energy like Warrior/Summoner: one finisher (3) plus
 * a 0-cost mark or 1 more card per turn.
 */
export const ARCHER_HERO: HeroDef = {
  id: ARCHER_ID,
  name: 'Arquero',
  maxHp: 18,
  maxEnergy: 4,
  movePoints: 4,
  startingHandSize: HAND_RULES.handSize,
  drawPerTurn: 1,
  handSize: HAND_RULES.handSize,
  maxHandSize: HAND_RULES.turnHandCap,
  focus: { max: 3, optimalRange: ARCHER_OPTIMAL_RANGE },
  // 30 cards (exactly, DECK_RULES): every Archer common at 3, the finisher at its 2-copy cap, and
  // the 4 allowed neutrals as melee-escape / sustain filler (Empujón 2, Primeros auxilios 2).
  deck: [
    { cardId: 'archer_shot', count: 3 },
    { cardId: 'hunters_eye', count: 3 },
    { cardId: 'true_shot', count: 3 },
    { cardId: 'stalker_step', count: 3 },
    { cardId: 'piercing_arrow', count: 3 },
    { cardId: 'tactical_retreat', count: 3 },
    { cardId: 'bramble_trap', count: 3 },
    { cardId: 'executioner_arrow', count: 3 },
    { cardId: 'heart_shot', count: 2 },
    { cardId: 'shove', count: 2 },
    { cardId: 'first_aid', count: 2 },
  ],
  visualKey: 'hero_archer',
};

/**
 * Content with the Archer, its campaign reward cards and the Veil enemies of «Sendero del
 * Cazador» (data/archer-hunt.ts). Never mutates `base`; idempotent.
 */
export function withArcher(base: GameContent): GameContent {
  if (base.heroes[ARCHER_ID]) return base;
  return {
    ...base,
    heroes: { ...base.heroes, [ARCHER_ID]: ARCHER_HERO },
    cards: { ...base.cards, ...Object.fromEntries([...ARCHER_CARDS, ...ARCHER_HUNT_CARDS, ...RANKED_ARCHER_CARDS, ...RANKED_PREMIUM_ARCHER_CARDS, ...TEMPLE_ARCHER_CARDS, ...FREE_CATALOG_ARCHER_CARDS].map((c) => [c.id, c])) },
    enemies: { ...base.enemies, ...VEIL_ENEMIES },
  };
}
