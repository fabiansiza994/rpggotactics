import type { RuleContext } from '../context';
import type { CardInstance } from './card';
import { randomInt } from '../core/rng';
/** Called only after both hands have been validated in the existing atomic card transaction. */
export function exchangeHandCard(ctx: RuleContext, selectedUid: string): void {
  const own=ctx.state.player, other=ctx.state.duel!.other;
  const offered=own.hand.find(c=>c.uid===selectedUid)!;
  const received=other.hand[randomInt(ctx.state,other.hand.length)]!;
  const control=(card:CardInstance,from:string,to:string)=>{card.originalOwnerId??=from;card.controllerId=to;card.traded=true;delete card.publicDiscard;};
  control(offered,own.heroId,other.heroId);control(received,other.heroId,own.heroId);
  // Replace in place: no draw, discard, creation, recovery or permanent inventory operation.
  own.hand[own.hand.indexOf(offered)]=received;
  other.hand[other.hand.indexOf(received)]=offered;
  ctx.emit({type:'CARDS_EXCHANGED',casterId:own.heroId,opponentId:other.heroId});
}
