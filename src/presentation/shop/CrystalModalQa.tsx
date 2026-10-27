import catalog from '../../../qa/crystal-modal/catalog.json';
import {useEffect,useState} from 'react';
import {CrystalPurchaseModal} from './CrystalPurchaseModal';
import {realMoneyApi} from './realMoney';
import type {Wallet} from './api';
import {PURCHASE_CONSENT_VERSION} from '../../game/store/purchaseConsent';

/** DEV/loopback only. No session, payment SDK, order creation or server writes. */
export function CrystalModalQa(){
 const [ready,setReady]=useState(false);const [open,setOpen]=useState(false);const [balance,setBalance]=useState(1250);
 useEffect(()=>{
  const original={...realMoneyApi};
  realMoneyApi.packages=async()=>({ok:true,data:catalog});
  realMoneyApi.history=async()=>({ok:true,data:{orders:[]}});
  realMoneyApi.checkout=async()=>({ok:false,error:{kind:'NETWORK',status:0,code:'QA',message:'Checkout deliberately disabled in visual fixture'}});
  queueMicrotask(()=>setReady(true));
  return()=>{Object.assign(realMoneyApi,original);};
 },[]);
 return <main className="shop-screen" style={{padding:24}}><header className="shop-header"><h1>Tienda · QA visual</h1><span>{balance} Cristales</span><button onClick={()=>setOpen(true)}>+ Cristales</button></header><p>Catálogo simulado exclusivamente visual. No crea pedidos ni abre ePayco. Consentimiento: {PURCHASE_CONSENT_VERSION}.</p>{ready&&<CrystalPurchaseModal open={open} onClose={()=>setOpen(false)} token="qa-local-not-a-session" onWallet={(w:Wallet)=>setBalance(w.balance)} onAuthExpired={()=>{}}/>}</main>;
}
