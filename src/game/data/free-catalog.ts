import type { CardAcquisition, CardDefinition, EffectDef } from '../domain/cards/card';
import type { SummonDef } from '../domain/content';
import type { StatusDef } from '../domain/statuses/status';
import { ARCHER_HUNT_CAMPAIGN_ID, ARCHER_HUNT_WORLD_ID } from './archer-hunt';

/**
 * Free card catalog (qa/free-card-catalog/DESIGN.md): one card of each rarity per champion, all
 * earned by playing, so a free player owns a competitive card at every rarity.
 *
 *   COMMON     starter deck (already owned)
 *   RARE       guaranteed on the first clear of a configured encounter (El Ascenso IV; Archer:
 *              Sendero del Cazador V). Reused Rares keep their normal drops too.
 *   LEGENDARY  Champion Mastery level 7
 *   ULTRA      completing Act I (El Ascenso; Archer: Sendero del Cazador). Única: banished once
 *              played, 1 copy, at most 1 Ultra per deck.
 *
 * The 12 new cards have guaranteed acquisition (`acquisition` FREE_CATALOG), never random drops
 * or Ranked-only rewards. Commercial packs (including their gifts) are allowed when the free
 * route exists and the set is released; no new offers are created here. Grants are idempotent and
 * retroactive (game/collection/free-catalog.ts): a met milestone grants the missing card only,
 * never crystals, badges or any other reward again.
 *
 * Released with the set below (server FREE_CATALOG_ENABLED, guest VITE_FREE_CATALOG_ENABLED):
 * until then no milestone grants anything; battles and decks never read the flag.
 */
export const FREE_CATALOG_EXPANSION = 'free_catalog_01';

export type CatalogTier = 'COMMON' | 'RARE' | 'LEGENDARY' | 'ULTRA';
export const CATALOG_TIERS: readonly CatalogTier[] = ['COMMON', 'RARE', 'LEGENDARY', 'ULTRA'];

export type CatalogUnlock =
  | { type: 'STARTER' }
  | { type: 'ENCOUNTER_CLEAR'; campaignId: string; encounterId: string }
  | { type: 'MASTERY_LEVEL'; level: number }
  | { type: 'WORLD_COMPLETED'; worldId: string };

export interface CatalogEntry {
  cardId: string;
  tier: CatalogTier;
  /** Reused card (EXISTING in the design) or a new free-catalog card. */
  reused: boolean;
  unlock: CatalogUnlock;
}

export const FREE_CATALOG_MASTERY_LEVEL = 7;
const STARTER: CatalogUnlock = { type: 'STARTER' };
// 'ascent' = ASCENT_CAMPAIGN.id (a literal: cards.ts imports this module, encounters must not load first).
const ASCENT_IV: CatalogUnlock = { type: 'ENCOUNTER_CLEAR', campaignId: 'ascent', encounterId: 'ascent_04_shield_wall' };
const SENDERO_V: CatalogUnlock = { type: 'ENCOUNTER_CLEAR', campaignId: ARCHER_HUNT_CAMPAIGN_ID, encounterId: 'hunt_05_stalker' };
const MASTERY: CatalogUnlock = { type: 'MASTERY_LEVEL', level: FREE_CATALOG_MASTERY_LEVEL };
const ACT_I: CatalogUnlock = { type: 'WORLD_COMPLETED', worldId: 'world_1' };
const SENDERO: CatalogUnlock = { type: 'WORLD_COMPLETED', worldId: ARCHER_HUNT_WORLD_ID };

const row = (common: string, rare: [string, boolean, CatalogUnlock], legendary: string, ultra: [string, CatalogUnlock]): CatalogEntry[] => [
  { cardId: common, tier: 'COMMON', reused: true, unlock: STARTER },
  { cardId: rare[0], tier: 'RARE', reused: rare[1], unlock: rare[2] },
  { cardId: legendary, tier: 'LEGENDARY', reused: false, unlock: MASTERY },
  { cardId: ultra[0], tier: 'ULTRA', reused: false, unlock: ultra[1] },
];

