import { checkFormRequirement } from '../transformations/transformations';
import { getHero, isActionPrevented, isEmptyTile } from '../board/occupancy';
import type { CardDefinition, CardInstance } from '../cards/card';
import { setEnergy } from '../cards/deck';
import { applyEffects } from '../cards/effects';
import { resolveTarget, type ResolvedTarget } from '../cards/targeting';
import { defeatUnit } from '../combat/damage';
import type { GameContent } from '../content';
import type { RuleContext } from '../context';
import type { Pos } from '../core/position';
import type { Unit } from '../entities/unit';
import { fail, OK, type RuleResult } from '../result';
import type { PlayerState } from '../state';
import { summonCapacityOf, summonUsage } from '../summons/summons';
import type { RitualDef } from './ritual';

/**
 * RITUAL RULES
 *
 * Direct summons are one card → one creature. Rituals are assembled pieces → one stronger creature:
 *   COMMIT_RITUAL_PIECE  hand → altar (first seal of the turn 0 energy, each further seal
 *                        `altarSealing.extraEnergy`; no duplicate ids)
 *   RELEASE_RITUAL_PIECE altar → discard (abandon a piece; never back to the hand)
 *   ACTIVATE_RITUAL      every piece on the altar + energy + capacity + legal target →
 *                        pieces go to the discard pile, the result resolves.
 * Consumed and released pieces use the ordinary discard pile (no new zone): they only return
 * through a reshuffle, which costs Arcane Fatigue.
 *
 * The altar is part of the private player state (like the hand), so it survives reconnects
 * and replays, and PvP projections only reveal its size.
 */

export const altarOf = (player: Readonly<PlayerState>): readonly CardInstance[] => player.altar ?? [];

export const altarSlots = (content: GameContent, heroDefId: string): number => content.heroes[heroDefId]?.altarSlots ?? 0;

/** Sealing pace of a champion (`HeroDef.altarSealing`, default: first seal free, then 1 energy). */
export function altarSealing(content: GameContent, heroDefId: string): { freePerTurn: number; extraEnergy: number } {
  return content.heroes[heroDefId]?.altarSealing ?? { freePerTurn: 1, extraEnergy: 1 };
}

/** Energy the next seal costs this turn. */
export function nextSealCost(content: GameContent, heroDefId: string, player: Readonly<PlayerState>): number {
  const rule = altarSealing(content, heroDefId);
  return (player.altarSeals ?? 0) < rule.freePerTurn ? 0 : rule.extraEnergy;
}

/** Rituals that use `cardId` as a piece ("Parte de: …"), in content order. */
export function ritualsUsingPiece(content: GameContent, cardId: string): RitualDef[] {
  return Object.values(content.rituals ?? {}).filter((r) => r.pieces.includes(cardId));
}

/** Capacity the ritual's result occupies (sum of its SUMMON effects). */
export function ritualCapacityCost(content: GameContent, ritual: RitualDef): number {
  return ritual.result.effects.reduce(
    (n, fx) => n + (fx.type === 'SUMMON' ? (content.summons?.[fx.summonId]?.capacityCost ?? Infinity) : 0),
    0,
  );
}

export interface RitualProgress {
  ritual: RitualDef;
  /** Piece ids already sealed on the altar. */
  sealed: string[];
  /** Piece ids still missing from the altar (ids only: the player's own data). */
  missing: string[];
  complete: boolean;
}

/** Progress of every ritual of this champion given its own altar. Never call it with a rival's state. */
export function ritualProgress(content: GameContent, heroDefId: string, player: Readonly<PlayerState>): RitualProgress[] {
  const onAltar = new Set(altarOf(player).map((c) => c.cardId));
  return Object.values(content.rituals ?? {})
    .filter((r) => r.heroId === heroDefId)
    .map((ritual) => {
      const sealed = ritual.pieces.filter((id) => onAltar.has(id));
      const missing = ritual.pieces.filter((id) => !onAltar.has(id));
      return { ritual, sealed, missing, complete: missing.length === 0 };
    });
}

