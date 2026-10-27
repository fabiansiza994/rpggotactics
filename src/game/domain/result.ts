export type RuleError =
  | 'FORM_REQUIRED'
  | 'INVALID_TRANSFORMATION'
  | 'CARD_UNAVAILABLE_THIS_TURN'
  | 'SEARCH_HAND_FULL'
  | 'NO_ELIGIBLE_SUMMON'
  /** Eco del Altar: no ritual piece in the discard pile. */
  | 'NO_ELIGIBLE_PIECE'
  | 'BATTLE_OVER'
  | 'NOT_PLAYER_TURN'
  | 'UNKNOWN_UNIT'
  | 'UNIT_NOT_CONTROLLABLE'
  | 'MOVEMENT_PREVENTED'
  | 'UNREACHABLE'
  | 'CARD_NOT_IN_HAND'
  | 'NOT_ENOUGH_ENERGY'
  /** Archer: the card's `focusCost` is more Concentración than the caster holds. */
  | 'NOT_ENOUGH_FOCUS'
  /** The card's `minCasterHp` is more HP than the caster has (Vínculo Prohibido at 1 HP). */
  | 'NOT_ENOUGH_HP'
  /** A Única card whose copy was already banished this battle (no second resolution). */
  | 'UNIQUE_ALREADY_USED'
  | 'INVALID_TARGET'
  | 'CASTER_INCAPACITATED'
  | 'WRONG_CLASS'
  | 'SUMMON_CAPACITY'
  | 'NOT_A_RITUAL_PIECE'
  | 'NO_ALTAR'
  | 'ALTAR_FULL'
  | 'ALTAR_DUPLICATE'
  | 'PIECE_NOT_ON_ALTAR'
  | 'UNKNOWN_RITUAL'
  | 'RITUAL_INCOMPLETE'
  | 'RITUAL_LIMIT'
  /** END_TURN with more cards than the hand size and no (valid) `discardUid`. */
  | 'DISCARD_REQUIRED'
  /** END_TURN with a `discardUid` while the hand is within the hand size. */
  | 'DISCARD_NOT_ALLOWED'
  /** INTERACT (Act III mechanisms). */
  | 'UNKNOWN_MECHANISM'
  | 'NOT_INTERACTABLE'
  | 'NOT_ADJACENT'
  | 'INTERACTION_USED'
  | 'PUSH_BLOCKED';

export type RuleResult = { ok: true } | { ok: false; error: RuleError; message: string };

export const OK: RuleResult = { ok: true };

export const fail = (error: RuleError, message: string): RuleResult => ({
  ok: false,
  error,
  message,
});
