import { effectsForCard, allCardEffects, effectiveCost } from './form-effects';
import { checkFormRequirement, checkTransformation } from '../transformations/transformations';
import { summonCapacityOf, summonUsage } from '../summons/summons';
import { getHero, isActionPrevented, isEmptyTile } from '../board/occupancy';
import type { RuleContext } from '../context';
import type { Pos } from '../core/position';
import type { Unit } from '../entities/unit';
import { fail, OK, type RuleResult } from '../result';
import type { CardDefinition, CardInstance } from './card';
import { setEnergy } from './deck';
import { depthEnabled } from '../combat/qa-depth';
import { applyEffects } from './effects';
import { resolveTarget } from './targeting';
import { spendMomentum } from '../combat/momentum';
import { spendFocus } from '../combat/archery';

export type Playability =
  | { ok: true; card: CardInstance; def: CardDefinition; caster: Unit }
  | Extract<RuleResult, { ok: false }>;

/** Can this card be played right now (ignoring the target)? */
export function checkPlayability(ctx: RuleContext, cardUid: string): Playability {
  const card = ctx.state.player.hand.find((c) => c.uid === cardUid);
  if (!card) return fail('CARD_NOT_IN_HAND', 'Card is not in hand.') as Playability;
  if (card.unavailableThisTurn) return fail('CARD_UNAVAILABLE_THIS_TURN', 'No disponible durante este turno.') as Playability;
  const def = ctx.content.cards[card.cardId];
  if (!def) return fail('CARD_NOT_IN_HAND', `Unknown card "${card.cardId}".`) as Playability;
  const caster = getHero(ctx.state);
  if (!caster || isActionPrevented(ctx, caster)) {
    return fail('CASTER_INCAPACITATED', 'The hero cannot act.') as Playability;
  }
  if (def.heroId && def.heroId !== caster.defId) return fail('WRONG_CLASS', 'Esta carta pertenece a otra clase.') as Playability;
  const formRequirement = checkFormRequirement(caster, def.requiredForms);
  if (!formRequirement.ok) return formRequirement as Playability;
  for (const fx of allCardEffects(def)) {
    if (fx.type !== 'TRANSFORM') continue;
    const valid = checkTransformation(ctx.content, caster, fx.formId);
    if (!valid.ok) return valid as Playability;
  }
  const needed = (def.formEffects ? effectsForCard(ctx.content, caster, def) : def.effects).reduce((n, fx) => n + (fx.type === 'SUMMON' ? (ctx.content.summons?.[fx.summonId]?.capacityCost ?? Infinity) : 0), 0);
  const capacity = summonCapacityOf(ctx.content, caster);
  if (needed > 0 && summonUsage(ctx.state, caster.id) + needed > capacity)
    return fail('SUMMON_CAPACITY', 'Capacidad de invocación insuficiente.') as Playability;
  const { cost } = effectiveCost(ctx.content, caster, def);
  if (ctx.state.player.energy < cost) {
    return fail('NOT_ENOUGH_ENERGY', `Needs ${cost} energy.`) as Playability;
  }
  if (def.minCasterHp && caster.hp < def.minCasterHp)
    return fail('NOT_ENOUGH_HP', `Necesita al menos ${def.minCasterHp} PV.`) as Playability;
  // Única = once per battle, even if a forged deck, copy or regenerated instance holds another one.
  if (def.unique && ctx.state.player.banished?.some((c) => def.id === c.cardId))
    return fail('UNIQUE_ALREADY_USED', 'Esta carta Única ya se usó en este combate.') as Playability;
  if (def.focusCost && (caster.focus?.value ?? 0) < def.focusCost)
    return fail('NOT_ENOUGH_FOCUS', `Necesita ${def.focusCost} de Concentración.`) as Playability;
  if (def.discardSearch && !discardSearchChoices(ctx.state, ctx.content).length)
    return fail('NO_ELIGIBLE_PIECE', 'No hay piezas de ritual en tu descarte.') as Playability;
  if (def.deckSearch) {
    // Explicit product rule: six cards before playing blocks the search, even though it consumes itself.
    if (ctx.state.player.hand.length >= ctx.state.player.maxHandSize)
      return fail('SEARCH_HAND_FULL', 'La mano ya tiene seis cartas.') as Playability;
    if (!summonSearchChoices(ctx.state, ctx.content).length)
      return fail('NO_ELIGIBLE_SUMMON', 'No hay invocaciones en el mazo.') as Playability;
  }
  return { ok: true, card, def, caster };
}

/**
 * Validate → pay → resolve effects → discard. Emits CARD_PLAYED before any effect event so
 * the presentation can play a cast animation first.
 */
