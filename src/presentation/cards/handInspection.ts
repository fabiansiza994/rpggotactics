import {useState} from 'react';
export interface HandInspection {epoch:unknown;history:string[];hovered:string|null;selected:string|null}
export function reconcileInspection(current:HandInspection,epoch:unknown,hand:readonly string[],selected:string|null,ended=false):HandInspection {
 if(ended)return current.epoch===epoch&&current.history.length===0&&!current.hovered&&!current.selected?current:{epoch,history:[],hovered:null,selected:null};
 const base=current.epoch===epoch&&!ended?current:{epoch,history:[],hovered:null,selected:null};
 const active=selected&&hand.includes(selected)?selected:null;
 let history=base.history.filter(uid=>hand.includes(uid));
 if(active&&active!==base.selected)history=[active,...history.filter(uid=>uid!==active)];
 const hovered=base.hovered&&hand.includes(base.hovered)?base.hovered:null;
 return base===current&&active===current.selected&&hovered===current.hovered&&history.join('\0')===current.history.join('\0')?current:{epoch,history,hovered,selected:active};
}
export function inspectHand(current:HandInspection,uid:string,on:boolean,locked=false):HandInspection {
 if(!on)return current.hovered===uid?{...current,hovered:null}:current;
 if(locked)return current;
 const history=[uid,...current.history.filter(id=>id!==uid)];
 return current.hovered===uid&&current.history[0]===uid?current:{...current,hovered:uid,history};
}
export function useHandInspection(epoch:unknown,hand:readonly string[],selected:string|null,ended:boolean,locked:boolean){
 const [stored,setStored]=useState<HandInspection>({epoch,history:[],hovered:null,selected:null});
 const current=reconcileInspection(stored,epoch,hand,selected,ended);
 if(current!==stored)setStored(current);
 return{hovered:current.hovered,uid:current.selected??current.history[0]??null,
 inspect:(uid:string,on:boolean)=>setStored(s=>inspectHand(s,uid,on,locked||!!selected)),
 remember:(uid:string)=>setStored(s=>inspectHand(s,uid,true)),};
}
