import {iceSpellGround,freezeSpellGround} from './ice-terrain';
import {hasLegalSilenceResponse} from './silence-eligibility';
import { exchangeHandCard, cardClassAllowed } from './hand-trade';
import { missingRivalZone } from './rival-zones';
import { resurrectionChoices } from './resurrection';
import { triggerCardCurse } from './cancellation';
import { recoveryChoices, recoverToHand } from './recovery';
import {areHostile} from '../board/occupancy';
import {manhattan} from '../core/position';
import {worldFrozenCard,worldFrozen} from './world-frozen';
import {isThunderCard} from './card-family';
import { effectsForCard, allCardEffects, effectiveCost } from './form-effects';
import { checkFormRequirement, checkTransformation } from '../transformations/transformations';
import { summonCapacityOf, summonUsage, summonLimitFor } from '../summons/summons';
import { getHero, isActionPrevented, isEmptyTile } from '../board/occupancy';
import type { RuleContext } from '../context';
import type { Pos } from '../core/position';
import type { Unit } from '../entities/unit';
import { fail, OK, type RuleResult } from '../result';
import type { CardDefinition, CardInstance } from './card';
import { setMovePoints } from './deck';
import { setEnergy } from './deck';
import { depthEnabled } from '../combat/qa-depth';
import { applyEffects } from './effects';
import { iceWallFits, resolveTarget } from './targeting';
import { spendMomentum } from '../combat/momentum';
import { spendFocus } from '../combat/archery';

export type Playability =
  | { ok: true; card: CardInstance; def: CardDefinition; caster: Unit }
  | Extract<RuleResult, { ok: false }>;

