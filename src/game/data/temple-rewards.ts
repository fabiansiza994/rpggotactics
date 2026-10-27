import type { CardDefinition } from '../domain/cards/card';

/**
 * Act III «El Templo del Umbral» reward cards (8): positional play for a board that moves.
 * Every card uses existing effects only and touches UNITS, never the board's mechanisms: no card
 * can press a plate from afar, pull a lever, turn a section or move a statue, so the puzzles keep
 * their meaning (pulling a summon onto a plate is still "a summon on the plate").
 *
 * Cadence (data/temple-encounters.ts): XXIV, XXVI and XXVIII each offer one NEUTRAL card (authored
 * offer, `ENCOUNTER_REWARD`); defeating XXX grants each champion its own card with the act's
 * completion reward (`WORLD_COMPLETION`, data/worlds.ts WORLD_3). Exclusive sources keep them out
 * of random drops, the store, promo codes and guest imports; once owned they are ordinary cards.
 *
 * Power rule: sidegrades, never a strictly better copy of an existing card (the comparison is noted
 * on each card). Neutral cards stay a notch below each champion's own specialty.
 */
export const TEMPLE_WORLD_ID = 'world_3';
const ENCOUNTER = { source: 'ENCOUNTER_REWARD', worldId: TEMPLE_WORLD_ID } as const;
const COMPLETION = { source: 'WORLD_COMPLETION', worldId: TEMPLE_WORLD_ID } as const;

/** Neutral: every champion can earn and equip them (shared account pool, max 4 neutrals per deck). */
export const TEMPLE_NEUTRAL_CARDS: CardDefinition[] = [
  {
    // XXIV. Mage Paso de Fase / Summoner Paso Ligero give 2 for 0; the neutral version gives 1.
    id: 'threshold_step',
    name: 'Paso del Umbral',
    cost: 0,
    category: 'MOVEMENT',
    tags: ['neutral', 'movement', 'temple-reward'],
    rarity: 'UNCOMMON',
    rulesText: 'Ganas 1 de movimiento este turno.',
    targeting: { type: 'SELF' },
    effects: [{ type: 'GAIN_MOVE_POINTS', amount: 1 }],
    acquisition: ENCOUNTER,
    presentation: { visualKey: 'threshold_step', element: 'NEUTRAL', castAnimation: 'cast_support' },
  },
  {
    // XXVI. Ponerse a cubierto shields 3; Imparable (Warrior) cleanses + 2 movement. Here: shake off
    // a root or a slow to keep your route, with a smaller shield.
    id: 'broken_seal',
    name: 'Sello Roto',
    cost: 1,
    category: 'DEFENSE',
    tags: ['neutral', 'cleanse', 'shield', 'temple-reward'],
    rarity: 'UNCOMMON',
    rulesText: 'Eliminas tus efectos negativos (Enraizado, Lento, Ardiendo…) y ganas 2 de escudo hasta tu próximo turno.',
    targeting: { type: 'SELF' },
    effects: [
      { type: 'CLEANSE', to: 'CASTER' },
      { type: 'SHIELD', amount: 2, to: 'CASTER' },
    ],
    acquisition: ENCOUNTER,
    presentation: { visualKey: 'broken_seal', element: 'SHIELD', castAnimation: 'guard' },
  },
  {
    // XXVIII. Gancho (Arsenal I) pulls 1 from range 3; this pulls 2 but only from range 2.
    id: 'counterweight_rope',
    name: 'Cuerda de Contrapeso',
    cost: 1,
    category: 'CONTROL',
    tags: ['neutral', 'pull', 'position', 'temple-reward'],
    rarity: 'UNCOMMON',
    rulesText: 'Atraes 2 casillas hacia ti a un enemigo a distancia 2 con visión. No causa daño.',
    targeting: { type: 'UNIT', range: 2, unitFilter: 'ENEMY', requiresLineOfSight: true },
    effects: [{ type: 'PULL', distance: 2, to: 'ENEMIES' }],
    acquisition: ENCOUNTER,
    presentation: { visualKey: 'counterweight_rope', element: 'FORCE', castAnimation: 'cast' },
  },
];