/** Champion id → its four catalog cards, Common → Ultra («Descubre las rarezas» order). */
export const FREE_CATALOG: Readonly<Record<string, readonly CatalogEntry[]>> = {
  mage: row('fireball', ['arcane_pull', false, ASCENT_IV], 'elemental_detonation', ['archmage_eruption', ACT_I]),
  summoner: row('summon_fox', ['mark_prey', true, ASCENT_IV], 'binder_command', ['summon_pact_golem', ACT_I]),
  warrior: row('shield_bash', ['challenge', true, ASCENT_IV], 'bastion_blow', ['last_bastion', ACT_I]),
  archer: row('true_shot', ['pinning_arrow', true, SENDERO_V], 'hunters_net', ['arrow_rain', SENDERO]),
  shapeshifter: row('qa_bear_form', ['minotaur_awakening', false, ASCENT_IV], 'form_dance', ['ancestral_stampede', ACT_I]),
};

const free = (tier: 'RARE' | 'LEGENDARY' | 'ULTRA'): CardAcquisition => ({ source: 'FREE_CATALOG', tier });
const set = { expansion: FREE_CATALOG_EXPANSION } as const;
const ULTRA = { rarity: 'ULTRA', unique: true, acquisition: free('ULTRA'), ...set } as const;
const hit = (amount: number, extra: Partial<Extract<EffectDef, { type: 'DAMAGE' }>> = {}): EffectDef =>
  ({ type: 'DAMAGE', amount, damageType: 'PHYSICAL', to: 'ENEMIES', ...extra }) as EffectDef;

