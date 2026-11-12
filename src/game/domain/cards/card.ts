import type { DamageType } from '../combat/damage-types';
import type { StatusId } from '../statuses/status';
import type { TerrainType } from '../terrain/terrain';

export type CardCategory = 'ATTACK' | 'MOVEMENT' | 'DEFENSE' | 'CONTROL' | 'TERRAIN' | 'UTILITY';

/** Relative to the caster's faction. ALLY includes the caster itself. */
export type UnitFilter = 'ENEMY' | 'ALLY' | 'ANY' | 'SUMMON';

/**
 * - ANY:            any in-bounds tile
 * - EMPTY:          no unit, no obstacle, walkable terrain (where a wall/teleport can go)
 * - NOT_BLOCKED:    any tile whose terrain is not BLOCKED (units allowed)
 */
export type TileFilter = 'ANY' | 'EMPTY' | 'NOT_BLOCKED';

/**
 * Shape of the affected area, centred on the resolved target tile.
 * - WALL: a line perpendicular to the caster→target axis (Ice Wall).
 */
export type AreaDef =
  | { shape: 'SINGLE' }
  | { shape: 'CROSS'; radius: number; includeCenter?: boolean }
  | { shape: 'SQUARE'; radius: number; includeCenter?: boolean }
  | { shape: 'WALL'; radius: number }
  /** `size`×`size` block whose top-left corner (lowest x, lowest y) is the target (Eclipse de Ceniza: 2×2). */
  | { shape: 'BLOCK'; size: number };

/**
 * How the player chooses a target. Range is Manhattan distance from the caster.
 * - SELF:  no choice; the caster's tile (optionally with an area around it).
 * - UNIT:  pick a unit matching `unitFilter`.
 * - TILE:  pick a tile matching `tileFilter`.
 * - LINE:  pick one of the 4 orthogonal directions; travels `range` tiles, stops at LoS
 *          blockers, and at the first unit unless `pierce`.
 * - CROSS: pick a tile; affects a cross of `radius`.
 * - AREA:  pick a tile; affects a square of `radius`.
 * - CHARGE: pick an enemy in a straight orthogonal line at distance `minRange`..`range` whose
 *          lane is free to walk (no unit, obstacle or unwalkable terrain in between). The
 *          impact is the tile next to it; the enemy's tile is the affected area. Prevented by ROOTED.
 */
export type TargetingDef =
  | { type: 'SELF'; area?: AreaDef }
  | {
      type: 'UNIT';
      range: number;
      minRange?: number;
      unitFilter: UnitFilter;
      requiresLineOfSight?: boolean;
      area?: AreaDef;
      /** Only the caster's current Presa (Archer PREY status) is a valid target (Flecha Rastreadora). */
      preyOnly?: boolean;
      /** Structures are never valid targets (a swap never moves a crystal). */
      excludeStructures?: boolean;
      /** The card moves the caster: no valid target while ROOTED (Relevo del Pacto). */
      casterMustMove?: boolean;
      /** Only a summon that can act this round (ready and not acted yet): Orden del Vinculador. */
      readySummon?: boolean;
      /**
       * Pacto de la Doble Luna: the target (an own summon) swaps with a partner. Without a second
       * target the partner is the caster; with `PLAY_CARD.secondary` it is ANOTHER own summon at
       * `range` from the caster (line of sight when required). No moved unit may be ROOTED.
       */
      pairSwap?: { range: number; requiresLineOfSight?: boolean };
    }
  | {
      type: 'TILE';
      range: number;
      minRange?: number;
      tileFilter: TileFilter;
      requiresLineOfSight?: boolean;
      area?: AreaDef;
      /**
       * Leap (Salto de Asedio): only tiles orthogonally next to a hostile non-structure unit at
       * `minRange`..`maxRange` from the caster (with line of sight to it when required). That unit
       * — the anchor — is the affected tile; with several, the one closest to the caster, then
       * board order (deterministic, shown in the preview).
       */
      leapAnchor?: { minRange: number; maxRange: number; requiresLineOfSight?: boolean };
      /** The card moves the caster: no valid target while ROOTED. */
      casterMustMove?: boolean;
    }
  /**
   * `focusPierce` (Archer, Flecha Perforante): with at least that much Concentración, the tile of
   * the second unit behind the first one is ALSO a valid target. Choosing it spends that much and
   * the shot continues through the first unit to that one (see ResolvedTarget.focusSpent).
   */
  | { type: 'LINE'; range: number; pierce: boolean; focusPierce?: number }
  | {
      type: 'CROSS';
      range: number;
      radius: number;
      includeCenter?: boolean;
      requiresLineOfSight?: boolean;
    }
  | {
      type: 'AREA';
      range: number;
      radius: number;
      includeCenter?: boolean;
      requiresLineOfSight?: boolean;
    }
  | { type: 'CHARGE'; range: number; minRange: number }
  /**
   * STEP: pick a tile the caster could WALK into within `range` steps (legal walk: no units,
   * obstacles or unwalkable terrain; ICE exit costs ignored). Prevented by ROOTED. Pair with
   * STEP_CASTER. No reaction/engagement system exists, so a step never provokes anything.
   */
  | { type: 'STEP'; range: number;
      /**
       * Retreat (Archer, Retirada Táctica): only tiles that leave the caster strictly farther from
       * the nearest hostile non-structure unit than it is now. No hostile on the board = any step.
       */
      away?: boolean };

