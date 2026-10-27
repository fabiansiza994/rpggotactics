import { useEffect } from 'react';
import { DEFAULT_CONTENT, GameEngine, SCENARIOS_BY_ID, type GameState, type Unit } from '../../../game';
import { BoardView } from '../../react/components/BoardView';
import { useBattleStore } from '../../store/battleStore';
/** DEV/loopback visual fixture: real board/input/panel, no account or persistence writes. */
export default function SummonInspectionQa(){
 const ready=useBattleStore(s=>s.engine!==null);
 useEffect(()=>{
  const engine=new GameEngine({...SCENARIOS_BY_ID.first_blood!,hero:{heroId:'summoner',pos:{x:1,y:3}}},DEFAULT_CONTENT,13);
  const state=engine.state as GameState;const ordinary=state.units.find(u=>u.kind==='ENEMY')!;const hero=state.units.find(u=>u.kind==='HERO')!;const def=DEFAULT_CONTENT.summons!.ash_hound!;
  const unit:Unit={...hero,id:'qa-ally',defId:def.id,name:def.name,kind:'SUMMON',pos:{x:2,y:2},hp:3,maxHp:def.maxHp,armor:def.armor,moveRange:def.moveRange,shield:2,statuses:[{id:'ROOTED',turnsLeft:2}]};
  state.units=[hero,unit,{...unit,id:'qa-enemy',faction:'ENEMY',pos:{x:4,y:2},hp:5,shield:0,statuses:[]},{...ordinary,pos:{x:5,y:3}}];state.obstacles=[];state.intents=[];
  useBattleStore.setState({engine,state,selectedCardUid:null,aim:null,introLocked:false,playbackBusy:false,handDiscard:null});
 },[]);
 return <div className="battle summon-inspection-qa" style={{height:'100dvh'}}><style>{`.summon-inspection-qa{display:block!important;min-height:0!important}.summon-inspection-qa .board-host{height:100dvh!important;margin:0!important}`}</style><div style={{position:'absolute',top:8,left:12,zIndex:60,color:'white'}}>QA local · Click/tap en Sabueso aliado (3 HP) o enemigo (5 HP). Esc cierra. Sin guardados.</div>{ready&&<BoardView focusedEnemyId={null}/>}</div>;
}
