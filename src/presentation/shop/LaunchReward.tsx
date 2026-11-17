import {useCallback, useEffect, useRef, useState} from 'react';
import {storeApi, type LaunchRewardResponse, type Wallet} from './api';
import {loadSession} from '../cloud/session';
import '../../styles/launch-reward.css';

/** Explicit claim only. All eligibility and balances come from the authenticated server. */
export function LaunchReward({token,onWallet,onAuthExpired}:{token:string;onWallet(wallet:Wallet):void;onAuthExpired():void}) {
  const [reward,setReward]=useState<LaunchRewardResponse|null>(null);
  const [busy,setBusy]=useState(false), [message,setMessage]=useState('');
  const lock=useRef(false), alive=useRef(true);
  const refresh=useCallback(async()=>{
    const r=await storeApi.launchReward(token);
    if(alive.current&&loadSession()?.token===token&&r.ok)setReward(r.data);
  },[token]);
  useEffect(()=>{alive.current=true;void refresh();window.addEventListener('focus',refresh);
    return()=>{alive.current=false;window.removeEventListener('focus',refresh);};},[refresh]);
  async function claim(){
    if(lock.current)return;lock.current=true;setBusy(true);setMessage('');
    const r=await storeApi.launchReward(token,true);
    lock.current=false;
    if(!alive.current||loadSession()?.token!==token)return;
    setBusy(false);
    if(r.ok){setReward(r.data);onWallet(r.data.wallet);
      window.dispatchEvent(new Event('rpggo-wallet-changed'));
      setMessage(r.data.credited===500?'+500 Cristales Arcanos · ¡Regalo recibido!':'Este regalo ya fue recibido.');
    }else{if(r.error.kind==='AUTH')onAuthExpired();setMessage(r.error.message);if(r.error.code==='LAUNCH_REWARD_INACTIVE')void refresh();}
  }
  if(!reward||(!reward.enabled&&!message)||(reward.claimed&&!message))return null;
  return <section className="launch-reward" aria-labelledby="launch-reward-title">
    <div><span aria-hidden="true">🎁</span><h2 id="launch-reward-title">Regalo de Lanzamiento</h2></div>
    <p>¡Las nuevas expansiones han llegado a RPG-GO Tactics!</p>
    {!reward.claimed&&reward.enabled&&<><strong>+500 Cristales Arcanos</strong>
      <button className="shop-primary" disabled={busy} onClick={()=>void claim()}>{busy?'Confirmando…':'RECLAMAR 500 💎'}</button></>}
    {message&&<p className={reward.claimed?'launch-reward-confirmed':undefined} role="status">{message}</p>}
  </section>;
}