export type TargetingType = TargetingDef['type'];

/** Which units inside the resolved area an effect applies to (relative to the caster). */
export type UnitSelector = 'CASTER' | 'ENEMIES' | 'ALLIES' | 'UNITS' | 'SUMMONS';

/** Which tiles an effect applies to. IMPACT = the resolved anchor tile (end of a LINE). */
export type TileSelector = 'AREA' | 'IMPACT';

/**
 * Yes/no condition for a flat effect bonus, evaluated when the effect resolves (per affected
 * unit for target-relative conditions). Never scales with how many units satisfy it.
 * - OWN_SUMMON_ALIVE:              the caster has at least one summon on the board.
 * - OWN_SUMMON_ADJACENT_TO_TARGET: one of the caster's summons is orthogonally next to the unit hit.
 * - CASTER_HP_AT_MOST_HALF:        the caster's current HP is at most half its max HP (rounded down).
 * - CASTER_ADJACENT_TO_ENEMY:      a hostile non-structure unit is orthogonally next to the caster.
 */
export type EffectCondition =
  | { type: 'OWN_SUMMON_ALIVE' }
  | { type: 'OWN_SUMMON_ADJACENT_TO_TARGET' }
  | { type: 'CASTER_HP_AT_MOST_HALF' }
  | { type: 'CASTER_ADJACENT_TO_ENEMY' }
  // ── Archer (Presa / Distancia Óptima). Optimal range comes from `HeroDef.focus.optimalRange`.
  /** The unit hit is the caster's current Presa (PREY status applied by this caster). */
  | { type: 'TARGET_IS_PREY' }
  /** Manhattan distance caster → unit hit is inside the caster's optimal range. */
  | { type: 'TARGET_IN_OPTIMAL_RANGE' }
  /** The unit hit has at most `pct`% of its max HP (exact integer test, shield not counted). */
  | { type: 'TARGET_HP_AT_MOST_PCT'; pct: number }
  /** No hostile non-structure unit is orthogonally next to the caster. */
  | { type: 'CASTER_NOT_ADJACENT_TO_ENEMY' }
  /** The caster's Presa is alive and in line of sight. */
  | { type: 'PREY_IN_LINE_OF_SIGHT' }
  /** The caster's Presa is alive and inside the caster's optimal range. */
  | { type: 'PREY_IN_OPTIMAL_RANGE' }
  /**
   * The unit hit stands on one of these terrains right now (the board tile under it when the
   * effect resolves: Detonación Elemental, FIRE or ICE).
   */
  | { type: 'TARGET_ON_TERRAIN'; terrains: readonly TerrainType[] }
  /** The unit hit carries at least one of these statuses right now (Quemadura = BURNING, Frío = SLOWED). */
  | { type: 'TARGET_HAS_STATUS'; statuses: readonly StatusId[] }
  /** At least one of the listed conditions holds (conditions are otherwise all-of). */
  | { type: 'ANY_OF'; conditions: readonly EffectCondition[] };

