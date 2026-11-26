import {CardNegationResolution} from './CardNegationResolution';
import {useScenePreparation} from '../../loading/scenePreparation';
import {BattleRail} from '../../battle/BattleRails';
import {RedemptionControls,type RedemptionSelection} from './RedemptionControls';
import {refreshRevealControl,setRevealAccount,revealEnabled} from '../../cards/revealControl';
import {ArcaneReveal} from './ArcaneReveal';
import {EMPTY_ATMOSPHERE} from '../../immersion/atmosphere';
import {CombatAtmosphere} from './CombatAtmosphere';
import '../../../styles/combat-immersion.css';
import type { OpponentNotice, NoticeLane } from '../../mobile/OpponentNotices';
import { LinkedMechanismAction } from '../../mechanisms/LinkedAction';
const Act3AnimationTools=import.meta.env.DEV?lazy(()=>import('../../qa/act3/Act3AnimationTools').then(m=>({default:m.Act3AnimationTools}))):null;
import { UnitInspection, inspectedUnitAt } from './UnitInspection';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { BattleCanvas } from '../../pixi/BattleCanvas';
import type { CharacterMotion } from '../../pixi/CharacterAnimator.ts';
import { presentationBus } from '../../events/presentationBus';
import { useBattleStore } from '../../store/battleStore';
import { useBoardViewModel } from '../useBoardViewModel';
import { archerBattlePreviewEnabled, archerPresentationState } from '../../qa/archer/battlePreview';
const ArcherBoardControls=import.meta.env.DEV?lazy(()=>import('../../qa/archer/ArcherBoardControls').then(m=>({default:m.ArcherBoardControls}))):null;

