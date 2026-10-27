import type { CardDefinition, EffectDef } from '../domain/cards/card';

/**
 * Ranked Reward Track v0.1 — the nine approved cards (qa/ranked-reward-track/REPORT.md). Every one
 * is EARLY ACCESS, not a permanent exclusive: `acquisition.source = RANKED_TRACK` keeps it out of
 * drops, the store, promo codes, gifts and guest imports during the Preseason. Releasing a card
 * to the normal pools later = deleting its `acquisition` (see RANKED_CARD_RELEASE_POLICY in
 * src/game/ranked/rewardTrack.ts). Owned copies never depend on it.
 *
 * Rarity uses the real ladder: 6 UNCOMMON (2 copies per deck) + 3 RARE (1 copy). Effects are
 * composed from engine primitives (no per-card handler).
 */

export const RANKED_TRACK_SEASON_ID = 'preseason_0';

/** Stable reward id of each card's track node (never renamed: grants are keyed by it). */
export const RANKED_CARD_REWARD_ID = {
  palisade: 'rt.preseason_0.IRON_II.card',
  wall_patience: 'rt.preseason_0.IRON_I.card',
  pact_relay: 'rt.preseason_0.BRONZE_II.card',
  wild_burst: 'rt.preseason_0.BRONZE_I.card',
  ignition_rune: 'rt.preseason_0.SILVER_II.card',
  altar_echo: 'rt.preseason_0.SILVER_I.card',
  siege_leap: 'rt.preseason_0.GOLD_II.card',
  tracking_arrow: 'rt.preseason_0.GOLD_I.card',
  arcane_exchange: 'rt.preseason_0.PLATINUM_II.card',
} as const;

type RankedCardId = keyof typeof RANKED_CARD_REWARD_ID;

const ranked = (def: Omit<CardDefinition, 'acquisition' | 'id'> & { id: RankedCardId }): CardDefinition => ({
  ...def,
  tags: [...def.tags, 'ranked-track'],
  acquisition: { source: 'RANKED_TRACK', seasonId: RANKED_TRACK_SEASON_ID, rewardId: RANKED_CARD_REWARD_ID[def.id] },
});

/** Warrior "plant": the movement left this turn is lost (same primitive as Guardia). */
const PLANT: EffectDef = { type: 'GAIN_MOVE_POINTS', amount: -99 };

export const RANKED_MAGE_CARDS: CardDefinition[] = [
  ranked({
    id: 'ignition_rune',
    name: 'Runa de Ignición',
    heroId: 'mage',
    cost: 2,
    category: 'TERRAIN',
    tags: ['fire', 'zone', 'delayed'],
    rarity: 'UNCOMMON',
    rulesText:
      'Marcas una cruz (radio 1) a distancia 4 con visión. Al inicio de tu próximo turno, cada enemigo que siga dentro recibe 3 de daño de fuego. La marca es visible para ambos.',
    targeting: { type: 'CROSS', range: 4, radius: 1, includeCenter: true, requiresLineOfSight: true },
    effects: [{ type: 'PLACE_GLYPH', glyphId: 'ignition_rune', damage: 3, damageType: 'FIRE' }],
    presentation: { visualKey: 'ignition_rune', element: 'FIRE', castAnimation: 'cast' },
  }),
  ranked({
    id: 'arcane_exchange',
    name: 'Intercambio Arcano',
    heroId: 'mage',
    cost: 1,
    category: 'MOVEMENT',
    tags: ['teleport', 'swap', 'position'],
    rarity: 'RARE',
    rulesText:
      'Intercambias tu posición con una unidad a distancia 4 con visión (no estructuras). Si es un enemigo, queda Ralentizado 1 turno.',
    targeting: { type: 'UNIT', range: 4, minRange: 1, unitFilter: 'ANY', requiresLineOfSight: true, excludeStructures: true },
    // The slow lands BEFORE the swap: effects resolve on the target's original tile.
    effects: [{ type: 'APPLY_STATUS', status: 'SLOWED', duration: 1, to: 'ENEMIES' }, { type: 'SWAP_WITH_TARGET' }],
    presentation: { visualKey: 'arcane_exchange', element: 'TELEPORT', castAnimation: 'blink', premiumTreatment: 'showcase' },
  }),
];

