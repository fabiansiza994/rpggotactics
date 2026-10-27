import type { CardDefinition, EffectDef, TargetingDef } from '../domain/cards/card';
import type { EnemyDef } from '../domain/content';

/**
 * «Sendero del Cazador» (Archer campaign, Act I) — content only: the campaign's reward cards and
 * the Veil enemy family. Registered with the Archer by `withArcher` (never in DEFAULT_CONTENT).
 *
 * Why new cards: the Archer's starter collection already owns every `archer_core` card at its
 * copy limit, so an existing card can never be offered as a reward. These cards use only existing
 * primitives (no new rules) and are exclusive (`acquisition`): earned only from their encounter
 * (`EncounterDef.rewards.cards`) or, Ojo del Depredador, from completing the act. Never dropped,
 * sold, gifted or redeemed; once owned they are ordinary cards (campaign, skirmish, PvP).
 * Art: provisional visualKeys of the existing Archer presentation (handoff: qa/archer-campaign).
 */
export const ARCHER_HUNT_WORLD_ID = 'archer_act_1';
export const ARCHER_HUNT_CAMPAIGN_ID = 'archer_hunt';
export const ARCHER_HUNT_EXPANSION = 'archer_hunt';

const ENCOUNTER = { source: 'ENCOUNTER_REWARD', worldId: ARCHER_HUNT_WORLD_ID } as const;
const COMPLETION = { source: 'WORLD_COMPLETION', worldId: ARCHER_HUNT_WORLD_ID } as const;

const SHOT = (range: number, minRange?: number): TargetingDef => ({
  type: 'UNIT',
  range,
  ...(minRange ? { minRange } : {}),
  unitFilter: 'ENEMY',
  requiresLineOfSight: true,
});
const arrow = (amount: number, extra: Partial<Extract<EffectDef, { type: 'DAMAGE' }>> = {}): EffectDef => ({
  type: 'DAMAGE',
  amount,
  damageType: 'PHYSICAL',
  to: 'ENEMIES',
  attackKind: 'RANGED',
  ...extra,
});
const MARK: EffectDef = { type: 'APPLY_STATUS', status: 'PREY', duration: 1, to: 'ENEMIES' };
const card = (def: Omit<CardDefinition, 'heroId' | 'expansion' | 'acquisition'>, acquisition: CardDefinition['acquisition'] = ENCOUNTER): CardDefinition => ({
  ...def,
  heroId: 'archer',
  expansion: ARCHER_HUNT_EXPANSION,
  acquisition,
});

/**
 * In reward order (encounter I → IX), then the act completion card. The five Flechas Especiales
 * (Hielo III, Ígnea VI, Humo VII, Venenosa VIII, Rebote IX) are deterministic utility arrows: physical
 * ranged shots that need no Presa or Concentración; their statuses are SLOWED / BURNING /
 * POISONED (data/rules.ts) and the rebound is `DAMAGE.rebound` (domain/combat/rebound.ts).
 */
