import { MAGE_THUNDER_CORE } from './mage-thunder-core';
import { MAGE_THUNDER_EXPANSION } from './mage-thunder-expansion';
import { PRICE_LADDER } from '../store/store';
import { PREMIUM_CURRENCY_ID, type CosmeticDef, type CurrencyPackage, type StoreOffer } from '../store/store';

/**
 * Store catalog (Phase 4A seed, expanded in 4C). Server-authoritative: the Worker serves and
 * sells exactly these offers; the client only ever sends an offer id. Every card here is also a
 * normal reward drop for its champion (validateCatalog + tests). Prices follow PRICE_LADDER;
 * bundles ≈ 85% of their parts, and a partly-owned bundle is prorated by the server.
 */

/**
 * Cosmetics the game can render. Profile frames decorate the champion portrait (store, PvP
 * lobby); they never touch gameplay. Other kinds are added only together with their renderer.
 */
export const COSMETICS: Readonly<Record<string, CosmeticDef>> = {
  frame_arcane_gilt: {
    id: 'frame_arcane_gilt',
    kind: 'PROFILE_FRAME',
    name: 'Marco Áureo Arcano',
    description: 'Filigrana dorada y runas violetas alrededor de tu retrato de campeón.',
  },
  frame_pact_grove: {
    id: 'frame_pact_grove',
    kind: 'PROFILE_FRAME',
    name: 'Marco del Pacto Silvestre',
    description: 'Raíces de bronce y hojas del pacto alrededor de tu retrato de campeón.',
  },
  // Warrior set «Juramento del Verdugo»: store-only cosmetic (cosmetics may be exclusive).
  frame_executioner_oath: {
    id: 'frame_executioner_oath',
    kind: 'PROFILE_FRAME',
    name: 'Marco del Juramento',
    description: 'Acero ennegrecido, filo carmesí y runas de oro viejo: la marca de quien jura terminar cada combate.',
    heroId: 'warrior',
  },
};

/** 2026-10-11T00:00Z → 2027-01-11T00:00Z: the first rotation period. */
const LAUNCH_ROTATION = { startAt: 1_791_676_800_000, endAt: 1_799_625_600_000 };
/** 2027-01-11T00:00Z → 2027-04-11T00:00Z: next rotation (stock; served only once it starts). */
const SECOND_ROTATION = { startAt: 1_799_625_600_000, endAt: 1_807_401_600_000 };
const PERMANENT = { startAt: null, endAt: null };

const HERO_LABEL = { mage: 'Mago', summoner: 'Invocador', warrior: 'Guerrero' } as const;
const HERO_CATEGORY = { mage: 'MAGE', summoner: 'SUMMONER', warrior: 'WARRIOR' } as const;

const card = (
  cardId: string,
  heroId: keyof typeof HERO_LABEL,
  title: string,
  price: number,
  sortOrder: number,
  tags: string[],
): StoreOffer => ({
  id: `card_${cardId}`,
  type: 'CARD',
  title,
  description: `Una copia de ${title} para la colección del ${HERO_LABEL[heroId]}. También se obtiene jugando.`,
  price,
  currencyId: PREMIUM_CURRENCY_ID,
  heroId,
  contents: [{ kind: 'CARD', cardId, copies: 1 }],
  categories: ['CARDS', HERO_CATEGORY[heroId]],
  tags: [heroId, ...tags],
  ...PERMANENT,
  purchaseLimit: null, // the rarity copy cap is the limit
  sortOrder,
  giftable: true,
});

/** A premium champion pack: its first card is the hero shot («Carta destacada»). */
const premium = (
  id: string,
  heroId: keyof typeof HERO_LABEL,
  title: string,
  description: string,
  price: number,
  cardIds: readonly string[],
  categories: StoreOffer['categories'],
  sortOrder: number,
  tags: string[],
): StoreOffer => ({
  id,
  type: 'CHAMPION_PACK',
  title,
  description,
  price,
  currencyId: PREMIUM_CURRENCY_ID,
  heroId,
  contents: cardIds.map((cardId) => ({ kind: 'CARD' as const, cardId, copies: 1 })),
  categories,
  tags: [heroId, 'bundle', 'premium', ...tags],
  ...PERMANENT,
  purchaseLimit: 1,
  sortOrder,
  giftable: true,
  featuredCardId: cardIds[0]!,
});