/** Mage, Summoner and Warrior cards (DEFAULT_CONTENT). */
export const FREE_CATALOG_CORE_CARDS: CardDefinition[] = [
  {
    // Gancho pulls 1 from 1–3, Cuerda de Contrapeso 2 from 2: this one covers 3–4 (never closer).
    id: 'arcane_pull',
    name: 'Atracción Arcana',
    heroId: 'mage',
    cost: 1,
    category: 'CONTROL',
    tags: ['arcane', 'pull', 'slow', 'control', 'free-catalog'],
    rarity: 'RARE',
    rulesText: 'Un enemigo a distancia 3–4 con visión queda Ralentizado 1 turno y lo atraes 2 casillas hacia ti. Sin daño. No afecta a estructuras.',
    // The slow resolves first: after the pull the unit is no longer on the targeted tile.
    targeting: { type: 'UNIT', range: 4, minRange: 3, unitFilter: 'ENEMY', requiresLineOfSight: true, excludeStructures: true },
    effects: [
      { type: 'APPLY_STATUS', status: 'SLOWED', duration: 1, to: 'ENEMIES' },
      { type: 'PULL', distance: 2, to: 'ENEMIES' },
    ],
    acquisition: free('RARE'),
    ...set,
    presentation: { visualKey: 'arcane_pull', element: 'ARCANE', castAnimation: 'cast' },
  },
  {
    // Arcane Burst II with +1 range when unprepared; 3 to enemies standing on fire/ice, which it consumes.
    id: 'elemental_detonation',
    name: 'Detonación Elemental',
    heroId: 'mage',
    cost: 2,
    category: 'ATTACK',
    tags: ['arcane', 'area', 'terrain', 'free-catalog'],
    rarity: 'LEGENDARY',
    rulesText:
      'Área 3×3 a distancia 3 con visión: 1 de daño arcano a cada enemigo; 3 a los que estén sobre FUEGO o HIELO. Después retira el fuego y el hielo del área.',
    targeting: { type: 'AREA', range: 3, radius: 1, includeCenter: true, requiresLineOfSight: true },
    effects: [
      { type: 'DAMAGE', amount: 1, damageType: 'ARCANE', to: 'ENEMIES', bonus: { when: { type: 'TARGET_ON_TERRAIN', terrains: ['FIRE', 'ICE'] }, amount: 2 } },
      { type: 'REMOVE_HAZARDS', on: 'AREA' },
    ],
    acquisition: free('LEGENDARY'),
    ...set,
    presentation: { visualKey: 'elemental_detonation', element: 'ARCANE', castAnimation: 'cast' },
  },
  {
    // Burst + push + terrain in one play, once per battle. 2 per target (< Bola de Fuego's 3).
    id: 'archmage_eruption',
    name: 'Erupción del Archimago',
    heroId: 'mage',
    cost: 3,
    category: 'ATTACK',
    tags: ['fire', 'area', 'push', 'terrain', 'free-catalog', 'unique'],
    ...ULTRA,
    rulesText:
      'Única. Área 3×3 a distancia 4 con visión: 2 de fuego a cada enemigo y los empuja 1 casilla lejos de ti (1 de daño si chocan). Las casillas del área que quedan vacías arden 2 rondas.',
    targeting: { type: 'AREA', range: 4, radius: 1, includeCenter: true, requiresLineOfSight: true },
    effects: [
      { type: 'DAMAGE', amount: 2, damageType: 'FIRE', to: 'ENEMIES' },
      { type: 'PUSH', distance: 1, collisionDamage: 1, to: 'ENEMIES' },
      { type: 'CREATE_TERRAIN', terrain: 'FIRE', duration: 2, on: 'AREA', emptyOnly: true },
    ],
    presentation: { visualKey: 'archmage_eruption', element: 'FIRE', castAnimation: 'cast' },
  },
  {
    // Timing, not an extra action: the summon's own activation of this round, moved earlier.
    id: 'binder_command',
    name: 'Orden del Vinculador',
    heroId: 'summoner',
    cost: 1,
    category: 'UTILITY',
    tags: ['summon-synergy', 'order', 'free-catalog'],
    rarity: 'LEGENDARY',
    rulesText:
      'Una invocación tuya lista a distancia 4 actúa ahora (mueve y ataca con su comportamiento de siempre, Presa incluida). No vuelve a actuar al final de este turno.',
    targeting: { type: 'UNIT', range: 4, unitFilter: 'SUMMON', readySummon: true },
    effects: [{ type: 'ACTIVATE_SUMMON' }],
    acquisition: free('LEGENDARY'),
    ...set,
    presentation: { visualKey: 'binder_command', element: 'ARCANE', castAnimation: 'cast_support' },
  },
  {
    id: 'summon_pact_golem',
    name: 'Invocar Gólem del Pacto',
    heroId: 'summoner',
    cost: 4,
    category: 'UTILITY',
    tags: ['summon', 'guard', 'aura', 'free-catalog', 'unique'],
    ...ULTRA,
    rulesText:
      'Única. 16 HP · armadura 1 · golpe 2 · capacidad 2. En PvE y Casual: guardián, mueve 2 y reacciona a 3 casillas. En Ranked 1 vs. 1: mueve 3, reacciona a 5 casillas y persigue al único campeón enemigo incluso fuera de ese radio si hay ruta. Tú y tus aliados en cruz junto a él recibís 1 menos de cada ataque enemigo (no se suma a otra Cobertura). Actúa automáticamente al finalizar tu turno desde la siguiente ronda.',
    targeting: { type: 'TILE', range: 2, tileFilter: 'EMPTY', requiresLineOfSight: true },
    effects: [{ type: 'SUMMON', summonId: 'pact_golem' }],
    presentation: { visualKey: 'summon_pact_golem', element: 'SHIELD', castAnimation: 'cast_support', cardType: 'summon' },
  },
  {
    // The Guardia read is the caster's real shield when the effect resolves (shields expire at
    // the start of the owner's turn, so it is Guardia gained this turn).
    id: 'bastion_blow',
    name: 'Golpe del Bastión',
    heroId: 'warrior',
    cost: 2,
    category: 'ATTACK',
    tags: ['melee', 'guard', 'free-catalog'],
    rarity: 'LEGENDARY',
    rulesText:
      'Inflige a un enemigo adyacente daño físico igual a tu Guardia actual (máx. 6) y pierdes esa Guardia. Sin Guardia: 1 de daño. Si tenías 4+ de Guardia al resolver, además empuja 1 casilla y recuperas 1 MP.',
    targeting: { type: 'UNIT', range: 1, unitFilter: 'ENEMY' },
    effects: [hit(1, { fromCasterShield: { max: 6, highGuard: { atLeast: 4, pushDistance: 1, movePoints: 1 } } })],
    acquisition: free('LEGENDARY'),
    ...set,
    presentation: { visualKey: 'bastion_blow', element: 'FORCE', castAnimation: 'attack' },
  },
  {
    id: 'last_bastion',
    name: 'Último Bastión',
    heroId: 'warrior',
    cost: 2,
    category: 'DEFENSE',
    tags: ['guard', 'taunt', 'momentum', 'free-catalog', 'unique'],
    ...ULTRA,
    rulesText:
      'Única. Hasta el inicio de tu próximo turno no puedes bajar de 1 HP. Los enemigos adyacentes (en cruz) quedan Desafiados 1 turno y ganas 2 Impulso.',
    targeting: { type: 'SELF', area: { shape: 'CROSS', radius: 1, includeCenter: false } },
    effects: [
      { type: 'APPLY_STATUS', status: 'LAST_STAND', duration: 1, to: 'CASTER' },
      { type: 'APPLY_STATUS', status: 'CHALLENGED', duration: 1, to: 'ENEMIES', everyTarget: true },
      { type: 'GAIN_MOMENTUM', amount: 2 },
    ],
    presentation: { visualKey: 'last_bastion', element: 'SHIELD', castAnimation: 'guard' },
  },
];

