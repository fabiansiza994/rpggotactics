import { realMoneyPurchasesEnabled } from './paymentAvailability';
import {useEffect, useRef, useState} from 'react';
import {CrystalShopPanel} from './CrystalShopPanel';
import type {Wallet} from './api';
import '../../styles/crystal-shop.css';

/** Kept mounted after first open: closing the presentation never discards an order or its poll. */
function EnabledCrystalPurchaseModal({open,onClose,token,onWallet,onAuthExpired}: {
  open:boolean; onClose():void; token:string|null; onWallet(wallet:Wallet):void; onAuthExpired():void;
}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [critical,setCritical]=useState(false);
  const opener=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    const node=dialog.current;
    if(!node)return;
    if(open){opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;if(!node.open)node.showModal();}
    else if(node.open){node.close();opener.current?.focus();}
  },[open]);
  return <dialog ref={dialog} className="crystal-purchase-modal" aria-labelledby="crystal-modal-title"
    onCancel={event=>{event.preventDefault();if(!critical)onClose();}}>
    <header><div><small>TIENDA ARCANA · RECARGA</small><h2 id="crystal-modal-title">Comprar Cristales</h2></div>
      <button type="button" aria-label="Cerrar compra de Cristales" disabled={critical} onClick={onClose}>×</button>
    </header>
    <div className="crystal-modal-body"><CrystalShopPanel token={token} onWallet={onWallet} onAuthExpired={onAuthExpired} onCriticalChange={setCritical}/></div>
    <footer><span>Tu pedido se conserva aunque cierres este panel.</span><button disabled={critical} onClick={onClose}>Volver a la tienda</button></footer>
  </dialog>;
}

export function CrystalPurchaseModal(props: Parameters<typeof EnabledCrystalPurchaseModal>[0]) {
  return realMoneyPurchasesEnabled() ? <EnabledCrystalPurchaseModal {...props} /> : null;
}