/** `amount` more when `when` holds — every listed condition (Golpe del Vinculador, Vínculo Protector). */
export interface EffectBonus {
  when: EffectCondition | readonly EffectCondition[];
  amount: number;
}

export type EffectDef =
  | { type: 'TRANSFORM'; formId: string | null }
  | {
      type: 'DAMAGE';
      amount: number;
      damageType: DamageType;
      to: UnitSelector;
      /** RANGED: COVER reduces it. PIERCING: ignores the target's armor (Rompeguardia). */
      attackKind?: 'RANGED' | 'PIERCING';
      /**
       * Before the hit, removes up to this much of the target's shield. That extra only ever
       * removes shield: it never reaches HP (Rompeguardia).
       */
      shieldBreak?: number;
      /**
       * Finisher: a target whose CURRENT HP (shield not counted) is at most `hpAtMost` when the
       * effect resolves takes `amount` instead. Still a normal hit: shield and armor apply.
       */
      finisher?: { hpAtMost: number; amount: number };
      bonus?: EffectBonus;
      /**
       * Archer: Concentración the caster gains AFTER the hit when every condition holds for the
       * unit hit (evaluated before the damage, so killing the Presa still counts). At most once
       * per effect, whatever the number of units hit.
       */
      focusGain?: { amount: number; when: readonly EffectCondition[] };
      /**
       * Flecha de Rebote: after hitting its (single) target the arrow bounces up to `bounces`
       * times, `amount` damage each, along `reboundChain` (adjacent, distinct hostile units,
       * deterministic order). Same damage type / attack kind as the main hit.
       */
      rebound?: { bounces: number; amount: number };
      /** Consumes one pending electrical charge for this entire damage effect. */
      electrical?: boolean;
      /** Only units on the impact tile (an area card whose damage is not area damage: Flecha de Humo). */
      impactOnly?: boolean;
      /**
       * Golpe del Bastión: the amount is the caster's CURRENT shield (Guardia) when the effect
       * resolves, capped at `max` (`amount` when it has none); the shield used is then lost.
       */
      fromCasterShield?: {
        max: number;
        /** Read once BEFORE consuming Guardia; use the existing push/MP effects after damage. */
        highGuard?: { atLeast: number; pushDistance: number; movePoints: number };
        /** Muralla del Rey Caído: ALL the Guardia is lost, not only the part capped into damage. */
        consumeAll?: boolean;
      };
    }
  | { type: 'HEAL'; amount: number; to: UnitSelector; bonus?: EffectBonus }
  | { type: 'SHIELD'; amount: number; to: UnitSelector; bonus?: EffectBonus }
  | {
      type: 'APPLY_STATUS';
      status: StatusId;
      duration: number;
      to: UnitSelector;
      /**
       * Sourced statuses (Desafío, Presa) are one per source on the board: by default each unit
       * this effect marks takes it from the previous one. `everyTarget` keeps it on every unit of
       * THIS effect (Último Bastión challenges all adjacent enemies); older marks still move.
       */
      everyTarget?: boolean;
    }
  | { type: 'CLEANSE'; to: UnitSelector }
  /** Pushes away from the caster. Collision with unit/obstacle/edge deals `collisionDamage`. */
  | { type: 'PUSH'; distance: number; collisionDamage: number; to: UnitSelector }
  /**
   * Pulls toward the caster (the push rules in reverse: stops at a unit, obstacle, edge or
   * unwalkable terrain). Never deals damage. Structures are never pulled.
   */
  | { type: 'PULL'; distance: number; to: UnitSelector }
  /** Moves the caster to the impact tile, ignoring paths and movement restrictions. */
  | { type: 'TELEPORT_CASTER' }
  /** CHARGE targeting only: the caster walks the free lane to the impact tile (not a teleport). */
  | { type: 'CHARGE_CASTER' }
  /** STEP targeting only: the caster walks to the impact tile. Free: no movement points spent. */
  | { type: 'STEP_CASTER' }
  | { type: 'GAIN_MOMENTUM'; amount: number }
  /** Archer Concentración (caster). Every `when` condition must hold when it resolves. */
  | { type: 'GAIN_FOCUS'; amount: number; when?: readonly EffectCondition[] }
  /**
   * Archer trap on the impact tile, owned by the caster: the first hostile unit that walks, is
   * pushed or teleports onto it takes `damage` and is ROOTED (movement stops there). Public. Lasts
   * `rounds` board rounds when untriggered. A trap already there is replaced.
   */
  | {
      type: 'PLACE_TRAP';
      trapId: string;
      damage: number;
      damageType?: DamageType;
      rootOnTrigger?: boolean;
      rounds: number;
      /**
       * AREA: one trap on every free tile of the area (no unit, obstacle or blocked terrain).
       * Default IMPACT (one tile).
       */
      on?: TileSelector;
      /**
       * Red del Cazador: the traps of one cast are linked. The first one sprung removes the rest,
       * catching the owner's Presa gives `preyFocus` Concentración, and the owner keeps only one
       * net of this `trapId` (a new cast replaces the old one).
       */
      net?: { preyFocus: number };
    }
  /** `emptyOnly`: skip tiles holding a unit (ground control, not damage under someone's feet). */
  /** `replaceOnly`: paint only tiles whose CURRENT terrain is listed (Humo never erases fire, ice, exits…). */
  | { type: 'CREATE_TERRAIN'; terrain: TerrainType; duration: number | null; on: TileSelector; emptyOnly?: boolean; replaceOnly?: readonly TerrainType[] }
  | { type: 'REMOVE_HAZARDS'; on: TileSelector }
  | { type: 'CREATE_OBSTACLE'; obstacleId: string; duration: number | null; on: TileSelector }
  | { type: 'RECALL_SUMMON' }
  /**
   * Orden del Vinculador: the targeted own summon takes THIS round's activation now (same AI,
   * same rules as at the end of the turn); it then skips the end-of-turn activation.
   */
  | { type: 'ACTIVATE_SUMMON' }
  /**
   * The caster and the unit on the impact tile exchange tiles (both are teleported: traps under
   * either destination spring as usual). Effects listed BEFORE it still see the target on its
   * original tile (Intercambio Arcano, Relevo del Pacto).
   */
  | { type: 'SWAP_WITH_TARGET' }
  /**
   * Pacto de la Doble Luna: the units on the two affected tiles of a `pairSwap` target exchange
   * tiles (both teleported; traps spring as usual). Later effects see them on their NEW tiles.
   */
  | { type: 'SWAP_PAIR' }
  /**
   * The caster's next card of `scope` costs `amount` less (never below 0), once, for the rest of
   * the battle. Never stacks: a pending discount of the same scope is kept, not added to.
   * `minEnemiesInArea`: only when at least that many hostile non-structure units stand in the
   * resolved area (list it BEFORE the damage, so units the hit kills still count).
   * - SPELL:     the next card with cost ≥ 1 (Eclipse de Ceniza).
   * - TRANSFORM: the next card whose resolved effects change the caster's form (Ascenso Primordial).
   */
  | { type: 'GRANT_COST_DISCOUNT'; scope: CostDiscountScope; amount: number; minEnemiesInArea?: number }
  /**
   * Delayed, public area (Runa de Ignición): marks the affected tiles; at the START of the caster's
   * next turn every hostile unit still inside takes `damage`, then the glyph is gone.
   */
  | { type: 'PLACE_GLYPH'; glyphId: string; damage: number; damageType: DamageType; activations?: number; maxTargets?: number }
  | { type: 'SUMMON'; summonId: string }
  /**
   * Vínculo Prohibido: the caster loses floor(current HP × `percentOfCurrent` / 100) HP. A cost,
   * not damage: armor, shields, Riposte and damage triggers never see it, and it never takes the
   * caster below 1 HP (pair with `CardDefinition.minCasterHp` so the card needs HP to pay).
   */
  | { type: 'SACRIFICE_HP'; percentOfCurrent: number }
  /** The caster's summon capacity grows by `amount` points for the rest of THIS battle (`Unit.summonCapacityBonus`). */
  | { type: 'GAIN_SUMMON_CAPACITY'; amount: number }
  | { type: 'DRAW'; count: number }
  | { type: 'GAIN_ENERGY'; amount: number }
  | { type: 'GAIN_MOVE_POINTS'; amount: number };

