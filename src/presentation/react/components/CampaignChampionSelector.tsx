import {championCardStatus,championOf} from '../../assets/champions';
import {useEffect,useRef} from 'react';
import '../../../styles/campaign-champion-selector.css';
export interface CampaignChampionOption {id:string;name:string;portrait:string;completed:number;total:number;reason?:string}
export const campaignProgressLabel=(completed:number,total:number)=>completed>=total&&total>0?`${completed}/${total} · Completado`:completed>0?`${completed}/${total}`:'Sin empezar';
/** Presentation only: availability and per-champion progress come from the existing campaign catalog. */
export function CampaignChampionSelector({entries,selectedId,actName,onSelect,onClose,contextLabel='CAMPAÑA',subtitle='Progreso independiente por campeón'}:{entries:readonly CampaignChampionOption[];selectedId:string;actName:string;onSelect(id:string):void;onClose():void;contextLabel?:string;subtitle?:string}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const dialog=ref.current!;const previous=document.activeElement as HTMLElement|null;dialog.showModal();const selected=dialog.querySelector<HTMLButtonElement>('[aria-pressed="true"]')??dialog.querySelector('button');selected?.focus({preventScroll:true});selected?.scrollIntoView({block:'nearest'});return()=>{dialog.close();previous?.focus({preventScroll:true});};},[]);
 return <dialog ref={ref} className="campaign-champion-dialog" aria-labelledby="campaign-selector-title" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
  <div className="campaign-selector-panel"><header><div><span>{contextLabel} · {actName}</span><h2 id="campaign-selector-title">Elige tu campeón</h2><p>{subtitle}</p></div><button type="button" className="campaign-selector-close" aria-label="Cerrar selector de campeón" onClick={onClose}>×</button></header>
   <div className="campaign-champion-grid" onKeyDown={e=>{if(!['ArrowRight','ArrowLeft','ArrowDown','ArrowUp','Home','End'].includes(e.key))return;const buttons=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));const index=buttons.indexOf(document.activeElement as HTMLButtonElement);if(index<0)return;e.preventDefault();const step=e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:1;buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+step+buttons.length)%buttons.length]?.focus();}}>
    {entries.map(entry=><button key={entry.id} type="button" className="campaign-champion-option" aria-pressed={entry.id===selectedId} disabled={!!entry.reason} onClick={()=>onSelect(entry.id)}><img src={entry.portrait} alt=""/><span><strong>{entry.name}</strong>{entry.total>0&&<small>{campaignProgressLabel(entry.completed,entry.total)}</small>}<em data-status={entry.reason?'BLOQUEADO':entry.id===selectedId?'ACTIVO':'DISPONIBLE'}>{entry.reason??championCardStatus({active:entry.id===selectedId,locked:false,free:championOf(entry.id)?.accessLabel==='GRATIS'})}</em></span></button>)}
   </div>
  </div>
 </dialog>;
}
