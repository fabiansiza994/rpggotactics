import { useBattleStore } from '../../store/battleStore';
import { visualSettings } from '../../vfx/visualSettings';

/** Explicit offline fixtures, erased by production DEV folding. No server or account mutation. */
export function ArcherCampaignVisualLab() {
  const busy=useBattleStore(s=>s.playbackBusy||s.introLocked);
  if(!import.meta.env.DEV || import.meta.env.MODE!=='archercampaignqa' ||
    !['127.0.0.1','localhost','[::1]'].includes(location.hostname) ||
    !new URLSearchParams(location.search).has('archer-campaign-visual'))return null;
  const store=useBattleStore.getState();
  if(store.account.status!=='GUEST'&&store.account.status!=='DISABLED')return null;
  async function encounter(id: string) {
    useBattleStore.getState().selectCampaignHero('archer');
    await useBattleStore.getState().startRun(201,id);
  }
  function prepare() {
    const s=useBattleStore.getState(),e=s.engine;if(!e)return;
    const state=structuredClone(e.state),hero=state.units.find(u=>u.id===e.heroId)!;
    // An explicit fixture: authored map retained, known open cells in encounters I/VII/IX/X.
    const row=state.scenarioId==='hunt_10_veil_beast'?6:state.scenarioId==='hunt_09_guardian'?4:state.scenarioId==='hunt_07_cornered'?3:2;
    hero.pos={x:1,y:row};
    const enemies=state.units.filter(u=>u.faction==='ENEMY'&&u.hp>0);
    enemies.forEach((u,i)=>{u.pos={x:3+i,y:row};});
    if(enemies.length===2){const third=structuredClone(enemies[1]!);third.id='qa-third';third.pos={x:4,y:row+1<state.board.height?row+1:row-1};state.units.push(third);}
    state.player.hand=['ice_arrow','fire_arrow','poison_arrow','rebound_arrow','smoke_arrow'].map(cardId=>({cardId,uid:`qa-${cardId}`}));
    state.player.energy=state.player.maxEnergy;
    Object.assign(e.state,state);
    useBattleStore.setState({state:{...e.state},selectedCardUid:null,aim:null,notice:'Mano y posiciones QA; valores de cartas sin cambios.'});
  }
  function launch(id: string) {
    const s=useBattleStore.getState(),e=s.engine;if(!e)return;
    const target=e.state.units.find(u=>u.faction==='ENEMY'&&u.hp>0);
    if(!target)return;
    s.selectCard(`qa-${id}`);useBattleStore.getState().clickTile(target.pos);
  }
  return <details className="archer-visual-lab">
    <summary>QA visual · Sendero</summary>
    <small>Solo offline. Fixtures explícitos para revisar arte y efectos.</small>
    <div>{[['hunt_01_trail','I'],['hunt_05_stalker','V Acechador'],['hunt_07_cornered','VII Humo'],['hunt_09_guardian','IX Guardián'],['hunt_10_veil_beast','X Bestia']].map(([id,label])=>
      <button key={id} disabled={busy} onClick={()=>void encounter(id!)}>{label}</button>)}</div>
    <button disabled={busy} onClick={prepare}>Preparar cinco flechas QA</button>
    <button disabled={busy} onClick={()=>{
      const s=useBattleStore.getState(),e=s.engine;if(!e)return;
      const u=e.state.units.find(u=>u.defId==='veil_beast'||u.defId==='veil_guardian');if(!u)return;
      u.hp=Math.floor(u.maxHp/2);useBattleStore.setState({state:{...e.state},notice:'Fase herida: fixture visual QA.'});
    }}>Fase herida QA</button>
    <button onClick={()=>{visualSettings.timeScale=.25;}}>Cámara lenta QA</button>
    <button onClick={()=>{visualSettings.timeScale=1;}}>Tiempo normal QA</button>
    <div>{[['ice_arrow','Hielo'],['fire_arrow','Fuego'],['poison_arrow','Veneno'],['rebound_arrow','Rebote'],['smoke_arrow','Humo']].map(([id,label])=>
      <button key={id} disabled={busy} onClick={()=>launch(id!)}>Lanzar {label}</button>)}</div>
  </details>;
}
