import {afterEach,describe,expect,it,vi} from 'vitest';
import {AudioManager} from '../src/presentation/audio/AudioManager';
import {RankedAudioSession} from '../src/presentation/audio/audio';
import {useRankedPresence,rankedOccupied,rankedDeckLocked} from '../src/presentation/ranked/rankedPresence';
import {useBattleStore} from '../src/presentation/store/battleStore';
import {rankedRemaining} from '../src/presentation/ranked/GlobalRanked';
function audioFixture(){
 const param=()=>({value:1,setValueAtTime:vi.fn(),setTargetAtTime:vi.fn(),linearRampToValueAtTime:vi.fn(),cancelScheduledValues:vi.fn()});
 const sources:{start:ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>}[]=[];
 const ctx={state:'running',currentTime:0,destination:{},resume:vi.fn(async()=>{}),createGain:()=>({gain:param(),connect:vi.fn(),disconnect:vi.fn()}),createDynamicsCompressor:()=>({threshold:param(),knee:param(),ratio:param(),attack:param(),release:param(),connect:vi.fn()}),createBufferSource:()=>{const s={buffer:null,loop:false,connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn(),onended:null};sources.push(s);return s;},decodeAudioData:vi.fn(async()=>({duration:80}))};
 let visible=true;
 const m=new AudioManager({context:()=>ctx as unknown as AudioContext,fetch:vi.fn(async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)})as Response),storage:{getItem:()=>null,setItem:()=>{}},visible:()=>visible,loopBounds:{start:10,end:75.0498}});
 return{m,ctx,sources,visible:(v:boolean)=>{visible=v;}};
}
afterEach(()=>useRankedPresence.setState({queue:{state:'IDLE'},busy:false,heroId:null,deckId:null,cancel:null}));
describe('Global Ranked lifecycle contracts',()=>{
 it('keeps one source and musical position through repeated route-like heartbeats',async()=>{const{m,ctx,sources}=audioFixture();await m.unlock();await m.startSearch('request:42');ctx.currentTime=28;for(let i=0;i<10;i++)await m.startSearch('request:42');expect(sources).toHaveLength(1);expect(m.diagnostics.searchPosition).toBe(28);expect(m.diagnostics.loopStarts).toBe(1);});
 it('coalesces concurrent starts and resumes at the same offset after browser hiding',async()=>{const{m,ctx,sources,visible}=audioFixture();await m.unlock();await Promise.all([m.startSearch('ticket'),m.startSearch('ticket')]);expect(sources).toHaveLength(1);ctx.currentTime=20;visible(false);m.stopAll();ctx.currentTime=40;visible(true);await m.startSearch('ticket');expect(sources[1]?.start).toHaveBeenCalledWith(0,20);});
 it('resumes at the existing loop body, and cancellation resets the next request',async()=>{const{m,ctx,sources}=audioFixture();await m.unlock();await m.startSearch('one');ctx.currentTime=80;m.stopAll();await m.startSearch('one');expect(sources[1]?.start).toHaveBeenCalledWith(0,14.950199999999995);m.stopSearch();await m.startSearch('two');expect(sources[2]?.start).toHaveBeenCalledWith();});
 it('honors mute and lease ownership without bypassing suspended native contexts',async()=>{const{m,ctx}=audioFixture();await m.unlock();await m.startSearch('one');ctx.currentTime=10;m.setPreferences({muted:true});await m.startSearch('one');expect(m.diagnostics.loopOwner).toBeNull();m.setPreferences({muted:false});await m.startSearch('one');expect(m.diagnostics.searchPosition).toBe(10);m.setSearchAudible(false);await m.unlock();expect(m.diagnostics.loopOwner).toBeNull();m.setSearchAudible(true);ctx.state='suspended';await m.startSearch('one');expect(m.diagnostics.loopOwner).toBeNull();});
 it.each(['HUMAN','BOT'])('plays identical challenge cue once for %s duplicate events',code=>{const a={startSearch:vi.fn(),stopSearch:vi.fn(),play:vi.fn()},s=new RankedAudioSession(a,true);s.begin();s.update({state:'SEARCHING',since:42});s.update({state:'MATCHED',code});s.update({state:'MATCHED',code});expect(a.play).toHaveBeenCalledExactlyOnceWith('ranked_match_found');});
 it('uses absolute deadlines through navigation and reconnect',()=>{const expires=120000;expect(rankedRemaining(expires,10000)).toBe(110);expect(rankedRemaining(expires,60000)).toBe(60);expect(rankedRemaining(expires,130000)).toBe(0);});
 it('blocks incompatible battles and registered-deck mutation without locking other decks',async()=>{useRankedPresence.setState({queue:{state:'SEARCHING',heroId:'mage',deckId:'main',since:42},heroId:'mage',deckId:'main'});expect(rankedOccupied()).toBe(true);expect(rankedDeckLocked('mage','main')).toBe(true);expect(rankedDeckLocked('mage','other')).toBe(false);expect(await useBattleStore.getState().startScenario('first_blood')).toBe(false);expect(await useBattleStore.getState().startRun()).toBe(false);expect(await useBattleStore.getState().deleteDeck('mage','main')).toMatchObject({ok:false});});
});
