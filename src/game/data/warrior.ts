import type { CardDefinition, EffectDef } from '../domain/cards/card';

/**
 * Warrior (Guerrero) card pool. Melee reach is UNIT range 1 (orthogonal adjacency); melee is
 * not RANGED, so COVER never reduces it. Guard = the existing Shield primitive (absorbs, ends at
 * the start of your next turn). Momentum payoffs use `empowered`: spent automatically when the
 * card is played with enough Impulso, replacing the base effects.
 *
 * visualKeys are provisional (no painting yet: the card frame draws tone-only fallback art).
 * Final art: qa/warrior/ART_MANIFEST.md.
 */
const MELEE = { type: 'UNIT', range: 1, unitFilter: 'ENEMY' } as const;
const hit = (amount: number): EffectDef => ({ type: 'DAMAGE', amount, damageType: 'PHYSICAL', to: 'ENEMIES' });
/** `amount` damage, or `finisher` damage to a target at or below that much HP (see EffectDef). */
const finish = (amount: number, finisher: number): EffectDef => ({
  type: 'DAMAGE',
  amount,
  damageType: 'PHYSICAL',
  to: 'ENEMIES',
  finisher: { hpAtMost: finisher, amount: finisher },
});
/** Lose every remaining movement point this turn (setMovePoints clamps at 0). */
const PLANT: EffectDef = { type: 'GAIN_MOVE_POINTS', amount: -99 };

