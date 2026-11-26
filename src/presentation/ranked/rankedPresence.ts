import {create} from 'zustand';
import type {RankedQueueState} from './rankedApi';
/** A projection of the existing queue owner; never a second matchmaking client. */
export const useRankedPresence=create<{
 queue:RankedQueueState;busy:boolean;heroId:string|null;deckId:string|null;
 cancel:(()=>void)|null;
}>(()=>({queue:{state:'IDLE'},busy:false,heroId:null,deckId:null,cancel:null}));
export function rankedOccupied(){const s=useRankedPresence.getState();return s.busy||s.queue.state!=='IDLE';}
export function rankedDeckLocked(heroId:string,deckId:string){const s=useRankedPresence.getState();return rankedOccupied()&&s.heroId===heroId&&(!s.deckId||s.deckId===deckId);}
export const RANKED_BUSY_NOTICE='Tienes una búsqueda Ranked activa. Cancélala antes de iniciar otro combate.';
export const RANKED_DECK_NOTICE='Este mazo está registrado en Ranked. Puedes editarlo, pero debes cancelar la búsqueda antes de guardar o eliminarlo.';