type Caster = { ok: true; caster: Unit } | Extract<RuleResult, { ok: false }>;

function activeCaster(ctx: RuleContext): Caster {
  const caster = getHero(ctx.state);
  if (!caster || isActionPrevented(ctx, caster)) return fail('CASTER_INCAPACITATED', 'The hero cannot act.') as Caster;
  return { ok: true, caster };
}

export type CommitCheck =
  | { ok: true; card: CardInstance; def: CardDefinition; caster: Unit; energyCost: number }
  | Extract<RuleResult, { ok: false }>;

/** Can this hand card be sealed onto the altar right now? */
export function checkCommit(ctx: RuleContext, cardUid: string): CommitCheck {
  const { player } = ctx.state;
  const card = player.hand.find((c) => c.uid === cardUid);
  const def = card && ctx.content.cards[card.cardId];
  if (!card || !def) return fail('CARD_NOT_IN_HAND', 'Card is not in hand.') as CommitCheck;
  if (card.unavailableThisTurn) return fail('CARD_UNAVAILABLE_THIS_TURN', 'No disponible durante este turno.') as CommitCheck;
  const who = activeCaster(ctx);
  if (!who.ok) return who;
  if (!def.ritualPiece) return fail('NOT_A_RITUAL_PIECE', 'Esta carta no es una pieza de ritual.') as CommitCheck;
  if (def.heroId && def.heroId !== who.caster.defId) return fail('WRONG_CLASS', 'Esta carta pertenece a otra clase.') as CommitCheck;
  const formRequirement = checkFormRequirement(who.caster, def.requiredForms);
  if (!formRequirement.ok) return formRequirement;
  const slots = altarSlots(ctx.content, who.caster.defId);
  if (slots <= 0) return fail('NO_ALTAR', 'Este campeón no tiene altar.') as CommitCheck;
  const altar = altarOf(player);
  if (altar.length >= slots) return fail('ALTAR_FULL', 'El altar está lleno.') as CommitCheck;
  if (new Set(altar.map((c) => c.cardId)).has(card.cardId)) return fail('ALTAR_DUPLICATE', 'Esa pieza ya está en el altar.') as CommitCheck;
  const energyCost = nextSealCost(ctx.content, who.caster.defId, player);
  if (player.energy < energyCost)
    return fail('NOT_ENOUGH_ENERGY', `Sellar otra pieza este turno cuesta ${energyCost} de energía.`) as CommitCheck;
  return { ok: true, card, def, caster: who.caster, energyCost };
}

export function commitRitualPiece(ctx: RuleContext, cardUid: string): RuleResult {
  const check = checkCommit(ctx, cardUid);
  if (!check.ok) return check;
  const { player } = ctx.state;
  setEnergy(ctx, player.energy - check.energyCost);
  player.hand = player.hand.filter((c) => c.uid !== cardUid);
  player.altar = [...altarOf(player), check.card];
  player.altarSeals = (player.altarSeals ?? 0) + 1;
  ctx.emit({
    type: 'RITUAL_PIECE_COMMITTED',
    casterId: check.caster.id,
    cardUid: check.card.uid,
    cardId: check.card.cardId,
    altarSize: player.altar.length,
    energyCost: check.energyCost,
  });
  return OK;
}

/** Abandon a sealed piece: it goes to the discard pile (not back to the hand). Free. */
export function releaseRitualPiece(ctx: RuleContext, cardUid: string): RuleResult {
  const who = activeCaster(ctx);
  if (!who.ok) return who;
  const { player } = ctx.state;
  const card = altarOf(player).find((c) => c.uid === cardUid);
  if (!card) return fail('PIECE_NOT_ON_ALTAR', 'Esa pieza no está en tu altar.');
  player.altar = altarOf(player).filter((c) => c.uid !== cardUid);
  player.discard.push(card);
  ctx.emit({ type: 'RITUAL_PIECE_RELEASED', casterId: who.caster.id, cardUid: card.uid, cardId: card.cardId, altarSize: player.altar.length });
  return OK;
}