export const RANKED_SUMMONER_CARDS: CardDefinition[] = [
  ranked({
    id: 'pact_relay',
    name: 'Relevo del Pacto',
    heroId: 'summoner',
    cost: 1,
    category: 'MOVEMENT',
    tags: ['summon-synergy', 'swap', 'position'],
    rarity: 'UNCOMMON',
    rulesText:
      'Intercambias tu posición con una invocación tuya a distancia 3 con visión; esa invocación gana 2 de escudo. No funciona si estás Enraizado.',
    targeting: { type: 'UNIT', range: 3, unitFilter: 'SUMMON', requiresLineOfSight: true, casterMustMove: true },
    effects: [{ type: 'SHIELD', amount: 2, to: 'SUMMONS' }, { type: 'SWAP_WITH_TARGET' }],
    presentation: { visualKey: 'pact_relay', element: 'ARCANE', castAnimation: 'cast_support' },
  }),
  ranked({
    id: 'altar_echo',
    name: 'Eco del Altar',
    heroId: 'summoner',
    cost: 1,
    category: 'UTILITY',
    tags: ['ritual-support', 'recursion'],
    rarity: 'UNCOMMON',
    rulesText: 'Elige una pieza de ritual de tu descarte y agrégala a tu mano. No puedes jugarla ni sellarla este turno.',
    targeting: { type: 'SELF' },
    // The choice is the SEARCH_SUMMON command's choiceUid, validated against the real discard pile.
    discardSearch: 'RITUAL_PIECE',
    effects: [],
    presentation: { visualKey: 'altar_echo', element: 'ARCANE', castAnimation: 'cast_support' },
  }),
];

export const RANKED_WARRIOR_CARDS: CardDefinition[] = [
  ranked({
    id: 'wall_patience',
    name: 'Paciencia del Muro',
    heroId: 'warrior',
    cost: 1,
    category: 'DEFENSE',
    tags: ['guard', 'anti-kite', 'momentum'],
    rarity: 'UNCOMMON',
    rulesText:
      'Ganas 3 de Guardia y pierdes el movimiento que te quede. Hasta tu próximo turno, el primer golpe de cada turno que recibas de un enemigo no adyacente (aunque lo absorba la Guardia) te da 1 Impulso adicional.',
    targeting: { type: 'SELF' },
    effects: [{ type: 'SHIELD', amount: 3, to: 'CASTER' }, { type: 'APPLY_STATUS', status: 'WALL_PATIENCE', duration: 1, to: 'CASTER' }, PLANT],
    presentation: { visualKey: 'wall_patience', element: 'SHIELD', castAnimation: 'guard' },
  }),
  ranked({
    id: 'siege_leap',
    name: 'Salto de Asedio',
    heroId: 'warrior',
    cost: 2,
    category: 'MOVEMENT',
    tags: ['leap', 'anti-kite', 'momentum'],
    rarity: 'RARE',
    rulesText:
      'Saltas a una casilla libre junto a un enemigo a distancia 2–3 con visión: le infliges 1 de daño físico y ganas 1 Impulso. No funciona si estás Enraizado. Las trampas se activan al aterrizar.',
    targeting: {
      type: 'TILE',
      range: 4,
      tileFilter: 'EMPTY',
      casterMustMove: true,
      leapAnchor: { minRange: 2, maxRange: 3, requiresLineOfSight: true },
    },
    effects: [
      { type: 'TELEPORT_CASTER' },
      { type: 'DAMAGE', amount: 1, damageType: 'PHYSICAL', to: 'ENEMIES' },
      { type: 'GAIN_MOMENTUM', amount: 1 },
    ],
    presentation: { visualKey: 'siege_leap', element: 'FORCE', castAnimation: 'charge' },
  }),
];

