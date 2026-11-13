import { MAGE_THUNDER_EXPANSION } from './mage-thunder-expansion';
import { MAGE_THUNDER_CORE } from './mage-thunder-core';
import { UNLEASHED_HUNT } from './unleashed-hunt';
import { RANKED_CORE_CARDS } from './ranked-cards';
import { RANKED_PREMIUM_CORE_CARDS } from './ranked-premium-cards';
import { FORBIDDEN_BOND } from './forbidden-bond';
import type { CardDefinition } from '../domain/cards/card';
import { WARRIOR_CARDS } from './warrior';
import { WORLD_REWARD_CARDS } from './world-rewards';
import { TEMPLE_CHAMPION_CARDS, TEMPLE_NEUTRAL_CARDS } from './temple-rewards';
import { RITUAL_CARDS } from './summoner-rituals';
import { PRIMORDIAL_CARDS } from './primordial-dragon';
import { TACTICAL_CARDS } from './tactical-cards';
import { ARSENAL_CARDS } from './arsenal-cards';
import { SHOWCASE_STORE_CARDS } from './showcase-store-cards';
import { FREE_CATALOG_CORE_CARDS } from './free-catalog';

/**
 * Mage starter cards. Every card is pure data: targeting + effects (+ presentation hints the
 * domain never reads). Balance numbers live here only.
 */