/** Hosts the Pixi board. React owns the lifecycle; Pixi owns the pixels. */
export function BoardView({ focusedEnemyId, finished = false, menuPaused = false, qaSample, cameraOrigin, pvpEntry = false }: { focusedEnemyId: string | null; finished?: boolean; pvpEntry?: boolean; menuPaused?: boolean; cameraOrigin?: {x:number;y:number}; qaSample?: (sample: ReturnType<BattleCanvas['qaFeelSnapshot']>) => void }) {
  const cameraBusy=useBattleStore(s=>s.playbackBusy||s.introLocked);
  const [immersion,setImmersion]=useState(EMPTY_ATMOSPHERE);
  const [notices,setNotices] = useState<OpponentNotice[]>([]);
  const [noticeLane,setNoticeLane] = useState<NoticeLane | null>(null);
  const [supportSelection,setSupportState]=useState<RedemptionSelection|null>(null);
  const supportSelectionRef=useRef<RedemptionSelection|null>(null);
  const setSupportSelection=useCallback((next:RedemptionSelection|null)=>{supportSelectionRef.current=next;setSupportState(next);},[]);
  const lastSupportTap=useRef<{id:string;at:number}|null>(null);
  const hold=useRef<{timer:ReturnType<typeof setTimeout>|null;inspect:boolean;x:number;y:number}>({timer:null,inspect:false,x:0,y:0});
  const [inspectedId,setInspectedId] = useState<string|null>(null);
  const publicState = useBattleStore(s=>s.state);
  const engine = useBattleStore(s=>s.engine);
  const inspected = publicState?.units.find(u=>u.id===inspectedId);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<BattleCanvas | null>(null);
  const projectSupport=useCallback((id:string)=>canvasRef.current?.unitHudToClient(id)??null,[]);
  const vm = useBoardViewModel(focusedEnemyId);
  const cameraX = cameraOrigin?.x, cameraY = cameraOrigin?.y;
  const initialVm = useRef(vm && cameraOrigin ? {...vm, cameraOrigin} : vm);
  const onlineCommand=useBattleStore(s=>s.onlineCommand);
  const archerPreview=archerBattlePreviewEnabled && onlineCommand===null;

  useEffect(() => {
    const host = hostRef.current;
    const holdState=hold.current;
    if (!host) return;
    const { setHoverTile, clickTile, tapTile, cancelAim } = useBattleStore.getState();
    useScenePreparation.setState({boardReady:false,presentedId:null});
    const canvas = new BattleCanvas({
      onVisualReady:()=>{useScenePreparation.setState({boardReady:true});},
      ultraEnabled:revealEnabled,
      onImmersion:next=>setImmersion(previous=>previous.hp===next.hp&&previous.max===next.max&&previous.finished===next.finished&&previous.rooted===next.rooted&&previous.frozen===next.frozen&&previous.burning===next.burning&&previous.terrain===next.terrain?previous:next),
      onOpponentNotices: rows => setNotices(previous => JSON.stringify(previous)===JSON.stringify(rows)?previous:rows),
      onNoticeLane: lane => setNoticeLane(previous => previous && JSON.stringify(previous)===JSON.stringify(lane)?previous:lane),
      onSelectUnit: (positions,explicitInspection) => {
        const store=useBattleStore.getState(),state=store.state;
        if(!state||store.selectedCardUid||store.playbackBusy||store.introLocked||store.handDiscard||state.phase!=='PLAYER'){setSupportSelection(null);return false;}
        const unit=positions.map(p=>state.units.find(u=>u.pos.x===p.x&&u.pos.y===p.y)).find(Boolean);
        if(!unit){const dismiss=!!supportSelectionRef.current;setSupportSelection(null);return dismiss;}
        const owner=state.units.find(u=>u.id===state.player.heroId);
        const spirit=state.units.find(u=>u.defId==='light_redemption_spirit'&&u.hp>0&&u.summon?.ownerId===state.player.heroId);
        if(!unit||!owner||!spirit||unit.id===spirit.id||unit.faction!==owner.faction){setSupportSelection(null);return false;}
        const now=performance.now(),double=lastSupportTap.current?.id===unit.id&&now-lastSupportTap.current.at<300;
        lastSupportTap.current={id:unit.id,at:now};
        if(explicitInspection||hold.current.inspect||double){hold.current.inspect=false;setSupportSelection(null);setInspectedId(unit.id);return true;}
        setInspectedId(null);setSupportSelection({targetId:unit.id,heroId:state.player.heroId,round:state.round});return true;
      },
      onInspectUnit: positions => {
        const store=useBattleStore.getState();
        if(store.playbackBusy||store.introLocked||store.handDiscard)return false;
        const unit=inspectedUnitAt(store.state?.units??[],positions,!!store.selectedCardUid);
        if(!unit)return false;
        setSupportSelection(null);setInspectedId(unit.id);return true;
      },
      onTileHover: setHoverTile,
      onTileClick: pos=>{setSupportSelection(null);clickTile(pos);},
      onTileTap: positions=>{setSupportSelection(null);tapTile(positions);},
      onCancel: ()=>{setSupportSelection(null);cancelAim();},
      onPlaybackChange: useBattleStore.getState().setPlaybackBusy,
      onHandPulse: useBattleStore.getState().pulseHand,
      introVariant: () => useBattleStore.getState().introVariant,
      onIntroBeat: useBattleStore.getState().introBeat,
      onTurnBanner: useBattleStore.getState().showTurnBanner,
    });
    canvasRef.current = canvas;
    let disposed=false;setRevealAccount(useBattleStore.getState().account);const offAccount=useBattleStore.subscribe((s,previous)=>{if(s.account!==previous.account)setRevealAccount(s.account);});
    void refreshRevealControl().then(()=>{if(!disposed)return canvas.mount(host, initialVm.current ?? undefined).then(()=>{if(!disposed&&pvpEntry)canvas.presentPvpEntry();});});
    if (import.meta.env.DEV) {
      // Dev-only debug handle for e2e tests and manual inspection in the console.
      (window as unknown as Record<string, unknown>).__RPGGO__ = {
        store: useBattleStore,
        cameraControl:(action:'left'|'right'|'reset')=>canvas.cameraControl(action),
        frozenGroundSnapshot:()=>canvas.qaFrozenTerrain(),
        wizardFacing: () => canvas.wizardFacingSnapshot(),
        tileToClient: (x: number, y: number) => canvas.tileToClient({ x, y }),
        unitHudToClient: (id:string)=>canvas.unitHudToClient(id),
        unitBodyToClient: (id: string) => canvas.unitBodyToClient(id),
        // Checkpoint 06 QA: projected tile corners and the real picking path, in client pixels.
        tilePolygon: (x: number, y: number) => canvas.tilePolygonToClient({ x, y }),
        pick: (clientX: number, clientY: number) => canvas.clientToTile(clientX, clientY),
        qaPlayCharacterAnimation: (unitId: string, motion: string, cueMs?: number) =>
          canvas.qaPlayCharacterAnimation(unitId, motion as CharacterMotion, cueMs),
        qaFaceTarget: (unitId:string,target:{x:number;y:number})=>canvas.qaFaceTarget(unitId,target),
        qaAnimationSnapshot: (unitId: string) => canvas.qaAnimationSnapshot(unitId),
        qaFaceCharacter: (unitId: string, facing: 'LEFT' | 'RIGHT') =>
          canvas.qaFaceCharacter(unitId, facing),
      };
    }
    const offSupport=useBattleStore.subscribe((s,old)=>{if(s.selectedCardUid||s.state?.round!==old.state?.round||s.state?.phase!==old.state?.phase||s.state?.player.heroId!==old.state?.player.heroId)setSupportSelection(null);});
    const off = presentationBus.subscribe((events, state, batch) => canvas.playEvents(events,
      archerBattlePreviewEnabled && useBattleStore.getState().onlineCommand===null ? archerPresentationState(state) : state, batch));
    return () => {
      useScenePreparation.setState({boardReady:false,presentedId:null});
      disposed=true;offAccount();offSupport();off();if(holdState.timer)clearTimeout(holdState.timer);
      canvas.destroy();
      canvasRef.current = null;
    };
    // The entry belongs to this canvas mount; snapshot updates must never replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { canvasRef.current?.setMenuPaused(menuPaused); }, [menuPaused]);
  useEffect(() => { canvasRef.current?.setImmersionFinished(finished); }, [finished]);
  useEffect(() => {
    if (!import.meta.env.DEV || !qaSample) return;
    const id = setInterval(() => { if (canvasRef.current) qaSample(canvasRef.current.qaFeelSnapshot()); }, 250);
    return () => clearInterval(id);
  }, [qaSample]);


  useEffect(() => {
    if (vm) canvasRef.current?.render(cameraX !== undefined && cameraY !== undefined ? {...vm, cameraOrigin: {x:cameraX,y:cameraY}} : archerPreview
      ? {...vm,state:archerPresentationState(vm.state)} : vm);
  }, [vm,archerPreview,cameraX,cameraY]);

  return (
    <><ArcaneReveal content={engine?.content} /><CardNegationResolution content={engine?.content}/>
    <BattleRail slot="camera"><div className="battle-camera-controls" role="group" aria-label="Cámara del tablero">
      {(['left','right','reset','out','in'] as const).map((action,index)=><button key={action} type="button" disabled={cameraBusy} title={['Rotar a la izquierda 90°','Rotar a la derecha 90°','Restablecer cámara · Alt + arrastrar para desplazar','Alejar · rueda hacia atrás','Acercar · rueda hacia adelante'][index]} aria-label={['Rotar a la izquierda','Rotar a la derecha','Restablecer cámara','Alejar cámara','Acercar cámara'][index]} onClick={()=>canvasRef.current?.cameraControl(action)}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">{action==='in'||action==='out'?<><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M6 10h8"/>{action==='in'&&<path d="M10 6v8"/>}</>:action==='reset'?<><path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4"/><circle cx="12" cy="12" r="3"/></>:<g transform={action==='right'?'translate(24 0) scale(-1 1)':undefined}><path d="M7 8H3V4M3 8a9 9 0 1 1 0 8"/></g>}</svg></button>)}
    </div></BattleRail><div
      ref={hostRef}
      className="board-host"
      onPointerDownCapture={e=>{if(hold.current.timer)clearTimeout(hold.current.timer);hold.current.inspect=false;hold.current.x=e.clientX;hold.current.y=e.clientY;hold.current.timer=setTimeout(()=>{hold.current.inspect=true;},500);}}
      onPointerMoveCapture={e=>{if(Math.hypot(e.clientX-hold.current.x,e.clientY-hold.current.y)>8&&hold.current.timer){clearTimeout(hold.current.timer);hold.current.timer=null;hold.current.inspect=false;}}}
      onPointerUpCapture={()=>{if(hold.current.timer)clearTimeout(hold.current.timer);hold.current.timer=null;}}
      onPointerCancelCapture={()=>{if(hold.current.timer)clearTimeout(hold.current.timer);hold.current.timer=null;hold.current.inspect=false;}}
      onContextMenu={(e) => {
        e.preventDefault();
        setSupportSelection(null);useBattleStore.getState().cancelAim();
      }}
      // Pointer (not compat mouse) events: a tap elsewhere must not drop an armed touch preview.
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') useBattleStore.getState().setHoverTile(null);
      }}
    ><CombatAtmosphere view={finished ? EMPTY_ATMOSPHERE : immersion}/></div>
    {noticeLane && <div className="mobile-opponent-notices" role="status" aria-live="polite" aria-atomic="true" style={{left:noticeLane.left,top:noticeLane.top,width:noticeLane.width}}>
      {notices.slice(0,noticeLane.capacity).map(notice=><div key={notice.id} className="mobile-opponent-notice" data-priority={notice.priority}>{notice.text}</div>)}
    </div>}
    {!noticeLane && <aside className="desktop-opponent-notices" role="status" aria-live="polite" aria-atomic="true">
      {notices.slice(0,2).map(notice=><div key={notice.id} data-priority={notice.priority}>{notice.text}</div>)}
    </aside>}
    {Act3AnimationTools && location.pathname==='/act3-qa' && publicState && <Suspense fallback={null}><Act3AnimationTools units={publicState.units} canvas={()=>canvasRef.current}/></Suspense> }
    {engine && vm && <LinkedMechanismAction engine={engine} project={p=>canvasRef.current?.tileToClient(p)??null} polygon={p=>canvasRef.current?.tilePolygonToClient(p)??null}/> }
    {engine && <RedemptionControls selection={finished||menuPaused?null:supportSelection} content={engine.content} project={projectSupport} onClose={()=>setSupportSelection(null)}/> }
    {inspected && engine && <UnitInspection key={inspected.id} unit={inspected} content={engine.content} units={publicState?.units} round={publicState?.round} onClose={()=>setInspectedId(null)}/> }
    {ArcherBoardControls && archerPreview && <Suspense fallback={null}><ArcherBoardControls
      onShot={target=>{const hero=useBattleStore.getState().state?.player.heroId;if(hero)canvasRef.current?.qaArcherShot(hero,target);}}
      onPose={motion=>{const hero=useBattleStore.getState().state?.player.heroId;if(hero)canvasRef.current?.qaPlayCharacterAnimation(hero,motion);}}
      onReset={()=>{if(vm&&canvasRef.current){canvasRef.current.render({...vm,state:{...vm.state,units:[]}});canvasRef.current.render({...vm,state:archerPresentationState(vm.state)});}}}
      snapshot={()=>{const hero=useBattleStore.getState().state?.player.heroId,s=hero&&canvasRef.current?.qaAnimationSnapshot(hero);return s?`${s.motion} · frame ${s.frame+1} · ${s.facing}`:'';}}
    /></Suspense>}</>
  );
}