export type RitualCheck = { ok: true; ritual: RitualDef; caster: Unit } | Extract<RuleResult, { ok: false }>;

/** Can this ritual be activated right now (ignoring the target)? Same checks the server runs. */
export function checkRitual(ctx: RuleContext, ritualId: string): RitualCheck {
  const ritual = Object.hasOwn(ctx.content.rituals ?? {}, ritualId) ? ctx.content.rituals![ritualId] : undefined;
  if (!ritual) return fail('UNKNOWN_RITUAL', `Unknown ritual "${ritualId}".`) as RitualCheck;
  const who = activeCaster(ctx);
  if (!who.ok) return who;
  if (ritual.heroId !== who.caster.defId) return fail('WRONG_CLASS', 'Este ritual pertenece a otra clase.') as RitualCheck;
  const { player } = ctx.state;
  const onAltar = new Set(altarOf(player).map((c) => c.cardId));
  if (!ritual.pieces.every((id) => onAltar.has(id))) return fail('RITUAL_INCOMPLETE', 'Faltan piezas en el altar.') as RitualCheck;
  const done = (player.ritualsResolved ?? []).filter((id) => id === ritual.id).length;
  if (ritual.limitPerBattle !== undefined && done >= ritual.limitPerBattle)
    return fail('RITUAL_LIMIT', 'Este ritual ya se completó en este combate.') as RitualCheck;
  const needed = ritualCapacityCost(ctx.content, ritual);
  const capacity = summonCapacityOf(ctx.content, who.caster);
  const used = ritual.dismissSummons ? 0 : summonUsage(ctx.state, who.caster.id);
  if (needed > 0 && used + needed > capacity)
    return fail('SUMMON_CAPACITY', 'Capacidad de invocación insuficiente.') as RitualCheck;
  if (player.energy < ritual.energyCost) return fail('NOT_ENOUGH_ENERGY', `Needs ${ritual.energyCost} energy.`) as RitualCheck;
  return { ok: true, ritual, caster: who.caster };
}

/** Validates the target exactly as resolution will use it. */
export function resolveRitualTarget(ctx: RuleContext, check: Extract<RitualCheck, { ok: true }>, target: Pos | null): ResolvedTarget | null {
  const resolved = resolveTarget(ctx, check.caster, check.ritual.targeting, target);
  if (!resolved) return null;
  if (check.ritual.result.effects.some((fx) => fx.type === 'SUMMON') && !isEmptyTile(ctx, resolved.impact)) return null;
  return resolved;
}

/**
 * Validate → pay → consume pieces → (sacrifice) → resolve. Every check happens before the
 * first mutation, so a rejected activation changes nothing.
 */
export function activateRitual(ctx: RuleContext, ritualId: string, target: Pos | null): RuleResult {
  const check = checkRitual(ctx, ritualId);
  if (!check.ok) return check;
  const resolved = resolveRitualTarget(ctx, check, target);
  if (!resolved) return fail('INVALID_TARGET', `Invalid target for ${check.ritual.name}.`);
  const { ritual, caster } = check;
  const { player } = ctx.state;

  setEnergy(ctx, player.energy - ritual.energyCost);
  // Consume exactly one sealed copy of each required piece (the altar never holds duplicates).
  const consumed: CardInstance[] = [];
  let altar = [...altarOf(player)];
  for (const pieceId of ritual.pieces) {
    const card = altar.find((c) => pieceId === c.cardId)!;
    altar = altar.filter((c) => c !== card);
    consumed.push(card);
  }
  player.altar = altar;
  player.discard.push(...consumed);
  player.ritualsResolved = [...(player.ritualsResolved ?? []), ritual.id];
  ctx.emit({
    type: 'RITUAL_ACTIVATED',
    ritualId: ritual.id,
    tier: ritual.tier,
    casterId: caster.id,
    pieces: consumed.map((c) => ({ cardUid: c.uid, cardId: c.cardId })),
    target: resolved.target,
    impact: resolved.impact,
    affectedTiles: resolved.affectedTiles,
  });
  if (ritual.dismissSummons)
    for (const unit of ctx.state.units.filter((u) => u.summon?.ownerId === caster.id)) defeatUnit(ctx, unit);
  applyEffects({ ctx, caster, resolved }, ritual.result.effects);
  ctx.emit({ type: 'RITUAL_RESOLVED', ritualId: ritual.id, casterId: caster.id });
  return OK;
}

