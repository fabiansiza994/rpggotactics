import type { DamageType } from '../combat/damage-types';

export type StatusId =
  | 'VOLTAIC_ARMOR'
  | 'CONDUCTIVE_MARK'
  | 'ELECTRIC_FRENZY'
  | 'STORM_AVATAR'
  | 'OVERCHARGED'
  | 'BURNING'
  | 'ROOTED'
  | 'STUNNED'
  | 'RIPOSTE'
  | 'PACK_FURY'
  | 'MARKED_PREY'
  | 'PREY'
  | 'SEALED'
  | 'CHALLENGED'
  | 'SMOKE_SCREEN'
  | 'UNLEASHED_HUNT'
  | 'HUNT_PURSUIT'
  | 'PACK_CALL'
  | 'ALPHA_INSTINCT'
  | 'SLOWED'
  | 'POISONED'
  | 'WALL_PATIENCE'
  /** Act III: Mechanical Guardian plating / relic carrier burden (domain/mechanisms). */
  | 'FORTIFIED'
  | 'RELIC_BURDEN'
  /** Free catalog: Último Bastión (HP floor) / Danza de las Formas (form-change trigger). */
  | 'LAST_STAND'
  | 'FORM_DANCE'
  /** Ranked Premium: Corazón del Acechador (−1 walking) / Ascenso Primordial Minotauro (next hit pushes). */
  | 'STALKER_HOBBLE'
  | 'PRIMAL_CHARGE';

/** When a status' per-turn effect fires, relative to the OWNER's turn. */
export type StatusTiming = 'TURN_START' | 'TURN_END' | 'NEVER';

/**
 * - REFRESH: duration = max(current, new)
 * - EXTEND:  duration = current + new
 * - IGNORE:  keep the existing instance untouched
 */
export type StatusStacking = 'REFRESH' | 'EXTEND' | 'IGNORE';

export interface StatusDef {
  id: StatusId;
  name: string;
  negative: boolean;
  tick: StatusTiming;
  tickDamage?: number;
  nextElectricalDamage?: number;
  tickDamageType?: DamageType;
  stacking: StatusStacking;
  /** Unit cannot perform normal (walking) movement. Teleports/pushes still work. */
  preventsMovement?: boolean;
  /** Unit skips its actions (enemies) / cannot play cards (hero). */
  preventsActions?: boolean;
  /**
   * Riposte: the first hostile attack from an ADJACENT unit is answered with this much physical
   * damage, then the status is consumed. Counter damage never triggers another counter.
   */
  counterDamage?: number;
  counterDamageType?: DamageType;
  /** Attack-only buffs; never apply to counter/hazard damage. */
  outgoingDamageBonus?: number;
  incomingDamageBonus?: number;
  electricalDamageBonus?: number;
  /** Target-side charge consumed only by electrical card damage. */
  receivedElectricalBonus?: number;
  /** Removed at the start of the owner's next turn instead of counting down (covers exactly the opponent's turn). */
  expiresAtOwnerTurnStart?: boolean;
  /** Summons only: extra damage on their automatic attack while the status lasts. */
  summonDamageBonus?: number;
  /**
   * Prey mark (Marcar Presa): the instance remembers who applied it (`StatusInstance.sourceId`)
   * and that champion's summons prefer the marked unit (see `actSummons`). One mark per source:
   * applying it again moves it, the previous target loses it.
   */
  preyMark?: boolean;
  /**
   * Attack modifiers (see combat/attack-modifiers.ts). They change ATTACKS only: card DAMAGE
   * effects, summon attacks and enemy intents. Push collisions, Riposte, terrain and status
   * ticks are never modified.
   * - outgoingDamageReduction: the unit's attacks deal this much less (never below 1).
   * - suppressesHitRiders: an enemy's attack loses its push / status / scorch rider.
   * - incomingDamageReduction: attacks from hostile units deal this much less to it (min 0).
   */
  outgoingDamageReduction?: number;
  suppressesHitRiders?: boolean;
  incomingDamageReduction?: number;
  /**
   * Challenge (Desafío): the instance remembers who applied it (`sourceId`, one per source like
   * `preyMark`). The unit targets that champion whenever it is alive, and its attacks against
   * anyone else deal `tauntPenalty` less (never below 1).
   */
  taunt?: boolean;
  tauntPenalty?: number;
  /** Summons only: extra move range on their automatic action while the status lasts. */
  summonMoveBonus?: number;
  /** Counts eligible summon activations, never owner turns before the creature is ready. */
  summonActivationClock?: boolean;
  /** Never counts down: removed only by its own rules (replacement, cleanse, death). */
  permanent?: boolean;
  /** Summons only: extra damage when the automatic attack hits their owner's marked prey. */
  summonPreyDamageBonus?: number;
  /**
   * Slow (Flecha de Hielo): the unit's walking budget is this much lower (never below 1): enemies'
   * and summons' move range, a champion's move points at the start of its turn. Not a lock: it can
   * still walk 1 and act. See `effectiveMoveRange`.
   */
  moveReduction?: number;
  /** The per-turn tick ignores armour (Veneno). Shields still absorb it. */
  tickIgnoresArmor?: boolean;
  /**
   * Paciencia del Muro: the FIRST landed hostile hit (shield or HP) from a NON-adjacent unit in each
   * turn gives this much extra Impulso, on top of the normal +1 (see `Unit.momentum.patienceTurn`).
   */
  distantHitMomentum?: number;
  /**
   * Último Bastión: while it lasts, no damage can take the unit below this HP (every source:
   * attacks, multi-hits, collisions, terrain, status ticks). It never heals and never stops
   * pushes, roots or stuns.
   */
  hpFloor?: number;
  /**
   * Danza de las Formas: each change of form (any form, including back to human) gives the unit
   * this shield and, on its own turn, these move points, at most `charges` times per instance
   * (`StatusInstance.charges`); the instance is removed when the last charge is used.
   */
  onFormChange?: { shield: number; movePoints: number; charges: number };
  /**
   * Ascenso Primordial (Minotauro): the unit's next card DAMAGE effect that hits pushes every
   * surviving unit it hit this many tiles away (no collision damage); the status is then consumed.
   */
  nextAttackPush?: number;
}

/** Statuses whose instance stores who applied it (one per source on the whole board). */
export const isSourcedStatus = (def: Pick<StatusDef, 'preyMark' | 'taunt'>): boolean => !!(def.preyMark || def.taunt);

/** Duration is counted in the owner's turns and decremented at the end of each of them. */
export interface StatusInstance {
  id: StatusId;
  turnsLeft: number;
  /** Only for sourced statuses (`preyMark`, `taunt`): the unit that applied it. Absent otherwise. */
  sourceId?: string;
  /** Uses left of a counted trigger (`StatusDef.onFormChange`). Absent for other statuses. */
  charges?: number;
}
