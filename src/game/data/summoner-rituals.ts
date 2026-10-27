import type { CardDefinition, EffectDef, TargetingDef } from '../domain/cards/card';
import type { GameContent, SummonDef } from '../domain/content';
import type { RitualDef } from '../domain/rituals/ritual';

/**
 * SUMMONER EXPANSION — Rituals + advanced direct summons.
 *
 * Two summoning styles:
 * - DIRECT: one card → one creature (reliable, fast, lower ceiling). New: Dragón de Guerra.
 * - RITUAL: seal 2/3/4 distinct pieces on the altar, then activate → ONE stronger creature
 *   (setup, deck commitment, higher ceiling). Every released ritual summons a creature; no
 *   ritual is a generic team buff. Sealing: the first seal of a turn is free, each further seal
 *   costs 1 energy (`HeroDef.altarSealing`). Pieces are normal deck cards whose own play is a
 *   deliberately weak secondary action, so a piece is never a dead draw.
 *
 * Tiers: MINOR 2 pieces → strong creature (Runa), MAJOR 3 → elite creature (Marca),
 * LEGENDARY 4 → legendary creature (Sello).
 * Manada Ancestral (formerly the 3-piece team-buff ritual) is now a normal support card.
 * Every card here belongs to the `summoner_rituals` set: QA-only (no reward drops) until the
 * visual/balance pass releases it (`GameContent.releasedExpansions`).
 * visualKeys are placeholders until the Codex art pass (qa/summoner-rituals/ART_MANIFEST.md).
 */
export const RITUAL_EXPANSION = 'summoner_rituals';

export const SUMMON_TILE: TargetingDef = { type: 'TILE', range: 2, tileFilter: 'EMPTY', requiresLineOfSight: true };
const OWN_SUMMON = (range: number): TargetingDef => ({ type: 'UNIT', range, unitFilter: 'SUMMON', requiresLineOfSight: true });
/** The whole board (areas are clipped to playable tiles). */
const WHOLE_BOARD: TargetingDef = { type: 'SELF', area: { shape: 'SQUARE', radius: 20, includeCenter: true } };

export function piece(
  id: string,
  name: string,
  rarity: CardDefinition['rarity'],
  ritual: string,
  secondary: Pick<CardDefinition, 'cost' | 'category' | 'targeting' | 'effects'> & { text: string; tags: string[] },
): CardDefinition {
  return {
    id,
    name,
    heroId: 'summoner',
    cost: secondary.cost,
    category: secondary.category,
    tags: ['ritual', 'ritual-piece', ...secondary.tags],
    rarity,
    ritualPiece: true,
    expansion: RITUAL_EXPANSION,
    rulesText: `Pieza de ${ritual}: séllala en el altar (el 1.er sello del turno es gratis; cada sello más, 1 energía). O juégala: ${secondary.text}`,
    targeting: secondary.targeting,
    effects: secondary.effects,
    presentation: { visualKey: id, element: 'ARCANE' },
  };
}

// Secondary actions are intentionally weaker than the regular card they echo (noted per piece).
const push1: EffectDef = { type: 'PUSH', distance: 1, collisionDamage: 0, to: 'SUMMONS' };

