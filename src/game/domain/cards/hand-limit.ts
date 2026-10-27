import type { RuleContext } from '../context';
import { fail, OK, type RuleResult } from '../result';
import type { GameState, PlayerState } from '../state';

/**
 * End-of-turn hand limit (HAND_RULES): a turn may hold one card over the kept hand size (the turn
 * draw takes 5 → 6), and END_TURN must then discard exactly one card the player chose
 * (`END_TURN.discardUid`). The rules never pick for a connected player; only a turn the server
 * ends by itself (timer / disconnect) uses `fallbackDiscardUid`.
 */
export const keptHandSize = (player: Pick<PlayerState, 'handSize' | 'maxHandSize'>): number =>
  player.handSize ?? player.maxHandSize;

/** How many cards END_TURN must discard right now (0 or 1 with the shipped rules). */
export const handExcess = (player: Pick<PlayerState, 'hand' | 'handSize' | 'maxHandSize'>): number =>
  Math.max(0, player.hand.length - keptHandSize(player));

export const discardRequired = (state: Readonly<GameState>): boolean => handExcess(state.player) > 0;

/**
 * Deterministic choice when nobody chooses (PvP timer or disconnect): the LAST card in the hand,
 * i.e. the most recently drawn one. A pure function of the hand order, so replays and
 * reconnects reproduce it; it never looks at the deck or the RNG.
 */
export function fallbackDiscardUid(state: Readonly<GameState>): string | null {
  if (!discardRequired(state)) return null;
  return state.player.hand[state.player.hand.length - 1]?.uid ?? null;
}

/** Validates the END_TURN discard without changing anything. */
export function checkEndTurnDiscard(state: Readonly<GameState>, discardUid: string | undefined): RuleResult {
  const excess = handExcess(state.player);
  if (excess === 0)
    return discardUid === undefined ? OK : fail('DISCARD_NOT_ALLOWED', 'Your hand is within the limit: nothing to discard.');
  if (excess > 1) return fail('DISCARD_REQUIRED', `The hand is ${excess} cards over the limit.`);
  if (discardUid === undefined) return fail('DISCARD_REQUIRED', 'Discard 1 card to end your turn.');
  if (!state.player.hand.some((c) => c.uid === discardUid)) return fail('CARD_NOT_IN_HAND', 'That card is not in your hand.');
  return OK;
}

/** Moves the chosen card hand → discard pile (call after `checkEndTurnDiscard` succeeded). */
export function discardForHandLimit(ctx: RuleContext, discardUid: string | undefined): void {
  if (discardUid === undefined) return;
  const { player } = ctx.state;
  const i = player.hand.findIndex((c) => c.uid === discardUid);
  if (i < 0) return;
  const [card] = player.hand.splice(i, 1);
  player.discard.push(card!);
  ctx.emit({ type: 'CARD_DISCARDED', cardUid: card!.uid, cardId: card!.cardId, reason: 'HAND_LIMIT' });
}
