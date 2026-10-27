import type { Pos } from '../core/position';
import type { StatusInstance } from '../statuses/status';

export type Faction = 'PLAYER' | 'ENEMY';

/** HERO = player-controlled, ENEMY = AI-controlled, STRUCTURE = static (e.g. objective crystal). */
export type UnitKind = 'HERO' | 'ENEMY' | 'STRUCTURE' | 'SUMMON';

export type TargetPreference = 'HERO' | 'OBJECTIVE';

export interface Unit {
  /** QA depth only. Missing legacy values use faction's deterministic initial direction. */
  combatFacing?: import('../core/position').Direction;
  qaCounterRound?: number;
  /** Battle-only state; absent in legacy snapshots and humanoid form. Public in PvP. */
  activeForm?: string;
  id: string;
  /** Id of the definition in content (hero / enemy / structure). */
  defId: string;
  name: string;
  faction: Faction;
  kind: UnitKind;
  pos: Pos;
  hp: number;
  maxHp: number;
  /** Absorbs damage before HP. Expires at the start of the owner's next turn. */
  shield: number;
  /** Flat damage reduction: finalDamage = max(0, base - armor). */
  armor: number;
  /** Movement budget per turn for AI units. The hero uses PlayerState.movePoints. */
  moveRange: number;
  statuses: StatusInstance[];
  /** Enemy AI: whom to go after first. */
  targetPreference: TargetPreference;
  /** Owned persistent ally; capacity is released when this unit leaves the board. */
  /**
   * Champion resource (Warrior's Impulso). Authoritative battle state: only rules change it.
   * `engagedRound` = last round the once-per-turn engage gain was used.
   */
  momentum?: {
    value: number;
    max: number;
    engagedRound: number;
    /** Paciencia del Muro: turn key (`turnKey`) of the last distant hit that gave its bonus. */
    patienceTurn?: number;
  };
  /** Archer resource (Concentración), same authority rules as `momentum`. Never gained passively. */
  focus?: { value: number; max: number };
  /**
   * Pending one-shot cost discounts (`GRANT_COST_DISCOUNT`): at most one per scope, consumed by the
   * next matching card this unit plays. Battle-only, public in PvP like `momentum`.
   */
  costDiscounts?: { scope: import('../cards/card').CostDiscountScope; amount: number; sourceCardId: string }[];
  /**
   * Summon capacity points gained during THIS battle (`GAIN_SUMMON_CAPACITY`, Vínculo Prohibido).
   * Added on top of the hero's base capacity (`summonCapacityOf`); battle-only, public in PvP. A
   * new battle builds new units, so it never carries over.
   */
  summonCapacityBonus?: number;
  /** `breathReadyRound`: first round its `SummonDef.breath` can be used again (absent = ready). */
  summon?: { ownerId: string; capacityCost: number; lastActedRound: number; readyRound: number; breathReadyRound?: number };
}
