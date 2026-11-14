import {useEffect,useSyncExternalStore} from 'react';
export type InterfacePreference='auto'|'mobile'|'desktop';
export type InterfaceKind='mobile'|'desktop';
export const INTERFACE_KEY='rpg-go-tactics:interface';
export const PHONE_QUERY='(max-width: 600px)';
export const TABLET_QUERY='(orientation: portrait) and (max-width: 1024px) and (pointer: coarse)';
export function preferenceOf(value:unknown):InterfacePreference{return value==='mobile'||value==='desktop'?value:'auto';}
export function resolveInterface(preference:InterfacePreference,phone:boolean,tablet:boolean):InterfaceKind{return preference==='auto'?(phone||tablet?'mobile':'desktop'):preference;}
/** Presentation-only preference. Lock preserves the mounted view until battle/transaction exits. */
export function createInterfaceController(initial:InterfacePreference,automatic:InterfaceKind,save:(p:InterfacePreference)=>void){
 let preference=initial,auto=automatic,locked=false;
 let snapshot={preference,applied:preference==='auto'?auto:preference,pending:false};
 const listeners=new Set<()=>void>();
 const publish=()=>{const desired=preference==='auto'?auto:preference;const applied=locked?snapshot.applied:desired;const next={preference,applied,pending:desired!==applied};if(JSON.stringify(next)!==JSON.stringify(snapshot)){snapshot=next;listeners.forEach(f=>f());}};
 return {getSnapshot:()=>snapshot,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},setPreference:(next:InterfacePreference)=>{preference=next;save(next);publish();},setAutomatic:(next:InterfaceKind)=>{auto=next;publish();},setLocked:(next:boolean)=>{locked=next;publish();},restore:(value:unknown)=>{preference=preferenceOf(value);publish();}};
}
const read=()=>{try{return preferenceOf(localStorage.getItem(INTERFACE_KEY));}catch{return 'auto' as const;}};
const automatic=():InterfaceKind=>resolveInterface('auto',typeof matchMedia==='function'&&matchMedia(PHONE_QUERY).matches,typeof matchMedia==='function'&&matchMedia(TABLET_QUERY).matches);
export const interfaceController=createInterfaceController(read(),automatic(),p=>{try{localStorage.setItem(INTERFACE_KEY,p);}catch{/* A blocked preference store must not block play. */}});
export function useInterfaceMode(locked:boolean){
 const state=useSyncExternalStore(interfaceController.subscribe,interfaceController.getSnapshot,interfaceController.getSnapshot);
 useEffect(()=>{interfaceController.setLocked(locked);},[locked]);
 useEffect(()=>{const qs=[matchMedia(PHONE_QUERY),matchMedia(TABLET_QUERY)];const change=()=>interfaceController.setAutomatic(automatic());const storage=(e:StorageEvent)=>{if(e.key===INTERFACE_KEY)interfaceController.restore(e.newValue);};qs.forEach(q=>q.addEventListener('change',change));window.addEventListener('storage',storage);change();return()=>{qs.forEach(q=>q.removeEventListener('change',change));window.removeEventListener('storage',storage);};},[]);
 return state;
}
