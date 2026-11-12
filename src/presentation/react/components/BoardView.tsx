import { LinkedMechanismAction } from '../../mechanisms/LinkedAction';
const Act3AnimationTools=import.meta.env.DEV?lazy(()=>import('../../qa/act3/Act3AnimationTools').then(m=>({default:m.Act3AnimationTools}))):null;
import { UnitInspection, inspectedUnitAt } from './UnitInspection';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BattleCanvas } from '../../pixi/BattleCanvas';
import type { CharacterMotion } from '../../pixi/CharacterAnimator.ts';
import { presentationBus } from '../../events/presentationBus';
import { useBattleStore } from '../../store/battleStore';
import { useBoardViewModel } from '../useBoardViewModel';
import { archerBattlePreviewEnabled, archerPresentationState } from '../../qa/archer/battlePreview';
const ArcherBoardControls=import.meta.env.DEV?lazy(()=>import('../../qa/archer/ArcherBoardControls').then(m=>({default:m.ArcherBoardControls}))):null;

/** Hosts the Pixi board. React owns the lifecycle; Pixi owns the pixels. */
export function BoardView({ focusedEnemyId, menuPaused = false, qaSample, cameraOrigin }: { focusedEnemyId: string | null; menuPaused?: boolean; cameraOrigin?: {x:number;y:number}; qaSample?: (sample: ReturnType<BattleCanvas['qaFeelSnapshot']>) => void }) {
  const [inspectedId,setInspectedId] = useState<string|null>(null);
  const publicState = useBattleStore(s=>s.state);
  const engine = useBattleStore(s=>s.engine);
  const inspected = publicState?.units.find(u=>u.id===inspectedId);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<BattleCanvas | null>(null);
  const vm = useBoardViewModel(focusedEnemyId);
  const cameraX = cameraOrigin?.x, cameraY = cameraOrigin?.y;
  const initialVm = useRef(vm && cameraOrigin ? {...vm, cameraOrigin} : vm);
  const onlineCommand=useBattleStore(s=>s.onlineCommand);
  const archerPreview=archerBattlePreviewEnabled && onlineCommand===null;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const { setHoverTile, clickTile, tapTile, cancelAim } = useBattleStore.getState();
    const canvas = new BattleCanvas({
      onInspectUnit: positions => {
        const store=useBattleStore.getState();
        if(store.playbackBusy||store.introLocked||store.handDiscard)return false;
        const unit=inspectedUnitAt(store.state?.units??[],positions,!!store.selectedCardUid);
        if(!unit)return false;
        setInspectedId(unit.id);return true;
      },
      onTileHover: setHoverTile,
      onTileClick: clickTile,
      onTileTap: tapTile,
      onCancel: cancelAim,
      onPlaybackChange: useBattleStore.getState().setPlaybackBusy,
      onHandPulse: useBattleStore.getState().pulseHand,
      introVariant: () => useBattleStore.getState().introVariant,
      onIntroBeat: useBattleStore.getState().introBeat,
      onTurnBanner: useBattleStore.getState().showTurnBanner,
    });
    canvasRef.current = canvas;
    void canvas.mount(host, initialVm.current ?? undefined);
    if (import.meta.env.DEV) {
      // Dev-only debug handle for e2e tests and manual inspection in the console.
      (window as unknown as Record<string, unknown>).__RPGGO__ = {
        store: useBattleStore,
        wizardFacing: () => canvas.wizardFacingSnapshot(),
        tileToClient: (x: number, y: number) => canvas.tileToClient({ x, y }),
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
    const off = presentationBus.subscribe((events, state) => canvas.playEvents(events,
      archerBattlePreviewEnabled && useBattleStore.getState().onlineCommand===null ? archerPresentationState(state) : state));
    return () => {
      off();
      canvas.destroy();
      canvasRef.current = null;
    };
  }, []);

  useEffect(() => { canvasRef.current?.setMenuPaused(menuPaused); }, [menuPaused]);
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
    <><div
      ref={hostRef}
      className="board-host"
      onContextMenu={(e) => {
        e.preventDefault();
        useBattleStore.getState().cancelAim();
      }}
      // Pointer (not compat mouse) events: a tap elsewhere must not drop an armed touch preview.
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') useBattleStore.getState().setHoverTile(null);
      }}
    />
    {Act3AnimationTools && location.pathname==='/act3-qa' && publicState && <Suspense fallback={null}><Act3AnimationTools units={publicState.units} canvas={()=>canvasRef.current}/></Suspense> }
    {engine && vm && <LinkedMechanismAction engine={engine} project={p=>canvasRef.current?.tileToClient(p)??null} polygon={p=>canvasRef.current?.tilePolygonToClient(p)??null}/> }
    {inspected && engine && <UnitInspection key={inspected.id} unit={inspected} content={engine.content} units={publicState?.units} onClose={()=>setInspectedId(null)}/> }
    {ArcherBoardControls && archerPreview && <Suspense fallback={null}><ArcherBoardControls
      onShot={target=>{const hero=useBattleStore.getState().state?.player.heroId;if(hero)canvasRef.current?.qaArcherShot(hero,target);}}
      onPose={motion=>{const hero=useBattleStore.getState().state?.player.heroId;if(hero)canvasRef.current?.qaPlayCharacterAnimation(hero,motion);}}
      onReset={()=>{if(vm&&canvasRef.current){canvasRef.current.render({...vm,state:{...vm.state,units:[]}});canvasRef.current.render({...vm,state:archerPresentationState(vm.state)});}}}
      snapshot={()=>{const hero=useBattleStore.getState().state?.player.heroId,s=hero&&canvasRef.current?.qaAnimationSnapshot(hero);return s?`${s.motion} · frame ${s.frame+1} · ${s.facing}`:'';}}
    /></Suspense>}</>
  );
}
