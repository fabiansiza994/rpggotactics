import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {SocialSidebar,sortSocialFriends} from '../src/presentation/social/SocialSidebar';
import type {Friend} from '../src/presentation/social/api';
import {liveHistoryAccess} from '../src/presentation/pvp/HistoryAccess';
import {pvpHistoryApi} from '../src/presentation/pvp/historyApi';
vi.mock('../src/presentation/cloud/session',()=>({loadSession:()=>({token:'qa-token',username:'qa'})}));
const friends:Friend[]=Array.from({length:24},(_,i)=>({username:`QA${i}`,heroId:null,frameId:null,presence:i%3===0?'OFFLINE':i%3===1?'ONLINE':'IN_PVP',unread:0,conversationId:'c'+i,lastMessageAt:null,since:0}));
afterEach(()=>vi.restoreAllMocks());
describe('social drawer presentation and reuse',()=>{
 it('scales to 24 rows and exposes accessible chat/invite/profile actions',()=>{const html=renderToStaticMarkup(createElement(SocialSidebar,{fixtureFriends:friends,onClose:()=>{},onProfile:()=>{}}));expect(html.match(/class="social-drawer-friend"/g)).toHaveLength(24);expect(html).toContain('Cerrar panel social');expect(html).toContain('Chat con QA1');expect(html).toContain('Invitar a PvP a QA1');expect(html).toContain('Ver perfil e historial de QA1');expect(html).toContain('En partida PvP');expect(html).toContain('Desconectado');});
 it('orders connected friends ahead of offline without inventing presence',()=>{const sorted=sortSocialFriends(friends);expect(sorted.at(-1)!.presence).toBe('OFFLINE');expect(sorted[0]!.presence).not.toBe('OFFLINE');expect(friends[0]!.username).toBe('QA0');});
 it('loads rivalry and matches through the existing authenticated history APIs',async()=>{const h=vi.spyOn(pvpHistoryApi,'headToHead').mockResolvedValue({ok:false,error:{kind:'NETWORK',status:0,code:'QA',message:'QA'}});const p=vi.spyOn(pvpHistoryApi,'history').mockResolvedValue({ok:true,data:{matches:[],nextCursor:null}});await liveHistoryAccess.headToHead('friend');await liveHistoryAccess.history('cursor');expect(h).toHaveBeenCalledWith('qa-token','friend');expect(p).toHaveBeenCalledWith('qa-token','cursor');});
});
