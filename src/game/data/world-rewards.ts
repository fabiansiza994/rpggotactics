import type { CardDefinition } from '../domain/cards/card';
import type { SummonDef } from '../domain/content';

/**
 * World reward cards: one exclusive card per champion for completing a world (granted with the
 * world's completion reward, once per champion). `acquisition` keeps them out of reward drops,
 * the store, promo codes and guest imports; once owned they are ordinary cards in every mode
 * (campaign, skirmish, PvP). Their gameplay never depends on lava or World 2 enemies.
 *
 * World 2 «Reino Infernal» (balance probe: qa/world2-reward-cards/REPORT.md):
 * - Fisura Magmática (Mage): area denial. Fireball is a single-target projectile that burns the
 *   unit; the fissure is a 3-tile line that hurts lightly and leaves the GROUND burning.
 * - Sabueso de Ceniza (Summoner): fragile capacity-1 chaser whose bite sets BURNING. Not a second
 *   Lobo (no 2-capacity bruiser), not a Dragón (no ranged elite), not a ritual creature.
 * - Golpe de la Forja (Warrior): heavy adjacent hit + push 1 (2 with Impulso). Pushing into
 *   hazards, allies or walls is the payoff, never a requirement. Deliberately not above Golpe
 *   pesado's damage: the Warrior is already the strongest World 2 champion.
 */
const WORLD_2 = { source: 'WORLD_COMPLETION', worldId: 'world_2' } as const;

export const WORLD_REWARD_CARDS: CardDefinition[] = [
  {
    id: 'magma_fissure',
    name: 'Fisura Magmática',
    heroId: 'mage',
    cost: 3,
    category: 'TERRAIN',
    tags: ['fire', 'terrain', 'area', 'wall', 'world-reward'],
    rarity: 'RARE',
    rulesText:
      'Abre una fisura de 3 casillas (perpendicular a ti) a distancia 1–3 con visión: 1 de fuego a cada enemigo; las casillas libres de la fisura arden 2 rondas (2 de daño a quien termine su turno encima).',
    targeting: { type: 'TILE', range: 3, minRange: 1, tileFilter: 'NOT_BLOCKED', requiresLineOfSight: true, area: { shape: 'WALL', radius: 1 } },
    effects: [
      // Probe (qa/world2-reward-cards): fire UNDER enemies was guaranteed damage (enemy AI never
      // steps off hazards): +6.5 pp for one copy whatever its damage, duration or cost. Fire only on
      // the EMPTY tiles makes it ground control; 2 damage was still +4.3 pp, 1 damage is +2.3.
      { type: 'DAMAGE', amount: 1, damageType: 'FIRE', to: 'ENEMIES', attackKind: 'RANGED' },
      { type: 'CREATE_TERRAIN', terrain: 'FIRE', duration: 2, on: 'AREA', emptyOnly: true },
    ],
    acquisition: WORLD_2,
    presentation: { visualKey: 'magma_fissure', element: 'FIRE', castAnimation: 'cast' },
  },
  {
    id: 'summon_ash_hound',
    name: 'Invocar Sabueso de Ceniza',
    heroId: 'summoner',
    cost: 2,
    category: 'UTILITY',
    tags: ['summon', 'pressure', 'fire', 'world-reward'],
    rarity: 'RARE',
    rulesText:
      '9 HP · mueve 3 · mordisco de fuego 2 · capacidad 1. Persigue al enemigo más cercano y lo deja Ardiendo 2 turnos. Actúa desde la siguiente ronda. Permanece hasta morir o ser retirada.',
    targeting: { type: 'TILE', range: 2, tileFilter: 'EMPTY', requiresLineOfSight: true },
    effects: [{ type: 'SUMMON', summonId: 'ash_hound' }],
    acquisition: WORLD_2,
    presentation: { visualKey: 'summon_ash_hound', element: 'FIRE' },
  },
  {
    id: 'forge_strike',
    name: 'Golpe de la Forja',
    heroId: 'warrior',
    cost: 2,
    category: 'ATTACK',
    tags: ['melee', 'push', 'momentum', 'world-reward'],
    rarity: 'RARE',
    rulesText:
      'Inflige 3 de daño físico a un enemigo adyacente y lo empuja 1 casilla (2 de daño si choca). Impulso 2: lo consume, inflige 4 y lo empuja 2 casillas.',
    targeting: { type: 'UNIT', range: 1, unitFilter: 'ENEMY' },
    effects: [
      { type: 'DAMAGE', amount: 3, damageType: 'PHYSICAL', to: 'ENEMIES' },
      { type: 'PUSH', distance: 1, collisionDamage: 2, to: 'ENEMIES' },
    ],
    empowered: {
      momentum: 2,
      effects: [
        { type: 'DAMAGE', amount: 4, damageType: 'PHYSICAL', to: 'ENEMIES' },
        { type: 'PUSH', distance: 2, collisionDamage: 2, to: 'ENEMIES' },
      ],
    },
    acquisition: WORLD_2,
    presentation: { visualKey: 'forge_strike', element: 'FORCE', castAnimation: 'attack' },
  },
];

export const WORLD_REWARD_SUMMONS: Readonly<Record<string, SummonDef>> = {
  /** Same chase behaviour as the Lobo (PRESSURE) at half its weight: capacity 1, 9 HP, burn on bite. */
  ash_hound: {
    id: 'ash_hound',
    name: 'Sabueso de Ceniza',
    behavior: 'PRESSURE',
    damageType: 'FIRE',
    maxHp: 9,
    armor: 0,
    moveRange: 3,
    damage: 2,
    capacityCost: 1,
    onHitStatus: { status: 'BURNING', duration: 2 },
    visualKey: 'ash_hound',
  },
};

/** World id → the card each champion earns by completing it. */
export const WORLD_REWARD_CARD_BY_CHAMPION: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  world_2: { mage: 'magma_fissure', summoner: 'summon_ash_hound', warrior: 'forge_strike' },
};
