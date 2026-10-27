import {createContext,useContext,useEffect,useState} from 'react';
import {socialApi,type FriendProfileData,type Presence} from './api';
import {loadSession} from '../cloud/session';
import {masteryFor} from '../../game/mastery/mastery';
import {rankFor} from '../../game/ranked/ranked';
import {SocialChampionPortrait} from './SocialChampionPortrait';
import {PRESENTATION_CONTENT} from '../qa/shapeshifter/runtime';
import {MODE_LABEL,RESULT_LABEL,type PvpResult} from '../pvp/historyApi';
export const FriendProfileAccess=createContext(async(username:string):Promise<FriendProfileData|null>=>{
 const session=loadSession();if(!session)throw new Error('Sesión no disponible');
 const result=await socialApi.profile(session.token,username);if(!result.ok)throw new Error('Perfil no disponible');return result.data;
});
export function lastSeenLabel(at:number,now=Date.now()){
 const minutes=Math.max(0,Math.floor((now-at)/60000));
 return minutes<1?'Hace un momento':minutes<60?`Hace ${minutes} min`:minutes<1440?`Hace ${Math.floor(minutes/60)} h`:minutes<2880?'Ayer':`Hace ${Math.floor(minutes/1440)} días`;
}
const name=(id:string)=>PRESENTATION_CONTENT.heroes[id]?.name??id;
function Champion({id}:{id:string}){return <span className="friend-stat-champion"><SocialChampionPortrait id={id}/>{name(id)}</span>;}
export function FriendProfileStats({username,presence}:{username:string;presence:Presence}){
 const online=presence!=='OFFLINE';
 const access=useContext(FriendProfileAccess);
 const [data,setData]=useState<FriendProfileData|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{let alive=true;void access(username).then(value=>{if(alive)setData(value);}).catch(()=>{if(alive)setFailed(true);});return()=>{alive=false;};},[username,access,presence]);
 if(!data)return <p role="status">{failed?'Ficha adicional no disponible. El chat y el historial siguen disponibles.':'Cargando ficha social…'}</p>;
 const mastery=data.mastery?masteryFor(data.mastery.xp):null;
 return <div className="friend-profile-stats" aria-label="Actividad y estadísticas del amigo">
  <article><small>ACTIVIDAD</small><strong>{presence==='IN_PVP'?'En partida · PvP':online?'En línea':'Desconectado'}</strong>{data.lastSeen&&<span>Última conexión: {online?'Ahora':lastSeenLabel(data.lastSeen)}</span>}</article>
  <article><small>RANKED · PRETEMPORADA</small><strong>{data.ranked?rankFor(data.ranked.rp).label:'Sin clasificación esta temporada'}</strong>{data.ranked&&<span>{data.ranked.rp} RP</span>}</article>
  {data.mostUsed&&<article><small>MÁS USADO · PVP</small><Champion id={data.mostUsed.champion}/><span>{data.mostUsed.matches} partidas registradas</span></article>}
  {data.mastery&&mastery&&<article><small>MAYOR MAESTRÍA</small><Champion id={data.mastery.champion}/><strong>Nivel {mastery.level}</strong><progress aria-label="Progreso de Maestría" max={100} value={mastery.progress}/></article>}
  {data.lastMatch&&<article><small>ÚLTIMA PARTIDA · PVP</small><Champion id={data.lastMatch.champion}/><strong>{MODE_LABEL[data.lastMatch.mode]??data.lastMatch.mode} · {RESULT_LABEL[data.lastMatch.result as PvpResult]??data.lastMatch.result}</strong><span>{new Date(data.lastMatch.playedAt).toLocaleString('es',{dateStyle:'medium',timeStyle:'short'})}</span></article>}
 </div>;
}
