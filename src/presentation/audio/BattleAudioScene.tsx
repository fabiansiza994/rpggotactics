import {useBattleStore} from '../store/battleStore';
import {useScenePreparation} from '../loading/scenePreparation';
import {drawRitual} from '../cards/drawRitual';
import {useEffect,useLayoutEffect,useSyncExternalStore} from 'react';
import type {GameEngine,GameState} from '../../game';
import {presentationBus,presentationSourceKey} from '../events/presentationBus';
import {arcaneAudio,audioExperimentEnabled} from './audio';
import {BattleAudioSession} from './BattleAudioSession';
let storage:Storage|undefined;try{storage=typeof sessionStorage==='undefined'?undefined:sessionStorage;}catch{/* storage optional */}
export const battleAudioSession=new BattleAudioSession(arcaneAudio,storage);
export function BattleAudioScene({state,engine,battleId,serverReady=true}:{state:Readonly<GameState>;engine:GameEngine;battleId?:string;serverReady?:boolean}){
 const boardReady=useScenePreparation(s=>s.boardReady),dialogues=useScenePreparation(s=>s.dialogues),draw=useSyncExternalStore(drawRitual.subscribe,drawRitual.getSnapshot);
 const id=battleId??`${presentationSourceKey(engine)}:${engine.scenario.id}:${engine.seed}`;
 const preparedId=useScenePreparation(s=>s.presentedId);
 const prepared=serverReady&&(preparedId===id||boardReady&&dialogues===0&&draw.phase==='idle');
 useLayoutEffect(()=>{if(prepared)useScenePreparation.setState({presentedId:id});useBattleStore.setState({readinessLocked:!prepared});return()=>{useBattleStore.setState({readinessLocked:false});};},[id,prepared]);
 useEffect(()=>{if(!audioExperimentEnabled)return;const unsub=presentationBus.subscribe((events,next,batch)=>battleAudioSession.observe(events,next,batch));return()=>{unsub();battleAudioSession.detach(id);};},[id]);
 useEffect(()=>{if(audioExperimentEnabled&&prepared){if(!battleId)battleAudioSession.opening(id,state);else battleAudioSession.attach(id,state);}},[id,state,prepared,battleId]);
 return null;
}