export const RITUAL_CARDS: CardDefinition[] = [
  // ── Minor: Ritual del Caparazón Ancestral (2 pieces, UNCOMMON = 2 copies each) ──
  piece('rune_stone', 'Runa de Piedra', 'UNCOMMON', 'Caparazón Ancestral', {
    // Pacto protector gives 3 shield for the same cost.
    cost: 1,
    category: 'DEFENSE',
    tags: ['support'],
    text: 'da 2 de escudo a una invocación tuya a distancia 3.',
    targeting: OWN_SUMMON(3),
    effects: [{ type: 'SHIELD', amount: 2, to: 'SUMMONS' }],
  }),
  piece('rune_shell', 'Runa del Caparazón', 'UNCOMMON', 'Caparazón Ancestral', {
    // "+1 movement to a summon": Azuzar moves it 2 for the same cost.
    cost: 0,
    category: 'MOVEMENT',
    tags: ['summon-command'],
    text: 'empuja 1 casilla a una invocación tuya a distancia 2 (alejándola de ti).',
    targeting: OWN_SUMMON(2),
    effects: [push1],
  }),
  // ── Major: Ritual del Lobo Ancestral (3 pieces, UNCOMMON) ──
  piece('mark_moon', 'Marca de la Luna', 'UNCOMMON', 'Lobo Ancestral', {
    // Cuidar bandada heals 2.
    cost: 1,
    category: 'DEFENSE',
    tags: ['support'],
    text: 'cura 1 HP a un aliado a distancia 3.',
    targeting: { type: 'UNIT', range: 3, unitFilter: 'ALLY', requiresLineOfSight: true },
    effects: [{ type: 'HEAL', amount: 1, to: 'ALLIES' }],
  }),
  piece('mark_fang', 'Marca del Colmillo', 'UNCOMMON', 'Lobo Ancestral', {
    // Magic Missile (Mage) deals 2 at range 4; the Summoner has no direct damage otherwise.
    cost: 1,
    category: 'CONTROL',
    tags: ['control'],
    text: 'inflige 1 de daño físico a un enemigo a distancia 2.',
    targeting: { type: 'UNIT', range: 2, unitFilter: 'ENEMY', requiresLineOfSight: true },
    effects: [{ type: 'DAMAGE', amount: 1, damageType: 'PHYSICAL', to: 'ENEMIES', attackKind: 'RANGED' }],
  }),
  piece('mark_blood', 'Marca de la Sangre', 'UNCOMMON', 'Lobo Ancestral', {
    // Amparo gives 4 shield for 1.
    cost: 0,
    category: 'DEFENSE',
    tags: ['support'],
    text: 'ganas 1 de escudo hasta tu próximo turno.',
    targeting: { type: 'SELF' },
    effects: [{ type: 'SHIELD', amount: 1, to: 'CASTER' }],
  }),
  // ── Manada Ancestral: the retired 3-piece buff ritual, now one ordinary support card ──
  {
    id: 'ancestral_pack',
    name: 'Manada Ancestral',
    heroId: 'summoner',
    // vs the old ritual (3 pieces + 2 energy: heal 3, shield 2, Furia 2 turns): one card, no
    // shield, Furia for this turn only (summons act at the end of their owner's turn). vs Canto de la manada (1: heal 1 + shield 1 near you): any range.
    cost: 2,
    rarity: 'RARE',
    category: 'DEFENSE',
    tags: ['support', 'summon-synergy'],
    expansion: RITUAL_EXPANSION,
    rulesText:
      'Todas tus invocaciones se curan 2 HP y entran en Furia de la manada: +2 de daño en los ataques que hacen al terminar este turno.',
    targeting: WHOLE_BOARD,
    effects: [
      { type: 'HEAL', amount: 2, to: 'SUMMONS' },
      { type: 'APPLY_STATUS', status: 'PACK_FURY', duration: 1, to: 'SUMMONS' },
    ],
    // Placeholder art (Canto de la manada's) until the Codex visual pass.
    presentation: { visualKey: 'nurture', element: 'SHIELD' },
  },
  // ── Advanced DIRECT summon ──
  {
    id: 'summon_war_drake',
    name: 'Invocar Dragón de Guerra',
    heroId: 'summoner',
    cost: 4,
    rarity: 'RARE',
    category: 'UTILITY',
    tags: ['summon', 'pressure', 'elite-summon'],
    expansion: RITUAL_EXPANSION,
    rulesText:
      '18 HP · armadura 1 · mueve 2 · aliento de fuego 3 a distancia 1–2 con visión · capacidad 2. Cuesta toda tu energía y toda tu capacidad. Actúa desde la siguiente ronda. Permanece hasta morir o ser retirada.',
    targeting: SUMMON_TILE,
    effects: [{ type: 'SUMMON', summonId: 'war_drake' }],
    presentation: { visualKey: 'summon_war_drake', element: 'FIRE' },
  },
];