export const WARRIOR_CARDS: CardDefinition[] = [
  // ── Starter (8 cards, 20 copies) ───────────────────────────────────────────────────────
  {
    id: 'heavy_strike',
    name: 'Golpe pesado',
    heroId: 'warrior',
    cost: 1,
    category: 'ATTACK',
    tags: ['melee', 'momentum'],
    rarity: 'COMMON',
    rulesText:
      'Inflige 3 de daño físico a un enemigo adyacente. Impulso 2: lo consume e inflige 5 en su lugar.',
    targeting: MELEE,
    effects: [hit(3)],
    empowered: { momentum: 2, effects: [hit(5)] },
    presentation: { visualKey: 'heavy_strike', element: 'FORCE', castAnimation: 'attack' },
  },
  {
    id: 'shield_bash',
    name: 'Golpe de escudo',
    heroId: 'warrior',
    cost: 1,
    category: 'CONTROL',
    tags: ['melee', 'push', 'momentum-builder'],
    rarity: 'COMMON',
    rulesText:
      'Inflige 1 de daño físico a un enemigo adyacente y lo empuja 1 casilla (2 de daño si choca). Ganas 1 Impulso.',
    targeting: MELEE,
    effects: [
      hit(1),
      { type: 'PUSH', distance: 1, collisionDamage: 2, to: 'ENEMIES' },
      { type: 'GAIN_MOMENTUM', amount: 1 },
    ],
    presentation: { visualKey: 'shield_bash', element: 'FORCE', castAnimation: 'attack' },
  },
  {
    id: 'warrior_charge',
    name: 'Carga',
    heroId: 'warrior',
    cost: 2,
    category: 'MOVEMENT',
    tags: ['charge', 'melee', 'momentum'],
    rarity: 'COMMON',
    rulesText:
      'Carga en línea recta hacia un enemigo a 2–4 casillas con el camino libre, quedas adyacente e infliges 2 de daño físico. Impulso 2: 3 de daño y lo empuja 1 casilla.',
    targeting: { type: 'CHARGE', range: 4, minRange: 2 },
    effects: [{ type: 'CHARGE_CASTER' }, hit(2)],
    empowered: {
      momentum: 2,
      effects: [{ type: 'CHARGE_CASTER' }, hit(3), { type: 'PUSH', distance: 1, collisionDamage: 1, to: 'ENEMIES' }],
    },
    presentation: { visualKey: 'warrior_charge', element: 'FORCE', castAnimation: 'charge' },
  },
  {
    id: 'guard',
    name: 'Guardia',
    heroId: 'warrior',
    cost: 1,
    category: 'DEFENSE',
    tags: ['guard', 'shield', 'self'],
    rarity: 'COMMON',
    rulesText:
      'Ganas 4 de Guardia (escudo) hasta tu próximo turno. Pierdes el movimiento que te quede este turno.',
    targeting: { type: 'SELF' },
    effects: [{ type: 'SHIELD', amount: 4, to: 'CASTER' }, PLANT],
    presentation: { visualKey: 'guard', element: 'SHIELD', castAnimation: 'guard' },
  },
  {
    id: 'riposte',
    name: 'Contraataque',
    heroId: 'warrior',
    cost: 1,
    category: 'DEFENSE',
    tags: ['guard', 'counter'],
    rarity: 'COMMON',
    rulesText:
      'Ganas 2 de Guardia. Hasta tu próximo turno, el primer enemigo ADYACENTE que te ataque recibe 3 de daño físico.',
    targeting: { type: 'SELF' },
    effects: [
      { type: 'SHIELD', amount: 2, to: 'CASTER' },
      { type: 'APPLY_STATUS', status: 'RIPOSTE', duration: 1, to: 'CASTER' },
    ],
    presentation: { visualKey: 'riposte', element: 'SHIELD', castAnimation: 'guard' },
  },
  {
    id: 'second_wind',
    name: 'Segundo aliento',
    heroId: 'warrior',
    cost: 1,
    category: 'DEFENSE',
    tags: ['sustain', 'momentum'],
    rarity: 'COMMON',
    rulesText: 'Te curas 2 HP. Impulso 2: lo consume y te curas 5 HP en su lugar.',
    targeting: { type: 'SELF' },
    effects: [{ type: 'HEAL', amount: 2, to: 'CASTER' }],
    empowered: { momentum: 2, effects: [{ type: 'HEAL', amount: 5, to: 'CASTER' }] },
    presentation: { visualKey: 'second_wind', element: 'SHIELD', castAnimation: 'ability' },
  },
  {
    id: 'brutal_shove',
    name: 'Empujón brutal',
    heroId: 'warrior',
    cost: 1,
    category: 'CONTROL',
    tags: ['melee', 'push', 'momentum'],
    rarity: 'COMMON',
    rulesText:
      'Empuja 2 casillas a un enemigo adyacente (2 de daño si choca). Impulso 1: lo empuja 3 (3 si choca).',
    targeting: MELEE,
    effects: [{ type: 'PUSH', distance: 2, collisionDamage: 2, to: 'ENEMIES' }],
    empowered: { momentum: 1, effects: [{ type: 'PUSH', distance: 3, collisionDamage: 3, to: 'ENEMIES' }] },
    presentation: { visualKey: 'brutal_shove', element: 'FORCE', castAnimation: 'attack' },
  },
  {
    id: 'steady_advance',
    name: 'Avance',
    heroId: 'warrior',
    cost: 0,
    category: 'MOVEMENT',
    tags: ['movement', 'momentum-builder'],
    rarity: 'COMMON',
    rulesText: 'Ganas 1 punto de movimiento y 1 Impulso.',
    targeting: { type: 'SELF' },
    effects: [
      { type: 'GAIN_MOVE_POINTS', amount: 1 },
      { type: 'GAIN_MOMENTUM', amount: 1 },
    ],
    presentation: { visualKey: 'steady_advance', element: 'NEUTRAL', castAnimation: 'ability' },
  },

  // ── Unlockables (earned through drops) ─────────────────────────────────────────────────
  // BRAWLER: close-range disruption.
  {
    id: 'sweep',
    name: 'Barrido',
    heroId: 'warrior',
    cost: 2,
    category: 'ATTACK',
    tags: ['melee', 'area', 'brawler'],
    rarity: 'COMMON',
    rulesText:
      'Inflige 2 de daño físico a cada enemigo adyacente. Impulso 2: 3 de daño y los empuja 1 casilla.',
    targeting: { type: 'SELF', area: { shape: 'CROSS', radius: 1, includeCenter: false } },
    effects: [hit(2)],
    empowered: { momentum: 2, effects: [hit(3), { type: 'PUSH', distance: 1, collisionDamage: 1, to: 'ENEMIES' }] },
    presentation: { visualKey: 'sweep', element: 'FORCE', castAnimation: 'attack' },
  },
  {
    id: 'grapple',
    name: 'Agarre',
    heroId: 'warrior',
    cost: 1,
    category: 'CONTROL',
    tags: ['melee', 'root', 'brawler'],
    rarity: 'COMMON',
    rulesText: 'Inflige 1 de daño físico a un enemigo adyacente y lo enraíza 1 turno: no puede alejarse andando.',
    targeting: MELEE,
    effects: [hit(1), { type: 'APPLY_STATUS', status: 'ROOTED', duration: 1, to: 'ENEMIES' }],
    presentation: { visualKey: 'grapple', element: 'FORCE', castAnimation: 'attack' },
  },
  // GUARDIAN: defence, objectives, allies.
  {
    id: 'steel_wall',
    name: 'Muro de acero',
    heroId: 'warrior',
    cost: 1,
    category: 'DEFENSE',
    tags: ['guard', 'shield', 'guardian', 'support'],
    rarity: 'UNCOMMON',
    rulesText:
      'Tú y tus aliados a tu alrededor (8 casillas) ganáis 3 de Guardia. Pierdes el movimiento que te quede este turno.',
    targeting: { type: 'SELF', area: { shape: 'SQUARE', radius: 1, includeCenter: true } },
    effects: [{ type: 'SHIELD', amount: 3, to: 'ALLIES' }, PLANT],
    presentation: { visualKey: 'steel_wall', element: 'SHIELD', castAnimation: 'guard' },
  },
  {
    id: 'bastion',
    name: 'Bastión',
    heroId: 'warrior',
    cost: 2,
    category: 'DEFENSE',
    tags: ['guard', 'counter', 'guardian'],
    rarity: 'RARE',
    rulesText:
      'Ganas 5 de Guardia, Contraataque y 1 Impulso, pero quedas Enraizado hasta el final de tu próximo turno. Los empujones sí te mueven.',
    targeting: { type: 'SELF' },
    effects: [
      { type: 'SHIELD', amount: 5, to: 'CASTER' },
      { type: 'APPLY_STATUS', status: 'RIPOSTE', duration: 1, to: 'CASTER' },
      { type: 'APPLY_STATUS', status: 'ROOTED', duration: 2, to: 'CASTER' },
      { type: 'GAIN_MOMENTUM', amount: 1 },
    ],
    presentation: { visualKey: 'bastion', element: 'SHIELD', castAnimation: 'guard' },
  },
  // VANGUARD: charges, Momentum payoffs, answers to kiting.
  {
    id: 'ram',
    name: 'Embestida',
    heroId: 'warrior',
    cost: 2,
    category: 'CONTROL',
    tags: ['charge', 'push', 'vanguard'],
    rarity: 'UNCOMMON',
    rulesText:
      'Carga hacia un enemigo a 2–3 casillas con el camino libre, inflige 1 de daño físico y lo empuja 2 casillas (2 si choca). Ganas 1 Impulso.',
    targeting: { type: 'CHARGE', range: 3, minRange: 2 },
    effects: [
      { type: 'CHARGE_CASTER' },
      hit(1),
      { type: 'PUSH', distance: 2, collisionDamage: 2, to: 'ENEMIES' },
      { type: 'GAIN_MOMENTUM', amount: 1 },
    ],
    presentation: { visualKey: 'ram', element: 'FORCE', castAnimation: 'charge' },
  },
  {
    id: 'unstoppable',
    name: 'Imparable',
    heroId: 'warrior',
    cost: 1,
    category: 'MOVEMENT',
    tags: ['cleanse', 'movement', 'vanguard'],
    rarity: 'UNCOMMON',
    rulesText: 'Te quitas los estados negativos (Enraizado, Ardiendo…) y ganas 2 puntos de movimiento.',
    targeting: { type: 'SELF' },
    effects: [
      { type: 'CLEANSE', to: 'CASTER' },
      { type: 'GAIN_MOVE_POINTS', amount: 2 },
    ],
    presentation: { visualKey: 'unstoppable', element: 'NEUTRAL', castAnimation: 'ability' },
  },
  {
    id: 'vanguard_fury',
    name: 'Furia de vanguardia',
    heroId: 'warrior',
    cost: 2,
    category: 'ATTACK',
    tags: ['melee', 'momentum', 'vanguard'],
    rarity: 'RARE',
    rulesText:
      'Inflige 2 de daño físico a un enemigo adyacente. Impulso 3: lo consume todo e inflige 6 en su lugar.',
    targeting: MELEE,
    effects: [hit(2)],
    empowered: { momentum: 3, effects: [hit(6)] },
    presentation: { visualKey: 'vanguard_fury', element: 'FORCE', castAnimation: 'attack' },
  },
  // EXECUTIONER (store set «Juramento del Verdugo»; also a normal elite/boss drop): finisher.
  // Threshold reads current HP only, so Guard/shield and armor still blunt it (counterplay), and
  // reach 1 means the target can deny it by keeping its distance.
  {
    id: 'execution',
    name: 'Ejecución',
    heroId: 'warrior',
    cost: 2,
    category: 'ATTACK',
    tags: ['melee', 'momentum', 'finisher', 'vanguard'],
    rarity: 'RARE',
    rulesText:
      'Inflige 3 de daño físico a un enemigo adyacente; si tiene 5 HP o menos, 5 en su lugar. Impulso 2: lo consume; 4 de daño, o 7 si tiene 7 HP o menos.',
    targeting: MELEE,
    effects: [finish(3, 5)],
    empowered: { momentum: 2, effects: [finish(4, 7)] },
    presentation: { visualKey: 'execution', element: 'FORCE', castAnimation: 'attack' },
  },
];
