import { useEffect, useState } from 'react';
import type { GameContent, PlayerProfile } from '../../game';
import { FREE_CATALOG } from '../../game/data/free-catalog';
import { catalogFactsFrom, discoverRarities, freeCatalogReleased, type DiscoverRarityView } from '../../game/collection/free-catalog';
import { useBattleStore } from '../store/battleStore';
import { PRESENTATION_CONTENT } from '../qa/shapeshifter/runtime';
import { FreeCatalogCard } from './FreeCatalog';
export function newlyOwnedCatalogRows(content:GameContent,before:PlayerProfile,after:PlayerProfile,heroId:string):DiscoverRarityView[] {
  const facts=catalogFactsFrom({runs:()=>[],worldHistory:{}});
  const old=new Set(discoverRarities(content,before,heroId,facts).filter(r=>r.owned).map(r=>r.cardId));
  return discoverRarities(content,after,heroId,facts).filter(r=>r.owned&&!old.has(r.cardId)&&(r.tier==='ULTRA'||r.tier==='LEGENDARY')).map(r=>({...r,unlock:{...r.unlock,met:true,progress:r.unlock.progress?{...r.unlock.progress,current:r.unlock.progress.target}:null}}));
}
export function CatalogRewardView({row,content}:{row:DiscoverRarityView;content:GameContent}) {
  const def=content.cards[row.cardId];if(!def)return null;
  return <section className="catalog-milestone" aria-label={row.tier==='ULTRA'?'Nueva carta Ultra':'Nueva carta Legendaria'}>
    <span>{row.tier==='ULTRA'?'ACTO COMPLETADO':'MAESTRÍA 7 ALCANZADA'}</span>
    <h3>{row.tier==='ULTRA'?'NUEVA CARTA ULTRA':'LEGENDARIA DESBLOQUEADA'}</h3>
    <FreeCatalogCard card={def} row={row}/>
  </section>;
}
/** Baseline is taken during play, never on login. Retroactive grants do not open a reveal. */
export function useCatalogBattleFeedback() {
  const engine=useBattleStore(s=>s.engine), profile=useBattleStore(s=>s.profile), state=useBattleStore(s=>s.state);
  const cloud=useBattleStore(s=>s.cloud), account=useBattleStore(s=>s.account);
  const identity=account.status==='READY'?String(account.userId):'guest';
  const [before,setBefore]=useState({engine,profile,identity});
  if(engine!==before.engine||identity!==before.identity) setBefore({engine,profile,identity});
  const heroId=engine?.scenario.hero.heroId??'';
  const finished=state?.outcome?.result==='WON';
  const rows=finished&&engine===before.engine&&identity===before.identity&&freeCatalogReleased(PRESENTATION_CONTENT)&&!cloud.busy&&!cloud.error
    ?newlyOwnedCatalogRows(PRESENTATION_CONTENT,before.profile,profile,heroId):[];
  const accountId=account.status==='READY'?String(account.userId):'guest';
  // The in-battle before/after ownership comparison is the primary deduplication. Local markers
  // only prevent replaying a presentation after restoring the same battle on this device.
  const unseen=rows.filter(row=>{try{return !localStorage.getItem(`catalog-reveal:${accountId}:${row.cardId}`);}catch{return true;}});
  const key=unseen.map(r=>r.cardId).join(',');
  useEffect(()=>{
    if(!finished||!key)return;
    for(const cardId of key.split(','))try{localStorage.setItem(`catalog-reveal:${accountId}:${cardId}`,'1');localStorage.setItem(`catalog-catchup:${accountId}:${cardId}`,'1');}catch{/* Presentation-only storage is optional. */}
  },[key,accountId,finished]);
  // Do not read the marker again for the same mounted completion after the effect writes it.
  const [reveals,setReveals]=useState<{engine:typeof engine;identity:string;rows:DiscoverRarityView[]}>({engine:null,identity:'',rows:[]});
  if(unseen.length && (reveals.engine!==engine || reveals.identity!==identity || unseen.some(r=>!reveals.rows.some(x=>x.cardId===r.cardId))))setReveals({engine,identity,rows:unseen});
  if(!finished||reveals.engine!==engine||reveals.identity!==identity)return null;
  return <>{reveals.rows.map(row=><CatalogRewardView key={row.cardId} row={row} content={PRESENTATION_CONTENT}/>)}</>;
}
export function masteryLegendaryName(heroId:string,oldLevel:number,newLevel:number,content:GameContent):string|null {
  if(!freeCatalogReleased(content)||oldLevel>=7||newLevel<7)return null;
  const entry=FREE_CATALOG[heroId]?.find(r=>r.tier==='LEGENDARY');return entry?content.cards[entry.cardId]?.name??null:null;
}
