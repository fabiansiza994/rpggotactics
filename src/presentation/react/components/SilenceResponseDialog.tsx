import { memo, useEffect, useRef, useState } from 'react';
import { BattleRail } from '../../battle/BattleRails';
import { FeatureCard } from './BattleCardFeature';
import { LEGACY_RESPONSE_MS, INFORMED_RESPONSE_MS } from '../../../protocol/negationResponse';
import type { GameEngine, GameState } from '../../../game';
import { checkSilenceResponse } from '../../../game/domain/cards/silence-eligibility';
import { useBattleStore } from '../../store/battleStore';
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
  const duration = window?.durationMs === INFORMED_RESPONSE_MS ? INFORMED_RESPONSE_MS : LEGACY_RESPONSE_MS;
  const remaining = Math.max(0, Math.min(duration,(window?.deadline ?? 0) - clock));
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
  return { window, responding, active, discarding, sealUid:seal?.uid, seals, remaining, duration,
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

/** The rival card is supplied by the server, never inferred from a private hand. */
const AnnouncedCard = memo(function AnnouncedCard({announcement}:{announcement:NonNullable<NonNullable<GameState['responseWindow']>['announcement']>}) {
  return <FeatureCard def={announcement.card} className="silence-announced-card" extras={{playable:true}} scrollableDescription />;
});
export function SilenceResponseContext({context,engine}:{context:SilenceContext;engine:GameEngine}) {
  const {window,active}=context;
  if(!window)return null;
  if(!context.responding)return <aside className="silence-wait" role="status">Respuesta rival · {Math.ceil(context.remaining/1000)} s</aside>;
  if(!active)return null;
  const announcement=window.announcement;
  return <BattleRail slot="preview"><section className="silence-response-panel" aria-label="Respuesta con Sello del Silencio" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();context.pass();}}}>
    <header><strong>Carta rival anunciada</strong><span role="timer" aria-live="off" aria-label="Tiempo para responder">{Math.ceil(context.remaining/1000)} s</span></header>
    <div className="silence-response-body">
      {announcement ? <AnnouncedCard announcement={announcement}/> : <p>{engine.content.cards[window.cardId]?.name??window.cardId}</p>}
      {announcement && <div className="silence-public-target">
        <span>Energía pagada: {announcement.paidEnergy}</span>
        {announcement.target && <span>Objetivo: casilla {announcement.target.x+1}, {announcement.target.y+1}</span>}
        {announcement.secondary && <span>Segundo objetivo: casilla {announcement.secondary.x+1}, {announcement.secondary.y+1}</span>}
      </div>}
    </div>
    <footer>
      {context.discarding && <strong role="status">Selecciona otra carta de tu mano para descartar</strong>}
      <div className="silence-response-actions">
        <button type="button" className="silence-accept" aria-label="Utilizar Sello del Silencio; seleccionar descarte" aria-pressed={context.discarding} disabled={context.discarding} onClick={context.accept}>Negar con Sello</button>
        <button type="button" className="silence-pass" aria-label="Pasar respuesta" onClick={context.pass}>Dejar resolver</button>
      </div>
    </footer>
  </section></BattleRail>;
}