/** Archer cards (merged by withArcher). */
export const FREE_CATALOG_ARCHER_CARDS: CardDefinition[] = [
  {
    id: 'hunters_net',
    name: 'Red del Cazador',
    heroId: 'archer',
    cost: 2,
    category: 'TERRAIN',
    tags: ['trap', 'zone', 'focus', 'free-catalog'],
    rarity: 'LEGENDARY',
    rulesText:
      'Cruz (radio 1) a distancia 4 con visión: trampas visibles en sus casillas libres durante 2 rondas. El primer enemigo que entre en cualquiera se detiene, recibe 1 de daño y queda Enraizado; las demás desaparecen. Si es tu Presa, ganas 2 Concentración. Solo una Red activa.',
    targeting: { type: 'CROSS', range: 4, radius: 1, includeCenter: true, requiresLineOfSight: true },
    effects: [{ type: 'PLACE_TRAP', trapId: 'hunters_net', damage: 1, rounds: 2, on: 'AREA', net: { preyFocus: 2 } }],
    acquisition: free('LEGENDARY'),
    ...set,
    presentation: { visualKey: 'hunters_net', element: 'NEUTRAL', castAnimation: 'attack' },
  },
  {
    // Not a direct shot: cover does not reduce it (area damage is never RANGED).
    id: 'arrow_rain',
    name: 'Lluvia de Flechas',
    heroId: 'archer',
    cost: 3,
    category: 'ATTACK',
    tags: ['ranged', 'area', 'prey', 'free-catalog', 'unique'],
    ...ULTRA,
    rulesText:
      'Única. Área 3×3 a distancia 5 con visión: 2 de daño físico a cada enemigo (la cobertura no lo reduce). Tu Presa recibe 3; si está dentro, ganas 2 Concentración.',
    targeting: { type: 'AREA', range: 5, radius: 1, includeCenter: true, requiresLineOfSight: true },
    effects: [hit(2, { bonus: { when: { type: 'TARGET_IS_PREY' }, amount: 1 }, focusGain: { amount: 2, when: [{ type: 'TARGET_IS_PREY' }] } })],
    presentation: { visualKey: 'arrow_rain', element: 'FORCE', castAnimation: 'attack' },
  },
];