export const RANKED_ARCHER_CARDS: CardDefinition[] = [
  ranked({
    id: 'palisade',
    name: 'Empalizada',
    heroId: 'archer',
    cost: 1,
    category: 'TERRAIN',
    tags: ['cover', 'obstacle', 'focus-builder'],
    rarity: 'UNCOMMON',
    rulesText:
      'Clavas Escombros en una casilla libre adyacente durante 2 rondas: bloquean el paso, no la visión. Si tu Presa está a Distancia Óptima (3–4), ganas 1 Concentración.',
    targeting: { type: 'TILE', range: 1, minRange: 1, tileFilter: 'EMPTY' },
    effects: [
      { type: 'CREATE_OBSTACLE', obstacleId: 'rubble', duration: 2, on: 'IMPACT' },
      { type: 'GAIN_FOCUS', amount: 1, when: [{ type: 'PREY_IN_OPTIMAL_RANGE' }] },
    ],
    presentation: { visualKey: 'palisade', element: 'FORCE', castAnimation: 'ability' },
  }),
  ranked({
    id: 'tracking_arrow',
    name: 'Flecha Rastreadora',
    heroId: 'archer',
    cost: 2,
    category: 'ATTACK',
    tags: ['arrow', 'prey', 'ignores-sight'],
    rarity: 'RARE',
    rulesText:
      'Solo contra tu Presa, a distancia 5: inflige 2 de daño físico aunque no tengas visión. Ignora la cobertura. No da Concentración.',
    targeting: { type: 'UNIT', range: 5, unitFilter: 'ENEMY', preyOnly: true },
    // No `attackKind: 'RANGED'`: cover (rangedReduction) never applies to it.
    effects: [{ type: 'DAMAGE', amount: 2, damageType: 'PHYSICAL', to: 'ENEMIES' }],
    presentation: { visualKey: 'tracking_arrow', element: 'NEUTRAL', castAnimation: 'attack' },
  }),
];

export const RANKED_SHAPESHIFTER_CARDS: CardDefinition[] = [
  ranked({
    id: 'wild_burst',
    name: 'Estallido Salvaje',
    heroId: 'shapeshifter',
    cost: 1,
    category: 'ATTACK',
    tags: ['form-change', 'burst'],
    rarity: 'UNCOMMON',
    rulesText:
      'Forma humana: robas 1 carta y ganas 1 de movimiento. Forma Bestia: vuelves a forma humana, infliges 2 de daño físico a cada enemigo adyacente (en cruz) y los empujas 1 casilla (1 de daño si chocan).',
    targeting: { type: 'SELF', area: { shape: 'CROSS', radius: 1, includeCenter: false } },
    effects: [{ type: 'DRAW', count: 1 }, { type: 'GAIN_MOVE_POINTS', amount: 1 }],
    formEffects: {
      HUMAN: [{ type: 'DRAW', count: 1 }, { type: 'GAIN_MOVE_POINTS', amount: 1 }],
      BEAST: [
        { type: 'TRANSFORM', formId: null },
        { type: 'DAMAGE', amount: 2, damageType: 'PHYSICAL', to: 'ENEMIES' },
        { type: 'PUSH', distance: 1, collisionDamage: 1, to: 'ENEMIES' },
      ],
    },
    presentation: { visualKey: 'wild_burst', element: 'FORCE', castAnimation: 'attack' },
  }),
];

/** Mage / Summoner / Warrior: always in DEFAULT_CONTENT. */
export const RANKED_CORE_CARDS: CardDefinition[] = [...RANKED_MAGE_CARDS, ...RANKED_SUMMONER_CARDS, ...RANKED_WARRIOR_CARDS];

/** All nine, in track order of their champions (Archer via withArcher, Cambiaformas via its release). */
export const RANKED_TRACK_CARDS: CardDefinition[] = [
  ...RANKED_CORE_CARDS,
  ...RANKED_ARCHER_CARDS,
  ...RANKED_SHAPESHIFTER_CARDS,
];