const list: CardDefinition[] = [
  {
    id: 'magic_missile',
    name: 'Magic Missile',
    heroId: 'mage',
    cost: 1,
    category: 'ATTACK',
    tags: ['arcane', 'reliable'],
    rulesText: 'Inflige 2 de daño arcano a un enemigo a distancia 4. Requiere línea de visión.',
    targeting: { type: 'UNIT', range: 4, unitFilter: 'ENEMY', requiresLineOfSight: true },
    effects: [
      { type: 'DAMAGE', amount: 2, damageType: 'ARCANE', to: 'ENEMIES', attackKind: 'RANGED' },
    ],
    rarity: 'COMMON',
    presentation: { visualKey: 'magic_missile', element: 'ARCANE', castAnimation: 'cast_quick' },
  },
  {
    id: 'fireball',
    name: 'Fireball',
    heroId: 'mage',
    cost: 2,
    category: 'ATTACK',
    tags: ['fire', 'line', 'projectile'],
    rulesText:
      'Proyectil en línea recta (4). Inflige 3 de fuego al primer objetivo y lo deja Ardiendo 2 turnos.',
    targeting: { type: 'LINE', range: 4, pierce: false },
    effects: [
      { type: 'DAMAGE', amount: 3, damageType: 'FIRE', to: 'ENEMIES', attackKind: 'RANGED' },
      { type: 'APPLY_STATUS', status: 'BURNING', duration: 2, to: 'ENEMIES' },
    ],
    rarity: 'COMMON',
    presentation: { visualKey: 'fireball', element: 'FIRE', castAnimation: 'cast' },
  },
  {
    id: 'blink',
    name: 'Blink',
    heroId: 'mage',
    cost: 1,
    category: 'MOVEMENT',
    tags: ['teleport', 'arcane'],
    rulesText:
      'Te teletransportas a una casilla libre a distancia 3. Ignora obstáculos y enraizamiento.',
    targeting: { type: 'TILE', range: 3, minRange: 1, tileFilter: 'EMPTY' },
    effects: [{ type: 'TELEPORT_CASTER' }],
    rarity: 'COMMON',
    presentation: { visualKey: 'blink', element: 'TELEPORT', castAnimation: 'blink' },
  },
  {
    id: 'ice_wall',
    name: 'Ice Wall',
    heroId: 'mage',
    cost: 2,
    category: 'TERRAIN',
    tags: ['ice', 'obstacle'],
    rulesText:
      'Crea un muro de hielo de 3 casillas libres en horizontal o vertical durante 2 rondas. Rota antes de activar. Bloquea paso y visión.',
    targeting: {
      type: 'TILE',
      range: 3,
      minRange: 1,
      tileFilter: 'EMPTY',
      area: { shape: 'WALL', radius: 1 },
    },
    effects: [{ type: 'CREATE_OBSTACLE', obstacleId: 'ice_wall', duration: 2, on: 'AREA' }],
    rarity: 'COMMON',
    presentation: { visualKey: 'ice_wall', element: 'ICE', castAnimation: 'cast' },
  },
  {
    id: 'arcane_burst',
    name: 'Arcane Burst',
    heroId: 'mage',
    cost: 2,
    category: 'ATTACK',
    tags: ['arcane', 'area', 'cross'],
    rulesText: 'Inflige 2 de daño arcano a los enemigos en cruz (radio 1) a distancia 3.',
    targeting: { type: 'CROSS', range: 3, radius: 1 },
    effects: [{ type: 'DAMAGE', amount: 2, damageType: 'ARCANE', to: 'ENEMIES' }],
    rarity: 'COMMON',
    presentation: { visualKey: 'arcane_burst', element: 'ARCANE', castAnimation: 'cast' },
  },
  {
    id: 'barrier',
    name: 'Barrier',
    heroId: 'mage',
    cost: 1,
    category: 'DEFENSE',
    tags: ['shield'],
    rulesText: 'Otorga 4 de escudo a un aliado (o a ti) a distancia 3 hasta tu próximo turno.',
    targeting: { type: 'UNIT', range: 3, unitFilter: 'ALLY' },
    effects: [{ type: 'SHIELD', amount: 4, to: 'ALLIES' }],
    rarity: 'COMMON',
    presentation: { visualKey: 'barrier', element: 'SHIELD', castAnimation: 'cast_support' },
  },
  {
    id: 'force_push',
    name: 'Force Push',
    heroId: 'mage',
    cost: 1,
    category: 'CONTROL',
    tags: ['force', 'push', 'line'],
    rulesText:
      'Golpea al primer objetivo en línea (2): 1 de daño y lo empuja 2 casillas. Si choca, +1 de daño.',
    targeting: { type: 'LINE', range: 2, pierce: false },
    effects: [
      { type: 'DAMAGE', amount: 1, damageType: 'FORCE', to: 'ENEMIES', attackKind: 'RANGED' },
      { type: 'PUSH', distance: 2, collisionDamage: 1, to: 'ENEMIES' },
    ],
    rarity: 'COMMON',
    presentation: { visualKey: 'force_push', element: 'FORCE', castAnimation: 'cast_push' },
  },
  {
    id: 'frost_nova',
    name: 'Frost Nova',
    heroId: 'mage',
    cost: 2,
    category: 'CONTROL',
    tags: ['ice', 'area', 'root'],
    rulesText:
      'Inflige 1 de hielo a los enemigos a tu alrededor (8 casillas) y los enraíza 1 turno.',
    targeting: { type: 'SELF', area: { shape: 'SQUARE', radius: 1, includeCenter: false } },
    effects: [
      { type: 'DAMAGE', amount: 1, damageType: 'ICE', to: 'ENEMIES' },
      { type: 'APPLY_STATUS', status: 'ROOTED', duration: 1, to: 'ENEMIES' },
    ],
    rarity: 'UNCOMMON',
    presentation: { visualKey: 'frost_nova', element: 'ICE', castAnimation: 'cast_nova' },
  },
  {
    id: 'phase_step',
    name: 'Phase Step',
    heroId: 'mage',
    cost: 0,
    category: 'MOVEMENT',
    tags: ['movement'],
    rulesText: 'Ganas 2 puntos de movimiento este turno.',
    targeting: { type: 'SELF' },
    effects: [{ type: 'GAIN_MOVE_POINTS', amount: 2 }],
    rarity: 'COMMON',
    presentation: { visualKey: 'phase_step', element: 'TELEPORT', castAnimation: 'cast_quick' },
  },
  {
    id: 'flame_tile',
    name: 'Flame Tile',
    heroId: 'mage',
    cost: 1,
    category: 'TERRAIN',
    tags: ['fire', 'terrain'],
    rulesText:
      'Convierte una casilla a distancia 3 en FUEGO durante 3 rondas (2 de daño a quien termine su turno encima).',
    targeting: { type: 'TILE', range: 3, tileFilter: 'NOT_BLOCKED', requiresLineOfSight: true },
    effects: [{ type: 'CREATE_TERRAIN', terrain: 'FIRE', duration: 3, on: 'IMPACT' }],
    rarity: 'COMMON',
    presentation: { visualKey: 'flame_tile', element: 'FIRE', castAnimation: 'cast' },
  },
  {
    id: 'dispel',
    name: 'Dispel',
    heroId: 'mage',
    cost: 1,
    category: 'UTILITY',
    tags: ['cleanse'],
    rulesText:
      'Elimina los estados negativos de un aliado y el terreno peligroso (fuego/hielo) de esa casilla.',
    targeting: { type: 'TILE', range: 3, tileFilter: 'ANY' },
    effects: [
      { type: 'CLEANSE', to: 'ALLIES' },
      { type: 'REMOVE_HAZARDS', on: 'IMPACT' },
    ],
    rarity: 'UNCOMMON',
    presentation: { visualKey: 'dispel', element: 'ARCANE', castAnimation: 'cast_support' },
  },
  {
    id: 'arcane_surge',
    name: 'Arcane Surge',
    heroId: 'mage',
    cost: 1,
    category: 'UTILITY',
    tags: ['draw'],
    rulesText: 'Roba 2 cartas.',
    targeting: { type: 'SELF' },
    effects: [{ type: 'DRAW', count: 2 }],
    rarity: 'UNCOMMON',
    presentation: { visualKey: 'arcane_surge', element: 'ARCANE', castAnimation: 'cast_quick' },
  },
  // ── Phase 4C sidegrades: same primitives, a different trade-off (never same cost + more power).
  // Every one is a normal reward drop for the Mage. visualKey reuses existing art until the
  // Codex art pass (qa/store-phase4c/ART_MANIFEST.md) gives each its own key.
  {
    id: 'arcane_burst_ii',
    name: 'Arcane Burst II',
    heroId: 'mage',
    cost: 2,
    category: 'ATTACK',
    tags: ['arcane', 'area', 'square'],
    rulesText: 'Inflige 1 de daño arcano a los enemigos en un área 3×3 a distancia 2.',
    // vs Arcane Burst: 9 tiles instead of 5, but half the damage (0 through armour) and less range.
    targeting: { type: 'AREA', range: 2, radius: 1 },
    effects: [{ type: 'DAMAGE', amount: 1, damageType: 'ARCANE', to: 'ENEMIES' }],
    rarity: 'UNCOMMON',
    presentation: { visualKey: 'arcane_burst', element: 'ARCANE', castAnimation: 'cast' },
  },
  {
    id: 'glacial_field',
    name: 'Glacial Field',
    heroId: 'mage',
    cost: 1,
    category: 'TERRAIN',
    tags: ['ice', 'terrain', 'cross'],
    rulesText:
      'Cubre de HIELO una cruz (radio 1) a distancia 3 durante 2 rondas: salir de esas casillas cuesta +1 de movimiento.',
    // Slows instead of blocking (Ice Wall) and deals no damage (Flame Tile).
    targeting: { type: 'CROSS', range: 3, radius: 1 },
    effects: [{ type: 'CREATE_TERRAIN', terrain: 'ICE', duration: 2, on: 'AREA' }],
    rarity: 'COMMON',
    presentation: { visualKey: 'ice_wall', element: 'ICE', castAnimation: 'cast' },
  },
  {
    id: 'repulse',
    name: 'Repulse',
    heroId: 'mage',
    cost: 1,
    category: 'CONTROL',
    tags: ['force', 'push', 'area'],
    rulesText: 'Empuja 1 casilla a los enemigos adyacentes (en cruz). Si chocan, 1 de daño.',
    // Force Push reaches 2 tiles, deals 1 and pushes 2; Repulse only clears what is touching you.
    targeting: { type: 'SELF', area: { shape: 'CROSS', radius: 1, includeCenter: false } },
    effects: [{ type: 'PUSH', distance: 1, collisionDamage: 1, to: 'ENEMIES' }],
    rarity: 'COMMON',
    presentation: { visualKey: 'force_push', element: 'FORCE', castAnimation: 'cast_push' },
  },
  {
    id: 'blink_ii',
    name: 'Blink II',
    heroId: 'mage',
    cost: 2,
    category: 'MOVEMENT',
    tags: ['teleport', 'arcane'],
    rulesText:
      'Te teletransportas a una casilla libre a distancia 3 a 5. Ignora obstáculos y enraizamiento.',
    // Farther than Blink, but costs twice as much and cannot make short hops.
    targeting: { type: 'TILE', range: 5, minRange: 3, tileFilter: 'EMPTY' },
    effects: [{ type: 'TELEPORT_CASTER' }],
    rarity: 'UNCOMMON',
    presentation: { visualKey: 'blink', element: 'TELEPORT', castAnimation: 'blink' },
  },
  {
    id: 'glacial_shell',
    name: 'Glacial Shell',
    heroId: 'mage',
    cost: 1,
    category: 'DEFENSE',
    tags: ['ice', 'shield', 'self'],
    rulesText:
      'Ganas 6 de escudo hasta tu próximo turno, pero quedas Enraizado hasta el final de tu siguiente turno.',
    // More shield than Barrier, but self-only and it pins you (Blink/Dispel can answer the root).
    targeting: { type: 'SELF' },
    effects: [
      { type: 'SHIELD', amount: 6, to: 'CASTER' },
      { type: 'APPLY_STATUS', status: 'ROOTED', duration: 2, to: 'CASTER' },
    ],
    rarity: 'RARE',
    presentation: { visualKey: 'barrier', element: 'ICE', castAnimation: 'cast_support' },
  },
];

