import type { DeckRules } from '../collection/deck-rules';
import type { ObstacleDef } from '../domain/entities/obstacle';
import type { StatusDef, StatusId } from '../domain/statuses/status';
import type { TerrainDef, TerrainType } from '../domain/terrain/terrain';
import { FREE_CATALOG_STATUSES } from './free-catalog';
import { RANKED_PREMIUM_STATUSES } from './ranked-premium-cards';

/** 02_MVP_RULES §10: each status declares duration handling, tick timing and stacking. */
export const STATUSES: Readonly<Record<StatusId, StatusDef>> = {
  BURNING: {
    id: 'BURNING',
    name: 'Ardiendo',
    negative: true,
    tick: 'TURN_START',
    tickDamage: 1,
    tickDamageType: 'FIRE',
    stacking: 'REFRESH',
  },
  ROOTED: {
    id: 'ROOTED',
    name: 'Enraizado',
    negative: true,
    tick: 'NEVER',
    stacking: 'REFRESH',
    preventsMovement: true,
  },
  STUNNED: {
    id: 'STUNNED',
    name: 'Aturdido',
    negative: true,
    tick: 'NEVER',
    stacking: 'IGNORE',
    preventsActions: true,
  },
  RIPOSTE: {
    id: 'RIPOSTE',
    name: 'Contraataque',
    negative: false,
    tick: 'NEVER',
    stacking: 'REFRESH',
    counterDamage: 3,
    expiresAtOwnerTurnStart: true,
  },
  /** Manada Ancestral (support card): summons hit harder in their owner's turn(s). */
  PACK_FURY: {
    id: 'PACK_FURY',
    name: 'Furia de la manada',
    negative: false,
    tick: 'NEVER',
    stacking: 'REFRESH',
    summonDamageBonus: 2,
  },
  /**
   * Marcar Presa (Summoner, 3 turns): the caster's summons attack this unit when they can reach it
   * this activation, otherwise walk toward it along a safe route (summons.preyPursuit); with no such
   * route (or a higher rule: taunt, held plate/objective) they keep their normal behaviour. Public (both seats
   * see it). Negative, so a cleanse removes it. Ends on death, expiry, a new mark, battle end.
   */
  MARKED_PREY: {
    id: 'MARKED_PREY',
    name: 'Presa marcada',
    negative: true,
    tick: 'NEVER',
    stacking: 'REFRESH',
    preyMark: true,
  },
  /**
   * Presa (Archer, Ojo del Cazador): ONE per Archer (sourced: a new mark moves it). Never counts
   * down: it ends when the Archer marks another unit, the unit dies, or a cleanse removes it
   * (negative). Public: both seats see the mark and who owns it (`sourceId`).
   */
  PREY: {
    id: 'PREY',
    name: 'Presa',
    negative: true,
    tick: 'NEVER',
    stacking: 'REFRESH',
    preyMark: true,
    permanent: true,
  },
  // ── «Arsenal I» (data/arsenal-cards.ts). Every one lasts one turn of its owner and is public.
  /** Sello de Silencio: weaker attacks (never below 1) and no push / burn / scorch rider. */
  SEALED: {
    id: 'SEALED',
    name: 'Sellado',
    negative: true,
    tick: 'NEVER',
    stacking: 'REFRESH',
    outgoingDamageReduction: 2,
    suppressesHitRiders: true,
  },
  /** Desafío: goes after the Warrior who challenged it; hits anyone else for 2 less (min 1). */
  CHALLENGED: {
    id: 'CHALLENGED',
    name: 'Desafiado',
    negative: true,
    tick: 'NEVER',
    stacking: 'REFRESH',
    taunt: true,
    tauntPenalty: 2,
  },
  /** Bomba de Humo: hostile attacks deal 1 less until the start of the owner's next turn. */
  SMOKE_SCREEN: {
    id: 'SMOKE_SCREEN',
    name: 'Humo',
    negative: false,
    tick: 'NEVER',
    stacking: 'REFRESH',
    incomingDamageReduction: 1,
    expiresAtOwnerTurnStart: true,
  },
  /** Llamado de la Manada: +1 move range on the summon's next automatic action. */
  UNLEASHED_HUNT: {id:'UNLEASHED_HUNT',name:'Cacería Desatada',negative:false,tick:'NEVER',stacking:'REFRESH',summonMoveBonus:2,summonActivationClock:true},
  HUNT_PURSUIT: {id:'HUNT_PURSUIT',name:'Persecución preparada',negative:false,tick:'NEVER',stacking:'REFRESH',summonMoveBonus:1,summonActivationClock:true},
  /** Paciencia del Muro (Ranked): the first landed hit per turn from a non-adjacent enemy gives +1 extra Impulso. */
  WALL_PATIENCE: {
    id: 'WALL_PATIENCE',
    name: 'Paciencia del Muro',
    negative: false,
    tick: 'NEVER',
    stacking: 'REFRESH',
    expiresAtOwnerTurnStart: true,
    distantHitMomentum: 1,
  },
  PACK_CALL: {
    id: 'PACK_CALL',
    name: 'Llamado',
    negative: false,
    tick: 'NEVER',
    stacking: 'REFRESH',
    summonMoveBonus: 1,
  },
  /** Instinto Alfa: +1 damage on the summon's next attack, +1 more against the marked prey. Never stacks. */
  ALPHA_INSTINCT: {
    id: 'ALPHA_INSTINCT',
    name: 'Instinto Alfa',
    negative: false,
    tick: 'NEVER',
    stacking: 'REFRESH',
    summonDamageBonus: 1,
    summonPreyDamageBonus: 1,
  },
  // ── Archer special arrows (data/archer-hunt.ts). Same duration/tick rules as every status:
  // durations count the OWNER's turns (decremented at the end of each); ticks use BURNING's
  // existing convention (start of the owner's turn). Re-applying refreshes (max), never stacks.
  /** Flecha de Hielo: −2 walking (minimum 1) for its duration. Never prevents moving or acting. */
  SLOWED: {
    id: 'SLOWED',
    name: 'Ralentizado',
    negative: true,
    tick: 'NEVER',
    stacking: 'REFRESH',
    moveReduction: 2,
  },
  /**
   * Flecha Venenosa: 1 damage at the start of each of the owner's turns, through armour. Longer and
   * slower than BURNING (which it never replaces: a unit can burn and be poisoned at once).
   */
  POISONED: {
    id: 'POISONED',
    name: 'Envenenado',
    negative: true,
    tick: 'TURN_START',
    tickDamage: 1,
    tickDamageType: 'PHYSICAL',
    tickIgnoresArmor: true,
    stacking: 'REFRESH',
  },
  // ── Act III interactive battlefield (domain/mechanisms). Both are kept in sync by the mechanism
  // rules from board state (they cannot be cleansed away or left behind by mistake).
  /** Mechanical Guardian plating: hostile attacks deal 2 less (high mitigation, not immunity). */
  FORTIFIED: {
    id: 'FORTIFIED',
    name: 'Blindado',
    negative: false,
    tick: 'NEVER',
    stacking: 'IGNORE',
    permanent: true,
    incomingDamageReduction: 2,
  },
  /** Carrying a relic: −1 walking (minimum 1) from the next turn on. */
  RELIC_BURDEN: {
    id: 'RELIC_BURDEN',
    name: 'Carga de reliquia',
    negative: false,
    tick: 'NEVER',
    stacking: 'IGNORE',
    permanent: true,
    moveReduction: 1,
  },
  ...FREE_CATALOG_STATUSES,
  ...RANKED_PREMIUM_STATUSES,
};

