import type {CSSProperties} from 'react';
import type {MarketExpansionView} from '../../game/store/market-expansions';
import type {CatalogOffer} from './api';
import {CARD_PRESENTATION_CONTENT} from '../catalog/cardPresentation';
import {MarketCard} from './MarketCard';
import {PackArt} from './PackArt';
import {expansionVisual} from './expansionVisuals';
import '../../styles/expansion-products.css';

/** Editorial choices only. Each is checked against the live saleable contents before display. */
export const EXPANSION_SPOTLIGHTS:Readonly<Record<string,string>>={
 allies_of_darkness:'dark_dark_world',path_to_light:'light_light_world',
 origins_arcanos:'arcane_inversion',thunder_god:'thunder_incarnation',antarctic_magic:'absolute_zero',
 pack_pact:'summon_war_drake',warrior_promise:'execution',reserva_cazador:'hunters_net',
};
export function expansionSpotlight(e:MarketExpansionView,offers:readonly CatalogOffer[]){
 const id=EXPANSION_SPOTLIGHTS[e.id];
 return e.status==='AVAILABLE'&&id&&e.cardIds.includes(id)&&offers.some(o=>o.booster?.expansionId===e.id&&o.contents.some(c=>c.kind==='CARD'&&c.cardId===id))
  ? CARD_PRESENTATION_CONTENT.cards[id] : undefined;
}
export function ExpansionProduct({expansion:e,offers,owned,onSelect}:{expansion:MarketExpansionView;offers:readonly CatalogOffer[];owned:number;onSelect:(id:string)=>void}){
 const visual=expansionVisual(e.id,e.art),card=expansionSpotlight(e,offers);
 const free=e.status==='AVAILABLE'?offers.find(o=>o.booster?.expansionId===e.id&&o.booster.freeGrant)?.freeRemaining??0:0;
 const label=e.status==='AVAILABLE'?'DISPONIBLE':e.status==='CATALOG_ONLY'?'SIN SOBRES':'PRÓXIMAMENTE';
 return <button className="expansion-product" data-status={e.status} data-expansion={e.id}
  style={{'--product-accent':visual.accent,'--product-glow':visual.glow} as CSSProperties}
  aria-label={`${e.name} · ${label}${e.status!=='COMING_SOON'?` · ${owned}/${e.cardIds.length} coleccionadas`:''}${free?` · ${free} sobres gratis`:''}`}
  onClick={()=>onSelect(e.id)}>
  <span className="expansion-product-heading"><strong>{e.name}</strong><small>{label}</small></span>
  <span className="expansion-product-stage" aria-hidden="true">
   <img className="expansion-product-background" src={visual.environment} alt="" loading="lazy"/>
   {e.status==='AVAILABLE'?<>
    <span className="expansion-product-pack"><PackArt packId={e.packs[0]?.offerId??`booster_${e.id}_x1`}/></span>
    {card&&<span className="expansion-product-card" data-card-id={card.id}><MarketCard card={card}/></span>}
   </>:<span className="expansion-product-future">✧</span>}
  </span>
  <span className="expansion-product-info">
   {e.status!=='COMING_SOON'?<span>{e.cardIds.length} cartas · <b>{owned}/{e.cardIds.length}</b> coleccionadas</span>:<span>Contenido por anunciar</span>}
   {free>0&&<span className="expansion-product-free">🎁 {free} sobres gratis</span>}
  </span>
 </button>;
}