export type EffectType = EffectDef['type'];

export type CostDiscountScope = 'SPELL' | 'TRANSFORM';

export type VisualElement = 'NATURE' | 'THUNDER' | 'FIRE' | 'ICE' | 'ARCANE' | 'FORCE' | 'SHIELD' | 'TELEPORT' | 'NEUTRAL';

/**
 * Presentation hints. NEVER read by the domain. The VFX registry (presentation layer) maps
 * `visualKey` → visual definition.
 */
export interface CardPresentation {
  /** Optional UI classification; independent of gameplay category and rarity. */
  cardType?: 'summon' | 'spell' | 'defense' | 'tactic' | 'ritual';
  visualKey: string;
  element: VisualElement;
  castAnimation?: string;
  sound?: string;
  /**
   * Showcase Rare: richer art, premium frame, subtle foil/parallax and VFX. Presentation ONLY:
   * it never changes power, rarity, copy limits, drop rates, rewards, economy or PvP legality.
   */
  premiumTreatment?: 'showcase';
}

export interface CardDefinition {
  /** Any listed form permits play; null means humanoid. Absent = unrestricted. */
  requiredForms?: readonly (string | null)[];
  /** Atomic owner-only draw-pile search; chosen instance is locked until next own turn. */
  deckSearch?: 'SUMMON';
  /**
   * Eco del Altar: the player picks one ritual piece of their OWN discard pile (sent as the search
   * uid, validated against the real pile); it returns to the hand locked until the next own turn.
   */
  discardSearch?: 'RITUAL_PIECE';
  id: string;
  name: string;
  /**
   * Hero (class) whose collection this card belongs to. Omitted = neutral: any hero can
   * collect and equip it. Also enforced by combat when playing a card.
   */
  heroId?: string;
  cost: number;
  category: CardCategory;
  tags: string[];
  rulesText: string;
  targeting: TargetingDef;
  effects: EffectDef[];
  /** Alternate complete effects, selected once from the authoritative form at play time.
   * Same targeting/cost; base effects mirror HUMAN for non-contextual catalog inspection. */
  formEffects?: { HUMAN: EffectDef[]; BEAST: EffectDef[] };
  /**
   * Per-form effects keyed by the caster's `activeForm` id (Ascenso Primordial: bear, minotaur).
   * Checked before `formEffects`; a form without an entry falls back to `formEffects`, then to
   * `effects` (humanoid). Content ids, so future forms only need data.
   */
  formEffectsById?: Readonly<Record<string, EffectDef[]>>;
  /**
   * Momentum payoff: when the caster holds at least `momentum` Impulso as the card is played,
   * that much is spent automatically and `effects` resolve INSTEAD of the base effects (same
   * targeting). Deterministic and fully previewable.
   */
  empowered?: { momentum: number; effects: EffectDef[] };
  /**
   * Archer finisher: needs at least this much Concentración to be played and spends all of it on
   * play (before the effects resolve). Never partial.
   */
  focusCost?: number;
  /** Not playable while the caster has fewer HP than this (Vínculo Prohibido: 2, "no puede usarse con 1 PV"). */
  minCasterHp?: number;
  /**
   * Never changes power: it sets the deck copy limit (`DeckRules.maxCopiesByRarity`) and the
   * finish. LEGENDARY / ULTRA are the top of the free catalog ladder (data/free-catalog.ts).
   */
  rarity?: 'COMMON' | 'UNCOMMON' | 'RARE' | 'LEGENDARY' | 'ULTRA';
  /**
   * Única (every Ultra): at most 1 copy per deck, and once played it is BANISHED for the rest of
   * the battle (`PlayerState.banished`): never discarded, never recycled into the deck.
   */
  unique?: boolean;
  /**
   * Deck copy limit for this card, overriding the rarity limit (`DeckRules.maxCopiesByRarity`).
   * Used sparingly: the four Dragón Primordial seals are RARE but allow 2 copies so a dedicated
   * 30-card deck can actually assemble the 4-piece ritual.
   */
  maxCopies?: number;
  /**
   * Ritual piece: besides being played normally (its `effects` are the deliberately weak
   * secondary action), it can be sealed onto the caster's altar (COMMIT_RITUAL_PIECE). Which
   * rituals need it is derived from `GameContent.rituals`, never stored on the card.
   */
  ritualPiece?: boolean;
  /**
   * Content set the card ships with. Cards of a set missing from `GameContent.releasedExpansions`
   * are never offered as rewards (QA-only content). Battles do not read it.
   */
  expansion?: string;
  /**
   * Declared acquisition: excluded from random pools, promo codes and guest imports.
   * FREE_CATALOG may also appear in commercial packs when its guaranteed play route exists.
   * Other acquisition sources remain exclusive. Battles, decks and PvP use normal ownership.
   */
  acquisition?: CardAcquisition;
  presentation: CardPresentation;
}

