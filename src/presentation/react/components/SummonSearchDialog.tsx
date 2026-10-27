import {useEffect,useRef,useState} from 'react';
import type{GameEngine,GameState}from'../../../game';
import{summonSearchChoices}from'../../../game/domain/cards/play-card';
import{useBattleStore}from'../../store/battleStore';
import{SpellArt}from'./SpellArt';
import '../../../styles/summon-search.css';

export function SummonSearchDialog({state,engine}:{state:Readonly<GameState>;engine:GameEngine}) {
 const uid=useBattleStore(s=>s.selectedCardUid);
 const confirm=useBattleStore(s=>s.confirmSummonSearch);
 const cancel=useBattleStore(s=>s.cancelAim);
 const busy=useBattleStore(s=>s.playbackBusy||s.introLocked);
 const ref=useRef<HTMLDialogElement>(null);
 const [choice,setChoice]=useState<string|null>(null);
 const instance=state.player.hand.find(c=>c.uid===uid);
 const active=!!instance&&!!engine.content.cards[instance.cardId]?.deckSearch;
 const choices=summonSearchChoices(state,engine.content);
 const allowed=!!uid&&engine.getCardPlayability(uid).playable&&!busy;
 useEffect(()=>{const d=ref.current;if(active){if(!d?.open)d?.showModal();}else d?.close();},[active,uid]);
 return <dialog ref={ref} className="summon-search" aria-labelledby="summon-search-title" onCancel={e=>{e.preventDefault();cancel();}}>
  <h2 id="summon-search-title">Rastreo de la Manada</h2>
  <p>Elige una invocación de tu mazo. No estará disponible durante este turno.</p>
  <div className="summon-search-grid" role="radiogroup" aria-label="Invocaciones del mazo">
   {choices.map(c=>{const def=engine.content.cards[c.cardId]!;const summon=def.effects.find(fx=>fx.type==='SUMMON');const stats=summon?.type==='SUMMON'?engine.content.summons?.[summon.summonId]:undefined;
    return <button key={c.uid} type="button" role="radio" aria-checked={choice===c.uid} data-choice-uid={c.uid} onClick={()=>setChoice(c.uid)}>
     <span className="search-art"><SpellArt cardId={def.id} spell={def.presentation.visualKey}/></span>
     <strong>{def.name}</strong><span>{def.cost} energía</span><p>{def.rulesText}</p>
     {stats&&<small>{stats.maxHp} HP · capacidad {stats.capacityCost}</small>}
    </button>;
   })}
  </div>
  {!allowed&&<p role="status">La búsqueda ya no está disponible. Cancela y revisa la carta.</p>}
  <footer><button type="button" onClick={cancel}>Cancelar</button><button type="button" disabled={!allowed||!choice||!choices.some(c=>c.uid===choice)} onClick={()=>uid&&choice&&confirm(uid,choice)}>Confirmar invocación</button></footer>
 </dialog>;
}
