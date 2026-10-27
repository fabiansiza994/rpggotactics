import {FriendProfileAccess} from '../social/FriendProfileStats';
import {PlayHub} from './PlayHub';
import {SocialDockButton} from '../social/SocialDockButton';
import {HistoryAccessContext} from '../pvp/HistoryAccess';
import type {PvpHistoryItem,PvpStats} from '../pvp/historyApi';
import {useEffect,useState} from 'react';
import {useSocialStore} from '../social/socialStore';
import {SocialSidebar} from '../social/SocialSidebar';
import {SocialScreen} from '../social/SocialScreen';
import {PRESENTATION_CONTENT} from '../qa/shapeshifter/runtime';
import type {Overview} from '../social/api';
const ids=Object.keys(PRESENTATION_CONTENT.heroes);
const fixture:Overview={serverTime:0,me:{username:'QA local'},friends:Array.from({length:new URLSearchParams(location.search).get('friends')==='5'?5:28},(_,i)=>({username:`Compañero_${String(i+1).padStart(2,'0')}`,avatarId:['wizard_blue','wizard_void','shapeshifter_bear','arcane_sigil','mystic_fox'][i%5],heroId:ids[i%ids.length]!,frameId:null,presence:i%3===0?'OFFLINE':i%3===1?'ONLINE':'IN_PVP',unread:i===1?2:0,conversationId:`qa-conversation-${i}`,lastMessageAt:null,since:0})),incoming:[{username:"Explorador_QA",heroId:null,frameId:null,sentAt:0}],outgoing:[],blocked:[],invites:{incoming:[],outgoing:[]},counts:{unread:2,requests:1,invites:0}};
const tally={matches:3,wins:2,losses:1,draws:0,winRate:67};
const matches:PvpHistoryItem[]=fixture.friends.flatMap(friend=>Array.from({length:friend.username.endsWith('04')?0:6},(_,i)=>({matchId:`qa-${friend.username}-${i}`,playedAt:1792368000000-i*86400000,mode:i===1?'DOMINION':'DUEL',result:i===1?'LOSS':'WIN',reason:'SURRENDER',opponent:{username:friend.username,deleted:false,champion:ids[(i+1)%ids.length]!},myChampion:ids[0]!,rounds:4+i,durationSeconds:120+i*30})));
const qaProfile=async(username:string)=>({lastSeen:Date.now()-480000,inMatch:username.endsWith('03'),ranked:username.endsWith('02')?{rp:1240,seasonId:'preseason_0'}:null,mostUsed:username.endsWith('04')?null:{champion:'mage',matches:43},mastery:{champion:'summoner',xp:2075},lastMatch:username.endsWith('04')?null:{champion:'mage',mode:'DUEL',result:'WIN',playedAt:1792368000000}});
const qaHistory={history:async(_cursor?:string|null,opponent?:string,limit?:number)=>({ok:true as const,data:{matches:matches.filter(m=>!opponent||m.opponent.username===opponent).slice(0,limit),nextCursor:null}}),stats:async()=>({ok:true as const,data:{overall:tally,byChampion:[],byMode:[]} as PvpStats}),headToHead:async(username:string)=>({ok:true as const,data:{opponent:{username},matchesPlayed:username.endsWith('04')?0:6,myWins:username.endsWith('04')?0:4,theirWins:username.endsWith('04')?0:2,draws:0,winRate:67,lastPlayedAt:matches[0]!.playedAt,byChampion:[],byMode:[]}}),detail:async(id:string)=>({ok:true as const,data:{...matches.find(m=>m.matchId===id)!,startedAt:1792367880000,mapId:'classic',me:{username:'QA local',champion:ids[0]!},firstTurn:'ME' as const,score:null}})};
/** Explicit UI fixture: no session, network, storage writes, fake accounts or friendship records. */
export function SocialUxQa(){
 const [open,setOpen]=useState(false);const [profile,setProfile]=useState<string|null>(null);const [action,setAction]=useState('');const ready=useSocialStore(s=>s.overview===fixture);
 useEffect(()=>{const previous=useSocialStore.getState();useSocialStore.setState({overview:fixture,refresh:async()=>{},openConversation:async()=>{},show:()=>()=>{},invite:async(username,mode,mapId)=>{setAction(`Invitación QA: ${username} · ${mode} · ${mapId}`);return null;},send:async()=>{setAction('Mensaje QA · no enviado');return null;},conversations:Object.fromEntries(fixture.friends.map(f=>[f.conversationId!,{messages:[{id:1,mine:false,body:'Conversación de prueba local. Sin conexión al servidor.',createdAt:0,readAt:null}],with:f.username,canSend:true,loaded:true,hasMore:false}]))});return()=>useSocialStore.setState(previous);},[]);
 if(!ready)return <p>Preparando fixture local…</p>;
 return <FriendProfileAccess.Provider value={qaProfile}><HistoryAccessContext.Provider value={qaHistory}><div>{!profile&&<PlayHub mode="hub" onStore={()=>setAction('Tienda · fixture local')}/>}<small style={{position:'fixed',bottom:4,left:8,zIndex:40,color:'#d9bd83'}}>QA social · sin conexión · {action}</small><SocialDockButton hidden={open} count={3} onClick={()=>setOpen(true)}/>{profile&&<SocialScreen onOpenChat={username=>{setAction(username);setOpen(true);}} key={profile} initialFriend={profile} onExit={()=>setProfile(null)}/>} {open&&<SocialSidebar initialFriend={action} onClose={()=>setOpen(false)} onProfile={username=>{setOpen(false);setProfile(username??fixture.friends[0]!.username);}}/>}</div></HistoryAccessContext.Provider></FriendProfileAccess.Provider>;
}
