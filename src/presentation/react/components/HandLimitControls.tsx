import { handExcess, keptHandSize, type GameState } from '../../../game';
import { useBattleStore } from '../../store/battleStore';
import '../../../styles/hand-limit.css';

/**
 * Hand rule HUD (HAND_RULES: 5 kept, 6 during the turn). The counter reads «Mano 5/5», or
 * «Mano 6/5 · descarta 1 al finalizar» when the turn holds the temporary extra card.
 */
export function HandCounter({ state }: { state: Readonly<GameState> }) {
  const kept = keptHandSize(state.player);
  const over = handExcess(state.player) > 0;
  return (
    <span className={`hand-limit-count ${over ? 'is-over' : ''}`} aria-live="polite">
      Mano {state.player.hand.length}/{kept}
      {over && state.phase === 'PLAYER' && <span className="hand-limit-hint"> · descarta 1 al finalizar</span>}
    </span>
  );
}

/**
 * DISCARD_TO_HAND_LIMIT picker: shown after Finalizar turno with 6 cards. A click on a hand card
 * picks it (the hand stays visible: this bar sits above it), DESCARTAR Y FINALIZAR sends
 * END_TURN { discardUid }, Volver backs out to keep playing.
 */
export function HandDiscardBar({ state }: { state: Readonly<GameState> }) {
  const pick = useBattleStore((s) => s.handDiscard?.uid ?? null);
  const confirm = useBattleStore((s) => s.confirmHandDiscard);
  const cancel = useBattleStore((s) => s.cancelHandDiscard);
  const name = useBattleStore((s) => {
    const card = pick ? state.player.hand.find((c) => c.uid === pick) : undefined;
    return card ? s.engine?.content.cards[card.cardId]?.name : undefined;
  });
  return (
    <div className="hand-discard-bar" role="region" aria-label="Descarte de fin de turno">
      <span className="hand-discard-text">{name ? `Descartar «${name}»` : 'Descarta 1 carta para terminar tu turno.'}</span>
      <button type="button" className="hand-discard-confirm" disabled={!pick} onClick={confirm}>
        Descartar y finalizar
      </button>
      <button type="button" className="hand-discard-cancel" onClick={cancel}>
        Volver
      </button>
    </div>
  );
}
