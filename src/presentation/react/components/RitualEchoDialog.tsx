import { useEffect, useRef, useState } from 'react';
import type { GameEngine, GameState } from '../../../game';
import { discardSearchChoices } from '../../../game/domain/cards/play-card';
import { useBattleStore } from '../../store/battleStore';
import { SpellArt } from './SpellArt';
import '../../../styles/summon-search.css';

/**
 * Eco del Altar (Ranked): pick one ritual piece of your OWN discard pile. Functional UI (Codex
 * styles it later; hook `.summon-search[data-search=discard]`). Only legal pieces are listed; the
 * choice is sent as the uid of that card and the engine/server re-validate it against the real pile.
 * Cancelling before confirming changes nothing (selection is presentation state).
 */
export function RitualEchoDialog({ state, engine }: { state: Readonly<GameState>; engine: GameEngine }) {
  const uid = useBattleStore((s) => s.selectedCardUid);
  const confirm = useBattleStore((s) => s.confirmSummonSearch);
  const cancel = useBattleStore((s) => s.cancelAim);
  const busy = useBattleStore((s) => s.playbackBusy || s.introLocked);
  const ref = useRef<HTMLDialogElement>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const instance = state.player.hand.find((c) => c.uid === uid);
  const active = !!instance && !!engine.content.cards[instance.cardId]?.discardSearch;
  const choices = active ? discardSearchChoices(state, engine.content) : [];
  const allowed = !!uid && engine.getCardPlayability(uid).playable && !busy;
  useEffect(() => {
    const d = ref.current;
    if (active) {
      if (!d?.open) d?.showModal();
    } else d?.close();
  }, [active, uid]);
  const ritualsOf = (cardId: string) =>
    Object.values(engine.content.rituals ?? {})
      .filter((r) => r.pieces.includes(cardId))
      .map((r) => r.name);
  return (
    <dialog
      ref={ref}
      className="summon-search"
      data-search="discard"
      aria-labelledby="ritual-echo-title"
      onCancel={(e) => {
        e.preventDefault();
        cancel();
      }}
    >
      <h2 id="ritual-echo-title">ELIGE UNA PIEZA DE RITUAL</h2>
      <p>Eco del Altar: vuelve a tu mano. No podrás jugarla ni sellarla hasta tu próximo turno.</p>
      <div className="summon-search-grid" role="radiogroup" aria-label="Piezas de ritual del descarte">
        {choices.map((c) => {
          const def = engine.content.cards[c.cardId]!;
          const rituals = ritualsOf(def.id);
          return (
            <button key={c.uid} type="button" role="radio" aria-checked={choice === c.uid} data-choice-uid={c.uid} onClick={() => setChoice(c.uid)}>
              <span className="search-art">
                <SpellArt cardId={def.id} spell={def.presentation.visualKey} />
              </span>
              <strong>{def.name}</strong>
              <span>
                Pieza de ritual{rituals.length ? ` · ${rituals.join(', ')}` : ''} · {def.cost} energía
              </span>
              <p>{def.rulesText}</p>
            </button>
          );
        })}
      </div>
      {!allowed && <p role="status">La búsqueda ya no está disponible. Cancela y revisa la carta.</p>}
      <footer>
        <button type="button" onClick={cancel}>
          Cancelar
        </button>
        <button
          type="button"
          disabled={!allowed || !choice || !choices.some((c) => c.uid === choice)}
          onClick={() => uid && choice && confirm(uid, choice)}
        >
          Recuperar pieza
        </button>
      </footer>
    </dialog>
  );
}
