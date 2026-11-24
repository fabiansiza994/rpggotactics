import { useEffect, useRef } from 'react';
import type { GameEngine, GameState } from '../../../game';
import { useBattleStore } from '../../store/battleStore';
import { SpellArt } from './SpellArt';
import '../../../styles/summon-search.css';

/** A confirmed cast's private choice survives refresh/reconnect in authoritative state. */
export function PendingCardChoiceDialog({ state, engine }: { state: Readonly<GameState>; engine: GameEngine }) {
  const pending = state.player.pendingCardChoice;
  const submit = useBattleStore(s => s.resolveCardChoice);
  const busy = useBattleStore(s => s.playbackBusy || s.introLocked);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (pending && state.phase === 'PLAYER') { if (!ref.current?.open) ref.current?.showModal(); }
    else ref.current?.close();
  }, [pending, state.phase]);
  if (!pending) return null;
  return <dialog ref={ref} className="summon-search" aria-labelledby="pending-choice-title" onCancel={event => event.preventDefault()}>
    <h2 id="pending-choice-title">{engine.content.cards[pending.sourceCardId]?.name}</h2>
    <p>{pending.kind === 'SUMMON_SACRIFICE' ? 'Elige cuántos HP sacrificar. Debes conservar al menos 1 HP.' : pending.kind === 'RESURRECT' ? 'Elige una invocación muerta para devolverla al campo.' : pending.kind === 'CLEANSE_MINOR' ? 'Elige un único estado menor que eliminar.' : pending.kind === 'BOTTOM_TOP_CARD' ? 'Elige qué carta enviar al fondo del mazo.' : 'Elige una carta para devolverla al mazo y barajarlo.'}</p>
    <div className="summon-search-grid">
      {pending.options.map(option => {
        const card = option.card;
        const definition = card ? engine.content.cards[card.cardId] : undefined;
        return <button key={option.uid} type="button" disabled={busy || state.phase !== 'PLAYER'} onClick={() => submit(option.uid)} data-choice-uid={option.uid}>
          <span className="search-art">{card && <SpellArt cardId={card.cardId} spell={definition?.presentation.visualKey ?? card.cardId}/>}</span>
          <strong>{definition?.name ?? (option.sacrificeHp !== undefined ? `Sacrificar ${option.sacrificeHp} HP · invocación ${6 + option.sacrificeHp} HP` : option.status ? engine.content.statuses[option.status]?.name : option.uid)}</strong><p>{definition?.rulesText}</p>
        </button>;
      })}
    </div>
    {pending.allowKeep && <button type="button" disabled={busy} onClick={() => submit(null)}>Mantener arriba</button>}
  </dialog>;
}