/**
 * Exclusive card sources. More (season, event…) can be added without touching the rules.
 * - WORLD_COMPLETION: granted once with the world's completion reward.
 * - ENCOUNTER_REWARD: the authored offer of one of that world's encounters (`EncounterDef.rewards.cards`).
 */
export type CardAcquisition =
  | { source: 'WORLD_COMPLETION'; worldId: string }
  | { source: 'ENCOUNTER_REWARD'; worldId: string }
  /**
   * Ranked Reward Track early access (src/game/ranked/rewardTrack.ts). Removing it later (Season 1)
   * releases the card to the normal pools: ownership never depends on it.
   */
  | { source: 'RANKED_TRACK'; seasonId: string; rewardId: string; worldId?: undefined }
  /**
   * Ranked Premium Track early access (src/game/ranked/premiumTrack.ts). Exclusive to the pass up
   * to and including `exclusiveUntilSeason`; afterwards it is meant to reach a free route
   * (collection, campaign, mastery…). Ownership never depends on it.
   */
  | { source: 'RANKED_PREMIUM'; seasonId: string; rewardId: string; exclusiveUntilSeason: string; worldId?: undefined }
  /**
   * Free catalog (data/free-catalog.ts): granted once by a milestone (first clear, Mastery 7, Act I),
   * retroactively too. Not a random drop. Commercial packs may also contain it when its
   * guaranteed catalog route exists; store availability still requires the released set.
   */
  | { source: 'FREE_CATALOG'; tier: 'RARE' | 'LEGENDARY' | 'ULTRA'; worldId?: undefined };

/** Has a declared source; store validation explicitly permits guaranteed FREE_CATALOG overlap. */
export const isExclusiveCard = (card: Pick<CardDefinition, 'acquisition'>): boolean => card.acquisition !== undefined;

/** A concrete copy of a card inside deck/hand/discard. */
export interface CardInstance {
  unavailableThisTurn?: true;
  uid: string;
  cardId: string;
}
