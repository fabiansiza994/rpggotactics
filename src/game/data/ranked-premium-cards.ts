import type { CardDefinition, EffectCondition } from '../domain/cards/card';
import type { StatusDef } from '../domain/statuses/status';

/**
 * Ranked Premium Track — the five pass cards (qa/ranked-premium-track/REPORT.md). One per
 * champion, all LEGENDARY + Única (1 copy per deck, banished once played), so a deck holds at
 * most one of them and each fires once per battle.
 *
 * Early access, never a permanent exclusive: `acquisition.source = RANKED_PREMIUM` keeps them out
 * of drops, the store, promo codes, gifts and guest imports while the pass is their only source
 * (this season + the next, `exclusiveUntilSeason`). See RANKED_PREMIUM_RELEASE_POLICY in
 * src/game/ranked/premiumTrack.ts. Effects are composed from engine primitives.
 */

export const RANKED_PREMIUM_SEASON_ID = 'preseason_0';
/** Last season (inclusive) in which the pass is the only way to get the cards. */
export const RANKED_PREMIUM_EXCLUSIVE_UNTIL = 'season_1';

/** Stable reward id of each card's premium node (never renamed: grants are keyed by it). */
export const RANKED_PREMIUM_CARD_REWARD_ID = {
  double_moon_pact: 'rp.preseason_0.IRON_I.card',
  fallen_king_wall: 'rp.preseason_0.BRONZE_I.card',
  stalker_heart: 'rp.preseason_0.SILVER_I.card',
  ash_eclipse: 'rp.preseason_0.GOLD_I.card',
  primal_ascent: 'rp.preseason_0.PLATINUM_I.card',
} as const;

export type RankedPremiumCardId = keyof typeof RANKED_PREMIUM_CARD_REWARD_ID;

const premium = (def: Omit<CardDefinition, 'acquisition' | 'id' | 'rarity' | 'unique'> & { id: RankedPremiumCardId }): CardDefinition => ({
  ...def,
  rarity: 'LEGENDARY',
  unique: true,
  tags: [...def.tags, 'unique', 'ranked-premium'],
  acquisition: {
    source: 'RANKED_PREMIUM',
    seasonId: RANKED_PREMIUM_SEASON_ID,
    rewardId: RANKED_PREMIUM_CARD_REWARD_ID[def.id],
    exclusiveUntilSeason: RANKED_PREMIUM_EXCLUSIVE_UNTIL,
  },
});

/** Presa (Archer PREY of this caster) or the Summoner's Marcar Presa. */
const MARKED: EffectCondition = { type: 'ANY_OF', conditions: [{ type: 'TARGET_IS_PREY' }, { type: 'TARGET_HAS_STATUS', statuses: ['MARKED_PREY'] }] };
/**
 * Approved mapping (no literal Frío/Quemadura status exists): Quemadura = Ardiendo (BURNING) or on
 * FIRE terrain; Frío = Ralentizado (SLOWED) or on ICE terrain. Read at resolution, per enemy.
 */
const FIRE_OR_ICE: EffectCondition = {
  type: 'ANY_OF',
  conditions: [{ type: 'TARGET_HAS_STATUS', statuses: ['BURNING', 'SLOWED'] }, { type: 'TARGET_ON_TERRAIN', terrains: ['FIRE', 'ICE'] }],
};

export const RANKED_PREMIUM_STATUSES = {
  /** Corazón del Acechador: −1 walking on the unit's next turn (strongest slow only, never below 1). */
  STALKER_HOBBLE: {
    id: 'STALKER_HOBBLE',
    name: 'Acechado',
    negative: true,
    tick: 'NEVER',
    stacking: 'REFRESH',
    moveReduction: 1,
  },
  /** Ascenso Primordial (Minotauro): the next card hit this turn pushes 1 (no collision damage). */
  PRIMAL_CHARGE: {
    id: 'PRIMAL_CHARGE',
    name: 'Embestida Primordial',
    negative: false,
    tick: 'NEVER',
    stacking: 'REFRESH',
    nextAttackPush: 1,
  },
} as const satisfies Record<string, StatusDef>;

export const RANKED_PREMIUM_SUMMONER_CARDS: CardDefinition[] = [
  premium({
    id: 'double_moon_pact',
    name: 'Pacto de la Doble Luna',
    heroId: 'summoner',
    cost: 3,
    category: 'MOVEMENT',
    tags: ['summon-synergy', 'swap', 'position'],
    rulesText:
      'Única. Elige una invocación tuya a distancia 4 con visión: intercambia su posición contigo o con otra invocación tuya a distancia 4 con visión. Las unidades movidas ganan 2 de escudo y las invocaciones movidas, +1 de movimiento este turno. Ninguna unidad Enraizada puede moverse.',
    targeting: { type: 'UNIT', range: 4, unitFilter: 'SUMMON', requiresLineOfSight: true, pairSwap: { range: 4, requiresLineOfSight: true } },
    // After the swap the two affected tiles hold exactly the two moved units.
    effects: [{ type: 'SWAP_PAIR' }, { type: 'SHIELD', amount: 2, to: 'ALLIES' }, { type: 'APPLY_STATUS', status: 'PACK_CALL', duration: 1, to: 'SUMMONS' }],
    presentation: { visualKey: 'double_moon_pact', element: 'TELEPORT', castAnimation: 'cast_support' },
  }),
];