const frame = (cosmeticId: string, title: string, sortOrder: number): StoreOffer => ({
  id: `cosmetic_${cosmeticId}`,
  type: 'COSMETIC',
  // A champion-themed frame is listed with its champion (hidden while that champion is not released).
  ...(COSMETICS[cosmeticId]!.heroId ? { heroId: COSMETICS[cosmeticId]!.heroId } : {}),
  title,
  description: `${COSMETICS[cosmeticId]!.description} Solo estético: no cambia ninguna regla.`,
  price: 300, // PROFILE_FRAME
  currencyId: PREMIUM_CURRENCY_ID,
  contents: [{ kind: 'COSMETIC', cosmeticId }],
  categories: ['COSMETICS'],
  tags: ['cosmetic', 'frame'],
  ...PERMANENT,
  purchaseLimit: 1,
  sortOrder,
  giftable: true,
});

export const STORE_CATALOG: readonly StoreOffer[] = [

  // ── Summoner bundles ──
  {
    id: 'pack_summoner_shadow_pack',
    type: 'CHAMPION_PACK',
    title: 'Manada Sombría',
    description:
      'Presión para el Invocador: el Lobo, Azuzar para lanzarlo al frente y Enredadera para fijar a la presa. Todas se obtienen también en escaramuzas.',
    price: 380, // RARE + 2 COMMON = 450 one by one
    currencyId: PREMIUM_CURRENCY_ID,
    heroId: 'summoner',
    contents: [
      { kind: 'CARD', cardId: 'summon_wolf', copies: 1 },
      { kind: 'CARD', cardId: 'spur_familiar', copies: 1 },
      { kind: 'CARD', cardId: 'entangle', copies: 1 },
    ],
    categories: ['FEATURED', 'SUMMONER', 'DEALS'],
    tags: ['summoner', 'bundle', 'pressure', 'rotation'],
    ...LAUNCH_ROTATION,
    purchaseLimit: 1,
    sortOrder: 0,
    giftable: true,
  },
  {
    id: 'pack_summoner_bestiary',
    type: 'CHAMPION_PACK',
    title: 'Pack Bestiario del Invocador',
    description:
      'Dos invocaciones y un apoyo para el Invocador: Tortuga, Cuervo y Pacto protector. Todas se obtienen también en escaramuzas.',
    price: 380, // 3 UNCOMMON cards = 450 one by one
    currencyId: PREMIUM_CURRENCY_ID,
    heroId: 'summoner',
    contents: [
      { kind: 'CARD', cardId: 'summon_turtle', copies: 1 },
      { kind: 'CARD', cardId: 'summon_raven', copies: 1 },
      { kind: 'CARD', cardId: 'familiar_aegis', copies: 1 },
    ],
    categories: ['SUMMONER'],
    tags: ['summoner', 'bundle'],
    ...PERMANENT,
    purchaseLimit: 1,
    sortOrder: 1,
    giftable: true,
  },
  {
    id: 'pack_summoner_pact_guardians',
    type: 'CHAMPION_PACK',
    title: 'Guardianes del Pacto',
    description:
      'Sostén para tus criaturas: Canto de la manada, Ofrenda vital y Retorno ritual. Todas se obtienen también en escaramuzas.',
    price: 380, // 3 UNCOMMON = 450 one by one
    currencyId: PREMIUM_CURRENCY_ID,
    heroId: 'summoner',
    contents: [
      { kind: 'CARD', cardId: 'pack_hymn', copies: 1 },
      { kind: 'CARD', cardId: 'vital_offering', copies: 1 },
      { kind: 'CARD', cardId: 'recall_familiar', copies: 1 },
    ],
    categories: ['SUMMONER'],
    tags: ['summoner', 'bundle', 'support'],
    ...PERMANENT,
    purchaseLimit: 1,
    sortOrder: 2,
    giftable: true,
  },
  // ── Mage bundles ──
  {
    id: 'pack_mage_glacial_control',
    type: 'CHAMPION_PACK',
    title: 'Control Glacial',
    description:
      'Hielo para dictar el ritmo: Frost Nova, Glacial Field y Glacial Shell. Mismas cartas que da la campaña.',
    price: 420, // UNCOMMON + COMMON + RARE = 500 one by one
    currencyId: PREMIUM_CURRENCY_ID,
    heroId: 'mage',
    contents: [
      { kind: 'CARD', cardId: 'frost_nova', copies: 1 },
      { kind: 'CARD', cardId: 'glacial_field', copies: 1 },
      { kind: 'CARD', cardId: 'glacial_shell', copies: 1 },
    ],
    categories: ['MAGE'],
    tags: ['mage', 'bundle', 'control'],
    ...PERMANENT,
    purchaseLimit: 1,
    sortOrder: 10,
    giftable: true,
  },
  {
    id: 'pack_mage_void_mastery',
    type: 'CHAMPION_PACK',
    title: 'Maestría del Vacío',
    description:
      'Movilidad y presión: Arcane Burst II, Blink II y Repulse. Mismas cartas que da la campaña.',
    price: 340, // 2 UNCOMMON + 1 COMMON = 400 one by one
    currencyId: PREMIUM_CURRENCY_ID,
    heroId: 'mage',
    contents: [
      { kind: 'CARD', cardId: 'arcane_burst_ii', copies: 1 },
      { kind: 'CARD', cardId: 'blink_ii', copies: 1 },
      { kind: 'CARD', cardId: 'repulse', copies: 1 },
    ],
    categories: ['MAGE'],
    tags: ['mage', 'bundle', 'mobility'],
    ...PERMANENT,
    purchaseLimit: 1,
    sortOrder: 11,
    giftable: true,
  },
  {
    id: 'pack_mage_arcanist',
    type: 'CHAMPION_PACK',
    title: 'Códice del Arcanista',
    description:
      'Tres hechizos tácticos para el Mago: Dispel, Arcane Surge y Flame Tile. Mismas cartas que da la campaña.',
    price: 340, // 2 UNCOMMON + 1 COMMON = 400 one by one
    currencyId: PREMIUM_CURRENCY_ID,
    heroId: 'mage',
    contents: [
      { kind: 'CARD', cardId: 'dispel', copies: 1 },
      { kind: 'CARD', cardId: 'arcane_surge', copies: 1 },
      { kind: 'CARD', cardId: 'flame_tile', copies: 1 },
    ],
    categories: ['MAGE', 'DEALS'],
    tags: ['mage', 'bundle', 'rotation'],
    ...LAUNCH_ROTATION,
    purchaseLimit: 1,
    sortOrder: 12,
    giftable: true,
  },
  // ── Warrior set «Juramento del Verdugo» (listed only where the Warrior is released) ──
  {
    id: 'pack_warrior_executioner_oath',
    type: 'CHAMPION_PACK',
    title: 'Juramento del Verdugo',
    description:
      'Cierra la distancia, sujeta a la presa y dicta sentencia. Ejecución, Embestida y Agarre para el Guerrero, más el Marco del Juramento. Las tres cartas también se obtienen jugando.',
    price: 680, // RARE + UNCOMMON + COMMON + frame = 800 one by one
    currencyId: PREMIUM_CURRENCY_ID,
    heroId: 'warrior',
    contents: [
      { kind: 'CARD', cardId: 'execution', copies: 1 },
      { kind: 'CARD', cardId: 'ram', copies: 1 },
      { kind: 'CARD', cardId: 'grapple', copies: 1 },
      { kind: 'COSMETIC', cosmeticId: 'frame_executioner_oath' },
    ],
    categories: ['FEATURED', 'WARRIOR'],
    tags: ['warrior', 'bundle', 'finisher', 'executioner'],
    ...PERMANENT,
    purchaseLimit: 1,
    sortOrder: -1, // headlines Destacado wherever the Warrior is released
    giftable: true,
  },
  // ── «Vitrina I» premium offers (qa/store-appeal): each headlines a Showcase Rare. Store policy
  // unchanged: every card also drops in play, bundles ≈ 85% of their parts, prorated when partly
  // owned. An offer is only listed once every card in it is released (validateCatalog
  // UNRELEASED_CARD): the Vitrina set (showcase_store_01) and the Arsenal I / tactical sets.
  premium('pack_mage_frost_tempest', 'mage', 'Tempestad de Escarcha',
    'El invierno del Archimago: Cometa de Escarcha cae a distancia y enraíza una cruz entera; Frost Nova y Arcane Burst II rematan la zona. Las tres cartas también se obtienen jugando.',
    470, ['frost_comet', 'frost_nova', 'arcane_burst_ii'], ['FEATURED', 'PREMIUM', 'MAGE'], -5, ['control', 'area']), // 250 + 150 + 150 = 550
  premium('pack_mage_archmage_seal', 'mage', 'Sello del Archimago',
    'Control de precisión: Sello de Silencio apaga el próximo golpe enemigo, Cadena Arcana lo clava al suelo y Paso Espejo te aparta con escudo. También se obtienen jugando.',
    380, ['silence_seal', 'arcane_chain', 'mirror_step'], ['PREMIUM', 'MAGE'], 13, ['control']), // 250 + 100 + 100 = 450
  premium('pack_summoner_pack_oath', 'summoner', 'Juramento de la Manada',
    'El vínculo hecho armadura: Juramento de la Manada cura y protege a todo tu ejército, el Lobo encabeza la carga y Pacto protector lo sostiene. También se obtienen jugando.',
    550, ['pack_oath', 'summon_wolf', 'familiar_aegis'], ['FEATURED', 'PREMIUM', 'SUMMONER'], -4, ['bond', 'support']), // 250 + 250 + 150 = 650
  premium('pack_summoner_alpha_hunt', 'summoner', 'Cacería del Alfa',
    'Presión indirecta: marca la presa, despierta el Instinto Alfa de tu bestia y remata con Golpe del Vinculador. También se obtienen jugando.',
    510, ['alpha_instinct', 'mark_prey', 'binder_strike'], ['PREMIUM', 'SUMMONER'], 3, ['pressure', 'bond']), // 250 + 250 + 100 = 600
  premium('pack_warrior_judgement', 'warrior', 'Martillo del Juicio',
    'Impacto y aguante en un solo golpe: Martillo del Juicio aplasta, empuja y te cubre; Furia de vanguardia y Muro de acero completan el frente. También se obtienen jugando.',
    550, ['judgement_hammer', 'vanguard_fury', 'steel_wall'], ['FEATURED', 'PREMIUM', 'WARRIOR'], -3, ['impact', 'guard']), // 250 + 250 + 150 = 650
  premium('pack_warrior_guardbreaker', 'warrior', 'Rompeescudos',
    'Contra muros y escudos: Rompeguardia atraviesa armadura, Desafío obliga al enemigo a venir y Paso del Titán te planta delante. También se obtienen jugando.',
    510, ['guard_breaker', 'challenge', 'titan_step'], ['PREMIUM', 'WARRIOR'], 14, ['anti-defense', 'control']), // 250 + 250 + 100 = 600
  // ── Ritual pack (qa/primordial-dragon-store): the four seals of the Dragón Primordial ritual,
  // one copy each = the full recipe. Sells the PATH, never the creature (it only exists by
  // completing the ritual in battle). Listed only once the summoner_primordial set is released
  // (UNRELEASED_CARD); every seal also drops in play. 4 × 250 = 1000 → 850 (≈85%), prorated when
  // partly owned; second copies come from play.
  {
    ...premium(
      'pack_summoner_primordial_ritual',
      'summoner',
      'Ritual del Dragón Primordial',
      'Reúne las piezas sagradas y completa la invocación. Los cuatro Sellos Primordiales —Garra, Colmillo, Ala y Corazón— despiertan al Dragón Primordial. También se obtienen jugando.',
      850,
      ['seal_heart', 'seal_claw', 'seal_fang', 'seal_wing'],
      ['FEATURED', 'PREMIUM', 'SUMMONER'],
      -10, // headlines Destacado once released
      ['ritual', 'legendary'],
    ),
    tags: ['summoner', 'bundle', 'ritual-pack', 'ritual', 'legendary'],
    ritualPreview: 'primordial_dragon',
  },
  { ...card('frost_comet', 'mage', 'Cometa de Escarcha', 250, 24, ['showcase']), categories: ['PREMIUM', 'CARDS', 'MAGE'] },
  { ...card('pack_oath', 'summoner', 'Juramento de la Manada', 250, 35, ['showcase']), categories: ['PREMIUM', 'CARDS', 'SUMMONER'] },
  { ...card('judgement_hammer', 'warrior', 'Martillo del Juicio', 250, 36, ['showcase']), categories: ['PREMIUM', 'CARDS', 'WARRIOR'] },
  // ── Single cards (rarity price; the copy cap limits them) ──
  card('frost_nova', 'mage', 'Frost Nova', 150, 20, ['control']),
  card('arcane_burst_ii', 'mage', 'Arcane Burst II', 150, 21, ['burst']),
  card('glacial_shell', 'mage', 'Glacial Shell', 250, 22, ['defense']),
  card('summon_wolf', 'summoner', 'Invocar Lobo', 250, 30, ['summon']),
  card('pack_hymn', 'summoner', 'Canto de la manada', 150, 31, ['support']),
  card('entangle', 'summoner', 'Enredadera', 100, 32, ['control']),
  card('execution', 'warrior', 'Ejecución', 250, 34, ['finisher']),
  // ── Next rotation (not served before 2027-01-11) ──
  { ...card('blink_ii', 'mage', 'Blink II', 150, 23, ['mobility']), categories: ['CARDS', 'MAGE', 'DEALS'], ...SECOND_ROTATION },
  { ...card('vital_offering', 'summoner', 'Ofrenda vital', 150, 33, ['support']), categories: ['CARDS', 'SUMMONER', 'DEALS'], ...SECOND_ROTATION },
  // ── Cosmetics ──
  frame('frame_arcane_gilt', 'Marco Áureo Arcano', 40),
  frame('frame_pact_grove', 'Marco del Pacto Silvestre', 41),
  frame('frame_executioner_oath', 'Marco del Juramento', 42),
  // Release 2: normal one-copy offers using the existing rarity ladder and transaction flow.
  // Free campaign acquisition remains unchanged; no bundle, currency, starter or login grant.
  ...[...MAGE_THUNDER_CORE, ...MAGE_THUNDER_EXPANSION].filter(c => c.id !== 'storm_avatar').map((definition, i) =>
    card(definition.id, 'mage', definition.name, PRICE_LADDER.card[definition.rarity ?? 'COMMON'], 100 + i, ['thunder', 'thunder-release-2'])),
];

const NOT_LISTED = { WEB: null, APPLE: null, GOOGLE: null } as const;

/**
 * Future real-money packages of Cristales Arcanos (model only: not served, not purchasable).
 * Provider product ids stay null until each product exists in that provider's console; fiat
 * prices are set there, not here.
 */
export const CURRENCY_PACKAGES: readonly CurrencyPackage[] = [
  { internalSku: 'crystals_s', currencyId: PREMIUM_CURRENCY_ID, currencyAmount: 500, bonusAmount: 0, platformSkus: NOT_LISTED },
  { internalSku: 'crystals_m', currencyId: PREMIUM_CURRENCY_ID, currencyAmount: 1100, bonusAmount: 100, platformSkus: NOT_LISTED },
  { internalSku: 'crystals_l', currencyId: PREMIUM_CURRENCY_ID, currencyAmount: 2500, bonusAmount: 300, platformSkus: NOT_LISTED },
  { internalSku: 'crystals_xl', currencyId: PREMIUM_CURRENCY_ID, currencyAmount: 4300, bonusAmount: 700, platformSkus: NOT_LISTED },
];
