import type { EffectDef, TargetingDef } from '../cards/card';

/**
 * Ritual size. The tier fixes how many DISTINCT pieces the ritual needs (validated by tests):
 * MINOR 2 → strong creature, MAJOR 3 → elite creature, LEGENDARY 4 → legendary creature.
 */
export type RitualTier = 'MINOR' | 'MAJOR' | 'LEGENDARY';

export const RITUAL_TIER_PIECES: Readonly<Record<RitualTier, number>> = { MINOR: 2, MAJOR: 3, LEGENDARY: 4 };

/**
 * What a ritual produces. Classification for UI/analytics only: the rules resolve `effects`
 * (the same primitives cards use), so no ritual needs bespoke code. Released rituals are all
 * SUMMON_CREATURE ("ritual = creature", test-enforced); the other kinds stay in the model for
 * future content, not for generic team buffs.
 * - SUMMON_CREATURE: a SUMMON effect (the creature is an ordinary summon unit).
 * - TEAM_BUFF:       effects on the caster's side (heal / shield / statuses on summons…).
 * - BOARD_EFFECT:    terrain, obstacles, area damage.
 */
export type RitualResultKind = 'SUMMON_CREATURE' | 'TEAM_BUFF' | 'BOARD_EFFECT';

/**
 * A ritual: assemble every piece on the altar, then activate it explicitly. Generic data —
 * never "if card A and B then dragon". The server validates pieces, energy, capacity and
 * target exactly like a card play.
 */
export interface RitualDef {
  id: string;
  name: string;
  /** Champion that can perform it (its pieces are that champion's class cards). */
  heroId: string;
  tier: RitualTier;
  /** Distinct ritual-piece card ids, all required on the altar at once. */
  pieces: readonly string[];
  /** Energy paid on activation (on top of the deck slots and turns spent assembling). */
  energyCost: number;
  /** Same targeting model as cards; a SUMMON result needs an empty walkable impact tile. */
  targeting: TargetingDef;
  result: { kind: RitualResultKind; effects: EffectDef[] };
  /**
   * Sacrifice: the caster's summons leave the board before the result resolves (their capacity
   * is freed for it). Optional; most rituals simply respect current capacity.
   */
  dismissSummons?: boolean;
  /** At most this many activations per battle (e.g. 1 for a legendary). Absent = unlimited. */
  limitPerBattle?: number;
  rulesText: string;
  presentation: { visualKey: string };
}