// Restricted support variants reuse existing primitives, without opening Mage cards to other classes.
for (const [source, id, name] of [
  ['barrier', 'summoner_ward', 'Amparo'],
  ['force_push', 'summoner_push', 'Ahuyentar'],
  ['phase_step', 'summoner_step', 'Paso ligero'],
  ['blink', 'summoner_blink', 'Salto ritual'],
  ['dispel', 'summoner_dispel', 'Purificar'],
]) {
  const base = list.find((c) => c.id === source)!;
  list.push({
    ...base,
    id: id!,
    name: name!,
    heroId: 'summoner',
    rarity: 'COMMON',
  });
}
list.push(
  {
    id: 'summon_chicken',
    name: 'Invocar Pollo',
    heroId: 'summoner',
    cost: 2,
    category: 'UTILITY',
    tags: ['summon'],
    rarity: 'COMMON',
    rulesText:
      'Invoca un Pollo (3 HP, movimiento 3, daño 1). Ocupa 1/2 capacidad. Actúa al finalizar turno desde la siguiente ronda: recoge objetos o se acerca, picotea y se retira hasta 2 pasos seguros. Permanece hasta morir o ser retirada.',
    targeting: { type: 'TILE', range: 2, tileFilter: 'EMPTY', requiresLineOfSight: true },
    effects: [{ type: 'SUMMON', summonId: 'chicken' }],
    presentation: { visualKey: 'summon_chicken', element: 'NEUTRAL' },
  },
  {
    id: 'nurture',
    name: 'Cuidar bandada',
    heroId: 'summoner',
    cost: 1,
    category: 'DEFENSE',
    tags: ['support'],
    rarity: 'COMMON',
    rulesText: 'Cura 2 HP a un aliado a distancia 3, incluido el Invocador.',
    targeting: { type: 'UNIT', range: 3, unitFilter: 'ALLY', requiresLineOfSight: true },
    effects: [{ type: 'HEAL', amount: 2, to: 'ALLIES' }],
    presentation: { visualKey: 'nurture', element: 'SHIELD' },
  },
);

