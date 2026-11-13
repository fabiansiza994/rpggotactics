import type { RuleContext } from '../domain/context';
import type { Pos } from '../domain/core/position';
import { playCard } from '../domain/cards/play-card';
import { updateObjectives } from '../domain/objectives/objective-rules';
import { fail, OK, type RuleResult } from '../domain/result';
import { moveUnit } from '../domain/turn/player-actions';
import { endPlayerTurnAndRunRound } from '../domain/turn/turn-flow';
import { endDuelTurn } from '../pvp/duel';
import { activateRitual, commitRitualPiece, releaseRitualPiece } from '../domain/rituals/ritual-rules';
import { checkEndTurnDiscard, discardForHandLimit } from '../domain/cards/hand-limit';
import { interact } from '../domain/mechanisms/mechanism-rules';

/**
 * Everything the presentation can ask the engine to do. Plain data, so commands can be
 * logged, replayed or sent over the wire later.
 *
 * Target *selection* (hover, choosing a card, previewing) is presentation state; the engine
 * only validates and resolves the final PLAY_CARD.
 */
export type Command =
  | { type: 'MOVE_UNIT'; unitId: string; to: Pos }
  /** Play a search card with the chosen card uid: Rastreo (deck) or Eco del Altar (own discard). */
  | { type: 'SEARCH_SUMMON'; cardUid: string; choiceUid: string }
  /** `secondary`: only for `pairSwap` cards (Pacto de la Doble Luna's second summon); refused otherwise. */
  | { type: 'PLAY_CARD'; cardUid: string; target: Pos | null; secondary?: Pos; wallOrientation?: import('../domain/cards/targeting').WallOrientation }
  /** Seal a ritual piece from the hand onto the altar. */
  | { type: 'COMMIT_RITUAL_PIECE'; cardUid: string }
  /** Abandon a sealed piece (altar → discard). */
  | { type: 'RELEASE_RITUAL_PIECE'; cardUid: string }
  /** Explicit activation: the rules check and consume the pieces, never the client. */
  | { type: 'ACTIVATE_RITUAL'; ritualId: string; target: Pos | null }
  /** Contextual board action on an adjacent mechanism (Act III): flip a switch, push a statue, take a relic. */
  | { type: 'INTERACT'; mechanismId: string }
  /**
   * `discardUid`: the card discarded to get back to the hand size (required exactly when the hand
   * is over it, refused otherwise; see domain/cards/hand-limit.ts).
   */
  | { type: 'END_TURN'; discardUid?: string };

export type CommandType = Command['type'];

export function executeCommand(ctx: RuleContext, command: Command): RuleResult {
  if (ctx.state.outcome) return fail('BATTLE_OVER', 'The battle is over.');
  if (ctx.state.phase !== 'PLAYER') return fail('NOT_PLAYER_TURN', 'Not the player turn.');

  switch (command.type) {
    case 'MOVE_UNIT': {
      const result = moveUnit(ctx, command.unitId, command.to);
      if (result.ok) updateObjectives(ctx);
      return result;
    }
    case 'SEARCH_SUMMON': {
      const result = playCard(ctx, command.cardUid, null, command.choiceUid);
      if (result.ok) updateObjectives(ctx);
      return result;
    }
    case 'PLAY_CARD': {
      const result = playCard(ctx, command.cardUid, command.target, undefined, command.secondary, command.wallOrientation);
      if (result.ok) updateObjectives(ctx);
      return result;
    }
    case 'COMMIT_RITUAL_PIECE':
      return commitRitualPiece(ctx, command.cardUid);
    case 'RELEASE_RITUAL_PIECE':
      return releaseRitualPiece(ctx, command.cardUid);
    case 'ACTIVATE_RITUAL': {
      const result = activateRitual(ctx, command.ritualId, command.target);
      if (result.ok) updateObjectives(ctx);
      return result;
    }
    case 'INTERACT': {
      if (ctx.state.duel) return fail('UNKNOWN_MECHANISM', 'No mechanisms in PvP.');
      const result = interact(ctx, command.mechanismId);
      if (result.ok) updateObjectives(ctx);
      return result;
    }
    case 'END_TURN': {
      const discard = checkEndTurnDiscard(ctx.state, command.discardUid);
      if (!discard.ok) return discard;
      discardForHandLimit(ctx, command.discardUid);
      if (ctx.state.duel) endDuelTurn(ctx);
      else endPlayerTurnAndRunRound(ctx);
      return OK;
    }
  }
}