/** Champion cards, granted once per champion with the act's completion (XXX). */
export const TEMPLE_CHAMPION_CARDS: CardDefinition[] = [
  {
    // Mage: space control. Explosión Arcana hits the same cross for 2; this hits 1 and shoves
    // every enemy in it a tile away from you (crowding them into walls and each other).
    id: 'threshold_wave',
    name: 'Onda del Umbral',
    heroId: 'mage',
    cost: 2,
    category: 'CONTROL',
    tags: ['arcane', 'area', 'push', 'position', 'temple-reward'],
    rarity: 'RARE',
    rulesText:
      'Elige una casilla a distancia 1–3 con visión: 1 de daño arcano a los enemigos en esa cruz y los empuja 1 casilla lejos de ti (1 de daño si chocan).',
    targeting: { type: 'CROSS', range: 3, radius: 1, includeCenter: true, requiresLineOfSight: true },
    effects: [
      // Area damage: never RANGED (cover protects from direct/projectile hits only).
      { type: 'DAMAGE', amount: 1, damageType: 'ARCANE', to: 'ENEMIES' },
      { type: 'PUSH', distance: 1, collisionDamage: 1, to: 'ENEMIES' },
    ],
    acquisition: COMPLETION,
    presentation: { visualKey: 'threshold_wave', element: 'ARCANE', castAnimation: 'cast' },
  },
  {
    // Summoner: summon relocation / hold zones. Relevo del Pacto swaps places (range 3); this
    // calls a summon back toward you without moving yourself (range 5) and shields it.
    id: 'threshold_call',
    name: 'Llamada del Umbral',
    heroId: 'summoner',
    cost: 1,
    category: 'UTILITY',
    tags: ['summon-synergy', 'pull', 'position', 'temple-reward'],
    rarity: 'RARE',
    rulesText: 'Una invocación tuya a distancia 5 con visión gana 2 de escudo y se acerca hasta 3 casillas hacia ti.',
    targeting: { type: 'UNIT', range: 5, unitFilter: 'SUMMON', requiresLineOfSight: true },
    effects: [
      { type: 'SHIELD', amount: 2, to: 'SUMMONS' },
      { type: 'PULL', distance: 3, to: 'SUMMONS' },
    ],
    acquisition: COMPLETION,
    presentation: { visualKey: 'threshold_call', element: 'ARCANE', castAnimation: 'cast_support' },
  },
  {
    // Warrior: push / anchor. Empujón Brutal pushes 2 for 1; this pushes 3 for 2 (and hits with
    // Impulso), the long shove that clears a lane or a section.
    id: 'colossus_shove',
    name: 'Empuje del Coloso',
    heroId: 'warrior',
    cost: 2,
    category: 'CONTROL',
    tags: ['melee', 'push', 'momentum', 'temple-reward'],
    rarity: 'RARE',
    rulesText:
      'Empujas 3 casillas a un enemigo adyacente (2 de daño si choca). Impulso 2: lo consume, además le inflige 2 de daño físico y el choque hace 3.',
    targeting: { type: 'UNIT', range: 1, unitFilter: 'ENEMY' },
    effects: [{ type: 'PUSH', distance: 3, collisionDamage: 2, to: 'ENEMIES' }],
    empowered: {
      momentum: 2,
      effects: [
        { type: 'DAMAGE', amount: 2, damageType: 'PHYSICAL', to: 'ENEMIES' },
        { type: 'PUSH', distance: 3, collisionDamage: 3, to: 'ENEMIES' },
      ],
    },
    acquisition: COMPLETION,
    presentation: { visualKey: 'colossus_shove', element: 'FORCE', castAnimation: 'attack' },
  },
];

/** Archer card (merged by withArcher: the Archer's content is added there). */
export const TEMPLE_ARCHER_CARDS: CardDefinition[] = [
  {
    // Archer: route control. Tiro Certero hits 2; this hits 1 and knocks the target back a tile
    // (off a lane, away from you), +1 Concentración on your Presa.
    id: 'deflecting_arrow',
    name: 'Flecha Desviadora',
    heroId: 'archer',
    cost: 1,
    category: 'CONTROL',
    tags: ['ranged', 'push', 'position', 'temple-reward'],
    rarity: 'RARE',
    rulesText:
      'Inflige 1 de daño a distancia (máx. 4, con visión) y empuja al objetivo 1 casilla lejos de ti (1 de daño si choca). Si es tu Presa, ganas 1 de Concentración.',
    targeting: { type: 'UNIT', range: 4, unitFilter: 'ENEMY', requiresLineOfSight: true },
    effects: [
      { type: 'DAMAGE', amount: 1, damageType: 'PHYSICAL', to: 'ENEMIES', attackKind: 'RANGED', focusGain: { amount: 1, when: [{ type: 'TARGET_IS_PREY' }] } },
      { type: 'PUSH', distance: 1, collisionDamage: 1, to: 'ENEMIES' },
    ],
    acquisition: COMPLETION,
    presentation: { visualKey: 'deflecting_arrow', element: 'FORCE', castAnimation: 'attack' },
  },
];

/** Shapeshifter card (merged by withShapeshifterRelease, after its catalog). */
export const TEMPLE_SHAPESHIFTER_CARDS: CardDefinition[] = [
  {
    // Shapeshifter: mobility / pressure, any form. Embestida Brutal (charge 3, 3 dmg, push, +1 MP)
    // costs 2; this reaches farther (2–4) for 1 but hits for 2 and never pushes.
    id: 'threshold_pounce',
    name: 'Embestida del Umbral',
    heroId: 'shapeshifter',
    cost: 1,
    category: 'MOVEMENT',
    tags: ['charge', 'mobility', 'pressure', 'temple-reward'],
    rarity: 'RARE',
    rulesText:
      'Carga en línea recta hasta un enemigo a distancia 2–4 con el camino libre: le infliges 2 de daño físico y ganas 1 de movimiento. No funciona si estás Enraizado.',
    targeting: { type: 'CHARGE', range: 4, minRange: 2 },
    effects: [
      { type: 'CHARGE_CASTER' },
      { type: 'DAMAGE', amount: 2, damageType: 'PHYSICAL', to: 'ENEMIES' },
      { type: 'GAIN_MOVE_POINTS', amount: 1 },
    ],
    acquisition: COMPLETION,
    presentation: { visualKey: 'threshold_pounce', element: 'FORCE', castAnimation: 'charge' },
  },
];

export const TEMPLE_REWARD_CARDS: readonly CardDefinition[] = [...TEMPLE_NEUTRAL_CARDS, ...TEMPLE_CHAMPION_CARDS, ...TEMPLE_ARCHER_CARDS, ...TEMPLE_SHAPESHIFTER_CARDS];

/** Champion id → the card XXX grants with the act's completion. */
export const TEMPLE_COMPLETION_CARD_BY_CHAMPION: Readonly<Record<string, string>> = {
  mage: 'threshold_wave',
  summoner: 'threshold_call',
  warrior: 'colossus_shove',
  archer: 'deflecting_arrow',
  shapeshifter: 'threshold_pounce',
};

/** Encounter → its authored neutral card offer. */
export const TEMPLE_ENCOUNTER_CARDS: Readonly<Record<string, string>> = {
  w3_e04: 'threshold_step',
  w3_e06: 'broken_seal',
  w3_e08: 'counterweight_rope',
};
