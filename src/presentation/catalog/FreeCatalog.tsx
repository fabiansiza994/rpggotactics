import { useEffect, useState } from 'react';
import type { CardDefinition, GameContent } from '../../game';
import { catalogFactsFrom, discoverRarities, freeCatalogReleased, type DiscoverRarityView } from '../../game/collection/free-catalog';
import { PRESENTATION_CONTENT } from '../qa/shapeshifter/runtime';
import { useBattleStore } from '../store/battleStore';
import { useMastery } from '../mastery/masteryApi';
import { CLOUD_CONFIG } from '../cloud/config';
import { loadSession } from '../cloud/session';
import { request } from '../cloud/http';
import { CardTypeVisual } from '../react/components/CardTypeVisual';
import { CardPremiumFx } from '../react/components/CardPremiumFx';
import { SpellArt } from '../react/components/SpellArt';
import { RARITY_LABEL } from '../react/format';
import { useCardPremiumEffect } from '../cards/useCardPremiumEffect';
import '../../styles/free-catalog.css';

export type CatalogResponse = { released:boolean; masteryAvailable:boolean; champions:Record<string,DiscoverRarityView[]> };
export function FreeCatalogCard({card,row}:{card:CardDefinition;row:DiscoverRarityView}) {
  const ref=useCardPremiumEffect<HTMLElement>(card,'grid');
  return <article ref={ref} className="free-catalog-card" data-owned={row.owned} data-rarity={row.rarity}>
    <div className="db-detail-art"><SpellArt cardId={card.id} spell={card.presentation.visualKey}/><CardTypeVisual card={card}/><CardPremiumFx def={card}/></div>
    <h3 className="db-detail-name">{row.name}</h3>
    <p className="catalog-rarity">{RARITY_LABEL[row.rarity]} · {row.cost} EN{row.unique?' · Única':''}</p>
    <p className="catalog-rules">{row.rulesText}</p>
    <strong className="catalog-ownership">{row.owned?`En colección · ${row.copies} copia${row.copies===1?'':'s'}`:'Bloqueada'}</strong>
    <p className="catalog-unlock">{row.unlock.label}</p>
    {row.unlock.progress && <div className="catalog-progress"><progress value={row.unlock.progress.current} max={row.unlock.progress.target} aria-label={`Progreso: ${row.unlock.label}`}/><span>{row.unlock.progress.current}/{row.unlock.progress.target}</span></div>}
  </article>;
}
export function DiscoverRaritiesView({rows,content}:{rows:readonly DiscoverRarityView[];content:GameContent}) {
  return <details className="discover-rarities"><summary>✧ Descubre las rarezas</summary>
    <p>Cuatro rarezas, obtenidas jugando. Puedes consultar sus efectos antes de desbloquearlas.</p>
    {rows.some(r=>r.owned&&r.tier!=='COMMON') && <p className="catalog-catchup" role="status">Tus desbloqueos anteriores ya están disponibles en la colección.</p>}
    <div className="catalog-rarity-grid">{rows.map(row=>content.cards[row.cardId]&&<FreeCatalogCard key={row.cardId} card={content.cards[row.cardId]!} row={row}/>)}</div>
  </details>;
}
export function DiscoverRarities({heroId}:{heroId:string}) {
  const profile=useBattleStore(s=>s.profile), account=useBattleStore(s=>s.account);
  const runs=useBattleStore(s=>s.runs), worldRuns=useBattleStore(s=>s.worldRuns), worldHistory=useBattleStore(s=>s.worldHistory);
  const mastery=useMastery().state;
  const [remote,setRemote]=useState<{account:typeof account;data:CatalogResponse}|null>(null);
  useEffect(()=>{
    if(account.status!=='READY')return;
    const session=loadSession();if(!session||!CLOUD_CONFIG.apiUrl)return;
    let active=true;
    void request<CatalogResponse>(CLOUD_CONFIG.apiUrl,'/api/tactics/free-catalog',{token:session.token,timeoutMs:CLOUD_CONFIG.timeoutMs}).then(r=>{if(active&&r.ok)setRemote({account,data:r.data});});
    return()=>{active=false;};
  },[account,profile]);
  if(account.status==='READY') {
    if(remote?.account!==account||!remote.data.released)return null;
    return <DiscoverRaritiesView rows={remote.data.champions[heroId]??[]} content={PRESENTATION_CONTENT}/>;
  }
  if(!freeCatalogReleased(PRESENTATION_CONTENT))return null;
  const facts=catalogFactsFrom({runs:id=>[runs[id],...Object.values(worldRuns).map(r=>r[id])],worldHistory,masteryXp:mastery?.enabled?id=>mastery.champions[id]?.xp??0:undefined});
  return <DiscoverRaritiesView rows={discoverRarities(PRESENTATION_CONTENT,profile,heroId,facts)} content={PRESENTATION_CONTENT}/>;
}
