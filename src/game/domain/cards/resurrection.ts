import type { RuleContext } from '../context';
import type { Pos } from '../core/position';
import type { CardInstance } from './card';
import { recoveryChoices } from './recovery';
import { spawnSummon, summonCapacityOf, summonUsage } from '../summons/summons';

export function resurrectionChoices(ctx: RuleContext): CardInstance[] {
  const owner = ctx.state.units.find(unit => unit.id === ctx.state.player.heroId);
  if (!owner) return [];
  return recoveryChoices(ctx.state, ctx.content).filter(card => {
    const source = ctx.state.deadSummonSources?.find(source => source.ownerId === owner.id && source.cardUid === card.uid);
    const definition = source ? ctx.content.summons?.[source.summonId] : undefined;
    return !!definition && summonUsage(ctx.state, owner.id) + definition.capacityCost <= summonCapacityOf(ctx.content, owner);
  });
}

export function beginResurrection(ctx: RuleContext, position: Pos, sourceCardId: string): void {
  const options = resurrectionChoices(ctx).map(card => ({ uid: card.uid, card: { ...card } }));
  if (options.length) ctx.state.player.pendingCardChoice = { kind: 'RESURRECT', position: { ...position }, sourceCardId, options, allowKeep: false };
}

export function resurrectChosen(ctx: RuleContext, uid: string, position: Pos): boolean {
  const card = resurrectionChoices(ctx).find(card => card.uid === uid);
  const owner = ctx.state.units.find(unit => unit.id === ctx.state.player.heroId);
  const source = ctx.state.deadSummonSources?.find(source => source.ownerId === owner?.id && source.cardUid === uid);
  if (!card || !owner || !source) return false;
  const revived = spawnSummon(ctx, owner, source.summonId, position, card.uid);
  if (!revived) return false;
  ctx.state.player.discard = ctx.state.player.discard.filter(copy => copy.uid !== uid);
  card.recoveredThisBattle = true;
  delete card.publicDiscard;
  revived.summon!.recoveredCard = card;
  ctx.state.deadSummonSources = ctx.state.deadSummonSources?.filter(entry => entry.ownerId !== owner.id || entry.cardUid !== uid);
  return true;
}