/** Can this card be played right now (ignoring the target)? */
export function checkPlayability(ctx: RuleContext, cardUid: string, prepaid = false): Playability {
  const card = ctx.state.player.hand.find((c) => c.uid === cardUid);
  if (!card) return fail('CARD_NOT_IN_HAND', 'Card is not in hand.') as Playability;
  if(ctx.state.player.searchBlockedCardIds?.includes(card.cardId))return fail('CARD_UNAVAILABLE_THIS_TURN','La búsqueda impide activar esta carta durante este turno.') as Playability;
  if (card.unavailableThisTurn) return fail('CARD_UNAVAILABLE_THIS_TURN', 'No disponible durante este turno.') as Playability;
  let def = ctx.content.cards[card.cardId];
  if (!def) return fail('CARD_NOT_IN_HAND', `Unknown card "${card.cardId}".`) as Playability;
  const caster = getHero(ctx.state);
  if (!caster || isActionPrevented(ctx, caster)) {
    return fail('CASTER_INCAPACITATED', 'The hero cannot act.') as Playability;
  }
  if (def.responseOnly) return fail('INVALID_TARGET', 'Esta carta solo se utiliza en una ventana de respuesta.') as Playability;
  if (def.effects.some(fx=>fx.type==='INSPECT_TOP' && (ctx.state.pileCounts?.deck ?? ctx.state.player.deck.length)<fx.count)) return fail('INVALID_TARGET','Necesitas al menos dos cartas en el mazo.') as Playability;
  const missingZone = missingRivalZone(ctx.state, def);
  if (missingZone) return fail('RIVAL_ZONE_UNAVAILABLE', `Este encuentro no dispone de ${missingZone === 'HAND' ? 'mano' : 'mazo'} rival. Esta carta necesita instancias reales en esa zona.`) as Playability;
  def=worldFrozenCard(def,caster);
  if(def.id==='winter_onset'&&(!worldFrozen(caster)||caster.statuses.some(s=>s.id==='WINTER_ONSET')))return fail('INVALID_TARGET',!worldFrozen(caster)?'Requiere tu propio Mundo Gélido activo.':'Ya tienes Inicio de la Tormenta activo.') as Playability;
  if(def.id==='absolute_zero'&&worldFrozen(caster))return fail('INVALID_TARGET','Mundo Gélido ya está activo: no se renueva ni se consume otra copia.') as Playability;
  if(def.category==='ATTACK'&&caster.statuses.some(s=>s.id==='SNOW_WAR'))return fail('CASTER_INCAPACITATED','Guerra de Nieve impide jugar otras cartas ATTACK; puedes usar las demás categorías.') as Playability;
  if(caster.statuses.some(s=>s.id==='GLACIER_CLAW') && allCardEffects(def).some(fx=>['STEP_CASTER','ICE_WALK','CHARGE_CASTER','TELEPORT_CASTER','SWAP_WITH_TARGET','SWAP_PAIR'].includes(fx.type)))return fail('MOVEMENT_PREVENTED','Garra del Glaciar impide desplazamientos voluntarios; todavía puedes atacar y jugar otras cartas.') as Playability;
  if (!cardClassAllowed(card, def, caster)) return fail('WRONG_CLASS', 'Esta carta pertenece a otra clase.') as Playability;
  const formRequirement = checkFormRequirement(caster, def.requiredForms, ctx.content);
  if (!formRequirement.ok) return formRequirement as Playability;
  for (const fx of allCardEffects(def)) {
    if (fx.type !== 'TRANSFORM') continue;
    const valid = checkTransformation(ctx.content, caster, fx.formId);
    if (!valid.ok) return valid as Playability;
  }
  for(const fx of effectsForCard(ctx.content,caster,def))if(fx.type==='SUMMON'){
    const summon=ctx.content.summons?.[fx.summonId];
    const limit = summon && summonLimitFor(summon, caster);
    if(summon && limit !== undefined && ctx.state.units.filter(u=>u.defId===summon.id&&u.summon?.ownerId===caster.id).length>=limit)
      return fail('SUMMON_CAPACITY','Ya tienes el máximo de esta invocación.') as Playability;
  }
  const needed = (def.formEffects ? effectsForCard(ctx.content, caster, def) : def.effects).reduce((n, fx) => n + (fx.type === 'SUMMON' ? (ctx.content.summons?.[fx.summonId]?.capacityCost ?? Infinity) : 0), 0);
  const capacity = summonCapacityOf(ctx.content, caster);
  if (needed > 0 && summonUsage(ctx.state, caster.id) + needed > capacity)
    return fail('SUMMON_CAPACITY', 'Capacidad de invocación insuficiente.') as Playability;
  if(caster.statuses.some(s=>s.id==='FROZEN') && allCardEffects(def).some(fx=>fx.type==='ICE_WALK'||fx.type==='STEP_CASTER'||fx.type==='CHARGE_CASTER') && ctx.state.player.movePoints<1)
    return fail('MOVEMENT_PREVENTED','Congelado requiere 1 PM para el próximo movimiento voluntario.') as Playability;
  const { cost } = effectiveCost(ctx.content, caster, def);
  if (!prepaid && ctx.state.player.energy < cost) {
    return fail('NOT_ENOUGH_ENERGY', `Needs ${cost} energy.`) as Playability;
  }
  if (def.minCasterHp && caster.hp < def.minCasterHp)
    return fail('NOT_ENOUGH_HP', `Necesita al menos ${def.minCasterHp} PV.`) as Playability;
  // Única = once per battle, even if a forged deck, copy or regenerated instance holds another one.
  if (def.unique && ctx.state.player.banished?.some((c) => def.id === c.cardId))
    return fail('UNIQUE_ALREADY_USED', 'Esta carta Única ya se usó en este combate.') as Playability;
  if (def.focusCost && (caster.focus?.value ?? 0) < def.focusCost)
    return fail('NOT_ENOUGH_FOCUS', `Necesita ${def.focusCost} de Concentración.`) as Playability;
  if (def.handTrade && (ctx.state.player.hand.length<2 || (ctx.state.duel?.other.hand.length ?? ctx.state.pileCounts?.opponentHand ?? 0)<1)) return fail('INVALID_TARGET','Ambos jugadores necesitan una carta real para intercambiar.') as Playability;
  if (def.discardHandCost && ctx.state.player.hand.length <= 1) return fail('INVALID_TARGET', 'Necesitas otra carta propia para pagar el descarte.') as Playability;
  if (def.effects.some(effect => effect.type === 'SUMMON_SCORPION_SACRIFICE') && (caster.hp < 2 || summonUsage(ctx.state, caster.id) + 2 > summonCapacityOf(ctx.content, caster)))
    return fail('INVALID_TARGET', 'El sacrificio necesita al menos 2 HP y dos puntos de capacidad disponibles.') as Playability;
  if (def.effects.some(effect => effect.type === 'RESURRECT_SUMMON') && !resurrectionChoices(ctx).length)
    return fail('INVALID_TARGET', 'No hay una invocación muerta, propia y recuperable con capacidad disponible.') as Playability;
  // Private client snapshots expose counts and public champions, never either deck or rival hand.
  // The authoritative branch keeps validating the actual instances (including hidden curses).
  const rivalHeroId = ctx.state.duel?.other.heroId ?? (ctx.state.pileCounts
    ? ctx.state.units.find(unit => unit.kind === 'HERO' && areHostile(caster, unit))?.id : undefined);
  if (def.effects.some(effect => effect.type === 'EXECUTIONER_ROULETTE') && !ctx.state.units.some(unit => unit.id === rivalHeroId))
    return fail('INVALID_TARGET', 'No hay un campeón rival elegible.') as Playability;
  if (def.effects.some(effect => effect.type === 'DISCARD_OPPONENT' && (effect.from === 'HAND' ? ctx.state.duel?.other.hand.length ?? ctx.state.pileCounts?.opponentHand ?? 0 : ctx.state.duel?.other.deck.length ?? ctx.state.pileCounts?.opponentDeck ?? 0) < (effect.requireFullCount ? effect.count : 1)))
    return fail('INVALID_TARGET', 'El rival no tiene cartas en la zona requerida.') as Playability;
  if (def.effects.some(effect => effect.type === 'CHOOSE_TOP_TO_BOTTOM' && (ctx.state.pileCounts?.deck ?? ctx.state.player.deck.length) < effect.count))
    return fail('INVALID_TARGET', 'El mazo no contiene suficientes cartas para esta elección.') as Playability;
  if (def.effects.some(effect => effect.type === 'REDRAW_HAND') && ctx.state.player.hand.length <= 1)
    return fail('INVALID_TARGET', 'Necesitas otra carta en la mano.') as Playability;
  if (def.effects.some(effect => effect.type === 'CURSE_RANDOM_OPPONENT_DECK') && !(ctx.state.duel ? ctx.state.duel.other.deck.some(instance => !instance.twistedCurse) : (ctx.state.pileCounts?.opponentDeck ?? 0) > 0))
    return fail('INVALID_TARGET', 'No hay instancias elegibles en el mazo rival.') as Playability;
  if (def.effects.some(effect => effect.type === 'FIXED_HP_SACRIFICE' && caster.hp <= effect.amount))
    return fail('NOT_ENOUGH_HP', 'El sacrificio debe dejar al menos 1 HP.') as Playability;
  if (def.effects.some(effect => effect.type === 'WARRIOR_BLOOD_PACT') && (caster.warriorPact || ctx.state.player.maxMovePoints <= 1))
    return fail('INVALID_TARGET', 'El pacto ya está activo o dejaría el movimiento máximo por debajo de 1.') as Playability;
  if (def.effects.some(effect => effect.type === 'RECOVER_RANDOM_TO_DECK') && !recoveryChoices(ctx.state, ctx.content).length)
    return fail('INVALID_TARGET', 'No hay instancias recuperables en tu cementerio.') as Playability;
  if (def.discardSearch && !discardSearchChoices(ctx.state, ctx.content, def).length)
    return fail('NO_ELIGIBLE_PIECE', def.discardSearch === 'ANY_ONCE' ? 'No hay instancias recuperables en tu cementerio.' : 'No hay piezas de ritual en tu descarte.') as Playability;
  if (def.deckSearch) {
    // Explicit product rule: six cards before playing blocks the search, even though it consumes itself.
    if (ctx.state.player.hand.length >= ctx.state.player.maxHandSize)
      return fail('SEARCH_HAND_FULL', 'La mano ya tiene seis cartas.') as Playability;
    if(typeof def.deckSearch==='object')for(const condition of def.deckSearch.conditions??[]){
      const allowed=condition==='CASTER_DAMAGED'?caster.hp<caster.maxHp:
        condition==='THUNDER_IN_HAND'?ctx.state.player.hand.some(c=>c.cardId!==def.id&&ctx.content.cards[c.cardId]&&isThunderCard(ctx.content.cards[c.cardId]!)):
        condition==='OWN_SUMMON'?ctx.state.units.some(u=>u.hp>0&&u.summon?.ownerId===caster.id):
        condition==='GUARD'?caster.shield>=1:
        !ctx.state.units.some(u=>u.hp>0&&areHostile(caster,u)&&manhattan(caster.pos,u.pos)===1);
      if(!allowed)return fail('INVALID_TARGET','No se cumplen las condiciones de este buscador.') as Playability;
    }
    if(typeof def.deckSearch==='object'&&(ctx.state.player.searchUsesThisTurn?.[def.id]??0)>=def.deckSearch.maxUsesPerTurn)return fail('INVALID_TARGET','Este buscador ya se utilizó durante este turno.') as Playability;
    if (!summonSearchChoices(ctx.state, ctx.content,def).length)
      return fail('NO_ELIGIBLE_SUMMON', typeof def.deckSearch==='object'?'No hay una carta objetivo válida en el mazo.':'No hay invocaciones en el mazo.') as Playability;
  }
  return { ok: true, card, def, caster };
}

