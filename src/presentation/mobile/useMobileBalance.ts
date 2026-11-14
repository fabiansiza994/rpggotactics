import {useEffect,useState} from 'react';
import {CLOUD_CONFIG} from '../cloud/config';
import {request} from '../cloud/http';
import {loadSession} from '../cloud/session';
import {useBattleStore} from '../store/battleStore';
import type {Wallet} from '../shop/api';
/** Existing read-only wallet endpoint; /state does not promise a wallet. */
export const fetchMobileWallet=(token:string)=>request<{wallet:Wallet}>(CLOUD_CONFIG.apiUrl,'/api/tactics/wallet',{token,timeoutMs:CLOUD_CONFIG.timeoutMs});
export function useMobileBalance(enabled:boolean,route:string){
 const account=useBattleStore(s=>s.account);const username='username'in account?account.username:'';
 const [balance,setBalance]=useState<{username:string;value:number}|null>(null);
 useEffect(()=>{
  let alive=true;const session=loadSession();
  if(enabled&&account.status==='READY'&&session)void fetchMobileWallet(session.token).then(r=>{
   if(!alive||loadSession()?.token!==session.token)return;
   if(!r.ok){if(r.error.kind==='AUTH')useBattleStore.getState().sessionExpired();return;}
   if(Number.isFinite(r.data.wallet?.balance))setBalance({username,value:r.data.wallet.balance});
  }).catch(()=>{});
  return()=>{alive=false;};
 },[enabled,route,account.status,username]);
 return account.status==='READY'&&balance?.username===username?balance.value:null;
}