/** 02_MVP_RULES §11. ICE rule chosen for v0.1: leaving an ICE tile costs +1 MP. */
export const TERRAIN: Readonly<Record<TerrainType, TerrainDef>> = {
  /**
   * Flecha de Humo (Archer): temporary cloud. Blocks line of sight THROUGH it (both sides, like a
   * pillar, but walkable) and stepping out of the cloud costs +1 move once (ICE's exit rule, paid
   * only when leaving the zone). Not a hazard: no damage, Dispel does not clear it, summons do
   * not avoid it. Only painted over NORMAL ground (CREATE_TERRAIN.replaceOnly), so it never
   * erases fire, ice, lava, cover or exits; re-painting refreshes its duration.
   */
  SMOKE: {
    type: 'SMOKE',
    name: 'Humo',
    walkable: true,
    exitCostBonus: 1,
    exitCostOnlyLeavingZone: true,
    blocksLineOfSight: true,
    endTurnDamage: 0,
    damageType: 'PHYSICAL',
    isHazard: false,
    canBeOverwritten: true,
    rangedReduction: 0,
    startEnergyBonus: 0,
  },
  COVER: {
    type: 'COVER',
    name: 'Cobertura',
    walkable: true,
    exitCostBonus: 0,
    endTurnDamage: 0,
    damageType: 'FIRE',
    isHazard: false,
    canBeOverwritten: false,
    rangedReduction: 1,
    startEnergyBonus: 0,
  },
  HAZARD: {
    type: 'HAZARD',
    name: 'Peligro',
    walkable: true,
    exitCostBonus: 0,
    endTurnDamage: 1,
    damageType: 'FIRE',
    isHazard: true,
    canBeOverwritten: false,
    rangedReduction: 0,
    startEnergyBonus: 0,
  },
  ARCANE: {
    type: 'ARCANE',
    name: 'Arcano',
    walkable: true,
    exitCostBonus: 0,
    endTurnDamage: 0,
    damageType: 'FIRE',
    isHazard: false,
    canBeOverwritten: false,
    rangedReduction: 0,
    startEnergyBonus: 1,
  },
  VOID: {
    type: 'VOID',
    name: 'Vacío',
    walkable: false,
    exitCostBonus: 0,
    endTurnDamage: 0,
    damageType: 'FIRE',
    isHazard: false,
    canBeOverwritten: false,
    rangedReduction: 0,
    startEnergyBonus: 0,
  },
  NORMAL: {
    type: 'NORMAL',
    name: 'Suelo',
    walkable: true,
    exitCostBonus: 0,
    endTurnDamage: 0,
    damageType: 'PHYSICAL',
    isHazard: false,
    canBeOverwritten: true,
  },
  FIRE: {
    type: 'FIRE',
    name: 'Fuego',
    walkable: true,
    exitCostBonus: 0,
    endTurnDamage: 2,
    damageType: 'FIRE',
    isHazard: true,
    canBeOverwritten: true,
  },
  ICE: {
    type: 'ICE',
    name: 'Hielo',
    walkable: true,
    exitCostBonus: 1,
    endTurnDamage: 0,
    damageType: 'ICE',
    isHazard: true,
    canBeOverwritten: true,
  },
  /**
   * World 2 map hazard. One rule, same as FIRE: a unit that ENDS its side's turn on lava takes 2
   * FIRE damage (armour and shield apply as for any damage). Walking across it is free; being
   * pushed onto it only hurts if the unit is still there when its side's turn ends. Unlike FIRE it
   * is part of the map: it cannot be painted over or dispelled.
   */
  LAVA: {
    type: 'LAVA',
    name: 'Lava',
    walkable: true,
    exitCostBonus: 0,
    endTurnDamage: 2,
    damageType: 'FIRE',
    isHazard: true,
    indestructible: true,
    canBeOverwritten: false,
  },
  BLOCKED: {
    type: 'BLOCKED',
    name: 'Abismo',
    walkable: false,
    exitCostBonus: 0,
    endTurnDamage: 0,
    damageType: 'PHYSICAL',
    isHazard: false,
    canBeOverwritten: false,
  },
  OBJECTIVE: {
    type: 'OBJECTIVE',
    name: 'Salida',
    walkable: true,
    exitCostBonus: 0,
    endTurnDamage: 0,
    damageType: 'PHYSICAL',
    isHazard: false,
    canBeOverwritten: false,
  },
};

