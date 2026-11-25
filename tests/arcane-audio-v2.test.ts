import { afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runtimeAudioFiles, selectProvisional, provisionalSelections } from '../src/presentation/audio/runtimeCatalog';
import { AudioManager } from '../src/presentation/audio/AudioManager';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
const approvedFingerprints:Record<string,string>={"ui_confirm": "820d92a982025b3f09d96a6de62205b963d5f5ee2411dc8e77f4c6555bef118d", "ranked_match_found": "bac17a034baaae1793c9472b571a52d596e4610d0a40cce4c54d3da8465deacc", "ranked_search_loop": "44d47495db4a3e6b0e2b3d12084e23b6739713587be48a478bc906910a539bdc", "ui_cancel": "bea53e83550ef6408afd1c1c9f562ee4ba170d26b3cf274d14edcf1fe5f7020e", "card_hover": "cf76835385b501d565f659d008b72a65d84320e62fd0d391074c8cf2bd83fd90", "card_activate": "ddbebca755e29536ff1258b1110e8e9cb7e2e402b7ca1e0cec80dc4df48e2570"};
describe('Approved A selection and provisional V2 collection', () => {
  it.each(['ui_confirm','ranked_search_loop','ranked_match_found'] as const)('pins approved %s to A', cue => {
    expect(runtimeAudioFiles(cue)).toEqual(['/audio/arcane-runtime/v2/'+cue+'_A.mp3']);
    expect(statSync('public'+runtimeAudioFiles(cue)[0]!).size).toBeGreaterThan(1000);
    const hash=(file:string)=>createHash('sha256').update(readFileSync(file)).digest('hex');
    expect(hash('public'+runtimeAudioFiles(cue)[0]!)).toBe(approvedFingerprints[cue]);
  });
  it('changes provisional choices without changing the three approved files', () => {
    const memory=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>memory.set(k,v)});
    selectProvisional('ui_cancel','B');expect(provisionalSelections().ui_cancel).toBe('B');
    expect(runtimeAudioFiles('ui_cancel')[0]).toBe('/audio/arcane-v2/ui_cancel_B.mp3');
    expect(runtimeAudioFiles('ui_confirm')[0]).toBe('/audio/arcane-runtime/v2/ui_confirm_A.mp3');
  });
  it('serves the brief hover as a static WAV, no generator endpoint', () => expect(runtimeAudioFiles('card_hover')).toEqual(['/audio/arcane-runtime/v2/card_hover_A.wav']));
  it('uses the music bus, starts at zero, preserves a single source on heartbeats and fades on match',async()=>{
    const ramp=vi.fn(),source={buffer:null,loop:false,loopStart:0,loopEnd:0,connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn(),onended:null};
    const gain=()=>({value:1,setTargetAtTime:vi.fn(),setValueAtTime:vi.fn(),linearRampToValueAtTime:ramp,cancelScheduledValues:vi.fn()});
    const ctx={state:'running',currentTime:0,destination:{},createGain:()=>({gain:gain(),connect:vi.fn(),disconnect:vi.fn()}),createDynamicsCompressor:()=>({threshold:gain(),knee:gain(),ratio:gain(),attack:gain(),release:gain(),connect:vi.fn()}),createBufferSource:vi.fn(()=>source),decodeAudioData:async()=>({duration:75.0498}),resume:async()=>{},close:async()=>{}};
    const fetch=vi.fn(async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)}) as Response);
    const m=new AudioManager({context:()=>ctx as unknown as AudioContext,fetch,visible:()=>true,files:runtimeAudioFiles,categories:{ranked_search_loop:'music'},loopBounds:{start:10,end:75.0498}});
    m.setPreferences({enabled:true});await m.unlock();await m.startSearch('one');await m.startSearch('one');
    expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);expect(source.start).toHaveBeenCalledWith();
    expect(source.loopStart).toBe(10);expect(source.loopEnd).toBe(75.0498);
    m.stopSearch();expect(ramp).toHaveBeenCalledWith(0,.35);expect(m.diagnostics.loopOwner).toBeNull();m.dispose();
  });
});

it.each(['ui_cancel','card_hover','card_activate'] as const)('pins official production %s to its approved A fingerprint',cue=>{vi.stubEnv('DEV',false);const file=runtimeAudioFiles(cue)[0]!;expect(file).toMatch(/_A\.(mp3|wav)$/);expect(createHash('sha256').update(readFileSync('public'+file)).digest('hex')).toBe(approvedFingerprints[cue]);});
it('stops Ranked audio on authoritative maintenance rejection',async()=>{const{RankedAudioSession}=await import('../src/presentation/audio/audio');const a={startSearch:vi.fn(),stopSearch:vi.fn(),play:vi.fn()},s=new RankedAudioSession(a,true);s.begin();s.update({state:'SEARCHING',since:1});s.rejected(503);expect(a.stopSearch).toHaveBeenCalledOnce();s.update({state:'MATCHED',code:'late'});expect(a.play).not.toHaveBeenCalled();});