// Creature rarity expresses a new deck direction; it is not a linear stat upgrade.
for (const [id, name, cost, rarity, text] of [
  [
    'fox',
    'Zorro',
    2,
    'COMMON',
    '11 HP · mueve 4 · daño 2 · capacidad 1. Busca flancos con menos enemigos adyacentes.',
  ],
  [
    'turtle',
    'Tortuga',
    2,
    'UNCOMMON',
    '16 HP · armadura 1 · mueve 1 · daño 2 · capacidad 1. Mantiene posición; solo se acerca a enemigos a 3 casillas.',
  ],
  [
    'raven',
    'Cuervo',
    2,
    'UNCOMMON',
    '8 HP · mueve 3 · daño arcano 1 · alcance 3 con visión · capacidad 1. Tras atacar purifica un aliado cercano.',
  ],
  [
    'wolf',
    'Lobo',
    3,
    'RARE',
    '14 HP · mueve 2 · daño 3 · capacidad 2. Persigue enemigos; ocupa toda tu capacidad.',
  ],
] as const) {
  list.push({
    id: `summon_${id}`,
    name: `Invocar ${name}`,
    heroId: 'summoner',
    cost,
    rarity,
    category: 'UTILITY',
    tags: ['summon', id === 'turtle' ? 'defense' : id === 'raven' ? 'utility' : 'pressure'],
    rulesText: `${text} Actúa desde la siguiente ronda. Permanece hasta morir o ser retirada.`,
    targeting: { type: 'TILE', range: 2, tileFilter: 'EMPTY', requiresLineOfSight: true },
    effects: [{ type: 'SUMMON', summonId: id }],
    presentation: { visualKey: `summon_${id}`, element: 'ARCANE' },
  });
}
list.push(
  {
    id: 'familiar_aegis',
    name: 'Pacto protector',
    heroId: 'summoner',
    cost: 1,
    rarity: 'UNCOMMON',
    category: 'DEFENSE',
    tags: ['support', 'defense'],
    rulesText:
      'Da 3 de escudo a una invocación a distancia 3. Hasta el inicio de tu siguiente turno.',
    targeting: { type: 'UNIT', range: 3, unitFilter: 'SUMMON', requiresLineOfSight: true },
    effects: [{ type: 'SHIELD', amount: 3, to: 'SUMMONS' }],
    presentation: { visualKey: 'barrier', element: 'SHIELD' },
  },
  {
    id: 'recall_familiar',
    name: 'Retorno ritual',
    heroId: 'summoner',
    cost: 0,
    rarity: 'UNCOMMON',
    category: 'UTILITY',
    tags: ['support', 'draw'],
    rulesText:
      'Retira una invocación a distancia 3: libera capacidad, gana 1 energía y roba 1 carta. No reinvoca ni renueva su duración.',
    targeting: { type: 'UNIT', range: 3, unitFilter: 'SUMMON', requiresLineOfSight: true },
    effects: [
      { type: 'RECALL_SUMMON' },
      { type: 'GAIN_ENERGY', amount: 1 },
      { type: 'DRAW', count: 1 },
    ],
    presentation: { visualKey: 'dispel', element: 'ARCANE' },
  },
  // ── Phase 4C Summoner support/control. Same primitives; each trades reach, target or
  // payoff against an existing card instead of out-scaling it. Normal skirmish drops.
  {
    id: 'pack_hymn',
    name: 'Canto de la manada',
    heroId: 'summoner',
    cost: 1,
    rarity: 'UNCOMMON',
    category: 'DEFENSE',
    tags: ['support', 'summon-synergy'],
    rulesText: 'Tus invocaciones a 2 casillas o menos de ti se curan 1 HP y ganan 1 de escudo.',
    // vs Cuidar bandada (2 HP to any ally at range 3): spread thin, summons only, must stay close.
    targeting: { type: 'SELF', area: { shape: 'SQUARE', radius: 2, includeCenter: false } },
    effects: [
      { type: 'HEAL', amount: 1, to: 'SUMMONS' },
      { type: 'SHIELD', amount: 1, to: 'SUMMONS' },
    ],
    presentation: { visualKey: 'nurture', element: 'SHIELD' },
  },
  {
    id: 'spur_familiar',
    name: 'Azuzar',
    heroId: 'summoner',
    cost: 0,
    rarity: 'COMMON',
    category: 'MOVEMENT',
    tags: ['summon-command', 'push'],
    rulesText:
      'Empuja una invocación tuya a distancia 2 hasta 2 casillas, alejándola de ti. No causa daño.',
    // Repositioning only: no damage, no extra action; the summon still acts on its own.
    targeting: { type: 'UNIT', range: 2, unitFilter: 'SUMMON', requiresLineOfSight: true },
    effects: [{ type: 'PUSH', distance: 2, collisionDamage: 0, to: 'SUMMONS' }],
    presentation: { visualKey: 'force_push', element: 'FORCE' },
  },
  {
    id: 'vital_offering',
    name: 'Ofrenda vital',
    heroId: 'summoner',
    cost: 0,
    rarity: 'UNCOMMON',
    category: 'DEFENSE',
    tags: ['support', 'sacrifice'],
    rulesText: 'Retira una invocación tuya a distancia 3: libera capacidad y te curas 3 HP.',
    // Retorno ritual's defensive twin: healing instead of energy + a card.
    targeting: { type: 'UNIT', range: 3, unitFilter: 'SUMMON', requiresLineOfSight: true },
    effects: [
      { type: 'RECALL_SUMMON' },
      { type: 'HEAL', amount: 3, to: 'CASTER' },
    ],
    presentation: { visualKey: 'dispel', element: 'ARCANE' },
  },
  {
    id: 'entangle',
    name: 'Enredadera',
    heroId: 'summoner',
    cost: 1,
    rarity: 'COMMON',
    category: 'CONTROL',
    tags: ['control', 'root'],
    rulesText: 'Enraíza 1 turno a un enemigo a distancia 3 con línea de visión. No causa daño.',
    // Single target and no damage, where Frost Nova hits every adjacent enemy.
    targeting: { type: 'UNIT', range: 3, unitFilter: 'ENEMY', requiresLineOfSight: true },
    effects: [{ type: 'APPLY_STATUS', status: 'ROOTED', duration: 1, to: 'ENEMIES' }],
    presentation: { visualKey: 'nurture', element: 'NEUTRAL' },
  },
);

