import {useEffect,useState} from 'react';
export const PLAY_MODES=['hub','play','campaign','skirmish','stories','pvp','friends','cards','profile','store'] as const;
export type PlayMode=typeof PLAY_MODES[number];
export function readPlayMode():PlayMode {const query=new URLSearchParams(location.search);const mode=query.get('mode');if(query.get('store')==='1')return 'store';return PLAY_MODES.includes(mode as PlayMode)?mode as PlayMode:'hub';}
const guards=new Set<()=>boolean>();
export const registerPlayNavigationGuard=(guard:()=>boolean)=>{guards.add(guard);return()=>{guards.delete(guard);};};
export const canNavigatePlay=()=>[...guards].every(guard=>guard());
/** Restore the active URL before any subscriber can observe an unsafe Back destination. */
export function protectPlayBack(previousUrl:string,inBattle:boolean){
 if(!inBattle&&canNavigatePlay())return false;
 history.pushState({},'',previousUrl);window.dispatchEvent(new Event('rpggo-play-route'));return true;
}
export function navigatePlay(mode:PlayMode,options:{story?:string;friend?:string;queue?:'ranked'}={}){if(!canNavigatePlay())return false;const url=new URL(location.href);url.searchParams.delete('store');if(mode==='hub')url.searchParams.delete('mode');else url.searchParams.set('mode',mode);for(const key of ['story','friend','queue'] as const){if(options[key])url.searchParams.set(key,options[key]!);else url.searchParams.delete(key);}if(url.href!==location.href)history.pushState({},'',url);window.dispatchEvent(new Event('rpggo-play-route'));return true;}
export function usePlayMode(){const [,setQuery]=useState(()=>location.search);useEffect(()=>{const update=()=>setQuery(location.search);// App validates popstate first, then publishes the resolved route.
window.addEventListener('rpggo-play-route',update);return()=>{window.removeEventListener('rpggo-play-route',update);};},[]);return readPlayMode();}
