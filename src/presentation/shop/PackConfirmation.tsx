import {useState} from 'react';
import type {CatalogOffer} from './api';
import {PackArt,packExpansion} from './PackArt';

/** Explicit UI confirmation; only the existing parent purchase handler can acquire cards. */
export function PackConfirmation({offer,balance,busy,onConfirm,onCancel,demo=false}:{
  offer:CatalogOffer;balance:number;busy:boolean;onConfirm:()=>void;onCancel:()=>void;demo?:boolean;
}) {
  const [review,setReview]=useState(false);
  const free=!!offer.booster?.freeGrant,count=offer.booster?.packs??1;
  const price=offer.price.toLocaleString('es-CO');
  const blocked=busy||balance<offer.price||!offer.availability.purchasable;
  return <section className="pack-confirmation" aria-label="Confirmar compra de sobre" data-review={review}>
    <header className="pack-scene-heading">
      <span className="pack-eyebrow">UN NUEVO DESCUBRIMIENTO</span>
      <h2 id="shop-detail-title">{packExpansion(offer.id)?.name??offer.title}</h2>
      <span className="pack-heading-ornament" aria-hidden="true">✧</span>
    </header>
    <div className="pack-stage">
      <div className="pack-preview-wrap"><PackArt packId={offer.id}/></div>
      <div className="pack-aura" aria-hidden="true"/>
    </div>
    <footer className="pack-confirmation-actions">
      {free?<p className="pack-price">Gratis restantes: {offer.freeRemaining??offer.purchaseLimit}/{offer.purchaseLimit} · 4 cartas</p>:
        <p className="pack-price">{count===1?'1 sobre':count+' sobres'} · {count*4} cartas · {price} Cristales Arcanos</p>}
      {review&&!free&&<div className="pack-cost-review" role="group" aria-label="Confirmar gasto de Cristales">
        <span>Saldo actual <strong>{balance.toLocaleString('es-CO')}</strong></span>
        <span>Coste <strong>{price}</strong></span>
        <span>Saldo después <strong>{(balance-offer.price).toLocaleString('es-CO')}</strong></span>
      </div>}
      {demo&&<small>Demostración · Sin premios reales</small>}
      <div className="pack-actions">
        <button className="shop-primary" disabled={blocked} onClick={()=>free||review?onConfirm():setReview(true)}>
          {busy?'Confirmando…':free?'ABRIR SOBRE GRATIS':review?'CONFIRMAR · '+price+' 💎':'COMPRAR Y ABRIR · '+price+' 💎'}
        </button>
        <button disabled={busy} onClick={()=>review?setReview(false):onCancel()}>Cancelar</button>
      </div>
      {!free&&review&&<small>Se descontarán {price} Cristales al confirmar. Sobre general.</small>}
      {balance<offer.price&&<p role="status">Saldo insuficiente</p>}
    </footer>
  </section>;
}
