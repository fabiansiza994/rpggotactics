import {useEffect,useState,useSyncExternalStore} from 'react';
import {ASCENT_CAMPAIGN,encounterOrder} from '../../game';
import {RANKED_SEASON,rankFor} from '../../game/ranked/ranked';
import {rankedApi,type RankedProfile} from '../ranked/rankedApi';
import {useBattleStore} from '../store/battleStore';
import {navigatePlay} from './navigation';
import {GameIcon} from '../react/components/GameIcon';

const compactQuery='(orientation: landscape) and (max-height: 500px)';
const subscribeCompact=(notify:()=>void)=>{const q=window.matchMedia(compactQuery);q.addEventListener('change',notify);return()=>q.removeEventListener('change',notify);};
/** Read-only hub summary. Daily quests are deliberately absent: there is no quest contract. */
export function HubOverview(){
 const account=useBattleStore(s=>s.account),hero=useBattleStore(s=>s.profile.selectedChampionId);
 const completed=useBattleStore(s=>s.runs[hero]?.completedEncounterIds.length??0);
 const [response,setResponse]=useState<{username:string|null;data:RankedProfile}|null>(null);
 const username='username' in account?account.username:null;
 useEffect(()=>{let active=true;if(account.status==='READY')void rankedApi.me().then(r=>{if(active&&r?.ok)setResponse({username,data:r.data});}).catch(()=>{});return()=>{active=false;};},[account.status,username]);
 const ranked=account.status==='READY'&&response?.username===username?response.data:null;
 const total=encounterOrder(ASCENT_CAMPAIGN).length;
 const expanded=!useSyncExternalStore(subscribeCompact,()=>window.matchMedia(compactQuery).matches,()=>false);
 const rank=ranked?.enabled?rankFor(ranked.rp):null;
 return <aside className="hub-overview" aria-label="Temporada y progreso">
  <details className="hub-season" open={expanded}><summary><small>TEMPORADA ACTUAL</small><h2>{RANKED_SEASON.name}</h2></summary><p>{rank&&ranked?.enabled?`${rank.label} · ${ranked.rp} RP`:account.status==='READY'?'Compite, asciende y demuestra tu estrategia.':'Inicia sesión para competir en Casual y Ranked.'}</p>{rank&&<progress className="hub-rank-progress" max={100} value={rank.progress} aria-label="Progreso del rango actual"/>}<button onClick={()=>navigatePlay('pvp',{queue:'ranked'})}>Ver Ranked <span aria-hidden="true">→</span></button></details>
  <details className="hub-progress" open={expanded}><summary><h2><GameIcon name="wait"/> TU PROGRESO</h2></summary><div className="hub-progress-row"><GameIcon name="arcane"/><div><strong>El Ascenso</strong><span>Encuentros completados con tu campeón</span><progress max={total} value={completed} aria-label="Progreso de El Ascenso"/></div><b>{completed}/{total}</b></div><div className="hub-progress-note"><GameIcon name="deck"/><span>Tu mazo y tu aventura avanzan contigo.</span><button onClick={()=>useBattleStore.getState().openDeckBuilder(hero)} aria-label="Ver colección del campeón">Ver colección →</button></div></details>
 </aside>;
}