/** Shapeshifter cards (merged by withShapeshifterRelease, after its catalog). */
export const FREE_CATALOG_SHAPESHIFTER_CARDS: CardDefinition[] = [
  {
    // Forma de Minotauro (1) + Estela de Acero (2) = 3 energy and 2 cards; this is 2 and 1 card.
    id: 'minotaur_awakening',
    name: 'Despertar del Minotauro',
    heroId: 'shapeshifter',
    cost: 2,
    category: 'ATTACK',
    tags: ['transformation', 'minotaur', 'area', 'free-catalog'],
    rarity: 'RARE',
    rulesText: 'Solo en forma Humana u Oso. Adoptas Minotauro e infliges 2 de daño físico a cada enemigo adyacente en cruz.',
    requiredForms: [null, 'bear'],
    targeting: { type: 'SELF', area: { shape: 'CROSS', radius: 1, includeCenter: false } },
    effects: [{ type: 'TRANSFORM', formId: 'minotaur' }, hit(2)],
    acquisition: free('RARE'),
    ...set,
    presentation: { visualKey: 'minotaur_awakening', element: 'FORCE', castAnimation: 'attack' },
  },
  {
    id: 'form_dance',
    name: 'Danza de las Formas',
    heroId: 'shapeshifter',
    cost: 1,
    category: 'UTILITY',
    tags: ['transformation', 'draw', 'free-catalog'],
    rarity: 'LEGENDARY',
    rulesText: 'Robas 1 carta. Hasta el final de este turno, las 2 primeras veces que cambies de forma ganas 2 de escudo y 1 de movimiento.',
    targeting: { type: 'SELF' },
    effects: [
      { type: 'DRAW', count: 1 },
      { type: 'APPLY_STATUS', status: 'FORM_DANCE', duration: 1, to: 'CASTER' },
    ],
    acquisition: free('LEGENDARY'),
    ...set,
    presentation: { visualKey: 'form_dance', element: 'NEUTRAL', castAnimation: 'cast_support' },
  },
  {
    // Embestida Brutal's 3 damage; pays 3 for reach 5, push 2 and ending as the Bear with a shield.
    id: 'ancestral_stampede',
    name: 'Estampida Ancestral',
    heroId: 'shapeshifter',
    cost: 3,
    category: 'ATTACK',
    tags: ['transformation', 'charge', 'push', 'free-catalog', 'unique'],
    ...ULTRA,
    rulesText:
      'Única. Adoptas Minotauro y cargas en línea recta hasta un enemigo a 2–5 casillas con el camino libre: 3 de daño físico y lo empujas 2 (2 de daño si choca). Después adoptas Oso y ganas 4 de escudo. No funciona si estás Enraizado.',
    targeting: { type: 'CHARGE', range: 5, minRange: 2 },
    effects: [
      { type: 'TRANSFORM', formId: 'minotaur' },
      { type: 'CHARGE_CASTER' },
      hit(3),
      { type: 'PUSH', distance: 2, collisionDamage: 2, to: 'ENEMIES' },
      { type: 'TRANSFORM', formId: 'bear' },
      { type: 'SHIELD', amount: 4, to: 'CASTER' },
    ],
    presentation: { visualKey: 'ancestral_stampede', element: 'FORCE', castAnimation: 'charge' },
  },
];

export const FREE_CATALOG_NEW_CARDS: readonly CardDefinition[] = [
  ...FREE_CATALOG_CORE_CARDS,
  ...FREE_CATALOG_ARCHER_CARDS,
  ...FREE_CATALOG_SHAPESHIFTER_CARDS,
];

/** Gólem del Pacto: a holding guard whose aura shields adjacent allies (combat/attack-modifiers.ts). */
export const FREE_CATALOG_SUMMONS: Readonly<Record<string, SummonDef>> = {
  pact_golem: {
    id: 'pact_golem',
    name: 'Gólem del Pacto',
    behavior: 'GUARD',
    maxHp: 16,
    armor: 1,
    moveRange: 2,
    damage: 2,
    capacityCost: 2,
    // Own beta standing pose; no reuse of another creature.
    visualKey: 'pact_golem',
    aura: { incomingDamageReduction: 1 },
  },
};

export const FREE_CATALOG_STATUSES = {
  LAST_STAND: {
    id: 'LAST_STAND',
    name: 'Último Bastión',
    negative: false,
    tick: 'NEVER',
    stacking: 'REFRESH',
    // From play through the rival's turn; gone at the start of the owner's next turn (before
    // that turn's status ticks), so it never makes a champion permanently unkillable.
    expiresAtOwnerTurnStart: true,
    hpFloor: 1,
  },
  FORM_DANCE: {
    id: 'FORM_DANCE',
    name: 'Danza de las Formas',
    negative: false,
    tick: 'NEVER',
    stacking: 'REFRESH',
    onFormChange: { shield: 2, movePoints: 1, charges: 2 },
  },
} as const satisfies Record<string, StatusDef>;

/** Commercial overlap is allowed only for an actual catalog entry with a guaranteed play route.
 * This does not release the set, add offers or alter any milestone/owned collection. */
export function hasGuaranteedFreeCatalogRoute(card: Pick<CardDefinition, 'id' | 'heroId' | 'acquisition' | 'rarity'>): boolean {
  if (card.acquisition?.source !== 'FREE_CATALOG' || !card.heroId) return false;
  const tier = card.acquisition.tier;
  return (FREE_CATALOG[card.heroId] ?? []).some(entry => entry.cardId === card.id && entry.tier === card.rarity && entry.tier === tier);
}