export const RANKED_PREMIUM_WARRIOR_CARDS: CardDefinition[] = [
  premium({
    // Golpe del Bastión's primitive, tuned higher and costlier: ALL the Guardia is lost.
    id: 'fallen_king_wall',
    name: 'Muralla del Rey Caído',
    heroId: 'warrior',
    cost: 2,
    category: 'ATTACK',
    tags: ['melee', 'guard'],
    rulesText:
      'Única. Inflige a un enemigo adyacente daño físico igual a tu Guardia actual (máx. 7) y pierdes TODA tu Guardia. Sin Guardia no hace daño. Si tenías 5+ de Guardia al resolver, además lo empuja 1 casilla y recuperas 1 MP.',
    targeting: { type: 'UNIT', range: 1, unitFilter: 'ENEMY' },
    effects: [
      {
        type: 'DAMAGE',
        amount: 0,
        damageType: 'PHYSICAL',
        to: 'ENEMIES',
        fromCasterShield: { max: 7, consumeAll: true, highGuard: { atLeast: 5, pushDistance: 1, movePoints: 1 } },
      },
    ],
    presentation: { visualKey: 'fallen_king_wall', element: 'SHIELD', castAnimation: 'attack' },
  }),
];

export const RANKED_PREMIUM_ARCHER_CARDS: CardDefinition[] = [
  premium({
    id: 'stalker_heart',
    name: 'Corazón del Acechador',
    heroId: 'archer',
    cost: 3,
    category: 'ATTACK',
    tags: ['arrow', 'prey', 'slow'],
    rulesText:
      'Única. A distancia 5 con visión: 2 de daño físico a distancia (la cobertura lo reduce); +3 si el objetivo es tu Presa o está Marcado. Si sobrevive, queda Acechado: −1 de movimiento en su próximo turno. No da Concentración.',
    targeting: { type: 'UNIT', range: 5, unitFilter: 'ENEMY', requiresLineOfSight: true },
    effects: [
      { type: 'DAMAGE', amount: 2, damageType: 'PHYSICAL', to: 'ENEMIES', attackKind: 'RANGED', bonus: { when: MARKED, amount: 3 } },
      { type: 'APPLY_STATUS', status: 'STALKER_HOBBLE', duration: 1, to: 'ENEMIES' },
    ],
    presentation: { visualKey: 'stalker_heart', element: 'NEUTRAL', castAnimation: 'attack' },
  }),
];

export const RANKED_PREMIUM_MAGE_CARDS: CardDefinition[] = [
  premium({
    id: 'ash_eclipse',
    name: 'Eclipse de Ceniza',
    heroId: 'mage',
    cost: 4,
    category: 'ATTACK',
    tags: ['arcane', 'area', 'fire', 'ice'],
    rulesText:
      'Única. Un área de 2×2 a distancia 4 con visión: 3 de daño arcano a cada enemigo; +2 al que esté Ardiendo o sobre fuego, o Ralentizado o sobre hielo. Si alcanza a 2+ enemigos, tu próximo hechizo de este combate cuesta 1 menos (una vez, nunca menos de 0).',
    targeting: { type: 'TILE', range: 4, tileFilter: 'ANY', requiresLineOfSight: true, area: { shape: 'BLOCK', size: 2 } },
    // The discount is decided BEFORE the hit: enemies it kills still count as hit.
    effects: [
      { type: 'GRANT_COST_DISCOUNT', scope: 'SPELL', amount: 1, minEnemiesInArea: 2 },
      { type: 'DAMAGE', amount: 3, damageType: 'ARCANE', to: 'ENEMIES', bonus: { when: FIRE_OR_ICE, amount: 2 } },
    ],
    presentation: { visualKey: 'ash_eclipse', element: 'ARCANE', castAnimation: 'cast_nova' },
  }),
];

export const RANKED_PREMIUM_SHAPESHIFTER_CARDS: CardDefinition[] = [
  premium({
    // Never transforms: only the current form's bonus applies (forms carry no duration to renew).
    id: 'primal_ascent',
    name: 'Ascenso Primordial',
    heroId: 'shapeshifter',
    cost: 3,
    category: 'UTILITY',
    tags: ['form-synergy'],
    rulesText:
      'Única. No cambia tu forma: aplica solo el efecto de tu forma actual. Humano: robas 1 carta y tu próxima transformación cuesta 1 menos. Oso: ganas 2 de Guardia y te curas 2. Minotauro: +1 de movimiento y tu próximo golpe de este turno empuja 1 casilla.',
    targeting: { type: 'SELF' },
    effects: [{ type: 'DRAW', count: 1 }, { type: 'GRANT_COST_DISCOUNT', scope: 'TRANSFORM', amount: 1 }],
    formEffectsById: {
      bear: [{ type: 'SHIELD', amount: 2, to: 'CASTER' }, { type: 'HEAL', amount: 2, to: 'CASTER' }],
      minotaur: [{ type: 'GAIN_MOVE_POINTS', amount: 1 }, { type: 'APPLY_STATUS', status: 'PRIMAL_CHARGE', duration: 1, to: 'CASTER' }],
    },
    presentation: { visualKey: 'primal_ascent', element: 'FORCE', castAnimation: 'cast_support' },
  }),
];

/** Mage / Summoner / Warrior: always in DEFAULT_CONTENT. */
export const RANKED_PREMIUM_CORE_CARDS: CardDefinition[] = [...RANKED_PREMIUM_MAGE_CARDS, ...RANKED_PREMIUM_SUMMONER_CARDS, ...RANKED_PREMIUM_WARRIOR_CARDS];

/** All five, in premium track order (Archer via withArcher, Cambiaformas via its release). */
export const RANKED_PREMIUM_CARDS: CardDefinition[] = [
  ...RANKED_PREMIUM_SUMMONER_CARDS,
  ...RANKED_PREMIUM_WARRIOR_CARDS,
  ...RANKED_PREMIUM_ARCHER_CARDS,
  ...RANKED_PREMIUM_MAGE_CARDS,
  ...RANKED_PREMIUM_SHAPESHIFTER_CARDS,
];
