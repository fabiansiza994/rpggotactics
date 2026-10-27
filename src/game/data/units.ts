import type { EnemyDef, HeroDef, StructureDef, SummonDef } from '../domain/content';
import { INFERNAL_ENEMIES } from './infernal';
import { TEMPLE_ENEMIES } from './temple';
import { HAND_RULES } from './rules';
import { RITUAL_SUMMONS } from './summoner-rituals';
import { PRIMORDIAL_SUMMONS } from './primordial-dragon';
import { WORLD_REWARD_SUMMONS } from './world-rewards';
import { FREE_CATALOG_SUMMONS } from './free-catalog';

export const SUMMONS: Readonly<Record<string, SummonDef>> = {
  chicken: {
    id: 'chicken',
    behavior: 'SCOUT',
    retreatSteps: 2,
    name: 'Pollo',
    maxHp: 3,
    armor: 0,
    moveRange: 3,
    damage: 1,
    capacityCost: 1,
    visualKey: 'chicken',
  },
  fox: {
    id: 'fox',
    name: 'Zorro',
    behavior: 'SKIRMISHER',
    maxHp: 11,
    armor: 0,
    moveRange: 4,
    damage: 2,
    capacityCost: 1,
    visualKey: 'fox',
  },
  turtle: {
    id: 'turtle',
    name: 'Tortuga',
    behavior: 'GUARD',
    maxHp: 16,
    armor: 1,
    moveRange: 1,
    damage: 2,
    capacityCost: 1,
    visualKey: 'turtle',
  },
  raven: {
    id: 'raven',
    name: 'Cuervo',
    behavior: 'RANGED',
    attackRange: 3,
    maxHp: 8,
    armor: 0,
    moveRange: 3,
    damage: 1,
    capacityCost: 1,
    visualKey: 'raven',
  },
  wolf: {
    id: 'wolf',
    name: 'Lobo',
    behavior: 'PRESSURE',
    maxHp: 14,
    armor: 0,
    moveRange: 2,
    damage: 3,
    capacityCost: 2,
    visualKey: 'wolf',
  },
  ...RITUAL_SUMMONS,
  ...PRIMORDIAL_SUMMONS,
  ...WORLD_REWARD_SUMMONS,
  ...FREE_CATALOG_SUMMONS,
};

export const HEROES: Readonly<Record<string, HeroDef>> = {
  summoner: {
    id: 'summoner',
    name: 'Invocador',
    maxHp: 18,
    maxEnergy: 4,
    movePoints: 3,
    // Same hand rule as every champion (was a special 4/4 hand). HAND_RULES in data/rules.ts.
    startingHandSize: HAND_RULES.handSize,
    drawPerTurn: 1,
    handSize: HAND_RULES.handSize,
    maxHandSize: HAND_RULES.turnHandCap,
    summonCapacity: 2,
    // Available in the Deck Builder by default, NOT in the 30-card starter deck (2026-10-15).
    starterCollection: [{ cardId: 'pack_tracking', count: 3 }],
    // Rituals are assembled on the altar (four pieces never had to wait in the hand).
    altarSlots: 4,
    // First seal of the turn is free, each further one costs 1 energy (no "one per turn" wait).
    altarSealing: { freePerTurn: 1, extraEnergy: 1 },
    visualKey: 'summoner',
    // 30 cards (exactly, DECK_RULES): the 20-card core at full copies + Salto ritual, then
    // Enredadera 2, Tortuga 1, Cuervo 1, Égida 1 and Himno 1 (summons and familiar support). A
    // starter never holds a store card at its copy cap, so each of those is still earned/bought.
    // Ritual pieces and the Lobo stay rewards. Comparison: qa/deck-size-30.
    deck: [
      { cardId: 'summon_chicken', count: 3 },
      { cardId: 'nurture', count: 3 },
      { cardId: 'summoner_ward', count: 3 },
      { cardId: 'summoner_push', count: 3 },
      { cardId: 'summoner_step', count: 3 },
      { cardId: 'summon_fox', count: 3 },
      { cardId: 'summoner_dispel', count: 3 },
      { cardId: 'summoner_blink', count: 3 },
      { cardId: 'entangle', count: 2 },
      { cardId: 'summon_turtle', count: 1 },
      { cardId: 'summon_raven', count: 1 },
      { cardId: 'familiar_aegis', count: 1 },
      { cardId: 'pack_hymn', count: 1 },
    ],
  },
  mage: {
    id: 'mage',
    name: 'Mago',
    maxHp: 20,
    maxEnergy: 5,
    movePoints: 3,
    startingHandSize: HAND_RULES.handSize,
    drawPerTurn: 1,
    handSize: HAND_RULES.handSize,
    maxHandSize: HAND_RULES.turnHandCap,
    // 30 cards (exactly, DECK_RULES), commons only: the 20-card core identity at full copies
    // plus 2 each of Repulse (control), Glacial Field and Flame Tile (terrain). Each added card
    // keeps a copy to earn or buy (never a store card at cap); Frost Nova, Dispel, Arcane Surge
    // and the uncommon/rare upgrades are still earned (qa/deck-size-30 for the comparison).
    deck: [
      { cardId: 'magic_missile', count: 3 },
      { cardId: 'fireball', count: 3 },
      { cardId: 'arcane_burst', count: 3 },
      { cardId: 'blink', count: 3 },
      { cardId: 'barrier', count: 3 },
      { cardId: 'force_push', count: 3 },
      { cardId: 'ice_wall', count: 3 },
      { cardId: 'phase_step', count: 3 },
      { cardId: 'repulse', count: 2 },
      { cardId: 'glacial_field', count: 2 },
      { cardId: 'flame_tile', count: 2 },
    ],
    visualKey: 'hero_mage',
  },
  /**
   * Close-range champion: more HP than the Mage (24 vs 20) but one less energy and no reach;
   * Guard (shield) cards and Momentum carry the survivability. No base armour on purpose: a
   * flat −1 would erase 1-damage summons and halve the Mage's 2-damage staples.
   */
  warrior: {
    id: 'warrior',
    name: 'Guerrero',
    maxHp: 24,
    maxEnergy: 4,
    movePoints: 3,
    startingHandSize: HAND_RULES.handSize,
    drawPerTurn: 1,
    handSize: HAND_RULES.handSize,
    maxHandSize: HAND_RULES.turnHandCap,
    momentum: { max: 3 },
    // 11 starter cards, 30 copies (exactly, DECK_RULES): the 8-card core at full copies +
    // Barrido 3 (area hit), Muro de acero 1 and Imparable 2. None is a store card (Agarre, Embestida
    // and Ejecución are sold, and earned). Still earned: grapple, the 2nd Muro de acero, bastion,
    // ram, vanguard_fury and execution (data/warrior.ts). Comparison: qa/deck-size-30.
    deck: [
      { cardId: 'heavy_strike', count: 3 },
      { cardId: 'shield_bash', count: 3 },
      { cardId: 'warrior_charge', count: 3 },
      { cardId: 'guard', count: 3 },
      { cardId: 'riposte', count: 3 },
      { cardId: 'second_wind', count: 3 },
      { cardId: 'brutal_shove', count: 3 },
      { cardId: 'steady_advance', count: 3 },
      { cardId: 'sweep', count: 3 },
      { cardId: 'steel_wall', count: 1 },
      { cardId: 'unstoppable', count: 2 },
    ],
    visualKey: 'hero_warrior',
  },
};

