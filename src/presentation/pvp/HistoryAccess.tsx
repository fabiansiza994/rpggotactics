import {createContext,useContext} from 'react';
import {loadSession} from '../cloud/session';
import {pvpHistoryApi} from './historyApi';
/** UI access seam: production delegates unchanged to the existing authenticated history API. */
export const liveHistoryAccess={
 history:(cursor?:string|null,opponent?:string,limit?:number)=>{const s=loadSession();return s?pvpHistoryApi.history(s.token,cursor,opponent,limit):Promise.resolve(null);},
 stats:()=>{const s=loadSession();return s?pvpHistoryApi.stats(s.token):Promise.resolve(null);},
 detail:(id:string)=>{const s=loadSession();return s?pvpHistoryApi.detail(s.token,id):Promise.resolve(null);},
 headToHead:(username:string)=>{const s=loadSession();return s?pvpHistoryApi.headToHead(s.token,username):Promise.resolve(null);},
};
export const HistoryAccessContext=createContext(liveHistoryAccess);
export const useHistoryAccess=()=>useContext(HistoryAccessContext);