export const RITUAL_SUMMONS: Readonly<Record<string, SummonDef>> = {
  /** Elite direct summon: strong but heavy; a whole turn of energy and the full capacity. */
  war_drake: {
    id: 'war_drake',
    name: 'Dragón de Guerra',
    behavior: 'PRESSURE',
    attackRange: 2,
    damageType: 'FIRE',
    maxHp: 18,
    armor: 1,
    // 2 (was 1): it never reached a PvP fight; Cacería Desatada still adds +2 (4).
    moveRange: 2,
    damage: 3,
    capacityCost: 2,
    visualKey: 'war_drake',
  },
  /**
   * Minor-ritual creature: a far sturdier Tortuga that takes the whole capacity (at capacity 1
   * it out-valued every direct list in the campaign probe; see REPORT "Balance results").
   */
  ancient_turtle: {
    id: 'ancient_turtle',
    name: 'Tortuga Ancestral',
    behavior: 'GUARD',
    maxHp: 22,
    armor: 1,
    moveRange: 1,
    damage: 3,
    capacityCost: 2,
    visualKey: 'ancient_turtle',
  },
  /**
   * Major-ritual creature: an elite Lobo (Lobo 14 HP · mueve 2 · daño 3). Fast and hard-hitting
   * but unarmoured, so it is answerable; replaces the caster's summons (whole capacity).
   */
  ancient_wolf: {
    id: 'ancient_wolf',
    name: 'Lobo Ancestral',
    behavior: 'PRESSURE',
    maxHp: 20,
    armor: 0,
    moveRange: 3,
    damage: 4,
    capacityCost: 2,
    visualKey: 'ancient_wolf',
  },
};

export const RITUALS: Readonly<Record<string, RitualDef>> = {
  ancestral_shell: {
    id: 'ancestral_shell',
    name: 'Ritual del Caparazón Ancestral',
    heroId: 'summoner',
    tier: 'MINOR',
    pieces: ['rune_stone', 'rune_shell'],
    // Never cheaper in energy than the direct Tortuga it out-classes. (Energy is a weak lever for
    // the Summoner — its 4-card hand rarely spends all 4 — the real costs are cards, turns, capacity.)
    energyCost: 2,
    targeting: SUMMON_TILE,
    // Takes the whole capacity, so it replaces current summons: respecting capacity left a
    // complete altar stuck behind a Gallina in 22% of probe battles (qa/ritual-simplification).
    dismissSummons: true,
    result: {
      kind: 'SUMMON_CREATURE',
      effects: [
        { type: 'SUMMON', summonId: 'ancient_turtle' },
        { type: 'SHIELD', amount: 3, to: 'CASTER' },
      ],
    },
    rulesText:
      'Despide a tus invocaciones e invoca una Tortuga Ancestral (22 HP · armadura 1 · mueve 1 · daño 3 · capacidad 2) a distancia 2; ganas 3 de escudo.',
    presentation: { visualKey: 'ritual_ancestral_shell' },
  },
  ancestral_wolf: {
    id: 'ancestral_wolf',
    name: 'Ritual del Lobo Ancestral',
    heroId: 'summoner',
    tier: 'MAJOR',
    pieces: ['mark_moon', 'mark_fang', 'mark_blood'],
    energyCost: 2,
    targeting: SUMMON_TILE,
    // Elite creature, whole capacity: current summons are dismissed so a complete ritual is
    // never stuck behind a Gallina (the choice is "keep my familiars" vs "call the wolf").
    // Every ritual tier works this way: ritual creatures never stack with familiars.
    dismissSummons: true,
    result: { kind: 'SUMMON_CREATURE', effects: [{ type: 'SUMMON', summonId: 'ancient_wolf' }] },
    rulesText:
      'Despide a tus invocaciones e invoca un Lobo Ancestral (20 HP · mueve 3 · daño 4 · capacidad 2) a distancia 2.',
    presentation: { visualKey: 'ritual_ancestral_wolf' },
  },
};

/**
 * Store readiness (metadata only — no offers exist yet): what future bundles may draw from.
 * Gameplay cards stay obtainable through normal drops once the set is released.
 */
export const SUMMONER_RITUAL_SET = {
  expansion: RITUAL_EXPANSION,
  ritualPieces: RITUAL_CARDS.filter((c) => c.ritualPiece).map((c) => c.id),
  directSummons: ['summon_war_drake'],
  supportCards: ['ancestral_pack'],
  rituals: Object.keys(RITUALS),
  /** Future cosmetic hooks (VFX skins per ritual); not implemented. */
  cosmeticVfxKeys: Object.values(RITUALS).map((r) => r.presentation.visualKey),
} as const;

/**
 * The legendary 4-piece ritual (Dragón Primordial) left its prototype stage: it lives in
 * data/primordial-dragon.ts as the gated `summoner_primordial` set and is part of DEFAULT_CONTENT.
 * Kept as an identity so older probes keep compiling.
 * @deprecated the Dragon is already in DEFAULT_CONTENT.
 */
export function withPrototypeRituals(content: GameContent): GameContent {
  return content;
}