export function playCard(ctx: RuleContext, cardUid: string, target: Pos | null, searchUid?: string, secondary?: Pos | null): RuleResult {
  const check = checkPlayability(ctx, cardUid);
  if (!check.ok) return check;
  const { card, def, caster } = check;
  const found = searchUid && def.deckSearch ? ctx.state.player.deck.find(c => c.uid === searchUid) : undefined;
  // Eco del Altar: the chosen uid must be a ritual piece in THIS player's real discard pile now.
  const fromDiscard = searchUid && def.discardSearch ? discardSearchChoices(ctx.state, ctx.content).find(c => c.uid === searchUid) : undefined;
  if (def.discardSearch ? !fromDiscard : def.deckSearch ? !found || !eligibleSummon(found, ctx.content, caster.defId) : searchUid !== undefined)
    return fail('INVALID_TARGET', def.discardSearch ? 'Elige una pieza de ritual de tu descarte.' : 'Elige una invocación válida del mazo.');

  const resolved = resolveTarget(ctx, caster, def.targeting, target, secondary);
  if (!resolved) return fail('INVALID_TARGET', `Invalid target for ${def.name}.`);

  const selectedEffects = effectsForCard(ctx.content, caster, def);
  if (selectedEffects.some((fx) => fx.type === 'SUMMON') && !isEmptyTile(ctx, resolved.impact))
    return fail('INVALID_TARGET', 'La invocación necesita una casilla vacía y transitable.');
  const { player } = ctx.state;
  // Momentum payoff is decided now, from the authoritative state (never from the client).
  const empowered = !!def.empowered && (caster.momentum?.value ?? 0) >= def.empowered.momentum;
  // Pending discount decided from the authoritative state before payment; spent with the card.
  const price = effectiveCost(ctx.content, caster, def);
  setEnergy(ctx, player.energy - price.cost);
  if (price.scope) {
    caster.costDiscounts = caster.costDiscounts!.filter((d) => d.scope !== price.scope);
    if (!caster.costDiscounts.length) delete caster.costDiscounts;
  }
  player.hand = player.hand.filter((c) => c.uid !== card.uid);
  ctx.state.stats.cardsPlayed += 1;

  ctx.emit({
    type: 'CARD_PLAYED',
    cardUid: card.uid,
    cardId: def.id,
    casterId: caster.id,
    target: resolved.target,
    impact: resolved.impact,
    affectedTiles: resolved.affectedTiles,
    direction: resolved.direction,
    ...(empowered ? { empowered: true } : {}),
  });
  if (empowered) spendMomentum(ctx, caster, def.empowered!.momentum);
  // Concentración is spent before the effects (a focus cost, or the pierce the target chose).
  const focusSpent = (def.focusCost ?? 0) + (resolved.focusSpent ?? 0);
  if (focusSpent) spendFocus(ctx, caster, focusSpent);
  if (def.targeting.type === 'LINE' && resolved.direction) {
    ctx.emit({
      type: 'PROJECTILE_LAUNCHED',
      sourceId: caster.id,
      from: caster.pos,
      to: resolved.impact,
      direction: resolved.direction,
      hitUnitId: resolved.hitUnitId,
    });
  }

  if (found) {
    player.deck = player.deck.filter(c => c.uid !== found.uid);
    found.unavailableThisTurn = true;
    player.hand.push(found);
    ctx.emit({type:'CARD_DRAWN',cardUid:found.uid,cardId:found.cardId});
  }
  if (fromDiscard) {
    // Same lock as the deck search: not playable and not sealable until the next own turn.
    player.discard = player.discard.filter(c => c.uid !== fromDiscard.uid);
    fromDiscard.unavailableThisTurn = true;
    player.hand.push(fromDiscard);
    // CARD_DRAWN is private in PvP (duelEvents hides it from the rival).
    ctx.emit({type:'CARD_DRAWN',cardUid:fromDiscard.uid,cardId:fromDiscard.cardId});
  }
  const directAttack = def.targeting.type === 'UNIT' && !def.targeting.area ? (def.targeting.range === 1 ? 'DIRECT_MELEE' as const : depthEnabled(ctx) ? 'DIRECT_RANGED' as const : undefined) : undefined;
  if (price.scope) ctx.emit({ type: 'COST_DISCOUNT_USED', unitId: caster.id, scope: price.scope, cardId: def.id, paid: price.cost });
  applyEffects({ ctx, caster, resolved, directAttack, cardId: def.id }, selectedEffects);

  if (def.unique) {
    // Única: once per battle. Banished, so no recycle, search or second copy can bring it back.
    (player.banished ??= []).push(card);
    ctx.emit({ type: 'CARD_BANISHED', cardUid: card.uid, cardId: def.id });
  } else {
    player.discard.push(card);
    ctx.emit({ type: 'CARD_DISCARDED', cardUid: card.uid, cardId: def.id, reason: 'PLAYED' });
  }
  ctx.emit({ type: 'CARD_RESOLVED', cardUid: card.uid, cardId: def.id });
  return OK;
}

function eligibleSummon(card: CardInstance, content: import('../content').GameContent, heroId: string): boolean {
  const def = content.cards[card.cardId];
  return !!def && (!def.heroId || def.heroId === heroId) && def.effects.some(fx => fx.type === 'SUMMON');
}
/** Sorted private candidates, never shuffled and never drawn from discard. */
export function summonSearchChoices(state: Readonly<import('../state').GameState>, content: import('../content').GameContent): CardInstance[] {
  const hero = state.units.find(u => u.id === state.player.heroId);
  const deck = state.pileCounts ? state.searchChoices ?? [] : state.player.deck;
  return deck.filter(c => eligibleSummon(c,content,hero?.defId ?? '')).slice()
    .sort((a,b) => (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
}

/** Eco del Altar choices: ritual pieces in the player's own discard pile, most recent first. */
export function discardSearchChoices(state: Readonly<import('../state').GameState>, content: import('../content').GameContent): CardInstance[] {
  return state.player.discard.filter(c => content.cards[c.cardId]?.ritualPiece).reverse();
}