/** The creature a ritual summons (its first SUMMON effect), for "Lobo Ancestral 2 / 3". */
export interface RitualCreature {
  summonId: string;
  name: string;
  maxHp: number;
  armor: number;
  moveRange: number;
  damage: number;
  attackRange: number;
  capacityCost: number;
}

export interface RitualStatus {
  ritualId: string;
  name: string;
  tier: RitualDef['tier'];
  /** Pieces required (2 / 3 / 4) and how many are sealed: the "2 / 3" counter. */
  required: number;
  sealedCount: number;
  sealed: string[];
  missing: string[];
  /** Pieces still to seal (`missing.length`). */
  missingCount: number;
  /** "0/4" … "3/4" while assembling, "4/4" when complete but blocked, "READY" when activatable. */
  progressLabel: string;
  complete: boolean;
  /** Complete AND activatable right now (energy, capacity, limit, own turn). */
  ready: boolean;
  /** Why a complete ritual is not ready (e.g. SUMMON_CAPACITY, NOT_ENOUGH_ENERGY). */
  blockedBy?: { code: string; message: string };
  energyCost: number;
  /** Sacrifice: activating it dismisses the caster's current summons first. */
  replacesSummons: boolean;
  creature: RitualCreature | null;
}

/** Altar state for the UI: slots, this turn's seals and the price of the next one, rituals. */
export interface AltarStatus {
  slots: number;
  used: number;
  sealsThisTurn: number;
  nextSealCost: number;
  rituals: RitualStatus[];
}

export function ritualCreature(content: GameContent, ritual: RitualDef): RitualCreature | null {
  const fx = ritual.result.effects.find((e) => e.type === 'SUMMON');
  const def = fx?.type === 'SUMMON' ? content.summons?.[fx.summonId] : undefined;
  if (!def) return null;
  return {
    summonId: def.id,
    name: def.name,
    maxHp: def.maxHp,
    armor: def.armor,
    moveRange: def.moveRange,
    damage: def.damage,
    attackRange: def.attackRange ?? 1,
    capacityCost: def.capacityCost,
  };
}

/**
 * Read-only altar summary of the ACTIVE player (own data only; never call it for a rival).
 * `ready` runs the same `checkRitual` an activation does, so the UI can never disagree with it.
 */
export function altarStatus(ctx: RuleContext): AltarStatus | null {
  const hero = getHero(ctx.state);
  if (!hero) return null;
  const slots = altarSlots(ctx.content, hero.defId);
  if (slots <= 0) return null;
  const { player } = ctx.state;
  return {
    slots,
    used: altarOf(player).length,
    sealsThisTurn: player.altarSeals ?? 0,
    nextSealCost: nextSealCost(ctx.content, hero.defId, player),
    rituals: ritualProgress(ctx.content, hero.defId, player).map((p) => {
      const check = p.complete ? checkRitual(ctx, p.ritual.id) : null;
      const ready = !!check?.ok;
      return {
        ritualId: p.ritual.id,
        name: p.ritual.name,
        tier: p.ritual.tier,
        required: p.ritual.pieces.length,
        sealedCount: p.sealed.length,
        sealed: p.sealed,
        missing: p.missing,
        missingCount: p.missing.length,
        progressLabel: ready ? 'READY' : `${p.sealed.length}/${p.ritual.pieces.length}`,
        complete: p.complete,
        ready,
        ...(check && !check.ok ? { blockedBy: { code: check.error, message: check.message } } : {}),
        energyCost: p.ritual.energyCost,
        replacesSummons: !!p.ritual.dismissSummons,
        creature: ritualCreature(ctx.content, p.ritual),
      };
    }),
  };
}