export const ARCHER_HUNT_CARDS: CardDefinition[] = [
  // I · Presa: marking can pay for itself.
  card({
    id: 'fresh_trail',
    name: 'Rastro Fresco',
    cost: 1,
    category: 'UTILITY',
    tags: ['prey', 'mark', 'focus-builder', 'campaign-reward'],
    rarity: 'COMMON',
    rulesText: 'Marca a un enemigo a distancia 6 con línea de visión como tu Presa. Si está a Distancia Óptima (3–4), ganas 1 Concentración.',
    targeting: SHOT(6),
    effects: [MARK, { type: 'GAIN_FOCUS', amount: 1, when: [{ type: 'PREY_IN_OPTIMAL_RANGE' }] }],
    presentation: { visualKey: 'hunters_eye', element: 'NEUTRAL', castAnimation: 'ability' },
  }),
  // II · Movilidad: reach, nothing else.
  card({
    id: 'branch_leap',
    name: 'Salto entre Ramas',
    cost: 1,
    category: 'MOVEMENT',
    tags: ['movement', 'campaign-reward'],
    rarity: 'COMMON',
    rulesText: 'Caminas hasta 3 casillas sin gastar movimiento.',
    targeting: { type: 'STEP', range: 3 },
    effects: [{ type: 'STEP_CASTER' }],
    presentation: { visualKey: 'stalker_step', element: 'NEUTRAL', castAnimation: 'ability' },
  }),
  // III · Flecha de Hielo (control / tempo): a slow, not a lock.
  card({
    id: 'ice_arrow',
    name: 'Flecha de Hielo',
    cost: 2,
    category: 'ATTACK',
    tags: ['arrow', 'special-arrow', 'ice', 'control', 'campaign-reward'],
    rarity: 'UNCOMMON',
    rulesText: 'Inflige 2 de daño físico a distancia (4) y deja al objetivo Ralentizado 2 turnos: camina 2 casillas menos (mínimo 1). No impide atacar.',
    targeting: SHOT(4),
    effects: [arrow(2), { type: 'APPLY_STATUS', status: 'SLOWED', duration: 2, to: 'ENEMIES' }],
    presentation: { visualKey: 'archer_arrow', element: 'ICE', castAnimation: 'attack' },
  }),
  // IV · Trampas: farther and harder than Zarzas, but short-lived.
  card({
    id: 'hunters_snare',
    name: 'Lazo del Cazador',
    cost: 1,
    category: 'TERRAIN',
    tags: ['trap', 'root', 'control', 'campaign-reward'],
    rarity: 'COMMON',
    rulesText: 'Coloca una trampa visible en una casilla libre a distancia 5 (dura 2 rondas). El primer enemigo que entre se detiene, recibe 2 de daño y queda Enraizado.',
    targeting: { type: 'TILE', range: 5, minRange: 1, tileFilter: 'EMPTY' },
    effects: [{ type: 'PLACE_TRAP', trapId: 'bramble', damage: 2, rounds: 2 }],
    presentation: { visualKey: 'bramble_trap', element: 'NEUTRAL', castAnimation: 'ability' },
  }),
  // V · Elite reward (rare): the answer to divers like El Acechador.
  card({
    id: 'pinning_arrow',
    name: 'Flecha Clavadora',
    cost: 2,
    category: 'ATTACK',
    tags: ['arrow', 'root', 'control', 'campaign-reward'],
    rarity: 'RARE',
    rulesText: 'Inflige 2 de daño físico a distancia (4) y deja al objetivo Enraizado: no podrá moverse en su próximo turno.',
    targeting: SHOT(4),
    effects: [arrow(2), { type: 'APPLY_STATUS', status: 'ROOTED', duration: 1, to: 'ENEMIES' }],
    presentation: { visualKey: 'archer_arrow', element: 'NEUTRAL', castAnimation: 'attack' },
  }),
  // VI · Flecha Ígnea (pressure): the existing Ardiendo, refreshed, never stacked.
  card({
    id: 'fire_arrow',
    name: 'Flecha Ígnea',
    cost: 2,
    category: 'ATTACK',
    tags: ['arrow', 'special-arrow', 'fire', 'burn', 'campaign-reward'],
    rarity: 'UNCOMMON',
    rulesText: 'Inflige 2 de daño físico a distancia (4) y deja al objetivo Ardiendo 2 turnos: 1 de fuego al inicio de cada uno de sus turnos. Re-aplicarla renueva la duración, no la acumula.',
    targeting: SHOT(4),
    effects: [arrow(2), { type: 'APPLY_STATUS', status: 'BURNING', duration: 2, to: 'ENEMIES' }],
    presentation: { visualKey: 'archer_arrow', element: 'FIRE', castAnimation: 'attack' },
  }),
  // VII · Flecha de Humo (space / vision): a temporary 3×3 cloud (terrain SMOKE, data/rules.ts)
  // that blocks line of sight through it for BOTH sides and costs +1 move to step out of, once.
  // Light 1 damage only on the impact tile; the cloud never covers fire, ice, lava, cover or exits.
  card({
    id: 'smoke_arrow',
    name: 'Flecha de Humo',
    cost: 2,
    category: 'TERRAIN',
    tags: ['arrow', 'special-arrow', 'smoke', 'control', 'vision', 'campaign-reward'],
    rarity: 'UNCOMMON',
    rulesText:
      'Dispara a una casilla a distancia 4 con visión: 1 de daño físico al enemigo que esté en ella y una nube de Humo 3×3 durante 2 rondas. El Humo bloquea la línea de visión a través de él (para ambos bandos) y salir de la nube cuesta 1 movimiento extra. Volver a disparar renueva la duración.',
    targeting: { type: 'TILE', range: 4, minRange: 1, tileFilter: 'NOT_BLOCKED', requiresLineOfSight: true, area: { shape: 'SQUARE', radius: 1, includeCenter: true } },
    effects: [
      arrow(1, { impactOnly: true }),
      { type: 'CREATE_TERRAIN', terrain: 'SMOKE', duration: 2, on: 'AREA', replaceOnly: ['NORMAL', 'SMOKE'] },
    ],
    presentation: { visualKey: 'archer_arrow', element: 'NEUTRAL', castAnimation: 'attack' },
  }),
  // VIII · Flecha Venenosa (attrition): longer than Ardiendo, through armour.
  card({
    id: 'poison_arrow',
    name: 'Flecha Venenosa',
    cost: 2,
    category: 'ATTACK',
    tags: ['arrow', 'special-arrow', 'poison', 'campaign-reward'],
    rarity: 'UNCOMMON',
    rulesText: 'Inflige 1 de daño físico a distancia (4) y deja al objetivo Envenenado 3 turnos: 1 de daño al inicio de cada uno de sus turnos, ignorando la armadura. Re-aplicarla renueva la duración, no la acumula.',
    targeting: SHOT(4),
    effects: [arrow(1), { type: 'APPLY_STATUS', status: 'POISONED', duration: 3, to: 'ENEMIES' }],
    presentation: { visualKey: 'archer_arrow', element: 'NEUTRAL', castAnimation: 'attack' },
  }),
  // IX · Elite reward (rare). Flecha de Rebote: punishes grouped enemies; the chain is public.
  card({
    id: 'rebound_arrow',
    name: 'Flecha de Rebote',
    cost: 2,
    category: 'ATTACK',
    tags: ['arrow', 'special-arrow', 'rebound', 'multi-target', 'campaign-reward'],
    rarity: 'RARE',
    rulesText: 'Inflige 2 de daño físico a distancia (4). Luego rebota hasta 2 veces: 1 de daño a un enemigo distinto adyacente al último golpeado (nunca aliados ni el mismo enemigo). El recorrido se ve antes de disparar.',
    targeting: SHOT(4),
    effects: [arrow(2, { rebound: { bounces: 2, amount: 1 } })],
    presentation: { visualKey: 'archer_arrow', element: 'NEUTRAL', castAnimation: 'attack' },
  }),
  // X · Act completion (rare, Showcase candidate): fast Concentración for Tiro al Corazón.
  card(
    {
      id: 'predator_eye',
      name: 'Ojo del Depredador',
      cost: 1,
      category: 'UTILITY',
      tags: ['prey', 'mark', 'focus-builder', 'signature', 'world-reward'],
      rarity: 'RARE',
      rulesText: 'Marca a un enemigo a distancia 6 con línea de visión como tu Presa y ganas 1 Concentración (2 si está a Distancia Óptima, 3–4).',
      targeting: SHOT(6),
      effects: [MARK, { type: 'GAIN_FOCUS', amount: 1 }, { type: 'GAIN_FOCUS', amount: 1, when: [{ type: 'PREY_IN_OPTIMAL_RANGE' }] }],
      presentation: { visualKey: 'hunters_eye', element: 'NEUTRAL', castAnimation: 'ability' },
    },
    COMPLETION,
  ),
];

