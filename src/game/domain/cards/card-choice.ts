import { spawnSummon } from '../summons/summons';
import type { Pos } from '../core/position';
import { resurrectChosen } from './resurrection';
import type { StatusId } from '../statuses/status';
import { isMinorNegativeStatus } from '../statuses/minor-statuses';
import { removeStatus } from '../statuses/status-rules';
import type { Unit } from '../entities/unit';
import type { RuleContext } from '../context';
import type { CardInstance } from './card';
import { shuffleInPlace } from '../core/rng';
import { fail, OK, type RuleResult } from '../result';

export interface PendingCardChoice {
  kind: 'BOTTOM_TOP_CARD' | 'RETURN_HAND_CARD' | 'CLEANSE_MINOR' | 'RESURRECT' | 'SUMMON_SACRIFICE';
  position?: Pos;
  targetId?: string;
  sourceCardId: string;
  sourceCardUid?: string;
  options: { uid: string; card?: CardInstance; status?: StatusId; sacrificeHp?: number }[];
  allowKeep: boolean;
}

/** A normal authoritative command, persisted with the turn and revalidated after reconnect. */
export function resolveCardChoice(ctx: RuleContext, choiceUid: string | null): RuleResult {
  const pending = ctx.state.player.pendingCardChoice;
  if (!pending) return fail('INVALID_TARGET', 'No hay una elección pendiente.');
  if (pending.kind === 'SUMMON_SACRIFICE') {
    const choice = pending.options.find(option => option.uid === choiceUid);
    const owner = ctx.state.units.find(unit => unit.id === ctx.state.player.heroId);
    const amount = choice?.sacrificeHp;
    if (!owner || !pending.position || amount === undefined || amount < Math.ceil(owner.hp / 2) || amount >= owner.hp) return fail('INVALID_TARGET', 'Sacrificio no válido.');
    const summon = spawnSummon(ctx, owner, 'dark_scorpion_king', pending.position, pending.sourceCardUid);
    if (!summon) return fail('INVALID_TARGET', 'No hay posición o capacidad disponible.');
    owner.hp -= amount;
    summon.hp = summon.maxHp = 6 + amount;
    ctx.emit({ type: 'HP_SACRIFICED', unitId: owner.id, cardId: pending.sourceCardId, amount, hpAfter: owner.hp });
    finishChoice(ctx);
    return OK;
  }
  if (pending.kind === 'RESURRECT') {
    if (!choiceUid || !pending.position || !pending.options.some(option => option.uid === choiceUid) || !resurrectChosen(ctx, choiceUid, pending.position)) return fail('INVALID_TARGET', 'La invocación ya no es recuperable.');
    finishChoice(ctx);
    return OK;
  }
  if (pending.kind === 'CLEANSE_MINOR') {
    const choice = pending.options.find(option => option.uid === choiceUid);
    const target = ctx.state.units.find(unit => unit.id === pending.targetId);
    if (!target || !choice?.status || !isMinorNegativeStatus(choice.status) || !target.statuses.some(status => status.id === choice.status)) return fail('INVALID_TARGET', 'Estado no elegible.');
    removeStatus(ctx, target, choice.status, 'CLEANSED');
    finishChoice(ctx);
    return OK;
  }
  if (choiceUid === null) {
    if (!pending.allowKeep) return fail('INVALID_TARGET', 'Debes elegir una instancia.');
  } else {
    if (!pending.options.some(card => card.uid === choiceUid)) return fail('INVALID_TARGET', 'Instancia no elegible.');
    const zone = pending.kind === 'BOTTOM_TOP_CARD' ? ctx.state.player.deck : ctx.state.player.hand;
    const index = zone.findIndex(card => card.uid === choiceUid);
    if (index < 0) return fail('INVALID_TARGET', 'La instancia ya no está en su zona.');
    const [card] = zone.splice(index, 1);
    delete card!.publicDiscard;
    ctx.state.player.deck.push(card!);
    if (pending.kind === 'RETURN_HAND_CARD') shuffleInPlace(ctx.state, ctx.state.player.deck);
  }
  finishChoice(ctx);
  return OK;
}

export function beginCardChoice(ctx: RuleContext, sourceCardId: string, kind: 'BOTTOM_TOP_CARD' | 'RETURN_HAND_CARD', count?: number): void {
  const options = kind === 'BOTTOM_TOP_CARD' ? ctx.state.player.deck.slice(0, count) : ctx.state.player.hand.slice();
  if (!options.length) return;
  ctx.state.player.pendingCardChoice = { kind, sourceCardId, options: options.map(card => ({ uid: card.uid, card: { ...card } })), allowKeep: kind === 'BOTTOM_TOP_CARD' && count === 1 };
}


export function beginMinorCleanse(ctx: RuleContext, target: Unit, sourceCardId: string): void {
  const options = target.statuses.filter(status => isMinorNegativeStatus(status.id)).map(status => ({ uid: status.id, status: status.id }));
  if (options.length === 1) { removeStatus(ctx, target, options[0]!.status, 'CLEANSED'); return; }
  if (options.length) ctx.state.player.pendingCardChoice = { kind: 'CLEANSE_MINOR', targetId: target.id, sourceCardId, options, allowKeep: false };
}


function finishChoice(ctx: RuleContext): void {
  const pending = ctx.state.player.pendingCardChoice;
  delete ctx.state.player.pendingCardChoice;
  if (pending?.sourceCardUid) ctx.emit({ type: 'CARD_RESOLVED', cardUid: pending.sourceCardUid, cardId: pending.sourceCardId });
}

export function beginScorpionSacrifice(ctx: RuleContext, position: Pos): void {
  const owner = ctx.state.units.find(unit => unit.id === ctx.state.player.heroId);
  if (!owner || owner.hp < 2) return;
  const options = Array.from({ length: owner.hp - Math.ceil(owner.hp / 2) }, (_, index) => {
    const sacrificeHp = Math.ceil(owner.hp / 2) + index;
    return { uid: `hp:${sacrificeHp}`, sacrificeHp };
  });
  ctx.state.player.pendingCardChoice = { kind: 'SUMMON_SACRIFICE', position: { ...position }, sourceCardId: 'dark_scorpion_king', options, allowKeep: false };
}
