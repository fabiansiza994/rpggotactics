import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { GameEngine, GameState } from '../../../game';
import { checkSilenceResponse } from '../../../game/domain/cards/silence-eligibility';
import { useBattleStore } from '../../store/battleStore';
import { redemptionPlacement } from '../../cards/redemptionContext';
import '../../../styles/silence-response.css';

/** Reuse the rules query with the private local hand as defender; never mutate or send it. */
export function silenceChoices(state: Readonly<GameState>, engine: GameEngine) {
  if (!state.responseWindow || state.responseWindow.respondingHeroId !== state.player.heroId) return [];
  const view = { ...state, duel: { ...state.duel, other: state.player } } as GameState;
  return state.player.hand.filter(seal => seal.cardId === 'dark_silence_seal' &&
    state.player.hand.some(discard => checkSilenceResponse({state:view,content:engine.content,emit:()=>{}},seal.uid,discard.uid).ok));
}

export function useSilenceContext(state: Readonly<GameState>, engine: GameEngine) {
  const window = state.responseWindow;
  const respond = useBattleStore(s => s.respondSilence);
  const [choice, setChoice] = useState<{id:string;seal:string;discarding:boolean;sent:boolean}|null>(null);
  const [clock, setClock] = useState(Date.now);
  const submitted = useRef<string|null>(null);
  useEffect(() => {
    if (!window) return;
    const first = globalThis.setTimeout(() => setClock(Date.now()), 0);
    const timer = globalThis.setInterval(() => setClock(Date.now()), 100);
    return () => { globalThis.clearTimeout(first); globalThis.clearInterval(timer); };
  }, [window]);
  const seals = silenceChoices(state, engine);
  const current = choice?.id === window?.id ? choice : null;
  const seal = seals.find(c => c.uid === current?.seal) ?? seals[0];
  const responding = !!window && window.respondingHeroId === state.player.heroId;
  const remaining = Math.max(0, Math.min(5000,(window?.deadline ?? 0) - clock));
  const sent = current?.sent;
  const active = responding && !!seal && remaining > 0 && !sent;
  const discarding = active && !!current?.discarding;
  const submit = (discard?:string) => {
    if (!active || !window || Date.now() >= window.deadline || submitted.current === window.id) return;
    if (discard && (!seal || discard === seal.uid || !state.player.hand.some(c=>c.uid===discard))) return;
    submitted.current = window.id;
    setChoice({id:window.id,seal:seal!.uid,discarding:false,sent:true});
    respond(window.id,discard?seal!.uid:undefined,discard);
  };
  return { window, responding, active, discarding, sealUid:seal?.uid, seals, remaining,
    role(uid:string) {
      if (!active) return undefined;
      if (uid === seal?.uid) return 'chosen';
      if (discarding) return 'discard';
      return seals.some(c=>c.uid===uid)?'seal':'muted';
    },
    choose(uid:string) {
      if (!active) return;
      if (discarding && uid !== seal?.uid) { submit(uid); return; }
      if (seals.some(c=>c.uid===uid) && window) setChoice({id:window.id,seal:uid,discarding:false,sent:false});
    },
    accept() { if(active && window && seal) setChoice({id:window.id,seal:seal.uid,discarding:true,sent:false}); },
    pass() { submit(); },
  };
}
export type SilenceContext = ReturnType<typeof useSilenceContext>;

/** A tiny portal follows the real hand card, outside the scroller and its clipping context. */
export function SilenceResponseContext({context,engine,footer}:{context:SilenceContext;engine:GameEngine;footer:RefObject<HTMLElement|null>}) {
  const [anchor,setAnchor]=useState<{x:number;y:number}|null>(null);
  const {window,active,sealUid}=context;
  useEffect(()=>{
    if(!active||!sealUid)return;
    let frame=0;
    const measure=()=>{
      const card=[...footer.current?.querySelectorAll<HTMLElement>('.hand .card[data-card-uid]')??[]].find(c=>c.dataset.cardUid===sealUid);
      if(card){
        const rect=card.getBoundingClientRect();
        const obstacles=[...document.querySelectorAll<HTMLElement>('.battle-pile-bank button,.end-turn-box,.mobile-player-status,.pause-trigger')].map(e=>e.getBoundingClientRect());
        const next=redemptionPlacement(rect,{width:innerWidth,height:innerHeight},obstacles);
        setAnchor(old=>old?.x===next?.x&&old?.y===next?.y?old:next);
      }
      frame=requestAnimationFrame(measure);
    };
    const card=[...footer.current?.querySelectorAll<HTMLElement>('.hand .card[data-card-uid]')??[]].find(c=>c.dataset.cardUid===sealUid);
    const hand=card?.closest<HTMLElement>('.hand');
    if(card&&hand){const r=card.getBoundingClientRect(),h=hand.getBoundingClientRect();if(r.left<h.left||r.right>h.right)hand.scrollBy({left:r.left-h.left-(h.width-r.width)/2,behavior:'instant'});}
    measure();return()=>cancelAnimationFrame(frame);
  },[active,sealUid,footer]);
  if(!window)return null;
  if(!context.responding)return <aside className="silence-wait" role="status">Respuesta rival · {Math.ceil(context.remaining/1000)} s</aside>;
  if(!active||!anchor)return null;
  const name=engine.content.cards[window.cardId]?.name??window.cardId;
  return createPortal(<div className="silence-context" role="group" aria-label="Respuesta con Sello del Silencio" style={{left:anchor.x,top:anchor.y,'--silence-caption-left':`${anchor.x-55}px`,'--silence-caption-top':`${Math.max(8,anchor.y-(context.discarding?44:28))}px`} as CSSProperties} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();context.pass();}}}>
    <div className="silence-context-caption" role="status" title={name}>
      <span>{name} · {Math.ceil(context.remaining/1000)} s</span>
      {context.discarding&&<strong>Selecciona una carta para descartar</strong>}
    </div>
    <button type="button" className="silence-accept" aria-label="Utilizar Sello del Silencio; seleccionar descarte" aria-pressed={context.discarding} disabled={context.discarding} title="Usar Sello: elige otra carta para descartar" onClick={context.accept}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg></button>
    <button type="button" className="silence-pass" aria-label="Pasar respuesta" title="Pasar sin consumir energía ni cartas" onClick={context.pass}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
  </div>,document.body);
}
