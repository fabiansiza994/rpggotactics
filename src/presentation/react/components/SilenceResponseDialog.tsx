import { useEffect, useState } from 'react';
import type { GameEngine, GameState } from '../../../game';
import { useBattleStore } from '../../store/battleStore';
import '../../../styles/summon-search.css';
import '../../../styles/silence-response.css';

export function SilenceResponseDialog({ state, engine }: { state: Readonly<GameState>; engine: GameEngine }) {
  const window = state.responseWindow;
  const respondent = window?.respondingHeroId === state.player.heroId;
  const respond = useBattleStore(store => store.respondSilence);
  const [sealUid, chooseSeal] = useState('');
  const [discardUid, chooseDiscard] = useState('');
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!window) return;
    const timer = globalThis.setInterval(() => setClock(Date.now()), 200);
    return () => globalThis.clearInterval(timer);
  }, [window, respondent]);
  if (!window) return null;
  const seconds = Math.max(0, Math.ceil((window.deadline - clock) / 1000));
  if (!respondent) return <aside className="summon-search-response-wait" role="status">El rival puede responder · {seconds} s</aside>;
  const seals = state.player.hand.filter(card => card.cardId === 'dark_silence_seal' && !card.unavailableThisTurn);
  const selected = seals.some(card => card.uid === sealUid) ? sealUid : seals[0]?.uid ?? '';
  const costs = state.player.hand.filter(card => card.uid !== selected);
  const price = engine.getCardCost(selected)?.cost ?? 2;
  const cost = costs.some(card => card.uid === discardUid) ? discardUid : costs[0]?.uid ?? '';
  return <section role="dialog" aria-modal="false" className="silence-response" aria-labelledby="silence-window-title" onKeyDown={event => { if (event.key === 'Escape' && seconds > 0) { event.preventDefault(); respond(window.id); } }}>
    <h2 id="silence-window-title">Respuesta · {seconds} s</h2>
    <p>El rival intenta activar {engine.content.cards[window.cardId]?.name ?? window.cardId}.</p>
    <p>La respuesta es opcional. Al vencer el plazo, el servidor continúa.</p>
    {seals.length > 0 && <>
      <label>Sello del Silencio<select value={selected} onChange={event => chooseSeal(event.target.value)}>{seals.map(card => <option key={card.uid} value={card.uid}>{engine.content.cards[card.cardId]?.name}</option>)}</select></label>
      <label>Otra carta que descartar<select value={cost} onChange={event => chooseDiscard(event.target.value)}>{costs.map(card => <option key={card.uid} value={card.uid}>{engine.content.cards[card.cardId]?.name ?? card.cardId}</option>)}</select></label>
      <button type="button" disabled={seconds === 0 || !selected || !cost || state.player.energy < price} onClick={() => respond(window.id, selected, cost)}>Usar Sello · {price} energía + descarte</button>
    </>}
    <button type="button" disabled={seconds === 0} onClick={() => respond(window.id)}>Pasar</button>
    {seconds === 0 && <p role="status">Plazo cumplido. Esperando resolución del servidor.</p>}
  </section>;
}
