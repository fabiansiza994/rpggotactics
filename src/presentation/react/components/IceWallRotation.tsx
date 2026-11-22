import {useBattleStore} from '../../store/battleStore';
export function IceWallRotation() {
 const uid=useBattleStore(s=>s.selectedCardUid), state=useBattleStore(s=>s.state);
 const orientation=useBattleStore(s=>s.wallOrientation), rotate=useBattleStore(s=>s.rotateIceWall);
 const busy=useBattleStore(s=>s.playbackBusy || s.introLocked);
 if(!['ice_wall','glacial_field'].includes(state?.player.hand.find(c=>c.uid===uid)?.cardId??'')) return null;
 return <button type="button" className="ice-wall-rotation" disabled={busy} aria-label={`Rotar área de hielo: ${orientation==='HORIZONTAL'?'horizontal':'vertical'}`} onClick={rotate}>↻ {orientation==='HORIZONTAL'?'Horizontal':'Vertical'}</button>;
}