export const ENEMIES: Readonly<Record<string, EnemyDef>> = {
  orc_warrior: {
    id: 'orc_warrior',
    role: 'FRONTLINER',
    rank: 'NORMAL',
    name: 'Orco Guerrero',
    maxHp: 8,
    armor: 0,
    moveRange: 3,
    behavior: { type: 'MELEE', damage: 3, damageType: 'PHYSICAL' },
    visualKey: 'enemy_orc_warrior',
  },
  shadow_wolf: {
    id: 'shadow_wolf',
    role: 'DIVER',
    rank: 'NORMAL',
    name: 'Lobo Sombrío',
    maxHp: 6,
    armor: 0,
    moveRange: 3,
    behavior: { type: 'CHARGE', damage: 4, damageType: 'PHYSICAL', range: 4 },
    visualKey: 'enemy_shadow_wolf',
  },
  dark_shaman: {
    id: 'dark_shaman',
    role: 'RANGED',
    rank: 'NORMAL',
    name: 'Chamán Oscuro',
    maxHp: 6,
    armor: 0,
    moveRange: 2,
    behavior: {
      type: 'AREA_CASTER',
      damage: 3,
      damageType: 'ARCANE',
      castRange: 4,
      area: { shape: 'CROSS', radius: 1 },
    },
    visualKey: 'enemy_dark_shaman',
  },
  stone_brute: {
    id: 'stone_brute',
    role: 'TANK',
    rank: 'NORMAL',
    name: 'Bruto de Piedra',
    maxHp: 8,
    armor: 1,
    moveRange: 1,
    behavior: { type: 'MELEE', damage: 4, damageType: 'PHYSICAL' },
    visualKey: 'enemy_stone_brute',
  },
  // ── Elites / bosses: same art family, a different tactical problem (not just more HP) ──
  /** Charge lane of 6: on a 9-wide board it threatens a whole row from the far side. */
  wolf_alpha: {
    id: 'wolf_alpha',
    name: 'Alfa Sombrío',
    role: 'DIVER',
    rank: 'ELITE',
    maxHp: 10,
    armor: 0,
    moveRange: 4,
    behavior: { type: 'CHARGE', damage: 5, damageType: 'PHYSICAL', range: 6 },
    visualKey: 'enemy_shadow_wolf',
  },
  /** 3×3 blast from range 5: one step no longer dodges it; the hero must commit or close in. */
  shaman_elder: {
    id: 'shaman_elder',
    name: 'Chamán Anciano',
    role: 'RANGED',
    rank: 'ELITE',
    maxHp: 10,
    armor: 0,
    moveRange: 2,
    behavior: {
      type: 'AREA_CASTER',
      damage: 3,
      damageType: 'ARCANE',
      castRange: 5,
      area: { shape: 'SQUARE', radius: 1, includeCenter: true },
    },
    visualKey: 'enemy_dark_shaman',
  },
  /**
   * Hits for 6 but moves 2: a fight about spacing and kiting. Armour 1 halves the 2-damage
   * staples, so Fireball, terrain and push collisions carry the damage.
   */
  stone_colossus: {
    id: 'stone_colossus',
    name: 'Coloso de Piedra',
    role: 'TANK',
    rank: 'BOSS',
    maxHp: 16,
    armor: 1,
    moveRange: 2,
    behavior: { type: 'MELEE', damage: 6, damageType: 'PHYSICAL' },
    visualKey: 'enemy_stone_brute',
  },
  // World 2 «Reino Infernal» family (data/infernal.ts).
  ...INFERNAL_ENEMIES,
  // Act III «El Templo del Umbral» (data/temple.ts): only temple encounters use them.
  ...TEMPLE_ENEMIES,
};

export const STRUCTURES: Readonly<Record<string, StructureDef>> = {
  crystal: { id: 'crystal', name: 'Cristal', maxHp: 10, armor: 0, visualKey: 'objective_crystal' },
};
