import {useEffect} from 'react';
import {GameEngine,SCENARIOS_BY_ID,type GameState} from '../../../game';
import {spawnSummon} from '../../../game/domain/summons/summons';
import {PRESENTATION_CONTENT} from '../shapeshifter/runtime';
import {useBattleStore} from '../../store/battleStore';
import {presentationBus} from '../../events/presentationBus';
import {BoardView} from '../../react/components/BoardView';
import {HandBar} from '../../react/components/Hud';
/** Disposable DEV specimen: real card/engine/input/VFX, no cloud, save or reward operations. */
export default function UnleashedHuntQa(){
 const engine=useBattleStore(s=>s.engine),state=useBattleStore(s=>s.state);
 const busy=useBattleStore(s=>s.playbackBusy),notice=useBattleStore(s=>s.notice);
 useEffect(()=>{
  const sc={...SCENARIOS_BY_ID.first_blood!,hero:{heroId:'summoner',pos:{x:1,y:2}},layout:Array(5).fill('.........'),obstacles:[],enemies:[{id:'hunt-target',enemyId:'orc_warrior',pos:{x:8,y:2}}]};
  const e=new GameEngine(sc,PRESENTATION_CONTENT,71);const initial=e.state as GameState;initial.obstacles=[];
  const hero=initial.units.find(u=>u.kind==='HERO')!;const drake=spawnSummon({state:initial,content:e.content,emit:()=>{}},hero,'war_drake',{x:3,y:2})!;drake.summon!.readyRound=1;
  initial.player.hand=[{uid:'qa-hunt',cardId:'unleashed_hunt'}];initial.player.energy=4;
  useBattleStore.setState({engine:e,state:initial,selectedCardUid:null,aim:null,introLocked:false,playbackBusy:false,handDiscard:null,onlineCommand:null});
  return e.subscribe((events,next)=>{useBattleStore.setState({state:next});presentationBus.publish(events,next);});
 },[]);
 if(!engine||!state)return <p>Cargando QA local…</p>;
 return <div className="battle hunt-qa"><style>{`.hunt-qa{height:100dvh;min-height:0!important;display:block!important}.hunt-qa .board-host{height:calc(100dvh - 262px);margin:0!important}.hunt-qa header{height:42px;position:relative;z-index:60;display:flex;align-items:center;gap:12px;padding:4px 12px;font-size:12px}.hunt-qa .hand-bar{position:absolute;bottom:0;left:0;width:100%;height:220px;min-height:0}.hunt-qa header button{min-height:34px;color:#ead8aa;background:#182a3c;border:1px solid #a68c55}.hunt-qa header a{color:#b8d9ee}@media(max-height:440px){.hunt-qa .board-host{height:calc(100dvh - 170px)}.hunt-qa .hand-bar{height:128px}.hunt-qa header{font-size:10px}}.hunt-qa .notice{position:absolute;top:45px;left:12px}`}</style>
  <header><span>QA local · Selecciona Cacería y el Dragón. Luego finaliza turno. Sin guardados.</span><button disabled={busy||!!state.outcome} onClick={()=>useBattleStore.getState().endTurn()}>Finalizar turno QA</button><a href="/play">Deck Builder / juego QA</a></header>
  <BoardView focusedEnemyId={null}/>{notice&&<div className="notice">{notice}</div>}<HandBar state={state} engine={engine}/>
 </div>;
}