list.push(UNLEASHED_HUNT);
list.push(...RANKED_CORE_CARDS);
list.push(...RANKED_PREMIUM_CORE_CARDS);
list.push(FORBIDDEN_BOND);
list.push(...WARRIOR_CARDS);
list.push(...RITUAL_CARDS);
list.push(...PRIMORDIAL_CARDS);
list.push(...WORLD_REWARD_CARDS);
list.push(...TEMPLE_NEUTRAL_CARDS, ...TEMPLE_CHAMPION_CARDS);
list.push(...TACTICAL_CARDS);
list.push(...ARSENAL_CARDS);
list.push(...SHOWCASE_STORE_CARDS);
list.push(...FREE_CATALOG_CORE_CARDS);
list.push(...MAGE_THUNDER_CORE, ...MAGE_THUNDER_EXPANSION);

list.push({
  id: 'pack_tracking', name: 'Rastreo de la Manada', heroId: 'summoner', cost: 1,
  rarity: 'COMMON', category: 'UTILITY', tags: ['search','summon-synergy'],
  deckSearch: 'SUMMON',
  rulesText: 'Busca una carta de invocación en tu mazo y agrégala a tu mano. No puedes jugar la carta obtenida durante este turno.',
  targeting: {type:'SELF'}, effects: [], presentation: {visualKey:'pack_call',element:'ARCANE'},
});

export const CARDS: Readonly<Record<string, CardDefinition>> = Object.fromEntries(
  list.map((c) => [c.id, c]),
);
