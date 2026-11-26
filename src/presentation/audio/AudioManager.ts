import{AUDIO_CUES,audioFiles,type AudioCue,type AudioCategory,type AudioVariant}from'./catalog';
export interface AudioPreferences{enabled:boolean;muted:boolean;volumes:Record<AudioCategory,number>;variant:AudioVariant}
const defaults=():AudioPreferences=>({enabled:true,muted:false,variant:'A',volumes:{master:.75,effects:1,ui:.65,cards:.55,matchmaking:.60,combat:.65,music:.35}});
const PREF_KEY='rpggo:arcane-audio:v1';
export function parseAudioPreferences(raw:string|null):AudioPreferences{const p=defaults();try{const x=JSON.parse(raw??'null');if(x&&typeof x==='object'){if(typeof x.enabled==='boolean')p.enabled=x.enabled;if(typeof x.muted==='boolean')p.muted=x.muted;if(['A','B','C'].includes(x.variant))p.variant=x.variant;for(const k of Object.keys(p.volumes)as AudioCategory[]){const n=x.volumes?.[k];if(typeof n==='number'&&Number.isFinite(n))p.volumes[k]=Math.min(1,Math.max(0,n));}}}catch{/* Corrupt/blocked storage never affects combat. */}return p;}
interface Voice{source:AudioBufferSourceNode;gain:GainNode;cue:AudioCue;priority:number;loop:boolean}
export class AudioManager{
 private context:AudioContext|null=null;private master:GainNode|null=null;private limiter:DynamicsCompressorNode|null=null;private buses=new Map<AudioCategory,GainNode>();private buffers=new Map<string,AudioBuffer>();private loading=new Map<string,Promise<AudioBuffer|undefined>>();private voices:Voice[]=[];private loop:Voice|null=null;private loopGeneration=0;private loopOwner:string|null=null;private recording:MediaStreamAudioDestinationNode|null=null;
 private searchAllowed=true;private searchOwner:string|null=null;private searchOffset=0;private searchStarted=0;private searchLoading:Promise<void>|null=null;
 private battleMusic:HTMLAudioElement|null=null;private battleSource:MediaElementAudioSourceNode|null=null;private battleGain:GainNode|null=null;private battleOwner:string|null=null;private battleFile:string|null=null;private musicTimers=new Map<ReturnType<typeof setTimeout>,()=>void>();private duckUntil=0;private lastDuck=-Infinity;
 private listeners=new Set<()=>void>();private lastHover:{epoch:unknown;uid:string}|null=null;private hoverAt=-Infinity;private disposed=false;private metrics={played:0,dropped:0,loads:0,loopStarts:0};private now:()=>number;
 preferences:AudioPreferences;
 constructor(private readonly options:{context?:()=>AudioContext;fetch?:typeof fetch;storage?:Pick<Storage,'getItem'|'setItem'>;now?:()=>number;visible?:()=>boolean;files?:(cue:AudioCue,variant:AudioVariant)=>string[];categories?:Partial<Record<AudioCue,AudioCategory>>;gains?:Partial<Record<AudioCue,number>>;loopBounds?:{start:number;end:number};preload?:readonly AudioCue[]}={}){let raw=null;try{raw=this.storage()?.getItem(PREF_KEY)??null;}catch{/* storage denied */}this.preferences=parseAudioPreferences(raw);this.now=options.now??(()=>performance.now());}
 private storage(){return this.options.storage??(typeof localStorage==='undefined'?undefined:localStorage);}
 subscribe=(f:()=>void)=>{this.listeners.add(f);return()=>{this.listeners.delete(f);};};getPreferences=()=>this.preferences;
 setPreferences(patch:Partial<Omit<AudioPreferences,'volumes'>>&{volumes?:Partial<AudioPreferences['volumes']>}){const oldVariant=this.preferences.variant;this.preferences=parseAudioPreferences(JSON.stringify({...this.preferences,...patch,volumes:{...this.preferences.volumes,...patch.volumes}}));if(oldVariant!==this.preferences.variant)this.stopSearch();try{this.storage()?.setItem(PREF_KEY,JSON.stringify(this.preferences));}catch{/* private browsing */}this.applyVolumes();if(!this.preferences.enabled||this.preferences.muted)this.stopAll();for(const f of this.listeners)f();}
 private usable(){return!this.disposed&&this.preferences.enabled&&!this.preferences.muted&&(this.options.visible?.()??(typeof document==='undefined'||document.visibilityState!=='hidden'));}
 /** Must only be called from a trusted pointer/keyboard handler. Never queues stale one-shots. */
 async unlock(){if(!this.usable())return false;try{if(!this.context){const factory=this.options.context??(()=>{const C=window.AudioContext??(window as unknown as{webkitAudioContext:typeof AudioContext}).webkitAudioContext;return new C();});this.context=factory();this.master=this.context.createGain();this.limiter=this.context.createDynamicsCompressor();Object.assign(this.limiter.threshold,{value:-6});this.limiter.knee.value=8;this.limiter.ratio.value=12;this.limiter.attack.value=.003;this.limiter.release.value=.12;this.master.connect(this.limiter);this.limiter.connect(this.context.destination);const effects=this.context.createGain();effects.connect(this.master);this.buses.set('effects',effects);for(const cat of['ui','cards','matchmaking','combat','music']as AudioCategory[]){const bus=this.context.createGain();bus.connect(cat==='music'?this.master:effects);this.buses.set(cat,bus);}this.applyVolumes();}if(this.context.state!=='running')await this.context.resume();if(this.context.state!=='running')return false;await Promise.all((this.options.preload??(Object.keys(AUDIO_CUES)as AudioCue[]).filter(id=>!id.startsWith('battle_'))).map(id=>this.load(id)));await this.resumeBattleMusic();if(this.searchOwner)await this.startSearch(this.searchOwner);return true;}catch{return false;}}
 private applyVolumes(){if(!this.context)return;const t=this.context.currentTime;this.master?.gain.setTargetAtTime(this.preferences.muted?0:this.preferences.volumes.master,t,.02);for(const[cat,bus]of this.buses)bus.gain.setTargetAtTime(this.preferences.volumes[cat],t,.02);}
 private cacheKey(cue:AudioCue){return cue+this.preferences.variant+(this.options.files?':'+this.options.files(cue,this.preferences.variant).join('|'):'');}
 private load(cue:AudioCue){const variant=this.preferences.variant,key=this.cacheKey(cue);if(this.buffers.has(key))return Promise.resolve(this.buffers.get(key));const pending=this.loading.get(key);if(pending)return pending;const context=this.context;if(!context)return Promise.resolve(undefined);const request=(async()=>{for(const file of(this.options.files?.(cue,variant)??audioFiles(cue,variant)))try{this.metrics.loads++;const r=await(this.options.fetch??fetch)(file);if(!r.ok)continue;const buffer=await context.decodeAudioData(await r.arrayBuffer());if(!this.disposed&&this.context===context)this.buffers.set(key,buffer);return buffer;}catch{/* AAC unsupported: static PCM fallback. */}return undefined;})().finally(()=>this.loading.delete(key));this.loading.set(key,request);return request;}
 play(cue:AudioCue){try{if(!this.usable()||this.context?.state!=='running'){this.metrics.dropped++;return false;}const buffer=this.buffers.get(this.cacheKey(cue));if(!buffer){void this.load(cue);this.metrics.dropped++;return false;}const def=AUDIO_CUES[cue];const same=this.voices.filter(v=>v.cue===cue);if(same.length>=def.limit){this.metrics.dropped++;return false;}if(this.voices.length>=8){const steal=this.voices.find(v=>!v.loop&&v.priority<=def.priority);if(!steal){this.metrics.dropped++;return false;}this.stopVoice(steal,0);}this.makeVoice(cue,buffer,false);if(['card_activate','battle_turn_start','battle_victory','battle_defeat'].includes(cue))this.duckMusic();return true;}catch{this.metrics.dropped++;return false;}}
 private makeVoice(cue:AudioCue,buffer:AudioBuffer,loop:boolean,offset=0){const c=this.context!,source=c.createBufferSource(),gain=c.createGain();source.buffer=buffer;source.loop=loop;if(loop&&this.options.loopBounds){source.loopStart=this.options.loopBounds.start;source.loopEnd=Math.min(buffer.duration,this.options.loopBounds.end);}source.connect(gain);gain.connect(this.buses.get(this.options.categories?.[cue]??AUDIO_CUES[cue].category)!);const voice:Voice={source,gain,cue,priority:AUDIO_CUES[cue].priority,loop};source.onended=()=>{source.disconnect();gain.disconnect();this.voices=this.voices.filter(x=>x!==voice);if(this.loop===voice){this.loop=null;this.loopOwner=null;}};gain.gain.setValueAtTime(loop?0:(this.options.gains?.[cue]??AUDIO_CUES[cue].gain),c.currentTime);if(loop)gain.gain.linearRampToValueAtTime(this.options.gains?.[cue]??AUDIO_CUES[cue].gain,c.currentTime+.25);this.voices.push(voice);if(offset>0)source.start(0,offset);else source.start();this.metrics.played++;return voice;}
 private stopVoice(v:Voice,fade=.3){const c=this.context;if(!c)return;try{v.gain.gain.cancelScheduledValues(c.currentTime);v.gain.gain.setValueAtTime(v.gain.gain.value,c.currentTime);v.gain.gain.linearRampToValueAtTime(0,c.currentTime+fade);v.source.stop(c.currentTime+(fade>0?fade+.01:0));if(fade===0){v.source.disconnect();v.gain.disconnect();}}catch{/* already ended */}this.voices=this.voices.filter(x=>x!==v);}
 setSearchAudible(value:boolean){this.searchAllowed=value;if(!value)this.pauseSearch();}
 async startSearch(owner:string){
  if(!this.searchAllowed)return;
  this.stopBattleMusic(.35,true);
  if(this.searchOwner!==owner){this.stopSearch();this.searchOwner=owner;}
  if(this.loopOwner===owner&&this.loop)return;
  if(this.searchLoading)return this.searchLoading;
  if(!this.usable()||this.context?.state!=='running')return;
  const generation=this.loopGeneration;
  const pending=(async()=>{const buffer=await this.load('ranked_search_loop');if(!buffer||generation!==this.loopGeneration||!this.usable()||this.context?.state!=='running')return;
   if(!this.options.loopBounds&&buffer.duration>0)this.searchOffset%=buffer.duration;
   this.loop=this.makeVoice('ranked_search_loop',buffer,true,this.searchOffset);this.searchStarted=this.context.currentTime;this.loopOwner=owner;this.metrics.loopStarts++;
  })();this.searchLoading=pending;try{await pending;}finally{if(this.searchLoading===pending)this.searchLoading=null;}
 }
 private currentSearchOffset(){
  const elapsed=this.searchOffset+(this.loop&&this.context?Math.max(0,this.context.currentTime-this.searchStarted):0),bounds=this.options.loopBounds;
  return bounds&&elapsed>=bounds.end?bounds.start+(elapsed-bounds.end)%(bounds.end-bounds.start):elapsed;
 }
 pauseSearch(){const owner=this.searchOwner,offset=this.currentSearchOffset();this.stopSearch();this.searchOwner=owner;this.searchOffset=offset;}
 stopSearch(){this.loopGeneration++;if(this.loop)this.stopVoice(this.loop,.35);this.loop=null;this.loopOwner=null;this.searchOwner=null;this.searchOffset=0;this.searchLoading=null;}
 leaveHover(epoch:unknown,uid:string){if(this.lastHover&&this.lastHover.epoch===epoch&&this.lastHover.uid===uid)this.lastHover=null;}
 hover(epoch:unknown,uid:string){if(this.lastHover&&this.lastHover.epoch===epoch&&this.lastHover.uid===uid)return false;this.lastHover={epoch,uid};if(this.now()-this.hoverAt<100)return false;this.hoverAt=this.now();return this.play('card_hover');}
 stopAll(){this.pauseSearch();this.battleMusic?.pause();for(const v of[...this.voices])this.stopVoice(v,.025);}
 async prepare(cues:readonly AudioCue[]){if(this.context?.state!=='running')return;await Promise.all(cues.map(cue=>this.load(cue)));}
 async playPrepared(cue:AudioCue,stillValid:()=>boolean=()=>true){await this.prepare([cue]);return stillValid()&&this.play(cue);}
 async startBattleMusic(owner:string,file:string){
  if(this.battleOwner===owner&&this.battleFile===file){await this.resumeBattleMusic();return;}
  this.stopSearch();this.stopBattleMusic(0,true);this.battleOwner=owner;this.battleFile=file;
  await this.resumeBattleMusic();
 }
 private async resumeBattleMusic(){
  if(!this.battleOwner||!this.battleFile||!this.usable()||this.context?.state!=='running')return;
  try{
   if(!this.battleMusic){const music=new Audio();music.preload='metadata';music.loop=true;music.src=this.battleFile;this.battleMusic=music;this.battleSource=this.context.createMediaElementSource(music);this.battleGain=this.context.createGain();this.battleSource.connect(this.battleGain);this.battleGain.connect(this.buses.get('music')!);this.battleGain.gain.setValueAtTime(0,this.context.currentTime);}
   if(!this.battleMusic.paused)return;
   const music=this.battleMusic;await music.play();if(this.battleMusic!==music){music.pause();return;}
   this.battleGain?.gain.setTargetAtTime(.20,this.context.currentTime,.35);
  }catch{/* Autoplay, missing audition file or interrupted navigation: never delay a command. */}
 }
 stopBattleMusic(fade=.4,release=false){
  const music=this.battleMusic,source=this.battleSource,gain=this.battleGain;
  if(!music){if(release){this.battleOwner=null;this.battleFile=null;}return;}
  if(gain&&this.context){gain.gain.cancelScheduledValues(this.context.currentTime);gain.gain.setTargetAtTime(0,this.context.currentTime,Math.max(.01,fade/3));}
  this.battleMusic=null;this.battleSource=null;this.battleGain=null;
  if(release){this.battleMusic=null;this.battleSource=null;this.battleGain=null;this.battleOwner=null;this.battleFile=null;}
  const stop=()=>{music?.pause();source?.disconnect();gain?.disconnect();if(music){music.removeAttribute('src');music.load();}if(timer)this.musicTimers.delete(timer);};
  let timer:ReturnType<typeof setTimeout>|undefined;
  if(fade>0){timer=setTimeout(stop,fade*1000);this.musicTimers.set(timer,stop);}else stop();
 }
 duckMusic(){
  const c=this.context,gain=this.battleGain;if(!c||!gain||this.battleMusic?.paused)return;
  const t=c.currentTime;if(t-this.lastDuck<.20)return;this.lastDuck=t;this.duckUntil=t+.8;
  gain.gain.cancelScheduledValues(t);gain.gain.setTargetAtTime(.20*.65,t,.05);gain.gain.setTargetAtTime(.20,this.duckUntil,.30);
 }
 captureStream(){if(!this.context||!this.limiter)return null;if(!this.recording){this.recording=this.context.createMediaStreamDestination();this.limiter.connect(this.recording);}return this.recording.stream;}
 releaseCapture(){if(!this.recording)return;try{this.limiter?.disconnect(this.recording);}catch{/* disconnected */}this.recording.stream.getTracks().forEach(t=>t.stop());this.recording=null;}
 get diagnostics(){return{searchPosition:this.currentSearchOffset(),searchOwner:this.searchOwner,battleMusicOwner:this.battleOwner,battleMusicFile:this.battleFile,battleMusicTime:this.battleMusic?.currentTime??0,battleMusicPlaying:!!this.battleMusic&&!this.battleMusic.paused,duckUntil:this.duckUntil,...this.metrics,activeVoices:this.voices.length,loopOwner:this.loopOwner,contextState:this.context?.state??'not-created',cachedBuffers:this.buffers.size,listeners:this.listeners.size};}
 dispose(){for(const [timer,stop]of this.musicTimers){clearTimeout(timer);stop();}this.musicTimers.clear();this.stopBattleMusic(0,true);this.disposed=true;this.stopAll();this.stopSearch();this.releaseCapture();void this.context?.close().catch(()=>{});this.context=null;this.master=null;this.buses.clear();this.buffers.clear();this.loading.clear();}
 reactivate(){this.disposed=false;}
}