/**
 * Validate → pay → resolve effects → discard. Emits CARD_PLAYED before any effect event so
 * the presentation can play a cast animation first.
 */
export function playCard(ctx: RuleContext, cardUid: string, target: Pos | null, searchUid?: string, secondary?: Pos | null, wallOrientation?: import('./targeting').WallOrientation, resolution?: 'PREPAID'): RuleResult {
  const prepaid = resolution === 'PREPAID';
  const check = checkPlayability(ctx, cardUid, prepaid);
  if (!check.ok) return check;
  if (missingRivalZone(ctx.state, check.def, true)) return fail('RIVAL_ZONE_UNAVAILABLE', 'Este encuentro no dispone de las instancias rivales necesarias.');
  const { card, def, caster } = check;
  const found = searchUid && def.deckSearch ? ctx.state.player.deck.find(c => c.uid === searchUid) : undefined;
  // Eco del Altar: the chosen uid must be a ritual piece in THIS player's real discard pile now.
  const tradeCard = searchUid && def.handTrade ? ctx.state.player.hand.find(copy=>copy.uid===searchUid && copy.uid!==cardUid) : undefined;
  if (def.handTrade && (!tradeCard || !ctx.state.duel?.other.hand.length)) return fail('INVALID_TARGET','Elige otra carta de tu mano; el rival necesita una mano real.');
  const fromHandCost = searchUid && def.discardHandCost ? ctx.state.player.hand.find(copy => copy.uid === searchUid && copy.uid !== cardUid) : undefined;
  const fromDiscard = searchUid && def.discardSearch ? discardSearchChoices(ctx.state, ctx.content, def).find(c => c.uid === searchUid) : undefined;
  if (def.handTrade ? !tradeCard : def.discardHandCost ? !fromHandCost : def.discardSearch ? !fromDiscard : def.deckSearch ? !found || !eligibleSearch(found, ctx.content, caster.defId,def) : searchUid !== undefined)
    return fail('INVALID_TARGET', def.discardSearch ? 'Elige una instancia recuperable de tu cementerio.' : 'Elige una invocación válida del mazo.');

  if (wallOrientation !== undefined && (!['ice_wall','glacial_field'].includes(def.id) || !['HORIZONTAL','VERTICAL'].includes(wallOrientation))) return fail('INVALID_TARGET', 'Orientación no permitida.');
  const resolved = resolveTarget(ctx, caster, def.targeting, target, secondary, wallOrientation);
  if (!resolved) return fail('INVALID_TARGET', `Invalid target for ${def.name}.`);

  if (def.id==='ice_wall' && wallOrientation && !iceWallFits(ctx,resolved.affectedTiles)) return fail('INVALID_TARGET', 'La barrera necesita tres casillas libres y transitables.');
  const selectedEffects = effectsForCard(ctx.content, caster, def);
  if (selectedEffects.some((fx) => fx.type === 'SUMMON') && !isEmptyTile(ctx, resolved.impact))
    return fail('INVALID_TARGET', 'La invocación necesita una casilla vacía y transitable.');
  const { player } = ctx.state;
  // Momentum payoff is decided now, from the authoritative state (never from the client).
  const empowered = !!def.empowered && (caster.momentum?.value ?? 0) >= def.empowered.momentum;
  // Pending discount decided from the authoritative state before payment; spent with the card.
  const price = effectiveCost(ctx.content, caster, def);
  const incarnation=caster.statuses.find(s=>ctx.content.statuses[s.id]?.thunderEconomy);
  const thunder=isThunderCard(def);
  if (!prepaid) {
    if(incarnation && thunder) incarnation.discountUsed=true;
    setEnergy(ctx, player.energy - price.cost);
    if (price.scope) {
      caster.costDiscounts = caster.costDiscounts!.filter((discount) => discount.scope !== price.scope);
      if (!caster.costDiscounts.length) delete caster.costDiscounts;
      ctx.emit({ type: 'COST_DISCOUNT_USED', unitId: caster.id, scope: price.scope, cardId: def.id, paid: price.cost });
    }
    ctx.state.stats.cardsPlayed += 1;
    if (ctx.state.duel?.darkLightRelease && !card.twistedCurse && hasLegalSilenceResponse(ctx)) {
      const id = `cast-${ctx.state.nextId++}`;
      ctx.state.pendingCast = { id, cardUid, cardId: def.id, casterId: caster.id, respondingHeroId: ctx.state.duel.other.heroId, target: target ? { ...target } : null, searchUid, secondary: secondary ? { ...secondary } : secondary, wallOrientation, paidEnergy: price.cost, deadline: 0 };
      ctx.emit({ type: 'CARD_CAST_PENDING', cardUid, cardId: def.id, casterId: caster.id, windowId: id });
      return OK;
    }
  }
  player.hand = player.hand.filter((copy) => copy.uid !== card.uid);

  if (card.twistedCurse) { triggerCardCurse(ctx, player, card, def, caster); return OK; }

  if (fromHandCost) {
    player.hand = player.hand.filter(copy => copy.uid !== fromHandCost.uid);
    delete fromHandCost.publicDiscard;
    player.discard.push(fromHandCost);
    ctx.emit({ type: 'CARD_DISCARDED', cardUid: fromHandCost.uid, cardId: fromHandCost.cardId, reason: 'EFFECT' });
  }

  ctx.emit({
    type: 'CARD_PLAYED',
    cardUid: card.uid,
    cardId: def.id,
    ...(def.worldFrozenActive?{worldFrozen:true}:{}),
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

  if (tradeCard) exchangeHandCard(ctx,tradeCard.uid);
  if (found) {
    player.deck = player.deck.filter(c => c.uid !== found.uid);
    delete found.publicDiscard;
    found.unavailableThisTurn = true;
    if(typeof def.deckSearch==='object'){
      (player.searchUsesThisTurn??={})[def.id]=(player.searchUsesThisTurn?.[def.id]??0)+1;
      player.searchBlockedCardIds=[...new Set([...(player.searchBlockedCardIds??[]),def.deckSearch.targetCardId])];
    }
    player.hand.push(found);
    ctx.emit({type:'CARD_DRAWN',cardUid:found.uid,cardId:found.cardId});
  }
  if (fromDiscard) {
    recoverToHand(ctx, fromDiscard.uid, def.discardSearch, def.discardSearch === 'RITUAL_PIECE');
  }
  const directAttack = def.targeting.type === 'UNIT' && !def.targeting.area ? (def.targeting.range === 1 ? 'DIRECT_MELEE' as const : depthEnabled(ctx) ? 'DIRECT_RANGED' as const : undefined) : undefined;
  const ground=iceSpellGround(def,resolved,selectedEffects);
  const obstaclesBefore=ground.length&&selectedEffects.some(e=>e.type==='CREATE_OBSTACLE')?new Set(ctx.state.obstacles.map(o=>o.id)):null;
  applyEffects({ ctx, caster, resolved, directAttack, cardId: def.id, cardUid: card.uid }, selectedEffects);
  const actualGround=obstaclesBefore?ctx.state.obstacles.filter(o=>!obstaclesBefore.has(o.id)).map(o=>o.pos):ground;
  if(ground.length)freezeSpellGround(ctx,actualGround,caster.id);

  if (def.unique) {
    // Única: once per battle. Banished, so no recycle, search or second copy can bring it back.
    (player.banished ??= []).push(card);
    ctx.emit({ type: 'CARD_BANISHED', cardUid: card.uid, cardId: def.id });
  } else {
    card.publicDiscard=true;
    player.discard.push(card);
    ctx.emit({ type: 'CARD_DISCARDED', cardUid: card.uid, cardId: def.id, reason: 'PLAYED' });
  }
  // The activating card does not trigger its own state; rejected cards never reach this hook.
  if(incarnation && thunder && ctx.state.units.includes(caster) && !ctx.state.outcome) {
    incarnation.triggerCount=(incarnation.triggerCount??0)+1;
    setMovePoints(ctx,player.movePoints+1);
    if(!incarnation.stepUsed) incarnation.stepReady=true;
    ctx.emit({type:'LEGENDARY_TRIGGER',unitId:caster.id,status:incarnation.id,kind:'THUNDER',amount:1,pos:caster.pos});
  }
  if (player.pendingCardChoice) player.pendingCardChoice.sourceCardUid = card.uid;
  else ctx.emit({ type: 'CARD_RESOLVED', cardUid: card.uid, cardId: def.id });
  return OK;
}

function eligibleSearch(card: CardInstance, content: import('../content').GameContent, heroId: string,search?:CardDefinition): boolean {
  const def = content.cards[card.cardId];
  return !!def && (!def.heroId || def.heroId === heroId) && (typeof search?.deckSearch==='object'?card.cardId===search.deckSearch.targetCardId:def.effects.some(fx => fx.type === 'SUMMON'));
}
/** Sorted private candidates, never shuffled and never drawn from discard. */
export function summonSearchChoices(state: Readonly<import('../state').GameState>, content: import('../content').GameContent,search?:CardDefinition): CardInstance[] {
  const hero = state.units.find(u => u.id === state.player.heroId);
  const deck = state.pileCounts ? state.searchChoices ?? [] : state.player.deck;
  const definitions=search?[search]:state.player.hand.flatMap(c=>content.cards[c.cardId]?.deckSearch?[content.cards[c.cardId]!]:[]);
  return deck.filter(c => definitions.length?definitions.some(d=>eligibleSearch(c,content,hero?.defId??'',d)):eligibleSearch(c,content,hero?.defId??'')).slice()
    .sort((a,b) => (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
}

/** Eco del Altar choices: ritual pieces in the player's own discard pile, most recent first. */
export function discardSearchChoices(state: Readonly<import('../state').GameState>, content: import('../content').GameContent, search?: CardDefinition): CardInstance[] {
  return recoveryChoices(state, content, search?.discardSearch ?? 'RITUAL_PIECE');
}