/**
 * The Veil family (elites + boss). Behaviour primitives only; their art borrows existing enemies
 * until Codex paints them (UNIT_VISUAL_ALIAS in the presentation layer).
 *
 * - El Acechador:      fast diver (4 MP) that walks straight into melee: it breaks Distancia
 *                      Óptima every turn. Traps, roots and retreats are the answer.
 * - Guardián del Velo: slow caster whose blast is locked on the Archer's tile and SHOVES whoever it
 *                      hits: standing still is punished. Below half HP its blast grows to 3×3.
 *                      Fragile in the open (no armour) for an Archer at 3–4.
 * - La Bestia del Velo: boss, 4 MP. Phase 1 pounces along open lanes (pillars, units and traps
 *                      break them). Phase 2 (≤50% HP, «Frenesí»): stops pouncing and hunts the
 *                      Archer in melee, throwing it back a tile: roots, traps and blockers matter.
 */
export const VEIL_ENEMIES: Readonly<Record<string, EnemyDef>> = {
  veil_stalker: {
    id: 'veil_stalker',
    name: 'El Acechador',
    role: 'DIVER',
    rank: 'ELITE',
    maxHp: 14,
    armor: 0,
    moveRange: 4,
    behavior: { type: 'MELEE', damage: 4, damageType: 'PHYSICAL' },
    visualKey: 'enemy_veil_stalker',
  },
  veil_guardian: {
    id: 'veil_guardian',
    name: 'Guardián del Velo',
    role: 'RANGED',
    rank: 'ELITE',
    maxHp: 14,
    armor: 0,
    moveRange: 2,
    behavior: {
      type: 'AREA_CASTER',
      damage: 3,
      damageType: 'ARCANE',
      castRange: 5,
      area: { shape: 'CROSS', radius: 1, includeCenter: true },
      onHit: { push: { distance: 1, collisionDamage: 1 } },
    },
    phases: [
      {
        belowHpPct: 50,
        name: 'Velo desgarrado',
        behavior: {
          type: 'AREA_CASTER',
          damage: 3,
          damageType: 'ARCANE',
          castRange: 5,
          area: { shape: 'SQUARE', radius: 1, includeCenter: true },
          onHit: { push: { distance: 1, collisionDamage: 1 } },
        },
      },
    ],
    visualKey: 'enemy_veil_guardian',
  },
  veil_beast: {
    id: 'veil_beast',
    name: 'La Bestia del Velo',
    role: 'DIVER',
    rank: 'BOSS',
    maxHp: 24,
    armor: 0,
    moveRange: 4,
    behavior: { type: 'CHARGE', damage: 5, damageType: 'PHYSICAL', range: 5 },
    phases: [
      {
        belowHpPct: 50,
        name: 'Frenesí',
        // Stops pouncing along lanes and hunts the Archer down (a melee intent follows its target).
        behavior: { type: 'MELEE', damage: 5, damageType: 'PHYSICAL', onHit: { push: { distance: 1, collisionDamage: 1 } } },
      },
    ],
    visualKey: 'enemy_veil_beast',
  },
};
