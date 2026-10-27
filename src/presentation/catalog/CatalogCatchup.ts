import { useEffect,useRef } from 'react';
import { FREE_CATALOG } from '../../game/data/free-catalog';
import { heroProfile,type GameContent,type PlayerProfile } from '../../game';
import { freeCatalogReleased } from '../../game/collection/free-catalog';
import { PRESENTATION_CONTENT } from '../qa/shapeshifter/runtime';
import { useBattleStore } from '../store/battleStore';
/** Ownership only: a notice never claims, pays or invents a grant. */
export function ownedCatalogMilestones(profile:PlayerProfile,content:GameContent):string[] {
  if(!freeCatalogReleased(content))return [];
  return Object.entries(FREE_CATALOG).flatMap(([hero,entries])=>!content.heroes[hero]?[]:entries.filter(e=>e.tier!=='COMMON'&&(heroProfile(profile,hero,content).collection[e.cardId]?.copies??0)>0).map(e=>e.cardId));
}
export function useCatalogCatchupNotice() {
  const profile=useBattleStore(s=>s.profile),account=useBattleStore(s=>s.account),screen=useBattleStore(s=>s.screen),notice=useBattleStore(s=>s.accountNotice);
  const shown=useRef(new Set<string>());
  useEffect(()=>{
    if(account.status!=='READY'||screen==='BATTLE'||notice)return;
    const unseen=ownedCatalogMilestones(profile,PRESENTATION_CONTENT).filter(id=>{
      const key=`catalog-catchup:${account.userId}:${id}`;
      if(shown.current.has(key))return false;
      try{return !localStorage.getItem(key);}catch{return true;}
    });
    if(!unseen.length)return;
    for(const id of unseen){const key=`catalog-catchup:${account.userId}:${id}`;shown.current.add(key);try{localStorage.setItem(key,'1');}catch{/* Optional presentation storage. */}}
    useBattleStore.setState({accountNotice:`Catálogo gratuito: ${unseen.length} carta${unseen.length===1?'':'s'} disponibles en tu colección. Consulta «Descubre las rarezas».`});
  },[profile,account,screen,notice]);
}
