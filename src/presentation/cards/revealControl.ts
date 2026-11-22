/** Rollout control for presentation only. Never authorizes a game/economic action. */
export type RevealControl={version:1;mode:'off'|'pilot';accounts:string[];expiresAt:number};
export type RevealAccount={status:string;username?:string};
const OFF:RevealControl={version:1,mode:'off',accounts:[],expiresAt:0};
let control=OFF,account:RevealAccount={status:'SIGNED_OUT'},request:Promise<void>|null=null;
const listeners=new Set<()=>void>();
export function parseRevealControl(value:unknown):RevealControl{
 if(!value||typeof value!=='object')return OFF;
 const c=value as Partial<RevealControl>;
 if(c.version!==1||c.mode!=='pilot'||!Array.isArray(c.accounts)||c.accounts.length<1||c.accounts.length>16||!c.accounts.every(x=>typeof x==='string'&&/^[a-zA-Z0-9_]{1,40}$/.test(x))||!Number.isFinite(c.expiresAt))return OFF;
 return{version:1,mode:'pilot',accounts:[...new Set(c.accounts)],expiresAt:c.expiresAt!};
}
export function allowsReveal(c:RevealControl,a:RevealAccount,now=Date.now()){
 return c.mode==='pilot'&&c.expiresAt>now&&a.status==='READY'&&!!a.username&&c.accounts.includes(a.username);
}
export const revealEnabled=()=>allowsReveal(control,account);
export function setRevealAccount(next:RevealAccount){account=next;for(const fn of listeners)fn();}
export function applyRevealControl(value:unknown){control=parseRevealControl(value);for(const fn of listeners)fn();}
export function subscribeRevealControl(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};}
export function refreshRevealControl():Promise<void>{
 if(request)return request;
 request=(async()=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3000);try{
  const r=await fetch('/arcane-revelation-control.json',{cache:'no-store',credentials:'omit',signal:controller.signal});applyRevealControl(r.ok?await r.json():null);
 }catch{applyRevealControl(null);}finally{clearTimeout(timer);request=null;}})();return request;
}
