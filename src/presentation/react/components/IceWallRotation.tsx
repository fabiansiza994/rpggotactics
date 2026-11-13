import {useBattleStore} from '../../store/battleStore';
export function IceWallRotation() {
 const uid=useBattleStore(s=>s.selectedCardUid), state=useBattleStore(s=>s.state);
 const orientation=useBattleStore(s=>s.wallOrientation), rotate=useBattleStore(s=>s.rotateIceWall);
 const busy=useBattleStore(s=>s.playbackBusy || s.introLocked);
 if(state?.player.hand.find(c=>c.uid===uid)?.cardId!=='ice_wall') return null;
 return <button type="button" className="ice-wall-rotation" disabled={busy} aria-label={`Rotar Barrera de Hielo: ${orientation==='HORIZONTAL'?'horizontal':'vertical'}`} onClick={rotate}>↻ {orientation==='HORIZONTAL'?'Horizontal':'Vertical'}</button>;
}