export const OBSTACLES: Readonly<Record<string, ObstacleDef>> = {
  pillar: {
    id: 'pillar',
    name: 'Pilar',
    blocksMovement: true,
    blocksLineOfSight: true,
    visualKey: 'obstacle_pillar',
  },
  rubble: {
    id: 'rubble',
    name: 'Escombros',
    blocksMovement: true,
    blocksLineOfSight: false,
    visualKey: 'obstacle_rubble',
  },
  ice_wall: {
    id: 'ice_wall',
    name: 'Muro de Hielo',
    blocksMovement: true,
    blocksLineOfSight: true,
    visualKey: 'obstacle_ice_wall',
  },
};

/**
 * Hand rule, every champion: 5 cards kept between turns, 6 at most during a turn. The turn draw
 * (1) takes 5 → 6; END_TURN with 6 requires discarding 1 the player chooses. A draw at 6 goes
 * straight to the discard pile (the existing overdraw rule), so a hand never holds 7.
 */
export const HAND_RULES = { handSize: 5, turnHandCap: 6 } as const;

/**
 * Deck building: every deck holds EXACTLY 30 cards (was 20). The single source for the Deck
 * Builder, battle deck resolution, the Worker and PvP. Copy limits are per card, by rarity.
 * 20-card decks saved before the change are LEGACY (see DeckRules.legacySize).
 */
export const DECK_RULES: DeckRules = {
  requiredSize: 30,
  legacySize: 20,
  maxCopiesByRarity: { COMMON: 3, UNCOMMON: 2, RARE: 1, LEGENDARY: 1, ULTRA: 1 },
  maxUltraCards: 1,
  // Neutral cards are filler, not a shared core: at most 4 of 30 (probe: qa/neutral-summoner-pass).
  maxNeutralCards: 4,
};
