import { useEffect, useState } from 'react';
import { DEFAULT_CONTENT, GameEngine, type Command, type GameState } from '../../../game';
import { useBattleStore } from '../../store/battleStore';
import { presentationBus } from '../../events/presentationBus';
import { BoardView } from '../../react/components/BoardView';
import { HandBar } from '../../react/components/Hud';
import './final-cleanup-qa.css';
import { BASTION_CASES, BASTION_LABELS, bastionFixture, golemFixture, type BastionCase } from './finalCleanupFixtures';

/** DEV/loopback-only laboratory: arranged snapshots, real commands, no profile writes. */
export default function FinalCleanupQa() {
 const [kind,setKind]=useState<BastionCase|'golem'>('golem');
 const [picking,setPicking]=useState('Sin comprobar');
 const [generation,setGeneration]=useState(0),[log,setLog]=useState(''),[verdict,setVerdict]=useState('PENDIENTE HUMANO');
 const engine=useBattleStore(s=>s.engine),state=useBattleStore(s=>s.state),busy=useBattleStore(s=>s.playbackBusy);
 useEffect(()=>{
  const fixture=kind==='golem'?golemFixture():bastionFixture(kind);
  const e=GameEngine.fromSnapshot(fixture.state,DEFAULT_CONTENT,fixture.scenario);
  useBattleStore.setState({engine:e,state:e.state,selectedCardUid:null,aim:null,introLocked:false,playbackBusy:false,onlineCommand:null,handDiscard:null,notice:null});
  return e.subscribe((events,next)=>{
   useBattleStore.setState({state:next}); presentationBus.publish(events,next);
   setLog(events.filter(x=>x.type==='UNIT_DAMAGED'||x.type==='SUMMON_ATTACKED').map(x=>JSON.stringify(x)).join(' · '));
  });
 },[kind,generation]);
 function run(command:Command) {
  if(!engine||busy)return;
  const result=engine.dispatch(command);
  if(!result.ok)setLog(result.message);
 }
 function play() {
  if(!engine)return;
  const card=engine.state.player.hand[0]; if(!card)return;
  const target=engine.getValidTargets(card.uid)[0]??null;
  run({type:'PLAY_CARD',cardUid:card.uid,target:kind==='golem'?{x:3,y:2}:target});
 }
 function verifyPicking() {
  const debug=(window as unknown as {__RPGGO__?:{tileToClient:(x:number,y:number)=>{x:number;y:number}|null;pick:(x:number,y:number)=>{x:number;y:number}|null}}).__RPGGO__;
  const board=useBattleStore.getState().state?.board;if(!debug||!board)return;
  let checked=0,failed=0;const points=[];
  for(let y=0;y<board.height;y++)for(let x=0;x<board.width;x++) {
   const p=debug.tileToClient(x,y),picked=p&&debug.pick(p.x,p.y);
   const visible=p&&p.x>=0&&p.x<innerWidth&&p.y>=0&&p.y<innerHeight&&document.elementFromPoint(p.x,p.y)?.tagName==='CANVAS';
   checked++;if(!visible||picked?.x!==x||picked.y!==y)failed++;
   if((x===3||x===2)&&y===2&&p)points.push(`${x},${y} → ${Math.round(p.x)},${Math.round(p.y)}`);
  }
  setPicking(`${failed?'FAIL':'PASS'} · ${checked-failed}/${checked} centros visibles y clics alineados · ${points.join(' | ')}`);
 }
 function restore() {
  if(!engine||busy)return;
  const scenario=kind==='golem'?golemFixture().scenario:bastionFixture(kind).scenario;
  const snapshot=JSON.parse(JSON.stringify(engine.state)) as GameState;
  const restored=GameEngine.fromSnapshot(snapshot,DEFAULT_CONTENT,scenario);
  // Remount and resubscribe through the same fixture path; saved snapshot is tab-local only.
  sessionStorage.setItem('rpggo-final-cleanup-snapshot',JSON.stringify({kind,state:restored.state}));
  setLog('Snapshot guardado en esta pestaña; usa Restaurar guardado incluso después de recargar.');
 }
 function reloadSaved() {
  if(busy)return;
  const raw=sessionStorage.getItem('rpggo-final-cleanup-snapshot'); if(!raw)return;
  const saved=JSON.parse(raw) as {kind:typeof kind;state:GameState};
  if(saved.kind!==kind){setLog('Selecciona primero el mismo escenario del guardado.');return;}
  if(!engine)return;
  // The existing engine subscription remains; restore the presentation adapter only for this QA.
  const scenario=kind==='golem'?golemFixture().scenario:bastionFixture(kind).scenario;
  const restored=GameEngine.fromSnapshot(saved.state,DEFAULT_CONTENT,scenario);
  restored.subscribe((events,next)=>{useBattleStore.setState({state:next});presentationBus.publish(events,next);});
  useBattleStore.setState({engine:restored,state:restored.state,selectedCardUid:null,aim:null});
  setLog('Restaurado sin modificar cuentas, colección ni progreso.');
 }
 return <main className="battle final-cleanup-qa"><header className="final-cleanup-controls">
  <label>Escenario <select aria-label="Escenario final QA" disabled={busy} value={kind} onChange={e=>{setKind(e.target.value as typeof kind);setLog('');setVerdict('PENDIENTE HUMANO');}}><option value="golem">Gólem · aparición Ultra y combate</option>{BASTION_CASES.map(k=><option key={k} value={k}>{BASTION_LABELS[k]}</option>)}</select></label>
  <button disabled={busy} onClick={()=>setGeneration(n=>n+1)}>Reiniciar escenario</button>
  <button disabled={busy||!state?.player.hand.length} onClick={play}>Jugar primera carta</button>
  <button disabled={busy||!engine} onClick={()=>run({type:'END_TURN',discardUid:state && state.player.hand.length>5?state.player.hand[0]?.uid:undefined})}>Siguiente turno real</button>
  <button disabled={busy} onClick={verifyPicking}>Verificar clics</button>
  <button disabled={busy} onClick={restore}>Guardar QA</button><button disabled={busy} onClick={reloadSaved}>Restaurar guardado</button>
  {kind!=='golem'&&<label>Evaluación humana <select aria-label="Evaluación humana" value={verdict} onChange={e=>setVerdict(e.target.value)}>{['PENDIENTE HUMANO','WEAK','OK','STRONG'].map(v=><option key={v}>{v}</option>)}</select></label>}
  <div>{state?.units.map(u=>`${u.name}: HP ${u.hp}/${u.maxHp} · Guardia ${u.shield} · Armadura ${u.armor}`).join(' | ')} · Energía {state?.player.energy} · MP {state?.player.movePoints} · {busy?'Resolviendo':'Preparado'}</div>
  <output aria-label="Alineación de casillas">{picking}</output><details><summary>Registro y guía</summary><p>Sin cuentas ni recompensas. Combo: juega Guardia y después Golpe. Duelo: campeón rival real con reglas PvP locales. Gólem: juega la Ultra, termina turnos para su activación, ataque y aura; usa el inspector de animación para ciclos aislados. El movimiento automático conserva su regla GUARD.</p><output>{log}</output></details>
 </header><BoardView focusedEnemyId={null}/>{engine&&<HandBar state={engine.state} engine={engine}/>}</main>;
}
